// Credenciais individuais exclusivas do runtime Node/Railway.
// Não altera o modelo de identidade do Cloudflare nem cadastra membros automaticamente.
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readCookie, readSession, verifyCredentials } from "./auth.mjs";

const derive = promisify(scrypt);
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const INVALID_LINK = "Link inválido, expirado ou já utilizado. Peça um novo link ao administrador.";
export const passwordTokenHash = (token) => createHash("sha256").update(token).digest("hex");
export const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();

export function validPassword(password) {
  return typeof password === "string" && password.length >= 10 && Buffer.byteLength(password, "utf8") <= 1024;
}

export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error("A senha deve ter no mínimo 10 caracteres e no máximo 1024 bytes.");
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt-v1$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > 1024) return false;
  const [algorithm, salt, digest, extra] = String(stored ?? "").split("$");
  if (algorithm !== "scrypt-v1" || !/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(digest ?? "") || extra !== undefined) return false;
  const key = await derive(password, salt, 64, SCRYPT_OPTIONS);
  return timingSafeEqual(key, Buffer.from(digest, "hex"));
}

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

export class UserCredentials {
  constructor(pool) {
    this.pool = pool;
    // Mesmo custo de verificação para contas inexistentes, sem gravar um usuário.
    this.dummyHash = hashPassword(randomBytes(32).toString("hex"));
  }

  async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS railway_access_requests (
      id serial PRIMARY KEY, organization_id integer NOT NULL, email text NOT NULL,
      full_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (organization_id, email)
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS railway_google_identities (
      subject text PRIMARY KEY, email text NOT NULL UNIQUE, user_id integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS railway_user_credentials (
      email text PRIMARY KEY, password_hash text NOT NULL, session_version text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS railway_password_tokens (
      token_hash text PRIMARY KEY, email text NOT NULL, organization_id integer NOT NULL,
      expires_at timestamptz NOT NULL, used_at timestamptz,
      created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  }

  async memberships(email, executor = this.pool) {
    const { rows } = await executor.query(`SELECT m.organization_id, m.role, u.id AS user_id
      FROM app_users u JOIN organization_memberships m ON m.user_id = u.id
      JOIN organizations o ON o.id = m.organization_id
      WHERE lower(u.email) = $1 AND u.status = 'Ativo' AND m.status = 'Ativo'
      AND o.status = 'Ativa' ORDER BY m.id`, [email]);
    return rows;
  }

  async requestAccess({ email, name, company }) {
    email = normalizeEmail(email);
    name = String(name ?? "").trim();
    company = String(company ?? "").trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 2 || name.length > 120 || !/^[a-z0-9-]{2,80}$/.test(company)) {
      fail(400, "Informe nome, e-mail válido e o código da empresa fornecido pelo administrador.");
    }
    // Não confirma a existência da empresa/conta e não altera usuários ou credenciais.
    await this.pool.query(`INSERT INTO railway_access_requests (organization_id, email, full_name)
      SELECT o.id, $1, $2 FROM organizations o WHERE o.slug = $3 AND o.status = 'Ativa'
      AND NOT EXISTS (SELECT 1 FROM app_users u JOIN organization_memberships m ON m.user_id = u.id
        WHERE lower(u.email) = $1 AND m.organization_id = o.id)
      ON CONFLICT (organization_id, email) DO NOTHING`, [email, name, company]);
  }

  async accessRequests(cookieHeader, config) {
    const actor = await this.sessionIdentity(cookieHeader, config);
    if (!actor) fail(401, "Autenticação obrigatória.");
    const memberships = await this.memberships(actor);
    const requested = Number(readCookie(cookieHeader, "exportatrust_org"));
    const current = memberships.find((item) => item.organization_id === requested) ?? memberships[0];
    if (current?.role !== "administrador") fail(403, "Somente administradores podem consultar solicitações.");
    const { rows: [organization] } = await this.pool.query("SELECT slug FROM organizations WHERE id = $1", [current.organization_id]);
    const { rows } = await this.pool.query(`SELECT r.id, r.email, r.full_name AS "fullName", r.created_at AS "createdAt"
      FROM railway_access_requests r WHERE r.organization_id = $1 AND NOT EXISTS (
        SELECT 1 FROM app_users u JOIN organization_memberships m ON m.user_id = u.id
        WHERE lower(u.email) = r.email AND m.organization_id = r.organization_id
      ) ORDER BY r.created_at DESC LIMIT 100`, [current.organization_id]);
    return { requests: rows, companyCode: organization.slug };
  }

  async authenticate(email, password, config) {
    email = normalizeEmail(email);
    const bootstrap = verifyCredentials(email, password, config);
    const { rows: [credential] } = await this.pool.query(
      "SELECT password_hash, session_version FROM railway_user_credentials WHERE email = $1", [email]);
    const personal = await verifyPassword(password, credential?.password_hash ?? await this.dummyHash);
    if (!bootstrap && !personal) return null;
    const memberships = await this.memberships(email);
    if (memberships.length) return { email, version: personal ? credential.session_version : undefined };
    // Preserva somente o bootstrap da instalação inicial, antes do primeiro vínculo.
    const { rows } = await this.pool.query("SELECT id FROM organization_memberships LIMIT 1");
    return bootstrap && !rows.length ? { email } : null;
  }

  async sessionIdentity(cookieHeader, config) {
    const session = readSession(cookieHeader, config);
    if (!session) return null;
    const email = normalizeEmail(session.e);
    if (session.g) {
      const { rows: [linked] } = await this.pool.query(`SELECT g.subject FROM railway_google_identities g
        JOIN app_users u ON u.id = g.user_id AND lower(u.email) = g.email
        WHERE g.subject = $1 AND g.email = $2`, [session.g, email]);
      if (!linked) return null;
    } else if (session.v) {
      const { rows: [credential] } = await this.pool.query(
        "SELECT session_version FROM railway_user_credentials WHERE email = $1", [email]);
      if (!credential || session.v !== credential.session_version) return null;
    } else if (!config.allowedEmails.includes(email)) return null;
    // Sem cache: inativação ou troca de senha revoga no próximo request.
    if ((await this.memberships(email)).length) return email;
    if (session.v || session.g) return null;
    const { rows } = await this.pool.query("SELECT id FROM organization_memberships LIMIT 1");
    return rows.length ? null : email;
  }

  async authorizeGoogle({ subject, email }, bootstrapEmail = "") {
    email = normalizeEmail(email);
    if (!subject || !email) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (email === normalizeEmail(bootstrapEmail)) {
        // Opt-in de infraestrutura, somente na homologação: primeiro acesso do
        // proprietário já escolhido. Nunca reativa usuário/vínculo inativado.
        const { rows: [organization] } = await client.query("SELECT id FROM organizations WHERE id = 1 AND status = 'Ativa'");
        if (organization) {
          await client.query(`INSERT INTO app_users (email, full_name, status, identity_provider)
            SELECT $1, $1, 'Ativo', 'google' WHERE NOT EXISTS (
              SELECT 1 FROM app_users WHERE lower(email) = $1
            ) ON CONFLICT (email) DO NOTHING`, [email]);
          await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status, invited_by)
            SELECT 1, id, 'administrador', 'Ativo', 'google-bootstrap' FROM app_users
            WHERE lower(email) = $1 AND status = 'Ativo'
            ON CONFLICT (organization_id, user_id) DO NOTHING`, [email]);
        }
      }
      const memberships = await this.memberships(email, client);
      if (!memberships.length) { await client.query("ROLLBACK"); return null; }
      const { rows: links } = await client.query("SELECT subject, email FROM railway_google_identities WHERE subject = $1 OR email = $2", [subject, email]);
      if (links.some((link) => link.subject !== subject || link.email !== email)) { await client.query("ROLLBACK"); return null; }
      await client.query(`INSERT INTO railway_google_identities (subject, email, user_id) VALUES ($1, $2, $3)
        ON CONFLICT (subject) DO UPDATE SET user_id = EXCLUDED.user_id`, [subject, email, memberships[0].user_id]);
      await client.query("COMMIT");
      return { email, subject };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async issueLink(email, cookieHeader, config, origin) {
    const actor = await this.sessionIdentity(cookieHeader, config);
    if (!actor) fail(401, "Autenticação obrigatória.");
    const memberships = await this.memberships(actor);
    const requested = Number(readCookie(cookieHeader, "exportatrust_org"));
    const current = memberships.find((item) => item.organization_id === requested) ?? memberships[0];
    if (current?.role !== "administrador") fail(403, "Somente administradores podem gerar links de senha.");
    email = normalizeEmail(email);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [target] } = await client.query(`SELECT u.id FROM app_users u
        JOIN organization_memberships m ON m.user_id = u.id
        WHERE lower(u.email) = $1 AND u.status = 'Ativo' AND m.status = 'Ativo'
        AND m.organization_id = $2 FOR UPDATE OF u`, [email, current.organization_id]);
      if (!target) fail(403, "Selecione um membro ativo desta empresa.");
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 72 * 3600_000).toISOString();
      // Novo link invalida os anteriores dessa pessoa, inclusive os de outra empresa.
      await client.query("UPDATE railway_password_tokens SET used_at = CURRENT_TIMESTAMP WHERE email = $1 AND used_at IS NULL", [email]);
      await client.query(`INSERT INTO railway_password_tokens
        (token_hash, email, organization_id, expires_at, created_by) VALUES ($1, $2, $3, $4, $5)`,
      [passwordTokenHash(token), email, current.organization_id, expiresAt, actor]);
      await client.query("COMMIT");
      const url = new URL("/__auth/definir-senha", origin);
      url.searchParams.set("token", token);
      return { url: url.href, expiresAt };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setPassword(token, password) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(token ?? ""))) fail(400, INVALID_LINK);
    if (!validPassword(password)) fail(400, "A senha deve ter no mínimo 10 caracteres e no máximo 1024 bytes.");
    const tokenHash = passwordTokenHash(token);
    const { rows: [pending] } = await this.pool.query(`SELECT email FROM railway_password_tokens
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`, [tokenHash]);
    if (!pending) fail(400, INVALID_LINK);
    const passwordHash = await hashPassword(password);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Todos os emissores/consumidores bloqueiam primeiro o usuário para evitar replay.
      await client.query("SELECT id FROM app_users WHERE lower(email) = $1 FOR UPDATE", [pending.email]);
      const { rows: [used] } = await client.query(`UPDATE railway_password_tokens t
        SET used_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND used_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP AND EXISTS (
          SELECT 1 FROM app_users u JOIN organization_memberships m ON m.user_id = u.id
          JOIN organizations o ON o.id = m.organization_id
          WHERE lower(u.email) = t.email AND u.status = 'Ativo' AND m.status = 'Ativo'
          AND m.organization_id = t.organization_id AND o.status = 'Ativa'
        ) RETURNING email`, [tokenHash]);
      if (!used) fail(400, INVALID_LINK);
      await client.query(`INSERT INTO railway_user_credentials (email, password_hash, session_version)
        VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash, session_version = EXCLUDED.session_version,
        updated_at = CURRENT_TIMESTAMP`, [used.email, passwordHash, randomUUID()]);
      await client.query("UPDATE railway_password_tokens SET used_at = CURRENT_TIMESTAMP WHERE email = $1 AND used_at IS NULL", [used.email]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

// Colaboradores convidados por processo (Railway/Node).
//
// Quem é da equipe convida alguém de fora (despachante, agente, fornecedor, cliente) para um
// processo. A pessoa recebe um link para criar a senha e só enxerga os processos para os quais
// foi convidada: o perfil "convidado" é travado aqui no servidor (guestGate) e de novo nas
// rotas do app (lib/security.ts → assertOperationAccess).
import { randomBytes } from "node:crypto";
import { readCookie } from "./auth.mjs";
import { normalizeEmail, passwordTokenHash } from "./user-credentials.mjs";

const STAFF_ROLES = new Set(["administrador", "analista"]);
export const GUEST_ROLE = "convidado";
const LINK_HOURS = 72;

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export class Collaborators {
  constructor(pool, credentials) {
    this.pool = pool;
    this.credentials = credentials;
  }

  async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS operation_collaborators (
      id serial PRIMARY KEY, organization_id integer NOT NULL, operation_id integer NOT NULL,
      email text NOT NULL, full_name text NOT NULL DEFAULT '', role_label text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'Convite enviado', invited_by text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, accepted_at timestamptz,
      UNIQUE (operation_id, email)
    )`);
  }

  /** Membro atual (empresa do cookie) de quem está logado. */
  async actor(email, cookieHeader) {
    const memberships = await this.credentials.memberships(email);
    const requested = Number(readCookie(cookieHeader, "exportatrust_org"));
    const current = memberships.find((item) => item.organization_id === requested) ?? memberships[0];
    return current ? { email, organizationId: current.organization_id, role: current.role } : null;
  }

  /** Convidado: lista de processos liberados; null para quem é da equipe. */
  async guestAccess(email, cookieHeader) {
    const actor = await this.actor(email, cookieHeader);
    if (!actor || actor.role !== GUEST_ROLE) return null;
    const { rows } = await this.pool.query(`SELECT c.operation_id, o.reference FROM operation_collaborators c
      JOIN operations o ON o.id = c.operation_id AND o.organization_id = c.organization_id
      WHERE c.organization_id = $1 AND lower(c.email) = $2 AND c.status <> 'Removido' ORDER BY c.id`, [actor.organizationId, email]);
    if (rows.length) {
      await this.pool.query(`UPDATE operation_collaborators SET status = 'Ativo', accepted_at = COALESCE(accepted_at, CURRENT_TIMESTAMP)
        WHERE organization_id = $1 AND lower(email) = $2 AND status = 'Convite enviado'`, [actor.organizationId, email]);
    }
    return { organizationId: actor.organizationId, operations: rows.map((row) => ({ id: Number(row.operation_id), reference: row.reference })) };
  }

  async staff(email, cookieHeader) {
    const actor = await this.actor(email, cookieHeader);
    if (!actor || !STAFF_ROLES.has(actor.role)) fail(403, "Somente a equipe pode convidar colaboradores.");
    return actor;
  }

  async list(operationId, email, cookieHeader) {
    const actor = await this.staff(email, cookieHeader);
    // Convidados que já têm acesso em outros processos: um clique os acrescenta a este, sem novo convite.
    const { rows: known } = await this.pool.query(`SELECT DISTINCT ON (lower(c.email)) c.email, c.full_name AS "fullName", c.role_label AS "roleLabel"
      FROM operation_collaborators c JOIN app_users u ON lower(u.email) = lower(c.email) AND u.status = 'Ativo'
      JOIN organization_memberships m ON m.user_id = u.id AND m.organization_id = c.organization_id AND m.status = 'Ativo'
      WHERE c.organization_id = $1 AND c.status <> 'Removido' AND NOT EXISTS (
        SELECT 1 FROM operation_collaborators x WHERE x.organization_id = $1 AND x.operation_id = $2 AND lower(x.email) = lower(c.email) AND x.status <> 'Removido')
      ORDER BY lower(c.email), c.id DESC LIMIT 50`, [actor.organizationId, Number(operationId)]);
    const { rows } = await this.pool.query(`SELECT c.email, c.full_name AS "fullName", c.role_label AS "roleLabel", c.status,
      c.invited_by AS "invitedBy", c.created_at AS "createdAt", c.accepted_at AS "acceptedAt"
      FROM operation_collaborators c WHERE c.organization_id = $1 AND c.operation_id = $2 AND c.status <> 'Removido' ORDER BY c.id`,
    [actor.organizationId, Number(operationId)]);
    return { collaborators: rows, known };
  }

  async invite(input, email, cookieHeader, origin) {
    const actor = await this.staff(email, cookieHeader);
    const operationId = Number(input?.operationId);
    const target = normalizeEmail(input?.email);
    const fullName = String(input?.fullName ?? "").trim().slice(0, 120);
    const roleLabel = String(input?.roleLabel ?? "").trim().slice(0, 60);
    const message = String(input?.message ?? "").trim().slice(0, 2000);
    if (!operationId) fail(400, "Processo inválido.");
    if (target.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) fail(400, "Informe um e-mail válido.");
    if (target === actor.email) fail(400, "Você já participa deste processo.");
    const client = await this.pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      const { rows: [operation] } = await client.query("SELECT id, reference FROM operations WHERE id = $1 AND organization_id = $2", [operationId, actor.organizationId]);
      if (!operation) fail(404, "Processo não encontrado.");
      let { rows: [user] } = await client.query("SELECT id, status FROM app_users WHERE lower(email) = $1 FOR UPDATE", [target]);
      if (!user) ({ rows: [user] } = await client.query("INSERT INTO app_users (email, full_name, identity_provider) VALUES ($1, $2, 'pending') RETURNING id, status", [target, fullName || target]));
      if (user.status !== "Ativo") fail(409, "Este usuário está desativado. Reative-o na tela Equipe.");
      const { rows: [membership] } = await client.query("SELECT id, role, status FROM organization_memberships WHERE organization_id = $1 AND user_id = $2", [actor.organizationId, user.id]);
      // Quem já é da equipe só passa a constar como participante; nunca perde o perfil que tem.
      const isGuest = !membership || membership.role === GUEST_ROLE;
      if (!membership) {
        await client.query("INSERT INTO organization_memberships (organization_id, user_id, role, status, invited_by) VALUES ($1, $2, $3, 'Ativo', $4)", [actor.organizationId, user.id, GUEST_ROLE, actor.email]);
      } else if (membership.status !== "Ativo") {
        if (!isGuest) fail(409, "Este membro da equipe está inativo. Reative-o na tela Equipe.");
        await client.query("UPDATE organization_memberships SET status = 'Ativo' WHERE id = $1", [membership.id]);
      }
      await client.query(`INSERT INTO operation_collaborators (organization_id, operation_id, email, full_name, role_label, status, invited_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (operation_id, email) DO UPDATE SET full_name = EXCLUDED.full_name,
        role_label = EXCLUDED.role_label, status = EXCLUDED.status, invited_by = EXCLUDED.invited_by`,
      [actor.organizationId, operationId, target, fullName, roleLabel, isGuest ? "Convite enviado" : "Ativo", actor.email]);
      // Link para criar a senha só para quem ainda não tem acesso próprio.
      let link = "";
      const { rows: [credential] } = await client.query("SELECT 1 FROM railway_user_credentials WHERE email = $1", [target]);
      if (isGuest && !credential) {
        const token = randomBytes(32).toString("base64url");
        await client.query("UPDATE railway_password_tokens SET used_at = CURRENT_TIMESTAMP WHERE email = $1 AND used_at IS NULL", [target]);
        await client.query(`INSERT INTO railway_password_tokens (token_hash, email, organization_id, expires_at, created_by)
          VALUES ($1, $2, $3, $4, $5)`, [passwordTokenHash(token), target, actor.organizationId, new Date(Date.now() + LINK_HOURS * 3600_000).toISOString(), actor.email]);
        const url = new URL("/__auth/definir-senha", origin);
        url.searchParams.set("token", token);
        link = url.href;
      } else {
        // Já tem acesso próprio: entra no processo na hora, sem novo convite.
        await client.query("UPDATE operation_collaborators SET status = 'Ativo', accepted_at = COALESCE(accepted_at, CURRENT_TIMESTAMP) WHERE operation_id = $1 AND email = $2", [operationId, target]);
      }
      await client.query("COMMIT");
      result = { reference: operation.reference, link, guest: isGuest };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const processUrl = new URL(`/pedidos/${operationId}`, origin).href;
    const delivery = await sendInviteEmail({ to: target, fullName, inviter: actor.email, reference: result.reference, message, link: result.link, processUrl });
    return { ok: true, email: target, guest: result.guest, included: !result.link, emailed: delivery.sent, emailError: delivery.error, link: delivery.sent ? "" : (result.link || processUrl), expiresHours: LINK_HOURS };
  }

  async remove(input, email, cookieHeader) {
    const actor = await this.staff(email, cookieHeader);
    const operationId = Number(input?.operationId);
    const target = normalizeEmail(input?.email);
    const { rowCount } = await this.pool.query(`UPDATE operation_collaborators SET status = 'Removido'
      WHERE organization_id = $1 AND operation_id = $2 AND lower(email) = $3`, [actor.organizationId, operationId, target]);
    if (!rowCount) fail(404, "Participante não encontrado.");
    // Convidado sem nenhum outro processo perde o acesso à empresa.
    await this.pool.query(`UPDATE organization_memberships m SET status = 'Inativo' FROM app_users u
      WHERE m.user_id = u.id AND lower(u.email) = $2 AND m.organization_id = $1 AND m.role = $3
      AND NOT EXISTS (SELECT 1 FROM operation_collaborators c WHERE c.organization_id = $1 AND lower(c.email) = $2 AND c.status <> 'Removido')`,
    [actor.organizationId, target, GUEST_ROLE]);
    return { ok: true };
  }
}

/** E-mail do convite pelo Resend (mesmas variáveis do Shipment Advice). Sem configuração, devolve o link para copiar. */
async function sendInviteEmail({ to, fullName, inviter, reference, message, link, processUrl }) {
  const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
  const from = String(process.env.EMAIL_FROM ?? "").trim();
  if (!apiKey || !from) return { sent: false, error: "E-mail não configurado (RESEND_API_KEY / EMAIL_FROM)." };
  // Quem já tem acesso recebe só o aviso de que agora faz parte do processo (sem novo convite).
  const intro = link ? `convidou você para trabalhar no processo` : `incluiu você no processo`;
  const action = link ? `Crie sua senha (link válido por ${LINK_HOURS} horas): ${link}` : `Você agora faz parte deste processo. Acesse com o seu login: ${processUrl}`;
  const text = [`Olá${fullName ? ` ${fullName}` : ""},`, "", `${inviter} ${intro} ${reference} no ExportaTrust.`, message ? `\n${message}\n` : "", action, "", "Você verá apenas os processos em que participa: etapas, documentos e comentários da equipe."].join("\n");
  const html = `<p>Olá${fullName ? ` ${escapeHtml(fullName)}` : ""},</p><p><b>${escapeHtml(inviter)}</b> ${intro} <b>${escapeHtml(reference)}</b> no ExportaTrust.${link ? "" : " Você agora faz parte deste processo."}</p>${message ? `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>` : ""}<p><a href="${escapeHtml(link || processUrl)}">${link ? "Criar minha senha e entrar" : "Abrir o processo"}</a></p><p style="color:#6b7280;font-size:13px">Você verá apenas os processos em que participa: etapas, documentos e comentários da equipe.${link ? ` O link vale ${LINK_HOURS} horas.` : ""}</p>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: link ? `Convite para o processo ${reference} · ExportaTrust` : `Você agora faz parte do processo ${reference} · ExportaTrust`, text, html }),
    });
    if (!response.ok) return { sent: false, error: `Resend respondeu ${response.status}.` };
    return { sent: true, error: "" };
  } catch {
    return { sent: false, error: "Falha ao conectar no Resend." };
  }
}

/**
 * Trava do convidado: só as páginas e APIs dos processos liberados. Devolve null quando a
 * requisição pode seguir para o app, ou uma resposta { status, body, headers } para enviar.
 */
export function guestGate(method, url, operations) {
  const ids = new Set(operations.map((operation) => operation.id));
  const path = url.pathname;
  const id = Number(url.searchParams.get("operationId"));
  const json = { "content-type": "application/json; charset=utf-8" };
  const deny = { status: 403, body: JSON.stringify({ error: "Acesso de convidado: somente os processos para os quais você foi convidado." }), headers: json };
  if (path.startsWith("/api/")) {
    if (path === "/api/export-control" && method === "GET" && ids.has(id) && !url.searchParams.has("document")) return null;
    if (path === "/api/export-control" && method === "POST") return null; // a rota aceita só etapas e tarefas do processo liberado
    if (path === "/api/documents" && method === "GET" && (ids.has(id) || url.searchParams.has("documentId"))) return null;
    if (path === "/api/documents" && method === "POST") return null; // a rota confere o processo do formulário
    if (path === "/api/documents" && method === "DELETE") return null; // a rota confere o processo do arquivo
    if (path === "/api/operation-activity" && method === "GET" && ids.has(id)) return null;
    if (path === "/api/operation-activity" && method === "POST") return null; // a rota confere o processo do corpo
    return deny;
  }
  const match = /^\/pedidos\/(\d+)\/?$/.exec(path);
  if (match && ids.has(Number(match[1]))) return null;
  if (path.startsWith("/legal/") || path.startsWith("/_vinext") || path.startsWith("/_next")) return null;
  if (operations.length === 1) return { status: 303, body: "", headers: { location: `/pedidos/${operations[0].id}` } };
  return { status: 200, body: guestHome(operations), headers: { "content-type": "text/html; charset=utf-8" } };
}

function guestHome(operations) {
  const items = operations.map((operation) => `<li><a href="/pedidos/${operation.id}">${escapeHtml(operation.reference)}</a></li>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seus processos · ExportaTrust</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#f3f4f6;color:#111827}main{max-width:560px;margin:48px auto;padding:0 16px}section{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px}h1{font-size:20px;margin:0 0 6px}p{color:#4b5563;font-size:14px;margin:0 0 14px}ul{margin:0;padding:0;list-style:none}li{border-top:1px solid #f0f1f3}a{display:block;padding:12px 0;color:#1d4ed8;font-weight:500;text-decoration:none}footer{margin-top:14px;font-size:13px}footer a{display:inline;padding:0;color:#4b5563}</style></head>
<body><main><section><h1>Seus processos</h1><p>Você foi convidado para trabalhar nestes processos.</p><ul>${items || "<li><p style=\"padding:12px 0\">Nenhum processo liberado no momento.</p></li>"}</ul></section><footer><a href="/__auth/logout">Sair</a></footer></main></body></html>`;
}

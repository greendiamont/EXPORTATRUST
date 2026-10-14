// Login do runtime Railway.
//
// Fora do ChatGPT Sites/Cloudflare Access não existe provedor de identidade
// injetando cabeçalhos confiáveis. Este módulo:
//  1. remove de TODA requisição os cabeçalhos de identidade vindos do cliente
//     (seriam falsificáveis: oai-*, cf-access-*, x-exportatrust-*);
//  2. autentica por e-mail autorizado + senha de acesso do ambiente e grava
//     um cookie de sessão assinado (HMAC-SHA256);
//  3. com sessão válida, injeta x-exportatrust-authenticated-user-email, que o
//     app já reconhece em lib/security.ts.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "exportatrust_session";
const SESSION_TTL_SECONDS = Number(process.env.EXPORTATRUST_SESSION_TTL_HOURS ?? 12) * 3600;

const IDENTITY_HEADER_PATTERNS = [/^oai-authenticated-/i, /^cf-access-/i, /^x-exportatrust-/i];

export function authConfig() {
  const allowedEmails = (process.env.EXPORTATRUST_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const password = process.env.EXPORTATRUST_ACCESS_PASSWORD ?? "";
  const secret = process.env.EXPORTATRUST_SESSION_SECRET ?? "";
  const problems = [];
  if (!allowedEmails.length) problems.push("EXPORTATRUST_ALLOWED_EMAILS");
  if (password.length < 12) problems.push("EXPORTATRUST_ACCESS_PASSWORD (mínimo 12 caracteres)");
  if (secret.length < 32) problems.push("EXPORTATRUST_SESSION_SECRET (mínimo 32 caracteres)");
  return { allowedEmails, password, secret, ready: problems.length === 0, problems };
}

export function stripIdentityHeaders(headers) {
  for (const name of Object.keys(headers)) {
    if (IDENTITY_HEADER_PATTERNS.some((pattern) => pattern.test(name))) delete headers[name];
  }
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createSessionCookie(email, config, secure) {
  const payload = Buffer.from(JSON.stringify({ e: email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })).toString("base64url");
  const value = `${payload}.${sign(payload, config.secret)}`;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function readCookie(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

/** Retorna o e-mail da sessão válida ou null. */
export function sessionEmail(cookieHeader, config) {
  if (!config.ready) return null;
  const value = readCookie(cookieHeader, SESSION_COOKIE);
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload, config.secret))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.e !== "string" || typeof data.exp !== "number" || data.exp < Date.now() / 1000) return null;
    // Remover o e-mail da lista revoga a sessão imediatamente.
    return config.allowedEmails.includes(data.e) ? data.e : null;
  } catch {
    return null;
  }
}

export function verifyCredentials(email, password, config) {
  if (!config.ready) return false;
  const normalized = String(email ?? "").trim().toLowerCase();
  const passwordOk = safeEqual(String(password ?? ""), config.password);
  return passwordOk && config.allowedEmails.includes(normalized);
}

// Limite simples de tentativas por IP (memória do processo).
const attempts = new Map();
export function allowLoginAttempt(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((time) => now - time < 15 * 60_000);
  if (recent.length >= 10) {
    attempts.set(ip, recent);
    return false;
  }
  recent.push(now);
  attempts.set(ip, recent);
  if (attempts.size > 10_000) attempts.clear();
  return true;
}

export function safeNextPath(value) {
  const next = String(value ?? "/");
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && !next.startsWith("/__auth") ? next : "/";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function loginPage({ next = "/", error = "", environment = "", unavailable = [] } = {}) {
  const badge = environment && environment !== "production" ? `<span class="badge">${escapeHtml(environment)}</span>` : "";
  const body = unavailable.length
    ? `<p class="error" role="alert">Login indisponível: configure ${unavailable.map(escapeHtml).join(", ")} no serviço.</p>`
    : `<form method="post" action="/__auth/login">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" autocomplete="username" required autofocus>
        <label for="password">Senha de acesso</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
        <button type="submit">Entrar</button>
      </form>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar · ExportaTrust</title><link rel="icon" href="/favicon.svg">
<style>
:root{color-scheme:light dark;--bg:#f3f7f5;--card:#fff;--text:#20362d;--muted:#60756c;--brand:#086c55;--border:#d8e5df;--error:#a3271f}
@media (prefers-color-scheme:dark){:root{--bg:#0f1714;--card:#17221e;--text:#e5efea;--muted:#9fb3aa;--brand:#3fb38f;--border:#2a3a33;--error:#ff8f86}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:380px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px}
h1{margin:0 0 4px;font-size:20px;letter-spacing:.5px;color:var(--brand)}p.sub{margin:0 0 20px;color:var(--muted)}
.badge{display:inline-block;margin-left:8px;padding:2px 8px;border-radius:99px;background:#f5c542;color:#3a2c00;font-size:11px;font-weight:700;text-transform:uppercase;vertical-align:middle}
label{display:block;margin:14px 0 6px;font-weight:600}input{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:inherit;font:inherit}
input:focus-visible,button:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
button{margin-top:20px;width:100%;padding:11px;border:0;border-radius:8px;background:var(--brand);color:#fff;font:inherit;font-weight:700;cursor:pointer}
.error{color:var(--error);margin:14px 0 0}
</style></head><body><main><h1>EXPORTATRUST${badge}</h1><p class="sub">Acesso restrito à equipe autorizada.</p>${body}</main></body></html>`;
}

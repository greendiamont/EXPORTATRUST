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

// Só cabeçalhos de identidade: outros x-exportatrust-* (metadados da importação R2,
// esquema da API de agentes) são dados legítimos do cliente.
const IDENTITY_HEADER_PATTERNS = [/^oai-authenticated-/i, /^cf-access-/i, /^x-exportatrust-authenticated-/i, /^x-exportatrust-auth-provider$/i];

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

export function createSessionCookie(email, config, secure, version, googleSubject) {
  const payload = Buffer.from(JSON.stringify({ e: email, ...(version ? { v: version } : {}), ...(googleSubject ? { g: googleSubject } : {}), exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })).toString("base64url");
  const value = `${payload}.${sign(payload, config.secret)}`;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function readCookie(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

/** Retorna o e-mail da sessão válida ou null. */
export function readSession(cookieHeader, config) {
  if (!config.ready) return null;
  const value = readCookie(cookieHeader, SESSION_COOKIE);
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined || !safeEqual(signature, sign(payload, config.secret))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.e !== "string" || typeof data.exp !== "number" || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

/** Compatibilidade do bootstrap; sessões individuais exigem validação no banco. */
export function sessionEmail(cookieHeader, config) {
  const data = readSession(cookieHeader, config);
  return data && !data.v && !data.g && config.allowedEmails.includes(data.e) ? data.e : null;
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

function passwordField(id, label, autocomplete) {
  return `<label for="${id}">${label}</label><div class="password-field">
    <input id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" ${autocomplete === "new-password" ? 'minlength="10"' : ""} required>
    <button class="password-toggle" type="button" data-password-target="${id}" aria-controls="${id}" aria-label="Mostrar ${label.toLowerCase()}" aria-pressed="false">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
    </button></div>`;
}

export const passwordVisibilityScript = `document.addEventListener('click', function(event) {
  const button = event.target.closest('[data-password-target]');
  if (!button) return;
  const input = document.getElementById(button.dataset.passwordTarget);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(show));
  button.setAttribute('aria-label', (show ? 'Ocultar ' : 'Mostrar ') + (input.id === 'confirm' ? 'confirmação de senha' : 'senha'));
});`;

export function loginPage({ next = "/", error = "", environment = "", unavailable = [], content, googleReady = false } = {}) {
  const badge = environment && environment !== "production" ? `<span class="badge">${escapeHtml(environment)}</span>` : "";
  const googleButton = googleReady
    ? `<p><a class="google-login" href="/__auth/google/start?next=${escapeHtml(encodeURIComponent(next))}">Entrar com Google</a></p><p class="sub">Ou use seu e-mail e senha individual:</p>`
    : '<p><button type="button" disabled>Entrar com Google</button></p><p class="sub">Login com Google em configuração. O acesso por senha continua disponível.</p>';
  const body = content ?? (googleButton + (unavailable.length
    ? `<p class="error" role="alert">Login indisponível: configure ${unavailable.map(escapeHtml).join(", ")} no serviço.</p>`
    : `<form method="post" action="/__auth/login">
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" autocomplete="username" required autofocus>
        ${passwordField("password", "Senha de acesso", "current-password")}
        ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
        <button type="submit">Entrar</button>
      </form><p>Primeiro acesso? <a href="/__auth/cadastrar">Cadastrar e-mail</a></p>`));
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
.password-field{position:relative}.password-field input{padding-right:52px}.password-toggle{position:absolute;right:1px;top:1px;width:44px;min-height:42px;margin:0;padding:9px;background:transparent;color:var(--text);border-radius:7px}.password-toggle[aria-pressed="true"]{background:var(--border)}
.google-login{display:block;text-align:center;padding:11px;border:1px solid var(--border);border-radius:8px;color:var(--text);font-weight:600;text-decoration:none}button:disabled{opacity:.5;cursor:not-allowed}
</style><script src="/__auth/password-visibility.js" defer></script></head><body><main><h1>EXPORTATRUST${badge}</h1><p class="sub">Acesso à sua empresa.</p>${body}</main></body></html>`;
}

export function passwordPage({ token = "", error = "", environment = "", success = false } = {}) {
  const content = success
    ? '<p role="status">Senha definida. Entre com seu e-mail e sua nova senha.</p><p><a href="/__auth/login">Ir para o login</a></p>'
    : `<h2>Definir senha individual</h2><p>Use no mínimo 10 caracteres. O link só pode ser utilizado uma vez.</p>
      <form method="post" action="/__auth/definir-senha">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      ${passwordField("password", "Nova senha", "new-password")}
      ${passwordField("confirm", "Confirmar senha", "new-password")}
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
      <button type="submit">Salvar senha</button></form><p><a href="/__auth/login">Voltar ao login</a></p>`;
  return loginPage({ environment, content });
}

export function isSameOrigin(origin, expected) {
  try { return new URL(origin).origin === new URL(expected).origin; } catch { return false; }
}

export function registrationPage({ environment = "", error = "", success = false, mode = "company", values = {} } = {}) {
  const team = mode === "team";
  const content = success
    ? '<h2>Solicitação registrada</h2><p role="status">Se o CNPJ estiver cadastrado, o administrador verá sua solicitação em Cadastros → Equipe. Aguarde o link privado para criar sua senha. Nenhum e-mail foi enviado automaticamente.</p><p><a href="/__auth/login">Voltar para entrar</a></p>'
    : `<h2>${team ? "Entrar na equipe" : "Cadastrar empresa"}</h2><p>${team ? "Informe o CNPJ da empresa e solicite sua liberação ao administrador." : "Crie a empresa e seu primeiro acesso como administrador. O CNPJ será o identificador da equipe."}</p>
      <form method="post" action="/__auth/cadastrar">
      <input type="hidden" name="mode" value="${team ? "team" : "company"}">
      <label for="cnpj">CNPJ da empresa</label><input id="cnpj" name="cnpj" inputmode="numeric" placeholder="00.000.000/0000-00" maxlength="18" value="${escapeHtml(values.cnpj ?? "")}" required>
      ${team ? "" : `<label for="companyName">Nome da empresa</label><input id="companyName" name="companyName" autocomplete="organization" maxlength="160" value="${escapeHtml(values.companyName ?? "")}" required>`}
      <label for="name">Seu nome completo</label><input id="name" name="name" autocomplete="name" maxlength="120" value="${escapeHtml(values.name ?? "")}" required>
      <label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" maxlength="254" value="${escapeHtml(values.email ?? "")}" required>
      ${team ? "" : `<p>Crie uma senha com pelo menos 10 caracteres.</p>${passwordField("password", "Senha", "new-password")}${passwordField("confirm", "Confirmar senha", "new-password")}`}
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
      <button type="submit">${team ? "Solicitar acesso" : "Criar empresa e entrar"}</button></form>
      <p><a href="/__auth/cadastrar${team ? "" : "?mode=team"}">${team ? "Cadastrar uma empresa nova" : "Minha empresa já está cadastrada — solicitar acesso"}</a></p>
      <p>Já tem conta? <a href="/__auth/login">Entrar</a></p>`;
  return loginPage({ environment, content });
}

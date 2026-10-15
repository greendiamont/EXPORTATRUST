// Servidor de produção do ExportaTrust no Railway (Node).
//
// Executa o mesmo build do vinext usado no Cloudflare (dist/), fornecendo:
//  - `cloudflare:workers` com DB → PostgreSQL e BUCKET → storage S3 (hooks.mjs);
//  - migrações SQLite→PostgreSQL na inicialização (migrate.mjs);
//  - login próprio e remoção de cabeçalhos de identidade falsificáveis (auth.mjs);
//  - arquivos estáticos de dist/client.
//
// Uso: node server/railway/server.mjs   (após `npm run build`)

import { register } from "node:module";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

register("./hooks.mjs", import.meta.url);

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const distDir = path.resolve(process.env.EXPORTATRUST_DIST_DIR ?? path.join(root, "dist"));
const clientDir = path.join(distDir, "client");
const entryPath = path.join(distDir, "server", "index.js");
const port = Number(process.env.PORT ?? 8080);
const appEnv = process.env.APP_ENV ?? "development";
const allowPreviewHosts = process.env.EXPORTATRUST_ALLOW_PREVIEW_HOSTS === "1" && appEnv !== "production";

const { nodeToWebRequest, sendWebResponse, tryServeStatic } = await import("vinext/server/prod-server");
const auth = await import("./auth.mjs");
const { UserCredentials } = await import("./user-credentials.mjs");
const { GoogleLogin, googleLoginConfig, clearGoogleCookie } = await import("./google-login.mjs");
const { bindings, env } = await import("./cloudflare-workers-shim.mjs");

if (!existsSync(entryPath)) {
  console.error(`[railway] build não encontrado em ${entryPath}. Rode \`npm run build\` antes.`);
  process.exit(1);
}

if (!bindings.DB) console.warn("[railway] DATABASE_URL ausente: rotas com banco vão falhar.");
if (!bindings.BUCKET) console.warn("[railway] storage S3 não configurado (STORAGE_S3_*): documentos vão falhar.");

if (bindings.DB && process.env.RUN_MIGRATIONS !== "0") {
  const { migrate } = await import("./migrate.mjs");
  await migrate({ connectionString: process.env.DATABASE_URL, migrationsDir: path.join(root, "drizzle") });
}

const credentials = bindings.DB ? new UserCredentials(bindings.DB.pool) : null;
if (credentials) await credentials.initialize();

if (bindings.BUCKET && process.env.STORAGE_SELF_TEST !== "0") {
  // Diagnóstico não fatal: confirma escrita/leitura/remoção no storage.
  const key = "_railway/startup-check.txt";
  const marker = `ok ${new Date().toISOString()}`;
  try {
    await bindings.BUCKET.put(key, marker, { httpMetadata: { contentType: "text/plain" } });
    const read = await bindings.BUCKET.get(key);
    const text = await read?.text();
    await bindings.BUCKET.delete(key);
    console.log(text === marker ? "[storage] autoteste OK (put/get/delete)" : "[storage] autoteste FALHOU: conteúdo divergente");
  } catch (error) {
    console.error("[storage] autoteste FALHOU:", error instanceof Error ? error.message : error);
  }
}

const worker = (await import(pathToFileURL(entryPath).href)).default;
if (!worker || typeof worker.fetch !== "function") {
  console.error("[railway] dist/server/index.js não exporta um Worker com fetch().");
  process.exit(1);
}

const authConfig = auth.authConfig();
const googleConfig = googleLoginConfig();
const google = credentials && authConfig.ready && googleConfig.ready ? new GoogleLogin(googleConfig, authConfig.secret) : null;
const loginPage = (options) => auth.loginPage({ ...options, googleReady: Boolean(google) });
if (!authConfig.ready) console.warn(`[railway] login desabilitado até configurar: ${authConfig.problems.join(", ")}`);

const PREVIEW_HOST = /localhost|127\.0\.0\.1|terminal\.local/i;

function isSecure(req) {
  return String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https";
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", ...headers });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  send(res, 303, "", { location, ...headers });
}

async function readFormText(req, limit = 16 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readForm(req) {
  return new URLSearchParams(await readFormText(req));
}

async function currentEmail(req) {
  return credentials ? credentials.sessionIdentity(req.headers.cookie, authConfig) : auth.sessionEmail(req.headers.cookie, authConfig);
}

async function handleAuthRoute(req, res, url, origin) {
  const secure = isSecure(req);
  const html = { "content-type": "text/html; charset=utf-8" };
  const json = { "content-type": "application/json; charset=utf-8" };
  if (url.pathname === "/__auth/google/start" || url.pathname === "/__auth/google/callback") {
    if (req.method !== "GET") return send(res, 405, "Method Not Allowed", { allow: "GET" });
    if (!google) return send(res, 503, loginPage({ environment: appEnv, error: "O login com Google ainda não foi configurado." }), html);
    // A origem é explícita na configuração OAuth; não confia no Host recebido.
    if (origin !== new URL(googleConfig.redirectUri).origin) return send(res, 400, "Origem de login inválida.");
    if (!auth.allowLoginAttempt(`google:${clientIp(req)}`)) return send(res, 429, "Muitas tentativas. Aguarde alguns minutos.");
    if (url.pathname === "/__auth/google/start") {
      const started = await google.start(url.searchParams.get("next"), secure);
      return redirect(res, started.url, { "set-cookie": started.cookie });
    }
    try {
      const result = await google.finish(url.searchParams, req.headers.cookie);
      const bootstrap = appEnv === "homologation" ? process.env.GOOGLE_LOGIN_BOOTSTRAP_EMAIL ?? "" : "";
      const identity = await credentials.authorizeGoogle(result.identity, bootstrap);
      if (!identity) return send(res, 403, loginPage({ environment: appEnv, error: "Sua conta Google foi identificada, mas não tem acesso ativo à empresa. Solicite liberação ao administrador." }), { ...html, "set-cookie": clearGoogleCookie(secure) });
      return redirect(res, result.next, { "set-cookie": [clearGoogleCookie(secure), auth.createSessionCookie(identity.email, authConfig, secure, undefined, identity.subject)] });
    } catch {
      // Não registrar erros do provedor: podem conter códigos, tokens ou secrets.
      return send(res, 401, loginPage({ environment: appEnv, error: "Não foi possível entrar com Google. Tente novamente pelo botão de login." }), { ...html, "set-cookie": clearGoogleCookie(secure) });
    }
  }
  // O browser envia Origin nos POSTs do formulário e de fetch; recusa CSRF.
  if (req.method === "POST" && !auth.isSameOrigin(req.headers.origin, origin)) {
    return send(res, 403, JSON.stringify({ error: "Origem da requisição não autorizada." }), json);
  }
  if (url.pathname === "/__auth/capabilities") {
    if (req.method !== "GET") return send(res, 405, "Method Not Allowed", { allow: "GET" });
    if (!await currentEmail(req)) return send(res, 401, JSON.stringify({ error: "Autenticação obrigatória." }), json);
    return send(res, 200, JSON.stringify({ individualPasswords: Boolean(credentials && authConfig.ready) }), json);
  }
  if (url.pathname === "/__auth/invite-link") {
    if (req.method !== "POST") return send(res, 405, "Method Not Allowed", { allow: "POST" });
    if (!credentials || !authConfig.ready) return send(res, 503, JSON.stringify({ error: "Login individual indisponível." }), json);
    if (!await currentEmail(req)) return send(res, 401, JSON.stringify({ error: "Autenticação obrigatória." }), json);
    if (!auth.allowLoginAttempt(`invite:${clientIp(req)}`)) return send(res, 429, JSON.stringify({ error: "Muitas tentativas. Aguarde alguns minutos." }), json);
    let body;
    try { body = JSON.parse((await readFormText(req))); } catch {
      return send(res, 400, JSON.stringify({ error: "Requisição inválida ou muito grande." }), json);
    }
    try {
      const result = await credentials.issueLink(body?.email, req.headers.cookie, authConfig, origin);
      return send(res, 200, JSON.stringify(result), json);
    } catch (error) {
      if (!error.status) console.error("[auth] falha ao gerar link de senha");
      return send(res, error.status ?? 500, JSON.stringify({ error: error.status ? error.message : "Não foi possível gerar o link." }), json);
    }
  }
  if (url.pathname === "/__auth/definir-senha") {
    const privacy = { ...html, "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
    if (!credentials || !authConfig.ready) return send(res, 503, auth.passwordPage({ environment: appEnv, error: "Login individual indisponível." }), privacy);
    if (req.method === "GET" || req.method === "HEAD") {
      return send(res, 200, auth.passwordPage({ token: url.searchParams.get("token") ?? "", environment: appEnv, success: url.searchParams.get("success") === "1" }), privacy);
    }
    if (req.method !== "POST") return send(res, 405, "Method Not Allowed", { allow: "GET, POST" });
    if (!auth.allowLoginAttempt(`password:${clientIp(req)}`)) return send(res, 429, auth.passwordPage({ environment: appEnv, error: "Muitas tentativas. Aguarde alguns minutos." }), privacy);
    let form;
    try { form = await readForm(req); } catch { return send(res, 413, "Payload Too Large"); }
    const token = form.get("token") ?? "";
    try {
      if (form.get("password") !== form.get("confirm")) throw Object.assign(new Error("As senhas não coincidem."), { status: 400 });
      await credentials.setPassword(token, form.get("password"));
      return redirect(res, "/__auth/definir-senha?success=1", { "set-cookie": auth.clearSessionCookie(secure) });
    } catch (error) {
      if (!error.status) console.error("[auth] falha ao definir senha individual");
      return send(res, error.status ?? 500, auth.passwordPage({ token, environment: appEnv, error: error.status ? error.message : "Não foi possível salvar a senha. Tente novamente." }), privacy);
    }
  }
  if (url.pathname === "/__auth/logout" || url.pathname === "/signout-with-chatgpt") {
    return redirect(res, "/__auth/login", { "set-cookie": auth.clearSessionCookie(secure) });
  }
  if (url.pathname === "/signin-with-chatgpt") {
    return redirect(res, `/__auth/login?next=${encodeURIComponent(auth.safeNextPath(url.searchParams.get("next") ?? "/"))}`);
  }
  if (url.pathname !== "/__auth/login") return send(res, 404, "Not Found");

  if (req.method === "GET" || req.method === "HEAD") {
    const next = auth.safeNextPath(url.searchParams.get("next"));
    if (await currentEmail(req)) return redirect(res, next);
    return send(res, authConfig.ready ? 200 : 503, loginPage({ next, environment: appEnv, unavailable: authConfig.ready ? [] : authConfig.problems }), html);
  }
  if (req.method !== "POST") return send(res, 405, "Method Not Allowed", { allow: "GET, POST" });

  let form;
  try {
    form = await readForm(req);
  } catch {
    return send(res, 413, "Payload Too Large");
  }
  const next = auth.safeNextPath(form.get("next"));
  if (!authConfig.ready) return send(res, 503, loginPage({ next, environment: appEnv, unavailable: authConfig.problems }), html);
  if (!auth.allowLoginAttempt(clientIp(req))) {
    return send(res, 429, loginPage({ next, environment: appEnv, error: "Muitas tentativas. Aguarde alguns minutos." }), html);
  }
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const identity = credentials
    ? await credentials.authenticate(email, form.get("password"), authConfig)
    : (auth.verifyCredentials(email, form.get("password"), authConfig) ? { email } : null);
  if (!identity) {
    console.warn(`[auth] login recusado para ${email || "(vazio)"} de ${clientIp(req)}`);
    return send(res, 401, loginPage({ next, environment: appEnv, error: "E-mail ou senha inválidos." }), html);
  }
  console.log(`[auth] login de ${email}`);
  return redirect(res, next, { "set-cookie": auth.createSessionCookie(email, authConfig, secure, identity.version) });
}

function wantsPage(req, pathname) {
  if (pathname.startsWith("/api/")) return false;
  return req.method === "GET" || req.method === "HEAD";
}

const ctx = {
  waitUntil(promise) {
    Promise.resolve(promise).catch((error) => console.error("[waitUntil]", error));
  },
  passThroughOnException() {},
};

async function handle(req, res) {
  let url;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    return send(res, 400, "Bad Request");
  }
  const { pathname } = url;
  if (pathname.startsWith("//") || pathname.includes("\\")) return send(res, 404, "Not Found");

  // 1. Nenhuma identidade vem do cliente.
  auth.stripIdentityHeaders(req.headers);
  const requestOrigin = `${isSecure(req) ? "https" : "http"}://${req.headers.host}`;
  // lib/security.ts trata hosts locais como "preview" (admin automático).
  if (!allowPreviewHosts && PREVIEW_HOST.test(String(req.headers.host ?? ""))) req.headers.host = "railway.invalid";

  if (pathname.startsWith("/__auth/") || pathname === "/signin-with-chatgpt" || pathname === "/signout-with-chatgpt") {
    return handleAuthRoute(req, res, url, requestOrigin);
  }

  // 2. Arquivos estáticos públicos (assets com hash, favicon, marca).
  if ((req.method === "GET" || req.method === "HEAD") && pathname !== "/" && !pathname.startsWith("/api/")) {
    if (await tryServeStatic(req, res, clientDir, pathname, true)) return;
  }

  // 3. Sessão → identidade confiável para o app.
  const email = await currentEmail(req);
  if (email) {
    req.headers["x-exportatrust-authenticated-user-email"] = email;
    req.headers["x-exportatrust-authenticated-user-name"] = email;
    req.headers["x-exportatrust-auth-provider"] = "railway-login";
  } else if (wantsPage(req, pathname) && !pathname.startsWith("/legal/")) {
    if (req.headers.rsc || String(req.headers.accept ?? "").includes("text/x-component")) return send(res, 401, "Unauthorized");
    return redirect(res, `/__auth/login?next=${encodeURIComponent(pathname + url.search)}`);
  }
  // Sem sessão, APIs seguem para o app sem identidade: rotas protegidas
  // respondem 401 e rotas públicas por desenho (token Bearer de agentes,
  // links seguros, webhook Stripe, /api/health) continuam funcionando.

  if (pathname === "/_vinext/image") return send(res, 404, "Image optimization indisponível no runtime Node.");

  try {
    const response = await worker.fetch(nodeToWebRequest(req), env, ctx);
    const staticSignal = response.headers.get("x-vinext-static-file");
    if (staticSignal) {
      await response.body?.cancel();
      let staticPath = "/";
      try {
        staticPath = decodeURIComponent(staticSignal);
      } catch {
        staticPath = staticSignal;
      }
      if (await tryServeStatic(req, res, clientDir, staticPath, true, undefined, undefined, response.status)) return;
      return send(res, 404, "Not Found");
    }
    await sendWebResponse(response, req, res, true);
  } catch (error) {
    console.error("[railway] erro ao processar", req.method, pathname, error);
    if (!res.headersSent) send(res, 500, "Internal Server Error");
    else res.destroy();
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error("[railway] falha inesperada", error);
    if (!res.headersSent) send(res, 500, "Internal Server Error");
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[railway] ExportaTrust (${appEnv}) ouvindo em :${port}`);
});

async function shutdown(signal) {
  console.log(`[railway] ${signal} recebido, encerrando...`);
  server.close();
  await bindings.DB?.close().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

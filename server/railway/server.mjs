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
if (!authConfig.ready) console.warn(`[railway] login desabilitado até configurar: ${authConfig.problems.join(", ")}`);

const PREVIEW_HOST = /localhost|127\.0\.0\.1|terminal\.local/i;

function isSecure(req) {
  return String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https";
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  send(res, 303, "", { location, ...headers });
}

async function readForm(req, limit = 16 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("payload too large");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

async function handleAuthRoute(req, res, url) {
  const secure = isSecure(req);
  if (url.pathname === "/__auth/logout" || url.pathname === "/signout-with-chatgpt") {
    return redirect(res, "/__auth/login", { "set-cookie": auth.clearSessionCookie(secure) });
  }
  if (url.pathname === "/signin-with-chatgpt") {
    return redirect(res, `/__auth/login?next=${encodeURIComponent(auth.safeNextPath(url.searchParams.get("next") ?? "/"))}`);
  }
  if (url.pathname !== "/__auth/login") return send(res, 404, "Not Found");

  const html = { "content-type": "text/html; charset=utf-8" };
  if (req.method === "GET" || req.method === "HEAD") {
    const next = auth.safeNextPath(url.searchParams.get("next"));
    if (auth.sessionEmail(req.headers.cookie, authConfig)) return redirect(res, next);
    return send(res, authConfig.ready ? 200 : 503, auth.loginPage({ next, environment: appEnv, unavailable: authConfig.ready ? [] : authConfig.problems }), html);
  }
  if (req.method !== "POST") return send(res, 405, "Method Not Allowed", { allow: "GET, POST" });

  let form;
  try {
    form = await readForm(req);
  } catch {
    return send(res, 413, "Payload Too Large");
  }
  const next = auth.safeNextPath(form.get("next"));
  if (!authConfig.ready) return send(res, 503, auth.loginPage({ next, environment: appEnv, unavailable: authConfig.problems }), html);
  if (!auth.allowLoginAttempt(clientIp(req))) {
    return send(res, 429, auth.loginPage({ next, environment: appEnv, error: "Muitas tentativas. Aguarde alguns minutos." }), html);
  }
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!auth.verifyCredentials(email, form.get("password"), authConfig)) {
    console.warn(`[auth] login recusado para ${email || "(vazio)"} de ${clientIp(req)}`);
    return send(res, 401, auth.loginPage({ next, environment: appEnv, error: "E-mail ou senha inválidos." }), html);
  }
  console.log(`[auth] login de ${email}`);
  return redirect(res, next, { "set-cookie": auth.createSessionCookie(email, authConfig, secure) });
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
  // lib/security.ts trata hosts locais como "preview" (admin automático).
  if (!allowPreviewHosts && PREVIEW_HOST.test(String(req.headers.host ?? ""))) req.headers.host = "railway.invalid";

  if (pathname.startsWith("/__auth/") || pathname === "/signin-with-chatgpt" || pathname === "/signout-with-chatgpt") {
    return handleAuthRoute(req, res, url);
  }

  // 2. Arquivos estáticos públicos (assets com hash, favicon, marca).
  if ((req.method === "GET" || req.method === "HEAD") && pathname !== "/" && !pathname.startsWith("/api/")) {
    if (await tryServeStatic(req, res, clientDir, pathname, true)) return;
  }

  // 3. Sessão → identidade confiável para o app.
  const email = auth.sessionEmail(req.headers.cookie, authConfig);
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

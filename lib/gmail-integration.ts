import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { agentEvents, gmailConnections, gmailOauthConfigs, googleOauthStates, operationDocuments, operations, operationTimeline } from "../db/schema";
import { audit, requireSecurityContext, sha256Hex, type SecurityContext } from "./security";
import { classifyDocument, ensurePrivateAgentTables, sanitize } from "./private-agent-api";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.drafts.create",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  threadId?: string;
  historyId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
};

type TokenPayload = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };

async function runtimeEnv() {
  const { env } = await import("cloudflare:workers");
  return env as unknown as Record<string, unknown> & { DB: D1Database; BUCKET: R2Bucket };
}

async function requiredConfig(context: SecurityContext) {
  const env = await runtimeEnv();
  const clientId = String(env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET ?? "").trim();
  const redirectUri = String(env.GOOGLE_REDIRECT_URI ?? "").trim();
  const encryptionKey = String(env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? "").trim();
  if (!encryptionKey) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY ainda não está configurada no ambiente do ExportaTrust.");
  if (clientId && clientSecret && redirectUri) return { clientId, clientSecret, redirectUri, encryptionKey };
  const db = await getDb();
  const [saved] = await db.select().from(gmailOauthConfigs).where(eq(gmailOauthConfigs.organizationId, context.organizationId)).limit(1);
  if (!saved) throw new Error("Credenciais OAuth do Google ainda não foram cadastradas no ExportaTrust.");
  return { clientId: saved.clientId, clientSecret: await decrypt(saved.clientSecretEncrypted, encryptionKey), redirectUri: saved.redirectUri, encryptionKey };
}

async function encryptionKey(raw: string) {
  const decoded = raw.match(/^[0-9a-f]{64}$/i) ? Uint8Array.from(raw.match(/.{2}/g)!.map((item) => Number.parseInt(item, 16))) : base64ToBytes(raw);
  if (decoded.byteLength !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY deve conter exatamente 32 bytes em base64 ou 64 caracteres hexadecimais.");
  return crypto.subtle.importKey("raw", decoded, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(value: string, rawKey: string) {
  if (!value) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(rawKey), new TextEncoder().encode(value));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decrypt(value: string, rawKey: string) {
  if (!value) return "";
  const [ivText, encryptedText] = value.split(".");
  if (!ivText || !encryptedText) throw new Error("Credencial Gmail armazenada em formato inválido.");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivText) }, await encryptionKey(rawKey), base64ToBytes(encryptedText));
  return new TextDecoder().decode(decrypted);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeBody(value = "") {
  if (!value) return "";
  try { return new TextDecoder().decode(base64ToBytes(value)); } catch { return ""; }
}

function header(part: GmailPart | undefined, name: string) {
  return part?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function flattenParts(part: GmailPart | undefined): GmailPart[] {
  if (!part) return [];
  return [part, ...(part.parts ?? []).flatMap(flattenParts)];
}

function messageText(message: GmailMessage) {
  const parts = flattenParts(message.payload);
  const plain = parts.find((part) => part.mimeType === "text/plain" && part.body?.data);
  const html = parts.find((part) => part.mimeType === "text/html" && part.body?.data);
  const raw = decodeBody(plain?.body?.data || html?.body?.data || message.payload?.body?.data);
  return sanitize(raw.replace(/<[^>]+>/g, " "));
}

async function ensureGmailTables() {
  await ensurePrivateAgentTables();
  const { DB } = await runtimeEnv();
  await DB.batch([
    DB.prepare("CREATE TABLE IF NOT EXISTS gmail_connections (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer NOT NULL, user_id integer NOT NULL, gmail_address text DEFAULT '' NOT NULL, access_token_encrypted text DEFAULT '' NOT NULL, refresh_token_encrypted text DEFAULT '' NOT NULL, access_token_expires_at text, scopes_json text DEFAULT '[]' NOT NULL, history_id text DEFAULT '' NOT NULL, status text DEFAULT 'Ativo' NOT NULL, last_sync_at text, last_error text DEFAULT '' NOT NULL, connected_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, UNIQUE(organization_id,user_id))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS google_oauth_states (state_hash text PRIMARY KEY NOT NULL, organization_id integer NOT NULL, user_id integer NOT NULL, expires_at text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    DB.prepare("CREATE TABLE IF NOT EXISTS gmail_oauth_configs (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer NOT NULL UNIQUE, client_id text NOT NULL, client_secret_encrypted text NOT NULL, redirect_uri text NOT NULL, updated_by text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
  ]);
}

export async function gmailStatus() {
  const context = await requireSecurityContext("read");
  await ensureGmailTables();
  const env = await runtimeEnv();
  const db = await getDb();
  const [savedConfig] = await db.select({ clientId: gmailOauthConfigs.clientId, redirectUri: gmailOauthConfigs.redirectUri, updatedAt: gmailOauthConfigs.updatedAt, updatedBy: gmailOauthConfigs.updatedBy }).from(gmailOauthConfigs).where(eq(gmailOauthConfigs.organizationId, context.organizationId)).limit(1);
  const environmentConfigured = Boolean(String(env.GOOGLE_CLIENT_ID ?? "").trim() && String(env.GOOGLE_CLIENT_SECRET ?? "").trim() && String(env.GOOGLE_REDIRECT_URI ?? "").trim());
  const configured = Boolean(String(env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? "").trim() && (environmentConfigured || savedConfig));
  const [connection] = await db.select({ gmailAddress: gmailConnections.gmailAddress, status: gmailConnections.status, scopesJson: gmailConnections.scopesJson, lastSyncAt: gmailConnections.lastSyncAt, lastError: gmailConnections.lastError, connectedAt: gmailConnections.connectedAt }).from(gmailConnections).where(and(eq(gmailConnections.organizationId, context.organizationId), eq(gmailConnections.userId, context.userId))).limit(1);
  return { configured, connected: connection?.status === "Ativo", connection: connection ?? null, config: savedConfig ? { ...savedConfig, clientIdMasked: `${savedConfig.clientId.slice(0, 8)}…${savedConfig.clientId.slice(-12)}`, secretStored: true, source: "secure_admin" } : environmentConfigured ? { clientIdMasked: "Configurado no ambiente", redirectUri: String(env.GOOGLE_REDIRECT_URI ?? ""), secretStored: true, source: "runtime" } : null, canConfigure: context.role === "administrador", scopes: GMAIL_SCOPES };
}

export async function saveGmailConfig(request: Request) {
  const context = await requireSecurityContext("write");
  if (context.role !== "administrador") return Response.json({ error: "Somente administradores podem alterar credenciais do Google." }, { status: 403 });
  await ensureGmailTables();
  const body = await request.json() as { clientId?: string; clientSecret?: string };
  const clientId = String(body.clientId ?? "").trim();
  const clientSecret = String(body.clientSecret ?? "").trim();
  if (!clientId.endsWith(".apps.googleusercontent.com") || clientId.length > 300) return Response.json({ error: "Client ID do Google inválido." }, { status: 400 });
  const env = await runtimeEnv();
  const key = String(env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? "").trim();
  if (!key) return Response.json({ error: "A chave interna de criptografia ainda não está disponível." }, { status: 503 });
  const db = await getDb();
  const [existing] = await db.select().from(gmailOauthConfigs).where(eq(gmailOauthConfigs.organizationId, context.organizationId)).limit(1);
  if (!clientSecret && !existing) return Response.json({ error: "Informe o Client Secret na primeira configuração." }, { status: 400 });
  if (clientSecret && (clientSecret.length < 8 || clientSecret.length > 500)) return Response.json({ error: "Client Secret do Google inválido." }, { status: 400 });
  const redirectUri = String(env.GOOGLE_REDIRECT_URI ?? "").trim();
  if (!redirectUri) return Response.json({ error: "GOOGLE_REDIRECT_URI ainda não está configurada." }, { status: 503 });
  const now = new Date().toISOString();
  const values = { organizationId: context.organizationId, clientId, clientSecretEncrypted: clientSecret ? await encrypt(clientSecret, key) : existing!.clientSecretEncrypted, redirectUri, updatedBy: context.email, updatedAt: now };
  await db.insert(gmailOauthConfigs).values(values).onConflictDoUpdate({ target: gmailOauthConfigs.organizationId, set: values });
  await audit(context, "GMAIL_OAUTH_CONFIG_UPDATED", "gmail_oauth_config", String(context.organizationId), { clientIdSuffix: clientId.slice(-12), secretChanged: Boolean(clientSecret), redirectUri });
  return Response.json({ saved: true, clientIdMasked: `${clientId.slice(0, 8)}…${clientId.slice(-12)}`, redirectUri });
}

export async function beginGoogleOauth() {
  const context = await requireSecurityContext("write");
  await ensureGmailTables();
  const config = await requiredConfig(context);
  const state = bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, "");
  const stateHash = await sha256Hex(state);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const db = await getDb();
  await db.delete(googleOauthStates).where(eq(googleOauthStates.userId, context.userId));
  await db.insert(googleOauthStates).values({ stateHash, organizationId: context.organizationId, userId: context.userId, expiresAt });
  const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", scope: GMAIL_SCOPES.join(" "), state });
  await audit(context, "GMAIL_OAUTH_STARTED", "gmail_connection", String(context.userId));
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
}

export async function completeGoogleOauth(request: Request) {
  const context = await requireSecurityContext("write");
  await ensureGmailTables();
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const denied = url.searchParams.get("error") ?? "";
  if (denied) return Response.redirect(new URL(`/\?module=Integrações&gmail=error&reason=${encodeURIComponent(denied)}`, request.url), 302);
  if (!code || !state) return Response.redirect(new URL("/?module=Integrações&gmail=error&reason=oauth_incompleto", request.url), 302);
  const db = await getDb();
  const stateHash = await sha256Hex(state);
  const [savedState] = await db.select().from(googleOauthStates).where(eq(googleOauthStates.stateHash, stateHash)).limit(1);
  if (!savedState || savedState.organizationId !== context.organizationId || savedState.userId !== context.userId || savedState.expiresAt < new Date().toISOString()) {
    return Response.redirect(new URL("/?module=Integrações&gmail=error&reason=estado_invalido", request.url), 302);
  }
  await db.delete(googleOauthStates).where(eq(googleOauthStates.stateHash, stateHash));
  const config = await requiredConfig(context);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" }) });
  const tokens = await tokenResponse.json() as TokenPayload;
  if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) throw new Error(tokens.error_description || tokens.error || "O Google não devolveu uma autorização reutilizável.");
  const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${tokens.access_token}` } });
  if (!profileResponse.ok) throw new Error("Não foi possível confirmar a conta Gmail autorizada.");
  const profile = await profileResponse.json() as { emailAddress?: string; historyId?: string };
  const now = new Date().toISOString();
  const values = { organizationId: context.organizationId, userId: context.userId, gmailAddress: String(profile.emailAddress ?? ""), accessTokenEncrypted: await encrypt(tokens.access_token, config.encryptionKey), refreshTokenEncrypted: await encrypt(tokens.refresh_token, config.encryptionKey), accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000).toISOString(), scopesJson: JSON.stringify(String(tokens.scope ?? "").split(" ").filter(Boolean)), historyId: String(profile.historyId ?? ""), status: "Ativo", lastError: "", updatedAt: now };
  await db.insert(gmailConnections).values(values).onConflictDoUpdate({ target: [gmailConnections.organizationId, gmailConnections.userId], set: values });
  await audit(context, "GMAIL_CONNECTED", "gmail_connection", String(context.userId), { gmailAddress: profile.emailAddress ?? "", scopes: GMAIL_SCOPES });
  return Response.redirect(new URL("/?module=Integrações&gmail=connected", request.url), 302);
}

async function validAccessToken(connection: typeof gmailConnections.$inferSelect, context: SecurityContext) {
  const config = await requiredConfig(context);
  if (connection.accessTokenExpiresAt && Date.parse(connection.accessTokenExpiresAt) > Date.now() + 60_000) return decrypt(connection.accessTokenEncrypted, config.encryptionKey);
  const refreshToken = await decrypt(connection.refreshTokenEncrypted, config.encryptionKey);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
  const tokens = await response.json() as TokenPayload;
  if (!response.ok || !tokens.access_token) throw new Error(tokens.error_description || "Não foi possível renovar a autorização do Gmail.");
  const db = await getDb();
  await db.update(gmailConnections).set({ accessTokenEncrypted: await encrypt(tokens.access_token, config.encryptionKey), accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000).toISOString(), updatedAt: new Date().toISOString() }).where(eq(gmailConnections.id, connection.id));
  await audit(context, "GMAIL_TOKEN_REFRESHED", "gmail_connection", String(connection.id));
  return tokens.access_token;
}

async function matchEmailOperation(context: SecurityContext, message: GmailMessage) {
  const db = await getDb();
  const text = [header(message.payload, "Subject"), message.snippet, messageText(message)].join(" ").toLowerCase();
  const rows = await db.select().from(operations).where(eq(operations.organizationId, context.organizationId)).limit(1000);
  const candidates = rows.map((operation) => {
    const tokens = [operation.reference, operation.contractNumber, operation.bookingNumber, operation.billOfLadingNumber, operation.containerNumbers].filter(Boolean);
    const score = tokens.reduce((total, token) => total + (text.includes(token.toLowerCase()) ? (token === operation.reference ? 100 : 45) : 0), 0);
    return { operation, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const top = candidates[0];
  return top ? { operation: top.operation, confidence: top.score >= 100 ? "HIGH" : "MEDIUM", score: top.score } : { operation: null, confidence: "NONE", score: 0 };
}

async function gmailJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Gmail respondeu HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

export async function syncGmail() {
  const context = await requireSecurityContext("write");
  await ensureGmailTables();
  const db = await getDb();
  const [connection] = await db.select().from(gmailConnections).where(and(eq(gmailConnections.organizationId, context.organizationId), eq(gmailConnections.userId, context.userId))).limit(1);
  if (!connection || connection.status !== "Ativo") return Response.json({ error: "Conecte uma conta Gmail antes de sincronizar." }, { status: 409 });
  try {
    const token = await validAccessToken(connection, context);
    const list = await gmailJson<{ messages?: Array<{ id: string }>; resultSizeEstimate?: number }>("messages?maxResults=25&q=newer_than%3A14d", token);
    let imported = 0;
    let reviewed = 0;
    let attachments = 0;
    for (const item of list.messages ?? []) {
      const existing = await db.select({ id: agentEvents.id }).from(agentEvents).where(and(eq(agentEvents.organizationId, context.organizationId), eq(agentEvents.eventId, `gmail:${item.id}`))).limit(1);
      if (existing.length) continue;
      const message = await gmailJson<GmailMessage>(`messages/${encodeURIComponent(item.id)}?format=full`, token);
      const match = await matchEmailOperation(context, message);
      const subject = sanitize(header(message.payload, "Subject"));
      const sender = sanitize(header(message.payload, "From"));
      const recipients = header(message.payload, "To").split(",").map((value) => sanitize(value)).filter(Boolean);
      const summary = sanitize(message.snippet || messageText(message));
      const status = match.confidence === "HIGH" ? "Processado" : "Em revisão";
      await db.insert(agentEvents).values({ organizationId: context.organizationId, eventId: `gmail:${message.id}`, source: "gmail", externalId: message.threadId ?? message.id, subject, sender, recipientsJson: JSON.stringify(recipients.slice(0, 20)), summary, payloadJson: JSON.stringify({ messageId: message.id, threadId: message.threadId, internalDate: message.internalDate, headers: message.payload?.headers ?? [] }).slice(0, 50000), matchedOperationId: match.operation?.id, matchConfidence: match.confidence, matchScore: match.score, status, processedAt: new Date().toISOString() });
      if (match.operation && match.confidence === "HIGH") {
        await db.insert(operationTimeline).values({ organizationId: context.organizationId, operationId: match.operation.id, eventType: "gmail_message", title: `Gmail: ${subject || message.id}`, description: summary, source: "gmail", externalEventId: message.id, metadataJson: JSON.stringify({ sender, threadId: message.threadId }), createdBy: context.fullName });
        for (const part of flattenParts(message.payload).filter((candidate) => candidate.filename && candidate.body?.attachmentId)) {
          const attachment = await gmailJson<{ data?: string; size?: number }>(`messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(part.body!.attachmentId!)}`, token);
          const bytes = base64ToBytes(attachment.data ?? "");
          if (!bytes.byteLength || bytes.byteLength > 25 * 1024 * 1024) continue;
          const objectKey = `operations/${match.operation.id}/gmail/${message.id}/${crypto.randomUUID()}-${sanitize(part.filename || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          const env = await runtimeEnv();
          await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: part.mimeType || "application/octet-stream" } });
          const classification = classifyDocument(part.filename || "");
          await db.insert(operationDocuments).values({ organizationId: context.organizationId, operationId: match.operation.id, category: classification.stage, fileName: part.filename || "attachment", objectKey, contentType: part.mimeType || "application/octet-stream", sizeBytes: bytes.byteLength, status: "Recebido — aguardando aprovação", sourceSystem: "Gmail", sourceExternalId: message.id, sourceTaskId: message.threadId ?? "", sourceCreatedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : "", documentType: classification.type, lifecycleStatus: "Vigente", shipmentSetStatus: "Fora do set", clientShareStatus: "Interno" });
          attachments += 1;
        }
        imported += 1;
      } else reviewed += 1;
    }
    const now = new Date().toISOString();
    await db.update(gmailConnections).set({ lastSyncAt: now, lastError: "", updatedAt: now }).where(eq(gmailConnections.id, connection.id));
    await audit(context, "GMAIL_SYNC_COMPLETED", "gmail_connection", String(connection.id), { imported, reviewed, attachments, inspected: list.messages?.length ?? 0 });
    return Response.json({ inspected: list.messages?.length ?? 0, imported, reviewed, attachments, message: `${imported} e-mail(s) vinculado(s); ${reviewed} encaminhado(s) para revisão.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar Gmail.";
    await db.update(gmailConnections).set({ lastError: message, updatedAt: new Date().toISOString() }).where(eq(gmailConnections.id, connection.id));
    throw error;
  }
}

export async function disconnectGmail() {
  const context = await requireSecurityContext("write");
  await ensureGmailTables();
  const db = await getDb();
  const [connection] = await db.select().from(gmailConnections).where(and(eq(gmailConnections.organizationId, context.organizationId), eq(gmailConnections.userId, context.userId))).orderBy(desc(gmailConnections.id)).limit(1);
  if (connection) {
    await db.update(gmailConnections).set({ status: "Revogado", accessTokenEncrypted: "", refreshTokenEncrypted: "", updatedAt: new Date().toISOString() }).where(eq(gmailConnections.id, connection.id));
    await audit(context, "GMAIL_DISCONNECTED", "gmail_connection", String(connection.id), { gmailAddress: connection.gmailAddress });
  }
  return Response.json({ disconnected: true });
}

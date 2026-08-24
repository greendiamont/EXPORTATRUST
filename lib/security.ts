import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { ensureBaseTables, getDb } from "../db";
import { appUsers, auditLogs, organizationMemberships, organizations } from "../db/schema";

export const APP_ROLES = ["administrador", "analista", "fornecedor", "auditor", "cliente"] as const;
export type AppRole = typeof APP_ROLES[number];

export type SecurityContext = {
  organizationId: number;
  organizationName: string;
  organizationSlug: string;
  userId: number;
  email: string;
  fullName: string;
  role: AppRole;
  preview: boolean;
};

export const ACTIVE_ORGANIZATION_COOKIE = "exportatrust_org";

let securityReady: Promise<void> | null = null;

const rolePermissions: Record<AppRole, string[]> = {
  administrador: ["read", "write", "write_supplier", "delete", "manage_users", "export", "backup", "audit"],
  analista: ["read", "write", "write_supplier", "export"],
  fornecedor: ["read", "write_supplier"],
  auditor: ["read", "audit", "export"],
  cliente: ["read", "write", "write_supplier", "export"],
};

function decodeName(value: string | null, encoding: string | null) {
  if (!value || encoding !== "percent-encoded-utf-8") return "";
  try { return decodeURIComponent(value); } catch { return ""; }
}

async function identity() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  const email = requestHeaders.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? "";
  const fullName = decodeName(requestHeaders.get("oai-authenticated-user-full-name"), requestHeaders.get("oai-authenticated-user-full-name-encoding"));
  const preview = host.includes("terminal.local") || host.includes("localhost") || host.includes("127.0.0.1");
  if (email) return { email, fullName: fullName || email, preview: false };
  if (preview) return { email: "preview-admin@exportatrust.local", fullName: "Administrador de teste", preview: true };
  return null;
}

function activeOrganizationFromCookie(cookieHeader: string | null) {
  const value = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${ACTIVE_ORGANIZATION_COOKIE}=`))?.split("=").slice(1).join("=");
  const parsed = Number(value ?? "");
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function ensureSecurityTables() {
  if (securityReady) return securityReady;
  securityReady = (async () => {
    const { env } = await import("cloudflare:workers");
    try {
      await env.DB.prepare("SELECT id FROM organizations LIMIT 1").first();
      return;
    } catch {
      // A instalação inicial será preparada abaixo; bancos publicados seguem pelo caminho rápido.
    }
    await ensureBaseTables();
    await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organizations (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, slug text NOT NULL UNIQUE, name text NOT NULL, tax_id text DEFAULT '' NOT NULL, status text DEFAULT 'Ativa' NOT NULL, data_region text DEFAULT 'global' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS app_users (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, email text NOT NULL UNIQUE, full_name text DEFAULT '' NOT NULL, status text DEFAULT 'Ativo' NOT NULL, identity_provider text DEFAULT 'chatgpt-siwc' NOT NULL, last_login_at text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS organization_memberships (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer NOT NULL, user_id integer NOT NULL, role text DEFAULT 'cliente' NOT NULL, status text DEFAULT 'Ativo' NOT NULL, invited_by text DEFAULT '' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, UNIQUE(organization_id,user_id))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS audit_logs (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer NOT NULL, actor_user_id integer, actor_email text NOT NULL, action text NOT NULL, entity_type text NOT NULL, entity_id text DEFAULT '' NOT NULL, metadata_json text DEFAULT '{}' NOT NULL, previous_hash text DEFAULT 'GENESIS' NOT NULL, event_hash text NOT NULL UNIQUE, request_id text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS document_access_tokens (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer NOT NULL, token_hash text NOT NULL UNIQUE, document_type text NOT NULL, document_id integer NOT NULL, inline integer DEFAULT 0 NOT NULL, created_by text NOT NULL, expires_at text NOT NULL, used_at text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS backup_snapshots (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer NOT NULL, object_key text NOT NULL UNIQUE, content_hash text NOT NULL, size_bytes integer NOT NULL, status text DEFAULT 'Concluído' NOT NULL, triggered_by text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pdf_integrity_records (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer NOT NULL, operation_id integer, property_car_code text DEFAULT '' NOT NULL, document_type text NOT NULL, file_name text NOT NULL, sha256 text NOT NULL, generated_by text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS legal_acceptances (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer NOT NULL, user_id integer NOT NULL, document_type text NOT NULL, version text NOT NULL, accepted_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, UNIQUE(user_id,document_type,version))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS system_events (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer NOT NULL, level text DEFAULT 'error' NOT NULL, source text NOT NULL, fingerprint text NOT NULL, message text NOT NULL, metadata_json text DEFAULT '{}' NOT NULL, status text DEFAULT 'Aberto' NOT NULL, occurred_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, resolved_at text)"),
    ]);
    const tenantTables = [
    "rural_properties", "forest_documents", "suppliers", "operations",
    "operation_documents", "operation_partners", "exception_actions",
    "industrial_plans", "agent_jobs", "agent_ledger", "payment_transactions",
    "export_control_settings", "export_milestones", "client_notifications",
    "shipment_tracking_events", "shipment_advices", "country_compliance_checks", "asana_import_candidates",
  ];
    for (const table of tenantTables) {
      const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      if (!info.results.some((column) => column.name === "organization_id")) {
        await env.DB.prepare(`ALTER TABLE ${table} ADD organization_id integer DEFAULT 1 NOT NULL`).run();
      }
    }
    await env.DB.prepare("INSERT OR IGNORE INTO organizations (id,slug,name,status,data_region) VALUES (1,'exportatrust','ExportaTrust','Ativa','global')").run();
  })().catch((error: unknown) => {
    securityReady = null;
    throw error;
  });
  return securityReady;
}

export async function getSecurityContext(): Promise<SecurityContext | null> {
  const person = await identity();
  if (!person) return null;
  await ensureSecurityTables();
  const db = await getDb();
  let [user] = await db.select().from(appUsers).where(eq(appUsers.email, person.email)).limit(1);
  if (!user) [user] = await db.insert(appUsers).values({ email: person.email, fullName: person.fullName, identityProvider: person.preview ? "preview" : "chatgpt-siwc", lastLoginAt: new Date().toISOString() }).returning();
  else await db.update(appUsers).set({ fullName: person.fullName || user.fullName, lastLoginAt: new Date().toISOString() }).where(eq(appUsers.id, user.id));
  const requestHeaders = await headers();
  const requestedOrganizationId = activeOrganizationFromCookie(requestHeaders.get("cookie"));
  const memberships = await db.select().from(organizationMemberships).where(and(eq(organizationMemberships.userId, user.id), eq(organizationMemberships.status, "Ativo"))).orderBy(organizationMemberships.id).limit(100);
  let membership = memberships.find((item) => item.organizationId === requestedOrganizationId) ?? memberships[0];
  if (!membership) {
    const [anyMembership] = await db.select({ id: organizationMemberships.id }).from(organizationMemberships).limit(1);
    if (anyMembership) return null;
    [membership] = await db.insert(organizationMemberships).values({ organizationId: 1, userId: user.id, role: "administrador", invitedBy: "bootstrap" }).returning();
  }
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, membership.organizationId)).limit(1);
  if (!organization || membership.status !== "Ativo" || user.status !== "Ativo") return null;
  const role = APP_ROLES.includes(membership.role as AppRole) ? membership.role as AppRole : "cliente";
  return { organizationId: organization.id, organizationName: organization.name, organizationSlug: organization.slug, userId: user.id, email: user.email, fullName: user.fullName || user.email, role, preview: person.preview };
}

export async function requireSecurityContext(permission: string = "read") {
  const context = await getSecurityContext();
  if (!context) throw new Response(JSON.stringify({ error: "Autenticação obrigatória." }), { status: 401, headers: { "content-type": "application/json" } });
  if (!rolePermissions[context.role].includes(permission)) throw new Response(JSON.stringify({ error: "Seu perfil não possui autorização para esta ação." }), { status: 403, headers: { "content-type": "application/json" } });
  return context;
}

export async function sha256Hex(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function audit(context: SecurityContext, action: string, entityType: string, entityId = "", metadata: Record<string, unknown> = {}) {
  const db = await getDb();
  const [last] = await db.select({ eventHash: auditLogs.eventHash }).from(auditLogs).where(eq(auditLogs.organizationId, context.organizationId)).orderBy(desc(auditLogs.id)).limit(1);
  const previousHash = last?.eventHash || "GENESIS";
  const requestId = crypto.randomUUID();
  const metadataJson = JSON.stringify(metadata);
  const eventHash = await sha256Hex(JSON.stringify({ organizationId: context.organizationId, actor: context.email, action, entityType, entityId, metadataJson, previousHash, requestId }));
  await db.insert(auditLogs).values({ organizationId: context.organizationId, actorUserId: context.userId, actorEmail: context.email, action, entityType, entityId, metadataJson, previousHash, eventHash, requestId });
  return eventHash;
}

export async function verifyAuditChain(organizationId: number) {
  const db = await getDb();
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, organizationId)).orderBy(auditLogs.id).limit(5000);
  let previous = "GENESIS";
  for (const row of rows) {
    if (row.previousHash !== previous) return { valid: false, checked: rows.length, brokenAt: row.id };
    const expected = await sha256Hex(JSON.stringify({ organizationId: row.organizationId, actor: row.actorEmail, action: row.action, entityType: row.entityType, entityId: row.entityId, metadataJson: row.metadataJson, previousHash: row.previousHash, requestId: row.requestId }));
    if (row.eventHash !== expected) return { valid: false, checked: rows.length, brokenAt: row.id };
    previous = row.eventHash;
  }
  return { valid: true, checked: rows.length, lastHash: previous };
}

export function tenantWhere<T>(column: T, organizationId: number) {
  return eq(column as never, organizationId);
}

export function tenantAnd<T>(column: T, organizationId: number, condition: ReturnType<typeof eq>) {
  return and(eq(column as never, organizationId), condition);
}

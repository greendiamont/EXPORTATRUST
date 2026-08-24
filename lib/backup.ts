import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { backupSnapshots } from "../db/schema";
import { audit, sha256Hex, verifyAuditChain, type SecurityContext } from "./security";
import { tenantExport } from "./tenant-export";

export async function createTenantBackup(context: SecurityContext, triggeredBy = context.email) {
  const payload = await tenantExport(context.organizationId);
  const text = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(text);
  const hash = await sha256Hex(bytes);
  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) throw new Error("Armazenamento privado indisponível.");
  const objectKey = `backups/org-${context.organizationId}/${new Date().toISOString().replaceAll(":", "-")}-${hash.slice(0, 12)}.json`;
  await env.BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256: hash, organizationId: String(context.organizationId), schemaVersion: "2" },
  });
  const db = await getDb();
  await db.insert(backupSnapshots).values({ organizationId: context.organizationId, objectKey, contentHash: hash, sizeBytes: bytes.byteLength, triggeredBy });
  await audit(context, triggeredBy === "automatic-daily" ? "BACKUP_AUTOMATIC_CREATED" : "BACKUP_CREATED", "organization", String(context.organizationId), { objectKey, sha256: hash, sizeBytes: bytes.byteLength });
  const chain = await verifyAuditChain(context.organizationId);
  const anchor = new TextEncoder().encode(JSON.stringify({ organizationId: context.organizationId, backupObjectKey: objectKey, backupSha256: hash, auditLastHash: chain.lastHash, auditValid: chain.valid, anchoredAt: new Date().toISOString() }));
  await env.BUCKET.put(`audit-anchors/org-${context.organizationId}/${new Date().toISOString().replaceAll(":", "-")}-${hash.slice(0, 12)}.json`, anchor, { httpMetadata: { contentType: "application/json" }, customMetadata: { appendOnly: "true", backupSha256: hash } });
  return { sha256: hash, sizeBytes: bytes.byteLength, objectKey };
}

export async function ensureDailyBackup(context: SecurityContext) {
  const { env } = await import("cloudflare:workers");
  const configuredHours = Number((env as unknown as Record<string, unknown>).BACKUP_FREQUENCY_HOURS ?? 24);
  const frequencyHours = Number.isFinite(configuredHours) && configuredHours >= 1 ? Math.min(configuredHours, 168) : 24;
  const backupIntervalMs = frequencyHours * 60 * 60 * 1000;
  const db = await getDb();
  const [latest] = await db.select().from(backupSnapshots).where(eq(backupSnapshots.organizationId, context.organizationId)).orderBy(desc(backupSnapshots.id)).limit(1);
  const lastRunAt = latest?.createdAt ? new Date(latest.createdAt).getTime() : 0;
  const due = !lastRunAt || Date.now() - lastRunAt >= backupIntervalMs;
  if (due) {
    const created = await createTenantBackup(context, "automatic-daily");
    return { enabled: true, frequencyHours, ranNow: true, lastRunAt: new Date().toISOString(), nextRunAt: new Date(Date.now() + backupIntervalMs).toISOString(), ...created };
  }
  return { enabled: true, frequencyHours, ranNow: false, lastRunAt: latest.createdAt, nextRunAt: new Date(lastRunAt + backupIntervalMs).toISOString(), sha256: latest.contentHash, sizeBytes: latest.sizeBytes };
}

export async function verifyLatestBackup(context: SecurityContext) {
  const db = await getDb();
  const [latest] = await db.select().from(backupSnapshots).where(eq(backupSnapshots.organizationId, context.organizationId)).orderBy(desc(backupSnapshots.id)).limit(1);
  if (!latest) throw new Error("Nenhum backup disponível para verificação.");
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(latest.objectKey);
  if (!object) throw new Error("Arquivo do backup não foi localizado.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  const hash = await sha256Hex(bytes);
  const valid = hash === latest.contentHash;
  await audit(context, valid ? "BACKUP_INTEGRITY_VERIFIED" : "BACKUP_INTEGRITY_FAILED", "backup", String(latest.id), { expected: latest.contentHash, actual: hash });
  return { valid, checkedAt: new Date().toISOString(), sha256: hash, sizeBytes: bytes.byteLength };
}

export async function runRestoreDrill(context: SecurityContext) {
  const db = await getDb();
  const [latest] = await db.select().from(backupSnapshots).where(eq(backupSnapshots.organizationId, context.organizationId)).orderBy(desc(backupSnapshots.id)).limit(1);
  if (!latest) throw new Error("Nenhum backup disponível para o teste de restauração.");
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(latest.objectKey);
  if (!object) throw new Error("O arquivo físico do backup não foi localizado.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  const hash = await sha256Hex(bytes);
  if (hash !== latest.contentHash) throw new Error("O backup falhou na verificação de integridade.");
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as Awaited<ReturnType<typeof tenantExport>>;
  if (payload.organization?.id !== context.organizationId || !payload.restoration?.schemaVersion) throw new Error("O backup não corresponde à empresa ativa.");
  const counts = Object.fromEntries(Object.entries(payload.data).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]));
  await audit(context, "BACKUP_RESTORE_DRILL_PASSED", "backup", String(latest.id), { sha256: hash, counts });
  return { valid: true, checkedAt: new Date().toISOString(), sha256: hash, counts, mode: "non-destructive" };
}

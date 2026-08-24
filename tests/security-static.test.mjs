import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("critical document routes require an authenticated security context", async () => {
  for (const path of ["app/api/documents/route.ts", "app/api/forest-documents/route.ts", "app/api/eudr-report/route.ts", "app/api/forest-dossier/route.ts"]) {
    const source = await read(path);
    assert.match(source, /requireSecurityContext\(/, `${path} must require server-side identity`);
    assert.match(source, /organizationId/, `${path} must enforce tenant ownership`);
  }
});

test("temporary document links are hashed, expiring and single-use", async () => {
  const source = await read("app/api/secure-documents/route.ts");
  assert.match(source, /sha256Hex\(token\)/);
  assert.match(source, /15 \* 60 \* 1000/);
  assert.match(source, /isNull\(documentAccessTokens\.usedAt\)/);
  assert.match(source, /usedAt: new Date\(\)\.toISOString\(\)/);
});

test("signed-in document access remains durable while metadata and bytes stay private", async () => {
  const client = await read("app/client-app.tsx");
  const operationRoute = await read("app/api/documents/route.ts");
  const forestRoute = await read("app/api/forest-documents/route.ts");
  assert.match(client, /documentType === "forest" \? "\/api\/forest-documents" : "\/api\/documents"/);
  assert.match(client, /new URLSearchParams\(\{ documentId: String\(documentId\) \}\)/);
  for (const route of [operationRoute, forestRoute]) {
    assert.match(route, /requireSecurityContext\("read"\)/);
    assert.match(route, /eq\([^\n]+organizationId, context\.organizationId\)/);
    assert.match(route, /get\(record\.objectKey\)/);
    assert.match(route, /"cache-control": "private, no-store"/);
  }
});

test("PDF outputs receive SHA-256 integrity records", async () => {
  for (const path of ["app/api/eudr-report/route.ts", "app/api/forest-dossier/route.ts"]) {
    const source = await read(path);
    assert.match(source, /sha256Hex\(bytes\)/);
    assert.match(source, /pdfIntegrityRecords/);
    assert.match(source, /x-exportatrust-sha256/);
  }
});

test("audit trail is append-only and chained", async () => {
  const source = await read("lib/security.ts");
  assert.match(source, /previousHash/);
  assert.match(source, /eventHash/);
  assert.doesNotMatch(source, /delete\(auditLogs\)|update\(auditLogs\)/);
});

test("daily backups are private, tenant-scoped and integrity checked", async () => {
  const source = await read("lib/backup.ts");
  assert.match(source, /BACKUP_FREQUENCY_HOURS/);
  assert.match(source, /frequencyHours \* 60 \* 60 \* 1000/);
  assert.match(source, /backups\/org-\$\{context\.organizationId\}/);
  assert.match(source, /sha256Hex\(bytes\)/);
  assert.match(source, /BACKUP_AUTOMATIC_CREATED/);
  assert.match(source, /hash === latest\.contentHash/);
  assert.match(source, /audit-anchors\/org-\$\{context\.organizationId\}/);
  assert.match(source, /appendOnly: "true"/);
});

test("the security center exposes a safe sign-out and backup verification flow", async () => {
  const source = await read("app/client-app.tsx");
  assert.match(source, /\/signout-with-chatgpt\?return_to=%2F/);
  assert.match(source, /verifyBackup/);
  assert.match(source, /Rotina automática ativa/);
});

test("legacy databases self-heal tenant columns without deleting records", async () => {
  const source = await read("lib/security.ts");
  assert.match(source, /PRAGMA table_info/);
  assert.match(source, /ALTER TABLE \$\{table\} ADD organization_id/);
  assert.doesNotMatch(source, /DROP TABLE|DELETE FROM/);
});

test("unknown identities are never enrolled into an existing company", async () => {
  const source = await read("lib/security.ts");
  assert.match(source, /if \(anyMembership\) return null/);
  assert.match(source, /activeOrganizationFromCookie/);
  assert.match(source, /memberships\.find\(\(item\) => item\.organizationId === requestedOrganizationId\)/);
});

test("company switching verifies an active membership before setting the tenant cookie", async () => {
  const source = await read("app/api/security/route.ts");
  assert.match(source, /eq\(organizationMemberships\.organizationId, organizationId\)/);
  assert.match(source, /eq\(organizationMemberships\.userId, context\.userId\)/);
  assert.match(source, /eq\(organizationMemberships\.status, "Ativo"\)/);
  assert.match(source, /HttpOnly; SameSite=Lax/);
});

test("full archive exports the manifest and original document bytes", async () => {
  const source = await read("lib/tenant-archive.ts");
  assert.match(source, /exportatrust-manifest\.json/);
  assert.match(source, /includesOriginalBytes: true/);
  assert.match(source, /operationDocuments\.map/);
  assert.match(source, /forestDocuments\.map/);
  assert.match(source, /object\.body\.getReader\(\)/);
});

test("restore drill validates tenant, schema and hash without writing business tables", async () => {
  const source = await read("lib/backup.ts");
  const drill = source.slice(source.indexOf("export async function runRestoreDrill"));
  assert.match(drill, /hash !== latest\.contentHash/);
  assert.match(drill, /payload\.organization\?\.id !== context\.organizationId/);
  assert.match(drill, /BACKUP_RESTORE_DRILL_PASSED/);
  assert.match(drill, /mode: "non-destructive"/);
  assert.doesNotMatch(drill, /db\.insert\(operations\)|db\.update\(operations\)/);
});

test("monitoring is tenant-scoped and deduplicates open failures", async () => {
  const source = await read("app/api/monitoring/route.ts");
  assert.match(source, /eq\(systemEvents\.organizationId, context\.organizationId\)/);
  assert.match(source, /eq\(systemEvents\.fingerprint, fingerprint\)/);
  assert.match(source, /eq\(systemEvents\.status, "Aberto"\)/);
  assert.match(source, /sha256Hex/);
});

test("supplier creation uses the dedicated permission and preserves authorization responses", async () => {
  const route = await read("app/api/suppliers/route.ts");
  const security = await read("lib/security.ts");
  assert.match(route, /requireSecurityContext\("write_supplier"\)/);
  assert.match(route, /error instanceof Response/);
  assert.match(security, /administrador: \[[^\]]*"write_supplier"/);
  assert.match(security, /fornecedor: \[[^\]]*"write_supplier"/);
});

test("new operations derive supplier data and use a product-specific traceability catalog", async () => {
  const client = await read("app/client-app.tsx");
  const route = await read("app/api/operations/route.ts");
  const catalog = await read("lib/product-catalog.ts");
  const migration = await read("drizzle/0014_bitter_jocasta.sql");
  assert.match(client, /updateOperationSupplier/);
  assert.match(client, /product-raw-materials/);
  assert.match(client, /product-species/);
  assert.match(client, /Reflorestamento/);
  assert.match(route, /productionLocation: `\$\{supplier\.city\}\/\$\{supplier\.state\} · \$\{supplier\.country\}`/);
  assert.match(catalog, /PRODUCT_CATALOG_SEEDS/);
  assert.match(catalog, /Pinus taeda/);
  assert.match(catalog, /Coffea arabica/);
  assert.match(migration, /CREATE TABLE `product_traceability_catalog`/);
  assert.doesNotMatch(migration, /CREATE TABLE `operations`|CREATE TABLE `client_notifications`/);
});

test("export milestones remain freely editable while preserving operational fields", async () => {
  const route = await read("app/api/export-control/route.ts");
  const client = await read("app/client-app.tsx");
  const migration = await read("drizzle/0016_smooth_frog_thor.sql");
  assert.doesNotMatch(route, /Antes de avançar, informe/);
  assert.doesNotMatch(route, /Registre o resultado ou a evidência/);
  assert.match(route, /responsibleName/);
  assert.match(route, /nextAction/);
  assert.match(client, /Plano operacional incompleto/);
  assert.match(migration, /responsible_name/);
  assert.match(migration, /responsible_email/);
  assert.match(migration, /next_action/);
});

test("EUDR and shipment stages are editable without readiness locks", async () => {
  const route = await read("app/api/export-control/route.ts");
  assert.match(route, /synchronizedStatus/);
  assert.doesNotMatch(route, /operation\.readiness < 100/);
  assert.doesNotMatch(route, /qualityStatusCurrent !== "Aprovado"/);
  assert.doesNotMatch(route, /currentControl\.compliance\.score !== 100/);
  assert.match(route, /eq\(exportMilestones\.organizationId, context\.organizationId\)/);
});

test("Asana migration is restricted to VLP EXPORTAÇÃO and imports only reviewed active operations", async () => {
  const route = await read("app/api/asana-import/route.ts");
  const auth = await read("lib/asana-import-security.ts");
  const mapping = await read("lib/asana-migration.ts");
  const migration = await read("drizzle/0017_tranquil_runaways.sql");
  assert.match(mapping, /1210731947360004/);
  assert.match(mapping, /FINALIZADO\/CANCELADO/);
  assert.match(mapping, /Ignorado · modelo/);
  assert.match(mapping, /Ignorado · liquidado/);
  assert.match(mapping, /Em espera · stand-by/);
  assert.match(mapping, /parseAsanaOperation/);
  assert.match(route, /Somente o projeto VLP EXPORTAÇÃO/);
  assert.match(route, /ASANA_IMPORT_STAGED/);
  assert.match(route, /ASANA_OPERATIONS_IMPORTED/);
  assert.match(route, /row\.sourceStatus\.toLocaleLowerCase\("pt-BR"\) !== "ativo"/);
  assert.match(route, /matchedOperationId/);
  assert.match(auth, /requireSecurityContext\("write_supplier"\)/);
  assert.match(auth, /ASANA_MIGRATION_TOKEN/);
  assert.match(auth, /sha256Hex\(expected\) !== await sha256Hex\(provided\)/);
  assert.match(auth, /x-exportatrust-migration-token/);
  assert.match(migration, /CREATE TABLE `asana_import_candidates`/);
});

test("personal agent brief is authenticated, tenant-scoped and read-only", async () => {
  const route = await read("app/api/agent-brief/route.ts");
  assert.match(route, /requireSecurityContext\("read"\)/);
  assert.match(route, /eq\(operations\.organizationId, context\.organizationId\)/);
  assert.match(route, /eq\(exportMilestones\.organizationId, context\.organizationId\)/);
  assert.match(route, /x-exportatrust-agent-schema/);
  assert.doesNotMatch(route, /db\.insert|db\.update|db\.delete/);
});

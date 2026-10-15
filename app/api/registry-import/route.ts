import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, importerClients, masterProducts } from "../../../db/schema";
import { normalizeMasterName } from "../../../lib/master-data";
import { ensureRegistrationColumns } from "../../../lib/registration-columns";
import { extractRegistryRecords, registryFieldsToComplete, type RegistryKind } from "../../../lib/registry-import";
import { audit, requireSecurityContext } from "../../../lib/security";

// Importa clientes ou produtos do app antigo para a empresa ativa (mesmas regras da
// importação de fornecedores): prévia com dryRun, nada é apagado nem sobrescrito,
// cadastro existente só tem campos vazios completados, auditoria com id antigo → novo.

type Outcome = {
  sourceId: number | null;
  legalName: string;
  taxId: string;
  action: "criar" | "completar" | "já existe" | "ignorado";
  targetId: number | null;
  completed: string[];
  adjustments: string[];
  warnings: string[];
};

const ENTITY = { clientes: "importer_client", produtos: "master_product" } as const;
const MAX_ROWS = 2000;

function parseMetadata(value: string) {
  try { return JSON.parse(value || "{}") as Record<string, unknown>; } catch { return {}; }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write_supplier");
    await ensureRegistrationColumns();
    const body = await request.json() as { kind?: string; payload?: unknown; dryRun?: boolean };
    const kind = body.kind as RegistryKind;
    if (kind !== "clientes" && kind !== "produtos") return Response.json({ error: "Tipo de cadastro inválido." }, { status: 400 });
    const records = extractRegistryRecords(body.payload, kind);
    if (!records.length) return Response.json({ error: `Nenhum ${kind === "clientes" ? "cliente" : "produto"} encontrado no arquivo. Use a exportação do app antigo.` }, { status: 400 });
    if (records.length > MAX_ROWS) return Response.json({ error: `Limite de ${MAX_ROWS} registros por importação.` }, { status: 400 });
    const dryRun = body.dryRun !== false;
    const db = await getDb();
    const table = kind === "clientes" ? importerClients : masterProducts;

    // Mapas id antigo → id novo de importações anteriores (fornecedores e este cadastro).
    const history = await db.select({ action: auditLogs.action, entityId: auditLogs.entityId, metadataJson: auditLogs.metadataJson }).from(auditLogs)
      .where(and(eq(auditLogs.organizationId, context.organizationId), inArray(auditLogs.action, ["SUPPLIER_IMPORTED", "REGISTRY_IMPORTED"])));
    const supplierMap = new Map<number, number>();
    const previousMap = new Map<number, number>();
    for (const event of history) {
      const metadata = parseMetadata(event.metadataJson);
      const sourceId = Number(metadata.sourceId);
      const targetId = Number(event.entityId);
      if (!sourceId || !targetId) continue;
      if (event.action === "SUPPLIER_IMPORTED") supplierMap.set(sourceId, targetId);
      else if (metadata.kind === kind) previousMap.set(sourceId, targetId);
    }

    const existing = await db.select().from(table).where(eq(table.organizationId, context.organizationId)) as Array<Record<string, unknown> & { id: number }>;
    const byId = new Map(existing.map((row) => [row.id, row]));
    const byName = new Map(existing.map((row) => [String(row.normalizedName), row]));
    const byTaxId = new Map(kind === "clientes" ? existing.filter((row) => row.taxId).map((row) => [String(row.taxId), row]) : []);
    const seen = new Set<string>();
    const outcomes: Outcome[] = [];

    for (const record of records) {
      const normalizedName = normalizeMasterName(record.name);
      const base = { sourceId: record.sourceId, legalName: record.name, taxId: record.taxId, adjustments: record.adjustments, warnings: [...record.warnings], completed: [] as string[], targetId: null as number | null };
      if (!normalizedName || seen.has(normalizedName)) {
        outcomes.push({ ...base, action: "ignorado", warnings: [...base.warnings, normalizedName ? "Repetido no arquivo" : "Sem nome"] });
        continue;
      }
      seen.add(normalizedName);

      const values: Record<string, unknown> = { ...record.values };
      if (kind === "produtos") {
        const mapped = record.sourceSupplierIds.map((id) => supplierMap.get(id)).filter((id): id is number => Boolean(id));
        if (record.sourceSupplierIds.length && mapped.length < record.sourceSupplierIds.length) base.warnings.push(`${record.sourceSupplierIds.length - mapped.length} fornecedor(es) habilitado(s) ainda não importado(s)`);
        values.eligibleSupplierIds = mapped;
      }

      const match = (record.sourceId && byId.get(previousMap.get(record.sourceId) ?? -1))
        || (record.taxId && byTaxId.get(record.taxId))
        || byName.get(normalizedName);
      if (match) {
        const changes = registryFieldsToComplete(match, record);
        if (kind === "produtos") {
          const current = (() => { try { return JSON.parse(String(match.eligibleSupplierIds || "[]")) as number[]; } catch { return []; } })();
          const merged = [...new Set([...current, ...(values.eligibleSupplierIds as number[])])];
          if (merged.length > current.length) changes.eligibleSupplierIds = JSON.stringify(merged);
        }
        const completed = Object.keys(changes);
        if (completed.length && !dryRun) {
          await db.update(table).set({ ...changes, updatedAt: new Date().toISOString() }).where(and(eq(table.id, match.id), eq(table.organizationId, context.organizationId)));
          await audit(context, "REGISTRY_IMPORT_COMPLETED", ENTITY[kind], String(match.id), { kind, sourceId: record.sourceId, fields: completed });
        }
        outcomes.push({ ...base, action: completed.length ? "completar" : "já existe", targetId: match.id, completed });
        continue;
      }

      let targetId: number | null = null;
      if (!dryRun) {
        const insert = kind === "clientes"
          ? { ...values, legalName: record.name, normalizedName, organizationId: context.organizationId }
          : { ...values, name: record.name, normalizedName, eligibleSupplierIds: JSON.stringify(values.eligibleSupplierIds ?? []), organizationId: context.organizationId };
        const [created] = await db.insert(table).values(insert as never).returning() as Array<Record<string, unknown> & { id: number }>;
        targetId = created.id;
        byName.set(normalizedName, created);
        if (record.taxId) byTaxId.set(record.taxId, created);
        await audit(context, "REGISTRY_IMPORTED", ENTITY[kind], String(created.id), { kind, sourceId: record.sourceId, name: record.name, derived: record.derived });
      }
      outcomes.push({ ...base, action: "criar", targetId });
    }

    const summary = {
      total: outcomes.length,
      criar: outcomes.filter((item) => item.action === "criar").length,
      completar: outcomes.filter((item) => item.action === "completar").length,
      existentes: outcomes.filter((item) => item.action === "já existe").length,
      ignorados: outcomes.filter((item) => item.action === "ignorado").length,
    };
    if (!dryRun) await audit(context, "REGISTRY_IMPORT_FINISHED", ENTITY[kind], "import", { kind, ...summary, mapping: outcomes.filter((item) => item.targetId).map((item) => [item.sourceId, item.targetId]) });
    return Response.json({ dryRun, kind, organization: context.organizationName, summary, outcomes });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("REGISTRY_IMPORT_FAILED", error);
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao importar." }, { status: 500 });
  }
}

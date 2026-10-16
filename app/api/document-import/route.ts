import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, forestDocuments, operationDocuments, ruralProperties, shipmentAdvices } from "../../../db/schema";
import { audit, requireSecurityContext } from "../../../lib/security";

// Liga os documentos do app antigo aos processos e florestas já importados na empresa ativa.
// Os arquivos em si são copiados para o storage antes (importação do pacote); aqui ficam
// só os registros, com a mesma chave do arquivo. Prévia com dryRun; nunca apaga nem
// sobrescreve; chave de arquivo é única, então reimportar não duplica.

type Row = Record<string, unknown>;

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value)).trim();
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const list = (payload: unknown, names: string[]): Row[] => {
  const root = payload && typeof payload === "object" ? payload as Row : {};
  for (const holder of [root.data, root.tables, root]) {
    if (!holder || typeof holder !== "object") continue;
    for (const name of names) {
      const value = (holder as Row)[name];
      if (Array.isArray(value)) return value.filter((row): row is Row => !!row && typeof row === "object");
    }
  }
  return [];
};
const field = (row: Row, key: string) => row[key] ?? row[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    const body = await request.json() as { payload?: unknown; dryRun?: boolean; availableKeys?: string[] };
    const documents = list(body.payload, ["operationDocuments", "operation_documents"]);
    const forestFiles = list(body.payload, ["forestDocuments", "forest_documents"]);
    if (!documents.length && !forestFiles.length) return Response.json({ error: "Nenhum documento encontrado no arquivo." }, { status: 400 });
    const dryRun = body.dryRun !== false;
    const available = Array.isArray(body.availableKeys) ? new Set(body.availableKeys.map(String)) : null;
    const db = await getDb();
    const org = context.organizationId;

    const history = await db.select({ entityId: auditLogs.entityId, metadataJson: auditLogs.metadataJson }).from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org), eq(auditLogs.action, "PROCESS_IMPORTED")));
    const processMap = new Map<number, number>();
    for (const event of history) {
      try {
        const sourceId = Number(JSON.parse(event.metadataJson || "{}").sourceId);
        if (sourceId && Number(event.entityId)) processMap.set(sourceId, Number(event.entityId));
      } catch { /* evento sem metadados */ }
    }

    const keys = [...documents, ...forestFiles].map((row) => text(field(row, "objectKey"))).filter(Boolean);
    const existingDocs = keys.length ? await db.select({ id: operationDocuments.id, objectKey: operationDocuments.objectKey, organizationId: operationDocuments.organizationId }).from(operationDocuments).where(inArray(operationDocuments.objectKey, keys)) : [];
    const existingForest = keys.length ? await db.select({ objectKey: forestDocuments.objectKey }).from(forestDocuments).where(inArray(forestDocuments.objectKey, keys)) : [];
    const docByKey = new Map(existingDocs.map((row) => [row.objectKey, row]));
    const forestKeys = new Set(existingForest.map((row) => row.objectKey));
    const ownCars = new Set((await db.select({ carCode: ruralProperties.carCode }).from(ruralProperties).where(eq(ruralProperties.organizationId, org))).map((row) => row.carCode));

    const summary = { documentos: documents.length, criar: 0, existentes: 0, semProcesso: 0, semArquivo: 0, florestas: 0, avisosAtualizados: 0 };
    const warnings: string[] = [];
    const idMap = new Map<number, number>();

    for (const row of documents) {
      const objectKey = text(field(row, "objectKey"));
      const sourceId = num(field(row, "id"));
      const operationId = processMap.get(num(field(row, "operationId")));
      if (!objectKey || !operationId) {
        summary.semProcesso += 1;
        continue;
      }
      if (available && !available.has(objectKey)) {
        summary.semArquivo += 1;
        warnings.push(`Arquivo ausente no pacote: ${text(field(row, "fileName"))}`);
      }
      const existing = docByKey.get(objectKey);
      if (existing) {
        if (existing.organizationId === org && sourceId) idMap.set(sourceId, existing.id);
        summary.existentes += 1;
        continue;
      }
      summary.criar += 1;
      if (dryRun) continue;
      const [created] = await db.insert(operationDocuments).values({
        organizationId: org, operationId, objectKey,
        category: text(field(row, "category")) || "Outro", fileName: text(field(row, "fileName")) || objectKey.split("/").pop() || "arquivo",
        contentType: text(field(row, "contentType")) || "application/octet-stream", sizeBytes: num(field(row, "sizeBytes")),
        status: text(field(row, "status")) || "Recebido", notes: text(field(row, "notes")), sourceSystem: text(field(row, "sourceSystem")) || "App antigo",
        sourceExternalId: text(field(row, "sourceExternalId")), sourceTaskId: text(field(row, "sourceTaskId")), sourceCreatedAt: text(field(row, "sourceCreatedAt")),
        documentType: text(field(row, "documentType")) || "Outro documento", lifecycleStatus: text(field(row, "lifecycleStatus")) || "Vigente",
        shipmentSetStatus: text(field(row, "shipmentSetStatus")) || "Fora do set", clientShareStatus: text(field(row, "clientShareStatus")) || "Interno",
        analysisSummary: text(field(row, "analysisSummary")),
        ...(text(field(row, "uploadedAt")) ? { uploadedAt: text(field(row, "uploadedAt")) } : {}),
      } as typeof operationDocuments.$inferInsert).returning({ id: operationDocuments.id });
      if (sourceId) idMap.set(sourceId, created.id);
    }

    for (const row of forestFiles) {
      const objectKey = text(field(row, "objectKey"));
      const carCode = text(field(row, "propertyCarCode"));
      if (!objectKey || forestKeys.has(objectKey)) continue;
      if (!ownCars.has(carCode)) {
        warnings.push(`Floresta ${carCode} não está nesta empresa; documento ${text(field(row, "fileName"))} não ligado`);
        continue;
      }
      summary.florestas += 1;
      if (dryRun) continue;
      await db.insert(forestDocuments).values({
        organizationId: org, propertyCarCode: carCode, objectKey, category: text(field(row, "category")) || "Outro",
        fileName: text(field(row, "fileName")) || "arquivo", contentType: text(field(row, "contentType")) || "application/octet-stream",
        sizeBytes: num(field(row, "sizeBytes")), notes: text(field(row, "notes")), source: text(field(row, "source")) || "App antigo",
        ...(text(field(row, "uploadedAt")) ? { uploadedAt: text(field(row, "uploadedAt")) } : {}),
      } as typeof forestDocuments.$inferInsert);
    }

    // Avisos de embarque importados apontavam para ids de documentos do app antigo.
    const operationIds = [...new Set(processMap.values())];
    if (!dryRun && idMap.size && operationIds.length) {
      const advices = await db.select({ id: shipmentAdvices.id, documentIdsJson: shipmentAdvices.documentIdsJson }).from(shipmentAdvices)
        .where(and(eq(shipmentAdvices.organizationId, org), inArray(shipmentAdvices.operationId, operationIds)));
      for (const advice of advices) {
        let ids: unknown[] = [];
        try { ids = JSON.parse(advice.documentIdsJson || "[]"); } catch { continue; }
        if (!Array.isArray(ids) || !ids.length) continue;
        const mapped = ids.map((value) => idMap.get(Number(value)) ?? value);
        if (JSON.stringify(mapped) === JSON.stringify(ids)) continue;
        await db.update(shipmentAdvices).set({ documentIdsJson: JSON.stringify(mapped) }).where(eq(shipmentAdvices.id, advice.id));
        summary.avisosAtualizados += 1;
      }
    }

    if (!dryRun && (summary.criar || summary.florestas)) await audit(context, "DOCUMENT_IMPORT_FINISHED", "operation_document", "import", { ...summary });
    return Response.json({ dryRun, organization: context.organizationName, summary, warnings: warnings.slice(0, 50) });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("DOCUMENT_IMPORT_FAILED", error);
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao importar documentos." }, { status: 500 });
  }
}

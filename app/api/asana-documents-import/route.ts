import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { asanaImportCandidates, exportControlSettings, operationDocuments, operations, shipmentAdvices } from "../../../db/schema";
import { requireAsanaImportContext } from "../../../lib/asana-import-security";
import { analyzeShipmentDocument, buildShipmentAdvice } from "../../../lib/shipment-documents";
import { audit, type SecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

function limited(value: unknown, maximum = 1000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

async function operationForTask(db: Awaited<ReturnType<typeof getDb>>, organizationId: number, taskGid: string) {
  const [candidate] = await db.select({ operationId: asanaImportCandidates.matchedOperationId }).from(asanaImportCandidates).where(and(
    eq(asanaImportCandidates.organizationId, organizationId),
    eq(asanaImportCandidates.taskGid, taskGid),
  )).limit(1);
  if (!candidate?.operationId) return null;
  return (await db.select().from(operations).where(and(eq(operations.organizationId, organizationId), eq(operations.id, candidate.operationId))).limit(1))[0] ?? null;
}

async function finalizeDrafts(db: Awaited<ReturnType<typeof getDb>>, organizationId: number, taskGids: string[]) {
  const summaries = [];
  for (const taskGid of [...new Set(taskGids)]) {
    const operation = await operationForTask(db, organizationId, taskGid);
    if (!operation) continue;
    const [documents, settings] = await Promise.all([
      db.select().from(operationDocuments).where(and(eq(operationDocuments.organizationId, organizationId), eq(operationDocuments.operationId, operation.id))).limit(1000),
      db.select().from(exportControlSettings).where(and(eq(exportControlSettings.organizationId, organizationId), eq(exportControlSettings.operationId, operation.id))).limit(1),
    ]);
    const advice = buildShipmentAdvice(operation, documents, { name: settings[0]?.customerName || operation.euImporter, email: settings[0]?.customerEmail || "" });
    const values = {
      organizationId,
      operationId: operation.id,
      status: "Rascunho · revisão humana",
      recipient: advice.recipient,
      subject: advice.subject,
      body: advice.body,
      paymentRequest: "Solicitar pagamento do saldo e comprovante SWIFT / MT103.",
      documentIdsJson: JSON.stringify(advice.included.map((document) => document.id)),
      checklistJson: JSON.stringify(advice.checklist),
      humanApproved: false,
      approvedBy: "",
      approvedAt: null,
      sentAt: null,
      updatedAt: new Date().toISOString(),
    };
    await db.insert(shipmentAdvices).values(values).onConflictDoUpdate({
      target: [shipmentAdvices.organizationId, shipmentAdvices.operationId],
      set: values,
    });
    summaries.push({ operationId: operation.id, reference: operation.reference, included: advice.included.length, checklist: advice.checklist });
  }
  return summaries;
}

type ImportMetadata = {
  taskGid: string;
  sourceExternalId: string;
  sourceCreatedAt: string;
  fileName: string;
  contentType: string;
  category: string;
  documentType: string;
  lifecycleStatus: string;
  shipmentSetStatus: string;
  clientShareStatus: string;
  analysisSummary: string;
  notes: string;
  extractedText: string;
};

async function persistDocument(db: Awaited<ReturnType<typeof getDb>>, context: SecurityContext, metadata: ImportMetadata, bytes: ArrayBuffer) {
  const taskGid = limited(metadata.taskGid, 40);
  const sourceExternalId = limited(metadata.sourceExternalId, 80);
  const fileName = limited(metadata.fileName, 300);
  if (!taskGid || !sourceExternalId || !fileName || !bytes.byteLength) throw new Error("Arquivo ou origem inválida.");
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("Cada arquivo pode ter no máximo 20 MB.");
  const operation = await operationForTask(db, context.organizationId, taskGid);
  if (!operation) throw new Error("Operação vinculada ao Asana não encontrada.");
  const [existing] = await db.select().from(operationDocuments).where(and(
    eq(operationDocuments.organizationId, context.organizationId),
    eq(operationDocuments.sourceSystem, "Asana"),
    eq(operationDocuments.sourceExternalId, sourceExternalId),
  )).limit(1);
  if (existing) return { document: existing, duplicate: true };
  const fallback = analyzeShipmentDocument(fileName, limited(metadata.extractedText, 4000));
  const category = limited(metadata.category, 160) || fallback.category;
  const documentType = limited(metadata.documentType, 160) || fallback.documentType;
  const lifecycleStatus = oneOf(limited(metadata.lifecycleStatus), ["Rascunho", "Vigente", "Final", "Histórico"] as const, fallback.lifecycleStatus);
  const shipmentSetStatus = oneOf(limited(metadata.shipmentSetStatus), ["Fora do set", "Candidato", "Incluído"] as const, fallback.shipmentSetStatus);
  const clientShareStatus = oneOf(limited(metadata.clientShareStatus), ["Interno", "Revisão pendente", "Aprovado"] as const, fallback.clientShareStatus);
  const analysisSummary = limited(metadata.analysisSummary, 2000) || fallback.analysisSummary;
  const contentType = limited(metadata.contentType, 160) || "application/octet-stream";
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const safeName = fileName.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-140);
  const objectKey = `organizations/${context.organizationId}/operations/${operation.id}/asana/${sourceExternalId}-${safeName}`;
  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) throw new Error("Armazenamento de arquivos indisponível.");
  await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType } });
  const [document] = await db.insert(operationDocuments).values({
    organizationId: context.organizationId,
    operationId: operation.id,
    category,
    fileName,
    objectKey,
    contentType,
    sizeBytes: bytes.byteLength,
    status: "Importado e analisado",
    notes: limited(metadata.notes, 2000),
    sourceSystem: "Asana",
    sourceExternalId,
    sourceTaskId: taskGid,
    sourceCreatedAt: limited(metadata.sourceCreatedAt, 60),
    documentType,
    lifecycleStatus,
    shipmentSetStatus,
    clientShareStatus,
    analysisSummary,
    sha256,
  }).returning();
  await audit(context, "ASANA_DOCUMENT_IMPORTED", "operation_document", String(document.id), { operationId: operation.id, sourceExternalId, documentType, lifecycleStatus, shipmentSetStatus, sha256 });
  return { document, duplicate: false };
}

export async function POST(request: Request) {
  try {
    const context = await requireAsanaImportContext(request);
    await ensureBaseTables();
    const db = await getDb();
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/octet-stream") && request.headers.get("x-asana-chunk") === "1") {
      const sourceExternalId = limited(request.headers.get("x-asana-source-id"), 80);
      const partNumber = Number(request.headers.get("x-asana-part-number"));
      if (!/^\d+$/.test(sourceExternalId) || !Number.isInteger(partNumber) || partNumber < 0 || partNumber > 99) return Response.json({ error: "Parte inválida." }, { status: 400 });
      const bytes = await request.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > 700 * 1024) return Response.json({ error: "Parte vazia ou acima de 700 KB." }, { status: 413 });
      const { env } = await import("cloudflare:workers");
      if (!env.BUCKET) throw new Error("Armazenamento de arquivos indisponível.");
      await env.BUCKET.put(`organizations/${context.organizationId}/migrations/asana/${sourceExternalId}/${partNumber}.part`, bytes, { httpMetadata: { contentType: "application/octet-stream" } });
      return Response.json({ ok: true, partNumber, sizeBytes: bytes.byteLength });
    }
    if (contentType.includes("application/json")) {
      const body = await request.json() as Record<string, unknown>;
      if (body.action === "finalize") {
        const taskGids = (Array.isArray(body.taskGids) ? body.taskGids : []).map(String).filter(Boolean).slice(0, 100);
        const summaries = await finalizeDrafts(db, context.organizationId, taskGids);
        await audit(context, "ASANA_DOCUMENT_DRAFTS_PREPARED", "asana_project", "1210731947360004", { operations: summaries.length });
        return Response.json({ summaries });
      }
      if (body.action === "finalize-file") {
        const sourceExternalId = limited(body.sourceExternalId, 80);
        const partCount = Number(body.partCount);
        if (!/^\d+$/.test(sourceExternalId) || !Number.isInteger(partCount) || partCount < 1 || partCount > 100) return Response.json({ error: "Upload em partes inválido." }, { status: 400 });
        const { env } = await import("cloudflare:workers");
        if (!env.BUCKET) throw new Error("Armazenamento de arquivos indisponível.");
        const chunks: Uint8Array[] = [];
        let total = 0;
        const chunkKeys = [];
        for (let part = 0; part < partCount; part += 1) {
          const key = `organizations/${context.organizationId}/migrations/asana/${sourceExternalId}/${part}.part`;
          const object = await env.BUCKET.get(key);
          if (!object) return Response.json({ error: `Parte ${part} não encontrada.` }, { status: 409 });
          const chunk = new Uint8Array(await object.arrayBuffer());
          chunks.push(chunk);
          chunkKeys.push(key);
          total += chunk.byteLength;
        }
        const combined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
        const result = await persistDocument(db, context, {
          taskGid: limited(body.taskGid, 40), sourceExternalId, sourceCreatedAt: limited(body.sourceCreatedAt, 60), fileName: limited(body.fileName, 300),
          contentType: limited(body.contentType, 160), category: limited(body.category, 160), documentType: limited(body.documentType, 160),
          lifecycleStatus: limited(body.lifecycleStatus, 40), shipmentSetStatus: limited(body.shipmentSetStatus, 40), clientShareStatus: limited(body.clientShareStatus, 40),
          analysisSummary: limited(body.analysisSummary, 2000), notes: limited(body.notes, 2000), extractedText: limited(body.extractedText, 4000),
        }, combined.buffer);
        await Promise.all(chunkKeys.map((key) => env.BUCKET!.delete(key)));
        return Response.json(result, { status: result.duplicate ? 200 : 201 });
      }
      return Response.json({ error: "Ação inválida." }, { status: 400 });
    }

    const form = await request.formData();
    const taskGid = limited(form.get("taskGid"), 40);
    const sourceExternalId = limited(form.get("sourceExternalId"), 80);
    const file = form.get("file");
    if (!taskGid || !sourceExternalId || !(file instanceof File) || !file.size) return Response.json({ error: "Arquivo ou origem inválida." }, { status: 400 });
    const result = await persistDocument(db, context, {
      taskGid, sourceExternalId, sourceCreatedAt: limited(form.get("sourceCreatedAt"), 60), fileName: file.name, contentType: file.type || "application/octet-stream",
      category: limited(form.get("category"), 160), documentType: limited(form.get("documentType"), 160), lifecycleStatus: limited(form.get("lifecycleStatus"), 40),
      shipmentSetStatus: limited(form.get("shipmentSetStatus"), 40), clientShareStatus: limited(form.get("clientShareStatus"), 40), analysisSummary: limited(form.get("analysisSummary"), 2000),
      notes: limited(form.get("notes"), 2000), extractedText: limited(form.get("extractedText"), 4000),
    }, await file.arrayBuffer());
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { operationDocuments, operations, operationTimeline } from "../../../../../../db/schema";
import { boundedJson, classifyDocument, enforceIdempotency, jsonError, requireAgent, sanitize } from "../../../../../../lib/private-agent-api";
import { audit, sha256Hex } from "../../../../../../lib/security";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAgent(request, "operations:read");
    const { id } = await params;
    const db = await getDb();
    const documents = await db.select().from(operationDocuments).where(and(eq(operationDocuments.operationId, Number(id)), eq(operationDocuments.organizationId, context.organizationId))).orderBy(desc(operationDocuments.id)).limit(500);
    return Response.json({ documents });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAgent(request, "documents:write");
    await enforceIdempotency(request, context);
    const { id } = await params;
    const body = await boundedJson<Record<string, unknown>>(request);
    const fileName = sanitize(String(body.file_name ?? body.fileName ?? ""));
    if (!fileName) return Response.json({ error: "Nome do documento obrigatório." }, { status: 400 });
    const contentType = sanitize(String(body.content_type ?? "application/octet-stream"));
    const sizeBytes = Number(body.size_bytes ?? 0);
    if (sizeBytes > 20 * 1024 * 1024) return Response.json({ error: "Arquivo acima do limite permitido." }, { status: 413 });
    const db = await getDb();
    const [operation] = await db.select().from(operations).where(and(eq(operations.id, Number(id)), eq(operations.organizationId, context.organizationId))).limit(1);
    if (!operation) return Response.json({ error: "Operação não encontrada." }, { status: 404 });
    const classification = classifyDocument(fileName);
    const sha256 = sanitize(String(body.sha256 ?? await sha256Hex(`${fileName}:${contentType}:${sizeBytes}:${body.source_event_id ?? ""}`)));
    const duplicate = await db.select().from(operationDocuments).where(and(eq(operationDocuments.operationId, Number(id)), eq(operationDocuments.organizationId, context.organizationId), eq(operationDocuments.sha256, sha256))).limit(1);
    if (duplicate.length) return Response.json({ duplicate: true, document: duplicate[0] }, { status: 200 });
    const [document] = await db.insert(operationDocuments).values({ organizationId: context.organizationId, operationId: Number(id), category: sanitize(String(body.stage ?? classification.stage)), fileName, objectKey: `agent-metadata/${context.organizationId}/${id}/${crypto.randomUUID()}-${fileName}`, contentType, sizeBytes, notes: sanitize(String(body.notes ?? "Documento registrado por evento externo; arquivo binário será anexado por conector aprovado.")), sourceSystem: sanitize(String(body.source ?? "agent")), sourceExternalId: sanitize(String(body.source_event_id ?? "")), documentType: sanitize(String(body.document_type ?? classification.type)), lifecycleStatus: "Vigente", shipmentSetStatus: classification.stage.includes("Documentos finais") ? "Set final" : "Fora do set", clientShareStatus: "Interno", sha256 }).returning();
    await db.insert(operationTimeline).values({ organizationId: context.organizationId, operationId: Number(id), eventType: "document_linked", title: `Documento classificado: ${document.documentType}`, description: document.fileName, source: document.sourceSystem, externalEventId: document.sourceExternalId, documentId: document.id, metadataJson: JSON.stringify({ sha256, stage: document.category }), createdBy: context.fullName });
    await audit(context, "AGENT_DOCUMENT_LINKED", "operation_document", String(document.id), { operationId: Number(id), sha256, documentType: document.documentType });
    return Response.json({ document }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

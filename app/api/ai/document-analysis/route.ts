import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../../db";
import { operationDocuments, operations } from "../../../../db/schema";
import { analyzeDocumentWithOpenAI } from "../../../../lib/openai-document-analysis";
import { audit, requireSecurityContext } from "../../../../lib/security";

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Erro inesperado"; }
type RuntimeEnvironment = { BUCKET?: { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> }; OPENAI_API_KEY?: string; OPENAI_DOCUMENT_MODEL?: string };
async function runtimeEnvironment() { const { env } = await import("cloudflare:workers"); return env as unknown as RuntimeEnvironment; }

export async function GET() {
  try {
    await requireSecurityContext("read");
    const env = await runtimeEnvironment();
    return Response.json({ configured: Boolean(env.OPENAI_API_KEY), model: env.OPENAI_DOCUMENT_MODEL || "gpt-5.6-terra", supported: ["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "json", "jpg", "jpeg", "png", "webp", "gif"] }, { headers: { "cache-control": "no-store" } });
  } catch (error) { if (error instanceof Response) return error; return Response.json({ error: errorMessage(error) }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const body = await request.json() as { documentId?: number };
    const documentId = Number(body.documentId);
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return Response.json({ error: "Documento inválido." }, { status: 400 });
    const db = await getDb();
    const [document] = await db.select().from(operationDocuments).where(and(eq(operationDocuments.id, documentId), eq(operationDocuments.organizationId, context.organizationId))).limit(1);
    if (!document) return Response.json({ error: "Documento não encontrado." }, { status: 404 });
    const [operation] = await db.select().from(operations).where(and(eq(operations.id, document.operationId), eq(operations.organizationId, context.organizationId))).limit(1);
    if (!operation) return Response.json({ error: "Operação vinculada não encontrada." }, { status: 404 });
    const env = await runtimeEnvironment();
    if (!env.OPENAI_API_KEY) return Response.json({ error: "Leitura por IA ainda não foi configurada no ambiente de execução." }, { status: 503 });
    if (!env.BUCKET) return Response.json({ error: "Armazenamento de documentos indisponível." }, { status: 503 });
    const object = await env.BUCKET.get(document.objectKey);
    if (!object) return Response.json({ error: "Arquivo não encontrado no armazenamento." }, { status: 404 });
    const operationContext = [`Referência: ${operation.reference}`, `Fornecedor/exportador: ${operation.supplierName || "não informado"}`, `Importador: ${operation.euImporter || "não informado"}`, `País de destino: ${operation.destinationCountry || "não informado"}`].join("; ");
    const analysis = await analyzeDocumentWithOpenAI({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_DOCUMENT_MODEL, bytes: new Uint8Array(await object.arrayBuffer()), contentType: document.contentType, fileName: document.fileName, operationContext });
    await audit(context, "DOCUMENT_ANALYZED_BY_AI", "operation_document", String(document.id), { operationId: document.operationId, fileName: document.fileName, detectedType: analysis.documentType, confidence: analysis.confidence, model: env.OPENAI_DOCUMENT_MODEL || "gpt-5.6-terra" });
    return Response.json({ document: { id: document.id, operationId: document.operationId, fileName: document.fileName, category: document.category }, analysis, humanApprovalRequired: true, generatedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = errorMessage(error);
    return Response.json({ error: message }, { status: /OpenAI|formato|documento|análise/i.test(message) ? 422 : 500 });
  }
}

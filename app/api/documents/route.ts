import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { operationDocuments, operations } from "../../../db/schema";
import { refreshOperationReadiness } from "../../../lib/readiness";
import { audit, requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

async function getBucket() {
  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) throw new Error("Armazenamento de arquivos indisponível.");
  return env.BUCKET;
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const url = new URL(request.url);
    const documentId = Number(url.searchParams.get("documentId"));
    const db = await getDb();
    if (documentId) {
      const [record] = await db.select().from(operationDocuments).where(and(eq(operationDocuments.id, documentId), eq(operationDocuments.organizationId, context.organizationId))).limit(1);
      if (!record) return Response.json({ error: "Documento não encontrado." }, { status: 404 });
      const bucket = await getBucket();
      const object = await bucket.get(record.objectKey);
      if (!object) return Response.json({ error: "Arquivo não encontrado no armazenamento." }, { status: 404 });
      const inline = url.searchParams.get("inline") === "1";
      return new Response(object.body, { headers: {
        "content-type": record.contentType,
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(record.fileName)}`,
        "content-length": String(record.sizeBytes),
        "cache-control": "private, no-store",
      } });
    }
    const operationId = Number(url.searchParams.get("operationId"));
    if (url.searchParams.get("all") === "1") {
      const documents = await db.select().from(operationDocuments).where(eq(operationDocuments.organizationId, context.organizationId)).orderBy(desc(operationDocuments.id)).limit(1000);
      return Response.json({ documents });
    }
    if (!operationId) return Response.json({ error: "Operação inválida." }, { status: 400 });
    const documents = await db.select().from(operationDocuments).where(and(eq(operationDocuments.organizationId, context.organizationId), eq(operationDocuments.operationId, operationId))).orderBy(desc(operationDocuments.id)).limit(500);
    return Response.json({ documents });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    const form = await request.formData();
    const operationId = Number(form.get("operationId"));
    const category = String(form.get("category") ?? "Outros").trim();
    const notes = String(form.get("notes") ?? "").trim();
    const file = form.get("file");
    if (!operationId || !(file instanceof File) || !file.size) return Response.json({ error: "Selecione um arquivo válido." }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return Response.json({ error: "Cada arquivo pode ter no máximo 20 MB." }, { status: 413 });
    const db = await getDb();
    if (!(await db.select({ id: operations.id }).from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId))).limit(1)).length) {
      return Response.json({ error: "Operação não encontrada." }, { status: 404 });
    }
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120);
    const objectKey = `organizations/${context.organizationId}/operations/${operationId}/${crypto.randomUUID()}-${safeName}`;
    const bucket = await getBucket();
    await bucket.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    const [document] = await db.insert(operationDocuments).values({
      organizationId: context.organizationId, operationId, category, fileName: file.name, objectKey,
      contentType: file.type || "application/octet-stream", sizeBytes: file.size, notes,
    }).returning();
    await audit(context, "DOCUMENT_UPLOADED", "operation_document", String(document.id), { operationId, category, fileName: file.name, sizeBytes: file.size });
    const readiness = await refreshOperationReadiness(db, operationId);
    return Response.json({ document, readiness }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    // Document lifecycle follows the same permission used to upload and manage
    // operation evidence. Record-level tenant checks below still prevent a
    // user from touching another organization's files.
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Documento inválido." }, { status: 400 });
    const db = await getDb();
    const [record] = await db.select().from(operationDocuments).where(and(eq(operationDocuments.id, id), eq(operationDocuments.organizationId, context.organizationId))).limit(1);
    if (!record) return Response.json({ error: "Documento não encontrado." }, { status: 404 });
    const bucket = await getBucket();
    await bucket.delete(record.objectKey);
    await db.delete(operationDocuments).where(and(eq(operationDocuments.id, id), eq(operationDocuments.organizationId, context.organizationId), eq(operationDocuments.objectKey, record.objectKey)));
    await audit(context, "DOCUMENT_DELETED", "operation_document", String(id), { operationId: record.operationId, fileName: record.fileName });
    const readiness = await refreshOperationReadiness(db, record.operationId);
    return Response.json({ ok: true, readiness });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

import { and, desc, eq, inArray } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { forestDocuments, operations, ruralProperties } from "../../../db/schema";
import { audit, requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

function parseIds(value: string) {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
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
    const db = await getDb();
    const documentId = Number(url.searchParams.get("documentId"));
    if (documentId) {
      const [record] = await db.select().from(forestDocuments).where(and(eq(forestDocuments.id, documentId), eq(forestDocuments.organizationId, context.organizationId))).limit(1);
      if (!record) return Response.json({ error: "Documento da floresta não encontrado." }, { status: 404 });
      const object = await (await getBucket()).get(record.objectKey);
      if (!object) return Response.json({ error: "Arquivo não encontrado no armazenamento." }, { status: 404 });
      const inline = url.searchParams.get("inline") === "1";
      return new Response(object.body, { headers: {
        "content-type": record.contentType,
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(record.fileName)}`,
        "content-length": String(record.sizeBytes),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      } });
    }

    if (url.searchParams.get("all") === "1") {
      const documents = await db.select().from(forestDocuments).where(eq(forestDocuments.organizationId, context.organizationId)).orderBy(desc(forestDocuments.id)).limit(2000);
      return Response.json({ documents });
    }

    const operationId = Number(url.searchParams.get("operationId"));
    if (operationId) {
      const [operation] = await db.select({ propertyIds: operations.propertyIds }).from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId))).limit(1);
      if (!operation) return Response.json({ error: "Processo não encontrado." }, { status: 404 });
      const carCodes = parseIds(operation.propertyIds);
      const documents = carCodes.length
        ? await db.select().from(forestDocuments).where(and(eq(forestDocuments.organizationId, context.organizationId), inArray(forestDocuments.propertyCarCode, carCodes))).orderBy(desc(forestDocuments.id)).limit(1000)
        : [];
      return Response.json({ documents });
    }

    const carCode = String(url.searchParams.get("carCode") ?? "").trim().toUpperCase();
    if (!carCode) return Response.json({ error: "Informe o CAR do imóvel." }, { status: 400 });
    const documents = await db.select().from(forestDocuments).where(and(eq(forestDocuments.organizationId, context.organizationId), eq(forestDocuments.propertyCarCode, carCode))).orderBy(desc(forestDocuments.id)).limit(500);
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
    const carCode = String(form.get("carCode") ?? "").trim().toUpperCase();
    const category = String(form.get("category") ?? "Outros documentos da origem").trim();
    const notes = String(form.get("notes") ?? "").trim();
    const source = String(form.get("source") ?? "Fornecido pelo responsável").trim();
    const file = form.get("file");
    if (!carCode || !(file instanceof File) || !file.size) return Response.json({ error: "Selecione um arquivo válido." }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return Response.json({ error: "Cada arquivo pode ter no máximo 20 MB." }, { status: 413 });
    const db = await getDb();
    const [property] = await db.select({ carCode: ruralProperties.carCode }).from(ruralProperties).where(and(eq(ruralProperties.carCode, carCode), eq(ruralProperties.organizationId, context.organizationId))).limit(1);
    if (!property) return Response.json({ error: "Floresta/CAR não encontrada." }, { status: 404 });
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120);
    const objectKey = `organizations/${context.organizationId}/forests/${carCode}/${crypto.randomUUID()}-${safeName}`;
    const bucket = await getBucket();
    await bucket.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    const [document] = await db.insert(forestDocuments).values({
      organizationId: context.organizationId,
      propertyCarCode: carCode,
      category,
      fileName: file.name,
      objectKey,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      notes,
      source,
    }).returning();
    await audit(context, "FOREST_DOCUMENT_UPLOADED", "forest_document", String(document.id), { carCode, category, fileName: file.name, sizeBytes: file.size });
    return Response.json({ document }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireSecurityContext("delete");
    await ensureBaseTables();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return Response.json({ error: "Documento inválido." }, { status: 400 });
    const db = await getDb();
    const [record] = await db.select().from(forestDocuments).where(and(eq(forestDocuments.id, id), eq(forestDocuments.organizationId, context.organizationId))).limit(1);
    if (!record) return Response.json({ error: "Documento da floresta não encontrado." }, { status: 404 });
    await (await getBucket()).delete(record.objectKey);
    await db.delete(forestDocuments).where(and(eq(forestDocuments.id, id), eq(forestDocuments.organizationId, context.organizationId)));
    await audit(context, "FOREST_DOCUMENT_DELETED", "forest_document", String(id), { carCode: record.propertyCarCode, fileName: record.fileName });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

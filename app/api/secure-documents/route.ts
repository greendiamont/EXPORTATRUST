import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { documentAccessTokens, forestDocuments, operationDocuments } from "../../../db/schema";
import { audit, ensureSecurityTables, requireSecurityContext, sha256Hex } from "../../../lib/security";

function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  return Response.json({ error: error instanceof Error ? error.message : "Acesso ao documento falhou." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    await ensureSecurityTables();
    const context = await requireSecurityContext("read");
    const body = await request.json() as Record<string, unknown>;
    const documentType = String(body.documentType ?? "operation");
    const documentId = Number(body.documentId);
    const inline = Boolean(body.inline);
    if (!["operation", "forest"].includes(documentType) || !documentId) return Response.json({ error: "Documento inválido." }, { status: 400 });
    const db = await getDb();
    const table = documentType === "forest" ? forestDocuments : operationDocuments;
    const [record] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, documentId), eq(table.organizationId, context.organizationId))).limit(1);
    if (!record) return Response.json({ error: "Documento não encontrado nesta empresa." }, { status: 404 });
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await db.insert(documentAccessTokens).values({ organizationId: context.organizationId, tokenHash, documentType, documentId, inline, createdBy: context.email, expiresAt });
    await audit(context, "TEMPORARY_LINK_CREATED", `${documentType}_document`, String(documentId), { expiresAt, inline });
    return Response.json({ url: `/api/secure-documents?token=${token}`, expiresAt });
  } catch (error) { return errorResponse(error); }
}

export async function GET(request: Request) {
  try {
    await ensureSecurityTables();
    const token = String(new URL(request.url).searchParams.get("token") ?? "");
    if (!token) return Response.json({ error: "Link inválido." }, { status: 400 });
    const tokenHash = await sha256Hex(token);
    const db = await getDb();
    const [access] = await db.select().from(documentAccessTokens).where(and(eq(documentAccessTokens.tokenHash, tokenHash), gt(documentAccessTokens.expiresAt, new Date().toISOString()), isNull(documentAccessTokens.usedAt))).limit(1);
    if (!access) return Response.json({ error: "Este link expirou ou já foi utilizado." }, { status: 410 });
    const table = access.documentType === "forest" ? forestDocuments : operationDocuments;
    const [record] = await db.select().from(table).where(and(eq(table.id, access.documentId), eq(table.organizationId, access.organizationId))).limit(1);
    if (!record) return Response.json({ error: "Documento indisponível." }, { status: 404 });
    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET?.get(record.objectKey);
    if (!object) return Response.json({ error: "Arquivo não encontrado." }, { status: 404 });
    await db.update(documentAccessTokens).set({ usedAt: new Date().toISOString() }).where(eq(documentAccessTokens.id, access.id));
    return new Response(object.body, { headers: { "content-type": record.contentType, "content-disposition": `${access.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(record.fileName)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox" } });
  } catch (error) { return errorResponse(error); }
}

import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { operationPartners, operations } from "../../../db/schema";
import { audit, requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const operationId = Number(new URL(request.url).searchParams.get("operationId"));
    const db = await getDb();
    const partners = operationId
      ? await db.select().from(operationPartners).where(and(eq(operationPartners.organizationId, context.organizationId), eq(operationPartners.operationId, operationId))).orderBy(desc(operationPartners.id)).limit(200)
      : await db.select().from(operationPartners).where(eq(operationPartners.organizationId, context.organizationId)).orderBy(desc(operationPartners.id)).limit(500);
    return Response.json({ partners });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    const body = await request.json() as Record<string, unknown>;
    const operationId = Number(body.operationId);
    const role = String(body.role ?? "").trim();
    const companyName = String(body.companyName ?? "").trim();
    if (!operationId || !role || !companyName) return Response.json({ error: "Informe tipo e empresa parceira." }, { status: 400 });
    const db = await getDb();
    if (!(await db.select({ id: operations.id }).from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId))).limit(1)).length) return Response.json({ error: "Operação não encontrada." }, { status: 404 });
    const [partner] = await db.insert(operationPartners).values({
      organizationId: context.organizationId, operationId, role, companyName,
      contactName: String(body.contactName ?? "").trim(),
      email: String(body.email ?? "").trim().toLowerCase(),
      country: String(body.country ?? "Brasil").trim(),
    }).returning();
    await audit(context, "PARTNER_CREATED", "operation_partner", String(partner.id), { operationId, role, companyName });
    return Response.json({ partner }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireSecurityContext("delete");
    await ensureBaseTables();
    const id = Number(new URL(request.url).searchParams.get("id"));
    const db = await getDb();
    const [record] = await db.select().from(operationPartners).where(and(eq(operationPartners.id, id), eq(operationPartners.organizationId, context.organizationId))).limit(1);
    if (!record) return Response.json({ error: "Parceiro não encontrado." }, { status: 404 });
    await db.delete(operationPartners).where(and(eq(operationPartners.id, id), eq(operationPartners.organizationId, context.organizationId)));
    await audit(context, "PARTNER_DELETED", "operation_partner", String(id), { operationId: record.operationId, companyName: record.companyName });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

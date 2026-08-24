import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { exceptionActions } from "../../../db/schema";
import { audit, requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const alertText = new URL(request.url).searchParams.get("alertText")?.trim();
    const db = await getDb();
    const actions = alertText
      ? await db.select().from(exceptionActions).where(and(eq(exceptionActions.organizationId, context.organizationId), eq(exceptionActions.alertText, alertText))).orderBy(desc(exceptionActions.id)).limit(100)
      : await db.select().from(exceptionActions).where(eq(exceptionActions.organizationId, context.organizationId)).orderBy(desc(exceptionActions.id)).limit(300);
    return Response.json({ actions });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    const body = await request.json() as Record<string, unknown>;
    const alertText = String(body.alertText ?? "").trim();
    const responsibleName = String(body.responsibleName ?? "").trim();
    const responsibleEmail = String(body.responsibleEmail ?? "").trim().toLowerCase();
    const dueDate = String(body.dueDate ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (!alertText || !responsibleName || !responsibleEmail || !dueDate || !message) {
      return Response.json({ error: "Preencha responsável, e-mail, prazo e mensagem." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsibleEmail)) {
      return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
    }
    const db = await getDb();
    const [action] = await db.insert(exceptionActions).values({
      organizationId: context.organizationId,
      alertText,
      operationReference: String(body.operationReference ?? "GBU002/26").trim(),
      responsibleName,
      responsibleEmail,
      dueDate,
      message,
      status: "Notificado",
    }).returning();
    await audit(context, "RISK_ACTION_CREATED", "exception_action", String(action.id), { operationReference: action.operationReference, responsibleEmail });
    return Response.json({ action }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    const body = await request.json() as Record<string, unknown>;
    const id = Number(body.id);
    if (!id) return Response.json({ error: "Ação inválida." }, { status: 400 });
    const db = await getDb();
    const [action] = await db.update(exceptionActions).set({
      status: "Resolvido",
      resolvedAt: new Date().toISOString(),
    }).where(and(eq(exceptionActions.id, id), eq(exceptionActions.organizationId, context.organizationId))).returning();
    if (!action) return Response.json({ error: "Ação não encontrada." }, { status: 404 });
    await audit(context, "RISK_ACTION_RESOLVED", "exception_action", String(id), { operationReference: action.operationReference });
    return Response.json({ action });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

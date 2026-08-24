import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { operationStageSettings, operations } from "../../../db/schema";
import { refreshOperationReadiness } from "../../../lib/readiness";
import { audit, requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const operationId = Number(new URL(request.url).searchParams.get("operationId"));
    if (!operationId) return Response.json({ error: "Processo inválido." }, { status: 400 });
    const db = await getDb();
    if (!(await db.select({ id: operations.id }).from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId))).limit(1)).length) return Response.json({ error: "Processo não encontrado." }, { status: 404 });
    const settings = await db.select().from(operationStageSettings).where(eq(operationStageSettings.operationId, operationId)).limit(100);
    return Response.json({ settings });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    const body = await request.json() as Record<string, unknown>;
    const operationId = Number(body.operationId);
    const stageCategory = String(body.stageCategory ?? "").trim();
    const enabled = body.enabled !== false;
    if (!operationId || !stageCategory) return Response.json({ error: "Etapa inválida." }, { status: 400 });
    const db = await getDb();
    if (!(await db.select({ id: operations.id }).from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId))).limit(1)).length) {
      return Response.json({ error: "Processo não encontrado." }, { status: 404 });
    }
    const [existing] = await db.select().from(operationStageSettings).where(and(
      eq(operationStageSettings.operationId, operationId),
      eq(operationStageSettings.stageCategory, stageCategory),
    )).limit(1);
    const [setting] = existing
      ? await db.update(operationStageSettings).set({ enabled, updatedAt: new Date().toISOString() }).where(eq(operationStageSettings.id, existing.id)).returning()
      : await db.insert(operationStageSettings).values({ operationId, stageCategory, enabled }).returning();
    const readiness = await refreshOperationReadiness(db, operationId);
    await audit(context, "STAGE_SETTING_CHANGED", "operation_stage", `${operationId}:${stageCategory}`, { enabled, readiness });
    return Response.json({ setting, readiness });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

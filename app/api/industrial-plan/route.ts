import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { industrialPlans, operations } from "../../../db/schema";
import { audit, requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

const numberValue = (value: unknown) => Math.max(0, Number(value) || 0);

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const operationId = Number(new URL(request.url).searchParams.get("operationId"));
    if (!operationId) return Response.json({ error: "Operação inválida." }, { status: 400 });
    const db = await getDb();
    const [plan] = await db.select().from(industrialPlans).where(and(eq(industrialPlans.operationId, operationId), eq(industrialPlans.organizationId, context.organizationId))).limit(1);
    return Response.json({ plan: plan ?? null });
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
    const periodStart = String(body.periodStart ?? "").trim();
    const periodEnd = String(body.periodEnd ?? "").trim();
    if (!operationId || !periodStart || !periodEnd) return Response.json({ error: "Informe a operação e o período produtivo." }, { status: 400 });
    const db = await getDb();
    if (!(await db.select({ id: operations.id }).from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId))).limit(1)).length) {
      return Response.json({ error: "Operação não encontrada." }, { status: 404 });
    }
    const values = {
      organizationId: context.organizationId,
      operationId,
      periodStart,
      periodEnd,
      receivingLots: String(body.receivingLots ?? "").trim(),
      openingStockKg: numberValue(body.openingStockKg),
      rawMaterialReceivedKg: numberValue(body.rawMaterialReceivedKg),
      rawMaterialConsumedKg: numberValue(body.rawMaterialConsumedKg),
      pelletsProducedKg: numberValue(body.pelletsProducedKg),
      closingStockKg: numberValue(body.closingStockKg),
      productionLots: String(body.productionLots ?? "").trim(),
      notes: String(body.notes ?? "").trim(),
      status: String(body.status ?? "Em elaboração").trim(),
      updatedAt: new Date().toISOString(),
    };
    const [plan] = await db.insert(industrialPlans).values(values)
      .onConflictDoUpdate({ target: industrialPlans.operationId, set: values })
      .returning();
    await audit(context, "INDUSTRIAL_PLAN_SAVED", "industrial_plan", String(plan.id), { operationId, status: plan.status });
    return Response.json({ plan }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

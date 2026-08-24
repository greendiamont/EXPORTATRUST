import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { exportMilestones } from "../../../../../../../db/schema";
import { boundedJson, createApproval, enforceIdempotency, guardAction, jsonError, requireAgent, SAFE_STAGE_STATUSES, sanitize } from "../../../../../../../lib/private-agent-api";
import { audit } from "../../../../../../../lib/security";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; stageId: string }> }) {
  try {
    const context = await requireAgent(request, "stages:suggest");
    await enforceIdempotency(request, context);
    const { id, stageId } = await params;
    const body = await boundedJson<Record<string, unknown>>(request);
    const status = sanitize(String(body.status ?? ""));
    if (!SAFE_STAGE_STATUSES.has(status) || guardAction("stage_update", body)) {
      const approval = await createApproval(context, "stage_update_sensitive", Number(id), "Alteração sensível da etapa exige revisão humana.", { stageId, ...body }, "HIGH");
      return Response.json({ blocked: true, approval }, { status: 202 });
    }
    const db = await getDb();
    const [stage] = await db.update(exportMilestones).set({ status, note: sanitize(String(body.reason ?? body.note ?? "")), completedAt: status === "Concluído" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }).where(and(eq(exportMilestones.operationId, Number(id)), eq(exportMilestones.code, stageId), eq(exportMilestones.organizationId, context.organizationId))).returning();
    if (!stage) return Response.json({ error: "Etapa não encontrada." }, { status: 404 });
    await audit(context, "AGENT_STAGE_UPDATED", "export_milestone", String(stage.id), { operationId: Number(id), stageId, status });
    return Response.json({ stage });
  } catch (error) {
    return jsonError(error);
  }
}

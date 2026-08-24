import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { operationTimeline, operations } from "../../../../../../db/schema";
import { boundedJson, enforceIdempotency, jsonError, requireAgent, sanitize } from "../../../../../../lib/private-agent-api";
import { audit } from "../../../../../../lib/security";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAgent(request, "operations:read");
    const { id } = await params;
    const db = await getDb();
    const timeline = await db.select().from(operationTimeline).where(and(eq(operationTimeline.operationId, Number(id)), eq(operationTimeline.organizationId, context.organizationId))).orderBy(desc(operationTimeline.id)).limit(200);
    return Response.json({ timeline });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAgent(request, "timeline:write");
    await enforceIdempotency(request, context);
    const { id } = await params;
    const body = await boundedJson<Record<string, unknown>>(request);
    const db = await getDb();
    const [exists] = await db.select({ id: operations.id }).from(operations).where(and(eq(operations.id, Number(id)), eq(operations.organizationId, context.organizationId))).limit(1);
    if (!exists) return Response.json({ error: "Operação não encontrada." }, { status: 404 });
    const [timeline] = await db.insert(operationTimeline).values({ organizationId: context.organizationId, operationId: Number(id), eventType: sanitize(String(body.eventType ?? "agent_note")), title: sanitize(String(body.title ?? "Evento do Agente Particular")), description: sanitize(String(body.description ?? "")), source: sanitize(String(body.source ?? "agent")), externalEventId: sanitize(String(body.event_id ?? "")), metadataJson: JSON.stringify(body.metadata ?? {}), createdBy: context.fullName }).returning();
    await audit(context, "AGENT_TIMELINE_CREATED", "operation", String(id), { timelineId: timeline.id });
    return Response.json({ timeline }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

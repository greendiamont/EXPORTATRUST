import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { operations } from "../../../../../db/schema";
import { boundedJson, createApproval, enforceIdempotency, guardAction, jsonError, requireAgent, sanitize } from "../../../../../lib/private-agent-api";
import { audit } from "../../../../../lib/security";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAgent(request, "operations:read");
    const { id } = await params;
    const db = await getDb();
    const [operation] = await db.select().from(operations).where(and(eq(operations.id, Number(id)), eq(operations.organizationId, context.organizationId))).limit(1);
    if (!operation) return Response.json({ error: "Operação não encontrada." }, { status: 404 });
    return Response.json({ operation });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAgent(request, "operations:read");
    await enforceIdempotency(request, context);
    const { id } = await params;
    const body = await boundedJson<Record<string, unknown>>(request);
    if (guardAction("operation_update", body)) {
      const approval = await createApproval(context, "operation_update_sensitive", Number(id), "Atualização sensível bloqueada para aprovação humana.", body, "HIGH");
      return Response.json({ blocked: true, approval }, { status: 202 });
    }
    const allowed = {
      status: sanitize(String(body.status ?? "")),
      supplyChainNotes: sanitize(String(body.supplyChainNotes ?? body.notes ?? "")),
      bookingNumber: sanitize(String(body.bookingNumber ?? "")),
      containerNumbers: sanitize(String(body.containerNumbers ?? "")),
      vesselVoyage: sanitize(String(body.vesselVoyage ?? "")),
    };
    const update = Object.fromEntries(Object.entries(allowed).filter(([, value]) => value));
    if (!Object.keys(update).length) return Response.json({ error: "Nenhum campo operacional permitido informado." }, { status: 400 });
    const db = await getDb();
    const [operation] = await db.update(operations).set(update).where(and(eq(operations.id, Number(id)), eq(operations.organizationId, context.organizationId))).returning();
    if (!operation) return Response.json({ error: "Operação não encontrada." }, { status: 404 });
    await audit(context, "AGENT_OPERATION_PATCHED", "operation", String(operation.id), { update });
    return Response.json({ operation });
  } catch (error) {
    return jsonError(error);
  }
}

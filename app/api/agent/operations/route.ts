import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { operations } from "../../../../db/schema";
import { boundedJson, createApproval, enforceIdempotency, guardAction, jsonError, listOperationsForAgent, requireAgent, sanitize } from "../../../../lib/private-agent-api";
import { audit } from "../../../../lib/security";

export async function GET(request: Request) {
  try {
    return await listOperationsForAgent(request);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAgent(request, "operations:read");
    await enforceIdempotency(request, context);
    const body = await boundedJson<Record<string, unknown>>(request);
    if (body.create_allowed !== true) {
      const approval = await createApproval(context, "create_operation", null, "Criação de operação pelo agente exige permissão explícita.", body, "MEDIUM");
      return Response.json({ blocked: true, approval }, { status: 202 });
    }
    const db = await getDb();
    const reference = sanitize(String(body.reference ?? body.operation_id ?? ""));
    if (!reference) return Response.json({ error: "Código/referência da operação é obrigatório." }, { status: 400 });
    const [operation] = await db.insert(operations).values({
      organizationId: context.organizationId,
      reference,
      product: sanitize(String(body.product ?? "A classificar")),
      hsCode: sanitize(String(body.hsCode ?? body.hs_code ?? "")),
      destinationCountry: sanitize(String(body.destinationCountry ?? body.destination_country ?? "")),
      euImporter: sanitize(String(body.customer ?? body.euImporter ?? "")),
      supplierName: sanitize(String(body.supplier ?? body.supplierName ?? "")),
      status: "Cadastro inicial",
    }).returning();
    await audit(context, "AGENT_OPERATION_CREATED", "operation", String(operation.id), { reference });
    return Response.json({ operation }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

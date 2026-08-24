import { getIntegrationStatuses } from "../../../lib/integrations";
import { audit, requireSecurityContext } from "../../../lib/security";

export async function GET() {
  await requireSecurityContext("read");
  const integration = (await getIntegrationStatuses()).find((item) => item.id === "eudr");
  return Response.json({
    integration,
    environments: {
      acceptance: { purpose: "Testing / homologation", legalValue: false, supported: true },
      production: { purpose: "Official EUDR Information System", legalValue: true, supported: false },
    },
    policy: "LIVE submission is fail-closed until the current Commission M2M schema, operator/representative credentials and explicit human approval are configured.",
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await requireSecurityContext("export");
  const body = await request.json() as { action?: string; reviewed?: boolean };
  if (body.action === "validate") { await audit(context, "EUDR_PREFLIGHT_VALIDATED", "eudr_gateway", "local", { reviewed: body.reviewed === true }); return Response.json({ ok: true, mode: "preflight", message: "Local pre-submission payload validation is available through the EUDR report workflow. No statement was transmitted." }); }
  return Response.json({ error: "Official transmission is not enabled in this build. Configure the current EUDR M2M specification and credentials first; LIVE also requires explicit human approval.", transmitted: false }, { status: 409 });
}

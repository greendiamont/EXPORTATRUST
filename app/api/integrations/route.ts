import { getIntegrationStatuses } from "../../../lib/integrations";
import { requireSecurityContext } from "../../../lib/security";

export async function GET() {
  await requireSecurityContext("read");
  try {
    const integrations = await getIntegrationStatuses();
    return Response.json({ integrations, checkedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Integration status is unavailable." }, { status: 500 });
  }
}

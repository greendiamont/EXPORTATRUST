import { discoverConfiguredExternalServices } from "../../../lib/agent-discovery";
import { requireSecurityContext } from "../../../lib/security";

export async function GET() {
  await requireSecurityContext("read");
  try {
    return Response.json(await discoverConfiguredExternalServices(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Agent discovery failed." }, { status: 500 });
  }
}

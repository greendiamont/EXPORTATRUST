import { syncGmail } from "../../../../../lib/gmail-integration";
import { reconcileGmailLogistics } from "../../../../../lib/gmail-logistics-reconciliation";

export async function POST() {
  try {
    const response = await syncGmail();
    if (!response.ok) return response;
    const reconciliation = await reconcileGmailLogistics();
    const payload = await response.json() as Record<string, unknown>;
    return Response.json({ ...payload, logisticsReconciliation: reconciliation });
  }
  catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao sincronizar o Gmail." }, { status: 500 });
  }
}

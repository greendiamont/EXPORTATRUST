import { createShipmentAdviceDraft, jsonError } from "../../../../../../../lib/private-agent-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await createShipmentAdviceDraft(request, Number(id));
  } catch (error) {
    return jsonError(error);
  }
}

import { decideApproval, jsonError } from "../../../../../../lib/private-agent-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return await decideApproval(request, id, "APPROVED");
  } catch (error) {
    return jsonError(error);
  }
}

import { approvals, jsonError } from "../../../../lib/private-agent-api";

export async function GET(request: Request) {
  try {
    return await approvals(request);
  } catch (error) {
    return jsonError(error);
  }
}

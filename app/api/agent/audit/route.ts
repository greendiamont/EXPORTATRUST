import { agentAudit, jsonError } from "../../../../lib/private-agent-api";

export async function GET(request: Request) {
  try {
    return await agentAudit(request);
  } catch (error) {
    return jsonError(error);
  }
}

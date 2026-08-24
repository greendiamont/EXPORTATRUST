import { dailyBrief, jsonError } from "../../../../lib/private-agent-api";

export async function GET(request: Request) {
  try {
    return await dailyBrief(request);
  } catch (error) {
    return jsonError(error);
  }
}

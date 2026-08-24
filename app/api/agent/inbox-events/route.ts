import { jsonError, receiveInboxEvent } from "../../../../lib/private-agent-api";

export async function POST(request: Request) {
  try {
    return await receiveInboxEvent(request);
  } catch (error) {
    return jsonError(error);
  }
}

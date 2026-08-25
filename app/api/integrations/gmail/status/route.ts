import { gmailStatus } from "../../../../../lib/gmail-integration";

export async function GET() {
  try {
    return Response.json(await gmailStatus(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Status do Gmail indisponível." }, { status: 500 });
  }
}

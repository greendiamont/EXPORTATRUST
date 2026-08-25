import { syncGmail } from "../../../../../lib/gmail-integration";

export async function POST() {
  try { return await syncGmail(); }
  catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao sincronizar o Gmail." }, { status: 500 });
  }
}

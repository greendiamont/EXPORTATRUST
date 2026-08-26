import { disconnectGmail } from "../../../../../lib/gmail-integration";

export async function POST() {
  try { return await disconnectGmail(); }
  catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao desconectar o Gmail." }, { status: 500 });
  }
}

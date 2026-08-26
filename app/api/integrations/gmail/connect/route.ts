import { beginGoogleOauth } from "../../../../../lib/gmail-integration";

export async function GET() {
  try { return await beginGoogleOauth(); }
  catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível iniciar a conexão com o Google." }, { status: 500 });
  }
}

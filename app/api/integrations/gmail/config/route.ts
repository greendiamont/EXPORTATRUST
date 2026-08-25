import { saveGmailConfig } from "../../../../../lib/gmail-integration";

export async function POST(request: Request) {
  try { return await saveGmailConfig(request); }
  catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao salvar as credenciais do Gmail." }, { status: 500 });
  }
}

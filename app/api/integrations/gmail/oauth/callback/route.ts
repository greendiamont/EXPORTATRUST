import { completeGoogleOauth } from "../../../../../../lib/gmail-integration";

export async function GET(request: Request) {
  try { return await completeGoogleOauth(request); }
  catch (error) {
    if (error instanceof Response) return error;
    const reason = encodeURIComponent(error instanceof Error ? error.message : "Falha na autorização do Gmail.");
    return Response.redirect(new URL(`/\?module=Integrações&gmail=error&reason=${reason}`, request.url), 302);
  }
}

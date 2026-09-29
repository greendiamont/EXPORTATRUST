import { requireSecurityContext } from "../../../../lib/security";
import { buildR2Manifest, createFullR2Archive } from "../../../../lib/r2-migration";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Falha desconhecida.";
}

export async function GET(request: Request) {
  try {
    await requireSecurityContext("export");
    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET) return Response.json({ error: "R2 indisponível." }, { status: 503 });

    const manifest = await buildR2Manifest(env.BUCKET);
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") ?? "manifest";

    if (mode === "manifest") {
      return Response.json(manifest, {
        headers: { "cache-control": "no-store" },
      });
    }

    if (mode !== "download") {
      return Response.json({ error: "Modo inválido. Use manifest ou download." }, { status: 400 });
    }

    const stream = createFullR2Archive(manifest, env.BUCKET);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        "content-type": "application/x-tar",
        "content-disposition": `attachment; filename="exportatrust-full-r2-${date}.tar"`,
        "cache-control": "no-store",
        "x-exportatrust-r2-objects": String(manifest.objectCount),
        "x-exportatrust-r2-bytes": String(manifest.totalBytes),
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: errorText(error) }, { status: 500 });
  }
}

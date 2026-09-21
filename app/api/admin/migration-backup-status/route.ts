import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { backupSnapshots } from "../../../../db/schema";
import { requireSecurityContext, sha256Hex } from "../../../../lib/security";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Falha ao verificar backup.";
}

export async function GET() {
  try {
    const context = await requireSecurityContext("export");
    const db = await getDb();
    const [latest] = await db
      .select()
      .from(backupSnapshots)
      .where(eq(backupSnapshots.organizationId, context.organizationId))
      .orderBy(desc(backupSnapshots.id))
      .limit(1);

    if (!latest) {
      return Response.json({
        ok: false,
        error: "Nenhum backup disponível.",
        organizationId: context.organizationId,
      }, { status: 404 });
    }

    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET) {
      return Response.json({ ok: false, error: "R2 binding BUCKET indisponível." }, { status: 503 });
    }

    const object = await env.BUCKET.get(latest.objectKey);
    if (!object) {
      return Response.json({
        ok: false,
        backupId: latest.id,
        objectKey: latest.objectKey,
        error: "Arquivo físico do backup não localizado no R2.",
      }, { status: 404 });
    }

    const bytes = new Uint8Array(await object.arrayBuffer());
    const actualHash = await sha256Hex(bytes);
    const hashMatches = actualHash === latest.contentHash;

    let payloadValid = false;
    let schemaVersion: number | null = null;
    let counts: Record<string, number> = {};
    let parseError = "";

    try {
      const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
        organization?: { id?: number };
        data?: Record<string, unknown>;
        restoration?: { schemaVersion?: number };
      };
      payloadValid = payload.organization?.id === context.organizationId;
      schemaVersion = Number(payload.restoration?.schemaVersion ?? 0) || null;
      counts = Object.fromEntries(
        Object.entries(payload.data ?? {}).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.length : 0,
        ]),
      );
    } catch (error) {
      parseError = errorText(error);
    }

    return Response.json({
      ok: hashMatches && payloadValid,
      checkedAt: new Date().toISOString(),
      organization: {
        id: context.organizationId,
        slug: context.organizationSlug,
        name: context.organizationName,
      },
      backup: {
        id: latest.id,
        objectKey: latest.objectKey,
        createdAt: latest.createdAt,
        recordedSizeBytes: latest.sizeBytes,
        actualSizeBytes: bytes.byteLength,
        recordedSha256: latest.contentHash,
        actualSha256: actualHash,
        hashMatches,
        payloadValid,
        schemaVersion,
        counts,
        parseError: parseError || null,
      },
      safety: {
        mode: "read-only",
        destructiveActions: false,
        d1Operations: ["SELECT"],
        r2Operations: ["GET"],
      },
    }, {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ ok: false, error: errorText(error) }, { status: 500 });
  }
}

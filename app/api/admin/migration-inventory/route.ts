import { requireSecurityContext } from "../../../../lib/security";

type TableRow = { name: string };
type CountRow = { count: number };

function safeIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQLite identifier: ${value}`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

async function inventoryD1(database: D1Database) {
  const tableResult = await database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all<TableRow>();

  const tables = [];
  for (const row of tableResult.results ?? []) {
    const tableName = row.name;
    const identifier = safeIdentifier(tableName);
    const count = await database.prepare(`SELECT COUNT(*) AS count FROM ${identifier}`).first<CountRow>();
    tables.push({ name: tableName, rows: Number(count?.count ?? 0) });
  }

  return {
    tableCount: tables.length,
    totalRows: tables.reduce((sum, table) => sum + table.rows, 0),
    tables,
  };
}

async function inventoryR2(bucket: R2Bucket) {
  let cursor: string | undefined;
  let objectCount = 0;
  let totalBytes = 0;
  const prefixes = new Map<string, { objects: number; bytes: number }>();
  const samples: Array<{ key: string; size: number; uploaded?: string }> = [];

  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await bucket.list({ limit: 1000, cursor });
    for (const object of page.objects) {
      objectCount += 1;
      totalBytes += object.size;
      const prefix = object.key.split("/")[0] || "(root)";
      const current = prefixes.get(prefix) ?? { objects: 0, bytes: 0 };
      current.objects += 1;
      current.bytes += object.size;
      prefixes.set(prefix, current);

      if (samples.length < 25) {
        samples.push({
          key: object.key,
          size: object.size,
          uploaded: object.uploaded?.toISOString(),
        });
      }
    }

    if (!page.truncated) {
      cursor = undefined;
      break;
    }

    cursor = page.cursor;
    if (!cursor) break;
  }

  return {
    objectCount,
    totalBytes,
    prefixes: [...prefixes.entries()]
      .map(([prefix, value]) => ({ prefix, ...value }))
      .sort((a, b) => b.objects - a.objects),
    samples,
    complete: !cursor,
  };
}

export async function GET() {
  try {
    const context = await requireSecurityContext("export");
    const { env } = await import("cloudflare:workers");

    if (!env.DB) {
      return Response.json({ error: "D1 binding DB indisponível." }, { status: 503 });
    }
    if (!env.BUCKET) {
      return Response.json({ error: "R2 binding BUCKET indisponível." }, { status: 503 });
    }

    const [d1, r2] = await Promise.all([
      inventoryD1(env.DB),
      inventoryR2(env.BUCKET),
    ]);

    return Response.json({
      generatedAt: new Date().toISOString(),
      baseline: {
        repository: "greendiamont/EXPORTATRUST",
        branch: "main",
        commit: "fbfd2f5b99cf9112ef5ea11c9265f01d5bde587b",
      },
      organization: {
        id: context.organizationId,
        slug: context.organizationSlug,
        name: context.organizationName,
      },
      d1,
      r2,
      safety: {
        mode: "read-only",
        destructiveActions: false,
      },
    }, {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({
      error: error instanceof Error ? error.message : "Falha ao gerar inventário de migração.",
    }, { status: 500 });
  }
}

import { requireSecurityContext } from "../../../../lib/security";

type CountRow = { count: number };

const KNOWN_APP_TABLES = [
  "organizations",
  "app_users",
  "organization_memberships",
  "rural_properties",
  "forest_documents",
  "suppliers",
  "product_traceability_catalog",
  "importer_clients",
  "master_products",
  "deduplication_queue",
  "operations",
  "operation_documents",
  "operation_stage_settings",
  "operation_partners",
  "exception_actions",
  "industrial_plans",
  "agent_services",
  "agent_operation_settings",
  "agent_jobs",
  "agent_ledger",
  "agent_reputation",
  "agent_credentials",
  "agent_events",
  "operation_timeline",
  "agent_approvals",
  "payment_transactions",
  "export_control_settings",
  "export_milestones",
  "operation_tasks",
  "client_notifications",
  "shipment_advices",
  "shipment_tracking_events",
  "country_compliance_checks",
  "asana_import_candidates",
  "audit_logs",
  "document_access_tokens",
  "backup_snapshots",
  "pdf_integrity_records",
  "legal_acceptances",
  "system_events",
  "gmail_connections",
  "google_oauth_states",
  "gmail_oauth_configs"
] as const;

async function inventoryD1(database: D1Database) {
  const tables: Array<{
    name: string;
    rows: number | null;
    status: "ok" | "missing-or-unreadable";
    error?: string;
  }> = [];

  for (const tableName of KNOWN_APP_TABLES) {
    try {
      const result = await database.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).first<CountRow>();
      tables.push({
        name: tableName,
        rows: Number(result?.count ?? 0),
        status: "ok",
      });
    } catch (error) {
      tables.push({
        name: tableName,
        rows: null,
        status: "missing-or-unreadable",
        error: error instanceof Error ? error.message : "D1 table not readable",
      });
    }
  }

  const readable = tables.filter((table) => table.status === "ok");
  const unreadable = tables.filter((table) => table.status !== "ok");

  return {
    source: "known-app-table-allowlist",
    expectedTableCount: KNOWN_APP_TABLES.length,
    readableTableCount: readable.length,
    unreadableTableCount: unreadable.length,
    totalRows: readable.reduce((sum, table) => sum + (table.rows ?? 0), 0),
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

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Unknown inventory error";
}

export async function GET() {
  try {
    const context = await requireSecurityContext("export");
    const { env } = await import("cloudflare:workers");

    const d1 = env.DB
      ? await inventoryD1(env.DB).catch((error) => ({
          status: "error" as const,
          error: errorText(error),
          source: "known-app-table-allowlist",
        }))
      : {
          status: "unavailable" as const,
          error: "D1 binding DB indisponível.",
        };

    const r2 = env.BUCKET
      ? await inventoryR2(env.BUCKET).catch((error) => ({
          status: "error" as const,
          error: errorText(error),
        }))
      : {
          status: "unavailable" as const,
          error: "R2 binding BUCKET indisponível.",
        };

    return Response.json({
      generatedAt: new Date().toISOString(),
      baseline: {
        repository: "greendiamont/EXPORTATRUST",
        branch: "main",
        commit: "fbfd2f5b99cf9112ef5ea11c9265f01d5bde587b",
      },
      runtime: {
        inventoryVersion: 3,
        schemaIntrospection: false,
        d1Binding: Boolean(env.DB),
        r2Binding: Boolean(env.BUCKET),
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
        statements: ["SELECT COUNT(*)"],
        r2Operations: ["LIST"],
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
      error: errorText(error),
      diagnostic: {
        stage: "authentication-or-runtime-binding",
        inventoryVersion: 3,
      },
    }, { status: 500 });
  }
}

import { requireSecurityContext, sha256Hex } from "../../../../lib/security";

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

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Unknown export error";
}

export async function GET() {
  try {
    const context = await requireSecurityContext("export");
    const { env } = await import("cloudflare:workers");
    if (!env.DB) {
      return Response.json({ error: "D1 binding DB indisponível." }, { status: 503 });
    }

    const tables: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};
    const errors: Array<{ table: string; error: string }> = [];

    for (const tableName of KNOWN_APP_TABLES) {
      try {
        const result = await env.DB.prepare(`SELECT * FROM "${tableName}"`).all<Record<string, unknown>>();
        const rows = result.results ?? [];
        tables[tableName] = rows;
        counts[tableName] = rows.length;
      } catch (error) {
        tables[tableName] = [];
        counts[tableName] = 0;
        errors.push({ table: tableName, error: errorText(error) });
      }
    }

    if (errors.length) {
      return Response.json({
        ok: false,
        error: "Uma ou mais tabelas não puderam ser exportadas.",
        errors,
        safety: { mode: "read-only", statements: ["SELECT *"] },
      }, { status: 500 });
    }

    const generatedAt = new Date().toISOString();
    const payloadWithoutHash = {
      format: "ExportaTrust Full D1 Export v1",
      generatedAt,
      organization: {
        id: context.organizationId,
        slug: context.organizationSlug,
        name: context.organizationName,
      },
      schema: {
        expectedTableCount: KNOWN_APP_TABLES.length,
        exportedTableCount: Object.keys(tables).length,
      },
      counts,
      totalRows: Object.values(counts).reduce((sum, value) => sum + value, 0),
      tables,
      safety: {
        mode: "read-only",
        destructiveActions: false,
        statements: ["SELECT *"],
      },
    };

    const canonicalJson = JSON.stringify(payloadWithoutHash);
    const sha256 = await sha256Hex(canonicalJson);
    const payload = {
      ...payloadWithoutHash,
      integrity: {
        algorithm: "SHA-256",
        payloadSha256: sha256,
        hashScope: "JSON.stringify(payload excluding integrity)",
      },
    };

    const date = generatedAt.slice(0, 10);
    return new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="exportatrust-full-d1-${date}.json"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-exportatrust-sha256": sha256,
        "x-exportatrust-table-count": String(KNOWN_APP_TABLES.length),
        "x-exportatrust-row-count": String(payloadWithoutHash.totalRows),
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ ok: false, error: errorText(error) }, { status: 500 });
  }
}

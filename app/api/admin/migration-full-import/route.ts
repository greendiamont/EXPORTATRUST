import { requireSecurityContext, sha256Hex, type SecurityContext } from "../../../../lib/security";

const KNOWN_APP_TABLES = [
  "organizations","app_users","organization_memberships","rural_properties","forest_documents",
  "suppliers","product_traceability_catalog","importer_clients","master_products","deduplication_queue",
  "operations","operation_documents","operation_stage_settings","operation_partners","exception_actions",
  "industrial_plans","agent_services","agent_operation_settings","agent_jobs","agent_ledger",
  "agent_reputation","agent_credentials","agent_events","operation_timeline","agent_approvals",
  "payment_transactions","export_control_settings","export_milestones","operation_tasks","client_notifications",
  "shipment_advices","shipment_tracking_events","country_compliance_checks","asana_import_candidates","audit_logs",
  "document_access_tokens","backup_snapshots","pdf_integrity_records","legal_acceptances","system_events",
  "gmail_connections","google_oauth_states","gmail_oauth_configs"
] as const;

type ExportPayload = {
  format?: string;
  generatedAt?: string;
  schema?: { expectedTableCount?: number; exportedTableCount?: number };
  counts?: Record<string, number>;
  totalRows?: number;
  tables?: Record<string, Array<Record<string, unknown>>>;
  integrity?: { algorithm?: string; payloadSha256?: string; hashScope?: string };
};

function q(name: string) {
  return '"' + name.replaceAll('"', '""') + '"';
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Falha desconhecida.";
}

// Ambientes de destino que podem receber a cópia integral. Produção nunca.
const IMPORT_ENVIRONMENTS = new Set(["staging", "homologation"]);

async function requireStaging() {
  const { env } = await import("cloudflare:workers");
  const appEnv = String((env as unknown as Record<string, unknown>).APP_ENV ?? "");
  if (!IMPORT_ENVIRONMENTS.has(appEnv)) {
    throw new Response(JSON.stringify({ error: "Importação integral permitida somente em staging ou homologação." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return env;
}

async function validatePayload(payload: ExportPayload, database: D1Database) {
  if (payload.format !== "ExportaTrust Full D1 Export v1") throw new Error("Formato de exportação inválido.");
  if (payload.schema?.expectedTableCount !== KNOWN_APP_TABLES.length || payload.schema?.exportedTableCount !== KNOWN_APP_TABLES.length) {
    throw new Error("O arquivo não contém as 43 tabelas esperadas.");
  }
  if (!payload.tables || !payload.counts || !payload.integrity?.payloadSha256) throw new Error("Manifesto de exportação incompleto.");

  const receivedNames = Object.keys(payload.tables);
  const missing = KNOWN_APP_TABLES.filter((name) => !receivedNames.includes(name));
  const unexpected = receivedNames.filter((name) => !KNOWN_APP_TABLES.includes(name as typeof KNOWN_APP_TABLES[number]));
  if (missing.length || unexpected.length) throw new Error(`Allowlist divergente. missing=${missing.join(",")} unexpected=${unexpected.join(",")}`);

  const { integrity, ...withoutIntegrity } = payload;
  const actualHash = await sha256Hex(JSON.stringify(withoutIntegrity));
  if (actualHash !== integrity.payloadSha256) throw new Error("SHA-256 do payload não confere.");

  let totalRows = 0;
  const countErrors: string[] = [];
  const schemaErrors: string[] = [];

  for (const table of KNOWN_APP_TABLES) {
    const rows = payload.tables[table] ?? [];
    totalRows += rows.length;
    if (payload.counts[table] !== rows.length) countErrors.push(`${table}: manifesto=${payload.counts[table]} real=${rows.length}`);

    const info = await database.prepare(`PRAGMA table_info(${q(table)})`).all<{ name: string }>();
    const columns = new Set((info.results ?? []).map((item) => item.name));
    if (!columns.size) {
      schemaErrors.push(`${table}: tabela ausente no destino`);
      continue;
    }
    for (const row of rows) {
      for (const column of Object.keys(row)) {
        if (!columns.has(column)) {
          schemaErrors.push(`${table}: coluna ausente no destino: ${column}`);
          break;
        }
      }
      if (schemaErrors.length > 100) break;
    }
  }

  if (countErrors.length) throw new Error(`Contagens inválidas: ${countErrors.join("; ")}`);
  if (totalRows !== payload.totalRows) throw new Error(`Total de registros divergente: manifesto=${payload.totalRows} real=${totalRows}`);
  if (schemaErrors.length) throw new Error(`Schema incompatível: ${schemaErrors.join("; ")}`);

  return { hash: actualHash, totalRows };
}

async function destinationState(database: D1Database) {
  const counts: Record<string, number> = {};
  for (const table of KNOWN_APP_TABLES) {
    const row = await database.prepare(`SELECT COUNT(*) AS count FROM ${q(table)}`).first<{ count: number }>();
    counts[table] = Number(row?.count ?? 0);
  }
  const allowedBootstrap = new Set(["organizations", "app_users", "organization_memberships"]);
  // O primeiro acesso ao destino já grava o backup diário e sua auditoria; esses
  // poucos registros automáticos são sobrepostos pela cópia (upsert por id).
  const automaticOnFirstAccess = new Set(["audit_logs", "backup_snapshots"]);
  const unexpectedRows = Object.entries(counts).filter(([table, count]) => count > 0 && !allowedBootstrap.has(table) && !(automaticOnFirstAccess.has(table) && count <= 10));
  if (unexpectedRows.length) {
    throw new Error(`O staging não está vazio para importação inicial: ${unexpectedRows.map(([t,c]) => `${t}=${c}`).join(", ")}`);
  }
  if ((counts.organizations ?? 0) > 1 || (counts.app_users ?? 0) > 1 || (counts.organization_memberships ?? 0) > 1) {
    throw new Error("Bootstrap do staging possui mais registros que o esperado.");
  }
  return counts;
}

function orderRows(table: string, rows: Array<Record<string, unknown>>) {
  if (table !== "operation_tasks") return rows;
  const pending = [...rows];
  const ordered: Array<Record<string, unknown>> = [];
  const inserted = new Set<number>();
  for (let pass = 0; pass < rows.length + 2 && pending.length; pass++) {
    let changed = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const parent = Number(pending[i].parent_task_id ?? 0);
      if (!parent || inserted.has(parent)) {
        const [row] = pending.splice(i, 1);
        ordered.push(row);
        inserted.add(Number(row.id));
        changed = true;
      }
    }
    if (!changed) break;
  }
  return ordered.concat(pending);
}

type CoercionLog = Array<{ table: string; id: unknown; column: string; from: unknown; to: unknown }>;

/**
 * O SQLite aceita texto em coluna numérica (ex.: "" em importer_client_id); o
 * PostgreSQL não. Ajusta só esses valores e registra cada ajuste no relatório.
 */
async function numericColumns(database: D1Database, table: string) {
  const info = await database.prepare(`PRAGMA table_info(${q(table)})`).all<{ name: string; type: string; notnull: number }>();
  const columns = new Map<string, boolean>();
  for (const column of info.results ?? []) {
    if (/INT|REAL|DOUBLE|NUMERIC|FLOAT|DECIMAL/i.test(String(column.type ?? ""))) columns.set(column.name, Number(column.notnull) === 1);
  }
  return columns;
}

function coerceRow(table: string, row: Record<string, unknown>, numeric: Map<string, boolean>, log: CoercionLog) {
  const next = { ...row };
  for (const [column, notNull] of numeric) {
    const value = next[column];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    const parsed = trimmed === "" ? NaN : Number(trimmed);
    const to = Number.isFinite(parsed) ? parsed : notNull ? 0 : null;
    next[column] = to;
    if (!Number.isFinite(parsed)) log.push({ table, id: row.id, column, from: value, to });
  }
  return next;
}

async function upsertRows(database: D1Database, table: string, sourceRows: Array<Record<string, unknown>>, coercions: CoercionLog) {
  const numeric = await numericColumns(database, table);
  const rows = numeric.size ? sourceRows.map((row) => coerceRow(table, row, numeric, coercions)) : sourceRows;
  const ordered = orderRows(table, rows);
  const chunkSize = 75;
  for (let start = 0; start < ordered.length; start += chunkSize) {
    const statements = ordered.slice(start, start + chunkSize).map((row) => {
      const columns = Object.keys(row);
      if (!columns.includes("id")) throw new Error(`${table}: linha sem id; importação interrompida.`);
      const placeholders = columns.map(() => "?").join(",");
      const updates = columns.filter((column) => column !== "id").map((column) => `${q(column)}=excluded.${q(column)}`).join(",");
      const sql = `INSERT INTO ${q(table)} (${columns.map(q).join(",")}) VALUES (${placeholders}) ON CONFLICT("id") DO UPDATE SET ${updates}`;
      return database.prepare(sql).bind(...columns.map((column) => row[column] as D1PreparedStatement["bind"] extends (...args: infer A) => unknown ? A[number] : unknown));
    });
    if (statements.length) await database.batch(statements);
  }
}

/**
 * A cópia substitui os usuários do destino pelos da origem. Quem executou a
 * importação continua administrador da organização 1 para poder conferir os dados
 * (na produção de referência o perfil de origem pode ser outro).
 */
async function keepOperatorAsAdministrator(database: D1Database, context: SecurityContext) {
  const user = await database.prepare("SELECT id FROM app_users WHERE email = ? LIMIT 1").bind(context.email).first<{ id: number }>();
  let userId = user?.id;
  if (!userId) {
    const created = await database.prepare("INSERT INTO app_users (email, full_name, identity_provider) VALUES (?, ?, ?) RETURNING id").bind(context.email, context.fullName, "migration-operator").first<{ id: number }>();
    userId = created?.id;
  }
  if (!userId) return { email: context.email, role: "indefinido" };
  const membership = await database.prepare("SELECT id, role FROM organization_memberships WHERE organization_id = 1 AND user_id = ? LIMIT 1").bind(userId).first<{ id: number; role: string }>();
  if (!membership) {
    await database.prepare("INSERT INTO organization_memberships (organization_id, user_id, role, status, invited_by) VALUES (1, ?, 'administrador', 'Ativo', 'migration-operator')").bind(userId).run();
    return { email: context.email, role: "administrador", previousRole: null };
  }
  if (membership.role !== "administrador") {
    await database.prepare("UPDATE organization_memberships SET role = 'administrador', status = 'Ativo' WHERE id = ?").bind(membership.id).run();
  }
  return { email: context.email, role: "administrador", previousRole: membership.role };
}

export async function GET() {
  try {
    await requireSecurityContext("export");
    await requireStaging();
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>ExportaTrust · Import D1</title></head>
<body style="font-family:system-ui;max-width:760px;margin:40px auto;padding:0 20px">
<h1>Importação integral do banco · Staging/Homologação</h1>
<p>Selecione o JSON gerado por <code>migration-full-export</code>. Primeiro valide. A importação só será liberada se SHA-256, 43 tabelas, contagens, schema e estado vazio do V3 forem confirmados.</p>
<input id="file" type="file" accept=".json,application/json"><button id="validate">Validar</button><button id="import" disabled>Importar no V3</button>
<pre id="out" style="white-space:pre-wrap;background:#f5f5f5;padding:16px"></pre>
<script>
const f=document.getElementById('file'),out=document.getElementById('out'),imp=document.getElementById('import');
async function send(mode){
 const file=f.files[0]; if(!file){out.textContent='Selecione o arquivo JSON.';return;}
 out.textContent=mode==='dry-run'?'Validando...':'Importando... não feche esta página.';
 const res=await fetch('/api/admin/migration-full-import?mode='+mode+(mode==='import'?'&confirm=IMPORT_FULL_D1_V1':''),{method:'POST',headers:{'content-type':'application/json'},body:await file.text()});
 const txt=await res.text(); out.textContent=txt; if(res.ok&&mode==='dry-run')imp.disabled=false;
}
document.getElementById('validate').onclick=()=>send('dry-run');
imp.onclick=()=>send('import');
</script></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: errorText(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("export");
    const env = await requireStaging();
    const payload = await request.json() as ExportPayload;
    const validation = await validatePayload(payload, env.DB);
    const before = await destinationState(env.DB);
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") ?? "dry-run";

    if (mode !== "import") {
      return Response.json({
        ok: true,
        mode: "dry-run",
        generatedAt: payload.generatedAt,
        tables: KNOWN_APP_TABLES.length,
        totalRows: validation.totalRows,
        sha256: validation.hash,
        destinationBefore: before,
        readyToImport: true,
      });
    }

    if (url.searchParams.get("confirm") !== "IMPORT_FULL_D1_V1") {
      return Response.json({ error: "Confirmação explícita ausente." }, { status: 400 });
    }
    if (context.organizationId !== 1) return Response.json({ error: "Tenant inesperado para esta migração." }, { status: 409 });

    const coercions: CoercionLog = [];
    for (const table of KNOWN_APP_TABLES) {
      await upsertRows(env.DB, table, payload.tables?.[table] ?? [], coercions);
    }
    const operatorAccess = await keepOperatorAsAdministrator(env.DB, context);

    const after: Record<string, number> = {};
    const mismatches: Array<{ table: string; expected: number; actual: number }> = [];
    for (const table of KNOWN_APP_TABLES) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${q(table)}`).first<{ count: number }>();
      const actual = Number(row?.count ?? 0);
      const expected = payload.counts?.[table] ?? 0;
      after[table] = actual;
      if (actual !== expected) mismatches.push({ table, expected, actual });
    }

    return Response.json({
      ok: mismatches.length === 0,
      mode: "import",
      importedAt: new Date().toISOString(),
      sourceGeneratedAt: payload.generatedAt,
      sha256: validation.hash,
      expectedTotalRows: validation.totalRows,
      actualTotalRows: Object.values(after).reduce((sum, value) => sum + value, 0),
      mismatches,
      counts: after,
      operatorAccess,
      coercedValues: coercions.length,
      coercions: coercions.slice(0, 200),
    }, { status: mismatches.length ? 409 : 200 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ ok: false, error: errorText(error) }, { status: 500 });
  }
}

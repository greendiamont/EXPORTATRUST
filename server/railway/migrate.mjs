// Aplica as migrações drizzle (escritas para D1/SQLite) no PostgreSQL, na mesma
// ordem do `wrangler d1 migrations apply` (todos os .sql da pasta, ordem alfabética
// — o journal do drizzle não lista 0027/0028), registrando cada uma em `_exportatrust_pg_migrations`.
// Cada migração roda numa transação: ou entra inteira, ou nada muda.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { splitStatements, translate } from "./sql-translate.mjs";

// Ajustes pontuais onde o SQL do SQLite não é aceito pelo PostgreSQL.
const STATEMENT_OVERRIDES = {
  // PostgreSQL exige que colunas fora do GROUP BY estejam agregadas.
  "0021_master_clients_products_dedup": [
    ["SELECT `organization_id`, trim(`eu_importer`), lower(trim(`eu_importer`))", "SELECT `organization_id`, min(trim(`eu_importer`)), lower(trim(`eu_importer`))"],
    ["SELECT `organization_id`, trim(`product`), lower(trim(`product`))", "SELECT `organization_id`, min(trim(`product`)), lower(trim(`product`))"],
  ],
};

const FOREIGN_KEY = /,\s*FOREIGN KEY\s*\(([^)]*)\)\s*REFERENCES\s*("[^"]+"|\w+)\s*\(([^)]*)\)((?:\s+ON\s+(?:UPDATE|DELETE)\s+(?:NO ACTION|CASCADE|SET NULL|SET DEFAULT|RESTRICT))*)/gi;

/**
 * O SQLite aceita FOREIGN KEY para tabelas criadas depois; o PostgreSQL não.
 * Remove as FKs do CREATE TABLE e devolve-as como ALTER TABLE para o fim da migração.
 */
function deferForeignKeys(text) {
  const table = text.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|\w+)/i)?.[1];
  if (!table) return { text, deferred: [] };
  const deferred = [];
  const stripped = text.replace(FOREIGN_KEY, (_, columns, target, targetColumns, actions) => {
    deferred.push(`ALTER TABLE ${table} ADD FOREIGN KEY (${columns}) REFERENCES ${target} (${targetColumns})${actions}`);
    return "";
  });
  return { text: stripped, deferred };
}

export async function migrate({ connectionString, migrationsDir, log = console.log }) {
  const tags = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort().map((file) => file.slice(0, -4));
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // Evita duas instâncias migrando ao mesmo tempo (deploys sobrepostos).
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(`CREATE TABLE IF NOT EXISTS _exportatrust_pg_migrations (
      name text PRIMARY KEY,
      applied_at text NOT NULL DEFAULT (to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS'))
    )`);
    const applied = new Set((await client.query("SELECT name FROM _exportatrust_pg_migrations")).rows.map((row) => row.name));
    let count = 0;
    for (const tag of tags) {
      if (applied.has(tag)) continue;
      let script = await readFile(path.join(migrationsDir, `${tag}.sql`), "utf8");
      for (const [from, to] of STATEMENT_OVERRIDES[tag] ?? []) {
        if (!script.includes(from)) throw new Error(`Override de ${tag} não encontrou o trecho esperado.`);
        script = script.replace(from, to);
      }
      await client.query("BEGIN");
      try {
        const deferred = [];
        for (const statement of splitStatements(script)) {
          const translated = deferForeignKeys(translate(statement).text);
          await client.query(translated.text);
          deferred.push(...translated.deferred);
        }
        for (const statement of deferred) await client.query(statement);
        await client.query("INSERT INTO _exportatrust_pg_migrations (name) VALUES ($1)", [tag]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Falha na migração ${tag}: ${error.message}`, { cause: error });
      }
      count += 1;
      log(`[migrate] aplicada ${tag}`);
    }
    log(count ? `[migrate] ${count} migração(ões) aplicada(s).` : "[migrate] banco já está atualizado.");
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    await client.end();
  }
}

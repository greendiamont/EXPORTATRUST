// Adaptador com a API do Cloudflare D1 (prepare/bind/first/all/run/raw/batch/exec)
// executando em PostgreSQL. Permite que o código existente (rotas e drizzle-orm/d1)
// rode no Railway sem alterações.

import pg from "pg";
import { splitStatements, translate } from "./sql-translate.mjs";

// int8/numeric chegam como string no driver pg; o D1 devolve números.
pg.types.setTypeParser(20, (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
});
pg.types.setTypeParser(1700, (value) => Number(value));

function normalizeValue(value) {
  if (value === undefined) throw new TypeError("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
  if (value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return value;
}

function normalizeRow(row) {
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (Buffer.isBuffer(value)) row[key] = Array.from(value);
  }
  return row;
}

function meta(result, startedAt) {
  const changes = result.command === "SELECT" ? 0 : result.rowCount ?? 0;
  return {
    duration: Date.now() - startedAt,
    changes,
    last_row_id: 0,
    changed_db: changes > 0,
    rows_read: result.command === "SELECT" ? result.rowCount ?? 0 : 0,
    rows_written: changes,
    size_after: 0,
  };
}

const TRANSACTION_KINDS = new Set(["begin", "commit", "rollback", "savepoint", "release", "end"]);

async function execute(executor, sql, params, rowMode) {
  const { text, resyncTable, kind } = translate(sql);
  if (TRANSACTION_KINDS.has(kind)) {
    throw new Error("Transações interativas não são suportadas pelo adaptador D1; use DB.batch().");
  }
  const startedAt = Date.now();
  const result = await executor.query({ text, values: params, ...(rowMode ? { rowMode } : {}) });
  if (resyncTable) {
    // Inserções com id explícito não avançam a sequência no PostgreSQL (no SQLite
    // AUTOINCREMENT usa max(id)+1). Ressincroniza para evitar colisão futura.
    await executor.query({
      text: "SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM " +
        `"${resyncTable.replaceAll('"', '""')}"), 1))`,
      values: [resyncTable],
    }).catch(() => {});
  }
  return { result, startedAt };
}

class PreparedStatement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...values) {
    return new PreparedStatement(this.database, this.sql, values.map(normalizeValue));
  }

  async all() {
    const { result, startedAt } = await execute(this.database.pool, this.sql, this.params);
    return { success: true, results: result.rows.map(normalizeRow), meta: meta(result, startedAt) };
  }

  async run() {
    return this.all();
  }

  async first(column) {
    const { results } = await this.all();
    const row = results[0];
    if (!row) return null;
    if (column === undefined) return row;
    if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return row[column];
  }

  async raw(options = {}) {
    const { result } = await execute(this.database.pool, this.sql, this.params, "array");
    const rows = result.rows.map((row) => row.map((value) => (Buffer.isBuffer(value) ? Array.from(value) : value)));
    if (options.columnNames) return [result.fields.map((field) => field.name), ...rows];
    return rows;
  }

  /** Executa dentro de uma transação já aberta (usado por batch). */
  async runOn(client) {
    const { result, startedAt } = await execute(client, this.sql, this.params);
    return { success: true, results: result.rows.map(normalizeRow), meta: meta(result, startedAt) };
  }
}

export class D1PostgresDatabase {
  /** @param {import("pg").PoolConfig} config */
  constructor(config) {
    this.pool = new pg.Pool(config);
    this.pool.on("error", (error) => console.error("[d1-postgres] erro no pool", error));
  }

  prepare(sql) {
    return new PreparedStatement(this, sql);
  }

  async batch(statements) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const results = [];
      for (const statement of statements) results.push(await statement.runOn(client));
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async exec(script) {
    const statements = splitStatements(script);
    const startedAt = Date.now();
    for (const sql of statements) await execute(this.pool, sql, []);
    return { count: statements.length, duration: Date.now() - startedAt };
  }

  async dump() {
    throw new Error("DB.dump() não é suportado no PostgreSQL; use pg_dump.");
  }

  withSession() {
    return this;
  }

  async close() {
    await this.pool.end();
  }
}

// Tradução de SQL no dialeto SQLite/D1 para PostgreSQL.
//
// O código da aplicação foi escrito para Cloudflare D1 (SQLite). No Railway o
// banco é PostgreSQL; em vez de reescrever todas as rotas, o adaptador D1
// (d1-postgres.mjs) passa cada instrução por esta tradução. O escopo é
// deliberadamente pequeno e cobre apenas os padrões usados no repositório:
// placeholders `?`, identificadores com crase, DDL com AUTOINCREMENT/real,
// CURRENT_TIMESTAMP no formato SQLite, INSERT OR IGNORE, PRAGMA table_info,
// LIKE case-insensitive e aliases camelCase.

const SQLITE_TIMESTAMP = "(to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS'))";

/**
 * Separa literais/identificadores/comentários do código SQL para que as
 * substituições por regex nunca alterem conteúdo entre aspas.
 * Retorna o SQL "mascarado" e a lista de trechos protegidos.
 */
function mask(sql) {
  const tokens = [];
  let out = "";
  let i = 0;
  const protect = (text) => {
    tokens.push(text);
    return `\u0000${tokens.length - 1}\u0000`;
  };
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j += 1;
      }
      out += protect(sql.slice(i, j + 1));
      i = j + 1;
    } else if (ch === '"' || ch === "`") {
      const close = sql.indexOf(ch, i + 1);
      const end = close === -1 ? sql.length : close;
      const name = sql.slice(i + 1, end).replaceAll('"', '""');
      out += protect(`"${name}"`);
      i = end + 1;
    } else if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
    } else if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return { masked: out, tokens };
}

function unmask(masked, tokens) {
  return masked.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

function tokenText(masked, tokens) {
  const match = masked.match(/^\u0000(\d+)\u0000$/);
  const raw = match ? tokens[Number(match[1])] : masked;
  return raw.replace(/^["'`]|["'`]$/g, "");
}

function pragmaTableInfo(table) {
  const literal = `'${table.replaceAll("'", "''")}'`;
  return [
    "SELECT (c.ordinal_position - 1)::int AS cid, c.column_name AS name, upper(c.data_type) AS type,",
    "CASE WHEN c.is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull, c.column_default AS dflt_value,",
    "CASE WHEN EXISTS (SELECT 1 FROM information_schema.table_constraints tc",
    "JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema",
    `WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = current_schema() AND tc.table_name = ${literal} AND k.column_name = c.column_name) THEN 1 ELSE 0 END AS pk`,
    `FROM information_schema.columns c WHERE c.table_schema = current_schema() AND c.table_name = ${literal} ORDER BY c.ordinal_position`,
  ].join(" ");
}

/**
 * No SQLite, NULL na coluna `integer PRIMARY KEY` gera o próximo id (o drizzle
 * usa isso). No PostgreSQL vira DEFAULT. Opera sobre o SQL mascarado.
 */
function nullIdToDefault(masked, idIndex) {
  const valuesAt = masked.search(/\bVALUES\b/i);
  // INSERT ... SELECT: ids vêm da consulta.
  if (valuesAt === -1) return { masked, explicitId: true };
  let explicitId = false;
  let i = valuesAt + "VALUES".length;
  let out = masked.slice(0, i);
  while (i < masked.length) {
    const ch = masked[i];
    if (ch !== "(") {
      // Fim da lista de tuplas (ON CONFLICT, RETURNING...): copia o resto.
      if (/[A-Za-z]/.test(ch)) return { masked: out + masked.slice(i), explicitId };
      out += ch;
      i += 1;
      continue;
    }
    // Lê uma tupla, separando valores por vírgula de nível 1.
    let depth = 0;
    let start = i + 1;
    const values = [];
    let j = i;
    for (; j < masked.length; j += 1) {
      if (masked[j] === "(") depth += 1;
      else if (masked[j] === ")") {
        depth -= 1;
        if (depth === 0) break;
      } else if (masked[j] === "," && depth === 1) {
        values.push(masked.slice(start, j));
        start = j + 1;
      }
    }
    values.push(masked.slice(start, j));
    if (values[idIndex] !== undefined && /^\s*null\s*$/i.test(values[idIndex])) values[idIndex] = " DEFAULT";
    else explicitId = true;
    out += `(${values.join(",")})`;
    i = j + 1;
  }
  return { masked: out, explicitId };
}

/** Divide um script em instruções, respeitando literais e comentários. */
export function splitStatements(script) {
  const { masked, tokens } = mask(script.replaceAll("--> statement-breakpoint", ";"));
  return masked
    .split(";")
    .map((part) => unmask(part, tokens).trim())
    .filter(Boolean);
}

const cache = new Map();

/**
 * @param {string} sql SQL no dialeto SQLite/D1
 * @returns {{ text: string, resyncTable: string | null, kind: string }}
 */
export function translate(sql) {
  const cached = cache.get(sql);
  if (cached) return cached;
  const result = translateUncached(sql);
  if (cache.size > 5000) cache.clear();
  cache.set(sql, result);
  return result;
}

function translateUncached(sql) {
  const { masked: rawMasked, tokens } = mask(sql);
  let masked = rawMasked.trim().replace(/;\s*$/, "");

  const pragma = masked.match(/^PRAGMA\s+(\w+)\s*(?:\(\s*([^)]*?)\s*\))?$/i);
  if (pragma) {
    if (pragma[1].toLowerCase() === "table_info" && pragma[2]) {
      return { text: pragmaTableInfo(tokenText(pragma[2], tokens)), resyncTable: null, kind: "select" };
    }
    // Demais PRAGMAs (foreign_keys, etc.) não têm equivalente: viram no-op.
    return { text: "SELECT 1 WHERE false", resyncTable: null, kind: "select" };
  }

  if (/^INSERT\s+OR\s+REPLACE\b/i.test(masked) || /^REPLACE\s+INTO\b/i.test(masked)) {
    throw new Error("INSERT OR REPLACE não é suportado no adaptador PostgreSQL; use ON CONFLICT ... DO UPDATE.");
  }

  const kind = (masked.match(/^\s*(\w+)/)?.[1] ?? "").toLowerCase();
  const isDdl = /^(CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(masked);

  if (isDdl) {
    masked = masked
      .replace(/\binteger\s+PRIMARY\s+KEY(\s+AUTOINCREMENT)?\b/gi, "bigserial PRIMARY KEY")
      .replace(/\bAUTOINCREMENT\b/gi, "")
      .replace(/\binteger\b/gi, "bigint")
      .replace(/\breal\b/gi, "double precision")
      .replace(/\bblob\b/gi, "bytea");
  } else {
    // SQLite: LIKE é case-insensitive para ASCII.
    masked = masked.replace(/\bLIKE\b/gi, "ILIKE");
    // PostgreSQL rebaixa aliases não citados; preserva camelCase como no SQLite.
    masked = masked.replace(/\b(AS)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi, (match, keyword, alias) =>
      /[a-z]/.test(alias) && /[A-Z]/.test(alias) ? `${keyword} "${alias}"` : match);
    masked = masked.replace(/\bifnull\s*\(/gi, "coalesce(").replace(/\binstr\s*\(/gi, "strpos(");
  }

  masked = masked.replace(/\bCURRENT_TIMESTAMP\b/gi, SQLITE_TIMESTAMP);
  // No SQLite TRUE/FALSE são 1/0 e todas as colunas booleanas são integer.
  masked = masked.replace(/\bTRUE\b/gi, "1").replace(/\bFALSE\b/gi, "0");

  let resyncTable = null;
  const insert = masked.match(/^INSERT\s+(OR\s+IGNORE\s+)?INTO\s+(\u0000\d+\u0000|[A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/i);
  if (insert) {
    const columns = insert[3].split(",").map((column) => tokenText(column.trim(), tokens).toLowerCase());
    const idIndex = columns.indexOf("id");
    if (idIndex !== -1) {
      const converted = nullIdToDefault(masked, idIndex);
      masked = converted.masked;
      // Só ressincroniza a sequência se algum id explícito foi informado.
      if (converted.explicitId) resyncTable = tokenText(insert[2], tokens);
    }
    if (insert[1]) {
      masked = masked.replace(/^INSERT\s+OR\s+IGNORE\s+INTO/i, "INSERT INTO");
      const returning = masked.search(/\bRETURNING\b/i);
      masked = returning === -1
        ? `${masked} ON CONFLICT DO NOTHING`
        : `${masked.slice(0, returning)}ON CONFLICT DO NOTHING ${masked.slice(returning)}`;
    }
  }

  // Placeholders: `?` sequencial e `?NNN` numerado (D1 aceita ambos; ?N mapeia direto para $N).
  let sequential = 0;
  let numbered = false;
  masked = masked.replace(/\?(\d+)?/g, (_, digits) => {
    if (digits) {
      numbered = true;
      return `$${Number(digits)}`;
    }
    sequential += 1;
    return `$${sequential}`;
  });
  if (numbered && sequential) throw new Error("Mistura de placeholders `?` e `?N` não é suportada.");

  return { text: unmask(masked, tokens), resyncTable, kind };
}

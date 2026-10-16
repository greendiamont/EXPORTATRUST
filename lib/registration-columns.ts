// Colunas novas dos cadastros (migração 0029). Ambientes em que a migração ainda
// não rodou recebem as colunas na primeira chamada, como já é feito com bank_details.

const COLUMNS: Array<[table: string, column: string]> = [
  ["suppliers", "address"],
  ["importer_clients", "notify_party"],
  ["importer_clients", "preferred_incoterm"],
  ["importer_clients", "preferred_currency"],
  ["master_products", "sales_unit"],
  ["master_products", "packaging"],
];

let ready: Promise<void> | null = null;

export function ensureRegistrationColumns() {
  if (ready) return ready;
  ready = (async () => {
    const { env } = await import("cloudflare:workers");
    const byTable = new Map<string, string[]>();
    for (const [table, column] of COLUMNS) byTable.set(table, [...(byTable.get(table) ?? []), column]);
    for (const [table, columns] of byTable) {
      const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      const existing = new Set((info.results ?? []).map((row) => row.name));
      if (!existing.size) continue; // tabela criada depois pelo bootstrap da própria rota
      for (const column of columns) {
        if (!existing.has(column)) await env.DB.prepare(`ALTER TABLE ${table} ADD ${column} text DEFAULT '' NOT NULL`).run();
      }
    }
  })().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}

/** Copia só os campos enviados: quem não conhece um campo não o apaga. */
export function presentText(body: Record<string, unknown>, keys: string[]) {
  const values: Record<string, string> = {};
  for (const key of keys) if (key in body) values[key] = String(body[key] ?? "").trim();
  return values;
}

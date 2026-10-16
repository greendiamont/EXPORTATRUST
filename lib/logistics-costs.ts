// Prévia dos custos logísticos do processo (para o financeiro estimar a margem do pedido).
// Gravada em operations.logistics_costs_json; o total é sempre calculado a partir dos itens.

export const LOGISTICS_COST_FIELDS = [
  ["inlandFreight", "Frete rodoviário até o porto"],
  ["portCharges", "Despesas portuárias / THC"],
  ["customsBroker", "Despachante e documentação"],
  ["oceanFreight", "Frete marítimo / internacional"],
  ["insurance", "Seguro"],
  ["other", "Outros custos"],
] as const;

export type LogisticsCostKey = (typeof LOGISTICS_COST_FIELDS)[number][0];
export const LOGISTICS_CURRENCIES = ["BRL", "USD"] as const;
// Cada custo tem a sua moeda (R$ ou US$); o total sai nas duas, usando o câmbio informado
// (R$ por US$ 1). `currency` é a moeda padrão (registros antigos tinham uma moeda só).
export type LogisticsCosts = Record<LogisticsCostKey, number> & { currency: string; currencies: Record<LogisticsCostKey, string>; exchangeRate: number; notes: string };

const amount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
};
const currencyOf = (value: unknown, fallback: string) => {
  const code = String(value ?? "").trim().toUpperCase().slice(0, 3);
  return code || fallback;
};

export function sanitizeLogisticsCosts(input: unknown): LogisticsCosts {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const currency = currencyOf(source.currency, "BRL");
  const given = source.currencies && typeof source.currencies === "object" ? source.currencies as Record<string, unknown> : {};
  const rate = Number(source.exchangeRate);
  const costs = { currency, notes: String(source.notes ?? "").trim().slice(0, 2000), exchangeRate: Number.isFinite(rate) && rate > 0 ? Math.round(rate * 10000) / 10000 : 0, currencies: {} } as LogisticsCosts;
  for (const [key] of LOGISTICS_COST_FIELDS) {
    costs[key] = amount(source[key]);
    costs.currencies[key] = currencyOf(given[key], currency);
  }
  return costs;
}

export function parseLogisticsCosts(json: unknown): LogisticsCosts {
  try {
    return sanitizeLogisticsCosts(typeof json === "string" ? JSON.parse(json || "{}") : json);
  } catch {
    return sanitizeLogisticsCosts({});
  }
}

/** Soma por moeda (sem conversão). */
export function logisticsByCurrency(costs: LogisticsCosts) {
  const sums: Record<string, number> = {};
  for (const [key] of LOGISTICS_COST_FIELDS) if (costs[key]) sums[costs.currencies[key]] = (sums[costs.currencies[key]] ?? 0) + costs[key];
  return sums;
}

/** Total convertido para uma moeda (BRL ou USD) usando o câmbio; null se faltar câmbio. */
export function logisticsTotalIn(costs: LogisticsCosts, target: string): number | null {
  let total = 0;
  for (const [code, value] of Object.entries(logisticsByCurrency(costs))) {
    if (code === target) total += value;
    else if (costs.exchangeRate && code === "USD" && target === "BRL") total += value * costs.exchangeRate;
    else if (costs.exchangeRate && code === "BRL" && target === "USD") total += value / costs.exchangeRate;
    else return null;
  }
  return Math.round(total * 100) / 100;
}

/** Total sem conversão (soma simples de todos os valores) — usado só para saber se há custos. */
export function logisticsTotal(costs: LogisticsCosts) {
  return LOGISTICS_COST_FIELDS.reduce((sum, [key]) => sum + (costs[key] || 0), 0);
}

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
export type LogisticsCosts = Record<LogisticsCostKey, number> & { currency: string; notes: string };

const amount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
};

export function sanitizeLogisticsCosts(input: unknown): LogisticsCosts {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const costs = { currency: String(source.currency ?? "").trim().toUpperCase().slice(0, 3) || "BRL", notes: String(source.notes ?? "").trim().slice(0, 2000) } as LogisticsCosts;
  for (const [key] of LOGISTICS_COST_FIELDS) costs[key] = amount(source[key]);
  return costs;
}

export function parseLogisticsCosts(json: unknown): LogisticsCosts {
  try {
    return sanitizeLogisticsCosts(typeof json === "string" ? JSON.parse(json || "{}") : json);
  } catch {
    return sanitizeLogisticsCosts({});
  }
}

export function logisticsTotal(costs: LogisticsCosts) {
  return LOGISTICS_COST_FIELDS.reduce((sum, [key]) => sum + (costs[key] || 0), 0);
}

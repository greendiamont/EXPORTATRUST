// Prévia dos custos logísticos do processo (para o financeiro estimar a margem do pedido).
// Gravada em operations.logistics_costs_json no formato da cotação do agente/armador:
// grupos (Frete internacional, Custos de origem…) com uma linha por serviço — moeda, tarifa,
// quantidade e unidade. O total de cada linha é sempre calculado (tarifa × quantidade) e o
// total geral sai por moeda e convertido em US$ e R$ pelo câmbio informado (R$ por US$ 1).
//
// Registros antigos (seis campos fixos: inlandFreight, portCharges…) continuam válidos: na
// leitura cada valor vira uma linha do grupo correspondente — nada é perdido.

export const LOGISTICS_CURRENCIES = ["BRL", "USD"] as const;

/** Campos fixos da versão anterior (só para converter registros antigos). */
export const LEGACY_COST_FIELDS = [
  ["inlandFreight", "Frete rodoviário até o porto", "Custos de origem"],
  ["portCharges", "Despesas portuárias / THC", "Custos de origem"],
  ["customsBroker", "Despachante e documentação", "Custos de origem"],
  ["oceanFreight", "Frete marítimo / internacional", "Frete internacional"],
  ["insurance", "Seguro", "Frete internacional"],
  ["other", "Outros custos", "Outros custos"],
] as const;

export const DEFAULT_COST_GROUPS = ["Frete internacional", "Custos de origem"];

export type LogisticsCostItem = { service: string; currency: string; rate: number; quantity: number; unit: string };
export type LogisticsCostGroup = { name: string; items: LogisticsCostItem[] };
export type LogisticsCosts = { exchangeRate: number; agent: string; equipment: string; validUntil: string; notes: string; groups: LogisticsCostGroup[] };

const money2 = (value: number) => Math.round(value * 100) / 100;
const positive = (value: unknown, digits = 2) => {
  const parsed = Number(value);
  const factor = 10 ** digits;
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * factor) / factor : 0;
};
const str = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const currencyOf = (value: unknown, fallback: string) => str(value, 3).toUpperCase() || fallback;

/** Valor digitado no padrão brasileiro (1.234,56) ou internacional (1234.56). */
export function parseAmount(value: unknown) {
  const raw = String(value ?? "").replace(/\s/g, "").replace(/^(R\$|US\$|BRL|USD)/i, "");
  const parsed = Number(raw.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function legacyGroups(source: Record<string, unknown>): LogisticsCostGroup[] {
  const currency = currencyOf(source.currency, "BRL");
  const currencies = source.currencies && typeof source.currencies === "object" ? source.currencies as Record<string, unknown> : {};
  const groups: LogisticsCostGroup[] = [];
  for (const [key, label, group] of LEGACY_COST_FIELDS) {
    const value = positive(source[key]);
    if (!value) continue;
    let target = groups.find((item) => item.name === group);
    if (!target) groups.push(target = { name: group, items: [] });
    target.items.push({ service: label, currency: currencyOf(currencies[key], currency), rate: value, quantity: 1, unit: "" });
  }
  const order = ["Frete internacional", "Custos de origem", "Outros custos"];
  return groups.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

export function sanitizeLogisticsCosts(input: unknown): LogisticsCosts {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const groups = Array.isArray(source.groups)
    ? (source.groups as unknown[]).slice(0, 20).map((group) => {
        const value = group && typeof group === "object" ? group as Record<string, unknown> : {};
        const items = Array.isArray(value.items) ? value.items as unknown[] : [];
        return {
          name: str(value.name, 120),
          items: items.slice(0, 100).map((item) => {
            const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
            return { service: str(row.service, 200), currency: currencyOf(row.currency, "BRL"), rate: positive(row.rate), quantity: positive(row.quantity, 3), unit: str(row.unit, 80) };
          }).filter((item) => item.service || item.rate),
        };
      }).filter((group) => group.items.length)
    : legacyGroups(source);
  return {
    exchangeRate: positive(source.exchangeRate, 4),
    agent: str(source.agent, 200),
    equipment: str(source.equipment, 200),
    validUntil: str(source.validUntil, 40),
    notes: str(source.notes, 2000),
    groups,
  };
}

export function parseLogisticsCosts(json: unknown): LogisticsCosts {
  try {
    return sanitizeLogisticsCosts(typeof json === "string" ? JSON.parse(json || "{}") : json);
  } catch {
    return sanitizeLogisticsCosts({});
  }
}

/** Total da linha: tarifa × quantidade (sem quantidade, vale 1). */
export function itemTotal(item: LogisticsCostItem) {
  return money2(item.rate * (item.quantity || 1));
}

/** Soma por moeda (sem conversão) de uma lista de linhas. */
export function sumByCurrency(items: LogisticsCostItem[]) {
  const sums: Record<string, number> = {};
  for (const item of items) {
    const total = itemTotal(item);
    if (total) sums[item.currency] = money2((sums[item.currency] ?? 0) + total);
  }
  return sums;
}

/** Soma por moeda de todos os grupos. */
export function logisticsByCurrency(costs: LogisticsCosts) {
  return sumByCurrency(costs.groups.flatMap((group) => group.items));
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
  return money2(total);
}

/** Total sem conversão (soma simples de todos os valores) — usado só para saber se há custos. */
export function logisticsTotal(costs: LogisticsCosts) {
  return Object.values(logisticsByCurrency(costs)).reduce((sum, value) => sum + value, 0);
}

// ---- Rascunho do formulário (valores como texto digitado) ----

export type LogisticsDraftItem = { service: string; currency: string; rate: string; quantity: string; unit: string };
export type LogisticsDraft = { exchangeRate: string; agent: string; equipment: string; validUntil: string; notes: string; groups: Array<{ name: string; items: LogisticsDraftItem[] }> };

const typed = (value: number, digits = 2) => value ? value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits }) : "";

export function emptyDraftItem(currency = "USD"): LogisticsDraftItem {
  return { service: "", currency, rate: "", quantity: "1", unit: "" };
}

export function logisticsDraft(costs: LogisticsCosts): LogisticsDraft {
  return {
    exchangeRate: typed(costs.exchangeRate, 4), agent: costs.agent, equipment: costs.equipment, validUntil: costs.validUntil, notes: costs.notes,
    groups: costs.groups.length
      ? costs.groups.map((group) => ({ name: group.name, items: group.items.map((item) => ({ service: item.service, currency: item.currency, rate: typed(item.rate), quantity: typed(item.quantity, 3), unit: item.unit })) }))
      : DEFAULT_COST_GROUPS.map((name, index) => ({ name, items: [emptyDraftItem(index === 0 ? "USD" : "BRL")] })),
  };
}

export function costsFromDraft(draft: LogisticsDraft): LogisticsCosts {
  return sanitizeLogisticsCosts({
    exchangeRate: parseAmount(draft.exchangeRate), agent: draft.agent, equipment: draft.equipment, validUntil: draft.validUntil, notes: draft.notes,
    groups: draft.groups.map((group) => ({ name: group.name, items: group.items.map((item) => ({ service: item.service, currency: item.currency, rate: parseAmount(item.rate), quantity: parseAmount(item.quantity) || 1, unit: item.unit })) })),
  });
}

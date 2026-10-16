// Contas do Painel (dashboard aprovado por Ivam em 2026-10-16, protótipo "1b · Painel dashboard").
// Regras:
// - "Exportado" = pedido na fase Trânsito ou depois, ou operação concluída; cancelado nunca conta.
// - O mês de cada pedido é o da data de embarque (ETD).
// - Volume = soma do volume dos itens do pedido (m³); valor = valor comercial do pedido.
// - Valores em US$: pedidos em USD entram direto; em BRL são convertidos pelo câmbio do processo.
//   Em reais: câmbio de cada processo (Custos logísticos); sem câmbio, usa a média dos processos que têm.

export type DashboardOperation = {
  id: number;
  reference: string;
  client: string;
  phaseIndex: number;
  etd: string;
  value: number;
  currency: string;
  volume: number;
  exchangeRate: number;
  cancelled: boolean;
  completed: boolean;
  completedAt: string;
};

export type Range = 0 | 1 | 2; // Este ano · 12 meses · Tudo

export const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const isActive = (operation: DashboardOperation) => !operation.cancelled && !operation.completed;
export const isExported = (operation: DashboardOperation) => !operation.cancelled && (operation.completed || operation.phaseIndex >= 4);

export const monthKey = (date: string) => /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "";

export function addMonths(key: string, delta: number) {
  const [year, month] = key.split("-").map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export const monthLabel = (key: string) => MONTH_SHORT[Number(key.slice(5, 7)) - 1] ?? key;

/** Média dos câmbios informados nos processos (referência para quem não tem câmbio). */
export function referenceRate(operations: DashboardOperation[]) {
  const rates = operations.map((operation) => operation.exchangeRate).filter((rate) => rate > 0);
  return rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : 0;
}

/** Valor do pedido em US$ e em R$ (null quando não dá para converter). */
export function amounts(operation: DashboardOperation, fallbackRate: number) {
  const rate = operation.exchangeRate || fallbackRate;
  const currency = (operation.currency || "USD").toUpperCase();
  if (currency === "USD") return { usd: operation.value, brl: rate ? operation.value * rate : null };
  if (currency === "BRL") return { usd: rate ? operation.value / rate : null, brl: operation.value };
  return { usd: null, brl: null };
}

/** Primeiro mês (AAAA-MM) do período escolhido; "" = desde o início. */
export function rangeStart(range: Range, today: string) {
  const current = monthKey(today);
  if (range === 0) return `${current.slice(0, 4)}-01`;
  if (range === 1) return addMonths(current, -11);
  return "";
}

export function inRange(operation: DashboardOperation, range: Range, today: string) {
  const start = rangeStart(range, today);
  const key = monthKey(operation.etd);
  return !start || (Boolean(key) && key >= start);
}

export type Totals = { usd: number; brl: number; volume: number; count: number; unconverted: number };

export function exportedTotals(operations: DashboardOperation[], range: Range, today: string): Totals {
  const fallback = referenceRate(operations);
  const totals: Totals = { usd: 0, brl: 0, volume: 0, count: 0, unconverted: 0 };
  for (const operation of operations) {
    if (!isExported(operation) || !inRange(operation, range, today)) continue;
    const value = amounts(operation, fallback);
    totals.count += 1;
    totals.volume += operation.volume;
    if (value.usd === null || value.brl === null) totals.unconverted += 1;
    totals.usd += value.usd ?? 0;
    totals.brl += value.brl ?? 0;
  }
  return totals;
}

export type Bucket = { key: string; name: string; volume: number; usd: number; price: number; count: number };

/** Volume, valor e preço médio exportados por mês (do período) ou por ano (todos os anos). */
export function exportedSeries(operations: DashboardOperation[], view: "month" | "year", range: Range, today: string): Bucket[] {
  const fallback = referenceRate(operations);
  const exported = operations.filter((operation) => isExported(operation) && monthKey(operation.etd));
  let keys: string[];
  if (view === "year") {
    const years = exported.map((operation) => Number(operation.etd.slice(0, 4)));
    const last = Number(today.slice(0, 4));
    const first = years.length ? Math.min(...years, last) : last;
    keys = Array.from({ length: last - first + 1 }, (_, index) => String(first + index)).slice(-8);
  } else {
    const current = monthKey(today);
    const earliest = exported.map((operation) => monthKey(operation.etd)).sort()[0] ?? current;
    const start = rangeStart(range, today) || (earliest < addMonths(current, -23) ? addMonths(current, -23) : earliest);
    const end = range === 0 ? `${current.slice(0, 4)}-12` : current;
    keys = [];
    for (let key = start; key <= end && keys.length < 24; key = addMonths(key, 1)) keys.push(key);
  }
  return keys.map((key) => {
    const list = exported.filter((operation) => operation.etd.startsWith(key));
    const volume = list.reduce((sum, operation) => sum + operation.volume, 0);
    const usd = list.reduce((sum, operation) => sum + (amounts(operation, fallback).usd ?? 0), 0);
    return { key, name: view === "year" ? key : monthLabel(key), volume, usd, price: volume ? usd / volume : 0, count: list.length };
  });
}

/** Embarques por mês: embarcados x a embarcar (5 meses para trás, 2 para frente). */
export function shipmentsByMonth(operations: DashboardOperation[], today: string) {
  const current = monthKey(today);
  return Array.from({ length: 8 }, (_, index) => addMonths(current, index - 5)).map((key) => {
    const list = operations.filter((operation) => !operation.cancelled && operation.etd.startsWith(key));
    const shipped = list.filter(isExported).length;
    return { key, name: monthLabel(key), shipped, planned: list.length - shipped, current: key === current };
  });
}

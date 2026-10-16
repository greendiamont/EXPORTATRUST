// Margem estimada do processo: venda − compra − prévia logística, em US$ e em R$.
// Valores em moedas diferentes são convertidos pelo câmbio informado (R$ por US$ 1), o mesmo
// da prévia dos custos logísticos. `logistics` é a soma por moeda (logisticsByCurrency). Sem câmbio, só soma o que já está na mesma moeda.

export type Amount = { value: number; currency: string };

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Converte entre USD e BRL pelo câmbio; mesma moeda passa direto; null se não for possível. */
export function convert(amount: Amount, target: string, rate: number): number | null {
  if (!amount.value) return 0;
  if (amount.currency === target) return amount.value;
  if (rate > 0 && amount.currency === "USD" && target === "BRL") return amount.value * rate;
  if (rate > 0 && amount.currency === "BRL" && target === "USD") return amount.value / rate;
  return null;
}

function convertAll(amounts: Amount[], target: string, rate: number): number | null {
  let total = 0;
  for (const amount of amounts) {
    const value = convert(amount, target, rate);
    if (value === null) return null;
    total += value;
  }
  return round2(total);
}

export type MarginRow = { label: string; given: Amount[]; usd: number | null; brl: number | null };
export type MarginEstimate = { rows: MarginRow[]; usd: number | null; brl: number | null; percent: number | null; inSale: number | null };

export function estimateMargin({ sale, purchase, logistics, rate }: { sale: Amount; purchase: Amount; logistics: Amount[]; rate: number }): MarginEstimate {
  const logisticsParts = logistics;
  const row = (label: string, given: Amount[]): MarginRow => ({ label, given: given.filter((item) => item.value), usd: convertAll(given, "USD", rate), brl: convertAll(given, "BRL", rate) });
  const rows = [row("Venda", [sale]), row("Compra", [purchase]), row("Logística", logisticsParts)];
  const result = (target: "usd" | "brl") => rows.every((item) => item[target] !== null) ? round2(rows[0][target]! - rows[1][target]! - rows[2][target]!) : null;
  const usd = result("usd");
  const brl = result("brl");
  const costs = convertAll([purchase, ...logisticsParts], sale.currency, rate);
  const inSale = costs === null ? null : round2(sale.value - costs);
  const ready = sale.value > 0 && purchase.value > 0;
  return { rows, usd: ready ? usd : null, brl: ready ? brl : null, inSale: ready ? inSale : null, percent: ready && inSale !== null ? (inSale / sale.value) * 100 : null };
}

/** Soma por moeda ({ USD: 1325, BRL: 1990 }) → lista de valores. */
export const amountsOf = (sums: Record<string, number>): Amount[] => Object.entries(sums).map(([currency, value]) => ({ currency, value }));

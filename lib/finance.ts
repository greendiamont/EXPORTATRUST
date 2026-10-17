// Financeiro (protótipo "7 · Financeiro", pedido por Ivam em 2026-10-17).
// Por processo: comissão (valor do pedido × %) ou margem (venda − compra − logística, mesma conta
// do Financeiro do pedido). Na margem, a parceira (VLP) paga a margem como comissão.
// O controle de faturamento fica em operations.supply_chain_notes.finance (JSON do pedido, preservado
// pelas outras edições): quem paga, situação e documentos emitidos.

import { amountsOf, convert, estimateMargin } from "./margin";
import { logisticsByCurrency, parseLogisticsCosts } from "./logistics-costs";
import { readOrderTerms } from "./order-terms";

export type FinanceStatus = "a_faturar" | "faturado" | "recebido";
export type FinanceIssuer = { name: string; taxId: string; city: string; bank: string };
export type FinanceDocument = {
  id: string;
  kind: "invoice" | "nfse";
  number: string;
  date: string;
  issuer: FinanceIssuer;
  payer: string;
  payerRole: string;
  description: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  dueDate: string;
  createdAt: string;
  by: string;
};
export type FinanceRecord = { payerRole: string; payerName: string; status: FinanceStatus; receivedAt: string; documents: FinanceDocument[] };

export const PAYER_ROLES = ["Fornecedor", "Exportador", "Importador", "Parceiro", "Outro"] as const;
export const DEFAULT_PARTNER = "VLP";

type Source = {
  supplyChainNotes: string | null;
  product: string;
  species: string;
  rawMaterial: string;
  lotCodes: string;
  quantity: number;
  volumeM3: number;
  commercialValue: number;
  currency: string;
  logisticsCostsJson: string;
  supplierName: string;
  exporterName: string;
  euImporter: string;
};

function json(source: { supplyChainNotes: string | null }): Record<string, unknown> | null {
  try {
    const value = JSON.parse(source.supplyChainNotes || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const round2 = (value: number) => Math.round(value * 100) / 100;

function itemsTotal(list: unknown): { volume: number; value: number } {
  const items = Array.isArray(list) ? list as Array<Record<string, unknown>> : [];
  let volume = 0;
  let value = 0;
  for (const item of items) {
    const itemVolume = Number(item.volume) || 0;
    volume += itemVolume;
    value += itemVolume * (Number(item.unitPrice) || 0);
  }
  return { volume, value };
}

export function readFinance(source: { supplyChainNotes: string | null }): FinanceRecord {
  const raw = json(source)?.finance;
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const documents = Array.isArray(value.documents) ? (value.documents as FinanceDocument[]) : [];
  const status = (["a_faturar", "faturado", "recebido"] as const).find((item) => item === value.status) ?? (documents.length ? "faturado" : "a_faturar");
  return { payerRole: text(value.payerRole), payerName: text(value.payerName), status, receivedAt: text(value.receivedAt), documents };
}

/** Grava o controle de faturamento no JSON do pedido, preservando as outras chaves. Texto livre antigo vira orderNotes. */
export function writeFinance(source: { supplyChainNotes: string | null }, finance: FinanceRecord) {
  const current = json(source) ?? (source.supplyChainNotes ? { orderNotes: source.supplyChainNotes } : {});
  return JSON.stringify({ ...current, finance });
}

/** Ganho do processo (comissão ou margem) com quem paga por padrão. */
export function processGain(source: Source) {
  const terms = readOrderTerms(source);
  const data = json(source) ?? {};
  const logistics = parseLogisticsCosts(source.logisticsCostsJson);
  const rate = logistics.exchangeRate || 0;
  const currency = source.currency || "USD";
  const so = itemsTotal(data.orderItems);
  const sale = so.value || source.commercialValue || 0;
  const volume = so.volume || source.volumeM3 || 0;
  const finance = readFinance(source);
  if (terms.gainMode === "comissao") {
    const gain = round2(sale * terms.commissionPercent / 100);
    return {
      mode: "comissao" as const, sale, currency, volume, rate, percent: terms.commissionPercent, gain,
      gainUsd: convert({ value: gain, currency }, "USD", rate), gainBrl: convert({ value: gain, currency }, "BRL", rate),
      payerRole: finance.payerRole || "Fornecedor", payerName: finance.payerName || source.supplierName || source.exporterName,
      finance, ready: sale > 0 && terms.commissionPercent > 0,
    };
  }
  // Compra: pedido de compra emitido (quando não é a cópia automática do de venda); antes dele, o preço indicativo.
  const supplier = data.supplierOrder && typeof data.supplierOrder === "object" ? data.supplierOrder as Record<string, unknown> : {};
  const po = itemsTotal(supplier.items);
  const poIsSaleCopy = po.value === so.value && terms.purchaseUnitPrice > 0;
  const indicative = !(terms.hasSupplierOrder && po.value) || poIsSaleCopy;
  const purchase = indicative
    ? { value: terms.purchaseUnitPrice * (volume || source.quantity || 0), currency: terms.purchaseCurrency }
    : { value: po.value, currency: text(supplier.currency) || currency };
  const estimate = estimateMargin({ sale: { value: sale, currency }, purchase, logistics: amountsOf(logisticsByCurrency(logistics)), rate });
  const gain = estimate.inSale ?? 0;
  return {
    mode: "margem" as const, sale, currency, volume, rate, percent: estimate.percent ?? 0, gain: round2(gain),
    gainUsd: estimate.usd, gainBrl: estimate.brl,
    payerRole: finance.payerRole || "Parceiro", payerName: finance.payerName || DEFAULT_PARTNER,
    finance, ready: estimate.inSale !== null,
  };
}

/** Próximo número de documento da organização: CI-2026-001 (invoice) ou NFS-2026-001 (espelho da nota). */
export function nextDocumentNumber(kind: FinanceDocument["kind"], existing: string[], year: string) {
  const prefix = `${kind === "invoice" ? "CI" : "NFS"}-${year}-`;
  const last = existing.filter((number) => number.startsWith(prefix)).map((number) => Number(number.slice(prefix.length)) || 0);
  return `${prefix}${String(Math.max(0, ...last) + 1).padStart(3, "0")}`;
}

export function cleanIssuer(input: unknown): FinanceIssuer {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const field = (key: string, max = 300) => text(value[key]).trim().slice(0, max);
  return { name: field("name", 160), taxId: field("taxId", 40), city: field("city", 120), bank: field("bank", 500) };
}

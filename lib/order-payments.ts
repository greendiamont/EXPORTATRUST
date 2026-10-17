// Financeiro do pedido: o que o cliente paga (protótipo "3d · Financeiro do pedido", aprovado por Ivam em
// 2026-10-17). Parcelas montadas pela condição de pagamento do pedido (ex.: "30% ADV, 70% against copy
// of BL"), recebimentos com o SWIFT anexado e o saldo, que o Shipment Advice usa no e-mail ao cliente.
// Fica em operations.supply_chain_notes.payments (JSON do pedido, preservado pelas outras edições).
// Só o lado do cliente; pagamentos ao fornecedor e câmbio ficaram fora por decisão de Ivam.

import { readOrderTerms } from "./order-terms";

export type Receipt = { id: string; date: string; amount: number; documentId: number | null; note: string; by: string };
export type Installment = { id: string; label: string; percent: number; amount: number; dueDate: string; rule: string; requestedAt: string; receipts: Receipt[] };
export type PaymentsRecord = { total: number; installments: Installment[] };
export type InstallmentStatus = "a_solicitar" | "solicitado" | "parcial" | "recebido";

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const money = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0; };
const date = (value: unknown) => /^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : "";
const id = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 36);

function json(notes: string | null): Record<string, unknown> {
  try {
    const value = JSON.parse(notes || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Percentuais da condição de pagamento, na ordem ("30% ADV 70% TT" → [30, 70]); só quando somam 100. */
export function termPercents(paymentTerms: string) {
  const percents = [...paymentTerms.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*%/g)].map((match) => Number(match[1].replace(",", "."))).filter((value) => value > 0 && value <= 100);
  const sum = percents.reduce((total, value) => total + value, 0);
  return Math.abs(sum - 100) < 0.01 ? percents : [];
}

/** Plano padrão pela condição do pedido: primeira parcela = adiantamento, última = saldo. */
export function defaultInstallments(total: number, paymentTerms: string): Installment[] {
  const percents = termPercents(paymentTerms);
  const parts = percents.length ? percents : [100];
  return parts.map((percent, index) => ({
    id: id(),
    label: parts.length === 1 ? "Pagamento 100%" : index === 0 ? `Adiantamento ${percent}%` : index === parts.length - 1 ? `Saldo ${percent}%` : `Parcela ${index + 1} · ${percent}%`,
    percent,
    amount: Math.round(total * percent) / 100,
    dueDate: "",
    rule: parts.length === 1 ? paymentTerms : index === 0 ? "adiantamento" : "contra cópia dos documentos",
    requestedAt: "",
    receipts: [],
  }));
}

function readInstallment(raw: unknown): Installment {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const receipts = Array.isArray(value.receipts) ? value.receipts as Array<Record<string, unknown>> : [];
  return {
    id: text(value.id) || id(), label: text(value.label).slice(0, 80) || "Parcela", percent: Math.min(100, money(value.percent)), amount: money(value.amount),
    dueDate: date(value.dueDate), rule: text(value.rule).slice(0, 200), requestedAt: text(value.requestedAt),
    receipts: receipts.map((receipt) => ({ id: text(receipt.id) || id(), date: date(receipt.date), amount: money(receipt.amount), documentId: Number(receipt.documentId) || null, note: text(receipt.note).slice(0, 300), by: text(receipt.by) })).filter((receipt) => receipt.amount > 0),
  };
}

/** Lê o plano salvo; sem plano, monta um pelo valor do pedido e a condição de pagamento (não grava). */
export function readPayments(notes: string | null, saleTotal: number, paymentTerms: string): PaymentsRecord & { saved: boolean } {
  const value = json(notes).payments;
  if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).installments)) {
    const record = value as Record<string, unknown>;
    return { total: money(record.total) || saleTotal, installments: (record.installments as unknown[]).map(readInstallment), saved: true };
  }
  return { total: saleTotal, installments: defaultInstallments(saleTotal, paymentTerms), saved: false };
}

export function writePayments(notes: string | null, payments: PaymentsRecord) {
  let current: Record<string, unknown>;
  try {
    const parsed = JSON.parse(notes || "{}");
    current = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { orderNotes: notes };
  } catch {
    current = notes ? { orderNotes: notes } : {};
  }
  return JSON.stringify({ ...current, payments: { total: payments.total, installments: payments.installments } });
}

export function cleanInstallments(input: unknown, current: Installment[]): Installment[] {
  const list = Array.isArray(input) ? input : [];
  // Recebimentos e data de solicitação continuam os já registrados; a tela edita só rótulo, valor e vencimento.
  return list.slice(0, 12).map((raw) => {
    const item = readInstallment(raw);
    const before = current.find((existing) => existing.id === item.id);
    return before ? { ...item, receipts: before.receipts, requestedAt: before.requestedAt } : { ...item, receipts: [], requestedAt: "" };
  });
}

export const receivedOf = (installment: Installment) => Math.round(installment.receipts.reduce((sum, receipt) => sum + receipt.amount, 0) * 100) / 100;

export function statusOf(installment: Installment): InstallmentStatus {
  const received = receivedOf(installment);
  if (installment.amount > 0 && received + 0.005 >= installment.amount) return "recebido";
  if (received > 0) return "parcial";
  return installment.requestedAt ? "solicitado" : "a_solicitar";
}

/** Balanço do pedido: total, recebido, saldo e próximo vencimento em aberto. */
export function paymentSummary(payments: PaymentsRecord, today: string) {
  const received = Math.round(payments.installments.reduce((sum, item) => sum + receivedOf(item), 0) * 100) / 100;
  const open = payments.installments.filter((item) => statusOf(item) !== "recebido");
  const next = open.filter((item) => item.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
  return {
    total: payments.total,
    received,
    balance: Math.max(0, Math.round((payments.total - received) * 100) / 100),
    planned: Math.round(payments.installments.reduce((sum, item) => sum + item.amount, 0) * 100) / 100,
    nextDue: next ? { label: next.label, dueDate: next.dueDate, amount: Math.max(0, next.amount - receivedOf(next)), late: next.dueDate < today } : null,
    receipts: payments.installments.flatMap((item) => item.receipts.map((receipt) => ({ ...receipt, installment: item.label }))).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Valor do pedido: itens do pedido de venda (volume × preço); sem itens, o valor comercial. */
export function saleTotalOf(operation: Parameters<typeof readOrderTerms>[0]) {
  const total = readOrderTerms(operation).items.reduce((sum, item) => sum + (Number(item.volume) || 0) * (Number(item.unitPrice) || 0), 0);
  return Math.round((total || operation.commercialValue || 0) * 100) / 100;
}

// Shipment Report para o cliente (protótipo "3e · Shipment Report", aprovado por Ivam em 2026-10-17):
// um e-mail por cliente com todos os pedidos em aberto — fase, booking, embarque, qualidade, documentos,
// pagamento (Financeiro do pedido) e EUDR —, enviado pelo botão no pedido ou automaticamente a cada N dias
// ou quando algum pedido muda de fase. Em inglês. Nunca leva margem, compra, comissão ou tarefas internas.

import { EXPORT_ORDER_MILESTONES } from "./export-control";
import { currentPhaseIndex, isClosedStatus } from "./order-phases";
import { paymentSummary, readPayments, saleTotalOf, statusOf } from "./order-payments";
import { readOrderTerms } from "./order-terms";

export const PHASES_EN = ["Order", "Production", "Booking", "Documents", "In transit", "Delivered"];

type Operation = Parameters<typeof saleTotalOf>[0] & {
  id: number; reference: string; product: string; euImporter: string; importerClientId: number | null; currency: string; quantity: number; quantityUnit: string;
  netWeightKg: number; shipmentDate: string; bookingNumber: string; vesselVoyage: string; billOfLadingNumber: string; containerNumbers: string;
  portOfLoading: string; portOfDischarge: string; contractNumber: string; eudrReference: string;
};
type Milestone = { code: string; sequence: number; status: string; dueDate: string; completedAt?: string | null };

export type ReportOrder = {
  id: number; reference: string; product: string; load: string; phase: number; badge: string; tone: "ok" | "warn" | "info" | "todo";
  facts: Array<{ label: string; value: string }>; next: string; action: string;
};

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Chave do cliente: o cadastro (id) ou o nome do importador. */
export const clientKeyOf = (operation: { importerClientId: number | null; euImporter: string }) => operation.importerClientId ? `client:${operation.importerClientId}` : `name:${normalize(operation.euImporter || "sem cliente")}`;

export function englishDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value || "")) return "";
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

const usd = (value: number, currency: string) => `${currency || "USD"} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function milestoneState(milestones: Milestone[], code: string) {
  const milestone = milestones.find((item) => item.code === code);
  if (!milestone || milestone.status === "Suspenso") return "";
  if (isClosedStatus(milestone.status)) return "done";
  return milestone.status === "Em andamento" || milestone.status === "Bloqueado" ? "progress" : "pending";
}

/** Situação de um pedido para o cliente. */
export function reportOrder(operation: Operation, milestones: Milestone[], options: { includePayments: boolean; eudrRequired: boolean; today: string }): ReportOrder {
  const sorted = [...milestones].sort((a, b) => a.sequence - b.sequence);
  const terms = readOrderTerms(operation);
  const phase = terms.completed ? 5 : currentPhaseIndex(sorted);
  const containers = operation.containerNumbers.split(/[\s,;]+/).filter(Boolean);
  const load = [
    containers.length ? `${containers.length} × container` : /cont/i.test(operation.quantityUnit) && operation.quantity ? `${operation.quantity} × container` : "",
    terms.items.reduce((sum, item) => sum + (Number(item.volume) || 0), 0) ? `${Math.round(terms.items.reduce((sum, item) => sum + (Number(item.volume) || 0), 0) * 1000) / 1000} m³` : "",
    operation.netWeightKg ? `${Math.round(operation.netWeightKg / 100) / 10} t` : "",
  ].filter(Boolean).join(" · ");

  const booking = milestoneState(sorted, "BOOKING");
  const quality = milestoneState(sorted, "QUALITY_CONTROL");
  const documents = milestoneState(sorted, "DOCUMENT_SET");
  const shipped = milestoneState(sorted, "SHIPPED") === "done";
  const arrival = sorted.find((item) => item.code === "ARRIVAL");
  const facts: Array<{ label: string; value: string }> = [];
  facts.push({ label: "Booking", value: booking === "done" ? `Confirmed${operation.bookingNumber ? ` · ${operation.bookingNumber}` : ""}` : booking === "progress" ? "Requested" : "To be requested" });
  if (operation.vesselVoyage) facts.push({ label: "Vessel / voyage", value: operation.vesselVoyage });
  facts.push({ label: shipped ? "Shipped (ETD)" : "Estimated departure", value: [englishDate(operation.shipmentDate) || "TBC", operation.portOfLoading].filter(Boolean).join(" · ") });
  facts.push({ label: "Estimated arrival", value: [englishDate(arrival?.dueDate ?? "") || "TBC", operation.portOfDischarge].filter(Boolean).join(" · ") });
  if (quality) facts.push({ label: "Quality inspection", value: quality === "done" ? "Approved ✓" : quality === "progress" ? "In progress" : "Scheduled" });
  facts.push({ label: "Documents", value: documents === "done" ? `Ready${operation.billOfLadingNumber ? ` · BL ${operation.billOfLadingNumber}` : ""}` : documents === "progress" ? "In preparation" : "Pending" });
  if (containers.length) facts.push({ label: "Containers", value: containers.join(", ") });
  if (options.eudrRequired) facts.push({ label: "EUDR", value: operation.eudrReference ? `DDS reference ${operation.eudrReference}` : "Due diligence package in preparation" });

  let action = "";
  if (options.includePayments) {
    const payments = readPayments(operation.supplyChainNotes, saleTotalOf(operation), terms.paymentTerms);
    const summary = paymentSummary(payments, options.today);
    const currency = operation.currency || "USD";
    let value = "";
    if (summary.total > 0 && summary.balance <= 0.005) value = "Paid in full ✓";
    else if (summary.received > 0) value = `Received ${usd(summary.received, currency)} · balance ${usd(summary.balance, currency)}${summary.nextDue?.dueDate ? ` due ${englishDate(summary.nextDue.dueDate)}` : ""}`;
    else if (summary.total > 0) value = `Total ${usd(summary.total, currency)} · ${terms.paymentTerms || "as per contract"}`;
    if (value) facts.push({ label: "Payment", value });
    const requested = payments.installments.find((item) => item.requestedAt && statusOf(item) !== "recebido");
    if (requested) {
      const open = Math.max(0, requested.amount - requested.receipts.reduce((sum, receipt) => sum + receipt.amount, 0));
      action = `Action needed: payment of ${usd(open, currency)}${requested.dueDate ? ` due ${englishDate(requested.dueDate)}` : ""} (${requested.label.replace(/^Adiantamento/i, "advance").replace(/^Saldo/i, "balance")}).`;
    }
  }

  const nextMilestone = sorted.find((item) => !isClosedStatus(item.status));
  const definition = nextMilestone ? EXPORT_ORDER_MILESTONES.find((item) => item.code === nextMilestone.code) : undefined;
  const next = terms.completed ? "Order completed." : definition ? `Next step: ${definition.titleEn}${nextMilestone?.dueDate ? ` (${englishDate(nextMilestone.dueDate)})` : ""}.` : "";
  const badge = terms.completed ? "Delivered" : phase === 4 ? "In transit" : phase === 3 ? "Documents" : phase === 2 ? (booking === "done" ? "Booking confirmed" : "Booking") : phase === 1 ? "In production" : PHASES_EN[phase];
  const tone = terms.completed || phase >= 4 ? "ok" : phase === 2 ? "info" : phase === 1 ? "warn" : "todo";
  return { id: operation.id, reference: operation.reference, product: operation.product, load, phase, badge, tone, facts, next, action };
}

/** Fases atuais de cada pedido (para detectar mudança de fase no envio automático). */
export const phasesOf = (orders: ReportOrder[]) => Object.fromEntries(orders.map((order) => [String(order.id), order.phase]));

export function phaseChanged(previous: Record<string, number>, orders: ReportOrder[]) {
  return orders.some((order) => previous[String(order.id)] !== undefined && previous[String(order.id)] !== order.phase);
}

/** Envio automático: a cada N dias desde o último, ou antes, se algum pedido mudou de fase. */
export function isDue(settings: { auto: boolean; intervalDays: number; onPhaseChange: boolean; lastSentAt: string; lastPhasesJson: string }, orders: ReportOrder[], now: Date) {
  if (!settings.auto || !orders.length) return { due: false, reason: "" };
  let previous: Record<string, number> = {};
  try { previous = JSON.parse(settings.lastPhasesJson || "{}"); } catch { previous = {}; }
  if (settings.onPhaseChange && phaseChanged(previous, orders)) return { due: true, reason: "phase" };
  if (settings.intervalDays > 0) {
    const last = Date.parse(settings.lastSentAt);
    if (!Number.isFinite(last) || now.getTime() - last >= settings.intervalDays * 86_400_000) return { due: true, reason: "interval" };
  }
  return { due: false, reason: "" };
}

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** E-mail (HTML com estilos inline, para clientes de e-mail) e versão texto. */
export function reportEmail({ clientName, exporterName, orders, message, date }: { clientName: string; exporterName: string; orders: ReportOrder[]; message: string; date: string }) {
  const subject = `Shipment Report · ${clientName} · ${englishDate(date)} · ${orders.length} order${orders.length === 1 ? "" : "s"}`;
  const toneStyle = { ok: "background:#ecfdf5;color:#047857", warn: "background:#fffbeb;color:#92400e", info: "background:#eff6ff;color:#1d4ed8", todo: "background:#f3f4f6;color:#4b5563" };
  const cards = orders.map((order) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dfe9e4;border-radius:8px;margin:0 0 14px;border-collapse:separate">
<tr><td style="padding:12px 14px">
  <table role="presentation" width="100%"><tr><td style="font:600 14px Arial,sans-serif;color:#20362d">${escape(order.reference)} <span style="font-weight:400;color:#60756c">· ${escape(order.product)}${order.load ? ` · ${escape(order.load)}` : ""}</span></td>
  <td align="right"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font:600 12px Arial,sans-serif;${toneStyle[order.tone]}">${escape(order.badge)}</span></td></tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="3" style="margin:8px 0"><tr>${PHASES_EN.map((name, index) => `<td align="center" style="font:11px Arial,sans-serif;padding:5px 2px;border-radius:4px;${index < order.phase ? "background:#ecfdf5;color:#047857" : index === order.phase ? "background:#0f1b2d;color:#ffffff;font-weight:600" : "background:#f3f4f6;color:#6b7280"}">${name}</td>`).join("")}</tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${order.facts.map((fact) => `<tr><td style="font:12px Arial,sans-serif;color:#60756c;padding:2px 10px 2px 0;width:150px;vertical-align:top">${escape(fact.label)}</td><td style="font:12.5px Arial,sans-serif;color:#20362d;padding:2px 0">${escape(fact.value)}</td></tr>`).join("")}</table>
  ${order.action ? `<div style="margin-top:8px;padding:6px 10px;border-radius:6px;background:#fffbeb;color:#92400e;font:600 12.5px Arial,sans-serif">${escape(order.action)}</div>` : ""}
  ${order.next ? `<div style="margin-top:6px;padding:6px 10px;border-radius:6px;background:#f9fafb;color:#374151;font:12.5px Arial,sans-serif">${escape(order.next)}</div>` : ""}
</td></tr></table>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f3f7f5"><table role="presentation" width="100%" style="background:#f3f7f5"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="640" style="max-width:640px;background:#ffffff;border:1px solid #d8e5df"><tr><td style="padding:22px 24px">
<table role="presentation" width="100%" style="border-bottom:3px solid #086c55;margin-bottom:14px"><tr><td style="padding-bottom:10px"><div style="font:800 13px Arial,sans-serif;letter-spacing:2px;color:#086c55;text-transform:uppercase">${escape(exporterName)}</div><div style="font:12px Arial,sans-serif;color:#60756c">Shipment report · your open orders</div></td>
<td align="right" style="padding-bottom:10px"><div style="font:700 18px Arial,sans-serif;color:#20362d">SHIPMENT REPORT</div><div style="font:12px Arial,sans-serif;color:#60756c">${escape(englishDate(date))} · ${orders.length} order${orders.length === 1 ? "" : "s"}</div></td></tr></table>
<p style="font:13px Arial,sans-serif;color:#20362d;margin:0 0 14px">Dear ${escape(clientName || "customer")}, please find below the current status of your orders.</p>
${message ? `<p style="font:13px Arial,sans-serif;color:#20362d;margin:0 0 14px;white-space:pre-line">${escape(message)}</p>` : ""}
${cards}
<p style="font:11.5px Arial,sans-serif;color:#60756c;margin:10px 0 0">Dates are estimates and may change with the carrier's schedule. This report is generated by ExportaTrust.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [`Shipment Report · ${clientName} · ${englishDate(date)}`, "", message, ...orders.flatMap((order) => ["", `${order.reference} · ${order.product}${order.load ? ` · ${order.load}` : ""} — ${order.badge}`, `Status: ${PHASES_EN.map((name, index) => index === order.phase ? `[${name}]` : name).join(" > ")}`, ...order.facts.map((fact) => `${fact.label}: ${fact.value}`), order.action, order.next].filter((line) => line !== ""))].filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n");
  return { subject, html, text };
}


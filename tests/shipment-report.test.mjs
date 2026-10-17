import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./ts-resolve.mjs", import.meta.url);
const { clientKeyOf, isDue, phasesOf, reportEmail, reportOrder } = await import("../lib/shipment-report.ts");
const { shipmentReportPdf } = await import("../lib/shipment-report-pdf.ts");

const operation = {
  id: 16, reference: "278/26", product: "Pine sawn timber", euImporter: "Danubia Wood", importerClientId: null, currency: "USD", quantity: 6, quantityUnit: "Contêineres",
  netWeightKg: 0, shipmentDate: "2026-10-23", bookingNumber: "BK123", vesselVoyage: "MSC Aurora 642W", billOfLadingNumber: "", containerNumbers: "", portOfLoading: "Itajaí",
  portOfDischarge: "Hamburg", contractNumber: "", eudrReference: "", supplyChainNotes: JSON.stringify({
    orderItems: [{ volume: 100, unitPrice: 100 }], paymentTerms: "30% ADV 70% BL",
    payments: { total: 10000, installments: [
      { id: "a", label: "Adiantamento 30%", amount: 3000, dueDate: "2026-09-15", requestedAt: "x", receipts: [{ id: "r", date: "2026-09-12", amount: 3000 }] },
      { id: "b", label: "Saldo 70%", amount: 7000, dueDate: "2026-11-07", requestedAt: "2026-10-17", receipts: [] },
    ] },
  }), product_: "", species: "", rawMaterial: "", lotCodes: "", volumeM3: 0, commercialValue: 10000,
};
const milestones = [
  { code: "ORDER_CONFIRMED", sequence: 1, status: "Concluído", dueDate: "" },
  { code: "QUALITY_CONTROL", sequence: 5, status: "Concluído", dueDate: "" },
  { code: "BOOKING", sequence: 7, status: "Concluído", dueDate: "" },
  { code: "STUFFING", sequence: 8, status: "Pendente", dueDate: "2026-10-20" },
  { code: "ARRIVAL", sequence: 13, status: "Pendente", dueDate: "2026-11-18" },
];

test("situação do pedido para o cliente", () => {
  const order = reportOrder(operation, milestones, { includePayments: true, eudrRequired: true, today: "2026-10-17" });
  assert.equal(order.phase, 2);
  assert.equal(order.badge, "Booking confirmed");
  const facts = Object.fromEntries(order.facts.map((fact) => [fact.label, fact.value]));
  assert.equal(facts.Booking, "Confirmed · BK123");
  assert.equal(facts["Quality inspection"], "Approved ✓");
  assert.match(facts["Estimated arrival"], /18 Nov 2026/);
  assert.match(facts.Payment, /Received USD 3,000.00 · balance USD 7,000.00 due 07 Nov 2026/);
  assert.equal(facts.EUDR, "Due diligence package in preparation");
  assert.match(order.action, /payment of USD 7,000.00 due 07 Nov 2026 \(balance/);
  assert.match(order.next, /Container stuffing/);
  const hidden = reportOrder(operation, milestones, { includePayments: false, eudrRequired: false, today: "2026-10-17" });
  assert.equal(hidden.facts.some((fact) => fact.label === "Payment"), false);
  assert.equal(hidden.action, "");
});

test("envio automático: prazo de dias ou mudança de fase", () => {
  const order = reportOrder(operation, milestones, { includePayments: true, eudrRequired: false, today: "2026-10-17" });
  const base = { auto: true, intervalDays: 10, onPhaseChange: true, lastSentAt: "2026-10-10T09:00:00Z", lastPhasesJson: JSON.stringify(phasesOf([order])) };
  assert.equal(isDue(base, [order], new Date("2026-10-17T09:00:00Z")).due, false);
  assert.equal(isDue(base, [order], new Date("2026-10-20T09:00:00Z")).reason, "interval");
  assert.equal(isDue({ ...base, lastPhasesJson: JSON.stringify({ 16: 1 }) }, [order], new Date("2026-10-11T09:00:00Z")).reason, "phase");
  assert.equal(isDue({ ...base, onPhaseChange: false, lastPhasesJson: JSON.stringify({ 16: 1 }) }, [order], new Date("2026-10-11T09:00:00Z")).due, false);
  assert.equal(isDue({ ...base, intervalDays: 0, lastPhasesJson: JSON.stringify({ 16: 2 }) }, [order], new Date("2027-01-01")).due, false);
  assert.equal(isDue({ ...base, auto: false }, [order], new Date("2027-01-01")).due, false);
  assert.equal(clientKeyOf({ importerClientId: 7, euImporter: "x" }), "client:7");
  assert.equal(clientKeyOf({ importerClientId: null, euImporter: "Danúbia  Wood" }), "name:danubia wood");
});

test("e-mail e PDF", async () => {
  const order = reportOrder(operation, milestones, { includePayments: true, eudrRequired: false, today: "2026-10-17" });
  const email = reportEmail({ clientName: "Danubia Wood", exporterName: "Green Diamont", orders: [order], message: "Hello", date: "2026-10-17" });
  assert.match(email.subject, /Shipment Report · Danubia Wood · 17 Oct 2026 · 1 order/);
  assert.match(email.html, /278\/26/);
  assert.doesNotMatch(email.text, /margem|margin|purchase|commission/i);
  assert.match(email.text, /\[Booking\]/);
  const pdf = await shipmentReportPdf({ clientName: "Danubia Wood", exporterName: "Green Diamont", orders: [order, order, order, order, order, order], message: "Hello", date: "2026-10-17" });
  assert.ok(pdf.length > 1000);
});

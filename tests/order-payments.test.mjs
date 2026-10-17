import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./ts-resolve.mjs", import.meta.url);
const { defaultInstallments, paymentSummary, readPayments, statusOf, termPercents, writePayments, cleanInstallments } = await import("../lib/order-payments.ts");
const { buildShipmentAdvice } = await import("../lib/shipment-documents.ts");

test("parcelas pela condição de pagamento", () => {
  assert.deepEqual(termPercents("30% ADV 70% TT AGAINST COPY OF DOCUMENTS"), [30, 70]);
  assert.deepEqual(termPercents("100% CAD"), [100]);
  assert.deepEqual(termPercents("30% advance"), []);
  const plan = defaultInstallments(73307.48, "30% ADV 70% against BL");
  assert.equal(plan.length, 2);
  assert.equal(plan[0].label, "Adiantamento 30%");
  assert.equal(plan[0].amount, 21992.24);
  assert.equal(plan[1].label, "Saldo 70%");
  assert.equal(defaultInstallments(1000, "TT").length, 1);
});

test("recebimentos, situação e saldo; JSON preservado", () => {
  const notes = JSON.stringify({ orderItems: [{ volume: 1 }], finance: { status: "faturado" } });
  const payments = readPayments(notes, 10000, "30% ADV 70% BL");
  assert.equal(payments.saved, false);
  payments.installments[0].receipts.push({ id: "r1", date: "2026-09-12", amount: 3000, documentId: 5, note: "", by: "x" });
  payments.installments[1].requestedAt = "2026-10-17T00:00:00Z";
  payments.installments[1].dueDate = "2026-10-01";
  assert.equal(statusOf(payments.installments[0]), "recebido");
  assert.equal(statusOf(payments.installments[1]), "solicitado");
  const summary = paymentSummary(payments, "2026-10-17");
  assert.equal(summary.received, 3000);
  assert.equal(summary.balance, 7000);
  assert.equal(summary.nextDue.late, true);
  const saved = JSON.parse(writePayments(notes, payments));
  assert.equal(saved.finance.status, "faturado");
  const again = readPayments(JSON.stringify(saved), 10000, "");
  assert.equal(again.saved, true);
  assert.equal(again.installments[0].receipts.length, 1);
  const edited = cleanInstallments([{ ...again.installments[0], label: "Sinal", receipts: [] }], again.installments);
  assert.equal(edited[0].receipts.length, 1, "editar a parcela não apaga recebimentos");
});

test("Shipment Advice usa o recebido e calcula o saldo", () => {
  const operation = { reference: "278/26", bookingNumber: "BK1", containerNumbers: "A,B", vesselVoyage: "", portOfLoading: "Itajaí", portOfDischarge: "Hamburg", currency: "USD" };
  const withPayment = buildShipmentAdvice(operation, [], { name: "", email: "" }, {}, { total: 10000, received: 3000, receipts: [{ date: "2026-09-12", amount: 3000, note: "SWIFT 123" }], paymentTerms: "30% adv 70% bl", balanceDueDate: "2026-11-07" });
  assert.match(withPayment.body, /RECEIVED 12\/09\/2026 \(SWIFT 123\) = USD 3,000\.00/);
  assert.match(withPayment.body, /TOTAL TO BE PAID {2}= USD 7,000\.00 - DUE 07\/11\/2026/);
  const none = buildShipmentAdvice(operation, [], { name: "", email: "" }, {}, { total: 10000, received: 0, receipts: [], paymentTerms: "", balanceDueDate: "" });
  assert.match(none.body, /TOTAL TO BE PAID {2}= USD 10,000\.00/);
  const legacy = buildShipmentAdvice(operation, [], { name: "", email: "" }, { totalInvoice: 10000 });
  assert.match(legacy.body, /30% ADV {11}= USD 3,000\.00/);
});

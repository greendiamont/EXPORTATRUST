import assert from "node:assert/strict";
import test from "node:test";
import { costsFromDraft, itemTotal, logisticsByCurrency, logisticsDraft, logisticsTotalIn, parseAmount, parseLogisticsCosts, sanitizeLogisticsCosts } from "../lib/logistics-costs.ts";

const HMM = {
  exchangeRate: 5.4, agent: "HMM", equipment: "1 × 40 HIGH CUBE",
  groups: [
    { name: "Frete internacional", items: [
      { service: "FRETE MARÍTIMO - FCL", currency: "USD", rate: 1100, quantity: 1, unit: "por 40 HIGH CUBE" },
      { service: "ISPS", currency: "USD", rate: 25, quantity: 1, unit: "por CNTR" },
      { service: "EFL", currency: "USD", rate: 75, quantity: 2, unit: "por TEU" },
    ] },
    { name: "Custos de origem", items: [
      { service: "BL FEE", currency: "BRL", rate: 585, quantity: 1, unit: "por HBL" },
      { service: "EXPORT FEE", currency: "USD", rate: 50, quantity: 1, unit: "por CNTR" },
      { service: "SEAL FEE", currency: "BRL", rate: 55, quantity: 1, unit: "por CNTR" },
      { service: "THC ORIGEM", currency: "BRL", rate: 1350, quantity: 1, unit: "por 40 HIGH CUBE" },
    ] },
  ],
};

test("cotação por serviço: total por moeda e convertido (exemplo HMM)", () => {
  const costs = sanitizeLogisticsCosts(HMM);
  assert.equal(itemTotal(costs.groups[0].items[2]), 150);
  assert.deepEqual(logisticsByCurrency(costs), { USD: 1325, BRL: 1990 });
  assert.equal(logisticsTotalIn(costs, "USD"), 1693.52);
  assert.equal(logisticsTotalIn(costs, "BRL"), 9145);
});

test("sem câmbio, moedas misturadas não somam", () => {
  const costs = sanitizeLogisticsCosts({ ...HMM, exchangeRate: 0 });
  assert.equal(logisticsTotalIn(costs, "USD"), null);
});

test("registros antigos (campos fixos) viram linhas da cotação sem perder valores", () => {
  const old = parseLogisticsCosts(JSON.stringify({ currency: "BRL", currencies: { oceanFreight: "USD" }, oceanFreight: 4500, portCharges: 800, exchangeRate: 5, notes: "cotação X" }));
  assert.deepEqual(old.groups.map((group) => group.name), ["Frete internacional", "Custos de origem"]);
  assert.deepEqual(logisticsByCurrency(old), { USD: 4500, BRL: 800 });
  assert.equal(old.notes, "cotação X");
  assert.equal(logisticsTotalIn(old, "BRL"), 23300);
});

test("rascunho do formulário ida e volta, com valores no padrão brasileiro", () => {
  const costs = sanitizeLogisticsCosts(HMM);
  assert.deepEqual(costsFromDraft(logisticsDraft(costs)), costs);
  assert.equal(parseAmount("1.100,00"), 1100);
  assert.equal(parseAmount("4.500"), 4500);
  const empty = costsFromDraft(logisticsDraft(parseLogisticsCosts("")));
  assert.deepEqual(empty.groups, []);
});

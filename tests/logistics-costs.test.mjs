import assert from "node:assert/strict";
import test from "node:test";
import { logisticsByCurrency, logisticsTotalIn, parseLogisticsCosts, sanitizeLogisticsCosts } from "../lib/logistics-costs.ts";

test("soma custos em reais e dólares pelo câmbio", () => {
  const costs = sanitizeLogisticsCosts({ currencies: { oceanFreight: "USD", insurance: "USD" }, portCharges: 270, customsBroker: 250, oceanFreight: 1275, insurance: 50, exchangeRate: 5.4 });
  assert.deepEqual(logisticsByCurrency(costs), { BRL: 520, USD: 1325 });
  assert.equal(logisticsTotalIn(costs, "USD"), 1421.3);
  assert.equal(logisticsTotalIn(costs, "BRL"), 7675);
});

test("sem câmbio, moedas misturadas não somam; registros antigos mantêm a moeda única", () => {
  const mixed = sanitizeLogisticsCosts({ currencies: { oceanFreight: "USD" }, portCharges: 100, oceanFreight: 200 });
  assert.equal(logisticsTotalIn(mixed, "USD"), null);
  const old = parseLogisticsCosts(JSON.stringify({ currency: "USD", oceanFreight: 4500, portCharges: 800 }));
  assert.equal(old.currencies.portCharges, "USD");
  assert.equal(logisticsTotalIn(old, "USD"), 5300);
});

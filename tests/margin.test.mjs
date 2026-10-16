import assert from "node:assert/strict";
import test from "node:test";
import { amountsOf, estimateMargin } from "../lib/margin.ts";
import { logisticsByCurrency, sanitizeLogisticsCosts } from "../lib/logistics-costs.ts";

test("margem do exemplo aprovado: 26 MT, venda US$ 230, compra R$ 750, logística HMM, câmbio 5,40", () => {
  const logistics = sanitizeLogisticsCosts({ exchangeRate: 5.4, groups: [{ name: "Frete", items: [{ service: "Frete", currency: "USD", rate: 1325, quantity: 1 }, { service: "Origem", currency: "BRL", rate: 1990, quantity: 1 }] }] });
  const margin = estimateMargin({ sale: { value: 26 * 230, currency: "USD" }, purchase: { value: 26 * 750, currency: "BRL" }, logistics: amountsOf(logisticsByCurrency(logistics)), rate: 5.4 });
  assert.equal(margin.rows[1].usd, 3611.11);
  assert.equal(margin.rows[2].brl, 9145);
  assert.equal(margin.usd, 675.37);
  assert.equal(margin.brl, 3647);
  assert.equal(margin.percent.toFixed(1), "11.3");
});

test("sem câmbio e com moedas diferentes, não inventa margem", () => {
  const margin = estimateMargin({ sale: { value: 1000, currency: "USD" }, purchase: { value: 2000, currency: "BRL" }, logistics: [], rate: 0 });
  assert.equal(margin.percent, null);
  const same = estimateMargin({ sale: { value: 1000, currency: "USD" }, purchase: { value: 800, currency: "USD" }, logistics: [], rate: 0 });
  assert.equal(same.percent, 20);
});

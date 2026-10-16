import test from "node:test";
import assert from "node:assert/strict";
import { exportedTotals, exportedSeries, shipmentsByMonth, amounts, addMonths } from "../lib/dashboard.ts";

const op = (over) => ({ id: 1, reference: "R", client: "C", phaseIndex: 4, etd: "2026-09-10", value: 10000, currency: "USD", volume: 50, exchangeRate: 5, cancelled: false, completed: false, completedAt: "", ...over });
const today = "2026-10-16";

test("exportado: fase Trânsito ou concluído, nunca cancelado", () => {
  const list = [op({}), op({ phaseIndex: 2 }), op({ phaseIndex: 1, completed: true }), op({ cancelled: true })];
  const totals = exportedTotals(list, 2, today);
  assert.equal(totals.count, 2);
  assert.equal(totals.usd, 20000);
  assert.equal(totals.brl, 100000);
  assert.equal(totals.volume, 100);
});

test("câmbio: BRL convertido pelo câmbio do processo; sem câmbio usa a média", () => {
  assert.deepEqual(amounts(op({ currency: "BRL", value: 50000 }), 0), { usd: 10000, brl: 50000 });
  assert.deepEqual(amounts(op({ exchangeRate: 0 }), 5.5), { usd: 10000, brl: 55000 });
  assert.deepEqual(amounts(op({ currency: "EUR" }), 5), { usd: null, brl: null });
});

test("período: este ano e 12 meses pelo ETD", () => {
  const list = [op({ etd: "2025-12-01" }), op({ etd: "2026-02-01" }), op({ etd: "2025-10-01" })];
  assert.equal(exportedTotals(list, 0, today).count, 1);
  assert.equal(exportedTotals(list, 1, today).count, 2);
  assert.equal(exportedTotals(list, 2, today).count, 3);
});

test("séries mês a mês e ano a ano", () => {
  const list = [op({ etd: "2026-09-10" }), op({ etd: "2026-09-20", value: 5000, volume: 50 }), op({ etd: "2024-03-01" })];
  const months = exportedSeries(list, "month", 0, today);
  assert.equal(months.length, 12);
  const sep = months.find((bucket) => bucket.key === "2026-09");
  assert.equal(sep.usd, 15000);
  assert.equal(sep.volume, 100);
  assert.equal(sep.price, 150);
  const years = exportedSeries(list, "year", 2, today);
  assert.deepEqual(years.map((bucket) => bucket.key), ["2024", "2025", "2026"]);
  assert.equal(years[0].count, 1);
});

test("embarques por mês: embarcados x a embarcar", () => {
  const list = [op({ etd: "2026-10-02" }), op({ etd: "2026-10-25", phaseIndex: 2 }), op({ etd: "2026-11-05", phaseIndex: 0 }), op({ etd: "2026-10-03", cancelled: true })];
  const months = shipmentsByMonth(list, today);
  assert.equal(months.length, 8);
  const oct = months.find((month) => month.current);
  assert.deepEqual([oct.shipped, oct.planned], [1, 1]);
  assert.equal(addMonths("2026-01", -1), "2025-12");
});

import assert from "node:assert/strict";
import test from "node:test";
import { applyOrderTerms, readOrderTerms } from "../lib/order-terms.ts";

const base = { product: "Madeira serrada", species: "Pinus", rawMaterial: "", lotCodes: "", quantity: 10, volumeM3: 0, commercialValue: 1500 };

test("lê termos de texto livre sem perder o texto", () => {
  const terms = readOrderTerms({ ...base, supplyChainNotes: "Fluxo: fazenda → serraria" });
  assert.equal(terms.notes, "Fluxo: fazenda → serraria");
  assert.equal(terms.paymentTerms, "");
  assert.equal(terms.unitPrice, 150);
});

test("aplica pagamento, medida e preço preservando o texto antigo", () => {
  const applied = applyOrderTerms({ ...base, supplyChainNotes: "Fluxo antigo" }, { paymentTerms: "30/70", size: "22x98", unitPrice: 160 });
  const json = JSON.parse(applied.supplyChainNotes);
  assert.equal(json.orderNotes, "Fluxo antigo");
  assert.equal(json.paymentTerms, "30/70");
  assert.equal(json.orderItems[0].size, "22x98");
  assert.equal(applied.commercialValue, 1600);
  assert.equal(readOrderTerms({ ...base, supplyChainNotes: applied.supplyChainNotes }).sizes, "22x98");
});

test("não altera medida/preço quando há vários itens", () => {
  const notes = JSON.stringify({ orderItems: [{ size: "a", volume: 1, unitPrice: 1 }, { size: "b", volume: 1, unitPrice: 2 }], paymentTerms: "x" });
  const applied = applyOrderTerms({ ...base, supplyChainNotes: notes }, { size: "c" });
  assert.ok(applied.error);
  assert.equal(applied.supplyChainNotes, notes);
  assert.equal(applyOrderTerms({ ...base, supplyChainNotes: notes }, { paymentTerms: "y" }).error, undefined);
});

test("preço indicativo de compra fica no JSON do pedido sem mexer no resto", () => {
  const applied = applyOrderTerms({ ...base, supplyChainNotes: JSON.stringify({ paymentTerms: "30/70" }) }, { purchaseUnitPrice: 750, purchaseCurrency: "brl" });
  const terms = readOrderTerms({ ...base, supplyChainNotes: applied.supplyChainNotes });
  assert.equal(terms.purchaseUnitPrice, 750);
  assert.equal(terms.purchaseCurrency, "BRL");
  assert.equal(terms.paymentTerms, "30/70");
  assert.equal(terms.hasSupplierOrder, false);
});

test("preço de compra do processo atualiza o pedido de compra emitido com um item", () => {
  const notes = JSON.stringify({ supplierOrder: { currency: "USD", items: [{ size: "a", volume: 160, unitPrice: 140 }] } });
  assert.equal(readOrderTerms({ ...base, supplyChainNotes: notes }).purchaseUnitPrice, 140);
  const applied = JSON.parse(applyOrderTerms({ ...base, supplyChainNotes: notes }, { purchaseUnitPrice: 155, purchaseCurrency: "USD" }).supplyChainNotes);
  assert.equal(applied.supplierOrder.items[0].unitPrice, 155);
  assert.equal(applied.supplierOrder.items[0].volume, 160);
  const many = JSON.stringify({ supplierOrder: { currency: "USD", items: [{ unitPrice: 1, volume: 1 }, { unitPrice: 2, volume: 1 }] } });
  const kept = JSON.parse(applyOrderTerms({ ...base, supplyChainNotes: many }, { purchaseUnitPrice: 155 }).supplyChainNotes);
  assert.deepEqual(kept.supplierOrder.items.map((item) => item.unitPrice), [1, 2]);
});

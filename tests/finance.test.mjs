import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./ts-resolve.mjs", import.meta.url);
const { nextDocumentNumber, processGain, readFinance, writeFinance, cleanIssuer } = await import("../lib/finance.ts");

const base = { product: "Pinus", species: "", rawMaterial: "", lotCodes: "", quantity: 4, volumeM3: 100, commercialValue: 20000, currency: "USD", supplierName: "LDF Madeiras", exporterName: "LDF Madeiras", euImporter: "SPRUCE WOOD" };
const logistics = JSON.stringify({ exchangeRate: 5, groups: [{ name: "Frete", items: [{ service: "Frete", currency: "USD", rate: 1000, quantity: 1, unit: "" }] }] });

test("comissão: valor do pedido × percentual, paga pelo fornecedor por padrão", () => {
  const notes = JSON.stringify({ orderItems: [{ volume: 100, unitPrice: 200 }], remuneration: { mode: "comissao", percent: 3 } });
  const gain = processGain({ ...base, supplyChainNotes: notes, logisticsCostsJson: logistics });
  assert.equal(gain.mode, "comissao");
  assert.equal(gain.gain, 600);
  assert.equal(gain.gainBrl, 3000);
  assert.equal(gain.payerRole, "Fornecedor");
  assert.equal(gain.payerName, "LDF Madeiras");
});

test("margem: venda − compra − logística, cobrada da VLP", () => {
  const notes = JSON.stringify({ orderItems: [{ volume: 100, unitPrice: 200 }], purchasePrice: { unitPrice: 150, currency: "USD" } });
  const gain = processGain({ ...base, supplyChainNotes: notes, logisticsCostsJson: logistics });
  assert.equal(gain.mode, "margem");
  assert.equal(gain.gain, 4000);
  assert.equal(gain.percent, 20);
  assert.equal(gain.payerName, "VLP");
});

test("controle do financeiro fica no JSON do pedido sem perder outras chaves", () => {
  const source = { supplyChainNotes: JSON.stringify({ orderItems: [{ volume: 1 }], paymentTerms: "30 dias" }) };
  assert.equal(readFinance(source).status, "a_faturar");
  const written = JSON.parse(writeFinance(source, { payerRole: "Importador", payerName: "X", status: "recebido", receivedAt: "2026-10-17", documents: [] }));
  assert.equal(written.paymentTerms, "30 dias");
  assert.equal(written.finance.status, "recebido");
  assert.equal(JSON.parse(writeFinance({ supplyChainNotes: "texto antigo" }, readFinance({ supplyChainNotes: "" }))).orderNotes, "texto antigo");
});

test("numeração e emitente", () => {
  // Modelo de Ivam: "001/2026"; continua a sequência das antigas "CI-2026-NNN" e ignora outros anos.
  assert.equal(nextDocumentNumber("invoice", ["CI-2026-001", "CI-2026-007", "NFS-2026-002"], "2026"), "008/2026");
  assert.equal(nextDocumentNumber("invoice", ["001/2026", "002/2026", "009/2025"], "2026"), "003/2026");
  assert.equal(nextDocumentNumber("nfse", ["001/2026", "NFS-001/2026"], "2026"), "NFS-002/2026");
  assert.equal(nextDocumentNumber("nfse", [], "2027"), "NFS-001/2027");
  const issuer = cleanIssuer({ name: " Ana ", taxId: "123", swift: "ABCDUS33", extra: 1 });
  assert.equal(issuer.name, "Ana");
  assert.equal(issuer.swift, "ABCDUS33");
  assert.equal(issuer.bank, "");
  assert.equal("extra" in issuer, false);
});

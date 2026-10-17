import test from "node:test";
import assert from "node:assert/strict";
import { balanceOf, eudrGeoJson, exportedQuantity, forestStatus, orderSteps, readForestEudr, readOrderEudr, readinessOf, writeOrderEudr, docDone } from "../lib/eudr.ts";

const today = "2026-10-17";
const polygon = JSON.stringify({ type: "Polygon", coordinates: [[[-49.123456789, -26.1], [-49.2, -26.1], [-49.2, -26.2], [-49.123456789, -26.1]]] });
const okDoc = { status: "ok", validUntil: "", documentId: 1, note: "" };
const checks = { desmatamento: { done: true }, ibama: { done: true }, ti_uc: { done: true }, trabalho_escravo: { done: true } };

test("floresta: plantio completa fica OK; documento vencido derruba", () => {
  const eudr = readForestEudr({ originType: "Plantio", producer: "Serraria X", species: "Pinus", scientificName: "Pinus taeda", docs: { car: okDoc, titulo: okDoc, corte: { ...okDoc, validUntil: "2026-11-01" }, compra: okDoc }, checks });
  const forest = { carCode: "SC-1", name: "Fazenda", geometryJson: polygon, areaHa: 10, eudr };
  const status = forestStatus(forest, today);
  assert.equal(status.ok, true);
  assert.equal(status.expiring, 1);
  assert.equal(forestStatus(forest, "2026-12-01").ok, false);
  assert.equal(docDone({ status: "nao_se_aplica", validUntil: "", documentId: null, note: "" }, today), true);
});

test("nativa exige PMFS, AUTEX e DOF", () => {
  const eudr = readForestEudr({ originType: "Nativa", producer: "P", species: "Cumaru", scientificName: "Dipteryx odorata", docs: { car: okDoc, titulo: okDoc }, checks });
  assert.equal(forestStatus({ carCode: "MT-1", name: "F", geometryJson: polygon, areaHa: 640, eudr }, today).docsTotal, 5);
});

test("pedido: EUDR no JSON do pedido sem perder outras chaves; pellets pelo NCM", () => {
  const notes = JSON.stringify({ orderItems: [{ volume: 1 }], finance: { status: "faturado" } });
  const eudr = readOrderEudr(notes, "4401.31.00");
  assert.equal(eudr.productKind, "pellets");
  eudr.origins.push({ carCode: "sc-1", harvestFrom: "2026-08-01", harvestTo: "", inputQuantity: 500, invoices: "NF 1" });
  const saved = JSON.parse(writeOrderEudr(notes, eudr));
  assert.equal(saved.finance.status, "faturado");
  assert.equal(readOrderEudr(JSON.stringify(saved)).origins[0].carCode, "SC-1");
});

test("balanço e quantidade exportada", () => {
  const eudr = { ...readOrderEudr(""), yieldPercent: 50, origins: [{ carCode: "A", harvestFrom: "", harvestTo: "", inputQuantity: 600, invoices: "" }] };
  assert.equal(balanceOf(eudr, 290).ok, true);
  assert.equal(balanceOf(eudr, 310).ok, false);
  assert.equal(exportedQuantity("pellets", { volumeM3: 0, netWeightKg: 588000, quantity: 0, quantityUnit: "MT" }), 588);
  assert.equal(exportedQuantity("serrado", { volumeM3: 100, netWeightKg: 0, quantity: 4, quantityUnit: "Contêineres" }, 293.2), 293.2);
});

test("etapas e prontidão", () => {
  const forestEudr = readForestEudr({ producer: "P", species: "Pinus", scientificName: "Pinus taeda", docs: { car: okDoc, titulo: okDoc, corte: okDoc, compra: okDoc }, checks });
  const eudr = { ...readOrderEudr(""), yieldPercent: 50, origins: [{ carCode: "SC-1", harvestFrom: "2026-08-01", harvestTo: "", inputQuantity: 600, invoices: "" }] };
  const steps = orderSteps({ eudr, forests: [{ carCode: "SC-1", name: "F", geometryJson: polygon, areaHa: 10, eudr: forestEudr }], operation: { product: "Pine", hsCode: "4407", supplierName: "S", euImporter: "I", euOperatorEori: "DE1", shipmentDate: "2026-11-01", eudrReference: "" }, exported: 290, today });
  assert.deepEqual(steps.map((step) => [step.done, step.total]), [[1, 1], [4, 11], [1, 1], [5, 5], [0, 1]]);
  assert.ok(readinessOf(steps) > 0 && readinessOf(steps) < 100);
});

test("GeoJSON da UE com 6 casas decimais", () => {
  const forest = { carCode: "SC-1", name: "Fazenda", geometryJson: polygon, areaHa: 12.34567, eudr: readForestEudr({ producer: "P", scientificName: "Pinus taeda" }), harvestFrom: "2026-08-01" };
  const geo = eudrGeoJson([forest]);
  assert.equal(geo.features[0].geometry.coordinates[0][0][0], -49.123457);
  assert.equal(geo.features[0].properties.ProducerCountry, "BR");
  assert.equal(geo.features[0].properties.HarvestPeriod, "2026-08-01");
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shipment advice uses Hub operational email model", async () => {
  const template = await read("lib/shipment-documents.ts");
  const client = await read("app/client-app.tsx");

  assert.match(template, /Pls find attached the draft docs for/);
  assert.match(template, /We need the balanced payment/);
  assert.match(template, /PAYMENT TERM: 30% ADV 70% TT AGAINST COPY OF DOCUMENTS/);
  assert.match(template, /supplierBankDetails/);
  assert.match(template, /Supplier bank details pending in ExportaTrust supplier master data/);
  assert.doesNotMatch(template, /SCBLUS33XXX/);
  assert.doesNotMatch(template, /BR2978632767000010004870301C1/);
  assert.match(client, /Shipment Advice \/ Set of Documents/);
  assert.doesNotMatch(template, /Order & compliance update/);
});

test("stage 09 is the authoritative shipment folder with human document approval", async () => {
  const template = await read("lib/shipment-documents.ts");
  const route = await read("app/api/shipment-advice/route.ts");
  const client = await read("app/client-app.tsx");
  assert.match(template, /SHIPMENT_SET_CATEGORY = "Export Control · Set documental"/);
  assert.match(template, /candidates\.filter\(\(document\) => document\.shipmentSetStatus === "Incluído" && document\.clientShareStatus === "Aprovado"\)/);
  assert.match(route, /action === "set-document-status"/);
  assert.match(route, /action === "approve-send"/);
  assert.match(route, /action === "test-send"/);
  assert.match(route, /attachments/);
  assert.match(template, /resolvedShipmentDocumentType/);
  assert.match(client, /Aprovar e enviar e-mail com anexos/);
  assert.match(client, /Enviar teste com todos os anexos/);
  assert.match(client, /approved \? "Reabrir" : "Aprovar"/);
});

test("AI country check evaluates requirements and every operational stage", async () => {
  const route = await read("app/api/export-control/route.ts");
  const client = await read("app/client-app.tsx");
  assert.match(route, /const stageRows = milestones\.map/);
  assert.match(route, /stageScore/);
  assert.match(route, /verdict/);
  assert.match(client, /AI FULL OPERATION CHECK/);
  assert.match(client, /VERIFICAR OPERAÇÃO COM IA/);
  assert.match(client, /Status de cada etapa/);
});

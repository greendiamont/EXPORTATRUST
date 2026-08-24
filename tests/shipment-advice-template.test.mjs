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

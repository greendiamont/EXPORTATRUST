import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

const base = process.env.AGENT_E2E_BASE_URL ?? "";
if (!/^http:\/\/(terminal\.local|127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
  throw new Error("AGENT_E2E_BASE_URL must point to the isolated local Sites preview.");
}

const stamp = Date.now();
async function json(path, init) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${body.error ?? JSON.stringify(body)}`);
  return body;
}

const supplierBody = await json("/api/suppliers", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ legalName: `E2E Supplier ${stamp}`, taxId: `TEST${stamp}`, country: "Brasil", state: "SC", city: "Timbó", contactName: "E2E Test", email: `e2e-${stamp}@example.test` }),
});

const operationBody = await json("/api/operations", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ reference: `E2E-${stamp}`, product: "Test wood pellets", hsCode: "4401.31", destinationCountry: "Italy", euImporter: "E2E Importer", supplierId: supplierBody.supplier.id, exporterName: "E2E Exporter", internalResponsible: "E2E Reviewer", responsibleEmail: "reviewer@example.test", rawMaterial: "Pine residues", productionUnit: "E2E Plant", lotCodes: "LOT-E2E-001", quantity: 1, quantityUnit: "MT", forestOriginType: "Plantation" }),
});
const operationId = operationBody.operation.id;

const carCode = `SC-0000000-${String(stamp).padStart(32, "0").slice(-32)}`;
await json("/api/properties", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    carCode,
    name: `E2E Forest ${stamp}`,
    city: "Timbó/SC",
    supplier: supplierBody.supplier.legalName,
    areaHa: 10,
    nativeAreaHa: 2,
    geometry: { type: "Polygon", coordinates: [[[-49.30, -26.85], [-49.29, -26.85], [-49.29, -26.84], [-49.30, -26.84], [-49.30, -26.85]]] },
    sourceFile: "UNOFFICIAL E2E TEST GEOMETRY",
  }),
});
const linkedOperation = await json("/api/operations", {
  method: "PATCH", headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: operationId, propertyIds: [carCode] }),
});
assert.deepEqual(JSON.parse(linkedOperation.operation.propertyIds), [carCode]);

const form = new FormData();
form.append("operationId", String(operationId));
form.append("category", "Floresta · Invoice / NF");
form.append("notes", "UNOFFICIAL E2E TEST DOCUMENT");
form.append("file", new File(["UNOFFICIAL TEST INVOICE - NOT VALID FOR TRADE OR EUDR SUBMISSION"], `unofficial-invoice-${stamp}.txt`, { type: "text/plain" }));
const documentResponse = await fetch(`${base}/api/documents`, { method: "POST", body: form });
const documentBody = await documentResponse.json();
if (!documentResponse.ok) throw new Error(`/api/documents -> ${documentResponse.status}: ${documentBody.error ?? JSON.stringify(documentBody)}`);

const orchestrated = await json("/api/agent-control", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "orchestrate", operationId, stageCategory: "Floresta · Invoice / NF", documentId: documentBody.document.id }),
});
assert.equal(orchestrated.settings.autonomyLevel, 1);
assert.equal(orchestrated.settings.externalPaymentsEnabled, false);
assert.equal(orchestrated.job.status, "Aguardando aprovação");
assert.ok(orchestrated.candidates.length >= 1);

const approved = await json("/api/agent-control", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "approve", operationId, jobId: orchestrated.job.jobId, approvedBy: "E2E Human Reviewer" }),
});
assert.equal(approved.job.status, "Concluído");
assert.ok(approved.job.confidence > 0);
assert.ok(approved.ledger.some((entry) => entry.jobId === orchestrated.job.jobId && entry.entryType === "AGENT COST"));
assert.ok(approved.reputation.some((entry) => entry.agentId === approved.job.providerAgent && entry.capability === approved.job.capability && entry.successCount >= 1));

const dossier = await fetch(`${base}/api/eudr-report?operationId=${operationId}&attachments=0&mode=test&lang=en`);
assert.equal(dossier.status, 200);
assert.match(dossier.headers.get("content-type") ?? "", /^application\/pdf/);
const dossierBytes = await dossier.arrayBuffer();
assert.ok(dossierBytes.byteLength > 1000);
const dossierPdf = await PDFDocument.load(dossierBytes);
assert.equal(dossierPdf.getPageCount(), 5, "The compact EUDR report must keep the approved five-page core");

console.log(JSON.stringify({ operationId, carCode, documentId: documentBody.document.id, jobId: approved.job.jobId, status: approved.job.status, agent: approved.job.providerAgent, confidence: approved.job.confidence, cost: approved.job.actualPrice, ledgerEntries: approved.ledger.length, dossier: "PDF generated" }, null, 2));

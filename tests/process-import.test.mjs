import assert from "node:assert/strict";
import test from "node:test";
import { EXPORT_ORDER_MILESTONES } from "../lib/export-control.ts";
import { convertOperation, currentMilestoneSequence, extractProcessBundle, milestonesFor } from "../lib/process-import.ts";

test("status do app antigo define a etapa atual", () => {
  assert.equal(currentMilestoneSequence("Cadastro inicial"), 1);
  assert.equal(currentMilestoneSequence("Pedido confirmado"), 2);
  assert.equal(currentMilestoneSequence("EM PRODUÇÃO · importado do Asana"), 4);
  assert.equal(currentMilestoneSequence("DOCUMENTAÇÃO · importado do Asana"), 9);
  assert.equal(currentMilestoneSequence("Set documental"), 9);
  assert.equal(currentMilestoneSequence("Em trânsito"), 12);
  assert.equal(currentMilestoneSequence("Chegada ao destino"), 13);
  assert.equal(currentMilestoneSequence("Entregue ao cliente"), 15);
  assert.equal(currentMilestoneSequence("Pós-venda · revisar tracking"), 15);
});

test("etapas anteriores concluídas, atual em andamento, seguintes pendentes", () => {
  const steps = milestonesFor({ status: "Em trânsito", shipmentDate: "2026-09-01", internalResponsible: "Ivam", responsibleEmail: "" }, "2026-10-15T00:00:00Z", EXPORT_ORDER_MILESTONES);
  assert.equal(steps.length, EXPORT_ORDER_MILESTONES.length);
  assert.ok(steps.filter((step) => step.sequence < 12).every((step) => step.status === "Concluído" && step.completedAt));
  assert.equal(steps.find((step) => step.code === "IN_TRANSIT").status, "Em andamento");
  assert.ok(steps.filter((step) => step.sequence > 12).every((step) => step.status === "Pendente"));
  assert.equal(steps.find((step) => step.code === "SHIPMENT_APPROVAL").shipmentApproval, "Aprovado");
  assert.equal(steps.find((step) => step.code === "BOOKING").dueDate, "2026-09-01");
});

test("converte processo preservando campos e ids antigos", () => {
  const operation = convertOperation({ id: 8, reference: "GBU003-26", supplierId: 5, importerClientId: 6, masterProductId: 1, propertyIds: "[\"SC-1\"]", commercialValue: "1234.5", status: "", bookingNumber: "SA06", createdAt: "2026-07-01 10:00:00" });
  assert.equal(operation.sourceId, 8);
  assert.equal(operation.sourceSupplierId, 5);
  assert.deepEqual(operation.propertyIds, ["SC-1"]);
  assert.equal(operation.values.commercialValue, 1234.5);
  assert.equal(operation.values.status, "Cadastro inicial");
  assert.equal(operation.values.bookingNumber, "SA06");
  assert.equal(operation.values.createdAt, "2026-07-01 10:00:00");
});

test("lê backup e exportação integral", () => {
  assert.equal(extractProcessBundle({ data: { operations: [{}], properties: [{}, {}] } }).properties.length, 2);
  assert.equal(extractProcessBundle({ tables: { operations: [{}], rural_properties: [{}], operation_partners: [{}] } }).partners.length, 1);
});

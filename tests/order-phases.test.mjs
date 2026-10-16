import assert from "node:assert/strict";
import test from "node:test";
import { EXPORT_ORDER_MILESTONES } from "../lib/export-control.ts";
import { ORDER_PHASES, currentPhaseIndex, phaseIndexOfCode } from "../lib/order-phases.ts";

test("every Export Control milestone belongs to exactly one order phase", () => {
  const mapped = ORDER_PHASES.flatMap((phase) => phase.codes);
  assert.equal(new Set(mapped).size, mapped.length);
  assert.deepEqual([...mapped].sort(), EXPORT_ORDER_MILESTONES.map((milestone) => milestone.code).sort());
});

test("phases follow the milestone sequence", () => {
  const indexes = EXPORT_ORDER_MILESTONES.map((milestone) => phaseIndexOfCode(milestone.code));
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
});

const rows = (statuses) => EXPORT_ORDER_MILESTONES.map((milestone, index) => ({ code: milestone.code, sequence: milestone.sequence, status: statuses[index] ?? "Pendente" }));

test("current phase is the phase of the first open milestone", () => {
  assert.equal(currentPhaseIndex([]), 0);
  assert.equal(currentPhaseIndex(rows([])), 0);
  // pedido concluído e EUDR suspenso (não aplicável): fase Produção pela programação
  assert.equal(currentPhaseIndex(rows(["Concluído", "Suspenso"])), 1);
  // até controle de qualidade concluído: Embarque
  assert.equal(currentPhaseIndex(rows(["Concluído", "Concluído", "Concluído", "Concluído", "Concluído"])), 2);
  assert.equal(currentPhaseIndex(rows(Array(14).fill("Concluído"))), 5);
});

import assert from "node:assert/strict";
import test from "node:test";
import { canApproveShipment } from "../lib/export-control.ts";

test("non-EU shipment approval ignores EUDR readiness and document score", () => {
  assert.equal(canApproveShipment({
    eudrRequired: false,
    eudrReadiness: 0,
    countryComplianceScore: 0,
    qualityStatus: "Aprovado",
    previousStagesComplete: true,
  }), true);
});

test("non-EU shipment approval is blocked when quality is rejected", () => {
  assert.equal(canApproveShipment({
    eudrRequired: false,
    eudrReadiness: 0,
    countryComplianceScore: 0,
    qualityStatus: "Reprovado",
    previousStagesComplete: true,
  }), false);
});

test("shipment approval requires the previous operational stages", () => {
  assert.equal(canApproveShipment({
    eudrRequired: false,
    eudrReadiness: 0,
    countryComplianceScore: 0,
    qualityStatus: "Aprovado",
    previousStagesComplete: false,
  }), false);
});

test("EU shipment approval keeps EUDR and country compliance gates", () => {
  assert.equal(canApproveShipment({
    eudrRequired: true,
    eudrReadiness: 80,
    countryComplianceScore: 100,
    qualityStatus: "Aprovado",
    previousStagesComplete: true,
  }), false);
});

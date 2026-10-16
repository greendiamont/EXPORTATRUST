import assert from "node:assert/strict";
import test from "node:test";
import { countryRequirements, isEudrRequired, isEuDestination, requirementMatches } from "../lib/export-control.ts";

test("EU destination is recognized in Portuguese, English and ISO code", () => {
  for (const country of ["Itália", "Italy", "IT", "Germany", "Alemanha", "DE", "Netherlands", "Holanda", "Países Baixos", "Czech Republic", "Tchéquia", "Spain"]) {
    assert.equal(isEuDestination(country), true, country);
  }
  for (const country of ["United Kingdom", "Reino Unido", "USA", "China", "Japan", "Chile", "Indonesia"]) {
    assert.equal(isEuDestination(country), false, country);
  }
});

test("wood pellets to Italy require EUDR (regression: English country names disabled it)", () => {
  assert.equal(isEudrRequired("Italy", "4401.31", "Wood pellets"), true);
  assert.equal(isEudrRequired("Itália", "", "Pellets de madeira"), true);
});

test("all seven EUDR commodities are covered by HS code", () => {
  for (const hs of ["0102.29", "1801.00", "0901.11", "1511.10", "4001.10", "1201.90", "4407.11", "4801.00", "9403.60"]) {
    assert.equal(isEudrRequired("Germany", hs, ""), true, hs);
  }
});

test("HS codes merely containing 44 are not treated as wood", () => {
  assert.equal(isEudrRequired("Germany", "8544.42", "Insulated cables"), false);
  assert.equal(isEudrRequired("Germany", "0944", ""), false);
});

test("non-EU destinations do not require EUDR", () => {
  assert.equal(isEudrRequired("United States", "4401.31", "Wood pellets"), false);
});

test("short document keywords need whole words", () => {
  const ispm = countryRequirements("Italy", "4401.31", "Wood pellets").find((item) => item.key === "ispm15");
  assert.ok(ispm);
  assert.equal(requirementMatches(ispm, ["Freight invoice - weight report"]), false);
  assert.equal(requirementMatches(ispm, ["Certificado HT pallets"]), true);
  assert.equal(requirementMatches(ispm, ["ISPM 15 certificate"]), true);
  const bl = countryRequirements("Italy", "4401.31", "Wood pellets").find((item) => item.key === "transport_document");
  assert.equal(requirementMatches(bl, ["BL draft MSC"]), true);
  assert.equal(requirementMatches(bl, ["Tabela de cálculo"]), false);
});

test("UK and US timber rules use whole-word country matching", () => {
  assert.ok(countryRequirements("UK", "4407", "Sawn wood").some((item) => item.key === "uk_timber"));
  assert.ok(countryRequirements("United States", "4407", "Sawn wood").some((item) => item.key === "lacey"));
  assert.ok(!countryRequirements("Ukraine", "4407", "Sawn wood").some((item) => item.key === "uk_timber"));
});

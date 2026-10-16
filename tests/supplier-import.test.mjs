import assert from "node:assert/strict";
import test from "node:test";
import { convertLegacySupplier, extractSupplierRows, fieldsToComplete } from "../lib/supplier-import.ts";

const legacy = {
  id: 10, organizationId: 1, legalName: "PROMADEIRAS REPRESENTAÇÕES LTDA", tradeName: "PROMADEIRAS", taxId: "60.340.714/0001-70",
  country: "Brasil", state: "PR", city: "RODOVIA BR116 S/N KM 140 LAGOINHA - DEP 83800-000 MANDIRITUBA PR'",
  contactName: "Fulano", email: "Contato@Exemplo.com", phone: "41 0000", certifications: "FSC", aliases: "", products: "Pallets",
  productionUnits: "MANDIRITUBA", bankDetails: "Banco X ag 1 cc 2", status: "Homologado", createdAt: "2026-09-01 10:00:00",
};

test("aceita exportação portátil, exportação integral e lista simples", () => {
  assert.equal(extractSupplierRows({ format: "ExportaTrust Portable Export v2", data: { suppliers: [legacy] } }).length, 1);
  assert.equal(extractSupplierRows({ tables: { suppliers: [{ legal_name: "A" }, { legal_name: "B" }] } }).length, 2);
  assert.equal(extractSupplierRows([legacy]).length, 1);
  assert.equal(extractSupplierRows({ data: {} }).length, 0);
});

test("preserva todas as informações e separa o endereço digitado no campo cidade", () => {
  const { supplier, adjustments } = convertLegacySupplier(legacy);
  assert.equal(supplier.sourceId, 10);
  assert.equal(supplier.address, legacy.city, "texto original vai inteiro para Endereço");
  assert.equal(supplier.city, "MANDIRITUBA");
  assert.equal(supplier.taxId, "60340714000170");
  assert.equal(supplier.email, "contato@exemplo.com");
  for (const key of ["legalName", "tradeName", "contactName", "phone", "certifications", "products", "productionUnits", "bankDetails", "status", "createdAt"]) {
    assert.equal(supplier[key], legacy[key], key);
  }
  assert.equal(adjustments.length, 1);
});

test("lê colunas no formato do banco (snake_case) e corrige UF digitada com cidade", () => {
  const { supplier, adjustments } = convertLegacySupplier({ id: 4, legal_name: "VJ RAUBER", tax_id: "97045454000200", city: "Piratini", state: "PIRATINI – RS", bank_details: "Banco Y", production_units: "" });
  assert.equal(supplier.state, "RS");
  assert.equal(supplier.bankDetails, "Banco Y");
  assert.equal(supplier.certifications, "Sem certificação");
  assert.equal(adjustments.length, 1);
});

test("cidade sem número não é tratada como endereço; CNPJ inválido vira aviso", () => {
  const { supplier, warnings } = convertLegacySupplier({ legalName: "TAEDA", city: "MONTE CARLO - MISSIONES", country: "Brasil", taxId: "11111111111111" }, () => false);
  assert.equal(supplier.city, "MONTE CARLO - MISSIONES");
  assert.equal(supplier.address, "");
  assert.ok(warnings.some((text) => text.includes("dígitos")));
});

test("completar nunca sobrescreve campo preenchido", () => {
  const { supplier } = convertLegacySupplier(legacy);
  const changes = fieldsToComplete({ legalName: "X", phone: "99 9999", bankDetails: "", address: "", certifications: "Sem certificação" }, supplier);
  assert.equal(changes.phone, undefined);
  assert.equal(changes.bankDetails, legacy.bankDetails);
  assert.equal(changes.address, legacy.city);
  assert.equal(changes.certifications, "FSC");
});

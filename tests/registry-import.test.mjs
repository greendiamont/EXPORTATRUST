import assert from "node:assert/strict";
import test from "node:test";
import { extractRegistryRecords, registryFieldsToComplete } from "../lib/registry-import.ts";

const backup = {
  format: "ExportaTrust Portable Export v2",
  data: {
    operations: [
      { id: 1, importerClientId: 2, euImporter: "Danubia", destinationCountry: "Itália p", portOfDischarge: "TRIESTE", incoterm: "cfr", currency: "eur", masterProductId: 2, product: "Pellets de madeira", hsCode: "4401.31.00", species: "Pinus", supplierId: 1, quantityUnit: "MT" },
      { id: 2, importerClientId: 2, euImporter: "DANUBIA", destinationCountry: "Revisar destino", portOfDischarge: "", incoterm: "", currency: "", masterProductId: 2, product: "Pellets de madeira", hsCode: "4401.031.00", supplierId: 3, quantityUnit: "MT" },
    ],
    partners: [{ operationId: 1, role: "Importador europeu", contactName: "Andi", email: "Andi@Danubia.com" }],
    auditTrail: [{ action: "IMPORTER_CLIENT_UPDATED", entityId: "2", metadataJson: "{\"legalName\":\"DANUBIA WOOD GMBH\"}" }],
  },
};

test("sem tabela de clientes, reconstrói pelos processos com o nome oficial da auditoria", () => {
  const [client] = extractRegistryRecords(backup, "clientes");
  assert.equal(client.sourceId, 2);
  assert.equal(client.name, "DANUBIA WOOD GMBH");
  assert.equal(client.values.aliases, "DANUBIA, Danubia", "mais recentes primeiro");
  assert.equal(client.values.country, "Itália", "ignora 'Revisar destino' e sobra de digitação");
  assert.equal(client.values.preferredPort, "TRIESTE");
  assert.equal(client.values.preferredIncoterm, "CFR");
  assert.equal(client.values.preferredCurrency, "EUR");
  assert.equal(client.values.contactName, "Andi");
  assert.equal(client.values.email, "andi@danubia.com");
  assert.equal(client.values.dataStatus, "Pendente");
  assert.ok(client.derived);
});

test("produto reconstruído traz fornecedores antigos e avisa NCMs divergentes", () => {
  const [product] = extractRegistryRecords(backup, "produtos");
  assert.equal(product.name, "Pellets de madeira");
  assert.deepEqual(product.sourceSupplierIds.sort(), [1, 3]);
  assert.equal(product.values.salesUnit, "MT");
  assert.ok(product.warnings.some((text) => text.includes("NCMs diferentes")));
});

test("tabela completa (exportação integral) tem prioridade e preserva os campos", () => {
  const full = { tables: { importer_clients: [{ id: 2, legal_name: "DANUBIA WOOD GMBH", tax_id: "ATU 123", country: "Áustria", bank_details: "IBAN AT00", data_status: "Verificado" }], master_products: [{ id: 2, name: "Pellets", hs_code: "4401.31", kd: 1, eligible_supplier_ids: "[1,3]" }] } };
  const [client] = extractRegistryRecords(full, "clientes");
  assert.equal(client.taxId, "ATU123");
  assert.equal(client.values.bankDetails, "IBAN AT00");
  assert.equal(client.derived, false);
  const [product] = extractRegistryRecords(full, "produtos");
  assert.equal(product.values.kd, true);
  assert.deepEqual(product.sourceSupplierIds, [1, 3]);
});

test("completar nunca sobrescreve e promove Pendente para Verificado com a ficha completa", () => {
  const full = extractRegistryRecords({ tables: { importer_clients: [{ legal_name: "X", country: "Áustria", phone: "+43", data_status: "Verificado" }] } }, "clientes")[0];
  const changes = registryFieldsToComplete({ country: "Itália", phone: "", dataStatus: "Pendente" }, full);
  assert.equal(changes.country, undefined);
  assert.equal(changes.phone, "+43");
  assert.equal(changes.dataStatus, "Verificado");
});

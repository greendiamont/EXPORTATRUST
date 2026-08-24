import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isBrazil, isValidBrazilianCnpj, normalizeTaxId } from "../lib/supplier-validation.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("supplier tax ids are normalized and Brazilian CNPJs are validated", () => {
  assert.equal(normalizeTaxId("04.252.011/0001-10"), "04252011000110");
  assert.equal(isBrazil(" Brasil "), true);
  assert.equal(isValidBrazilianCnpj("04.252.011/0001-10"), true);
  assert.equal(isValidBrazilianCnpj("00.000.000/0000-00"), false);
});

test("supplier uniqueness is tenant-scoped and has a safe migration", async () => {
  const schema = await read("db/schema.ts");
  const migration = await read("drizzle/0015_eager_joshua_kane.sql");
  assert.match(schema, /suppliers_org_tax_id_idx/);
  assert.match(schema, /table\.organizationId, table\.taxId/);
  assert.match(migration, /DROP INDEX `suppliers_tax_id_unique`/);
  assert.match(migration, /CREATE UNIQUE INDEX `suppliers_org_tax_id_idx` ON `suppliers` \(`organization_id`,`tax_id`\)/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM/);
});

test("supplier save failures remain visible in the form", async () => {
  const client = await read("app/client-app.tsx");
  const route = await read("app/api/suppliers/route.ts");
  const schema = await read("db/schema.ts");
  assert.match(client, /supplierSaveError/);
  assert.match(client, /role="alert"/);
  assert.match(route, /Este CNPJ\/identificador fiscal já está cadastrado nesta empresa/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /SUPPLIER_UPDATED/);
  assert.match(client, /editingSupplierId/);
  assert.match(route, /status: "Homologado"/);
  assert.doesNotMatch(client, /"Em homologação", "Bloqueado"/);
  assert.match(schema, /aliases: text\("aliases"\)/);
  assert.match(schema, /products: text\("products"\)/);
  assert.match(schema, /productionUnits: text\("production_units"\)/);
  assert.match(schema, /bankDetails: text\("bank_details"\)/);
  assert.match(route, /ALTER TABLE suppliers ADD bank_details/);
  assert.match(route, /bankDetails: String\(body\.bankDetails/);
  assert.match(client, /Aliases \/ nomes alternativos/);
  assert.match(client, /Dados bancários/);
  assert.match(client, /Documentos vinculados/);
  assert.match(client, /supplier\?\.productionUnits/);
  assert.match(client, /function beginEditSupplier/);
  assert.match(client, /Editar fornecedor ✎/);
  assert.match(client, /function closeSupplierDrawer/);
});

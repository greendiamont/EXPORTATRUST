import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("operation create and edit keep the form open until D1 confirms persistence", async () => {
  const client = await read("app/client-app.tsx");
  const route = await read("app/api/operations/route.ts");
  const schema = await read("db/schema.ts");

  assert.match(schema, /export const operations = sqliteTable\("operations"/);
  assert.match(schema, /id: integer\("id"\)\.primaryKey\(\{ autoIncrement: true \}\)/);
  assert.match(route, /db\.insert\(operations\).*\.returning\(\)/s);
  assert.match(route, /db\.update\(operations\).*\.returning\(\)/s);
  assert.match(route, /importerClientId: master\.importerClientId/);
  assert.match(route, /masterProductId: master\.masterProductId/);
  assert.match(route, /CREATE TABLE IF NOT EXISTS operations/);
  assert.match(route, /organization_id integer DEFAULT 1 NOT NULL/);
  assert.match(route, /ALTER TABLE \$\{table\} ADD \$\{column\.definition\}/);
  assert.match(route, /importer_client_id integer/);
  assert.match(route, /master_product_id integer/);
  assert.match(route, /existingOperation.*duplicate: true/s);
  assert.match(schema, /importerClientId: integer\("importer_client_id"\)/);
  assert.match(schema, /masterProductId: integer\("master_product_id"\)/);
  assert.match(client, /setOperationSaveError\(errorMessage\)/);
  assert.match(client, /O backend não confirmou a persistência da operação/);
  assert.match(client, /setOperations\(confirmationData\.operations!\)/);
  assert.match(client, /list="operation-products"/);
  assert.match(client, /updateOperationClientName/);
  assert.match(client, /se for novo, será criado ao salvar/);
  assert.doesNotMatch(client, /\["lotCodes", "Códigos dos lotes"\]/);
  assert.doesNotMatch(client, /\["quantity", "Quantidade"\]/);
});

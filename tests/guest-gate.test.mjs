import assert from "node:assert/strict";
import test from "node:test";
import { guestGate } from "../server/railway/collaborators.mjs";

const ops = [{ id: 9, reference: "PO0657" }];
const gate = (method, path) => guestGate(method, new URL(path, "http://x"), ops);

test("convidado: só o processo liberado e as APIs operacionais dele", () => {
  assert.equal(gate("GET", "/pedidos/9"), null);
  assert.equal(gate("GET", "/api/export-control?operationId=9"), null);
  assert.equal(gate("GET", "/api/operation-activity?operationId=9"), null);
  assert.equal(gate("POST", "/api/documents"), null);
  assert.equal(gate("GET", "/api/export-control?operationId=15").status, 403);
  assert.equal(gate("GET", "/api/export-control?operationId=9&document=sales-order").status, 403);
  assert.equal(gate("POST", "/api/export-control"), null); // a rota restringe às etapas/tarefas do processo
  assert.equal(gate("DELETE", "/api/documents?id=1"), null); // a rota confere o processo do arquivo
  assert.equal(gate("GET", "/api/overview").status, 403);
  assert.equal(gate("PATCH", "/api/operations").status, 403);
  assert.equal(gate("GET", "/api/shipment-advice?operationId=9").status, 403);
  assert.equal(gate("GET", "/pedidos/15").headers.location, "/pedidos/9");
  assert.equal(gate("GET", "/cadastros").headers.location, "/pedidos/9");
});

test("convidado com vários processos vê a lista dos dele", () => {
  const page = guestGate("GET", new URL("/", "http://x"), [...ops, { id: 12, reference: "GBU<1>" }]);
  assert.equal(page.status, 200);
  assert.match(page.body, /\/pedidos\/12/);
  assert.match(page.body, /GBU&lt;1&gt;/);
});

import assert from "node:assert/strict";
import test from "node:test";

// Exercita os handlers reais do build. Uma Response de autenticação lançada sem
// catch é convertida em 500 pelo vinext: foi o erro observado na homologação.
test("catalog GET handlers preserve authentication responses instead of returning 500", async () => {
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
  for (const path of ["/api/importer-clients", "/api/master-products"]) {
    const response = await worker.fetch(new Request(`https://auth-test.example${path}`), {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 401, `${path}: unauthenticated requests must receive 401`);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.match((await response.json()).error, /Autenticação obrigatória/);
  }
});

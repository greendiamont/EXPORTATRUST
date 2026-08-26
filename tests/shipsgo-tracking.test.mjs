import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const integration = readFileSync(new URL("../lib/shipsgo.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/export-control/route.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../app/client-app.tsx", import.meta.url), "utf8");

test("ShipsGo tracking stays server-side and reuses the external request", () => {
  assert.match(integration, /SHIPSGO_API_KEY/);
  assert.match(integration, /PostCustomContainerForm/);
  assert.match(route, /previousRequestId/);
  assert.match(route, /ShipsGo · \$\{result\.requestId\}/);
  assert.doesNotMatch(client, /SHIPSGO_API_KEY/);
});

test("shipment tracking exposes a native map and requires an explicit send action", () => {
  assert.match(client, /id="shipment-tracking"/);
  assert.match(client, /openstreetmap\.org\/export\/embed/);
  assert.match(client, /Rastrear e enviar atualização ao cliente/);
  assert.match(client, /Configuração necessária/);
});

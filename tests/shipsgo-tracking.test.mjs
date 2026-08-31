import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const integration = readFileSync(new URL("../lib/shipsgo.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/export-control/route.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../app/client-app.tsx", import.meta.url), "utf8");

test("ShipsGo tracking stays server-side and reuses the external request", () => {
  assert.match(integration, /SHIPSGO_API_KEY/);
  assert.match(integration, /PostCustomContainerForm/);
  assert.match(integration, /URLSearchParams/);
  assert.match(integration, /application\/x-www-form-urlencoded/);
  assert.doesNotMatch(integration, /new FormData/);
  assert.match(route, /previousRequestId/);
  assert.match(route, /ShipsGo · \$\{result\.requestId\}/);
  assert.doesNotMatch(client, /SHIPSGO_API_KEY/);
});

test("shipment tracking exposes a native map and requires an explicit send action", () => {
  assert.match(client, /id="shipment-tracking"/);
  assert.match(client, /openstreetmap\.org\/export\/embed/);
  assert.match(client, /Rastrear via ShipsGo e enviar ao cliente/);
  assert.match(client, /Sem consumo de crédito/);
});

test("free assisted tracking can route to carrier websites and log manual status", () => {
  assert.match(integration, /freeTrackingGuide/);
  assert.match(integration, /maersk\.com\/tracking/);
  assert.match(integration, /msc\.com\/en\/track-a-shipment/);
  assert.match(route, /assisted-tracking-log/);
  assert.match(route, /Assistido Free/);
  assert.match(client, /Abrir site oficial do armador/);
  assert.match(client, /Registrar tracking encontrado/);
});

test("booking stage owns booking number and container capture", () => {
  assert.match(route, /booking-logistics/);
  assert.match(route, /BOOKING_LOGISTICS_UPDATED/);
  assert.match(client, /ETAPA 07 · DADOS DO BOOKING/);
  assert.match(client, /Booking Number/);
  assert.match(client, /Contêiner\(es\) utilizados/);
  assert.match(client, /Salvar dados do booking e containers/);
});

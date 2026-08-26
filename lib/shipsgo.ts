type ShipmentInput = {
  bookingNumber: string;
  billOfLadingNumber: string;
  containerNumbers: string;
  carrier: string;
  requestId?: string;
};

export type ShipsGoResult = {
  status: string;
  location: string;
  eta: string;
  details: string;
  latitude: number | null;
  longitude: number | null;
  requestId: string;
};

function firstValue(value: unknown, names: string[]): unknown {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstValue(item, names);
      if (found !== undefined && found !== null && found !== "") return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (names.some((name) => name.toLowerCase() === key.toLowerCase()) && item !== null && item !== "") return item;
  }
  for (const item of Object.values(record)) {
    const found = firstValue(item, names);
    if (found !== undefined && found !== null && found !== "") return found;
  }
  return undefined;
}

function textValue(payload: unknown, names: string[], fallback = "") {
  const value = firstValue(payload, names);
  return value === undefined || value === null ? fallback : String(value).trim();
}

function numberValue(payload: unknown, names: string[]) {
  const parsed = Number(firstValue(payload, names));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function shipsGoConfiguration() {
  const { env } = await import("cloudflare:workers");
  const token = String(env.SHIPSGO_API_KEY || "").trim();
  return { configured: Boolean(token), provider: "ShipsGo", token };
}

export async function trackOceanShipment(input: ShipmentInput): Promise<ShipsGoResult> {
  const configuration = await shipsGoConfiguration();
  if (!configuration.configured) throw new Error("Configure o secret SHIPSGO_API_KEY no ambiente de produção para ativar o rastreamento marítimo.");
  const container = input.containerNumbers.split(/[;,\s]+/).map((item) => item.trim()).find(Boolean) || "";
  const reference = container || input.billOfLadingNumber || input.bookingNumber;
  if (!reference) throw new Error("Cadastre ao menos um contêiner, BL ou booking antes de rastrear.");

  let requestId = input.requestId || "";
  if (!requestId) {
    const form = new FormData();
    form.set("authCode", configuration.token);
    form.set("shippingLine", input.carrier || "OTHERS");
    form.set("referenceNo", reference);
    if (container) form.set("containerNumber", container);
    else form.set("blContainersRef", input.billOfLadingNumber || input.bookingNumber);
    const createEndpoint = container ? "PostCustomContainerForm" : "PostCustomContainerFormWithBl";
    const created = await fetch(`https://shipsgo.com/api/v1.2/ContainerService/${createEndpoint}`, { method: "POST", body: form, headers: { Accept: "application/json" } });
    const createdPayload = await created.json().catch(() => ({}));
    if (!created.ok) throw new Error(`ShipsGo não aceitou o novo rastreamento (${created.status}). Confirme armador, referência e créditos disponíveis.`);
    requestId = textValue(createdPayload, ["requestId", "request_id", "id"]);
    if (!requestId) throw new Error("ShipsGo criou a solicitação, mas não devolveu o identificador de acompanhamento.");
  }

  const query = new URLSearchParams({ authCode: configuration.token, requestId, mappoint: "true", extended: "true", containerType: "true", co2: "true" });
  const response = await fetch(`https://shipsgo.com/api/v1.2/ContainerService/GetContainerInfo/?${query.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`ShipsGo não concluiu a consulta (${response.status}). Confirme o código rastreado e o saldo da conta.`);

  const status = textValue(payload, ["status", "statusName", "shippingStatus", "lastEvent"], "Tracking consultado");
  const location = textValue(payload, ["location", "currentLocation", "lastLocation", "portName"], input.carrier || "Posição informada pelo armador");
  const eta = textValue(payload, ["eta", "podEta", "arrivalDate", "estimatedArrival"]);
  const vessel = textValue(payload, ["vesselName", "vessel"]);
  const voyage = textValue(payload, ["voyageNo", "voyageNumber", "voyage"]);
  const details = [reference ? `Referência ${reference}` : "", vessel ? `Navio ${vessel}` : "", voyage ? `viagem ${voyage}` : "", input.carrier].filter(Boolean).join(" · ");
  return {
    status,
    location,
    eta,
    details: details || "Atualização recebida do ShipsGo.",
    latitude: numberValue(payload, ["latitude", "lat"]),
    longitude: numberValue(payload, ["longitude", "lng", "lon"]),
    requestId,
  };
}

export function encodeTrackingLocation(location: string, latitude: number | null, longitude: number | null) {
  return latitude === null || longitude === null ? location : `${location}|||${latitude}|||${longitude}`;
}

type ShipmentInput = {
  bookingNumber: string;
  billOfLadingNumber: string;
  containerNumbers: string;
  carrier: string;
  requestId?: string;
};

type FreeTrackingInput = Omit<ShipmentInput, "requestId">;

export type ShipsGoResult = {
  status: string;
  location: string;
  eta: string;
  details: string;
  latitude: number | null;
  longitude: number | null;
  requestId: string;
};

export type FreeTrackingGuide = {
  mode: "carrier-site" | "generic-search";
  carrier: string;
  reference: string;
  referenceType: "container" | "bl" | "booking" | "missing";
  officialUrl: string;
  helperText: string;
  confidence: "Alta" | "Média" | "Baixa";
};

const carrierTrackingTargets = [
  { match: ["maersk", "sealand", "hamburg sud", "hamburg süd"], carrier: "Maersk", url: "https://www.maersk.com/tracking/" },
  { match: ["msc", "mediterranean"], carrier: "MSC", url: "https://www.msc.com/en/track-a-shipment" },
  { match: ["cma", "cgm", "anl"], carrier: "CMA CGM", url: "https://www.cma-cgm.com/ebusiness/tracking" },
  { match: ["hapag", "lloyd"], carrier: "Hapag-Lloyd", url: "https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html" },
  { match: ["one", "ocean network"], carrier: "ONE", url: "https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking" },
  { match: ["evergreen", "ever green"], carrier: "Evergreen", url: "https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do" },
  { match: ["cosco"], carrier: "COSCO", url: "https://elines.coscoshipping.com/ebusiness/cargoTracking" },
  { match: ["zim"], carrier: "ZIM", url: "https://www.zim.com/tools/track-a-shipment" },
  { match: ["yang ming", "yangming"], carrier: "Yang Ming", url: "https://www.yangming.com/e-service/track_trace/track_trace_cargo_tracking.aspx" },
  { match: ["hmm", "hyundai"], carrier: "HMM", url: "https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do" },
  { match: ["pil", "pacific international"], carrier: "PIL", url: "https://www.pilship.com/en-our-track-and-trace-pil-pacific-international-lines/120.html" },
];

const containerPrefixCarrier: Record<string, string> = {
  MAEU: "Maersk",
  MSKU: "Maersk",
  MRKU: "Maersk",
  SUDU: "Maersk",
  MSCU: "MSC",
  MEDU: "MSC",
  MSBU: "MSC",
  CMAU: "CMA CGM",
  CGMU: "CMA CGM",
  ECMU: "CMA CGM",
  HLCU: "Hapag-Lloyd",
  ONEU: "ONE",
  EGLV: "Evergreen",
  EMCU: "Evergreen",
  COSU: "COSCO",
  CBHU: "COSCO",
  ZIMU: "ZIM",
  YMLU: "Yang Ming",
  HDMU: "HMM",
  PCIU: "PIL",
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

async function shipsGoPayload(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.trim() };
  }
}

function shipsGoError(action: string, response: Response, payload: unknown) {
  const providerMessage = textValue(payload, ["message", "error", "errorMessage", "Message", "ExceptionMessage"]);
  const detail = providerMessage ? ` Detalhe ShipsGo: ${providerMessage}` : "";
  if (response.status === 401) {
    return new Error(`ShipsGo recusou a autenticação (${response.status}) ao ${action}. Confirme se a chave API está ativa para Ocean Tracking e se a conta possui permissão/créditos.${detail}`);
  }
  return new Error(`ShipsGo não concluiu a ação de ${action} (${response.status}). Confirme armador, referência e créditos disponíveis.${detail}`);
}

export async function shipsGoConfiguration() {
  const { env } = await import("cloudflare:workers");
  const token = String(env.SHIPSGO_API_KEY || "").trim();
  return { configured: Boolean(token), provider: "ShipsGo", token };
}

function firstContainer(value: string) {
  return value.split(/[;,\s]+/).map((item) => item.trim().toUpperCase()).find((item) => /^[A-Z]{4}\d{7}$/.test(item)) || "";
}

function resolveCarrier(input: FreeTrackingInput, container: string) {
  const carrierText = input.carrier.toLowerCase();
  const direct = carrierTrackingTargets.find((target) => target.match.some((term) => carrierText.includes(term)));
  if (direct) return { ...direct, confidence: "Alta" as const };
  const byPrefix = containerPrefixCarrier[container.slice(0, 4)];
  const inferred = byPrefix ? carrierTrackingTargets.find((target) => target.carrier === byPrefix) : undefined;
  if (inferred) return { ...inferred, confidence: "Média" as const };
  return undefined;
}

export function freeTrackingGuide(input: FreeTrackingInput): FreeTrackingGuide {
  const container = firstContainer(input.containerNumbers);
  const reference = container || input.billOfLadingNumber.trim() || input.bookingNumber.trim();
  const referenceType = container ? "container" : input.billOfLadingNumber.trim() ? "bl" : input.bookingNumber.trim() ? "booking" : "missing";
  const target = resolveCarrier(input, container);
  if (target && reference) {
    return {
      mode: "carrier-site",
      carrier: target.carrier,
      reference,
      referenceType,
      officialUrl: target.url,
      helperText: `Abra o site oficial da ${target.carrier}, cole ${referenceType === "container" ? "o contêiner" : referenceType === "bl" ? "o BL" : "o booking"} ${reference} e registre o status encontrado no ExportaTrust.`,
      confidence: target.confidence,
    };
  }
  const query = encodeURIComponent([input.carrier, reference, "container tracking"].filter(Boolean).join(" "));
  return {
    mode: "generic-search",
    carrier: input.carrier || "Armador não identificado",
    reference,
    referenceType,
    officialUrl: reference ? `https://www.google.com/search?q=${query}` : "",
    helperText: reference ? "Não identifiquei o armador com segurança. Use a busca assistida e registre o status encontrado." : "Cadastre armador, booking, BL ou contêiner para habilitar a busca assistida.",
    confidence: "Baixa",
  };
}

export async function trackOceanShipment(input: ShipmentInput): Promise<ShipsGoResult> {
  const configuration = await shipsGoConfiguration();
  if (!configuration.configured) throw new Error("Configure o secret SHIPSGO_API_KEY no ambiente de produção para ativar o rastreamento marítimo.");
  const container = input.containerNumbers.split(/[;,\s]+/).map((item) => item.trim()).find(Boolean) || "";
  const reference = container || input.billOfLadingNumber || input.bookingNumber;
  if (!reference) throw new Error("Cadastre ao menos um contêiner, BL ou booking antes de rastrear.");

  let requestId = input.requestId || "";
  if (!requestId) {
    const form = new URLSearchParams();
    form.set("authCode", configuration.token);
    form.set("shippingLine", input.carrier || "OTHERS");
    form.set("referenceNo", reference);
    if (container) form.set("containerNumber", container);
    else form.set("blContainersRef", input.billOfLadingNumber || input.bookingNumber);
    const createEndpoint = container ? "PostCustomContainerForm" : "PostCustomContainerFormWithBl";
    const created = await fetch(`https://shipsgo.com/api/v1.2/ContainerService/${createEndpoint}`, {
      method: "POST",
      body: form,
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    });
    const createdPayload = await shipsGoPayload(created);
    if (!created.ok) throw shipsGoError("criar o rastreamento", created, createdPayload);
    requestId = textValue(createdPayload, ["requestId", "request_id", "id"]);
    if (!requestId) throw new Error("ShipsGo criou a solicitação, mas não devolveu o identificador de acompanhamento.");
  }

  const query = new URLSearchParams({ authCode: configuration.token, requestId, mappoint: "true", extended: "true", containerType: "true", co2: "true" });
  const response = await fetch(`https://shipsgo.com/api/v1.2/ContainerService/GetContainerInfo/?${query.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const payload = await shipsGoPayload(response);
  if (!response.ok) throw shipsGoError("consultar o tracking", response, payload);

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

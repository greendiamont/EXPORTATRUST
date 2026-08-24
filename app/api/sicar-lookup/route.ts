import { parseGeographicInput } from "../../../lib/geo-input";
import { requireSecurityContext } from "../../../lib/security";

const OFFICIAL_PUBLIC_URL = "https://www.car.gov.br/#/consultar";
const SICAR_WFS_URL = "https://geoserver.car.gov.br/geoserver/sicar/ows";
const STATES = new Set(["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"]);

type SicarFeature = {
  type?: string;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown>;
};

function normalizeCar(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replaceAll(/\s+/g, "").replaceAll(".", "");
}

function isCar(value: string) {
  return /^[A-Z]{2}-\d{7}-[A-F0-9]{32}$/.test(value);
}

function asText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function firstText(properties: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = asText(properties[key]);
    if (value) return value;
  }
  return "";
}

function firstNumber(properties: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = properties[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function statusLabel(code: string) {
  if (code === "AT") return "Ativo";
  if (code === "PE") return "Pendente";
  if (code === "CA") return "Cancelado";
  return code || "Não informado";
}

async function fetchSicar(state: string, cqlFilter: string) {
  const params = new URLSearchParams({
    service: "WFS",
    version: "1.0.0",
    request: "GetFeature",
    typeName: `sicar:sicar_imoveis_${state.toLowerCase()}`,
    outputFormat: "application/json",
    CQL_FILTER: cqlFilter,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);
  try {
    const response = await fetch(`${SICAR_WFS_URL}?${params.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": "ExportaTrust-EUDR/1.0" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`SICAR respondeu HTTP ${response.status}`);
    const data = await response.json() as { features?: SicarFeature[] };
    return data.features ?? [];
  } finally {
    clearTimeout(timer);
  }
}

function makeResult(feature: SicarFeature, inputType: "car" | "coordinates", inputFormat?: "decimal" | "dms" | "utm") {
  const properties = feature.properties ?? {};
  const carCode = normalizeCar(properties.cod_imovel);
  const state = asText(properties.uf).toUpperCase() || carCode.slice(0, 2);
  const municipalityCode = asText(properties.cod_municipio_ibge) || carCode.match(/^[A-Z]{2}-(\d{7})-/)?.[1] || "";
  const municipality = asText(properties.municipio);
  const statusCode = asText(properties.status_imovel).toUpperCase();
  const condition = asText(properties.condicao);
  const areaHa = Number(properties.area ?? 0);
  const propertyName = firstText(properties, ["nome_imovel", "nom_imovel", "denominacao", "nome_propriedade"]);
  const nativeAreaHa = firstNumber(properties, ["area_vegetacao_nativa", "vegetacao_nativa", "area_veg_nativa", "area_vn"]);
  const geometry = feature.geometry;

  if (!isCar(carCode) || !geometry || !["Polygon", "MultiPolygon"].includes(geometry.type ?? "")) {
    throw new Error("O SICAR respondeu sem uma geometria de imóvel utilizável.");
  }

  return {
    mode: "automatic" as const,
    inputType,
    inputFormat,
    carCode,
    state,
    municipalityCode,
    municipality,
    propertyName,
    areaHa: Number.isFinite(areaHa) ? areaHa : 0,
    nativeAreaHa,
    nativeAreaAvailable: nativeAreaHa !== undefined,
    statusCode,
    status: statusLabel(statusCode),
    condition,
    registrationCreatedAt: asText(properties.dat_criacao),
    sourceUpdatedAt: asText(properties.data_atualizacao),
    fiscalModules: Number(properties.m_fiscal ?? 0),
    propertyType: asText(properties.tipo_imovel),
    geometry,
    checkedAt: new Date().toISOString(),
    source: "SICAR GeoServer · WFS público",
    officialUrl: `${OFFICIAL_PUBLIC_URL}/${encodeURIComponent(carCode)}`,
    automaticImport: true,
    message: "Imóvel localizado no SICAR. Dados cadastrais e geometria foram carregados automaticamente da base pública.",
  };
}

export async function POST(request: Request) {
  await requireSecurityContext("read");
  try {
    const body = await request.json() as { query?: string; carCode?: string; latitude?: number; longitude?: number; state?: string };
    const rawQuery = asText(body.query || body.carCode);
    const normalizedQueryCar = normalizeCar(rawQuery);
    if (rawQuery && !isCar(normalizedQueryCar)) {
      const parsed = parseGeographicInput(rawQuery);
      if (parsed.kind === "unknown") return Response.json({ error: parsed.error }, { status: 400 });
      const state = asText(body.state).toUpperCase();
      if (!STATES.has(state)) return Response.json({ error: "Para consultar por coordenadas ou UTM, selecione a UF do imóvel." }, { status: 400 });
      const features = await fetchSicar(state, `INTERSECTS(geo_area_imovel,POINT(${parsed.longitude} ${parsed.latitude}))`);
      if (!features.length) return Response.json({ error: "Nenhum imóvel CAR foi encontrado neste ponto e UF." }, { status: 404 });
      return Response.json(makeResult(features[0], "coordinates", parsed.format));
    }
    const hasCoordinates = body.latitude !== undefined || body.longitude !== undefined;

    if (hasCoordinates) {
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      const state = asText(body.state).toUpperCase();
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return Response.json({ error: "Coordenadas inválidas. Informe latitude e longitude em graus decimais." }, { status: 400 });
      }
      if (!STATES.has(state)) {
        return Response.json({ error: "Para consultar por coordenadas, selecione a UF do imóvel." }, { status: 400 });
      }
      const features = await fetchSicar(state, `INTERSECTS(geo_area_imovel,POINT(${longitude} ${latitude}))`);
      if (!features.length) {
        return Response.json({ error: "Nenhum imóvel CAR foi encontrado nesta coordenada e UF." }, { status: 404 });
      }
      return Response.json(makeResult(features[0], "coordinates", "decimal"));
    }

    const carCode = normalizeCar(rawQuery || body.carCode);
    if (!isCar(carCode) || !STATES.has(carCode.slice(0, 2))) {
      return Response.json({ error: "Número CAR inválido. Use o código completo; pontos do recibo antigo são aceitos." }, { status: 400 });
    }

    const state = carCode.slice(0, 2);
    const features = await fetchSicar(state, `cod_imovel IN ('${carCode}')`);
    if (!features.length) {
      return Response.json({ error: "CAR não encontrado na base geoespacial pública do SICAR." }, { status: 404 });
    }
    return Response.json(makeResult(features[0], "car"));
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "A consulta ao SICAR excedeu o tempo limite. Tente novamente ou use o GeoJSON manual."
      : error instanceof Error ? error.message : "Não foi possível consultar o SICAR.";
    return Response.json({ error: message }, { status: 502 });
  }
}

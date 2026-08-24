import type { ForestDossierSicar } from "./forest-dossier-pdf";

type SicarGeometry = { type?: string; coordinates?: unknown } | null;
type SicarFeature = { geometry?: SicarGeometry; properties?: Record<string, unknown> };

function asText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function usableGeometry(geometry: SicarGeometry) {
  return Boolean(geometry && ["Polygon", "MultiPolygon"].includes(geometry.type ?? "") && Array.isArray(geometry.coordinates));
}

export async function fetchCurrentSicarProperty(carCode: string): Promise<{ record: ForestDossierSicar; geometryJson?: string }> {
  try {
    const state = carCode.slice(0, 2).toLowerCase();
    const safeCar = carCode.replaceAll("'", "");
    const params = new URLSearchParams({
      service: "WFS",
      version: "1.0.0",
      request: "GetFeature",
      typeName: `sicar:sicar_imoveis_${state}`,
      outputFormat: "application/json",
      CQL_FILTER: `cod_imovel IN ('${safeCar}')`,
    });
    const response = await fetch(`https://geoserver.car.gov.br/geoserver/sicar/ows?${params}`, {
      headers: { Accept: "application/json", "User-Agent": "ExportaTrust-EUDR/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { record: {} };
    const feature = ((await response.json()) as { features?: SicarFeature[] }).features?.[0];
    const data = feature?.properties ?? {};
    const record: ForestDossierSicar = {
      state: asText(data.uf).toUpperCase() || carCode.slice(0, 2),
      municipality: asText(data.municipio),
      municipalityCode: asText(data.cod_municipio_ibge),
      propertyType: asText(data.tipo_imovel),
      fiscalModules: Number(data.m_fiscal ?? 0),
      condition: asText(data.condicao),
      registrationCreatedAt: asText(data.dat_criacao),
      sourceUpdatedAt: asText(data.data_atualizacao),
      checkedAt: new Date().toISOString(),
    };
    return {
      record,
      geometryJson: usableGeometry(feature?.geometry ?? null) ? JSON.stringify(feature!.geometry) : undefined,
    };
  } catch {
    return { record: {} };
  }
}

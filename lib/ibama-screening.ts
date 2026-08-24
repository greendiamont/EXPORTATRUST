const IBAMA_EMBARGO_QUERY = "https://pamgia.ibama.gov.br/server/rest/services/01_Publicacoes_Bases/adm_embargos_ibama_a/FeatureServer/0/query";

function geometryEnvelope(geometryJson: string) {
  const value = JSON.parse(geometryJson) as { type?: string; coordinates?: unknown; geometry?: { type?: string; coordinates?: unknown } };
  const geometry = value.type === "Feature" ? value.geometry : value;
  const points: number[][] = [];
  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") points.push([node[0], node[1]]);
    else node.forEach(visit);
  };
  visit(geometry?.coordinates);
  if (!points.length) throw new Error("CAR geometry is not available for IBAMA screening.");
  const xs = points.map((point) => point[0]), ys = points.map((point) => point[1]);
  return { xmin: Math.min(...xs), ymin: Math.min(...ys), xmax: Math.max(...xs), ymax: Math.max(...ys), spatialReference: { wkid: 4326 } };
}

export async function screenIbamaEmbargo(geometryJson: string) {
  const params = new URLSearchParams({
    f: "json", where: "1=1", geometry: JSON.stringify(geometryEnvelope(geometryJson)), geometryType: "esriGeometryEnvelope",
    inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "objectid,num_tad,uf,municipio,nome_imovel,nome_embargado,cpf_cnpj_embargado,dat_embargo,qtd_area_embargada,num_processo,des_infracao", returnGeometry: "false", resultRecordCount: "100",
  });
  const response = await fetch(`${IBAMA_EMBARGO_QUERY}?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) throw new Error(`IBAMA PAMGIA returned HTTP ${response.status}.`);
  const payload = await response.json() as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message || "IBAMA screening failed.");
  const matches = (payload.features ?? []).map((feature) => feature.attributes ?? {});
  return { source: "IBAMA/CENIMA · PAMGIA public embargo layer", checkedAt: new Date().toISOString(), intersects: matches.length > 0, matchCount: matches.length, matches };
}


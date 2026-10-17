// EUDR · rastreabilidade (protótipo "4b · EUDR rastreabilidade", aprovado por Ivam em 2026-10-17).
// Regulamento (UE) 2023/1115, alterado pelo 2025/2650 (vale a partir de 30/12/2026). Quem registra a
// DDS no sistema da UE é o importador; o exportador entrega o pacote com origem, legalidade, balanço e
// geolocalização, e guarda o número da DDS no pedido.
//
// Dados:
// - Floresta (rural_properties.eudr_json): tipo de origem (plantio/nativa), produtor, espécie, documentos
//   da floresta com validade e verificações registradas.
// - Pedido (operations.supply_chain_notes.eudr): origens usadas (CAR, colheita, quantidade de entrada,
//   NFs), rendimento da transformação, documentos da cadeia e envio do pacote. O número da DDS fica em
//   operations.eudr_reference.

export type OriginType = "Plantio" | "Nativa";
export type ProductKind = "serrado" | "pellets";
export type DocStatus = "ok" | "pendente" | "nao_se_aplica";

export type DocDefinition = { key: string; label: string; who: string; optional?: boolean; validity?: boolean };

/** Documentos de cada floresta (por tipo de origem). Lista proposta; validar com consultor florestal. */
export const FOREST_DOCS: Record<OriginType, DocDefinition[]> = {
  Plantio: [
    { key: "car", label: "Recibo do CAR (ativo)", who: "Floresta" },
    { key: "titulo", label: "Matrícula do imóvel / contrato de arrendamento", who: "Floresta" },
    { key: "corte", label: "Declaração / autorização de corte de plantio (órgão estadual)", who: "Floresta", validity: true },
    { key: "compra", label: "Contrato ou NF de compra das toras", who: "Produtor → fornecedor" },
  ],
  Nativa: [
    { key: "car", label: "Recibo do CAR (ativo)", who: "Floresta" },
    { key: "titulo", label: "Matrícula do imóvel / contrato de arrendamento", who: "Floresta" },
    { key: "pmfs", label: "Plano de Manejo Florestal Sustentável (PMFS) aprovado", who: "Floresta", validity: true },
    { key: "autex", label: "Autorização de Exploração (AUTEX) da UPA", who: "Floresta", validity: true },
    { key: "dof_origem", label: "DOF / Sinaflor de origem das toras", who: "Produtor → fornecedor" },
  ],
};

/** Documentos da cadeia, por pedido. */
export function orderDocs(kind: ProductKind, hasNative: boolean): DocDefinition[] {
  return [
    { key: "nf_toras", label: "NFs de entrada da matéria-prima por origem", who: "Fornecedor" },
    { key: "romaneio", label: "Romaneio / guia de transporte da matéria-prima", who: "Transportador" },
    { key: "licenca", label: kind === "pellets" ? "Licença ambiental de operação da fábrica de pellets" : "Licença ambiental de operação da serraria", who: "Fornecedor", validity: true },
    { key: "ctf", label: "CTF / IBAMA do fornecedor", who: "Fornecedor", validity: true },
    { key: "cndt", label: "Certidão negativa de débitos trabalhistas (CNDT)", who: "Fornecedor", validity: true },
    { key: "trabalho_escravo", label: "Consulta à lista de trabalho escravo (MTE): fornecedor e produtores", who: "Fornecedor e produtores" },
    ...(hasNative ? [
      { key: "sinaflor_saldo", label: "Saldo de créditos no Sinaflor × volume vendido", who: "Fornecedor" },
      { key: "dof_exportacao", label: "DOF de exportação (produto final)", who: "Exportador" },
    ] : []),
    ...(kind === "pellets" ? [{ key: "enplus", label: "Certificação ENplus / SURE (se exigida pelo cliente)", who: "Fábrica de pellets", optional: true }] : []),
    { key: "certificacao", label: "Certificação FSC / PEFC (se houver)", who: "Fornecedor", optional: true },
    { key: "nf_exportacao", label: "NF de exportação e BL", who: "Exportador" },
  ];
}

export type DocRecord = { status: DocStatus; validUntil: string; documentId: number | null; note: string };
export type ForestCheck = { done: boolean; at: string; by: string; note: string };

/** Verificações da floresta. Fase 1: registro da revisão (com evidência); fase 2: automáticas. */
export const FOREST_CHECKS = [
  { key: "desmatamento", label: "Sem desmatamento após 31/12/2020", source: "Imagem de satélite / MapBiomas Alerta (revisão)" },
  { key: "ibama", label: "Sem embargo IBAMA", source: "IBAMA · camada de embargos" },
  { key: "ti_uc", label: "Fora de terra indígena e unidade de conservação", source: "FUNAI / ICMBio (revisão)" },
  { key: "trabalho_escravo", label: "Produtor fora da lista de trabalho escravo", source: "MTE (revisão)" },
] as const;

export type ForestEudr = {
  originType: OriginType;
  producer: string;
  relation: "propria" | "terceiro";
  species: string;
  scientificName: string;
  docs: Record<string, DocRecord>;
  checks: Record<string, ForestCheck>;
};

export type OrderOrigin = { carCode: string; harvestFrom: string; harvestTo: string; inputQuantity: number; invoices: string };
export type OrderEudr = {
  productKind: ProductKind;
  yieldPercent: number;
  origins: OrderOrigin[];
  docs: Record<string, DocRecord>;
  packageGeneratedAt: string;
  sentAt: string;
  ddsVerification: string;
};

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const number = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; };
const date = (value: unknown) => /^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : "";

function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { value = JSON.parse(value || "{}"); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function docRecords(value: unknown): Record<string, DocRecord> {
  return Object.fromEntries(Object.entries(object(value)).map(([key, raw]) => {
    const item = object(raw);
    const status = (["ok", "pendente", "nao_se_aplica"] as const).find((option) => option === item.status) ?? "pendente";
    return [key.slice(0, 40), { status, validUntil: date(item.validUntil), documentId: Number(item.documentId) || null, note: text(item.note).slice(0, 300) }];
  }));
}

export function readForestEudr(json: unknown, fallbackProducer = ""): ForestEudr {
  const value = object(json);
  const checks = object(value.checks);
  return {
    originType: value.originType === "Nativa" ? "Nativa" : "Plantio",
    producer: text(value.producer) || fallbackProducer,
    relation: value.relation === "terceiro" ? "terceiro" : "propria",
    species: text(value.species),
    scientificName: text(value.scientificName),
    docs: docRecords(value.docs),
    checks: Object.fromEntries(FOREST_CHECKS.map(({ key }) => {
      const item = object(checks[key]);
      return [key, { done: item.done === true, at: text(item.at), by: text(item.by), note: text(item.note).slice(0, 500) }];
    })),
  };
}

export function cleanForestEudr(input: unknown, current: ForestEudr): ForestEudr {
  const value = object(input);
  return readForestEudr({ ...current, ...value, docs: { ...current.docs, ...object(value.docs) }, checks: { ...current.checks, ...object(value.checks) } });
}

export function readOrderEudr(supplyChainNotes: string | null, hsCode = ""): OrderEudr {
  const value = object(object(supplyChainNotes).eudr);
  const origins = Array.isArray(value.origins) ? value.origins as unknown[] : [];
  return {
    productKind: value.productKind === "pellets" || value.productKind === "serrado" ? value.productKind : hsCode.replace(/\D/g, "").startsWith("4401") ? "pellets" : "serrado",
    yieldPercent: Math.min(100, number(value.yieldPercent)),
    origins: origins.map((raw) => {
      const item = object(raw);
      return { carCode: text(item.carCode).toUpperCase(), harvestFrom: date(item.harvestFrom), harvestTo: date(item.harvestTo), inputQuantity: number(item.inputQuantity), invoices: text(item.invoices).slice(0, 300) };
    }).filter((origin) => origin.carCode),
    docs: docRecords(value.docs),
    packageGeneratedAt: text(value.packageGeneratedAt),
    sentAt: text(value.sentAt),
    ddsVerification: text(value.ddsVerification).slice(0, 80),
  };
}

/** Grava o EUDR do pedido no JSON do pedido, preservando as outras chaves (itens, financeiro...). */
export function writeOrderEudr(supplyChainNotes: string | null, eudr: OrderEudr) {
  let current: Record<string, unknown>;
  try {
    const parsed = JSON.parse(supplyChainNotes || "{}");
    current = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { orderNotes: supplyChainNotes };
  } catch {
    current = supplyChainNotes ? { orderNotes: supplyChainNotes } : {};
  }
  return JSON.stringify({ ...current, eudr });
}

const expired = (record: DocRecord | undefined, today: string) => Boolean(record?.validUntil && record.validUntil < today);
export const docDone = (record: DocRecord | undefined, today: string) => Boolean(record && (record.status === "nao_se_aplica" || (record.status === "ok" && !expired(record, today))));
export const docExpiring = (record: DocRecord | undefined, today: string, days = 30) => {
  if (!record?.validUntil || record.status !== "ok") return false;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  return record.validUntil >= today && record.validUntil <= limit.toISOString().slice(0, 10);
};

export type ForestSummary = { carCode: string; name: string; geometryJson: string; areaHa: number; eudr: ForestEudr };

/** Situação de uma floresta: documentos e verificações. */
export function forestStatus(forest: ForestSummary, today: string) {
  const docs = FOREST_DOCS[forest.eudr.originType];
  const docsDone = docs.filter((doc) => docDone(forest.eudr.docs[doc.key], today)).length;
  const checksDone = FOREST_CHECKS.filter((check) => forest.eudr.checks[check.key]?.done).length;
  const expiring = docs.filter((doc) => docExpiring(forest.eudr.docs[doc.key], today)).length;
  const hasGeometry = geometryKind(forest.geometryJson) !== "";
  const identity = Boolean(forest.eudr.producer && forest.eudr.species && forest.eudr.scientificName);
  const ok = docsDone === docs.length && checksDone === FOREST_CHECKS.length && hasGeometry && identity;
  return { docsDone, docsTotal: docs.length, checksDone, checksTotal: FOREST_CHECKS.length, expiring, hasGeometry, identity, ok };
}

export function geometryKind(geometryJson: string) {
  const type = text(object(geometryJson).type);
  return type === "Polygon" || type === "MultiPolygon" ? "Polígono" : type === "Point" ? "Ponto" : "";
}

/** Quantidade exportada na unidade do balanço: m³ (serrado) ou toneladas (pellets). */
export function exportedQuantity(kind: ProductKind, operation: { volumeM3: number; netWeightKg: number; quantity: number; quantityUnit: string }, itemsVolume = 0) {
  if (kind === "pellets") {
    if (operation.netWeightKg) return operation.netWeightKg / 1000;
    return /^(MT|T|TON)/i.test(operation.quantityUnit) ? operation.quantity : 0;
  }
  return itemsVolume || operation.volumeM3 || 0;
}

export type StepState = { name: string; done: number; total: number };

/** As 5 etapas do pedido (protótipo 4b) com o que está pronto em cada uma. */
export function orderSteps(input: {
  eudr: OrderEudr;
  forests: ForestSummary[];
  operation: { product: string; hsCode: string; supplierName: string; euImporter: string; euOperatorEori: string; shipmentDate: string; eudrReference: string };
  exported: number;
  today: string;
}): StepState[] {
  const { eudr, forests, operation, exported, today } = input;
  const byCar = new Map(forests.map((forest) => [forest.carCode, forest]));
  const linked = eudr.origins.map((origin) => ({ origin, forest: byCar.get(origin.carCode) }));
  const originDone = linked.filter(({ origin, forest }) => forest && geometryKind(forest.geometryJson) && forest.eudr.species && forest.eudr.scientificName && forest.eudr.producer && origin.harvestFrom && origin.inputQuantity > 0).length;
  const hasNative = linked.some(({ forest }) => forest?.eudr.originType === "Nativa");
  const chainDocs = orderDocs(eudr.productKind, hasNative).filter((doc) => !doc.optional);
  const forestDocs = linked.flatMap(({ forest }) => forest ? FOREST_DOCS[forest.eudr.originType].map((doc) => docDone(forest.eudr.docs[doc.key], today) && FOREST_CHECKS.every((check) => forest.eudr.checks[check.key]?.done)) : [false]);
  const legalDone = chainDocs.filter((doc) => docDone(eudr.docs[doc.key], today)).length + forestDocs.filter(Boolean).length;
  const balance = balanceOf(eudr, exported);
  const exportFields = [operation.product && operation.hsCode, exported > 0, operation.supplierName, operation.euImporter && operation.euOperatorEori, operation.shipmentDate];
  return [
    { name: "Origem", done: originDone, total: Math.max(1, linked.length) },
    { name: "Legalidade", done: legalDone, total: chainDocs.length + Math.max(1, forestDocs.length) },
    { name: "Transformação", done: balance.ok ? 1 : 0, total: 1 },
    { name: "Exportação", done: exportFields.filter(Boolean).length, total: exportFields.length },
    { name: "Pacote EUDR", done: operation.eudrReference ? 1 : 0, total: 1 },
  ];
}

/** Balanço: matéria-prima das origens × rendimento ≥ quantidade exportada. */
export function balanceOf(eudr: OrderEudr, exported: number) {
  const input = eudr.origins.reduce((sum, origin) => sum + origin.inputQuantity, 0);
  const possible = input * (eudr.yieldPercent / 100);
  return { input, possible, exported, margin: possible - exported, ok: input > 0 && eudr.yieldPercent > 0 && exported > 0 && possible + 1e-9 >= exported };
}

export const readinessOf = (steps: StepState[]) => {
  const total = steps.reduce((sum, step) => sum + step.total, 0);
  return total ? Math.round((steps.reduce((sum, step) => sum + Math.min(step.done, step.total), 0) / total) * 100) : 0;
};

function round6(value: unknown): unknown {
  if (typeof value === "number") return Math.round(value * 1e6) / 1e6;
  return Array.isArray(value) ? value.map(round6) : value;
}

/** Arquivo de geolocalização no formato pedido pelo sistema da UE: GeoJSON, WGS84, 6 casas decimais. */
export function eudrGeoJson(forests: Array<ForestSummary & { harvestFrom?: string; harvestTo?: string }>) {
  return {
    type: "FeatureCollection",
    features: forests.flatMap((forest) => {
      const geometry = object(forest.geometryJson);
      if (!geometry.type || !Array.isArray(geometry.coordinates)) return [];
      return [{
        type: "Feature",
        geometry: { type: geometry.type, coordinates: round6(geometry.coordinates) },
        properties: {
          ProducerName: forest.eudr.producer, ProducerCountry: "BR", ProductionPlace: forest.name, Area: Math.round(forest.areaHa * 10000) / 10000,
          CAR: forest.carCode, OriginType: forest.eudr.originType, Species: forest.eudr.scientificName,
          ...(forest.harvestFrom ? { HarvestPeriod: `${forest.harvestFrom}${forest.harvestTo ? `/${forest.harvestTo}` : ""}` } : {}),
        },
      }];
    }),
  };
}

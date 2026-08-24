"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { translateToEnglish, type Language } from "./i18n";
import { parseGeographicInput } from "../lib/geo-input";
import { SUPPLY_CHAIN_STAGES } from "../lib/supply-chain-stages";
import { isBrazil, isValidBrazilianCnpj, normalizeTaxId } from "../lib/supplier-validation";
import { canApproveShipment } from "../lib/export-control";

const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();

function translateInterface(root: Node, language: Language) {
  const translateTextNode = (node: Text) => {
    if (!originalText.has(node)) originalText.set(node, node.nodeValue ?? "");
    const original = originalText.get(node) ?? "";
    const next = language === "en" ? translateToEnglish(original) : original;
    if (node.nodeValue !== next) node.nodeValue = next;
  };
  const translateElement = (element: Element) => {
    if (["SCRIPT", "STYLE"].includes(element.tagName)) return;
    const attributes = ["placeholder", "title", "aria-label"];
    let originals = originalAttributes.get(element);
    if (!originals) {
      originals = new Map();
      originalAttributes.set(element, originals);
    }
    attributes.forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value !== null && !originals!.has(attribute)) originals!.set(attribute, value);
      const original = originals!.get(attribute);
      if (original !== undefined) element.setAttribute(attribute, language === "en" ? translateToEnglish(original) : original);
    });
  };
  if (root instanceof Text) translateTextNode(root);
  if (root instanceof Element) translateElement(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current instanceof Text) translateTextNode(current);
    else if (current instanceof Element) translateElement(current);
    current = walker.nextNode();
  }
}

const nav = ["Dashboard", "Processos", "Portal Cliente", "Riscos", "Relatórios", "Integrações", "Segurança"];
const brazilStates = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

async function openSecureDocument(documentId: number, documentType: "operation" | "forest", inline = false) {
  const route = documentType === "forest" ? "/api/forest-documents" : "/api/documents";
  const parameters = new URLSearchParams({ documentId: String(documentId) });
  if (inline) parameters.set("inline", "1");
  window.open(`${route}?${parameters.toString()}`, "_blank", "noopener,noreferrer");
}

type MapProperty = {
  id: string;
  name: string;
  city: string;
  supplier: string;
  areaHa: number;
  nativeAreaHa: number;
  area: string;
  native: string;
  status: string;
  x: number;
  y: number;
  risk: string;
  geometry?: number[][];
  source?: string;
  checkedAt?: string;
};

type SicarLookupResult = {
  mode: "public-guided" | "automatic";
  inputType?: "car" | "coordinates";
  inputFormat?: "decimal" | "dms" | "utm";
  carCode: string;
  state: string;
  municipalityCode: string;
  municipality?: string;
  propertyName?: string;
  areaHa?: number;
  nativeAreaHa?: number;
  nativeAreaAvailable?: boolean;
  statusCode?: string;
  status?: string;
  condition?: string;
  registrationCreatedAt?: string;
  sourceUpdatedAt?: string;
  fiscalModules?: number;
  propertyType?: string;
  geometry?: unknown;
  checkedAt: string;
  source: string;
  officialUrl: string;
  automaticImport: boolean;
  message: string;
};

async function querySicarDirect(query: string, stateHint: string): Promise<SicarLookupResult> {
  const trimmed = query.trim();
  let state = stateHint.toUpperCase();
  let filter = "";
  let inputType: "car" | "coordinates" = "car";
  let inputFormat: "decimal" | "dms" | "utm" | undefined;
  const carCodeInput = trimmed.toUpperCase().replaceAll(/\s+/g, "").replaceAll(".", "");

  if (!/^[A-Z]{2}-\d{7}-[A-F0-9]{32}$/.test(carCodeInput)) {
    const parsed = parseGeographicInput(trimmed);
    if (parsed.kind === "unknown") throw new Error(parsed.error);
    if (!brazilStates.includes(state)) throw new Error("Para consultar por coordenadas ou UTM, selecione a UF do imóvel.");
    inputType = "coordinates";
    inputFormat = parsed.format;
    filter = `INTERSECTS(geo_area_imovel,POINT(${parsed.longitude} ${parsed.latitude}))`;
  } else {
    state = carCodeInput.slice(0, 2);
    filter = `cod_imovel IN ('${carCodeInput}')`;
  }

  const params = new URLSearchParams({ service: "WFS", version: "1.0.0", request: "GetFeature", typeName: `sicar:sicar_imoveis_${state.toLowerCase()}`, outputFormat: "application/json", CQL_FILTER: filter });
  const response = await fetch(`https://geoserver.car.gov.br/geoserver/sicar/ows?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`SICAR respondeu HTTP ${response.status}.`);
  const collection = await response.json() as { features?: Array<{ geometry?: unknown; properties?: Record<string, unknown> }> };
  const feature = collection.features?.[0];
  if (!feature?.geometry) throw new Error("Nenhum imóvel CAR foi encontrado para esta consulta.");
  const properties = feature.properties ?? {};
  const carCode = String(properties.cod_imovel ?? "").trim().toUpperCase().replaceAll(".", "");
  const municipality = String(properties.municipio ?? "").trim();
  const statusCode = String(properties.status_imovel ?? "").trim().toUpperCase();
  const status = statusCode === "AT" ? "Ativo" : statusCode === "PE" ? "Pendente" : statusCode === "CA" ? "Cancelado" : statusCode || "Não informado";
  const propertyName = String(properties.nome_imovel ?? properties.nom_imovel ?? properties.denominacao ?? properties.nome_propriedade ?? "").trim();
  const nativeAreaRaw = properties.area_vegetacao_nativa ?? properties.vegetacao_nativa ?? properties.area_veg_nativa ?? properties.area_vn;
  const nativeAreaHa = nativeAreaRaw === null || nativeAreaRaw === undefined || nativeAreaRaw === "" ? undefined : Number(nativeAreaRaw);
  return {
    mode: "automatic",
    inputType,
    inputFormat,
    carCode,
    state: String(properties.uf ?? state).trim().toUpperCase(),
    municipalityCode: String(properties.cod_municipio_ibge ?? "").trim(),
    municipality,
    propertyName,
    areaHa: Number(properties.area ?? 0),
    nativeAreaHa: Number.isFinite(nativeAreaHa) ? nativeAreaHa : undefined,
    nativeAreaAvailable: Number.isFinite(nativeAreaHa),
    statusCode,
    status,
    condition: String(properties.condicao ?? "").trim(),
    registrationCreatedAt: String(properties.dat_criacao ?? "").trim(),
    sourceUpdatedAt: String(properties.data_atualizacao ?? "").trim(),
    fiscalModules: Number(properties.m_fiscal ?? 0),
    propertyType: String(properties.tipo_imovel ?? "").trim(),
    geometry: feature.geometry,
    checkedAt: new Date().toISOString(),
    source: "SICAR GeoServer · WFS público",
    officialUrl: `https://www.car.gov.br/#/consultar/${encodeURIComponent(carCode)}`,
    automaticImport: true,
    message: "Imóvel localizado no SICAR. Dados cadastrais e geometria foram carregados automaticamente da base pública.",
  };
}

type SupplierRecord = {
  id: number;
  legalName: string;
  tradeName: string;
  taxId: string;
  country: string;
  state: string;
  city: string;
  contactName: string;
  email: string;
  phone: string;
  certifications: string;
  aliases: string;
  products: string;
  productionUnits: string;
  bankDetails: string;
  status: string;
};

type SupplierFormData = Omit<SupplierRecord, "id" | "status">;

type ImporterClientRecord = { id:number; legalName:string; normalizedName:string; aliases:string; taxId:string; taxIdType:string; eori:string; address:string; city:string; state:string; postalCode:string; country:string; contactName:string; email:string; phone:string; preferredPort:string; paymentTerms:string; documentRequirements:string; dataStatus:string };
type MasterProductRecord = { id:number; name:string; normalizedName:string; rawMaterial:string; species:string; scientificName:string; hsCode:string; dimensionalSpecification:string; grade:string; kd:boolean; ht:boolean; moisture:string; certifications:string; originType:string; eligibleSupplierIds:string; dataStatus:string };

function normalizeSupplierLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseSupplierPastedData(raw: string, current: SupplierFormData) {
  const next = { ...current };
  const detected = new Set<string>();
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const assign = (field: keyof SupplierFormData, value: unknown, label: string) => {
    const clean = String(value ?? "").trim();
    if (!clean) return;
    next[field] = clean as never;
    detected.add(label);
  };
  const aliases: Array<{ field: keyof SupplierFormData; label: string; names: string[] }> = [
    { field: "legalName", label: "Razão social", names: ["razao social", "nome empresarial", "empresa", "company", "legal name"] },
    { field: "tradeName", label: "Nome fantasia", names: ["nome fantasia", "fantasia", "trade name"] },
    { field: "taxId", label: "CNPJ / ID fiscal", names: ["cnpj", "cpf cnpj", "id fiscal", "tax id", "vat"] },
    { field: "country", label: "País", names: ["pais", "country"] },
    { field: "state", label: "Estado/UF", names: ["estado", "uf", "state"] },
    { field: "city", label: "Município", names: ["municipio", "cidade", "city"] },
    { field: "contactName", label: "Responsável", names: ["responsavel", "contato", "contact", "attention", "att"] },
    { field: "email", label: "E-mail", names: ["e mail", "email", "mail"] },
    { field: "phone", label: "Telefone", names: ["telefone", "fone", "celular", "whatsapp", "phone", "mobile"] },
    { field: "certifications", label: "Certificações", names: ["certificacoes", "certificacao", "certificates", "certifications"] },
  ];

  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    for (const item of aliases) {
      const key = Object.keys(json).find((candidate) => item.names.includes(normalizeSupplierLabel(candidate)));
      if (key) assign(item.field, json[key], item.label);
    }
  } catch {
    // Texto livre, assinatura de e-mail ou ficha copiada seguem para os detectores abaixo.
  }

  for (const line of lines) {
    const separator = line.search(/[:=]/);
    if (separator < 0) continue;
    const label = normalizeSupplierLabel(line.slice(0, separator));
    const value = line.slice(separator + 1).trim();
    if (["municipio uf", "cidade uf", "city state"].includes(label)) {
      const combined = value.match(/^(.+?)(?:\s*[-/,]\s*)([A-Z]{2,3})$/i);
      if (combined) {
        assign("city", combined[1], "Município");
        assign("state", combined[2].toUpperCase(), "Estado/UF");
        continue;
      }
    }
    const match = aliases.find((item) => item.names.some((name) => label === name || label.endsWith(` ${name}`)));
    if (match) assign(match.field, value, match.label);
  }

  const cnpj = raw.match(/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2}\b/)?.[0];
  if (cnpj && !detected.has("CNPJ / ID fiscal")) assign("taxId", cnpj, "CNPJ / ID fiscal");
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email && !detected.has("E-mail")) assign("email", email, "E-mail");
  const phoneText = raw.replace(cnpj ?? "", "").replace(email ?? "", "");
  const phone = phoneText.match(/(?:\+?55[\s.-]*)?(?:\(?\d{2}\)?[\s.-]*)?(?:9?\d{4})[\s.-]*\d{4}/)?.[0];
  if (phone && !detected.has("Telefone")) assign("phone", phone, "Telefone");

  const cityStateLine = lines.find((line) => /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]+(?:\s[-/]\s?|,\s*)(?:AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO)\b/i.test(line));
  const cityState = cityStateLine?.match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]+?)(?:\s[-/]\s?|,\s*)(AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO)\b/i);
  if (cityState) {
    if (!detected.has("Município")) assign("city", cityState[1].replace(/^(cidade|municipio)\s*[:=-]?\s*/i, ""), "Município");
    if (!detected.has("Estado/UF")) assign("state", cityState[2].toUpperCase(), "Estado/UF");
  }

  if (!detected.has("Razão social")) {
    const companyLine = lines.find((line) => /\b(LTDA|LIMITADA|S\/?A|EIRELI|IND[UÚ]STRIA|COM[EÉ]RCIO|EXPORTADORA|MADEIRAS?)\b/i.test(line) && !line.includes("@"));
    if (companyLine) assign("legalName", companyLine.replace(/^[^:=]{1,24}[:=]\s*/, ""), "Razão social");
  }
  const certificationTokens = ["FSC", "PEFC"].filter((token) => new RegExp(`\\b${token}\\b`, "i").test(raw));
  if (certificationTokens.length && !detected.has("Certificações")) assign("certifications", certificationTokens.join(" + "), "Certificações");
  if (!next.country.trim()) assign("country", "Brasil", "País");
  next.state = next.state.trim().toUpperCase();
  next.email = next.email.trim().toLowerCase();
  next.taxId = next.taxId.replace(/[^\dA-Za-z]/g, "").toUpperCase();
  const required: Array<[keyof SupplierFormData, string]> = [["legalName", "Razão social"], ["taxId", "CNPJ / ID fiscal"], ["country", "País"], ["state", "Estado/UF"], ["city", "Município"], ["contactName", "Responsável"], ["email", "E-mail"]];
  return { form: next, detected: [...detected], missing: required.filter(([field]) => !next[field].trim()).map(([, label]) => label) };
}

type OperationRecord = {
  id: number;
  importerClientId: number | null;
  masterProductId: number | null;
  reference: string;
  product: string;
  hsCode: string;
  destinationCountry: string;
  euImporter: string;
  supplierId: number;
  supplierName: string;
  shipmentDate: string;
  exporterName: string;
  exporterTaxId: string;
  internalResponsible: string;
  responsibleEmail: string;
  contractNumber: string;
  incoterm: string;
  currency: string;
  commercialValue: number;
  quantity: number;
  quantityUnit: string;
  grossWeightKg: number;
  netWeightKg: number;
  volumeM3: number;
  lotCodes: string;
  rawMaterial: string;
  species: string;
  forestOriginType: string;
  productionUnit: string;
  productionLocation: string;
  propertyIds: string;
  transportMode: string;
  portOfLoading: string;
  portOfDischarge: string;
  carrier: string;
  bookingNumber: string;
  billOfLadingNumber: string;
  containerNumbers: string;
  vesselVoyage: string;
  euOperatorEori: string;
  eudrReference: string;
  supplyChainNotes: string;
  readiness: number;
  status: string;
};

type ProductCatalogRecord = {
  id: number;
  product: string;
  entryType: "raw_material" | "species";
  value: string;
  scientificName: string;
  active: boolean;
  sortOrder: number;
};

const defaultProducts = ["Madeira serrada", "Pellets de madeira", "Móveis de madeira", "Café verde", "Cacau e derivados", "Soja", "Borracha natural", "Óleo de palma", "Gado bovino / couro"];

function supplierLocation(supplier?: SupplierRecord) {
  if (!supplier) return "";
  return `${supplier.city}/${supplier.state} · ${supplier.country}`;
}

const emptyOperationForm = {
  reference: "", product: "", hsCode: "", destinationCountry: "", euImporter: "", importerClientId: "", supplierId: "", shipmentDate: "",
  exporterName: "", exporterTaxId: "", internalResponsible: "", responsibleEmail: "", contractNumber: "", incoterm: "FOB", currency: "USD",
  commercialValue: "", quantity: "", quantityUnit: "MT", grossWeightKg: "", netWeightKg: "", volumeM3: "", lotCodes: "",
  rawMaterial: "", species: "", forestOriginType: "Reflorestamento", productionUnit: "", productionLocation: "", propertyIds: [] as string[], transportMode: "Marítimo",
  portOfLoading: "", portOfDischarge: "", carrier: "", bookingNumber: "", billOfLadingNumber: "", containerNumbers: "", vesselVoyage: "",
  euOperatorEori: "", eudrReference: "", supplyChainNotes: "",
};

type DocumentRecord = {
  id: number;
  operationId: number;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  notes: string;
  sourceSystem: string;
  sourceExternalId: string;
  sourceTaskId: string;
  sourceCreatedAt: string;
  documentType: string;
  lifecycleStatus: string;
  shipmentSetStatus: string;
  clientShareStatus: string;
  analysisSummary: string;
  sha256: string;
  uploadedAt: string;
};

type ForestDocumentRecord = {
  id: number;
  propertyCarCode: string;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  notes: string;
  source: string;
  uploadedAt: string;
};

type StageSettingRecord = {
  id: number;
  operationId: number;
  stageCategory: string;
  enabled: boolean;
};

type PartnerRecord = {
  id: number;
  operationId: number;
  role: string;
  companyName: string;
  contactName: string;
  email: string;
  country: string;
};

type ExceptionActionRecord = {
  id: number;
  alertText: string;
  operationReference: string;
  responsibleName: string;
  responsibleEmail: string;
  dueDate: string;
  message: string;
  status: string;
  notifiedAt: string;
  resolvedAt: string | null;
};

type IndustrialPlanRecord = {
  id: number;
  operationId: number;
  periodStart: string;
  periodEnd: string;
  receivingLots: string;
  openingStockKg: number;
  rawMaterialReceivedKg: number;
  rawMaterialConsumedKg: number;
  pelletsProducedKg: number;
  closingStockKg: number;
  productionLots: string;
  notes: string;
  status: string;
  updatedAt: string;
};

type AgentServiceRecord = {
  id: number; agentId: string; serviceId: string; name: string; description: string; capabilitiesJson: string; category: string;
  provider: string; adapterType: string; endpoint: string; internal: boolean; price: number; currency: string; estimatedCost: number;
  averageResponseMs: number; availability: number; reputation: number; executionCount: number; successRate: number; lastUsedAt: string | null;
  status: string; financialLimit: number; requiresHumanApproval: boolean; commercial: boolean; inputDescription: string; outputDescription: string; sla: string;
};

type AgentJobRecord = {
  id: number; jobId: string; operationId: number; stageCategory: string; requestingAgent: string; providerAgent: string; capability: string;
  documentIdsJson: string; candidateScoresJson: string; expectedPrice: number; actualPrice: number; currency: string; status: string; result: string;
  confidence: number; durationMs: number; error: string; approvalStatus: string; approvedBy: string; approvedAt: string | null; logsJson: string;
  outputDocumentJson: string; createdAt: string; completedAt: string | null;
};

type AgentLedgerRecord = {
  id: number; jobId: string; operationId: number; clientName: string; stageCategory: string; agentId: string; serviceId: string;
  entryType: string; amount: number; currency: string; description: string; simulated: boolean; createdAt: string;
};

type AgentReputationRecord = { id: number; agentId: string; capability: string; score: number; successCount: number; failureCount: number; averageDurationMs: number; qualityScore: number; averageConfidence: number };
type AgentSettingsRecord = { id: number; operationId: number; autonomyLevel: number; transactionLimit: number; dailyLimit: number; externalPaymentsEnabled: boolean };
type ExportMilestoneRecord = { id: number; operationId: number; code: string; sequence: number; title: string; category: string; status: string; qualityStatus: string; shipmentApproval: string; responsibleName: string; responsibleEmail: string; dueDate: string; nextAction: string; note: string; completedAt: string | null; updatedAt: string };
type ClientNotificationRecord = { id: number; milestoneCode: string; recipient: string; subject: string; body: string; status: string; provider: string; error: string; sentAt: string | null; createdAt: string };
type TrackingEventRecord = { id: number; source: string; status: string; location: string; eta: string; details: string; checkedAt: string; nextCheckAt: string };
type ExportControlData = {
  settings: { customerName: string; customerEmail: string; customerReference: string; notificationsEnabled: boolean; trackingIntervalDays: number; nextTrackingAt: string | null; emailProviderStatus: string };
  milestones: ExportMilestoneRecord[];
  notifications: ClientNotificationRecord[];
  tracking: TrackingEventRecord[];
  eudrBridge: { readiness: number; reference: string; required: boolean; status: string };
  emailDelivery: { provider: string; ready: boolean; sender: string };
  deliveryResult?: { status: string; provider: string; externalId: string; error: string };
  operationalAlerts: { missingPlan: number; overdue: number; stages: Array<{ code: string; title: string; missing: string[]; overdue: boolean }> };
  compliance: { score: number; stageScore: number; status: string; verdict: string; opinion: string; approvedSetDocuments: number; eudrRequired: boolean; lastCheck: { checkedAt: string } | null; requirements: Array<{ key: string; label: string; reason: string; required: boolean; present: boolean }>; stages: Array<{ code: string; sequence: number; title: string; status: string; applicable: boolean; passed: boolean; documentCount: number; issue: string }> };
};
type ShipmentAdviceData = {
  advice: { id: number; status: string; recipient: string; subject: string; body: string; humanApproved: boolean; updatedAt: string } | null;
  documents: DocumentRecord[];
  generated: {
    recipient: string;
    subject: string;
    body: string;
    candidates: DocumentRecord[];
    included: DocumentRecord[];
    checklist: Array<{ key: string; label: string; required: boolean; present: boolean }>;
  };
  complete: boolean;
  delivery?: { status: string; provider: string; externalId: string; error: string };
};
type AgentMetrics = { activeAgents: number; jobsExecuted: number; jobsPending: number; awaitingApproval: number; failures: number; alerts: number; cost: number; revenue: number; grossMargin: number; marginPct: number; estimatedSavings: number };
type AgentControlData = { settings: AgentSettingsRecord; services: AgentServiceRecord[]; jobs: AgentJobRecord[]; ledger: AgentLedgerRecord[]; reputation: AgentReputationRecord[]; metrics: AgentMetrics };
type IntegrationStatusRecord = { id: string; name: string; category: "data" | "intelligence" | "agents" | "eudr" | "payments"; state: "operational" | "credential_required" | "sandbox" | "disabled"; label: string; detail: string; provider: string; live: boolean };
type PrivateAgentStatus = { api: { active: boolean; mode: string; auth: string; tokenVisible: boolean }; metrics: { eventsProcessed: number; eventsWithError: number; eventsInReview: number; documentsProcessed: number; approvalsPending: number }; lastEvent: { subject?: string; source?: string; matchConfidence?: string; createdAt?: string } | null; endpoints: string[] };
type AsanaImportData = {
  project: { id: string; name: string; url: string };
  summary: { total: number; review: number; ignored: number; approved: number; missingOwner: number; missingDueDate: number };
  candidates: Array<{ id: number; name: string; sectionName: string; proposedMilestoneCode: string; importStatus: string; attentionReasonsJson: string }>;
};
type AgentBriefData = { schemaVersion: number; generatedAt: string; summary: { operations: number; overdueStages: number; stagesMissingPlan: number; eudrReady: number } };
type EnvironmentalNewsItem = { id: string; title: string; url: string; source: string; publishedAt: string; summary: string; imageUrl: string; imageAlt: string; imageCredit: string };
type EnvironmentalNewsSource = { name: string; description: string; url: string };
type EnvironmentalNewsResponse = { items: EnvironmentalNewsItem[]; sources: EnvironmentalNewsSource[]; updatedAt: string; live: boolean };

export type InitialAppData = {
  suppliers: SupplierRecord[];
  operations: OperationRecord[];
  partners: PartnerRecord[];
  properties: Array<Record<string, unknown>>;
  actions: ExceptionActionRecord[];
  documents: DocumentRecord[];
  security: { organizationId: number; organizationName: string; organizationSlug: string; userId: number; email: string; fullName: string; role: "administrador" | "analista" | "fornecedor" | "auditor" | "cliente"; preview: boolean };
  loadFailed?: boolean;
};

function mapProperties(rows: Array<Record<string, unknown>>): MapProperty[] {
  return rows.map((row, index): MapProperty => {
    const parsed = JSON.parse(String(row.geometryJson ?? "{}"));
    const coords = extractPolygon(parsed);
    return {
      id: String(row.carCode),
      name: String(row.name),
      city: String(row.city),
      supplier: String(row.supplier),
      areaHa: Number(row.areaHa),
      nativeAreaHa: Number(row.nativeAreaHa),
      area: `${Number(row.areaHa).toLocaleString("pt-BR")} ha`,
      native: `${Number(row.nativeAreaHa).toLocaleString("pt-BR")} ha`,
      status: String(row.status),
      risk: String(row.risk),
      x: 28 + ((index * 17) % 48),
      y: 24 + ((index * 23) % 50),
      geometry: coords,
      source: String(row.sourceFile || "Cadastro manual"),
      checkedAt: String(row.createdAt || ""),
    };
  });
}

function officialCarConsultUrl(carCode: string) {
  return `https://www.car.gov.br/#/consultar/${encodeURIComponent(carCode.trim().toUpperCase().replaceAll(".", ""))}`;
}

function SicarValidationTrail({ carCode, located, validated, officialDocument, inputType, onAttach, onNotice }: {
  carCode: string;
  located: boolean;
  validated: boolean;
  officialDocument: boolean;
  inputType?: "car" | "coordinates";
  onAttach?: () => void;
  onNotice?: (message: string) => void;
}) {
  const officialUrl = officialCarConsultUrl(carCode);
  const copyCar = async () => {
    try {
      await navigator.clipboard.writeText(carCode);
      onNotice?.("Código do CAR copiado para a consulta oficial.");
    } catch {
      onNotice?.("Não foi possível copiar automaticamente. Selecione o código do CAR manualmente.");
    }
  };

  return <section className="sicar-validation-trail" aria-label="Trilha de validação SICAR">
    <header>
      <div><p className="eyebrow">TRILHA OFICIAL CAR / SICAR</p><h3>Da localização ao Demonstrativo do imóvel</h3><p>Cada passo mantém a fonte, o resultado e o documento oficial vinculados à mesma floresta.</p></div>
      <strong>{officialDocument ? "3/3" : validated ? "2/3" : located ? "1/3" : "0/3"}</strong>
    </header>
    <div className="sicar-validation-steps">
      <article className={located ? "complete" : "pending"}>
        <span>{located ? "✓" : "01"}</span>
        <div><small>ETAPA 01</small><b>Localizar o CAR</b><p>{located ? (inputType === "coordinates" ? "CAR encontrado pelas coordenadas/UTM e polígono carregado." : "Código CAR e geometria do imóvel localizados.") : "Aguardando código CAR, coordenadas ou UTM."}</p></div>
        <em>{located ? "Concluída" : "Pendente"}</em>
      </article>
      <article className={validated ? "complete" : "pending"}>
        <span>{validated ? "✓" : "02"}</span>
        <div><small>ETAPA 02</small><b>Pesquisa SICAR para validação</b><p>{validated ? "Cadastro, situação, condição, área e geometria conferidos na base pública SICAR." : "Aguardando retorno da base geoespacial oficial."}</p></div>
        <em>{validated ? "Validada" : "Pendente"}</em>
      </article>
      <article className={officialDocument ? "complete" : "attention"}>
        <span>{officialDocument ? "✓" : "03"}</span>
        <div><small>ETAPA 03</small><b>Ficha completa da área</b><p>{officialDocument ? "Demonstrativo oficial CAR anexado e disponível para o dossiê DDS." : "Abra a consulta oficial, conclua o reCAPTCHA, baixe o Demonstrativo e anexe o PDF à ficha."}</p></div>
        <em>{officialDocument ? "Incorporada" : "Ação humana"}</em>
      </article>
    </div>
    <footer>
      <div><b>CAR identificado</b><code>{carCode || "—"}</code></div>
      <button type="button" onClick={copyCar} disabled={!carCode}>Copiar CAR</button>
      <a href={officialUrl} target="_blank" rel="noreferrer">Abrir consulta oficial preenchida ↗</a>
      {onAttach && !officialDocument && <button type="button" className="primary" onClick={onAttach}>Anexar Demonstrativo PDF</button>}
    </footer>
    {!officialDocument && <p className="sicar-validation-note"><b>Validação oficial:</b> o portal CAR exige reCAPTCHA. Por segurança, a ExportaTrust não contorna essa etapa; o Demonstrativo baixado pelo usuário torna-se a fonte oficial da ficha completa.</p>}
  </section>;
}

function EnvironmentalNews({ language }: { language: Language }) {
  const [data, setData] = useState<EnvironmentalNewsResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [activeIndex, setActiveIndex] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);

  const loadNews = () => {
    setStatus("loading");
    fetch(`/api/environmental-news?t=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("News unavailable")))
      .then((payload: EnvironmentalNewsResponse) => { setData(payload); setActiveIndex(0); setStatus("ready"); })
      .catch(() => setStatus("error"));
  };

  useEffect(() => {
    let activeRequest = true;
    fetch(`/api/environmental-news?t=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("News unavailable")))
      .then((payload: EnvironmentalNewsResponse) => {
        if (!activeRequest) return;
        setData(payload);
        setStatus("ready");
      })
      .catch(() => { if (activeRequest) setStatus("error"); });
    return () => { activeRequest = false; };
  }, []);

  const dateFormatter = new Intl.DateTimeFormat(language === "en" ? "en-US" : "pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  const items = data?.items ?? [];
  const featured = items.length ? items[activeIndex % items.length] : null;
  const previousNews = () => setActiveIndex((current) => items.length ? (current - 1 + items.length) % items.length : 0);
  const nextNews = () => setActiveIndex((current) => items.length ? (current + 1) % items.length : 0);

  useEffect(() => {
    if (status !== "ready" || carouselPaused || items.length < 2) return;
    const interval = window.setInterval(() => setActiveIndex((current) => (current + 1) % items.length), 6500);
    return () => window.clearInterval(interval);
  }, [carouselPaused, items.length, status]);

  return <section className="panel environmental-news" aria-label="Notícias ambientais e florestais">
    <header className="environmental-news-header">
      <div><p className="eyebrow">EXPORTATRUST NEWS</p><h2>Radar ambiental e florestal</h2><p>Brasil · madeira · reflorestamento · EUDR</p></div>
      <div className="environmental-news-live"><span className={data?.live ? "live" : "curated"}>{data?.live ? "● AO VIVO" : "SELEÇÃO EDITORIAL"}</span><button onClick={loadNews} disabled={status === "loading"}>{status === "loading" ? "Atualizando…" : "Atualizar notícias"}</button></div>
    </header>
    {status === "loading" && !data && <div className="environmental-news-loading"><span className="loading-spinner">↻</span><p>Buscando as notícias mais recentes do setor…</p></div>}
    {status === "error" && !data && <div className="environmental-news-loading error"><span>!</span><p>O radar está temporariamente indisponível.</p><button onClick={loadNews}>Tentar novamente</button></div>}
    {featured && <div className="environmental-news-carousel" role="region" aria-roledescription="carousel" aria-label={language === "en" ? "Environmental and forestry news carousel" : "Carrossel de notícias ambientais e florestais"} onMouseEnter={() => setCarouselPaused(true)} onMouseLeave={() => setCarouselPaused(false)} onFocusCapture={() => setCarouselPaused(true)} onBlurCapture={() => setCarouselPaused(false)}>
      <article className="environmental-news-slide" key={featured.id}>
        <div className="environmental-news-photo" role="img" aria-label={featured.imageAlt} style={{ backgroundImage: `linear-gradient(180deg, rgba(2,35,28,.02) 40%, rgba(2,35,28,.78) 100%), url(${featured.imageUrl})` }}>
          <span className="environmental-news-photo-badge">{language === "en" ? "REAL PHOTO" : "FOTO REAL"}</span>
          <small>{featured.imageCredit}</small>
        </div>
        <div className="environmental-news-copy">
          <div className="environmental-news-meta"><span>{featured.source}</span><time>{dateFormatter.format(new Date(featured.publishedAt))}</time></div>
          <h3>{featured.title}</h3>
          <p>{featured.summary}</p>
          <a href={featured.url} target="_blank" rel="noreferrer">{language === "en" ? "Read full article ↗" : "Ler notícia completa ↗"}</a>
          <div className="environmental-news-controls">
            <button type="button" onClick={previousNews} aria-label={language === "en" ? "Previous article" : "Notícia anterior"}>←</button>
            <div className="environmental-news-dots">{items.map((item, index) => <button key={item.id} type="button" className={index === activeIndex % items.length ? "active" : ""} onClick={() => setActiveIndex(index)} aria-label={`${language === "en" ? "Go to article" : "Ir para notícia"} ${index + 1}`} aria-current={index === activeIndex % items.length ? "true" : undefined} />)}</div>
            <span>{String((activeIndex % items.length) + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}</span>
            <button type="button" onClick={nextNews} aria-label={language === "en" ? "Next article" : "Próxima notícia"}>→</button>
          </div>
        </div>
      </article>
      <nav className="environmental-news-thumbnails" aria-label={language === "en" ? "News selection" : "Seleção de notícias"}>
        {items.map((item, index) => <button key={item.id} type="button" className={index === activeIndex % items.length ? "active" : ""} onClick={() => setActiveIndex(index)}><span style={{ backgroundImage: `url(${item.imageUrl})` }} role="img" aria-label="" /><b>{item.title}</b></button>)}
      </nav>
    </div>}
    {!!data?.sources.length && <footer className="environmental-news-sources"><span>Fontes acompanhadas</span>{data.sources.map((source) => <a key={source.name} href={source.url} title={source.description} target="_blank" rel="noreferrer"><b>{source.name}</b><small>{source.description}</small></a>)}<time>Atualizado em {new Date(data.updatedAt).toLocaleTimeString(language === "en" ? "en-US" : "pt-BR", { hour: "2-digit", minute: "2-digit" })}</time></footer>}
  </section>;
}

export default function Home({ initialData }: { initialData: InitialAppData }) {
  const initialProperties = useMemo(() => mapProperties(initialData.properties), [initialData.properties]);
  const [language, setLanguage] = useState<Language>("pt");
  const [active, setActive] = useState("Dashboard");
  const [drawer, setDrawer] = useState<"operation" | "supplier" | null>(null);
  const [notice, setNotice] = useState("");
  const [selectedProperty, setSelectedProperty] = useState<MapProperty | null>(initialProperties[0] ?? null);
  const [forestDetailProperty, setForestDetailProperty] = useState<MapProperty | null>(null);
  const [registrationsOpen, setRegistrationsOpen] = useState(false);
  const [mapLayer, setMapLayer] = useState("Imóveis CAR");
  const [carSearch, setCarSearch] = useState("");
  const [savedProperties, setSavedProperties] = useState<MapProperty[]>(initialProperties);
  const [importOpen, setImportOpen] = useState(false);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [forestListSearch, setForestListSearch] = useState("");
  const [forestActionId, setForestActionId] = useState("");
  const [savingProperty, setSavingProperty] = useState(false);
  const [geoFileName, setGeoFileName] = useState("");
  const [geometry, setGeometry] = useState<unknown>(null);
  const [propertyForm, setPropertyForm] = useState({ carCode: "", name: "", city: "", supplier: "", areaHa: "", nativeAreaHa: "" });
  const [dataStatus, setDataStatus] = useState<"loading" | "ready" | "error">(initialData.loadFailed ? "error" : "ready");
  const [baseStatus, setBaseStatus] = useState<"loading" | "ready" | "error">(initialData.loadFailed ? "error" : "ready");
  const [mapZoom, setMapZoom] = useState(1);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>(initialData.suppliers);
  const [operations, setOperations] = useState<OperationRecord[]>(initialData.operations);
  const [productCatalog, setProductCatalog] = useState<ProductCatalogRecord[]>([]);
  const [masterClients, setMasterClients] = useState<ImporterClientRecord[]>([]);
  const [masterProducts, setMasterProducts] = useState<MasterProductRecord[]>([]);
  const [historyPartners, setHistoryPartners] = useState<PartnerRecord[]>(initialData.partners);
  const [detailSupplier, setDetailSupplier] = useState<SupplierRecord | null>(null);
  const [detailOperation, setDetailOperation] = useState<OperationRecord | null>(null);
  const [exceptionActions, setExceptionActions] = useState<ExceptionActionRecord[]>(initialData.actions);
  const [allDocuments, setAllDocuments] = useState<DocumentRecord[]>(initialData.documents);
  const [savingBase, setSavingBase] = useState(false);
  const [editingOperationId, setEditingOperationId] = useState<number | null>(null);
  const [supplierForm, setSupplierForm] = useState({ legalName: "", tradeName: "", taxId: "", country: "Brasil", state: "SC", city: "", contactName: "", email: "", phone: "", certifications: "Sem certificação", aliases: "", products: "", productionUnits: "", bankDetails: "" });
  const [supplierRawData, setSupplierRawData] = useState("");
  const [supplierImportResult, setSupplierImportResult] = useState<{ detected: string[]; missing: string[] } | null>(null);
  const [supplierSaveError, setSupplierSaveError] = useState("");
  const [editingSupplierId, setEditingSupplierId] = useState<number | null>(null);
  const [operationForm, setOperationForm] = useState({ ...emptyOperationForm });
  const [operationErrors, setOperationErrors] = useState<Record<string, string>>({});
  const [operationSaveError, setOperationSaveError] = useState("");
  const [supplierOpenedFromOperation, setSupplierOpenedFromOperation] = useState(false);
  const [supplierOpenedFromForest, setSupplierOpenedFromForest] = useState(false);
  const [forestLinkOperationId, setForestLinkOperationId] = useState<number | null>(null);
  const [forestLinkSavingId, setForestLinkSavingId] = useState("");
  const [sicarLookup, setSicarLookup] = useState<SicarLookupResult | null>(null);
  const [sicarLookupLoading, setSicarLookupLoading] = useState(false);
  const [sicarStateHint, setSicarStateHint] = useState("");
  const [sourceConsent, setSourceConsent] = useState(false);
  const [forestDocuments, setForestDocuments] = useState<ForestDocumentRecord[]>([]);
  const [forestDocCategory, setForestDocCategory] = useState("Recibo CAR");
  const [forestDocNotes, setForestDocNotes] = useState("");
  const [forestDocUploading, setForestDocUploading] = useState(false);
  const [forestDocDragging, setForestDocDragging] = useState(false);

  useEffect(() => {
    const report = (source: string, message: string) => {
      void fetch("/api/monitoring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "report", source, level: "error", message, path: window.location.pathname, userAgent: navigator.userAgent }), keepalive: true }).catch(() => undefined);
    };
    const onError = (event: ErrorEvent) => report("window.error", event.message || "Erro de interface");
    const onRejection = (event: PromiseRejectionEvent) => report("unhandledrejection", event.reason instanceof Error ? event.reason.message : String(event.reason ?? "Falha assíncrona"));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);

  const allProperties = savedProperties;
  const forestLinkOperation = forestLinkOperationId ? operations.find((operation) => operation.id === forestLinkOperationId) ?? null : null;
  const filteredForestProperties = allProperties.filter((property) => {
    const query = forestListSearch.trim().toLowerCase();
    return !query || [property.id, property.name, property.city, property.supplier, property.status].some((value) => value.toLowerCase().includes(query));
  });
  const selectedForestDocuments = selectedProperty ? forestDocuments.filter((document) => document.propertyCarCode === selectedProperty.id) : [];
  const selectedOperationSupplier = suppliers.find((supplier) => String(supplier.id) === operationForm.supplierId);
  const operationProducts = useMemo(() => uniqueValues([...defaultProducts, ...masterProducts.map((item) => item.name), ...productCatalog.map((entry) => entry.product), ...operations.map((operation) => operation.product), ...suppliers.flatMap((supplier) => supplier.products?.split(/[,;\n]/) ?? [])]), [masterProducts, productCatalog, operations, suppliers]);
  const productRawMaterials = useMemo(() => uniqueValues([
    ...productCatalog.filter((entry) => entry.product === operationForm.product && entry.entryType === "raw_material").map((entry) => entry.value),
    ...operations.filter((operation) => operation.product === operationForm.product).map((operation) => operation.rawMaterial),
  ]), [productCatalog, operations, operationForm.product]);
  const productSpecies = useMemo(() => uniqueValues([
    ...productCatalog.filter((entry) => entry.product === operationForm.product && entry.entryType === "species").map((entry) => entry.scientificName ? `${entry.value} · ${entry.scientificName}` : entry.value),
    ...operations.filter((operation) => operation.product === operationForm.product).map((operation) => operation.species),
  ]), [productCatalog, operations, operationForm.product]);
  const history = useMemo(() => ({
    exporters: uniqueValues(operations.map((item) => item.exporterName)),
    importers: uniqueValues([...masterClients.map((item) => item.legalName), ...operations.map((item) => item.euImporter)]),
    loadingPlaces: uniqueValues(operations.map((item) => item.portOfLoading)),
    dischargePlaces: uniqueValues(operations.map((item) => item.portOfDischarge)),
    carriers: uniqueValues([...operations.map((item) => item.carrier), ...historyPartners.map((item) => item.companyName)]),
    destinationCountries: uniqueValues(operations.map((item) => item.destinationCountry)),
  }), [operations, historyPartners, masterClients]);

  useEffect(() => {
    const requestOptions: RequestInit = { cache: "no-store", headers: { "Cache-Control": "no-cache" } };
    const version = `v=25&t=${Date.now()}`;
    Promise.allSettled([
      fetch(`/api/properties?${version}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`/api/suppliers?${version}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`/api/operations?${version}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`/api/partners?${version}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`/api/documents?all=1&${version}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`/api/forest-documents?all=1&${version}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`/api/product-catalog?${version}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`/api/importer-clients?${version}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`/api/master-products?${version}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
    ]).then(([propertyResult, supplierResult, operationResult, partnerResult, documentResult, forestDocumentResult, catalogResult, clientResult, masterProductResult]) => {
      if (propertyResult.status === "fulfilled") {
        const data = propertyResult.value as { properties?: Array<Record<string, unknown>> };
        const rows = mapProperties(data.properties ?? []);
        setSavedProperties(rows);
        setSelectedProperty((current) => current ?? rows[0] ?? null);
        setDataStatus("ready");
      } else setDataStatus("error");

      if (supplierResult.status === "fulfilled") {
        setSuppliers((supplierResult.value as { suppliers?: SupplierRecord[] }).suppliers ?? []);
      }
      if (operationResult.status === "fulfilled") {
        setOperations((operationResult.value as { operations?: OperationRecord[] }).operations ?? []);
      }
      if (partnerResult.status === "fulfilled") {
        setHistoryPartners((partnerResult.value as { partners?: PartnerRecord[] }).partners ?? []);
      }
      if (documentResult.status === "fulfilled") {
        setAllDocuments(((documentResult.value as { documents?: DocumentRecord[] }).documents ?? []));
      }
      if (forestDocumentResult.status === "fulfilled") {
        setForestDocuments(((forestDocumentResult.value as { documents?: ForestDocumentRecord[] }).documents ?? []));
      }
      if (catalogResult.status === "fulfilled") {
        setProductCatalog(((catalogResult.value as { catalog?: ProductCatalogRecord[] }).catalog ?? []));
      }
      if (clientResult.status === "fulfilled") setMasterClients(((clientResult.value as { clients?: ImporterClientRecord[] }).clients ?? []));
      if (masterProductResult.status === "fulfilled") setMasterProducts(((masterProductResult.value as { products?: MasterProductRecord[] }).products ?? []));
      setBaseStatus(supplierResult.status === "fulfilled" && operationResult.status === "fulfilled" ? "ready" : "error");
    });
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("exportatrust-language");
    if (stored === "en") window.setTimeout(() => setLanguage("en"), 0);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("exportatrust-language", language);
    document.documentElement.lang = language === "en" ? "en" : "pt-BR";
    translateInterface(document.body, language);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "characterData" && mutation.target instanceof Text) {
          const node = mutation.target;
          const current = node.nodeValue ?? "";
          const previousOriginal = originalText.get(node);
          const previousTranslation = previousOriginal === undefined ? undefined : translateToEnglish(previousOriginal);
          // React may update an existing text node after async data arrives. Treat
          // that value as the new source text instead of restoring the first value
          // ever seen by the translator (which used to freeze counters at zero).
          if (language === "pt") originalText.set(node, current);
          else if (current !== previousTranslation) {
            originalText.set(node, current);
            translateInterface(node, language);
          }
        }
        mutation.addedNodes.forEach((node) => translateInterface(node, language));
      });
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [language]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

  function openCompleteSupplyChain() {
    const dashboardOperation = operations.find((operation) => operation.reference === "GBU002/26") ?? operations[0];
    if (!dashboardOperation) {
      showNotice("Cadastre uma operação para visualizar a cadeia completa.");
      setActive("Processos");
      return;
    }
    setDetailOperation(dashboardOperation);
  }

  function openNewOperation() {
    setOperationErrors({});
    setOperationSaveError("");
    setSupplierOpenedFromOperation(false);
    setEditingOperationId(null);
    setOperationForm({ ...emptyOperationForm });
    setDrawer("operation");
  }

  function beginEditSupplier(supplier: SupplierRecord) {
    setEditingSupplierId(supplier.id);
    setSupplierForm({ legalName: supplier.legalName, tradeName: supplier.tradeName, taxId: supplier.taxId, country: supplier.country, state: supplier.state, city: supplier.city, contactName: supplier.contactName, email: supplier.email, phone: supplier.phone, certifications: supplier.certifications, aliases: supplier.aliases || "", products: supplier.products || "", productionUnits: supplier.productionUnits || "", bankDetails: supplier.bankDetails || "" });
    setSupplierSaveError("");
    setSupplierRawData("");
    setSupplierImportResult(null);
    setDetailSupplier(null);
    setDrawer("supplier");
  }

  function closeSupplierDrawer() {
    setDrawer(supplierOpenedFromOperation ? "operation" : null);
    if (supplierOpenedFromForest) setImportOpen(true);
    setSupplierOpenedFromOperation(false);
    setSupplierOpenedFromForest(false);
    setEditingSupplierId(null);
    setSupplierSaveError("");
  }

  function updateOperationProduct(product: string) {
    const masterProduct = masterProducts.find((item) => item.name.trim().toLowerCase() === product.trim().toLowerCase());
    setOperationForm((current) => current.product === product ? current : {
      ...current,
      product,
      hsCode: masterProduct?.hsCode || current.hsCode,
      rawMaterial: masterProduct?.rawMaterial || "",
      species: masterProduct?.scientificName ? `${masterProduct.species} · ${masterProduct.scientificName}` : masterProduct?.species || "",
      forestOriginType: masterProduct?.originType || current.forestOriginType,
    });
    setOperationErrors((current) => {
      const next = { ...current };
      delete next.product;
      delete next.rawMaterial;
      return next;
    });
  }

  function updateOperationSupplier(supplierId: string) {
    const supplier = suppliers.find((item) => String(item.id) === supplierId);
    const previousSupplier = suppliers.find((item) => String(item.id) === operationForm.supplierId);
    setOperationForm((current) => {
      const exporterWasSupplier = !current.exporterName.trim() || current.exporterName.trim().toLowerCase() === previousSupplier?.legalName.trim().toLowerCase();
      return {
        ...current,
        supplierId,
        exporterName: exporterWasSupplier ? supplier?.legalName ?? "" : current.exporterName,
        exporterTaxId: exporterWasSupplier ? supplier?.taxId ?? "" : current.exporterTaxId,
        productionLocation: supplierLocation(supplier),
        product: current.product || supplier?.products?.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean)[0] || "",
        productionUnit: current.productionUnit || supplier?.productionUnits?.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean)[0] || "",
      };
    });
    setOperationErrors((current) => {
      const next = { ...current };
      delete next.supplierId;
      delete next.exporterName;
      return next;
    });
  }

  function updateOperationExporter(exporterName: string) {
    const isSelectedSupplier = exporterName.trim().toLowerCase() === selectedOperationSupplier?.legalName.trim().toLowerCase();
    setOperationForm((current) => ({
      ...current,
      exporterName,
      exporterTaxId: isSelectedSupplier ? selectedOperationSupplier?.taxId ?? "" : current.exporterName === selectedOperationSupplier?.legalName ? "" : current.exporterTaxId,
    }));
  }

  function updateOperationClient(importerClientId: string) {
    const client = masterClients.find((item) => String(item.id) === importerClientId);
    setOperationForm((current) => ({
      ...current,
      importerClientId,
      euImporter: client?.legalName ?? "",
      destinationCountry: client?.country || current.destinationCountry,
      euOperatorEori: client?.eori || "",
      portOfDischarge: client?.preferredPort || current.portOfDischarge,
    }));
    setOperationErrors((current) => { const next={...current}; delete next.euImporter; return next; });
  }

  function updateOperationClientName(euImporter: string) {
    const normalized = euImporter.trim().toLowerCase();
    const client = masterClients.find((item) => item.legalName.trim().toLowerCase() === normalized || item.aliases.split(/[,;\n]/).some((alias) => alias.trim().toLowerCase() === normalized));
    setOperationForm((current) => ({
      ...current,
      euImporter,
      importerClientId: client ? String(client.id) : "",
      destinationCountry: client?.country || current.destinationCountry,
      euOperatorEori: client?.eori || current.euOperatorEori,
      portOfDischarge: client?.preferredPort || current.portOfDischarge,
    }));
    setOperationErrors((current) => { const next={...current}; delete next.euImporter; return next; });
  }

  function openEditOperation(operation: OperationRecord) {
    setOperationErrors({});
    setOperationSaveError("");
    setSupplierOpenedFromOperation(false);
    setDetailOperation(null);
    setEditingOperationId(operation.id);
    const operationSupplier = suppliers.find((supplier) => supplier.id === operation.supplierId);
    setOperationForm({
      ...emptyOperationForm,
      ...operation,
      importerClientId: String(operation.importerClientId || ""),
      supplierId: String(operation.supplierId),
      propertyIds: parsePropertyIds(operation.propertyIds),
      commercialValue: String(operation.commercialValue || ""),
      quantity: String(operation.quantity || ""),
      grossWeightKg: String(operation.grossWeightKg || ""),
      netWeightKg: String(operation.netWeightKg || ""),
      volumeM3: String(operation.volumeM3 || ""),
      productionLocation: supplierLocation(operationSupplier) || operation.productionLocation,
    });
    setDrawer("operation");
  }

  function openForestRegistryForOperation(operation: OperationRecord) {
    setDetailOperation(null);
    setForestLinkOperationId(operation.id);
    setRegistrationsOpen(true);
    setActive("Florestas");
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (!savedProperties.length) {
      openNewForestRegistration();
      showNotice("Cadastre a primeira floresta; ela será vinculada automaticamente ao Processo DDS.");
    }
  }

  function openNewForestRegistration() {
    setEditingPropertyId(null);
    setPropertyForm({ carCode: "", name: "", city: "", supplier: "", areaHa: "", nativeAreaHa: "" });
    setGeometry(null);
    setGeoFileName("");
    setSicarLookup(null);
    setSourceConsent(false);
    setImportOpen(true);
  }

  async function persistOperationForestLinks(operationId: number, propertyIds: string[]) {
    const response = await fetch("/api/operations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: operationId, propertyIds }),
    });
    const data = await response.json() as { operation?: OperationRecord; error?: string };
    if (!response.ok || !data.operation) throw new Error(data.error || "Não foi possível atualizar as florestas do processo.");
    setOperations((current) => current.map((item) => item.id === operationId ? data.operation! : item));
    setDetailOperation((current) => current?.id === operationId ? data.operation! : current);
    return data.operation;
  }

  async function toggleForestLink(property: MapProperty) {
    if (!forestLinkOperation) return;
    const currentIds = parsePropertyIds(forestLinkOperation.propertyIds);
    const linked = currentIds.includes(property.id);
    const nextIds = linked ? currentIds.filter((id) => id !== property.id) : [...currentIds, property.id];
    setForestLinkSavingId(property.id);
    try {
      await persistOperationForestLinks(forestLinkOperation.id, nextIds);
      setSelectedProperty(property);
      showNotice(linked ? "Floresta desvinculada deste Processo DDS." : "Floresta vinculada à STAGE 01 do Processo DDS.");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao atualizar o vínculo da floresta.");
    } finally {
      setForestLinkSavingId("");
    }
  }

  function returnToForestLinkOperation() {
    if (!forestLinkOperation) return;
    setDetailOperation(forestLinkOperation);
    setForestLinkOperationId(null);
    setActive("Processos");
  }

  function toggleOperationProperty(id: string) {
    setOperationForm((current) => ({
      ...current,
      propertyIds: current.propertyIds.includes(id) ? current.propertyIds.filter((item) => item !== id) : [...current.propertyIds, id],
    }));
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-copy"><strong>ExportaTrust</strong><b>EUDR</b><small>Due Diligence</small></span>
        </div>
        <nav aria-label="Navegação principal">
          {nav.slice(0, 2).map((item, index) => (
            <button
              key={item}
              className={active === item ? "nav-item active" : "nav-item"}
              onClick={() => {
                setActive(item);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              title={item}
            >
              <span className="nav-icon">{["⌂", "▤", "△", "▥"][index]}</span>
              {item}
            </button>
          ))}
          <div className="nav-group">
            <button
              className={["Fornecedores", "Clientes", "Produtos", "Duplicidades", "Florestas"].includes(active) ? "nav-item nav-parent active" : "nav-item nav-parent"}
              onClick={() => setRegistrationsOpen((open) => !open)}
              title="Cadastros"
              aria-expanded={registrationsOpen}
            >
              <span className="nav-icon">＋</span>
              Cadastros
              <span className="nav-chevron">{registrationsOpen ? "⌃" : "⌄"}</span>
            </button>
            {registrationsOpen && (
              <div className="nav-children">
                {[
                  ["Fornecedores", "♙"],
                  ["Clientes", "◎"],
                  ["Produtos", "▦"],
                  ["Duplicidades", "⇄"],
                  ["Florestas", "◫"],
                ].map(([item, icon]) => (
                  <button
                    key={item}
                    className={active === item ? "nav-child active" : "nav-child"}
                    onClick={() => {
                      setActive(item);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    <span>{icon}</span>{item}
                  </button>
                ))}
              </div>
            )}
          </div>
          {nav.slice(2).map((item, index) => (
            <button
              key={item}
              className={active === item ? "nav-item active" : "nav-item"}
              onClick={() => {
                setActive(item);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              title={item}
            >
              <span className="nav-icon">{["◎", "△", "▥", "⚙", "⚿"][index]}</span>{item}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <span className="avatar">{initialData.security.fullName.split(/\s+/).map((item) => item[0]).join("").slice(0, 2).toUpperCase()}</span>
            <span><b>{initialData.security.fullName}</b><small>{initialData.security.role} · {initialData.security.organizationName}</small></span>
            <span>⌄</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{active === "Dashboard" ? "DASHBOARD DE EXPORTAÇÃO E DUE DILIGENCE" : "PAINEL DE EXPORT CONTROL"}</p>
            <h1>{active === "Dashboard" ? "EXPORTATRUST - EXPORT CONTROL & EUDR APP" : active} <span>⌄</span></h1>
          </div>
          <div className="header-actions">
            <div className="language-switch" aria-label="Idioma / Language">
              <button className={language === "pt" ? "active" : ""} onClick={() => setLanguage("pt")}>PT</button>
              <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button>
            </div>
            <button className="icon-button" aria-label="Notificações">♢<span className="notification-dot" /></button>
            <button className="primary" onClick={openNewOperation}>Nova operação <span>＋</span></button>
          </div>
        </header>

        <div className="content">
          {active === "Dashboard" && baseStatus === "loading" && (
            <section className="panel dashboard-loading" aria-live="polite">
              <span className="loading-spinner">↻</span>
              <h2>Carregando seus cadastros…</h2>
              <p>Aguarde enquanto processos, fornecedores, documentos e imóveis CAR são consultados.</p>
            </section>
          )}
          {active === "Dashboard" && baseStatus === "error" && (
            <section className="panel dashboard-loading dashboard-load-error">
              <span>!</span>
              <h2>Não foi possível carregar os cadastros</h2>
              <p>Seus dados permanecem armazenados. Toque abaixo para consultar novamente.</p>
              <button className="primary" onClick={() => window.location.reload()}>Recarregar cadastros</button>
            </section>
          )}
          {active === "Dashboard" && baseStatus === "ready" && <>
          <div className="status-line">
            <span className="live-dot" /> {operations[0]?.status ?? "Nenhum processo cadastrado"}
            {operations[0] && <><span className="divider" />{operations[0].product} · NCM {operations[0].hsCode}</>}
            <span className="status-spacer" />
            Dados cadastrados no sistema
          </div>

          <section className="kpi-grid" aria-label="Indicadores cadastrados">
            <Kpi icon="▤" value={String(operations.length)} label="processos" note="Cadastrados no sistema" />
            <Kpi icon="♙" value={String(suppliers.length)} label="fornecedores" note="Cadastrados no sistema" />
            <Kpi icon="◫" value={String(savedProperties.length)} label="imóveis CAR" note="Origens cadastradas" />
            <Kpi icon="!" value={String(exceptionActions.filter((item) => item.status !== "Resolvido").length)} label="exceções abertas" note="Planos de ação pendentes" critical={exceptionActions.some((item) => item.status !== "Resolvido")} />
          </section>

          {operations[0] ? (
            <section className="main-grid">
              <article className="panel supply-panel">
                <div className="panel-title">
                  <div><p className="eyebrow">PROCESSO MAIS RECENTE</p><h2>{operations[0].reference} · {operations[0].product}</h2></div>
                  <button className="text-button" onClick={openCompleteSupplyChain}>Ver cadeia completa →</button>
                </div>
                <div className="registered-summary">
                  <div><span>Fornecedor</span><b>{operations[0].supplierName || "Não informado"}</b></div>
                  <div><span>Destino</span><b>{operations[0].destinationCountry || "Não informado"}</b></div>
                  <div><span>Origens CAR</span><b>{parsePropertyIds(operations[0].propertyIds).length}</b></div>
                  <div><span>Prontidão registrada</span><b>{operations[0].readiness}%</b></div>
                </div>
                <div className="progress-footer">
                  <span>Progresso cadastrado do processo</span>
                  <div className="progress-track"><span style={{ width: `${operations[0].readiness}%` }} /></div>
                  <b>{operations[0].readiness}% <small>pronto</small></b>
                </div>
              </article>
              <article className="panel readiness-panel">
                <div className="panel-title"><div><p className="eyebrow">BASE CADASTRADA</p><h2>Resumo operacional</h2></div></div>
                <div className="dashboard-facts">
                  <div><strong>{suppliers.length}</strong><span>fornecedores</span></div>
                  <div><strong>{savedProperties.length}</strong><span>imóveis CAR</span></div>
                  <div><strong>{exceptionActions.filter((item) => item.operationReference === operations[0].reference && item.status !== "Resolvido").length}</strong><span>ações abertas</span></div>
                </div>
                <button className="ghost dashboard-open-process" onClick={openCompleteSupplyChain}>Abrir centro de comando →</button>
              </article>
            </section>
          ) : (
            <section className="panel dashboard-empty">
              <span>▤</span><h2>Nenhum processo cadastrado</h2>
              <p>O Dashboard está zerado. Os indicadores serão preenchidos somente com informações efetivamente cadastradas.</p>
              <button className="primary" onClick={openNewOperation}>Cadastrar primeiro processo ＋</button>
            </section>
          )}

          {!!operations.length && (
            <section className="panel dashboard-processes">
              <div className="panel-title">
                <div><p className="eyebrow">PORTFÓLIO EUDR</p><h2>Resumo de todos os processos</h2></div>
                <button className="text-button" onClick={() => setActive("Processos")}>Ver gestão completa →</button>
              </div>
              <div className="dashboard-process-list">
                {operations.map((operation) => {
                  const documentCount = allDocuments.filter((document) => document.operationId === operation.id).length;
                  const openRisks = exceptionActions.filter((item) => item.operationReference === operation.reference && item.status !== "Resolvido").length;
                  return <button key={operation.id} onClick={() => setDetailOperation(operation)}>
                    <div><strong>{operation.reference}</strong><span>{operation.product} · {operation.destinationCountry}</span></div>
                    <span>{operation.supplierName}</span>
                    <span>{documentCount} docs</span>
                    <span className={openRisks ? "process-risk" : "process-ok"}>{openRisks ? `${openRisks} risco(s)` : "Sem risco aberto"}</span>
                    <b>{operation.readiness}%</b>
                  </button>;
                })}
              </div>
            </section>
          )}
          </>}

          {active === "Dashboard" && <EnvironmentalNews language={language} />}

          {active === "Florestas" && <>
          {forestLinkOperation && <section className="forest-link-banner">
            <div><span>STAGE 01</span><p><b>Vincular florestas ao Processo {forestLinkOperation.reference}</b><small>Selecione abaixo as origens CAR que abastecem este processo. Os dados, a geometria, os documentos e o dossiê do imóvel serão puxados para o Centro de Comando DDS.</small></p></div>
            <div><strong>{parsePropertyIds(forestLinkOperation.propertyIds).length} vinculada(s)</strong><button onClick={openNewForestRegistration}>Cadastrar nova floresta ＋</button><button className="primary" onClick={returnToForestLinkOperation}>Voltar ao Centro de Comando →</button></div>
          </section>}
          <section className="module-header forest-search-header">
            <div className="forest-search-intro"><p className="eyebrow">ORIGEM E RASTREABILIDADE</p><h2>Busca inteligente SICAR</h2><p>Localize uma origem por CAR, coordenadas geográficas ou UTM e use o resultado no cadastro e nos processos EUDR.</p></div>
            <div className="car-search">
              <label htmlFor="car-query">CAR, coordenadas ou UTM</label>
              <div>
                <input id="car-query" value={carSearch} onChange={(event) => setCarSearch(event.target.value)} placeholder="CAR · -26.83 -49.27 · 26°49'S 49°16'W · UTM 22J 672000 7034000" />
                <select aria-label="UF do imóvel para consulta geográfica" value={sicarStateHint} onChange={(event) => setSicarStateHint(event.target.value)}>
                  <option value="">UF do imóvel</option>
                  {brazilStates.map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
                <button onClick={() => {
                  const query = carSearch.toLowerCase().trim();
                  const found = allProperties.find((property) => [property.id, property.name, property.city, property.supplier].some((value) => value.toLowerCase().includes(query)));
                  if (found && query) { setSelectedProperty(found); showNotice(`Imóvel ${found.name} localizado.`); }
                  else showNotice("Código não encontrado nos cadastros atuais.");
                }}>Buscar no app</button>
                <button className="sicar-query-button" disabled={sicarLookupLoading} onClick={() => prepareSicarLookup(carSearch, sicarStateHint)}>{sicarLookupLoading ? "Consultando…" : "Consultar SICAR"}</button>
              </div>
              <small className="car-search-help"><b>Formato livre:</b> graus decimais, graus/minutos/segundos ou UTM. Para UTM informe zona + Leste + Norte. A UF só é necessária para buscas geográficas.</small>
            </div>
          </section>
          <section className="panel forest-registry">
            <div className="forest-registry-header">
              <div><p className="eyebrow">CADASTRO MESTRE</p><h2>Florestas cadastradas</h2><p>Abra, atualize e gerencie as origens que podem ser reutilizadas em qualquer Processo EUDR.</p></div>
              <div className="forest-registry-tools"><label>⌕<input value={forestListSearch} onChange={(event) => setForestListSearch(event.target.value)} placeholder="Buscar CAR, floresta, município ou fornecedor" /></label><button className="primary" onClick={() => { setEditingPropertyId(null); setImportOpen(true); }}>Nova floresta / CAR ＋</button></div>
            </div>
            <div className="forest-registry-summary"><span><b>{allProperties.length}</b> imóveis cadastrados</span><span><b>{totalArea(allProperties)}</b> ha registrados</span><span><b>{forestDocuments.length}</b> evidências anexadas</span></div>
            <div className="forest-registry-list">
              {filteredForestProperties.map((property) => {
                const processCount = operations.filter((item) => parsePropertyIds(item.propertyIds).includes(property.id)).length;
                const docCount = forestDocuments.filter((document) => document.propertyCarCode === property.id).length;
                return <article key={property.id} className={selectedProperty?.id === property.id ? "selected" : ""}>
                  <div className="forest-registry-identity"><span>CAR</span><div><b>{property.name}</b><small>{property.id}</small><small>⌖ {property.city} · {property.supplier}</small></div></div>
                  <div><small>Área</small><b>{property.area}</b></div><div><small>Status SICAR</small><b className={`forest-status ${property.risk}`}>{property.status}</b></div><div><small>Uso / evidências</small><b>{processCount} processo(s) · {docCount} doc(s)</b></div>
                  <div className="forest-registry-actions">
                    {forestLinkOperation && <button className={parsePropertyIds(forestLinkOperation.propertyIds).includes(property.id) ? "forest-link-action linked" : "forest-link-action"} disabled={forestLinkSavingId === property.id} onClick={() => toggleForestLink(property)}>{forestLinkSavingId === property.id ? "Salvando…" : parsePropertyIds(forestLinkOperation.propertyIds).includes(property.id) ? "✓ Vinculada" : "+ Vincular"}</button>}
                    <button onClick={() => { setSelectedProperty(property); setForestDetailProperty(property); }}>Abrir ficha</button>
                    <button disabled={forestActionId === property.id} onClick={() => refreshForestFromSicar(property)}>{forestActionId === property.id ? "Atualizando…" : "Atualizar SICAR"}</button>
                    <button onClick={() => editForestProperty(property)}>Editar</button>
                    <button className="danger" onClick={() => deleteForestProperty(property)}>Excluir</button>
                  </div>
                </article>;
              })}
              {!filteredForestProperties.length && <div className="forest-registry-empty">Nenhuma floresta encontrada. Cadastre uma nova origem CAR para começar.</div>}
            </div>
          </section>
          <section className="panel geo-panel" id="forest-map">
            <div className="geo-header">
              <div>
                <p className="eyebrow">ORIGEM GEOGRÁFICA · BASE CAR</p>
                <h2>Ficha geográfica do imóvel CAR</h2>
                <p>Dados reais do imóvel selecionado, sua geometria SICAR, documentos e vínculos EUDR.</p>
              </div>
            </div>

            <section className="car-origin-base" id="forest-origin-base">
              {selectedProperty ? <>
                <div className="car-origin-hero">
                  <div><p className="eyebrow">IMÓVEL CAR SELECIONADO</p><h3>{selectedProperty.name}</h3><span>{selectedProperty.id}</span><small>⌖ {selectedProperty.city} · {selectedProperty.supplier}</small></div>
                  <div className="car-origin-hero-actions"><span className={`property-status ${selectedProperty.risk}`}>{selectedProperty.status}</span><button disabled={forestActionId === selectedProperty.id} onClick={() => refreshForestFromSicar(selectedProperty)}>{forestActionId === selectedProperty.id ? "Atualizando…" : "↻ Atualizar SICAR"}</button><button onClick={() => editForestProperty(selectedProperty)}>Editar ficha</button></div>
                </div>
                <div className="car-origin-grid">
                  <div className="car-origin-map">
                    <div className="car-origin-map-title"><b>Satélite + limite CAR / SICAR</b><span>{selectedProperty.geometry?.length || 0} vértices</span></div>
                    <div className="car-origin-map-canvas satellite">{selectedProperty.geometry?.length ? <><div className="satellite-raster" role="img" aria-label={`Imagem de satélite correlacionada ao CAR ${selectedProperty.id}`} style={{ backgroundImage: `url('/api/satellite-map?carCode=${encodeURIComponent(selectedProperty.id)}')` }} /><svg viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid meet" aria-label={`Limite do CAR ${selectedProperty.id}`}><polygon points={toSatelliteMapPoints(selectedProperty.geometry)} /></svg></> : <p>Geometria ainda não cadastrada para este CAR.</p>}<i>N ↑</i><em>IMAGEM DE SATÉLITE · LIMITE CAR</em></div>
                    <small>A imagem é enquadrada automaticamente pela geometria do CAR selecionado. O contorno verde identifica a área cadastrada no SICAR.</small>
                  </div>
                  <div className="car-origin-data">
                    <h4>Dados da origem</h4>
                    <dl><div><dt>Código CAR</dt><dd>{selectedProperty.id}</dd></div><div><dt>Situação SICAR</dt><dd>{selectedProperty.status}</dd></div><div><dt>Área total</dt><dd>{selectedProperty.area}</dd></div><div><dt>Vegetação nativa</dt><dd>{selectedProperty.native}</dd></div><div><dt>Fornecedor</dt><dd>{selectedProperty.supplier}</dd></div><div><dt>Processos vinculados</dt><dd>{operations.filter((operation) => parsePropertyIds(operation.propertyIds).includes(selectedProperty.id)).length}</dd></div><div className="wide"><dt>Fonte / atualização</dt><dd>{selectedProperty.source || "Cadastro manual"}{selectedProperty.checkedAt && <small>{formatDate(selectedProperty.checkedAt)}</small>}</dd></div></dl>
                    <div className="car-origin-flags"><span>✓ CAR cadastrado</span><span className={selectedProperty.geometry?.length ? "complete" : "pending"}>{selectedProperty.geometry?.length ? "✓ Geometria" : "! Geometria"}</span><span className={selectedForestDocuments.some((document) => document.category === "Demonstrativo CAR") ? "complete" : "pending"}>{selectedForestDocuments.some((document) => document.category === "Demonstrativo CAR") ? "✓ Demonstrativo SICAR" : "! Demonstrativo pendente"}</span></div>
                  </div>
                </div>
                <div className="car-origin-bottom">
                  <div><p className="eyebrow">EVIDÊNCIAS</p><strong>{selectedForestDocuments.length}</strong><span>documento(s) vinculados ao imóvel</span>{selectedForestDocuments.slice(0,3).map((document) => <small key={document.id}>{document.category} · {document.fileName}</small>)}</div>
                  <div><p className="eyebrow">SUPPLY CHAIN</p><strong>{operations.filter((operation) => parsePropertyIds(operation.propertyIds).includes(selectedProperty.id)).length}</strong><span>Processo(s) EUDR usando esta origem</span>{operations.filter((operation) => parsePropertyIds(operation.propertyIds).includes(selectedProperty.id)).slice(0,3).map((operation) => <small key={operation.id}>{operation.reference} · {operation.product}</small>)}</div>
                  <div className="car-origin-download"><p className="eyebrow">DOSSIÊ DO IMÓVEL</p><b>CAR + mapa + evidências + documento SICAR original</b><a href={`/api/forest-dossier?carCode=${encodeURIComponent(selectedProperty.id)}`}>Gerar Dossiê PDF ↓</a><button onClick={() => downloadPropertyGeoJson(selectedProperty)}>Baixar GeoJSON</button></div>
                </div>
              </> : <div className="car-origin-empty"><span>CAR</span><h3>Nenhum imóvel selecionado</h3><p>Escolha uma floresta no cadastro mestre acima ou consulte o SICAR.</p><button onClick={() => { setEditingPropertyId(null); setImportOpen(true); }}>Cadastrar nova floresta / CAR</button></div>}
            </section>

            <div className="geo-layout">
              <div className="map-card">
                <div className="map-toolbar">
                  <div className="layer-tabs" aria-label="Camadas do mapa">
                    {["Imóveis CAR", "Vegetação nativa", "Reserva Legal"].map((layer) => (
                      <button key={layer} className={mapLayer === layer ? "selected" : ""} onClick={() => setMapLayer(layer)}>{layer}</button>
                    ))}
                  </div>
                  <span>{allProperties.length} imóveis · {totalArea(allProperties)} ha</span>
                </div>
                <div className={`forest-map layer-${mapLayer.replaceAll(" ", "-").toLowerCase()}`}>
                  <div className="map-zoom-layer" style={{ transform: `scale(${mapZoom})` }}>
                  <div className="map-land land-one" />
                  <div className="map-land land-two" />
                  <div className="map-river" />
                  <svg className="geo-polygons" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Polígonos importados">
                    {savedProperties.filter((property) => property.geometry?.length).map((property) => (
                      <polygon key={property.id} points={toMapPoints(property.geometry!)} className={selectedProperty?.id === property.id ? "selected" : ""} />
                    ))}
                  </svg>
                  {allProperties.map((property) => (
                    <button
                      key={property.id}
                      aria-label={`Selecionar ${property.name}`}
                      className={`map-pin ${property.risk} ${selectedProperty?.id === property.id ? "selected" : ""}`}
                      style={{ left: `${property.x}%`, top: `${property.y}%` }}
                      onClick={() => setSelectedProperty(property)}
                    >
                      <span>▲</span>
                      <small>{property.name}</small>
                    </button>
                  ))}
                  </div>
                  <div className="map-legend">
                    <span><i className="legend-low" /> Validado</span>
                    <span><i className="legend-warn" /> Pendente</span>
                    <span><i className="legend-risk" /> Risco</span>
                  </div>
                  <div className="map-controls"><button aria-label="Aumentar zoom" onClick={() => setMapZoom((zoom) => Math.min(1.8, Number((zoom + .2).toFixed(1))))}>+</button><button aria-label="Diminuir zoom" onClick={() => setMapZoom((zoom) => Math.max(1, Number((zoom - .2).toFixed(1))))}>−</button></div>
                  <span className="scale">5 km</span>
                </div>
              </div>

              {selectedProperty ? <aside className="property-card">
                <div className="property-top">
                  <span className={`property-status ${selectedProperty.risk}`}>{selectedProperty.status}</span>
                  <span>CAR/SICAR</span>
                </div>
                <p className="eyebrow">IMÓVEL SELECIONADO</p>
                <h3>{selectedProperty.name}</h3>
                <p className="property-location">⌖ {selectedProperty.city}</p>
                <dl>
                  <div><dt>Código CAR</dt><dd>{selectedProperty.id}</dd></div>
                  <div><dt>Área do imóvel</dt><dd>{selectedProperty.area}</dd></div>
                  <div><dt>Vegetação nativa</dt><dd>{selectedProperty.native}</dd></div>
                  <div><dt>Fornecedor</dt><dd>{selectedProperty.supplier}</dd></div>
                  <div><dt>Vínculo em processos</dt><dd>{operations.filter((item) => parsePropertyIds(item.propertyIds).includes(selectedProperty.id)).length}</dd></div>
                  <div><dt>Fonte do cadastro</dt><dd>{selectedProperty.source || "Cadastro manual"}{selectedProperty.checkedAt && <small>{formatDate(selectedProperty.checkedAt)}</small>}</dd></div>
                </dl>
                <div className="evidence-checks">
                  <span><b>✓</b> Cadastro CAR registrado</span>
                  <span className={selectedProperty.geometry?.length ? "" : "missing"}><b>{selectedProperty.geometry?.length ? "✓" : "!"}</b> Geometria {selectedProperty.geometry?.length ? "importada" : "não informada"}</span>
                  <span><b>•</b> Situação: {selectedProperty.status}</span>
                </div>
                <div className="property-actions">
                  <a className="property-action property-dossier-action" href={`/api/forest-dossier?carCode=${encodeURIComponent(selectedProperty.id)}`}>Gerar e baixar Dossiê do Imóvel em PDF ↓</a>
                  <button className="property-action" onClick={() => downloadPropertyGeoJson(selectedProperty)}>Baixar GeoJSON da floresta →</button>
                </div>
              </aside> : <aside className="property-card empty-property"><p className="eyebrow">BASE CAR</p><h3>Nenhum imóvel cadastrado</h3><p>Importe um CAR ou GeoJSON para preencher este mapa.</p><button className="property-action" onClick={() => { setEditingPropertyId(null); setImportOpen(true); }}>Cadastrar primeiro imóvel →</button></aside>}
            </div>
            {selectedProperty && <section className="forest-dossier">
              <header>
                <div><p className="eyebrow">DOSSIÊ DA ORIGEM</p><h3>Documentos do CAR e da floresta</h3><p>Centralize aqui as evidências que acompanham esta origem nos processos e no relatório EUDR.</p></div>
                <strong>{selectedForestDocuments.length}<small>arquivo(s)</small></strong>
              </header>
              <div className="forest-dossier-controls">
                <label>Tipo de documento<select value={forestDocCategory} onChange={(event) => setForestDocCategory(event.target.value)}><option>Recibo CAR</option><option>Demonstrativo CAR</option><option>Documento de legalidade da origem</option><option>Autorização / licença florestal</option><option>Certidão ambiental</option><option>Outros documentos da origem</option></select></label>
                <label>Observação<input value={forestDocNotes} onChange={(event) => setForestDocNotes(event.target.value)} placeholder="Ex.: demonstrativo emitido pelo titular" /></label>
              </div>
              <div className={`forest-document-drop ${forestDocDragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setForestDocDragging(true); }} onDragLeave={() => setForestDocDragging(false)} onDrop={(event) => { event.preventDefault(); setForestDocDragging(false); uploadForestDocuments(Array.from(event.dataTransfer.files)); }}>
                <input id="forest-evidence-files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.json,.geojson,.kml,.kmz,.zip" onChange={(event) => uploadForestDocuments(Array.from(event.target.files ?? []))} />
                <span>{forestDocUploading ? "↻" : "↑"}</span><div><b>{forestDocUploading ? "Enviando arquivos…" : "Arraste Recibo, Demonstrativo e evidências aqui"}</b><small>PDF, imagens, GeoJSON, KML/KMZ ou ZIP · até 20 MB por arquivo</small></div><label htmlFor="forest-evidence-files">Selecionar arquivos</label>
              </div>
              <div className="forest-evidence-list">
                {selectedForestDocuments.map((document) => <article key={document.id}><span>{fileIcon(document.fileName)}</span><div><b>{document.fileName}</b><small>{document.category} · {formatBytes(document.sizeBytes)} · {formatDate(document.uploadedAt)}</small>{document.notes && <small>{document.notes}</small>}</div><em>{document.source}</em><button title="Baixar documento" onClick={() => openSecureDocument(document.id, "forest").catch((error) => showNotice(error.message))}>↓</button><button title="Excluir documento" onClick={() => removeForestDocument(document)}>×</button></article>)}
                {!selectedForestDocuments.length && <div className="empty-command">Nenhum documento anexado a este CAR. O GeoJSON cadastrado continua disponível acima.</div>}
              </div>
              <footer><span>✓ CAR cadastrado</span><span>✓ GeoJSON vinculado</span><span className={selectedForestDocuments.some((document) => document.category === "Recibo CAR") ? "complete" : "pending"}>{selectedForestDocuments.some((document) => document.category === "Recibo CAR") ? "✓ Recibo CAR" : "! Recibo CAR pendente"}</span><span className={selectedForestDocuments.some((document) => document.category === "Demonstrativo CAR") ? "complete" : "pending"}>{selectedForestDocuments.some((document) => document.category === "Demonstrativo CAR") ? "✓ Demonstrativo CAR · incorporado no ponto 8" : "! Demonstrativo pendente · ponto 8 incompleto"}</span></footer>
            </section>}
            <div className="geo-note">
              <span>ⓘ</span>
              <p><b>Origem da informação:</b> dados declarados no CAR e geometria fornecida pelo responsável. O CAR não comprova, isoladamente, ausência de desmatamento nem regularidade EUDR.</p>
              <button onClick={() => { setEditingPropertyId(null); setImportOpen(true); }}>Cadastrar floresta / CAR</button>
            </div>
            {dataStatus === "error" && <div className="data-error">Não foi possível consultar os imóveis salvos. Atualize a página; se o erro persistir, registre a operação novamente.</div>}
          </section>
          </>}

          {active === "Dashboard" && baseStatus === "ready" && <>
          <section className="lower-grid">
            <article className="panel alerts-panel" id="alerts">
              <div className="panel-title">
                <div><p className="eyebrow">RISCOS REAIS</p><h2>Planos de ação abertos</h2></div>
                <button className="text-button" onClick={() => setActive("Riscos")}>Gerenciar riscos →</button>
              </div>
              <div className="alert-list">
                {exceptionActions.filter((action) => action.status !== "Resolvido").slice(0, 5).map((action) => <button className="alert-row" key={action.id} onClick={() => setActive("Riscos")}><span className="badge attention">Ação</span><span><b>{action.alertText}</b><small>{action.operationReference} · {action.responsibleName}</small></span><span className="date">{action.dueDate}</span><span className="status attention">{action.status}</span><strong>›</strong></button>)}
                {!exceptionActions.some((action) => action.status !== "Resolvido") && <div className="empty-table">Nenhuma pendência aberta cadastrada.</div>}
              </div>
            </article>

            <article className="panel activity-panel">
              <div className="panel-title">
                <div><p className="eyebrow">DOCUMENTOS REAIS</p><h2>Últimos arquivos recebidos</h2></div>
              </div>
              <div className="activity-list">
                {allDocuments.slice(0, 5).map((document) => <div className="activity" key={document.id}><span className="activity-icon">{fileIcon(document.fileName)}</span><span><b>{document.fileName}</b><small>{operations.find((operation) => operation.id === document.operationId)?.reference || "Processo"} · {document.category}</small></span><time>{formatDate(document.uploadedAt)}</time></div>)}
                {!allDocuments.length && <div className="empty-table">Nenhum documento de processo cadastrado.</div>}
              </div>
            </article>
          </section>
          </>}

          {!["Dashboard", "Florestas"].includes(active) && (
            <ModuleView
              active={active}
              showNotice={showNotice}
              openOperation={openNewOperation}
              openSupplier={() => setDrawer("supplier")}
              openSupplierDetails={setDetailSupplier}
              editSupplier={beginEditSupplier}
              openOperationDetails={setDetailOperation}
              savedOperations={operations}
              savedSuppliers={suppliers}
              savedActions={exceptionActions}
              savedDocuments={allDocuments}
              savedProperties={allProperties}
              onActionsChange={setExceptionActions}
              onClientsChange={setMasterClients}
            />
          )}
        </div>
      </section>

      {drawer === "operation" && (
        <div className="overlay" role="presentation" onMouseDown={() => setDrawer(null)}>
          <aside className="drawer supply-chain-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="drawer-close" aria-label="Fechar" onClick={() => setDrawer(null)}>×</button>
            <p className="eyebrow">{editingOperationId ? "ATUALIZAR PEDIDO E SUPPLY CHAIN" : "NOVO PROCESSO DE EXPORTAÇÃO"}</p>
            <h2 id="drawer-title">{editingOperationId ? "Editar processo de exportação" : "Criar processo de exportação"}</h2>
            <p>Registre pedido, participantes, produto, origem, volumes e logística. Estes dados alimentarão o acompanhamento operacional e o dossiê EUDR.</p>
            {!!Object.keys(operationErrors).length && (
              <div className="operation-validation-summary" role="alert">
                <strong>Revise os campos obrigatórios:</strong>
                <span>{Object.values(operationErrors).join(" · ")}</span>
              </div>
            )}
            {operationSaveError && <div className="operation-validation-summary" role="alert"><strong>Não foi possível salvar:</strong><span>{operationSaveError}</span></div>}

            <fieldset className="operation-form-section"><legend>1. Identificação da operação</legend><div className="form-grid">
              <label>Referência da operação<input data-operation-field="reference" aria-invalid={!!operationErrors.reference} value={operationForm.reference} onChange={(event) => setOperationForm({ ...operationForm, reference: event.target.value })} placeholder="Ex.: GBU003/26; se vazio, gera automático" /></label>
              <label>Produto<input data-operation-field="product" aria-invalid={!!operationErrors.product} list="operation-products" value={operationForm.product} onChange={(event) => updateOperationProduct(event.target.value)} placeholder="Selecione, digite novo ou deixe para classificar depois" /><small className="field-hint">Opcional na abertura; se for novo, será criado ao salvar.</small></label>
              <label>NCM / HS Code<input data-operation-field="hsCode" aria-invalid={!!operationErrors.hsCode} value={operationForm.hsCode} onChange={(event) => setOperationForm({ ...operationForm, hsCode: event.target.value })} placeholder="Pode preencher depois" /></label>
              <label>Contrato / PO<input value={operationForm.contractNumber} onChange={(event) => setOperationForm({ ...operationForm, contractNumber: event.target.value })} /></label>
              <label>Responsável interno<input value={operationForm.internalResponsible} onChange={(event) => setOperationForm({ ...operationForm, internalResponsible: event.target.value })} /></label>
              <label>E-mail do responsável<input type="email" value={operationForm.responsibleEmail} onChange={(event) => setOperationForm({ ...operationForm, responsibleEmail: event.target.value })} /></label>
            </div></fieldset>

            <fieldset className="operation-form-section"><legend>2. Empresas da cadeia</legend><div className="form-grid">
              <label className="form-span supplier-operation-field">Fornecedor principal *
                <select data-operation-field="supplierId" aria-invalid={!!operationErrors.supplierId} value={operationForm.supplierId} onChange={(event) => updateOperationSupplier(event.target.value)}><option value="">Selecione um fornecedor cadastrado</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.legalName} · {supplier.city}/{supplier.state}</option>)}</select>
                <button type="button" className="supplier-create-link" onClick={() => { setSupplierOpenedFromOperation(true); setDrawer("supplier"); }}>+ Cadastrar novo fornecedor</button>
              </label>
              <label>Exportador / trading<input list="operation-exporters" value={operationForm.exporterName} onChange={(event) => updateOperationExporter(event.target.value)} placeholder="Fornecedor selecionado ou outra Trading" /><small className="field-hint">Se ficar vazio, será usado o fornecedor selecionado. Edite livremente se outra empresa realizar a exportação.</small></label>
              <label>CNPJ do exportador<input value={operationForm.exporterTaxId} onChange={(event) => setOperationForm({ ...operationForm, exporterTaxId: event.target.value })} /></label>
              <label>Importador / operador europeu *<input data-operation-field="euImporter" aria-invalid={!!operationErrors.euImporter} list="history-importers" value={operationForm.euImporter} onChange={(event) => updateOperationClientName(event.target.value)} placeholder="Selecione ou cadastre digitando um novo cliente" /><small className="field-hint">Se existir no Cadastro Mestre, vincula por customer_id; se for novo, será criado ao salvar.</small></label>
              <label>Cliente cadastrado<select value={operationForm.importerClientId} onChange={(event) => updateOperationClient(event.target.value)}><option value="">Novo ou não vinculado ainda</option>{masterClients.map((client)=><option key={client.id} value={client.id}>{client.legalName} · {client.country}</option>)}</select></label>
              <label>EORI do operador<input value={operationForm.euOperatorEori} onChange={(event) => setOperationForm({ ...operationForm, euOperatorEori: event.target.value })} /></label>
              <label className="form-span">Referência DDS/EUDR<input value={operationForm.eudrReference} onChange={(event) => setOperationForm({ ...operationForm, eudrReference: event.target.value })} placeholder="Preencher quando emitida no sistema europeu" /></label>
            </div></fieldset>

            <fieldset className="operation-form-section"><legend>3. Produto, origem e rastreabilidade</legend><div className="form-grid">
              <label>Matéria-prima<input list="product-raw-materials" value={operationForm.rawMaterial} onChange={(event) => setOperationForm({ ...operationForm, rawMaterial: event.target.value })} placeholder={operationForm.product ? "Selecione no catálogo ou digite" : "Selecione primeiro o produto"} /><small className="field-hint">Catálogo filtrado pelo produto; o campo permanece livre para novos materiais.</small></label>
              <label>Espécie(s)<input list="product-species" value={operationForm.species} onChange={(event) => setOperationForm({ ...operationForm, species: event.target.value })} placeholder={operationForm.product ? "Nome comum e científico" : "Selecione primeiro o produto"} /><small className="field-hint">Opções específicas do produto com nome científico para o EUDR.</small></label>
              <label>Tipo de origem<select value={operationForm.forestOriginType} onChange={(event) => setOperationForm({ ...operationForm, forestOriginType: event.target.value })}><option>Reflorestamento</option><option>Plantação</option><option>Floresta natural</option><option>Reciclado</option><option>Mista</option></select></label>
              <label>Unidade produtiva<input value={operationForm.productionUnit} onChange={(event) => setOperationForm({ ...operationForm, productionUnit: event.target.value })} placeholder="Digite livremente a planta ou unidade" /></label>
              <label>Local da produção (fornecedor)<input readOnly value={operationForm.productionLocation} placeholder="Preenchido ao selecionar o fornecedor" /><small className="field-hint">Usa automaticamente Município/UF e país do fornecedor cadastrado.</small></label>
              <label>Códigos dos lotes<input value={operationForm.lotCodes} onChange={(event) => setOperationForm({ ...operationForm, lotCodes: event.target.value })} placeholder="Separar por vírgula" /></label>
            </div><div className="property-picker"><div><strong>Florestas / imóveis CAR vinculados</strong><span>Selecione todas as origens que alimentam esta operação.</span></div><div className="property-options">{allProperties.map((property) => <label key={property.id} className={operationForm.propertyIds.includes(property.id) ? "selected" : ""}><input type="checkbox" checked={operationForm.propertyIds.includes(property.id)} onChange={() => toggleOperationProperty(property.id)} /><span><b>{property.name}</b><small>{property.id} · {property.city} · {property.supplier}</small></span><em>{property.area}</em></label>)}</div></div></fieldset>

            <fieldset className="operation-form-section"><legend>4. Quantidades e condição comercial</legend><div className="form-grid">
              <label>Quantidade<input type="number" min="0" step="0.01" value={operationForm.quantity} onChange={(event) => setOperationForm({ ...operationForm, quantity: event.target.value })} /></label>
              <label>Unidade<select value={operationForm.quantityUnit} onChange={(event) => setOperationForm({ ...operationForm, quantityUnit: event.target.value })}><option>MT</option><option>KG</option><option>M³</option><option>Unidades</option><option>Contêineres</option></select></label>
              <label>Peso líquido (kg)<input type="number" min="0" step="0.01" value={operationForm.netWeightKg} onChange={(event) => setOperationForm({ ...operationForm, netWeightKg: event.target.value })} /></label>
              <label>Peso bruto (kg)<input type="number" min="0" step="0.01" value={operationForm.grossWeightKg} onChange={(event) => setOperationForm({ ...operationForm, grossWeightKg: event.target.value })} /></label>
              <label>Volume (m³)<input type="number" min="0" step="0.001" value={operationForm.volumeM3} onChange={(event) => setOperationForm({ ...operationForm, volumeM3: event.target.value })} /></label>
              <label>Incoterm<select value={operationForm.incoterm} onChange={(event) => setOperationForm({ ...operationForm, incoterm: event.target.value })}><option>EXW</option><option>FCA</option><option>FOB</option><option>CFR</option><option>CIF</option><option>DAP</option><option>DDP</option></select></label>
              <label>Moeda<select value={operationForm.currency} onChange={(event) => setOperationForm({ ...operationForm, currency: event.target.value })}><option>USD</option><option>EUR</option><option>GBP</option><option>BRL</option></select></label>
              <label>Valor comercial<input type="number" min="0" step="0.01" value={operationForm.commercialValue} onChange={(event) => setOperationForm({ ...operationForm, commercialValue: event.target.value })} /></label>
            </div></fieldset>

            <fieldset className="operation-form-section"><legend>5. Logística internacional</legend><div className="form-grid">
              <label>Modal<select value={operationForm.transportMode} onChange={(event) => setOperationForm({ ...operationForm, transportMode: event.target.value })}><option>Marítimo</option><option>Rodoviário</option><option>Ferroviário</option><option>Aéreo</option><option>Multimodal</option></select></label>
              <label>Data prevista de embarque<input type="date" value={operationForm.shipmentDate} onChange={(event) => setOperationForm({ ...operationForm, shipmentDate: event.target.value })} /></label>
              <label>Porto/local de embarque<input list="history-loading-places" value={operationForm.portOfLoading} onChange={(event) => setOperationForm({ ...operationForm, portOfLoading: event.target.value })} /></label>
              <label>Porto/local de destino<input list="history-discharge-places" value={operationForm.portOfDischarge} onChange={(event) => setOperationForm({ ...operationForm, portOfDischarge: event.target.value })} /></label>
              <label>País de destino<input data-operation-field="destinationCountry" aria-invalid={!!operationErrors.destinationCountry} list="history-destination-countries" value={operationForm.destinationCountry} onChange={(event) => setOperationForm({ ...operationForm, destinationCountry: event.target.value })} placeholder="Livre; pode preencher depois" /></label>
              <label>Armador / transportadora<input list="history-carriers" value={operationForm.carrier} onChange={(event) => setOperationForm({ ...operationForm, carrier: event.target.value })} placeholder="Histórico de parceiros e operações" /></label>
              <label>Booking<input value={operationForm.bookingNumber} onChange={(event) => setOperationForm({ ...operationForm, bookingNumber: event.target.value })} /></label>
              <label>BL / Bill of Lading<input value={operationForm.billOfLadingNumber} onChange={(event) => setOperationForm({ ...operationForm, billOfLadingNumber: event.target.value })} placeholder="Ex.: SA0600284400" /></label>
              <label>Contêiner(es)<input value={operationForm.containerNumbers} onChange={(event) => setOperationForm({ ...operationForm, containerNumbers: event.target.value })} placeholder="Separar por vírgula" /></label>
              <label className="form-span">Navio / viagem<input value={operationForm.vesselVoyage} onChange={(event) => setOperationForm({ ...operationForm, vesselVoyage: event.target.value })} /></label>
            </div></fieldset>

            <fieldset className="operation-form-section"><legend>6. Observações da supply chain</legend><label className="operation-notes">Fluxo, particularidades e participantes ainda não cadastrados<textarea value={operationForm.supplyChainNotes} onChange={(event) => setOperationForm({ ...operationForm, supplyChainNotes: event.target.value })} placeholder="Descreva o caminho da matéria-prima até o importador europeu…" /></label></fieldset>
            <HistoryDatalist id="operation-exporters" values={uniqueValues([selectedOperationSupplier?.legalName ?? "", ...history.exporters])} />
            <HistoryDatalist id="operation-products" values={operationProducts} />
            <HistoryDatalist id="history-importers" values={history.importers} />
            <HistoryDatalist id="product-raw-materials" values={productRawMaterials} />
            <HistoryDatalist id="product-species" values={productSpecies} />
            <HistoryDatalist id="history-loading-places" values={history.loadingPlaces} />
            <HistoryDatalist id="history-discharge-places" values={history.dischargePlaces} />
            <HistoryDatalist id="history-carriers" values={history.carriers} />
            <HistoryDatalist id="history-destination-countries" values={history.destinationCountries} />
            {!suppliers.length && <button className="inline-alert" onClick={() => { setSupplierOpenedFromOperation(true); setDrawer("supplier"); }}>Cadastre primeiro um fornecedor →</button>}
            <button className="primary drawer-submit" disabled={savingBase || !suppliers.length} onClick={saveOperation}>{savingBase ? "Salvando…" : editingOperationId ? "Salvar alterações →" : "Criar operação e abrir centro de comando →"}</button>
          </aside>
        </div>
      )}

      {drawer === "supplier" && (
        <div className="overlay" role="presentation" onMouseDown={closeSupplierDrawer}>
          <aside className="drawer base-drawer" role="dialog" aria-modal="true" aria-labelledby="supplier-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="drawer-close" aria-label={supplierOpenedFromOperation ? "Voltar ao processo" : supplierOpenedFromForest ? "Voltar às florestas" : "Fechar"} onClick={closeSupplierDrawer}>×</button>
            <p className="eyebrow">BASE DA CADEIA EUDR</p>
            <h2 id="supplier-title">{editingSupplierId ? "Editar fornecedor" : "Cadastrar fornecedor"}</h2>
            <p>Registre a identidade fiscal e o contato responsável. Depois, este fornecedor poderá ser vinculado às operações, imóveis CAR e documentos.</p>
            <section className="supplier-smart-import" aria-labelledby="supplier-smart-import-title">
              <div className="supplier-smart-import-heading">
                <div><p className="eyebrow">PREENCHIMENTO INTELIGENTE</p><h3 id="supplier-smart-import-title">Cole todos os dados do fornecedor</h3></div>
                <span>AUTO</span>
              </div>
              <p>Copie uma ficha cadastral, assinatura de e-mail ou texto livre. Ao colar, os campos reconhecidos serão preenchidos automaticamente para sua revisão.</p>
              <textarea
                value={supplierRawData}
                onChange={(event) => setSupplierRawData(event.target.value)}
                onPaste={(event) => {
                  const text = event.clipboardData.getData("text");
                  if (!text) return;
                  event.preventDefault();
                  setSupplierRawData(text);
                  fillSupplierFromPastedData(text);
                }}
                placeholder={"Razão social: Empresa Exemplo Ltda\nCNPJ: 00.000.000/0001-00\nMunicípio/UF: Curitiba/PR\nResponsável: Maria Silva\nE-mail: maria@empresa.com.br\nTelefone: (41) 99999-9999"}
                aria-label="Colar dados completos do fornecedor"
              />
              <div className="supplier-smart-import-actions">
                <button type="button" onClick={() => fillSupplierFromPastedData()}>Interpretar e preencher</button>
                <button type="button" className="secondary" onClick={() => { setSupplierRawData(""); setSupplierImportResult(null); }}>Limpar texto</button>
              </div>
              {supplierImportResult && <div className={`supplier-import-result ${supplierImportResult.detected.length ? "success" : "warning"}`} role="status">
                <b>{supplierImportResult.detected.length ? `${supplierImportResult.detected.length} campo(s) identificado(s)` : "Nenhum campo identificado"}</b>
                {!!supplierImportResult.detected.length && <span>Preenchidos: {supplierImportResult.detected.join(", ")}.</span>}
                {!!supplierImportResult.missing.length && <span>Ainda faltam: {supplierImportResult.missing.join(", ")}.</span>}
                {!supplierImportResult.missing.length && <span>Todos os campos obrigatórios foram encontrados. Revise e salve o fornecedor.</span>}
              </div>}
            </section>
            <div className="form-grid">
              <label className="form-span">Razão social *<input value={supplierForm.legalName} onChange={(event) => setSupplierForm({ ...supplierForm, legalName: event.target.value })} placeholder="Nome empresarial completo" /></label>
              <label>Nome fantasia<input value={supplierForm.tradeName} onChange={(event) => setSupplierForm({ ...supplierForm, tradeName: event.target.value })} /></label>
              <label>CNPJ / ID fiscal *<input value={supplierForm.taxId} onChange={(event) => setSupplierForm({ ...supplierForm, taxId: event.target.value })} placeholder="00.000.000/0001-00" /></label>
              <label>País *<input value={supplierForm.country} onChange={(event) => setSupplierForm({ ...supplierForm, country: event.target.value })} /></label>
              <label>Estado/UF *<input maxLength={3} value={supplierForm.state} onChange={(event) => setSupplierForm({ ...supplierForm, state: event.target.value })} /></label>
              <label className="form-span">Município *<input value={supplierForm.city} onChange={(event) => setSupplierForm({ ...supplierForm, city: event.target.value })} /></label>
              <label>Responsável *<input value={supplierForm.contactName} onChange={(event) => setSupplierForm({ ...supplierForm, contactName: event.target.value })} /></label>
              <label>E-mail *<input type="email" value={supplierForm.email} onChange={(event) => setSupplierForm({ ...supplierForm, email: event.target.value })} /></label>
              <label>Telefone / WhatsApp<input value={supplierForm.phone} onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })} /></label>
              <label>Certificações<select value={supplierForm.certifications} onChange={(event) => setSupplierForm({ ...supplierForm, certifications: event.target.value })}><option>Sem certificação</option><option>FSC</option><option>PEFC</option><option>FSC + PEFC</option><option>Outra</option></select></label>
              <label className="form-span">Aliases / nomes alternativos<input value={supplierForm.aliases} onChange={(event) => setSupplierForm({ ...supplierForm, aliases: event.target.value })} placeholder="Ex.: VLP, VLP Madeiras, nome usado no Asana" /><small className="field-hint">Separe por vírgulas. Esses nomes identificam o mesmo fornecedor.</small></label>
              <label className="form-span">Produtos vinculados<input value={supplierForm.products} onChange={(event) => setSupplierForm({ ...supplierForm, products: event.target.value })} placeholder="Ex.: Madeira serrada, pellets, molduras" /></label>
              <label className="form-span">Unidades produtivas vinculadas<input value={supplierForm.productionUnits} onChange={(event) => setSupplierForm({ ...supplierForm, productionUnits: event.target.value })} placeholder="Ex.: Planta Timbó, Serraria União da Vitória" /></label>
              <label className="form-span bank-details-field">Dados bancários<textarea className="bank-details-textarea" value={supplierForm.bankDetails} onChange={(event) => setSupplierForm({ ...supplierForm, bankDetails: event.target.value })} placeholder={"Banco intermediário, banco beneficiário, SWIFT, agência/conta, IBAN, beneficiário e observações de pagamento"} /></label>
            </div>
            {supplierSaveError && <div className="supplier-save-error" role="alert"><b>Não foi possível salvar</b><span>{supplierSaveError}</span></div>}
            <button className="primary drawer-submit" disabled={savingBase} onClick={saveSupplier}>{savingBase ? "Salvando e confirmando…" : editingSupplierId ? "Salvar alterações →" : supplierOpenedFromOperation ? "Salvar e vincular ao processo →" : supplierOpenedFromForest ? "Salvar e vincular à floresta →" : "Salvar e homologar fornecedor →"}</button>
          </aside>
        </div>
      )}

      {detailSupplier && (
        <div className="overlay" role="presentation" onMouseDown={() => setDetailSupplier(null)}>
          <aside className="drawer supplier-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="supplier-detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="drawer-close" aria-label="Fechar detalhes" onClick={() => setDetailSupplier(null)}>×</button>
            <p className="eyebrow">FICHA DO FORNECEDOR</p>
            <div className="supplier-detail-title">
              <span className="supplier-avatar">{initials(detailSupplier.legalName)}</span>
              <div>
                <h2 id="supplier-detail-title">{detailSupplier.legalName}</h2>
                <p>{detailSupplier.tradeName || "Sem nome fantasia informado"}</p>
              </div>
            </div>
            <div className="supplier-detail-meta">
              <span className={`table-status ${detailSupplier.status.toLowerCase().replaceAll(" ", "-")}`}>{detailSupplier.status}</span>
              <span>{detailSupplier.certifications}</span>
            </div>
            <button className="primary supplier-edit-button" type="button" onClick={() => beginEditSupplier(detailSupplier)}>Editar fornecedor ✎</button>

            <section className="detail-section">
              <h3>Dados cadastrais</h3>
              <dl className="detail-list">
                <div><dt>CNPJ / ID fiscal</dt><dd>{detailSupplier.taxId}</dd></div>
                <div><dt>Localização</dt><dd>{detailSupplier.city}/{detailSupplier.state} · {detailSupplier.country}</dd></div>
                <div><dt>Responsável</dt><dd>{detailSupplier.contactName}</dd></div>
                <div><dt>E-mail</dt><dd><a href={`mailto:${detailSupplier.email}`}>{detailSupplier.email}</a></dd></div>
                <div><dt>Telefone</dt><dd>{detailSupplier.phone || "Não informado"}</dd></div>
                <div><dt>Aliases</dt><dd>{detailSupplier.aliases || "Nenhum alias cadastrado"}</dd></div>
                <div><dt>Produtos</dt><dd>{detailSupplier.products || "Nenhum produto vinculado"}</dd></div>
                <div><dt>Unidades produtivas</dt><dd>{detailSupplier.productionUnits || "Nenhuma unidade vinculada"}</dd></div>
                <div className="wide"><dt>Dados bancários</dt><dd>{detailSupplier.bankDetails || "Nenhum dado bancário cadastrado"}</dd></div>
              </dl>
            </section>

            <section className="detail-section">
              <div className="detail-heading"><h3>Vínculos no sistema</h3><span>{operations.filter((item) => item.supplierId === detailSupplier.id).length} operações</span></div>
              <div className="link-cards">
                <article><strong>{operations.filter((item) => item.supplierId === detailSupplier.id).length}</strong><span>Operações EUDR</span></article>
                <article><strong>{savedProperties.filter((item) => item.supplier === detailSupplier.legalName).length}</strong><span>Imóveis CAR</span></article>
                <article><strong>{allDocuments.filter((document) => operations.some((operation) => operation.id === document.operationId && operation.supplierId === detailSupplier.id)).length + forestDocuments.filter((document) => savedProperties.some((property) => property.id === document.propertyCarCode && property.supplier === detailSupplier.legalName)).length}</strong><span>Documentos vinculados</span></article>
              </div>
            </section>

            <section className="detail-section">
              <h3>Checklist do Cadastro Mestre</h3>
              <div className="homologation-list">
                <span className="complete"><b>✓</b> Identificação fiscal cadastrada</span>
                <span className="complete"><b>✓</b> Responsável e contato cadastrados</span>
                <span className={detailSupplier.certifications === "Sem certificação" ? "pending" : "complete"}><b>{detailSupplier.certifications === "Sem certificação" ? "!" : "✓"}</b> Certificação florestal informada</span>
                <span className="pending"><b>!</b> Documentos comprobatórios pendentes</span>
                <span className="pending"><b>!</b> Avaliação final EUDR pendente</span>
              </div>
            </section>

            <button className="primary drawer-submit" onClick={() => { setDetailSupplier(null); showNotice("Fornecedor homologado. Pendências documentais seguem no controle EUDR."); }}>Fornecedor homologado ✓</button>
          </aside>
        </div>
      )}

      {detailOperation && (
        <OperationCommandCenter
          operation={detailOperation}
          properties={allProperties}
          forestDocuments={forestDocuments}
          onClose={() => setDetailOperation(null)}
          onEdit={() => openEditOperation(detailOperation)}
          onManageForests={() => openForestRegistryForOperation(detailOperation)}
          onReadinessChange={(operationId, readiness) => {
            setOperations((current) => current.map((item) => item.id === operationId ? { ...item, readiness } : item));
            setDetailOperation((current) => current?.id === operationId ? { ...current, readiness } : current);
          }}
          showNotice={showNotice}
        />
      )}

      {importOpen && (
        <div className="overlay" role="presentation" onMouseDown={() => setImportOpen(false)}>
          <aside className="drawer import-drawer" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="drawer-close" aria-label="Fechar importação" onClick={() => setImportOpen(false)}>×</button>
            <p className="eyebrow">CADASTRO DE ORIGEM FLORESTAL</p>
            <h2 id="import-title">{editingPropertyId ? "Editar floresta / imóvel CAR" : "Cadastrar floresta / imóvel CAR"}</h2>
            <p>Consulte o SICAR para preencher automaticamente o imóvel e sua geometria. Se a base pública estiver indisponível, o GeoJSON manual continua disponível como alternativa.</p>
            <section className={`sicar-integration-card ${sicarLookup ? "checked" : ""}`}>
              <div>
                <span>{sicarLookup ? "✓" : "CAR"}</span>
                <div>
                  <strong>{sicarLookup?.automaticImport ? "Imóvel carregado automaticamente" : "Integração SICAR · Consulta automática"}</strong>
                  <p>{sicarLookup?.message || "Digite um CAR completo para buscar dados e polígono diretamente na base geoespacial pública do SICAR."}</p>
                  {sicarLookup && <small>Fonte: {sicarLookup.source} · consultado em {formatDate(sicarLookup.checkedAt)} · UF {sicarLookup.state}{sicarLookup.municipalityCode ? ` · IBGE ${sicarLookup.municipalityCode}` : ""}</small>}
                </div>
              </div>
              {sicarLookup
                ? <a href={sicarLookup.officialUrl} target="_blank" rel="noreferrer">Abrir Consulta Pública SICAR ↗</a>
                : <button type="button" disabled={sicarLookupLoading} onClick={() => prepareSicarLookup(propertyForm.carCode)}>{sicarLookupLoading ? "Consultando…" : "Buscar imóvel no SICAR"}</button>}
            </section>
            {sicarLookup?.automaticImport && <div className="sicar-result-grid">
              <div><span>Município</span><b>{sicarLookup.municipality || "—"}/{sicarLookup.state}</b></div>
              <div><span>Área SICAR</span><b>{Number(sicarLookup.areaHa || 0).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ha</b></div>
              <div><span>Status</span><b>{sicarLookup.status || sicarLookup.statusCode || "—"}</b></div>
              <div><span>Condição</span><b>{sicarLookup.condition || "Não informada"}</b></div>
              <div><span>Tipo do imóvel</span><b>{sicarLookup.propertyType === "IRU" ? "Imóvel rural" : sicarLookup.propertyType === "PCT" ? "Povos/comunidades tradicionais" : sicarLookup.propertyType === "AST" ? "Assentamento" : sicarLookup.propertyType || "Não informado"}</b></div>
              <div><span>Módulos fiscais</span><b>{Number(sicarLookup.fiscalModules || 0).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}</b></div>
              <div><span>Data do cadastro</span><b>{sicarLookup.registrationCreatedAt ? formatDate(sicarLookup.registrationCreatedAt) : "Não informada"}</b></div>
              <div><span>Vegetação nativa</span><b>{sicarLookup.nativeAreaAvailable ? `${Number(sicarLookup.nativeAreaHa || 0).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ha` : "Não exposta no WFS público"}</b></div>
            </div>}
            {sicarLookup?.automaticImport && <SicarValidationTrail
              carCode={sicarLookup.carCode}
              located={Boolean(sicarLookup.geometry)}
              validated={sicarLookup.automaticImport}
              officialDocument={forestDocuments.some((document) => document.propertyCarCode === (editingPropertyId || sicarLookup.carCode) && document.category === "Demonstrativo CAR")}
              inputType={sicarLookup.inputType}
              onNotice={showNotice}
            />}
            <div className="form-grid">
              <label className="car-code-field">Código do CAR *<input disabled={!!editingPropertyId} readOnly={!!sicarLookup?.automaticImport} value={propertyForm.carCode} onChange={(event) => setPropertyForm({ ...propertyForm, carCode: event.target.value })} placeholder="SC-0000000-XXXX.XXXX" />{sicarLookup?.automaticImport && <small className="field-source success">✓ Preenchido e validado pelo SICAR</small>}</label>
              <label>Nome da floresta / imóvel *<input value={propertyForm.name} onChange={(event) => setPropertyForm({ ...propertyForm, name: event.target.value })} placeholder="Fazenda ou propriedade" />{sicarLookup?.automaticImport && <small className={`field-source ${sicarLookup.propertyName ? "success" : "warning"}`}>{sicarLookup.propertyName ? "✓ Nome informado pela base pública" : "! Nome público indisponível — revise o nome provisório"}</small>}</label>
              <label>Município/UF *<input value={propertyForm.city} onChange={(event) => setPropertyForm({ ...propertyForm, city: event.target.value })} placeholder="Timbó/SC" />{sicarLookup?.automaticImport && <small className="field-source success">✓ Preenchido pelo SICAR · IBGE {sicarLookup.municipalityCode || "não informado"}</small>}</label>
              <label className="forest-supplier-field">Fornecedor responsável *
                <select value={propertyForm.supplier} onChange={(event) => setPropertyForm({ ...propertyForm, supplier: event.target.value })}>
                  <option value="">Selecione um fornecedor cadastrado</option>
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.legalName}>{supplier.legalName} · {supplier.city}/{supplier.state}</option>)}
                </select>
                <button type="button" onClick={() => { setSupplierOpenedFromForest(true); setImportOpen(false); setDrawer("supplier"); }}>+ Cadastrar fornecedor</button>
                {sicarLookup?.automaticImport && <small className="field-source warning">! Titular/fornecedor não é exposto pela consulta pública — selecione manualmente</small>}
              </label>
              <label>Área total (ha) *<input type="number" min="0" step="0.0001" value={propertyForm.areaHa} onChange={(event) => setPropertyForm({ ...propertyForm, areaHa: event.target.value })} />{sicarLookup?.automaticImport && <small className="field-source success">✓ Área oficial carregada automaticamente</small>}</label>
              <label>Vegetação nativa (ha)<input type="number" min="0" step="0.0001" value={propertyForm.nativeAreaHa} onChange={(event) => setPropertyForm({ ...propertyForm, nativeAreaHa: event.target.value })} />{sicarLookup?.automaticImport && <small className={`field-source ${sicarLookup.nativeAreaAvailable ? "success" : "warning"}`}>{sicarLookup.nativeAreaAvailable ? "✓ Área temática carregada pelo SICAR" : "! Não disponível no WFS público — preencher pelo Demonstrativo CAR"}</small>}</label>
            </div>
            <label className={`file-drop ${geometry ? "ready" : ""}`}>
              <input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={handleGeoFile} />
              <span>{geometry ? "✓" : "↑"}</span>
              <b>{geometry ? (sicarLookup?.automaticImport ? "Geometria recebida do SICAR" : "GeoJSON validado") : "Selecionar arquivo GeoJSON"}</b>
              <small>{geoFileName || "Fallback manual · Polygon ou MultiPolygon · máximo 1,5 MB"}</small>
            </label>
            <label className="forest-consent">
              <input type="checkbox" checked={sourceConsent} onChange={(event) => setSourceConsent(event.target.checked)} />
              <span><b>Confirmo a origem e a autorização de uso dos dados</b><small>Os dados públicos foram conferidos no SICAR ou os documentos e a geometria foram fornecidos/autorizados pelo titular ou fornecedor responsável.</small></span>
            </label>
            <button className="primary drawer-submit" disabled={savingProperty} onClick={saveProperty}>
              {savingProperty ? "Salvando…" : editingPropertyId ? "Salvar alterações da floresta →" : "Salvar floresta e desenhar no mapa →"}
            </button>
          </aside>
        </div>
      )}

      {forestDetailProperty && (() => {
        const property = forestDetailProperty;
        const propertyDocuments = forestDocuments.filter((document) => document.propertyCarCode === property.id);
        const linkedOperations = operations.filter((operation) => parsePropertyIds(operation.propertyIds).includes(property.id));
        const hasDemonstrativo = propertyDocuments.some((document) => document.category === "Demonstrativo CAR");
        return <div className="overlay forest-detail-overlay" role="presentation" onMouseDown={() => setForestDetailProperty(null)}>
          <section className="forest-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="forest-detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><p className="eyebrow">FICHA MESTRE DO IMÓVEL · CAR/SICAR</p><h2 id="forest-detail-title">{property.name}</h2><p>{property.id} · {property.city}</p></div>
              <div><span className={`property-status ${property.risk}`}>{property.status}</span><button aria-label="Fechar ficha CAR" onClick={() => setForestDetailProperty(null)}>×</button></div>
            </header>
            <div className="forest-detail-body">
              <section className="forest-detail-map-card">
                <div className="forest-detail-map">
                  {property.geometry?.length ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`Polígono CAR de ${property.name}`}><polygon points={toMapPoints(property.geometry)} /></svg> : <span>Geometria CAR não informada</span>}
                  <i>N ↑</i><small>Geometria cadastrada no imóvel CAR</small>
                </div>
                <div className="forest-detail-readiness">
                  <span className="complete">✓ Cadastro CAR</span><span className={property.geometry?.length ? "complete" : "pending"}>{property.geometry?.length ? "✓ Geometria" : "! Geometria"}</span><span className={hasDemonstrativo ? "complete" : "pending"}>{hasDemonstrativo ? "✓ Demonstrativo SICAR" : "! Demonstrativo pendente"}</span>
                </div>
              </section>
              <section className="forest-detail-data">
                <h3>Identificação e rastreabilidade</h3>
                <dl><div><dt>Código CAR</dt><dd>{property.id}</dd></div><div><dt>Situação SICAR</dt><dd>{property.status}</dd></div><div><dt>Município / UF</dt><dd>{property.city}</dd></div><div><dt>Fornecedor responsável</dt><dd>{property.supplier}</dd></div><div><dt>Área total</dt><dd>{property.area}</dd></div><div><dt>Vegetação nativa</dt><dd>{property.native}</dd></div><div className="wide"><dt>Fonte / última atualização</dt><dd>{property.source || "Cadastro manual"}{property.checkedAt && <small>{formatDate(property.checkedAt)}</small>}</dd></div></dl>
              </section>
              <SicarValidationTrail
                carCode={property.id}
                located={Boolean(property.geometry?.length)}
                validated={Boolean(property.source?.includes("SICAR"))}
                officialDocument={hasDemonstrativo}
                onNotice={showNotice}
                onAttach={() => {
                  setForestDetailProperty(null);
                  setSelectedProperty(property);
                  setForestDocCategory("Demonstrativo CAR");
                  window.setTimeout(() => document.querySelector(".forest-dossier")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
                }}
              />
              <section className="forest-detail-block">
                <div className="forest-detail-title"><div><p className="eyebrow">DOCUMENTOS CAR</p><h3>Evidências do imóvel</h3></div><strong>{propertyDocuments.length}</strong></div>
                <div className="forest-detail-documents">{propertyDocuments.map((document) => <article key={document.id}><span>{fileIcon(document.fileName)}</span><div><b>{document.fileName}</b><small>{document.category} · {formatBytes(document.sizeBytes)} · {formatDate(document.uploadedAt)}</small></div><button onClick={() => openSecureDocument(document.id, "forest")} title="Baixar documento">↓</button></article>)}{!propertyDocuments.length && <p>Nenhum documento anexado a este imóvel.</p>}</div>
              </section>
              <section className="forest-detail-block">
                <div className="forest-detail-title"><div><p className="eyebrow">PROCESSOS EUDR</p><h3>Onde esta floresta está sendo utilizada</h3></div><strong>{linkedOperations.length}</strong></div>
                <div className="forest-detail-processes">{linkedOperations.map((operation) => <button key={operation.id} onClick={() => { setForestDetailProperty(null); setDetailOperation(operation); }}><b>{operation.reference}</b><span>{operation.product} · {operation.destinationCountry}</span><em>Abrir processo →</em></button>)}{!linkedOperations.length && <p>Este imóvel ainda não está vinculado a nenhum Processo EUDR.</p>}</div>
              </section>
            </div>
            <footer>
              <button disabled={forestActionId === property.id} onClick={() => refreshForestFromSicar(property)}>{forestActionId === property.id ? "Atualizando…" : "Atualizar dados SICAR"}</button>
              <button onClick={() => editForestProperty(property)}>Editar cadastro</button>
              <button onClick={() => downloadPropertyGeoJson(property)}>Baixar GeoJSON</button>
              <a href={`/api/forest-dossier?carCode=${encodeURIComponent(property.id)}`}>Gerar Dossiê do Imóvel PDF ↓</a>
            </footer>
          </section>
        </div>;
      })()}

      {notice && <div className="toast" role="status">✓ {notice}</div>}
    </main>
  );

  async function prepareSicarLookup(query: string, stateHint = "") {
    const trimmed = query.trim();
    if (!trimmed) {
      showNotice("Digite um CAR, uma coordenada ou uma posição UTM.");
      return;
    }
    const normalizedCar = trimmed.toUpperCase().replaceAll(/\s+/g, "").replaceAll(".", "");
    const isCarQuery = /^[A-Z]{2}-\d{7}-[A-F0-9]{32}$/.test(normalizedCar);
    const parsedGeo = isCarQuery ? null : parseGeographicInput(trimmed);
    if (parsedGeo?.kind === "unknown") {
      showNotice(parsedGeo.error);
      return;
    }
    if (!isCarQuery && !stateHint) {
      showNotice("Selecione a UF do imóvel para localizar o ponto no SICAR.");
      return;
    }
    setSicarLookupLoading(true);
    try {
      let data: SicarLookupResult;
      try {
        const response = await fetch("/api/sicar-lookup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: trimmed, state: stateHint }),
        });
        const candidate = await response.json() as SicarLookupResult & { error?: string };
        if (!response.ok) throw new Error(candidate.error || "Consulta SICAR indisponível.");
        data = candidate;
      } catch {
        data = await querySicarDirect(trimmed, stateHint);
      }
      setSicarLookup(data);
      setCarSearch(data.carCode);
      setSicarStateHint(data.state);
      setPropertyForm((current) => ({
        ...current,
        carCode: data.carCode,
        name: data.propertyName || `Imóvel CAR · ${data.municipality || data.municipalityCode || data.state}`,
        city: data.municipality ? `${data.municipality}/${data.state}` : `${data.municipalityCode || "Município não informado"}/${data.state}`,
        areaHa: Number.isFinite(data.areaHa) && Number(data.areaHa) > 0 ? String(data.areaHa) : "",
        nativeAreaHa: data.nativeAreaAvailable && Number.isFinite(data.nativeAreaHa) ? String(data.nativeAreaHa) : "",
      }));
      if (data.geometry) {
        setGeometry({
          type: "Feature",
          properties: { carCode: data.carCode, source: data.source, checkedAt: data.checkedAt },
          geometry: data.geometry,
        });
        setGeoFileName(`SICAR-${data.carCode}.geojson`);
      }
      setSourceConsent(false);
      setImportOpen(true);
      showNotice(data.inputFormat === "utm" ? "UTM convertida e imóvel CAR localizado." : data.inputType === "coordinates" ? "Imóvel CAR localizado pela coordenada." : "Imóvel CAR localizado e geometria carregada.");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao consultar o SICAR.");
    } finally {
      setSicarLookupLoading(false);
    }
  }

  function handleGeoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      showNotice("O arquivo excede 1,5 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const coords = extractPolygon(parsed);
        if (coords.length < 4) throw new Error("Polígono inválido");
        setGeometry(parsed);
        setGeoFileName(file.name);
      } catch {
        setGeometry(null);
        setGeoFileName("");
        showNotice("GeoJSON inválido: envie um Polygon ou MultiPolygon.");
      }
    };
    reader.readAsText(file);
  }

  function downloadPropertyGeoJson(property: MapProperty) {
    if (!property.geometry?.length) {
      showNotice("Esta floresta ainda não possui geometria disponível.");
      return;
    }
    const feature = {
      type: "Feature",
      properties: {
        carCode: property.id,
        name: property.name,
        city: property.city,
        supplier: property.supplier,
        area: property.area,
      },
      geometry: { type: "Polygon", coordinates: [property.geometry] },
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(feature, null, 2)], { type: "application/geo+json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = property.id.replaceAll(/[^A-Za-z0-9_-]/g, "_") + ".geojson";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    showNotice("GeoJSON preparado para download.");
  }

  async function uploadForestDocuments(files: File[]) {
    if (!selectedProperty || !files.length) return;
    setForestDocUploading(true);
    let uploaded = 0;
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("carCode", selectedProperty.id);
        form.append("category", forestDocCategory);
        form.append("notes", forestDocNotes);
        form.append("source", selectedProperty.source?.includes("SICAR") ? "SICAR / documento conferido" : "Fornecido pelo responsável");
        form.append("file", file);
        const response = await fetch("/api/forest-documents", { method: "POST", body: form });
        const data = await response.json() as { document?: ForestDocumentRecord; error?: string };
        if (!response.ok || !data.document) throw new Error(data.error || `Falha ao enviar ${file.name}.`);
        setForestDocuments((current) => [data.document!, ...current]);
        uploaded += 1;
      }
      setForestDocNotes("");
      showNotice(`${uploaded} evidência(s) incluída(s) no dossiê da floresta.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao enviar documentos da floresta.");
    } finally {
      setForestDocUploading(false);
      setForestDocDragging(false);
    }
  }

  async function removeForestDocument(document: ForestDocumentRecord) {
    if (!window.confirm(`Excluir ${document.fileName} do dossiê desta floresta?`)) return;
    const response = await fetch(`/api/forest-documents?id=${document.id}`, { method: "DELETE" });
    if (!response.ok) {
      showNotice("Não foi possível remover o documento da floresta.");
      return;
    }
    setForestDocuments((current) => current.filter((item) => item.id !== document.id));
    showNotice("Documento removido do dossiê da floresta.");
  }

  function editForestProperty(property: MapProperty) {
    setEditingPropertyId(property.id);
    setPropertyForm({ carCode: property.id, name: property.name, city: property.city, supplier: property.supplier, areaHa: String(property.areaHa), nativeAreaHa: String(property.nativeAreaHa) });
    setGeometry(property.geometry?.length ? { type: "Polygon", coordinates: [property.geometry] } : null);
    setGeoFileName(property.geometry?.length ? `CAR-${property.id}.geojson` : "");
    setSicarLookup(null);
    setSourceConsent(true);
    setSelectedProperty(property);
    setForestDetailProperty(null);
    setImportOpen(true);
  }

  async function refreshForestFromSicar(property: MapProperty) {
    setForestActionId(property.id);
    try {
      const lookupResponse = await fetch("/api/sicar-lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ carCode: property.id }) });
      const lookup = await lookupResponse.json() as SicarLookupResult & { error?: string };
      if (!lookupResponse.ok || !lookup.geometry) throw new Error(lookup.error || "Não foi possível atualizar o imóvel no SICAR.");
      const response = await fetch("/api/properties", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({
        carCode: property.id, name: property.name, city: lookup.municipality ? `${lookup.municipality}/${lookup.state}` : property.city, supplier: property.supplier,
        areaHa: Number(lookup.areaHa || property.areaHa), nativeAreaHa: lookup.nativeAreaAvailable ? Number(lookup.nativeAreaHa || 0) : property.nativeAreaHa, geometry: lookup.geometry,
        status: lookup.status || property.status, risk: lookup.statusCode === "AT" ? "baixo" : "atenção",
        sourceFile: `${lookup.source} · ${lookup.checkedAt} · ${lookup.condition || "condição não informada"} · ${lookup.propertyType || "tipo não informado"} · ${Number(lookup.fiscalModules || 0).toLocaleString("pt-BR")} módulos fiscais · atualização automática`,
      }) });
      const data = await response.json() as { property?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.property) throw new Error(data.error || "Não foi possível salvar a atualização SICAR.");
      const updated = { ...mapProperties([data.property])[0], x: property.x, y: property.y };
      setSavedProperties((current) => current.map((item) => item.id === property.id ? updated : item));
      setSelectedProperty(updated);
      setForestDetailProperty((current) => current?.id === property.id ? updated : current);
      showNotice("Floresta atualizada com os dados e a geometria atuais do SICAR.");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao atualizar a floresta.");
    } finally { setForestActionId(""); }
  }

  async function deleteForestProperty(property: MapProperty) {
    const processCount = operations.filter((item) => parsePropertyIds(item.propertyIds).includes(property.id)).length;
    const documentCount = forestDocuments.filter((document) => document.propertyCarCode === property.id).length;
    if (!window.confirm(`Excluir definitivamente ${property.name}?\n\nCAR: ${property.id}\n${processCount} vínculo(s) com processos e ${documentCount} documento(s) também serão desvinculados/removidos.`)) return;
    setForestActionId(property.id);
    try {
      const response = await fetch(`/api/properties?carCode=${encodeURIComponent(property.id)}`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível excluir a floresta.");
      const remaining = savedProperties.filter((item) => item.id !== property.id);
      setSavedProperties(remaining);
      setForestDocuments((current) => current.filter((document) => document.propertyCarCode !== property.id));
      setOperations((current) => current.map((operation) => ({ ...operation, propertyIds: JSON.stringify(parsePropertyIds(operation.propertyIds).filter((id) => id !== property.id)) })));
      if (selectedProperty?.id === property.id) setSelectedProperty(remaining[0] ?? null);
      if (forestDetailProperty?.id === property.id) setForestDetailProperty(null);
      showNotice("Floresta excluída e removida dos vínculos de Processos EUDR.");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao excluir a floresta.");
    } finally { setForestActionId(""); }
  }

  async function saveProperty() {
    if (!geometry || !propertyForm.carCode || !propertyForm.name || !propertyForm.city || !propertyForm.supplier || !propertyForm.areaHa) {
      showNotice("Preencha os campos obrigatórios e selecione um GeoJSON válido.");
      return;
    }
    if (!sourceConsent) {
      showNotice("Confirme a origem e a autorização de uso dos dados.");
      return;
    }
    if (Number(propertyForm.nativeAreaHa || 0) > Number(propertyForm.areaHa)) {
      showNotice("A vegetação nativa não pode exceder a área total.");
      return;
    }
    setSavingProperty(true);
    try {
      const existingProperty = editingPropertyId ? savedProperties.find((item) => item.id === editingPropertyId) : null;
      const response = await fetch("/api/properties", {
        method: editingPropertyId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...propertyForm,
          areaHa: Number(propertyForm.areaHa),
          nativeAreaHa: Number(propertyForm.nativeAreaHa || 0),
          geometry,
          status: sicarLookup?.status || existingProperty?.status || undefined,
          risk: sicarLookup ? (sicarLookup.statusCode === "AT" ? "baixo" : "atenção") : existingProperty?.risk || "atenção",
          sourceFile: sicarLookup
            ? `${sicarLookup.source} · ${sicarLookup.checkedAt} · ${sicarLookup.condition || "condição não informada"} · ${sicarLookup.propertyType || "tipo não informado"} · ${Number(sicarLookup.fiscalModules || 0).toLocaleString("pt-BR")} módulos fiscais · ${geoFileName}`
            : existingProperty?.source || `Fornecido pelo responsável · ${new Date().toISOString()} · ${geoFileName}`,
        }),
      });
      const data = await response.json() as { property?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.property) throw new Error(data.error || "Não foi possível salvar.");
      const property: MapProperty = {
        id: String(data.property.carCode),
        name: String(data.property.name),
        city: String(data.property.city),
        supplier: String(data.property.supplier),
        areaHa: Number(data.property.areaHa),
        nativeAreaHa: Number(data.property.nativeAreaHa),
        area: `${Number(data.property.areaHa).toLocaleString("pt-BR")} ha`,
        native: `${Number(data.property.nativeAreaHa).toLocaleString("pt-BR")} ha`,
        status: String(data.property.status),
        risk: String(data.property.risk),
        x: 50,
        y: 48,
        geometry: extractPolygon(geometry),
        source: String(data.property.sourceFile || "Cadastro manual"),
        checkedAt: String(data.property.createdAt || new Date().toISOString()),
      };
      setSavedProperties((current) => editingPropertyId ? current.map((item) => item.id === editingPropertyId ? { ...property, x: item.x, y: item.y } : item) : [property, ...current]);
      setSelectedProperty(property);
      let forestLinkMessage = "";
      if (forestLinkOperationId && !editingPropertyId) {
        const operation = operations.find((item) => item.id === forestLinkOperationId);
        const currentIds = parsePropertyIds(operation?.propertyIds || "[]");
        if (!currentIds.includes(property.id)) {
          try {
            await persistOperationForestLinks(forestLinkOperationId, [...currentIds, property.id]);
            forestLinkMessage = "Floresta cadastrada e vinculada automaticamente à STAGE 01 do Processo DDS.";
          } catch (linkError) {
            forestLinkMessage = `Floresta cadastrada, mas o vínculo automático falhou: ${linkError instanceof Error ? linkError.message : "tente vincular novamente"}.`;
          }
        }
      }
      setImportOpen(false);
      setEditingPropertyId(null);
      setPropertyForm({ carCode: "", name: "", city: "", supplier: "", areaHa: "", nativeAreaHa: "" });
      setGeometry(null);
      setGeoFileName("");
      setSicarLookup(null);
      setSourceConsent(false);
      showNotice(forestLinkMessage || (editingPropertyId ? "Alterações da floresta salvas." : "Imóvel salvo e desenhado no mapa."));
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao salvar imóvel.");
    } finally {
      setSavingProperty(false);
    }
  }

  async function saveSupplier() {
    setSupplierSaveError("");
    const requiredFields: Array<[keyof SupplierFormData, string]> = [["legalName", "Razão social"], ["taxId", "CNPJ / ID fiscal"], ["country", "País"], ["state", "Estado/UF"], ["city", "Município"], ["contactName", "Responsável"], ["email", "E-mail"]];
    const missing = requiredFields.filter(([field]) => !String(supplierForm[field] ?? "").trim()).map(([, label]) => label);
    if (missing.length) {
      setSupplierImportResult((current) => ({ detected: current?.detected ?? [], missing }));
      const error = `Preencha os campos obrigatórios: ${missing.join(", ")}.`;
      setSupplierSaveError(error);
      showNotice(error);
      return;
    }
    const normalizedSupplier = {
      ...supplierForm,
      legalName: supplierForm.legalName.trim(),
      tradeName: supplierForm.tradeName.trim(),
      taxId: normalizeTaxId(supplierForm.taxId),
      country: supplierForm.country.trim(),
      state: supplierForm.state.trim().toUpperCase(),
      city: supplierForm.city.trim(),
      contactName: supplierForm.contactName.trim(),
      email: supplierForm.email.trim().toLowerCase(),
      phone: supplierForm.phone.trim(),
    };
    if (isBrazil(normalizedSupplier.country) && !isValidBrazilianCnpj(normalizedSupplier.taxId)) {
      const error = "Informe um CNPJ brasileiro válido com 14 dígitos.";
      setSupplierSaveError(error);
      showNotice(error);
      return;
    }
    setSavingBase(true);
    try {
      const response = await fetch("/api/suppliers", { method: editingSupplierId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(editingSupplierId ? { ...normalizedSupplier, id: editingSupplierId } : normalizedSupplier) });
      const data = await response.json().catch(() => ({})) as { supplier?: SupplierRecord; error?: string };
      if (!response.ok || !data.supplier) throw new Error(data.error || "Não foi possível salvar o fornecedor. Verifique sua conexão e tente novamente.");
      setSuppliers((current) => editingSupplierId ? current.map((item) => item.id === editingSupplierId ? data.supplier! : item) : [data.supplier!, ...current]);
      const wasEditing = editingSupplierId !== null;
      setEditingSupplierId(null);
      setSupplierForm({ legalName: "", tradeName: "", taxId: "", country: "Brasil", state: "SC", city: "", contactName: "", email: "", phone: "", certifications: "Sem certificação", aliases: "", products: "", productionUnits: "", bankDetails: "" });
      setSupplierRawData("");
      setSupplierImportResult(null);
      if (wasEditing) {
        setDrawer(null);
        showNotice("Cadastro mestre do fornecedor atualizado e confirmado.");
      } else if (supplierOpenedFromOperation) {
        setOperationForm((current) => ({
          ...current,
          supplierId: String(data.supplier!.id),
          exporterName: current.exporterName.trim() ? current.exporterName : data.supplier!.legalName,
          exporterTaxId: current.exporterName.trim() ? current.exporterTaxId : data.supplier!.taxId,
          productionLocation: supplierLocation(data.supplier!),
        }));
        setOperationErrors((current) => {
          const next = { ...current };
          delete next.supplierId;
          return next;
        });
        setSupplierOpenedFromOperation(false);
        setDrawer("operation");
        showNotice("Fornecedor salvo e vinculado ao processo.");
      } else if (supplierOpenedFromForest) {
        setPropertyForm((current) => ({ ...current, supplier: data.supplier!.legalName }));
        setSupplierOpenedFromForest(false);
        setDrawer(null);
        setImportOpen(true);
        showNotice("Fornecedor salvo e vinculado ao cadastro da floresta.");
      } else {
        setDrawer(null);
        setActive("Fornecedores");
        showNotice("Fornecedor salvo e disponível para novas operações.");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Falha ao salvar fornecedor.";
      setSupplierSaveError(errorMessage);
      showNotice(errorMessage);
    } finally {
      setSavingBase(false);
    }
  }

  function fillSupplierFromPastedData(raw = supplierRawData) {
    if (!raw.trim()) {
      showNotice("Cole os dados do fornecedor para iniciar o preenchimento automático.");
      return;
    }
    const result = parseSupplierPastedData(raw, supplierForm);
    setSupplierForm(result.form);
    setSupplierImportResult({ detected: result.detected, missing: result.missing });
    if (result.detected.length) showNotice(`${result.detected.length} campo(s) preenchido(s) automaticamente. Revise antes de salvar.`);
    else showNotice("Não foi possível reconhecer os dados. Use rótulos como Razão social, CNPJ, Município/UF, Responsável e E-mail.");
  }

  async function saveOperation() {
    const requiredFields: Array<[keyof typeof emptyOperationForm, string]> = [
      ["supplierId", "Fornecedor principal"],
      ["euImporter", "Importador / operador europeu"],
    ];
    const missing = Object.fromEntries(requiredFields.filter(([field]) => !String(operationForm[field] ?? "").trim()).map(([field, label]) => [field, label]));
    if (Object.keys(missing).length) {
      setOperationErrors(missing);
      const firstField = Object.keys(missing)[0];
      showNotice(`Preencha: ${Object.values(missing).join(", ")}.`);
      window.setTimeout(() => {
        const element = document.querySelector(`[data-operation-field="${firstField}"]`) as HTMLElement | null;
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
        element?.focus();
      }, 50);
      return;
    }
    setOperationErrors({});
    setOperationSaveError("");
    if (Number(operationForm.netWeightKg || 0) > Number(operationForm.grossWeightKg || 0) && Number(operationForm.grossWeightKg || 0) > 0) {
      showNotice("O peso líquido não pode exceder o peso bruto.");
      return;
    }
    setSavingBase(true);
    try {
      const response = await fetch("/api/operations", { method: editingOperationId ? "PUT" : "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ ...operationForm, id: editingOperationId }) });
      const data = await response.json().catch(() => ({})) as { operation?: OperationRecord; error?: string };
      if (!response.ok || !data.operation) throw new Error(data.error || "Não foi possível salvar a operação.");
      const confirmation = await fetch(`/api/operations?t=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
      const confirmationData = await confirmation.json().catch(() => ({})) as { operations?: OperationRecord[]; error?: string };
      const persisted = confirmationData.operations?.find((item) => item.id === data.operation!.id);
      if (!confirmation.ok || !persisted) throw new Error(confirmationData.error || "O backend não confirmou a persistência da operação.");
      setOperations(confirmationData.operations!);
      setOperationForm({ ...emptyOperationForm });
      setDrawer(null);
      setEditingOperationId(null);
      setActive("Processos");
      setDetailOperation(persisted);
      showNotice(editingOperationId ? "Operação atualizada e confirmada no banco." : "Operação salva com sucesso e confirmada no banco.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Falha ao salvar operação.";
      setOperationSaveError(errorMessage);
      showNotice(errorMessage);
    } finally {
      setSavingBase(false);
    }
  }

}

function extractPolygon(input: unknown): number[][] {
  const value = input as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[] };
  if (value?.type === "FeatureCollection" && Array.isArray(value.features) && value.features[0]) return extractPolygon(value.features[0]);
  if (value?.type === "Feature" && value.geometry) return extractPolygon(value.geometry);
  if (value?.type === "Polygon" && Array.isArray(value.coordinates)) return validRing((value.coordinates[0] as number[][]) ?? []);
  if (value?.type === "MultiPolygon" && Array.isArray(value.coordinates)) return validRing((value.coordinates[0] as number[][][])[0] ?? []);
  return [];
}

function validRing(coords: number[][]) {
  return coords.filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))).map(([x, y]) => [Number(x), Number(y)]);
}

function toMapPoints(coords: number[][]) {
  if (!coords.length) return "";
  const xs = coords.map((point) => Number(point[0]));
  const ys = coords.map((point) => Number(point[1]));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  return coords.map(([x, y]) => `${18 + ((x - minX) / spanX) * 64},${82 - ((y - minY) / spanY) * 64}`).join(" ");
}

function toSatelliteMapPoints(coords: number[][]) {
  if (!coords.length) return "";
  const projected = coords.map(([longitude, latitude]) => {
    const limitedLatitude = Math.max(-85.05112878, Math.min(85.05112878, Number(latitude)));
    return [
      Number(longitude) * 20037508.342789244 / 180,
      Math.log(Math.tan((90 + limitedLatitude) * Math.PI / 360)) / (Math.PI / 180) * 20037508.342789244 / 180,
    ];
  });
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const rawMinX = Math.min(...xs), rawMaxX = Math.max(...xs), rawMinY = Math.min(...ys), rawMaxY = Math.max(...ys);
  const paddedWidth = Math.max(rawMaxX - rawMinX, 1) * 1.22;
  const paddedHeight = Math.max(rawMaxY - rawMinY, 1) * 1.22;
  const targetWidth = 1200, targetHeight = 760, targetAspect = targetWidth / targetHeight;
  const fittedWidth = Math.max(paddedWidth, paddedHeight * targetAspect);
  const fittedHeight = Math.max(paddedHeight, paddedWidth / targetAspect);
  const centreX = (rawMinX + rawMaxX) / 2, centreY = (rawMinY + rawMaxY) / 2;
  const minX = centreX - fittedWidth / 2, minY = centreY - fittedHeight / 2;
  return projected.map(([x, y]) => `${((x - minX) / fittedWidth) * targetWidth},${targetHeight - ((y - minY) / fittedHeight) * targetHeight}`).join(" ");
}

function totalArea(items: MapProperty[]) {
  const value = items.reduce((sum, item) => sum + Number(item.area.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "")), 0);
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function uniqueValues(values: string[]) {
  const cleaned = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  return [...new Set(cleaned)].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function parsePropertyIds(value: string) {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function HistoryDatalist({ id, values }: { id: string; values: string[] }) {
  return <datalist id={id}>{values.map((value) => <option key={value} value={value} />)}</datalist>;
}

function Kpi({ icon, value, label, note, critical = false }: { icon: string; value: string; label: string; note: string; critical?: boolean }) {
  return (
    <article className={`kpi-card ${critical ? "critical-card" : ""}`}>
      <span className="kpi-icon">{icon}</span>
      <div><strong>{value}</strong><span>{label}</span></div>
      <p>{note}</p>
    </article>
  );
}

function ModuleHeader({ eyebrow, title, description, action, onAction }: { eyebrow: string; title: string; description: string; action: string; onAction: () => void }) {
  return (
    <header className="module-header">
      <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div>
      <button className="primary" onClick={onAction}>{action} <span>＋</span></button>
    </header>
  );
}

const moduleData = {
  Processos: {
    eyebrow: "EXPORT ORDER CONTROL", title: "Pedidos & Processos de Exportação", description: "Acompanhe pedido, produção, qualidade, documentos, embarque, tracking e entrega — com EUDR integrado.", action: "Novo processo",
    stats: [["0", "processos cadastrados"], ["0", "prontos para embarque"], ["0", "em validação"], ["0", "bloqueados"]],
    columns: ["Referência", "Produto / destino", "Fornecedor principal", "Prontidão", "Status"],
    rows: [],
  },
  Fornecedores: {
    eyebrow: "CADEIA DE FORNECIMENTO", title: "Fornecedores", description: "Centralize homologação, certificações, propriedades de origem e desempenho documental.", action: "Cadastrar fornecedor",
    stats: [["0", "fornecedores"], ["0", "homologados"], ["0", "com pendências EUDR"], ["0", "bloqueados"]],
    columns: ["Fornecedor", "Localização", "Certificações", "Imóveis CAR", "Status"],
    rows: [],
  },
  Riscos: {
    eyebrow: "MATRIZ DE RISCO", title: "Riscos e mitigação", description: "Registre não conformidades, evidências complementares e decisões de liberação.", action: "Nova avaliação",
    stats: [["0", "riscos críticos"], ["0", "atenções"], ["0", "mitigados"], ["0%", "risco controlado"]],
    columns: ["Risco identificado", "Origem", "Impacto", "Responsável", "Tratamento"],
    rows: [],
  },
} as const;

const emptyClient = { legalName:"", aliases:"", taxId:"", taxIdType:"VAT", eori:"", address:"", city:"", state:"", postalCode:"", country:"", contactName:"", email:"", phone:"", preferredPort:"", paymentTerms:"", documentRequirements:"", dataStatus:"Verificado" };
function ImporterClientsModule({ showNotice, onClientsChange }: { showNotice:(message:string)=>void; onClientsChange:(clients:ImporterClientRecord[])=>void }) {
  const [items,setItems]=useState<ImporterClientRecord[]>([]); const [form,setForm]=useState(emptyClient); const [editing,setEditing]=useState<number|null>(null); const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false); const [error,setError]=useState("");
  const load=async()=>{const response=await fetch(`/api/importer-clients?t=${Date.now()}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});const data=await response.json().catch(()=>({})) as {clients?:ImporterClientRecord[];error?:string};if(!response.ok)throw new Error(data.error||"Não foi possível carregar os clientes.");const clients=data.clients??[];setItems(clients);onClientsChange(clients);setLoading(false);return clients;};
  useEffect(()=>{const timer=window.setTimeout(()=>{void load();},0);return()=>window.clearTimeout(timer);},[]);
  const save=async()=>{setError("");if(!form.legalName.trim()||!form.country.trim()){const message="Preencha Razão Social e País. O Tax ID é obrigatório somente quando aplicável.";setError(message);showNotice(message);return;}setSaving(true);try{const response=await fetch("/api/importer-clients",{method:editing?"PUT":"POST",headers:{"content-type":"application/json"},cache:"no-store",body:JSON.stringify(editing?{...form,id:editing}:form)});const raw=await response.text();let data:{client?:ImporterClientRecord;error?:string;action?:string}={};try{data=raw?JSON.parse(raw):{};}catch{throw new Error(`O servidor devolveu uma resposta inválida (HTTP ${response.status}).`);}if(!response.ok||!data.client)throw new Error(data.error||`Falha ao salvar cliente (HTTP ${response.status}).`);const confirmed=await load();if(!confirmed.some(item=>item.id===data.client!.id))throw new Error("O backend não confirmou a persistência do cliente.");setForm(emptyClient);setEditing(null);showNotice(data.action==="updated_existing"?"Cliente já existente identificado, atualizado e confirmado no Cadastro Mestre.":"Cliente importador salvo e confirmado no Cadastro Mestre.");}catch(caught){const message=caught instanceof Error?caught.message:"Falha ao salvar cliente.";setError(message);showNotice(message);}finally{setSaving(false);}};
  const edit=(item:ImporterClientRecord)=>{setEditing(item.id);setForm({legalName:item.legalName,aliases:item.aliases,taxId:item.taxId,taxIdType:item.taxIdType,eori:item.eori,address:item.address,city:item.city,state:item.state,postalCode:item.postalCode,country:item.country,contactName:item.contactName,email:item.email,phone:item.phone,preferredPort:item.preferredPort,paymentTerms:item.paymentTerms,documentRequirements:item.documentRequirements,dataStatus:item.dataStatus});};
  return <section className="master-data-page"><header className="master-data-header"><div><p className="eyebrow">FASE 01 · CADASTRO MESTRE</p><h2>Clientes Importadores</h2><p>Identidade fiscal, contatos, logística, pagamento e requisitos documentais reutilizáveis.</p></div><span>{items.length} clientes</span></header><div className="master-data-grid"><article className="panel master-form"><h3>{editing?"Editar cliente":"Cadastrar cliente importador"}</h3>{error&&<div className="operation-validation-summary" role="alert"><strong>Não foi possível salvar:</strong><span>{error}</span></div>}<div className="form-grid">
    <label className="form-span">Razão social *<input value={form.legalName} onChange={e=>setForm({...form,legalName:e.target.value})}/></label><label>Tipo fiscal<select value={form.taxIdType} onChange={e=>setForm({...form,taxIdType:e.target.value})}><option>VAT</option><option>GST</option><option>Tax ID</option><option>CNPJ</option></select></label><label>Número fiscal (quando aplicável)<input value={form.taxId} onChange={e=>setForm({...form,taxId:e.target.value})}/></label><label>EORI<input value={form.eori} onChange={e=>setForm({...form,eori:e.target.value})}/></label><label>País *<input value={form.country} onChange={e=>setForm({...form,country:e.target.value})}/></label><label className="form-span">Aliases<input value={form.aliases} onChange={e=>setForm({...form,aliases:e.target.value})} placeholder="Nomes usados no Asana, e-mails ou documentos"/></label><label className="form-span">Endereço<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label><label>Cidade<input value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/></label><label>Estado/Região<input value={form.state} onChange={e=>setForm({...form,state:e.target.value})}/></label><label>CEP/Postcode<input value={form.postalCode} onChange={e=>setForm({...form,postalCode:e.target.value})}/></label><label>Contato<input value={form.contactName} onChange={e=>setForm({...form,contactName:e.target.value})}/></label><label>E-mail<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Telefone<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Porto preferencial<input value={form.preferredPort} onChange={e=>setForm({...form,preferredPort:e.target.value})}/></label><label>Condição de pagamento<input value={form.paymentTerms} onChange={e=>setForm({...form,paymentTerms:e.target.value})}/></label><label>Status do dado<select value={form.dataStatus} onChange={e=>setForm({...form,dataStatus:e.target.value})}><option>Verificado</option><option>Importado</option><option>Pendente</option></select></label><label className="form-span">Requisitos documentais por cliente/país<textarea value={form.documentRequirements} onChange={e=>setForm({...form,documentRequirements:e.target.value})} placeholder="COO, Phyto, FSC, packing list, exigências de idioma, legalização..."/></label></div><div className="master-form-actions"><button className="primary" disabled={saving} onClick={save}>{saving?"Confirmando…":editing?"Salvar alterações":"Salvar cliente"}</button>{editing&&<button disabled={saving} onClick={()=>{setEditing(null);setForm(emptyClient);setError("");}}>Cancelar</button>}</div></article>
    <article className="panel master-list"><h3>Base consolidada</h3>{loading?<p>Carregando…</p>:items.map(item=><button key={item.id} onClick={()=>edit(item)}><div><b>{item.legalName}</b><span>{item.country} · {item.taxIdType} {item.taxId||"pendente"}</span></div><em className={`data-status ${item.dataStatus.toLowerCase()}`}>{item.dataStatus}</em><strong>Editar ✎</strong></button>)}{!loading&&!items.length&&<p>Nenhum cliente cadastrado.</p>}</article></div></section>;
}

const emptyProduct={name:"",rawMaterial:"",species:"",scientificName:"",hsCode:"",dimensionalSpecification:"",grade:"",kd:false,ht:false,moisture:"",certifications:"",originType:"Reflorestamento",eligibleSupplierIds:[] as number[],dataStatus:"Verificado"};
function MasterProductsModule({ suppliers,showNotice,onProductsChange }:{suppliers:SupplierRecord[];showNotice:(message:string)=>void;onProductsChange:(products:MasterProductRecord[])=>void}){
  const [items,setItems]=useState<MasterProductRecord[]>([]);const [form,setForm]=useState(emptyProduct);const [editing,setEditing]=useState<number|null>(null);const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [error,setError]=useState("");
  const load=async()=>{const response=await fetch(`/api/master-products?t=${Date.now()}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});const data=await response.json().catch(()=>({})) as {products?:MasterProductRecord[];error?:string};if(!response.ok)throw new Error(data.error||"Não foi possível carregar os produtos.");const products=data.products??[];setItems(products);onProductsChange(products);setLoading(false);return products;};useEffect(()=>{const timer=window.setTimeout(()=>{void load();},0);return()=>window.clearTimeout(timer);},[]);
  const save=async()=>{setError("");if(!form.name.trim()||!form.rawMaterial.trim()||!form.hsCode.trim()){const message="Preencha Produto, matéria-prima e NCM/HS. Os demais campos são opcionais.";setError(message);showNotice(message);return;}setSaving(true);try{const response=await fetch("/api/master-products",{method:editing?"PUT":"POST",headers:{"content-type":"application/json"},cache:"no-store",body:JSON.stringify(editing?{...form,id:editing}:form)});const raw=await response.text();let data:{product?:MasterProductRecord;error?:string;action?:string}={};try{data=raw?JSON.parse(raw):{};}catch{throw new Error(`O servidor devolveu uma resposta inválida (HTTP ${response.status}).`);}if(!response.ok||!data.product)throw new Error(data.error||`Falha ao salvar produto (HTTP ${response.status}).`);const confirmed=await load();if(!confirmed.some(item=>item.id===data.product!.id))throw new Error("O backend não confirmou a persistência do produto.");setForm(emptyProduct);setEditing(null);showNotice(data.action==="updated_existing"?"Produto já existente identificado, atualizado e confirmado no Cadastro Mestre.":"Produto salvo e confirmado no Cadastro Mestre.");}catch(caught){const message=caught instanceof Error?caught.message:"Falha ao salvar produto.";setError(message);showNotice(message);}finally{setSaving(false);}};
  const edit=(item:MasterProductRecord)=>{let ids:number[]=[];try{ids=JSON.parse(item.eligibleSupplierIds)}catch{ids=[]}setEditing(item.id);setForm({name:item.name,rawMaterial:item.rawMaterial,species:item.species,scientificName:item.scientificName,hsCode:item.hsCode,dimensionalSpecification:item.dimensionalSpecification,grade:item.grade,kd:item.kd,ht:item.ht,moisture:item.moisture,certifications:item.certifications,originType:item.originType,eligibleSupplierIds:ids,dataStatus:item.dataStatus});};
  return <section className="master-data-page"><header className="master-data-header"><div><p className="eyebrow">FASE 01 · CATÁLOGO TÉCNICO</p><h2>Produtos</h2><p>Produto → matéria-prima → espécie → nome científico, com especificações e fornecedores aptos.</p></div><span>{items.length} produtos</span></header><div className="master-data-grid"><article className="panel master-form"><h3>{editing?"Editar produto":"Cadastrar produto"}</h3>{error&&<div className="operation-validation-summary" role="alert"><strong>Não foi possível salvar:</strong><span>{error}</span></div>}<div className="form-grid"><label>Produto *<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>NCM / HS *<input value={form.hsCode} onChange={e=>setForm({...form,hsCode:e.target.value})}/></label><label>Matéria-prima *<input value={form.rawMaterial} onChange={e=>setForm({...form,rawMaterial:e.target.value})}/></label><label>Espécie<input value={form.species} onChange={e=>setForm({...form,species:e.target.value})}/></label><label>Nome científico<input value={form.scientificName} onChange={e=>setForm({...form,scientificName:e.target.value})}/></label><label>Grade<input value={form.grade} onChange={e=>setForm({...form,grade:e.target.value})}/></label><label className="form-span">Especificação dimensional<input value={form.dimensionalSpecification} onChange={e=>setForm({...form,dimensionalSpecification:e.target.value})} placeholder="Ex.: 19 × 89 × 2440 mm; tolerância -1/+1 mm"/></label><label>Umidade<input value={form.moisture} onChange={e=>setForm({...form,moisture:e.target.value})} placeholder="Ex.: 12–16%"/></label><label>Certificações<input value={form.certifications} onChange={e=>setForm({...form,certifications:e.target.value})}/></label><label>Tipo de origem<select value={form.originType} onChange={e=>setForm({...form,originType:e.target.value})}><option>Reflorestamento</option><option>Plantação</option><option>Floresta natural</option><option>Reciclado</option><option>Mista</option></select></label><label>Status do dado<select value={form.dataStatus} onChange={e=>setForm({...form,dataStatus:e.target.value})}><option>Verificado</option><option>Importado</option><option>Pendente</option></select></label><label className="check-inline"><input type="checkbox" checked={form.kd} onChange={e=>setForm({...form,kd:e.target.checked})}/> KD</label><label className="check-inline"><input type="checkbox" checked={form.ht} onChange={e=>setForm({...form,ht:e.target.checked})}/> HT</label><fieldset className="form-span supplier-eligibility"><legend>Fornecedores aptos</legend>{suppliers.map(s=><label key={s.id}><input type="checkbox" checked={form.eligibleSupplierIds.includes(s.id)} onChange={()=>setForm({...form,eligibleSupplierIds:form.eligibleSupplierIds.includes(s.id)?form.eligibleSupplierIds.filter(id=>id!==s.id):[...form.eligibleSupplierIds,s.id]})}/>{s.legalName}</label>)}</fieldset></div><div className="master-form-actions"><button className="primary" disabled={saving} onClick={save}>{saving?"Confirmando…":editing?"Salvar alterações":"Salvar produto"}</button>{editing&&<button disabled={saving} onClick={()=>{setEditing(null);setForm(emptyProduct);setError("");}}>Cancelar</button>}</div></article><article className="panel master-list"><h3>Catálogo consolidado</h3>{loading?<p>Carregando…</p>:items.map(item=><button key={item.id} onClick={()=>edit(item)}><div><b>{item.name}</b><span>{item.rawMaterial} · {item.species||"espécie pendente"} · HS {item.hsCode}</span></div><em className={`data-status ${item.dataStatus.toLowerCase()}`}>{item.dataStatus}</em><strong>Editar ✎</strong></button>)}{!loading&&!items.length&&<p>Nenhum produto cadastrado.</p>}</article></div></section>;
}

function DeduplicationModule({showNotice}:{showNotice:(message:string)=>void}){const [data,setData]=useState<{queue:Array<{id:number;entityType:string;primaryRecordId:number;possibleDuplicateId:number;reason:string;confidence:number;status:string}>;entities:Record<string,Array<{id:number;legalName?:string;name?:string}>>}|null>(null);const load=()=>fetch(`/api/deduplication?t=${Date.now()}`,{cache:"no-store"}).then(r=>r.json()).then(setData);useEffect(()=>{void load();},[]);const scan=async()=>{const r=await fetch("/api/deduplication",{method:"POST"});const d=await r.json() as {created?:number};await load();showNotice(`${d.created??0} nova(s) possível(is) duplicidade(s) encontrada(s).`);};const decide=async(id:number,status:string)=>{await fetch("/api/deduplication",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({id,status})});await load();};const name=(type:string,id:number)=>{const x=data?.entities?.[type]?.find(item=>item.id===id);return x?.legalName||x?.name||`Registro #${id}`};return <section className="master-data-page"><header className="master-data-header"><div><p className="eyebrow">NORMALIZAÇÃO SEGURA</p><h2>Possíveis duplicidades</h2><p>Aliases e nomes semelhantes são revisados sem excluir ou sobrescrever o histórico antigo.</p></div><button className="primary" onClick={scan}>Analisar cadastros</button></header><article className="panel dedupe-list">{data?.queue.map(item=><div key={item.id}><span>{item.entityType}</span><div><b>{name(item.entityType,item.primaryRecordId)}</b><em>⇄</em><b>{name(item.entityType,item.possibleDuplicateId)}</b><small>{item.reason}</small></div><strong>{Math.round(item.confidence*100)}%</strong><select value={item.status} onChange={e=>void decide(item.id,e.target.value)}><option>Possível duplicidade</option><option>Confirmado</option><option>Não duplicado</option></select></div>)}{data&&!data.queue.length&&<p>Nenhuma possível duplicidade na fila. Execute a análise.</p>}</article></section>}

function ModuleView({
  active, showNotice, openOperation, openSupplier, openSupplierDetails, editSupplier, openOperationDetails, savedOperations, savedSuppliers, savedActions, savedDocuments, savedProperties, onActionsChange, onClientsChange,
}: {
  active: string;
  showNotice: (message: string) => void;
  openOperation: () => void;
  openSupplier: () => void;
  openSupplierDetails: (supplier: SupplierRecord) => void;
  editSupplier: (supplier: SupplierRecord) => void;
  openOperationDetails: (operation: OperationRecord) => void;
  savedOperations: OperationRecord[];
  savedSuppliers: SupplierRecord[];
  savedActions: ExceptionActionRecord[];
  savedDocuments: DocumentRecord[];
  savedProperties: MapProperty[];
  onActionsChange: (actions: ExceptionActionRecord[]) => void;
  onClientsChange: (clients: ImporterClientRecord[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("Todos");
  if (active === "Relatórios") return <ReportsModule operations={savedOperations} openOperationDetails={openOperationDetails} />;
  if (active === "Clientes") return <ImporterClientsModule showNotice={showNotice} onClientsChange={onClientsChange} />;
  if (active === "Produtos") return <MasterProductsModule suppliers={savedSuppliers} showNotice={showNotice} onProductsChange={setMasterProducts} />;
  if (active === "Duplicidades") return <DeduplicationModule showNotice={showNotice} />;
  if (active === "Portal Cliente") return <BrazilClientPortal suppliers={savedSuppliers} operations={savedOperations} documents={savedDocuments} properties={savedProperties} actions={savedActions} openOperationDetails={openOperationDetails} showNotice={showNotice} />;
  if (active === "Riscos") return <RisksModule actions={savedActions} operations={savedOperations} openOperationDetails={openOperationDetails} onActionsChange={onActionsChange} />;
  if (active === "Integrações") return <IntegrationsModule />;
  if (active === "Segurança") return <SecurityGovernanceModule />;

  const data = moduleData[active as keyof typeof moduleData] ?? moduleData.Processos;
  const persistedRows: readonly (readonly string[])[] = active === "Processos"
    ? savedOperations.map((item) => [item.reference, `${item.product} · ${item.destinationCountry}`, item.supplierName, `${item.readiness}%`, item.status])
    : active === "Fornecedores"
      ? savedSuppliers.map((item) => [item.legalName, `${item.city}/${item.state}`, item.certifications, "0 imóveis", item.status])
      : [];
  const sourceRows = persistedRows;
  const rows = sourceRows.filter((row) => row.join(" ").toLowerCase().includes(query.toLowerCase()) && (moduleFilter === "Todos" || row.join(" ").includes(moduleFilter)));
  const statuses = active === "Riscos" ? ["Todos", "Crítico", "Alto", "Mitigado"] : active === "Fornecedores" ? ["Todos", "Homologado", "Bloqueado"] : active === "Processos" ? ["Todos", "Cadastro inicial", "Em análise", "Bloqueada"] : ["Todos", "Validado", "Pendente", "Bloqueado"];
  const liveStats = active === "Fornecedores" && savedSuppliers.length
    ? [[String(savedSuppliers.length), "fornecedores cadastrados"], [String(savedSuppliers.filter((item) => item.status === "Homologado").length), "homologados"], [String(savedSuppliers.filter((item) => item.status !== "Bloqueado").length), "ativos"], [String(savedSuppliers.filter((item) => item.status === "Bloqueado").length), "bloqueados"]]
    : active === "Processos" && savedOperations.length
      ? [[String(savedOperations.length), "processos cadastrados"], [String(savedOperations.filter((item) => item.readiness >= 90).length), "prontos para embarque"], [String(savedOperations.filter((item) => item.status !== "Bloqueada").length), "em andamento"], [String(savedOperations.filter((item) => item.status === "Bloqueada").length), "bloqueados"]]
      : data.stats;

  function openDetails(row: readonly string[]) {
    if (active === "Processos") {
      const operation = savedOperations.find((item) => item.reference === row[0]);
      if (operation) openOperationDetails(operation);
      else showNotice("Processo não encontrado nos cadastros.");
      return;
    }
    if (active !== "Fornecedores") {
      showNotice(`Registro ${row[0]} carregado.`);
      return;
    }
    const saved = savedSuppliers.find((supplier) => supplier.legalName === row[0]);
    openSupplierDetails(saved ?? {
      id: 0,
      legalName: row[0],
      tradeName: "",
      taxId: "Não informado",
      country: "Brasil",
      state: row[1].split("/")[1] || "",
      city: row[1].split("/")[0] || row[1],
      contactName: "Não informado",
      email: "Não informado",
      phone: "",
      certifications: row[2],
      aliases: "",
      products: "",
      productionUnits: "",
      bankDetails: "",
      status: row[4],
    });
  }

  return (
    <section className="module-page">
      <ModuleHeader eyebrow={data.eyebrow} title={data.title} description={data.description} action={data.action} onAction={active === "Fornecedores" ? openSupplier : openOperation} />
      <div className="module-stats">{liveStats.map(([value, label], index) => <article key={label} className={index === 3 ? "module-stat alert" : "module-stat"}><strong>{value}</strong><span>{label}</span></article>)}</div>
      <article className="panel module-table-panel">
        <div className="module-tools">
          <label>⌕ <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Buscar em ${active.toLowerCase()}…`} /></label>
          <div>{statuses.map((status) => <button key={status} className={moduleFilter === status ? "selected" : ""} onClick={() => setModuleFilter(status)}>{status}</button>)}</div>
        </div>
        <div className="module-table-wrap">
          <table className="module-table">
            <thead><tr>{data.columns.map((column) => <th key={column}>{column}</th>)}<th>Ações</th></tr></thead>
            <tbody>
              {rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={`${row[0]}-${index}`}><span className={index === row.length - 1 ? `table-status ${cell.toLowerCase().replaceAll(" ", "-")}` : ""}>{cell}</span></td>)}<td><button onClick={() => openDetails(row)}>Ver detalhes</button>{active === "Fornecedores" && <button onClick={() => { const supplier = savedSuppliers.find((item) => item.legalName === row[0]); if (supplier) editSupplier(supplier); }}>Editar ✎</button>}</td></tr>)}
              {!rows.length && <tr><td colSpan={data.columns.length + 1} className="empty-table">Nenhum registro encontrado com este filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

const supplyChainChecklist = SUPPLY_CHAIN_STAGES;

const checklistCategoryAliases: Record<string, string[]> = {
  "Floresta · CAR e mapas": ["Forest · CAR and maps", "CAR and maps", "CAR maps", "Geolocation", "Geolocalização"],
  "Floresta · IBAMA e certidões": ["Forest · IBAMA and certificates", "Forest legality", "Legalidade florestal", "Legalidade / DOF", "FSC / PEFC"],
  "Floresta · Invoice / NF": ["Forest · Invoice / Tax invoice", "Forest invoice", "Invoice florestal", "Nota fiscal"],
  "Transporte florestal · documentos": ["Forest transport · documents", "Forest transport documents", "DOF / GF", "CT-e / MDF-e"],
  "Transporte florestal · Invoice": ["Forest transport · Invoice", "Forest transport invoice", "Invoice do transporte"],
  "Planta industrial · cadastro e licenças": ["Industrial plant · registration and licenses", "Industrial plant licenses", "Licenças da planta"],
  "Planta industrial · IBAMA e certidões": ["Industrial plant · IBAMA and certificates", "Plant IBAMA certificates", "IBAMA da planta"],
  "Planta industrial · produção": ["Industrial plant · production", "Industrial production", "Produção / balanço de massa"],
  "Exportação · Invoice industrial": ["Export · Industrial invoice", "Export invoice", "Invoice comercial"],
  "Transporte ao porto · documentos": ["Transport to port · documents", "Transport to port documents"],
  "Porto · embarque e BL": ["Port · shipment and BL", "Port and shipment", "Transporte / BL", "Fitossanitário"],
  "Trading · cadastro e contrato": ["Trading · registration and contract", "Trading registration", "Cadastro do fornecedor", "Contratos"],
  "Trading · Invoice final": ["Trading · Final invoice", "Trading final invoice", "Invoice trading"],
};

function normalizeChecklistCategory(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function documentMatchesChecklist(documentCategory: string, item: (typeof supplyChainChecklist)[number]) {
  const accepted = [item.category, ...item.legacy, ...(checklistCategoryAliases[item.category] ?? [])];
  const normalizedDocument = normalizeChecklistCategory(documentCategory);
  return accepted.some((name) => normalizeChecklistCategory(name) === normalizedDocument);
}

function OperationCommandCenter({ operation, properties, forestDocuments, onClose, onEdit, onManageForests, onReadinessChange, showNotice }: { operation: OperationRecord; properties: MapProperty[]; forestDocuments: ForestDocumentRecord[]; onClose: () => void; onEdit: () => void; onManageForests: () => void; onReadinessChange: (operationId: number, readiness: number) => void; showNotice: (message: string) => void }) {
  const [tab, setTab] = useState<"overview" | "export" | "partners" | "checklist" | "report" | "agents" | "marketplace">("overview");
  const [reportTestMode, setReportTestMode] = useState(true);
  const [reportReviewed, setReportReviewed] = useState(false);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [category, setCategory] = useState("Cadastro do fornecedor");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [stageSettings, setStageSettings] = useState<StageSettingRecord[]>([]);
  const [savingStage, setSavingStage] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [industrialPlanOpen, setIndustrialPlanOpen] = useState(false);
  const [stageDocumentCategory, setStageDocumentCategory] = useState<string | null>(null);
  const [stageDragging, setStageDragging] = useState(false);
  const [agentControl, setAgentControl] = useState<AgentControlData | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);
  const [agentAction, setAgentAction] = useState("");
  const [agentError, setAgentError] = useState("");
  const [savingIndustrialPlan, setSavingIndustrialPlan] = useState(false);
  const [industrialPlan, setIndustrialPlan] = useState({
    periodStart: "", periodEnd: "", receivingLots: "", openingStockKg: "", rawMaterialReceivedKg: "",
    rawMaterialConsumedKg: "", pelletsProducedKg: "", closingStockKg: "", productionLots: "", notes: "", status: "Em elaboração",
  });
  const [partnerForm, setPartnerForm] = useState({ role: "Agente de carga", companyName: "", contactName: "", email: "", country: "Brasil" });

  useEffect(() => {
    const requestOptions: RequestInit = { cache: "no-store", headers: { "Cache-Control": "no-cache" } };
    const fresh = `operationId=${operation.id}&t=${Date.now()}`;
    Promise.allSettled([
      fetch(`/api/documents?${fresh}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`/api/partners?${fresh}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`/api/industrial-plan?${fresh}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`/api/stage-settings?${fresh}`, requestOptions).then((response) => response.ok ? response.json() : Promise.reject()),
    ]).then(([docResult, partnerResult, planResult, stageResult]) => {
      const failures: string[] = [];
      if (docResult.status === "fulfilled") {
        setDocuments(((docResult.value as { documents?: DocumentRecord[] }).documents ?? []));
      } else failures.push("documentos");
      if (partnerResult.status === "fulfilled") {
        setPartners(((partnerResult.value as { partners?: PartnerRecord[] }).partners ?? []));
      } else failures.push("parceiros");
      if (planResult.status === "fulfilled" && (planResult.value as { plan?: IndustrialPlanRecord | null }).plan) {
        const planData = planResult.value as { plan: IndustrialPlanRecord };
        setIndustrialPlan({
        periodStart: planData.plan.periodStart,
        periodEnd: planData.plan.periodEnd,
        receivingLots: planData.plan.receivingLots,
        openingStockKg: String(planData.plan.openingStockKg || ""),
        rawMaterialReceivedKg: String(planData.plan.rawMaterialReceivedKg || ""),
        rawMaterialConsumedKg: String(planData.plan.rawMaterialConsumedKg || ""),
        pelletsProducedKg: String(planData.plan.pelletsProducedKg || ""),
        closingStockKg: String(planData.plan.closingStockKg || ""),
        productionLots: planData.plan.productionLots,
        notes: planData.plan.notes,
        status: planData.plan.status,
        });
      } else if (planResult.status === "rejected") failures.push("plano industrial");
      if (stageResult.status === "fulfilled") {
        setStageSettings(((stageResult.value as { settings?: StageSettingRecord[] }).settings ?? []));
      } else failures.push("configuração das etapas");
      setLoadErrors(failures);
    }).finally(() => setLoading(false));
  }, [operation.id, reloadToken]);

  useEffect(() => {
    let activeRequest = true;
    fetch(`/api/agent-control?operationId=${operation.id}&t=${Date.now()}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as AgentControlData & { error?: string };
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar o Agent Control.");
        if (activeRequest) { setAgentControl(data); setAgentError(""); }
      })
      .catch((error) => { if (activeRequest) setAgentError(error instanceof Error ? error.message : "Agent Control indisponível."); })
      .finally(() => { if (activeRequest) setAgentLoading(false); });
    return () => { activeRequest = false; };
  }, [operation.id, reloadToken]);

  const inactiveStageCategories = new Set(stageSettings.filter((setting) => !setting.enabled).map((setting) => setting.stageCategory));
  const activeChecklist = supplyChainChecklist.filter((item) => !inactiveStageCategories.has(item.category));
  const linkedPropertyIds = parsePropertyIds(operation.propertyIds);
  const linkedProperties = properties.filter((property) => linkedPropertyIds.includes(property.id));
  const linkedForestDocuments = forestDocuments.filter((document) => linkedPropertyIds.includes(document.propertyCarCode));
  const hasGeolocatedOrigin = linkedProperties.some((property) => (property.geometry?.length ?? 0) >= 4);
  const industrialPlanComplete = Boolean(industrialPlan.periodStart && industrialPlan.periodEnd && industrialPlan.receivingLots && industrialPlan.productionLots);
  const completedRequired = activeChecklist.filter((item) =>
    (item.category === "Floresta · CAR e mapas" && hasGeolocatedOrigin)
    || (item.category === "Planta industrial · produção" && industrialPlanComplete)
    || documents.some((document) => documentMatchesChecklist(document.category, item))
  ).length;
  const progress = activeChecklist.length ? Math.round((completedRequired / activeChecklist.length) * 100) : 0;
  const evidenceCount = documents.length + linkedProperties.length + linkedForestDocuments.length;
  const chainParticipantCount = new Set([
    operation.exporterName,
    operation.supplierName,
    operation.productionUnit,
    operation.euImporter,
    ...partners.map((partner) => partner.companyName),
  ].filter(Boolean)).size;
  const readinessSummary = {
    percentage: progress,
    completedStages: completedRequired,
    applicableStages: activeChecklist.length,
    evidenceCount,
    documentCount: documents.length,
    forestDocumentCount: linkedForestDocuments.length,
    carOriginCount: linkedProperties.length,
    participantCount: chainParticipantCount,
  };
  const managedStage = stageDocumentCategory ? supplyChainChecklist.find((item) => item.category === stageDocumentCategory) : undefined;
  const managedStageIndex = managedStage ? supplyChainChecklist.findIndex((item) => item.category === managedStage.category) : -1;
  const managedStageDocuments = managedStage ? documents.filter((document) => documentMatchesChecklist(document.category, managedStage)) : [];
  const managedStageJobs = managedStage ? (agentControl?.jobs ?? []).filter((job) => job.stageCategory === managedStage.category) : [];
  const latestManagedStageJob = managedStageJobs[0];
  const materialAvailable = Number(industrialPlan.openingStockKg || 0) + Number(industrialPlan.rawMaterialReceivedKg || 0);
  const materialAccounted = Number(industrialPlan.rawMaterialConsumedKg || 0) + Number(industrialPlan.closingStockKg || 0);
  const massDifference = materialAvailable - materialAccounted;
  const productionYield = Number(industrialPlan.rawMaterialConsumedKg || 0) > 0 ? (Number(industrialPlan.pelletsProducedKg || 0) / Number(industrialPlan.rawMaterialConsumedKg)) * 100 : 0;
  const eudrSubmissionGaps = [
    !operation.euOperatorEori && "EORI do operador europeu",
    !operation.euImporter && "Operador/importador europeu",
    !hasGeolocatedOrigin && "Geolocalizações das parcelas",
    !industrialPlan.periodStart && "Período de produção",
    !operation.species && "Espécies e nomes científicos",
    completedRequired < activeChecklist.length && "Conclusão das evidências das etapas aplicáveis",
  ].filter(Boolean) as string[];

  useEffect(() => {
    if (loading || operation.readiness === progress) return;
    fetch("/api/operations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: operation.id, readiness: progress }),
    }).then((response) => {
      if (response.ok) onReadinessChange(operation.id, progress);
    }).catch(() => undefined);
  }, [loading, onReadinessChange, operation.id, operation.readiness, progress]);

  async function toggleStage(item: (typeof supplyChainChecklist)[number]) {
    const currentlyEnabled = !inactiveStageCategories.has(item.category);
    setSavingStage(item.category);
    try {
      const response = await fetch("/api/stage-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: operation.id, stageCategory: item.category, enabled: !currentlyEnabled }),
      });
      const data = await response.json() as { setting?: StageSettingRecord; readiness?: number; error?: string };
      if (!response.ok || !data.setting) throw new Error(data.error || "Não foi possível alterar a etapa.");
      setStageSettings((current) => [...current.filter((setting) => setting.stageCategory !== item.category), data.setting!]);
      if (typeof data.readiness === "number") onReadinessChange(operation.id, data.readiness);
      showNotice(currentlyEnabled ? `${item.stage} marcada como não aplicável.` : `${item.stage} reativada no checklist.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao alterar a etapa.");
    } finally {
      setSavingStage("");
    }
  }

  async function saveIndustrialPlan() {
    if (!industrialPlan.periodStart || !industrialPlan.periodEnd || !industrialPlan.receivingLots || !industrialPlan.productionLots) {
      showNotice("Preencha período, lotes recebidos e lotes de pellets.");
      return;
    }
    setSavingIndustrialPlan(true);
    try {
      const response = await fetch("/api/industrial-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: operation.id, ...industrialPlan }),
      });
      const data = await response.json() as { plan?: IndustrialPlanRecord; error?: string };
      if (!response.ok || !data.plan) throw new Error(data.error || "Não foi possível salvar o plano industrial.");
      showNotice("Plano industrial e balanço de massa salvos nesta operação.");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao salvar o plano industrial.");
    } finally {
      setSavingIndustrialPlan(false);
    }
  }

  function generateEudrReport() {
    if (!reportTestMode && !reportReviewed) {
      showNotice("Confirme a revisão dos dados reais antes de gerar o Reviewed Pre-DDS.");
      return;
    }
    const url = `/api/eudr-report?operationId=${operation.id}&attachments=1&lang=en&mode=${reportTestMode ? "test" : "official"}&reviewed=${reportReviewed ? "1" : "0"}`;
    const reportWindow = window.open(url, "_blank");
    if (!reportWindow) {
      window.location.href = url;
      return;
    }
    showNotice("Gerando o relatório EUDR completo em uma nova janela…");
  }

  function applyAgentSnapshot(data: AgentControlData & { error?: string }) {
    if (data.settings && data.services && data.jobs && data.ledger && data.reputation && data.metrics) setAgentControl(data);
  }

  async function requestAgentAnalysis(stageCategory: string, documentId?: number, silent = false) {
    const actionKey = `analyze:${stageCategory}:${documentId ?? "stage"}`;
    setAgentAction(actionKey);
    try {
      const response = await fetch("/api/agent-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "orchestrate", operationId: operation.id, stageCategory, documentId }) });
      const data = await response.json() as AgentControlData & { job?: AgentJobRecord; error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível iniciar a análise.");
      applyAgentSnapshot(data);
      setAgentError("");
      if (!silent) showNotice(data.job?.status === "Simulado" ? "Simulação concluída. Nenhum serviço foi contratado." : data.job?.status === "Concluído" ? "Análise concluída e vinculada à etapa." : "Análise preparada. Aguardando sua aprovação no Agent Control.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao iniciar análise.";
      setAgentError(message);
      if (!silent) showNotice(message);
    } finally { setAgentAction(""); }
  }

  async function decideAgentJob(job: AgentJobRecord, decision: "approve" | "reject") {
    setAgentAction(`${decision}:${job.jobId}`);
    try {
      const response = await fetch("/api/agent-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: decision, operationId: operation.id, jobId: job.jobId, approvedBy: operation.internalResponsible || "Human reviewer" }) });
      const data = await response.json() as AgentControlData & { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível registrar a decisão.");
      applyAgentSnapshot(data);
      showNotice(decision === "approve" ? "Serviço aprovado, executado e registrado no ledger." : "Execução recusada. Nenhum custo foi realizado.");
    } catch (error) { showNotice(error instanceof Error ? error.message : "Falha na decisão do Job."); }
    finally { setAgentAction(""); }
  }

  async function updateAutonomy(level: number) {
    if (!agentControl) return;
    setAgentAction("settings");
    try {
      const response = await fetch("/api/agent-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", operationId: operation.id, autonomyLevel: level, transactionLimit: agentControl.settings.transactionLimit, dailyLimit: agentControl.settings.dailyLimit }) });
      const data = await response.json() as { settings?: AgentSettingsRecord; error?: string };
      if (!response.ok || !data.settings) throw new Error(data.error || "Não foi possível alterar a autonomia.");
      setAgentControl({ ...agentControl, settings: data.settings });
      showNotice(`Autonomia alterada para Nível ${data.settings.autonomyLevel}. A política financeira continua protegida pelos limites e aprovação configurados.`);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Falha ao alterar autonomia."); }
    finally { setAgentAction(""); }
  }

  async function uploadFiles(files: File[], forcedCategory?: string) {
    if (!files.length) return;
    setUploading(true);
    let uploaded = 0;
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("operationId", String(operation.id));
        form.append("category", forcedCategory || category);
        form.append("notes", notes);
        form.append("file", file);
        const response = await fetch("/api/documents", { method: "POST", body: form });
        const data = await response.json() as { document?: DocumentRecord; readiness?: number; error?: string };
        if (!response.ok || !data.document) throw new Error(data.error || `Falha ao enviar ${file.name}.`);
        setDocuments((current) => [data.document!, ...current]);
        if (typeof data.readiness === "number") onReadinessChange(operation.id, data.readiness);
        await requestAgentAnalysis(forcedCategory || category, data.document.id, true);
        uploaded += 1;
      }
      setNotes("");
      showNotice(`${uploaded} arquivo(s) incluído(s). O Orchestrator preparou a análise da respectiva etapa.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha no envio dos arquivos.");
    } finally {
      setUploading(false);
      setStageDragging(false);
    }
  }

  async function removeDocument(document: DocumentRecord) {
    if (!window.confirm(`Excluir ${document.fileName} desta operação?`)) return;
    try {
      const response = await fetch(`/api/documents?id=${document.id}`, { method: "DELETE" });
      const data = await response.json() as { readiness?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível remover o documento.");
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      if (typeof data.readiness === "number") onReadinessChange(operation.id, data.readiness);
      showNotice("Documento removido da operação.");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Não foi possível remover o documento.");
    }
  }

  async function addPartner() {
    const response = await fetch("/api/partners", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId: operation.id, ...partnerForm }) });
    const data = await response.json() as { partner?: PartnerRecord; error?: string };
    if (!response.ok || !data.partner) {
      showNotice(data.error || "Não foi possível incluir o parceiro.");
      return;
    }
    setPartners((current) => [data.partner!, ...current]);
    setPartnerForm({ role: "Agente de carga", companyName: "", contactName: "", email: "", country: "Brasil" });
    showNotice("Parceiro incluído na supply chain.");
  }

  async function removePartner(id: number) {
    const response = await fetch(`/api/partners?id=${id}`, { method: "DELETE" });
    if (response.ok) setPartners((current) => current.filter((item) => item.id !== id));
  }

  return (
    <div className="overlay command-overlay" role="presentation" onMouseDown={onClose}>
      <section className="command-center" role="dialog" aria-modal="true" aria-labelledby="command-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="command-header">
          <div><p className="eyebrow">CENTRO DE COMANDO DA SUPPLY CHAIN</p><h2 id="command-title">{operation.reference}</h2><p>{operation.product} · {operation.hsCode} · {operation.destinationCountry}</p></div>
          <div className="command-header-actions"><span className="table-status cadastro-inicial">{operation.status}</span><button className="command-edit" onClick={onEdit}>Editar operação</button><button aria-label="Fechar centro de comando" onClick={onClose}>×</button></div>
        </header>

        <div className="command-summary">
          <article data-readiness-source="supply-chain-checklist"><span>Prontidão documental</span><strong>{readinessSummary.percentage}%</strong><div><i style={{ width: `${readinessSummary.percentage}%` }} /></div></article>
          <article data-readiness-source="supply-chain-checklist"><span>Evidências vinculadas</span><strong>{readinessSummary.evidenceCount}</strong><small>{readinessSummary.documentCount} do processo · {readinessSummary.forestDocumentCount} da origem · {readinessSummary.carOriginCount} CAR</small></article>
          <article><span>Participantes da cadeia</span><strong>{readinessSummary.participantCount}</strong><small>{partners.length} parceiro(s) adicional(is)</small></article>
          <article><span>Fornecedor principal</span><strong className="summary-name">{operation.supplierName}</strong><small>{operation.euImporter}</small></article>
        </div>

        <nav className="command-tabs" aria-label="Áreas do centro de comando">
          <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Supply chain</button>
          <button className={tab === "export" ? "active" : ""} onClick={() => setTab("export")}>Export Control</button>
          <button className={tab === "partners" ? "active" : ""} onClick={() => setTab("partners")}>Participantes <span>{chainParticipantCount}</span></button>
          <button className={tab === "checklist" ? "active" : ""} onClick={() => setTab("checklist")}>Supply chain checklist <span>{completedRequired}/{activeChecklist.length}</span></button>
          <button className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")}>Agent Control {agentControl?.metrics.awaitingApproval ? <span>{agentControl.metrics.awaitingApproval}</span> : null}</button>
          <button className={tab === "marketplace" ? "active" : ""} onClick={() => setTab("marketplace")}>Agent Marketplace</button>
          <button className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}>Criar relatório EUDR</button>
        </nav>

        <div className="command-body">
          {loading && <div className="command-loading">Carregando dados da operação…</div>}
          {!loading && loadErrors.length > 0 && <div className="command-load-warning">
            <span>!</span>
            <p><b>Alguns dados não carregaram:</b> {loadErrors.join(", ")}. Os demais módulos continuam disponíveis.</p>
            <button onClick={() => { setLoading(true); setLoadErrors([]); setReloadToken((current) => current + 1); }}>Tentar novamente</button>
          </div>}
          {!loading && tab === "export" && <ExportOrderControl operation={operation} documents={documents} uploadFiles={uploadFiles} removeDocument={removeDocument} showNotice={showNotice} onOpenSupplyChain={() => setTab("checklist")} />}
          {!loading && tab === "overview" && <div className="operation-overview">
            <section><h3>Participantes principais</h3><dl>
              <div><dt>Exportador</dt><dd>{operation.exporterName || "Não informado"}<small>{operation.exporterTaxId}</small></dd></div>
              <div><dt>Fornecedor</dt><dd>{operation.supplierName}</dd></div>
              <div><dt>Unidade produtiva</dt><dd>{operation.productionUnit || "Não informada"}<small>{operation.productionLocation}</small></dd></div>
              <div><dt>Operador/importador UE</dt><dd>{operation.euImporter}<small>{operation.euOperatorEori && `EORI: ${operation.euOperatorEori}`}</small></dd></div>
            </dl></section>
            <section><h3>Produto e origem</h3><dl>
              <div><dt>Produto / NCM</dt><dd>{operation.product}<small>{operation.hsCode}</small></dd></div>
              <div><dt>Matéria-prima</dt><dd>{operation.rawMaterial || "Não informada"}<small>{operation.species}</small></dd></div>
              <div><dt>Origem florestal</dt><dd>{operation.forestOriginType || "Não informada"}</dd></div>
              <div><dt>Lotes vinculados</dt><dd>{operation.lotCodes || "Não informados"}</dd></div>
            </dl></section>
            <section className="overview-wide linked-origins"><div className="linked-origins-heading"><div><h3>Origens CAR vinculadas</h3><p>Florestas e imóveis que abastecem esta operação</p></div><strong>{linkedProperties.length}</strong></div>
              <div className="linked-origin-list">
                {linkedProperties.map((property) => <article key={property.id}><span>CAR</span><div><b>{property.name}</b><small>{property.id} · {property.city}</small><small>{property.supplier}</small></div><em>{property.area}</em><a href={`/api/forest-dossier?carCode=${encodeURIComponent(property.id)}`} target="_blank" rel="noreferrer">Baixar dossiê PDF ↓</a></article>)}
                {!linkedProperties.length && <p className="linked-origin-empty">Nenhuma origem CAR vinculada. Edite a supply chain para selecionar uma ou mais florestas.</p>}
              </div>
            </section>
            <section><h3>Quantidade e comercial</h3><dl>
              <div><dt>Quantidade</dt><dd>{operation.quantity || 0} {operation.quantityUnit}</dd></div>
              <div><dt>Peso líquido / bruto</dt><dd>{operation.netWeightKg || 0} / {operation.grossWeightKg || 0} kg</dd></div>
              <div><dt>Volume</dt><dd>{operation.volumeM3 || 0} m³</dd></div>
              <div><dt>Condição</dt><dd>{operation.incoterm} · {operation.currency} {Number(operation.commercialValue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</dd></div>
            </dl></section>
            <section><h3>Logística</h3><dl>
              <div><dt>Modal / transportador</dt><dd>{operation.transportMode}<small>{operation.carrier}</small></dd></div>
              <div><dt>Origem → destino</dt><dd>{operation.portOfLoading || "—"} → {operation.portOfDischarge || operation.destinationCountry}</dd></div>
              <div><dt>Booking / contêineres</dt><dd>{operation.bookingNumber || "Não informado"}<small>{operation.containerNumbers}</small></dd></div>
              <div><dt>Navio / embarque</dt><dd>{operation.vesselVoyage || "Não informado"}<small>{operation.shipmentDate}</small></dd></div>
            </dl></section>
            <section className="overview-wide"><h3>Responsabilidade e EUDR</h3><dl>
              <div><dt>Responsável interno</dt><dd>{operation.internalResponsible}<small>{operation.responsibleEmail}</small></dd></div>
              <div><dt>Contrato / PO</dt><dd>{operation.contractNumber || "Não informado"}</dd></div>
              <div><dt>Referência DDS/EUDR</dt><dd>{operation.eudrReference || "Ainda não emitida"}</dd></div>
              <div><dt>Observações</dt><dd>{operation.supplyChainNotes || "Sem observações"}</dd></div>
            </dl></section>
            <button className="primary overview-edit" onClick={onEdit}>Editar dados completos da supply chain →</button>
          </div>}
          {!loading && tab === "partners" && <>
            <div className="partner-form">
              <label>Tipo de parceiro<select value={partnerForm.role} onChange={(event) => setPartnerForm({ ...partnerForm, role: event.target.value })}><option>Agente de carga</option><option>Despachante aduaneiro</option><option>Transportadora</option><option>Indústria processadora</option><option>Proprietário rural</option><option>Certificadora</option><option>Importador europeu</option><option>Consultor florestal</option><option>Outro</option></select></label>
              <label>Empresa *<input value={partnerForm.companyName} onChange={(event) => setPartnerForm({ ...partnerForm, companyName: event.target.value })} /></label>
              <label>Contato<input value={partnerForm.contactName} onChange={(event) => setPartnerForm({ ...partnerForm, contactName: event.target.value })} /></label>
              <label>E-mail<input type="email" value={partnerForm.email} onChange={(event) => setPartnerForm({ ...partnerForm, email: event.target.value })} /></label>
              <label>País<input value={partnerForm.country} onChange={(event) => setPartnerForm({ ...partnerForm, country: event.target.value })} /></label>
              <button className="primary" onClick={addPartner}>Incluir parceiro ＋</button>
            </div>
            <div className="partner-list">
              {partners.map((partner) => <article key={partner.id}><span className="partner-mark">{initials(partner.companyName)}</span><div><strong>{partner.companyName}</strong><p>{partner.role} · {partner.country}</p><small>{[partner.contactName, partner.email].filter(Boolean).join(" · ") || "Contato não informado"}</small></div><button onClick={() => removePartner(partner.id)}>Remover</button></article>)}
              {!partners.length && <div className="empty-command">Cadastre agentes, transportadoras, indústrias, certificadoras e demais participantes da supply chain.</div>}
            </div>
          </>}

          {!loading && tab === "agents" && <div className="agent-control-view">
            <header className="agent-control-hero"><div><p className="eyebrow">SUPPLY CHAIN ORCHESTRATOR AGENT</p><h3>Agent Control</h3><p>Coordena as 13 etapas, descobre o melhor serviço para cada necessidade e mantém aprovação humana, orçamento e auditoria sob controle.</p></div><span>{agentControl?.settings.autonomyLevel === 0 ? "SIMULATION" : agentControl?.settings.autonomyLevel === 2 ? "LIMITED" : "APPROVAL"}</span></header>
            {agentLoading && <div className="command-loading">Carregando Registry, Jobs e Ledger…</div>}
            {agentError && <div className="agent-error"><b>Agent Control indisponível</b><span>{agentError}</span><button onClick={() => setReloadToken((current) => current + 1)}>Tentar novamente</button></div>}
            {agentControl && <>
              <div className="agent-metrics">
                <article><span>Agentes ativos</span><strong>{agentControl.metrics.activeAgents}</strong><small>Registry interno</small></article>
                <article className={agentControl.metrics.awaitingApproval ? "attention" : ""}><span>Aguardando aprovação</span><strong>{agentControl.metrics.awaitingApproval}</strong><small>decisão humana</small></article>
                <article><span>Jobs executados</span><strong>{agentControl.metrics.jobsExecuted}</strong><small>{agentControl.metrics.jobsPending} pendente(s)</small></article>
                <article><span>Falhas / alertas</span><strong>{agentControl.metrics.failures} / {agentControl.metrics.alerts}</strong><small>monitorados</small></article>
                <article><span>Custo acumulado</span><strong>US$ {agentControl.metrics.cost.toFixed(2)}</strong><small>ledger atual</small></article>
                <article><span>Receita gerada</span><strong>US$ {agentControl.metrics.revenue.toFixed(2)}</strong><small>modo comercial</small></article>
                <article><span>Margem bruta</span><strong>US$ {agentControl.metrics.grossMargin.toFixed(2)}</strong><small>{agentControl.metrics.marginPct}%</small></article>
                <article><span>Economia estimada</span><strong>US$ {agentControl.metrics.estimatedSavings.toFixed(2)}</strong><small>previsto × realizado</small></article>
              </div>
              <section className="agent-policy-card"><div><p className="eyebrow">HUMAN-IN-THE-LOOP</p><h4>Nível de autonomia</h4><p>Stripe/Pix e x402 estão instalados. Contratação externa só é liberada quando credenciais, adapter do provedor, orçamento e política humana estiverem válidos.</p></div><label>Política<select disabled={agentAction === "settings"} value={agentControl.settings.autonomyLevel} onChange={(event) => updateAutonomy(Number(event.target.value))}><option value={0}>Nível 0 · Simulation</option><option value={1}>Nível 1 · Approval</option><option value={2}>Nível 2 · Limited Autonomy</option><option value={3} disabled>Nível 3 · Autonomous (preparado)</option></select></label><div className="agent-limits"><span>Por transação <b>US$ {agentControl.settings.transactionLimit.toFixed(2)}</b></span><span>Limite diário <b>US$ {agentControl.settings.dailyLimit.toFixed(2)}</b></span><span>Pagamento externo <b>{agentControl.settings.externalPaymentsEnabled ? "HABILITADO" : "PROTEGIDO"}</b></span></div></section>
              <section className="agent-jobs-panel"><div className="agent-section-heading"><div><h4>Agent Jobs</h4><p>Cada execução mantém etapa, serviço, custo, aprovação, confiança e log auditável.</p></div><span>{agentControl.jobs.length}</span></div>
                <div className="agent-job-list">
                  {agentControl.jobs.slice(0, 40).map((job) => { const service = agentControl.services.find((item) => item.agentId === job.providerAgent); const candidates = parseAgentCandidates(job.candidateScoresJson); return <article key={job.jobId} className={`agent-job ${job.status.toLowerCase().replaceAll(" ", "-")}`}><header><div><small>{job.jobId} · {stageNumber(job.stageCategory)}</small><strong>{job.capability.replaceAll("_", " ")}</strong><span>{service?.name || job.providerAgent}</span></div><em>{job.status}</em></header><div className="agent-job-meta"><span>Previsto <b>{job.currency} {job.expectedPrice.toFixed(2)}</b></span><span>Realizado <b>{job.currency} {job.actualPrice.toFixed(2)}</b></span><span>Confiança <b>{job.confidence ? `${job.confidence}%` : "—"}</b></span><span>Tempo <b>{job.durationMs ? `${job.durationMs} ms` : "—"}</b></span></div>{job.result && <p>{job.result}</p>}{candidates.length > 1 && <div className="agent-candidates"><b>Discovery:</b>{candidates.slice(0, 4).map((candidate) => <span key={candidate.agentId}>{candidate.name} <strong>{candidate.score}</strong> · US$ {candidate.price.toFixed(2)}</span>)}</div>}{job.status === "Aguardando aprovação" && <footer><button disabled={agentAction === `reject:${job.jobId}`} onClick={() => decideAgentJob(job, "reject")}>Recusar</button><button className="primary" disabled={Boolean(agentAction)} onClick={() => decideAgentJob(job, "approve")}>{agentAction === `approve:${job.jobId}` ? "Executando…" : "Aprovar e executar"}</button></footer>}</article>; })}
                  {!agentControl.jobs.length && <div className="stage-document-empty">Nenhum Job ainda. Ao anexar um documento em uma etapa, o Orchestrator preparará a análise automaticamente.</div>}
                </div>
              </section>
              <section className="agent-ledger-panel"><div className="agent-section-heading"><div><h4>Financial Ledger</h4><p>REVENUE · COST · MARGIN · AGENT COST · EXTERNAL SERVICE COST · COMPUTE COST</p></div><span>{agentControl.ledger.length}</span></div><div className="agent-ledger-list">{agentControl.ledger.slice(0, 20).map((entry) => <article key={entry.id}><span>{entry.entryType}</span><div><b>{entry.description}</b><small>{stageNumber(entry.stageCategory)} · {formatDate(entry.createdAt)} · {entry.simulated ? "SIMULATED" : "POSTED"}</small></div><strong>{entry.currency} {entry.amount.toFixed(2)}</strong></article>)}{!agentControl.ledger.length && <div className="stage-document-empty">Ledger zerado para esta operação.</div>}</div></section>
            </>}
          </div>}

          {!loading && tab === "marketplace" && <div className="agent-marketplace-view">
            <header className="agent-control-hero marketplace"><div><p className="eyebrow">AGENT MARKETPLACE / SERVICES</p><h3>Service Registry</h3><p>Catálogo desacoplado do core, pronto para adapters API, MCP, A2A, discovery e pagamentos machine-to-machine quando autorizados.</p></div><span>{agentControl?.services.length ?? 0} SERVICES</span></header>
            {agentControl && <div className="agent-service-grid">{agentControl.services.map((service) => { const capabilities = parseStringArray(service.capabilitiesJson); const rep = agentControl.reputation.find((item) => item.agentId === service.agentId && capabilities.includes(item.capability)); return <article key={service.agentId}><header><span className={service.internal ? "internal" : "external"}>{service.internal ? "INTERNO" : "EXTERNO · CONECTOR"}</span><em>{service.status}</em></header><h4>{service.name}</h4><p>{service.description}</p><div className="agent-service-capabilities">{capabilities.map((capability) => <span key={capability}>{capability.replaceAll("_", " ")}</span>)}</div><dl><div><dt>Preço</dt><dd>{service.currency} {service.price.toFixed(2)}</dd></div><div><dt>Reputação</dt><dd>{(rep?.score ?? service.reputation).toFixed(0)}/100</dd></div><div><dt>Sucesso</dt><dd>{service.successRate.toFixed(0)}%</dd></div><div><dt>Tempo médio</dt><dd>{service.averageResponseMs < 1000 ? `${service.averageResponseMs} ms` : `${(service.averageResponseMs / 1000).toFixed(1)} s`}</dd></div></dl><footer><span>{service.adapterType.toUpperCase()}</span><span>{service.sla || "SLA a definir"}</span></footer></article>; })}</div>}
          </div>}

          {!loading && tab === "checklist" && <div className="operation-checklist">
            <header><div><p className="eyebrow">DA ORIGEM AO IMPORTADOR</p><h3>Checklist aplicável da supply chain</h3><p>Ative somente as etapas que fazem parte deste processo. Etapas não aplicáveis não reduzem a prontidão.</p></div><strong>{completedRequired}/{activeChecklist.length}</strong></header>
            <div className="supply-check-progress"><span style={{ width: `${progress}%` }} /><b>{progress}% completo</b></div>
            {supplyChainChecklist.map((item, index) => {
              const categoryDocs = documents.filter((document) => documentMatchesChecklist(document.category, item));
              const inheritedDossierCount = index === 0 ? linkedProperties.length : 0;
              const stageEvidenceCount = categoryDocs.length + inheritedDossierCount;
              const stageEnabled = !inactiveStageCategories.has(item.category);
              const hasCarEvidence = item.category === "Floresta · CAR e mapas" && hasGeolocatedOrigin;
              const hasIndustrialEvidence = item.category === "Planta industrial · produção" && industrialPlanComplete;
              const stageComplete = stageEnabled && (categoryDocs.length > 0 || hasCarEvidence || hasIndustrialEvidence);
              return <div key={item.category} className={`supply-check-group ${stageEnabled ? "" : "inactive"}`}><article className={`supply-check-step ${stageComplete ? "complete" : ""} ${stageEnabled ? "" : "not-applicable"}`}>
                <span>{!stageEnabled ? "—" : stageComplete ? "✓" : index + 1}</span>
                <div><small>ETAPA {item.number}</small><strong>{item.stage}</strong><p>{item.evidence}</p>{hasCarEvidence && <em>{linkedProperties.length} origem(ns) CAR com geometria vinculada(s)</em>}{hasIndustrialEvidence && <em>Plano industrial e rastreabilidade de lotes preenchidos</em>}{categoryDocs.length > 0 && <em>{categoryDocs.length} arquivo(s): {categoryDocs.map((document) => document.fileName).slice(0, 2).join(" · ")}</em>}</div>
                <b className={!stageEnabled ? "check-status not-applicable" : stageComplete ? "check-status complete" : "check-status"}>{!stageEnabled ? "Não aplicável" : stageComplete ? "Concluído" : "Pendente"}</b>
                <button className="stage-toggle" disabled={savingStage === item.category} onClick={() => toggleStage(item)}>{savingStage === item.category ? "Salvando…" : stageEnabled ? "Desativar etapa" : "Ativar etapa"}</button>
                <button className="stage-documents-button" onClick={() => { setCategory(item.category); setStageDocumentCategory(item.category); }}>{stageEvidenceCount ? `Ver / adicionar (${stageEvidenceCount})` : "Ver / adicionar"}</button>
              </article>
              {index === 0 && stageEnabled && <section className="stage-forest-connection">
                <div><span>CAR</span><p><b>Cadastro mestre de Florestas</b><small>{linkedProperties.length ? `${linkedProperties.length} floresta(s) já vinculada(s) a este processo.` : "Nenhuma floresta vinculada. Selecione uma cadastrada ou crie uma nova origem."}</small></p></div>
                <div className="stage-forest-actions">{linkedProperties.slice(0, 2).map((property) => <a key={property.id} href={`/api/forest-dossier?carCode=${encodeURIComponent(property.id)}`} target="_blank" rel="noreferrer">Dossiê {property.name} ↓</a>)}<button onClick={onManageForests}>{linkedProperties.length ? "Gerenciar florestas vinculadas →" : "Vincular / cadastrar floresta →"}</button></div>
              </section>}
              {index === 7 && industrialPlanOpen && <section className="industrial-plan">
                <header><div><p className="eyebrow">PLANO DE RECEBIMENTO E PRODUÇÃO</p><h3>Matéria-prima → pellets</h3><p>Controle quantitativo e rastreabilidade da transformação industrial.</p></div><span className={Math.abs(massDifference) < 0.01 && materialAvailable > 0 ? "balanced" : ""}>{Math.abs(massDifference) < 0.01 && materialAvailable > 0 ? "Balanço fechado" : "Balanço em aberto"}</span></header>
                <div className="industrial-plan-section"><h4>1. Período e recebimento</h4><div className="industrial-form-grid">
                  <label>Início do período *<input type="date" value={industrialPlan.periodStart} onChange={(event) => setIndustrialPlan({ ...industrialPlan, periodStart: event.target.value })} /></label>
                  <label>Fim do período *<input type="date" value={industrialPlan.periodEnd} onChange={(event) => setIndustrialPlan({ ...industrialPlan, periodEnd: event.target.value })} /></label>
                  <label className="wide">Lotes de matéria-prima recebidos *<input value={industrialPlan.receivingLots} onChange={(event) => setIndustrialPlan({ ...industrialPlan, receivingLots: event.target.value })} placeholder="Ex.: MP-001, MP-002 · vinculados às NFs e origens CAR" /></label>
                </div></div>
                <div className="industrial-plan-section"><h4>2. Estoque e consumo da matéria-prima</h4><div className="industrial-form-grid four">
                  <label>Estoque inicial (kg)<input type="number" min="0" value={industrialPlan.openingStockKg} onChange={(event) => setIndustrialPlan({ ...industrialPlan, openingStockKg: event.target.value })} /></label>
                  <label>Recebido no período (kg)<input type="number" min="0" value={industrialPlan.rawMaterialReceivedKg} onChange={(event) => setIndustrialPlan({ ...industrialPlan, rawMaterialReceivedKg: event.target.value })} /></label>
                  <label>Consumido na produção (kg)<input type="number" min="0" value={industrialPlan.rawMaterialConsumedKg} onChange={(event) => setIndustrialPlan({ ...industrialPlan, rawMaterialConsumedKg: event.target.value })} /></label>
                  <label>Estoque final (kg)<input type="number" min="0" value={industrialPlan.closingStockKg} onChange={(event) => setIndustrialPlan({ ...industrialPlan, closingStockKg: event.target.value })} /></label>
                </div></div>
                <div className="industrial-plan-section"><h4>3. Produção e lotes de pellets</h4><div className="industrial-form-grid">
                  <label>Pellets produzidos (kg)<input type="number" min="0" value={industrialPlan.pelletsProducedKg} onChange={(event) => setIndustrialPlan({ ...industrialPlan, pelletsProducedKg: event.target.value })} /></label>
                  <label>Lotes de pellets produzidos *<input value={industrialPlan.productionLots} onChange={(event) => setIndustrialPlan({ ...industrialPlan, productionLots: event.target.value })} placeholder="Ex.: PLT-2026-001" /></label>
                  <label className="wide">Observações de rastreabilidade<textarea value={industrialPlan.notes} onChange={(event) => setIndustrialPlan({ ...industrialPlan, notes: event.target.value })} placeholder="Descreva silos, linhas, turnos, ordens de produção e segregação dos lotes…" /></label>
                </div></div>
                <div className="mass-balance-results">
                  <article><span>Matéria-prima disponível</span><strong>{materialAvailable.toLocaleString("pt-BR")} kg</strong><small>estoque inicial + recebimento</small></article>
                  <article><span>Matéria-prima contabilizada</span><strong>{materialAccounted.toLocaleString("pt-BR")} kg</strong><small>consumo + estoque final</small></article>
                  <article className={Math.abs(massDifference) < 0.01 && materialAvailable > 0 ? "ok" : "warning"}><span>Diferença do balanço</span><strong>{massDifference.toLocaleString("pt-BR")} kg</strong><small>deve ser igual a zero</small></article>
                  <article><span>Rendimento industrial</span><strong>{productionYield.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong><small>pellets ÷ matéria-prima consumida</small></article>
                </div>
                <footer><button onClick={() => { setCategory(item.category); setStageDocumentCategory(item.category); }}>Gerenciar documentos da etapa</button><button className="primary" disabled={savingIndustrialPlan} onClick={saveIndustrialPlan}>{savingIndustrialPlan ? "Salvando…" : "Salvar plano industrial"}</button></footer>
              </section>}</div>;
            })}
          </div>}

          {!loading && tab === "report" && <div className="eudr-report-builder">
            <header><div><p className="eyebrow">PRÉ-SUBMISSÃO EUDR · ANEXO II</p><h3>Criar Relatório EUDR / Pré-DDS</h3><p>Gere um relatório estruturado como uma Due Diligence Statement, acompanhado do dossiê probatório completo.</p></div><span>DDS</span></header>
            <div className="report-builder-summary">
              <article data-readiness-source="supply-chain-checklist"><strong>{readinessSummary.percentage}%</strong><span>prontidão pré-DDS</span><small>{readinessSummary.completedStages}/{readinessSummary.applicableStages} etapas aplicáveis concluídas</small></article>
              <article data-readiness-source="supply-chain-checklist"><strong>{readinessSummary.evidenceCount}</strong><span>evidências vinculadas</span><small>{readinessSummary.documentCount} arquivo(s) · {readinessSummary.carOriginCount} origem(ns) CAR</small></article>
              <article><strong>{readinessSummary.carOriginCount}</strong><span>origens CAR</span><small>geolocalizações vinculadas</small></article>
              <article><strong>{eudrSubmissionGaps.length}</strong><span>pendências de submissão</span><small>campos a revisar</small></article>
            </div>
            <section className="report-builder-contents"><h4>Estrutura do relatório entregue ao cliente</h4><div>
              {["Capa executiva do cliente", "Visão estruturada da DDS · Anexo II", "Avaliação de risco e conclusão preliminar", "Supply chain completa · STAGE 01–13", "Índice de evidências e entrega ao cliente", "Dossiês geográficos CAR/SICAR", "Documentos originais organizados por etapa"].map((item, index) => <span key={item}><b>{String(index + 1).padStart(2, "0")}</b>{item}<i>✓</i></span>)}
            </div></section>
            <section className="report-forest-dossiers">
              <header><div><p className="eyebrow">STAGE 01 · ORIGEM FLORESTAL</p><h4>Dossiês CAR incorporados automaticamente</h4><p>Cada floresta vinculada entra no PDF final com mapa de satélite, limite SICAR, ficha cadastral, evidências e documento oficial anexado.</p></div><strong>{linkedProperties.length}</strong></header>
              <div>{linkedProperties.map((property) => {
                const propertyDocumentCount = linkedForestDocuments.filter((document) => document.propertyCarCode === property.id).length;
                const hasOfficialCar = linkedForestDocuments.some((document) => document.propertyCarCode === property.id && ["Demonstrativo CAR", "Recibo CAR"].includes(document.category));
                return <article key={property.id}><span>CAR</span><div><b>{property.name}</b><small>{property.id} · {property.city}</small><em>{propertyDocumentCount} documento(s) · {hasOfficialCar ? "documento SICAR oficial incluído" : "Demonstrativo oficial pendente"}</em></div><a href={`/api/forest-dossier?carCode=${encodeURIComponent(property.id)}`} target="_blank" rel="noreferrer">Baixar dossiê ↓</a></article>;
              })}{!linkedProperties.length && <p>Nenhuma floresta vinculada. Vincule uma origem CAR na STAGE 01 para incorporá-la automaticamente ao DDS.</p>}</div>
              {!!linkedProperties.length && <footer>✓ Estes dossiês serão incorporados automaticamente ao botão “Gerar relatório EUDR completo”.</footer>}
            </section>
            {eudrSubmissionGaps.length > 0 && <div className="report-builder-gaps"><div><span>!</span><p><b>Ainda não pronto para submissão oficial</b><small>Complete ou revise os campos abaixo antes de transmitir ao EUDR Information System.</small></p></div><ul>{eudrSubmissionGaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></div>}
            <div className="report-builder-note"><span>i</span><p><b>Importante:</b> este PDF é um rascunho pré-DDS e um dossiê de suporte. A declaração só adquire valor oficial depois de ser validada pelo operador responsável e submetida ao EUDR Information System, que retorna o número de referência.</p></div>
            <div className={`report-mode-selector ${reportTestMode ? "test" : "official"}`}>
              <div><b>Modo de geração do relatório</b><p>Todos os relatórios e documentos gerados pela plataforma serão emitidos em inglês.</p></div>
              <label>Tipo de relatório
                <select value={reportTestMode ? "test" : "official"} onChange={(event) => { setReportTestMode(event.target.value === "test"); setReportReviewed(false); }}>
                  <option value="test">TEST · dados simulados e marca d&apos;água</option>
                  <option value="official">REVIEWED PRE-DDS · dados reais revisados</option>
                </select>
                <small>{reportTestMode ? "Não pode ser usado como submissão oficial." : "Pré-submissão revisada; as pendências permanecerão identificadas no PDF."}</small>
              </label>
            </div>
            {!reportTestMode && <label className="official-review-confirmation">
              <input type="checkbox" checked={reportReviewed} onChange={(event) => setReportReviewed(event.target.checked)} />
              <span><b>Confirmo a revisão dos dados reais desta operação.</b><small>Reconheço as pendências indicadas acima e que o PDF somente se torna uma DDS oficial após validação e transmissão ao EUDR Information System.</small></span>
            </label>}
            <div className="eudr-api-roadmap">
              <span>API</span><div><b>Integração direta com o EUDR Information System</b><p>Estrutura preparada para futura conexão máquina-a-máquina: enviar DDS, consultar status e armazenar número de referência. A ativação dependerá do cadastro e da autorização do operador/representante no ambiente europeu.</p></div><em>Planejada</em>
            </div>
            <button className="primary generate-report-button single-report-action" disabled={!reportTestMode && !reportReviewed} onClick={generateEudrReport}>{reportTestMode ? "Gerar relatório TEST EUDR completo" : reportReviewed ? "Gerar Reviewed Pre-DDS + dossiê" : "Confirme a revisão para gerar"}</button>
          </div>}
        </div>

        {managedStage && <div className="stage-document-overlay" role="presentation" onMouseDown={() => setStageDocumentCategory(null)}>
          <section className="stage-document-dialog" role="dialog" aria-modal="true" aria-labelledby="stage-document-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><p className="eyebrow">ETAPA {String(managedStageIndex + 1).padStart(2, "0")} · DOSSIÊ DOCUMENTAL</p><h3 id="stage-document-title">{managedStage.stage}</h3><p>{managedStage.evidence}</p></div>
              <button aria-label="Fechar documentos da etapa" onClick={() => setStageDocumentCategory(null)}>×</button>
            </header>
            <div className="stage-document-summary">
              <article><strong>{managedStageDocuments.length + (managedStageIndex === 0 ? linkedProperties.length : 0)}</strong><span>evidências nesta etapa</span></article>
              <article><strong>{managedStageIndex + 1}/13</strong><span>posição no dossiê</span></article>
              <article className={managedStageDocuments.length || (managedStageIndex === 0 && linkedProperties.length) ? "complete" : "pending"}><strong>{managedStageDocuments.length || (managedStageIndex === 0 && linkedProperties.length) ? "✓" : "!"}</strong><span>{managedStageDocuments.length || (managedStageIndex === 0 && linkedProperties.length) ? "etapa com evidência" : "evidência pendente"}</span></article>
            </div>
            <div className={`stage-document-drop ${stageDragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setStageDragging(true); }} onDragLeave={() => setStageDragging(false)} onDrop={(event) => { event.preventDefault(); setStageDragging(false); uploadFiles(Array.from(event.dataTransfer.files), managedStage.category); }}>
              <input id={`stage-files-${managedStageIndex}`} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.json,.geojson,.kml,.kmz,.zip" onChange={(event) => uploadFiles(Array.from(event.target.files ?? []), managedStage.category)} />
              <span>{uploading ? "↻" : "↑"}</span><div><b>{uploading ? "Enviando documentos…" : "Incluir documentos nesta etapa"}</b><small>Arraste aqui ou selecione PDF, Word, Excel, imagens, GeoJSON, KML/KMZ ou ZIP · até 20 MB por arquivo</small></div><label htmlFor={`stage-files-${managedStageIndex}`}>Incluir doc ＋</label>
            </div>
            <div className="stage-document-list-title"><div><h4>Documentos da etapa</h4><p>Estes arquivos serão posicionados nesta mesma etapa no dossiê EUDR.</p></div><span>{managedStageDocuments.length}</span></div>
            <div className="stage-document-list">
              {managedStageDocuments.map((document) => <article key={document.id}><span>{fileIcon(document.fileName)}</span><div><b>{document.fileName}</b><small>{formatBytes(document.sizeBytes)} · {formatDate(document.uploadedAt)}</small>{document.notes && <small>{document.notes}</small>}</div><em>Recebido</em><button onClick={() => openSecureDocument(document.id, "operation", true)} title="Visualizar documento">Visualizar</button><button onClick={() => openSecureDocument(document.id, "operation")} title="Baixar documento">↓</button><button title="Excluir documento" onClick={() => removeDocument(document)}>Excluir</button></article>)}
              {!managedStageDocuments.length && <div className="stage-document-empty">Nenhum arquivo anexado diretamente nesta etapa.</div>}
            </div>
            {managedStageIndex === 0 && <div className="stage-inherited-evidence"><div className="stage-inherited-heading"><div><h4>Dossiês das origens CAR</h4><p>Vinculados automaticamente à STAGE 01 e ao relatório DDS completo.</p></div><button onClick={onManageForests}>{linkedProperties.length ? "Gerenciar no módulo Florestas" : "Cadastrar / vincular floresta"}</button></div>{linkedProperties.map((property) => {
              const propertyDocumentCount = linkedForestDocuments.filter((document) => document.propertyCarCode === property.id).length;
              return <article key={property.id}><b>CAR</b><div><strong>{property.name}</strong><small>{property.id} · {property.city}</small><small>{propertyDocumentCount} documento(s) da origem incorporado(s)</small></div><a href={`/api/forest-dossier?carCode=${encodeURIComponent(property.id)}`} target="_blank" rel="noreferrer">Visualizar / baixar dossiê</a></article>;
            })}{!linkedProperties.length && <p>Nenhuma origem vinculada. Abra o cadastro de Florestas para selecionar um imóvel existente ou cadastrar um novo CAR.</p>}</div>}
            <section className="stage-ai-analysis">
              <header><div><p className="eyebrow">ANÁLISE IA</p><h4>Supply Chain Orchestrator</h4><p>A análise usa referências somente leitura. A IA não altera o documento original nem conclui a etapa.</p></div><button disabled={Boolean(agentAction)} onClick={() => requestAgentAnalysis(managedStage.category)}>{agentAction.startsWith("analyze:") ? "Analisando…" : latestManagedStageJob ? "Reanalisar" : "Analisar etapa"}</button></header>
              {latestManagedStageJob ? <div className="stage-ai-result"><span className={`ai-status ${latestManagedStageJob.status.toLowerCase().replaceAll(" ", "-")}`}>{latestManagedStageJob.status}</span><dl><div><dt>Agente</dt><dd>{agentControl?.services.find((service) => service.agentId === latestManagedStageJob.providerAgent)?.name || latestManagedStageJob.providerAgent}</dd></div><div><dt>Confiança</dt><dd>{latestManagedStageJob.confidence ? `${latestManagedStageJob.confidence}%` : "Aguardando execução"}</dd></div><div><dt>Custo</dt><dd>{latestManagedStageJob.currency} {(latestManagedStageJob.actualPrice || latestManagedStageJob.expectedPrice).toFixed(2)}</dd></div><div><dt>Data</dt><dd>{formatDate(latestManagedStageJob.completedAt || latestManagedStageJob.createdAt)}</dd></div></dl>{latestManagedStageJob.result && <p>{latestManagedStageJob.result}</p>}{latestManagedStageJob.status === "Aguardando aprovação" && <footer><button onClick={() => decideAgentJob(latestManagedStageJob, "reject")}>Recusar</button><button className="primary" disabled={Boolean(agentAction)} onClick={() => decideAgentJob(latestManagedStageJob, "approve")}>{agentAction === `approve:${latestManagedStageJob.jobId}` ? "Executando…" : "Aprovar análise"}</button></footer>}</div> : <div className="stage-ai-empty">Nenhuma análise executada nesta etapa. Ao incluir um novo documento, o Orchestrator criará um Job automaticamente.</div>}
            </section>
            <footer><small>Fluxo do dossiê: esta evidência permanecerá vinculada à ETAPA {String(managedStageIndex + 1).padStart(2, "0")}.</small>{managedStageIndex === 7 && <button onClick={() => { setStageDocumentCategory(null); setIndustrialPlanOpen(true); }}>Abrir plano industrial</button>}<button className="primary" onClick={() => setStageDocumentCategory(null)}>Concluir</button></footer>
          </section>
        </div>}
      </section>
    </div>
  );
}

function ExportOrderControl({ operation, documents, uploadFiles, removeDocument, showNotice, onOpenSupplyChain }: { operation: OperationRecord; documents: DocumentRecord[]; uploadFiles: (files: File[], forcedCategory?: string) => Promise<void>; removeDocument: (document: DocumentRecord) => Promise<void>; showNotice: (message: string) => void; onOpenSupplyChain: () => void }) {
  const [data, setData] = useState<ExportControlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [selectedCode, setSelectedCode] = useState("");
  const [settings, setSettings] = useState({ customerName: "", customerEmail: "", customerReference: "", notificationsEnabled: true, trackingIntervalDays: 10 });
  const [draft, setDraft] = useState({ status: "Pendente", qualityStatus: "Não iniciado", shipmentApproval: "Não aplicável", responsibleName: "", responsibleEmail: "", dueDate: "", nextAction: "", note: "" });
  const [previewMessage, setPreviewMessage] = useState<{ subject: string; body: string } | null>(null);
  const [shipmentAdvice, setShipmentAdvice] = useState<ShipmentAdviceData | null>(null);
  const [shipmentAdviceAction, setShipmentAdviceAction] = useState(false);
  const [aiReportVisible, setAiReportVisible] = useState(false);

  useEffect(() => {
    let activeRequest = true;
    // The operation-detail sheet owns this loading flag; reset it when the selected operation changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/export-control?operationId=${operation.id}&t=${Date.now()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as ExportControlData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o acompanhamento do pedido.");
        if (!activeRequest) return;
        setData(payload);
        setSettings({ customerName: payload.settings.customerName, customerEmail: payload.settings.customerEmail, customerReference: payload.settings.customerReference, notificationsEnabled: payload.settings.notificationsEnabled, trackingIntervalDays: payload.settings.trackingIntervalDays });
        const eudrStage = payload.milestones.find((milestone) => milestone.code === "ORIGIN_COMPLIANCE" && ["Em andamento", "Aguardando aprovação"].includes(milestone.status));
        const initial = eudrStage || payload.milestones.find((milestone) => milestone.status !== "Concluído") || payload.milestones.at(-1);
        if (initial) setSelectedCode(initial.code);
      })
      .catch((error) => showNotice(error instanceof Error ? error.message : "Export Control indisponível."))
      .finally(() => { if (activeRequest) setLoading(false); });
    return () => { activeRequest = false; };
  }, [operation.id]);

  useEffect(() => {
    let activeRequest = true;
    fetch(`/api/shipment-advice?operationId=${operation.id}&t=${Date.now()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as ShipmentAdviceData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o dossiê final.");
        if (activeRequest) setShipmentAdvice(payload);
      })
      .catch((error) => showNotice(error instanceof Error ? error.message : "Dossiê final indisponível."));
    return () => { activeRequest = false; };
  }, [operation.id, documents.length]);

  const selected = data?.milestones.find((milestone) => milestone.code === selectedCode) || data?.milestones[0];
  useEffect(() => {
    if (!selected) return;
    // The editor draft mirrors the newly selected persisted milestone.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft({ status: selected.status, qualityStatus: selected.qualityStatus, shipmentApproval: selected.shipmentApproval, responsibleName: selected.responsibleName, responsibleEmail: selected.responsibleEmail, dueDate: selected.dueDate, nextAction: selected.nextAction, note: selected.note });
  }, [selected?.id, selected?.updatedAt]);

  const applicableMilestones = data?.milestones.filter((milestone) => milestone.status !== "Suspenso") ?? [];
  const completed = applicableMilestones.filter((milestone) => milestone.status === "Concluído").length;
  const progress = applicableMilestones.length ? Math.round(completed / applicableMilestones.length * 100) : 0;
  const selectedDocuments = selected ? documents.filter((document) => document.category === selected.category) : [];
  const latestTracking = data?.tracking[0];
  const qualityStatus = data?.milestones.find((milestone) => milestone.code === "QUALITY_CONTROL")?.qualityStatus || "Não iniciado";
  const previousStagesComplete = Boolean(data?.milestones
    .filter((milestone) => milestone.sequence < 6 && milestone.status !== "Suspenso")
    .every((milestone) => milestone.status === "Concluído"));
  const shippingGateReady = Boolean(data && canApproveShipment({
    eudrRequired: data.compliance.eudrRequired,
    eudrReadiness: operation.readiness,
    countryComplianceScore: data.compliance.score,
    qualityStatus,
    previousStagesComplete,
  }));

  async function post(body: Record<string, unknown>, successMessage: string) {
    setAction(String(body.action || "saving"));
    try {
      const response = await fetch("/api/export-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: operation.id, ...body }) });
      const payload = await response.json() as ExportControlData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar o processo de exportação.");
      setData(payload);
      setSettings({ customerName: payload.settings.customerName, customerEmail: payload.settings.customerEmail, customerReference: payload.settings.customerReference, notificationsEnabled: payload.settings.notificationsEnabled, trackingIntervalDays: payload.settings.trackingIntervalDays });
      if (successMessage) showNotice(successMessage);
      return payload;
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha na atualização.");
      return null;
    } finally { setAction(""); }
  }

  async function sendTestEmail() {
    const payload = await post({ action: "test-email", customerName: settings.customerName, customerEmail: settings.customerEmail, customerReference: settings.customerReference }, "");
    if (!payload?.deliveryResult) return;
    const latest = payload.notifications[0];
    if (latest) setPreviewMessage({ subject: latest.subject, body: latest.body });
    showNotice(payload.deliveryResult.status === "Enviado"
      ? `E-mail enviado agora para ${settings.customerEmail}.`
      : `Teste não enviado: ${payload.deliveryResult.error || payload.deliveryResult.status}.`);
  }

  async function saveMilestone(statusOverride?: string) {
    if (!selected) return;
    const status = statusOverride || draft.status;
    if (!["Pendente", "Suspenso"].includes(status)) {
      const missing = [!draft.responsibleName.trim() ? "responsável" : "", !draft.dueDate ? "prazo" : "", !draft.nextAction.trim() ? "próxima ação" : ""].filter(Boolean);
      if (missing.length) {
        showNotice(`Antes de avançar, informe: ${missing.join(", ")}.`);
        return;
      }
    }
    if (status === "Concluído" && !draft.note.trim()) {
      showNotice("Registre o resultado ou a evidência da etapa antes de concluí-la.");
      return;
    }
    if (selected.code === "SHIPMENT_APPROVAL" && (draft.shipmentApproval === "Aprovado" || status === "Concluído") && !shippingGateReady) {
      showNotice(data?.compliance.eudrRequired ? "A aprovação exige: etapas anteriores concluídas, qualidade aprovada, checklist do país 100% e prontidão EUDR 100%." : qualityStatus === "Reprovado" ? "A aprovação foi bloqueada porque a qualidade está reprovada." : "Conclua as etapas anteriores para liberar a aprovação. EUDR e checklist documental não bloqueiam destinos fora da União Europeia.");
      return;
    }
    await post({ action: "milestone", code: selected.code, ...draft, status }, status === "Concluído" ? "Etapa concluída; atualização do cliente registrada automaticamente." : "Status operacional atualizado.");
  }

  async function regenerateShipmentAdvice() {
    setShipmentAdviceAction(true);
    try {
      const response = await fetch("/api/shipment-advice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: operation.id, action: "regenerate" }) });
      const payload = await response.json() as ShipmentAdviceData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar o Shipment Advice.");
      setShipmentAdvice(payload);
      setPreviewMessage({ subject: payload.advice?.subject || payload.generated.subject, body: payload.advice?.body || payload.generated.body });
      showNotice("Shipment Advice atualizado como rascunho; nenhum e-mail foi enviado.");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao preparar o Shipment Advice.");
    } finally {
      setShipmentAdviceAction(false);
    }
  }

  async function setShipmentDocumentStatus(document: DocumentRecord, approved: boolean) {
    setShipmentAdviceAction(true);
    try {
      const response = await fetch("/api/shipment-advice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: operation.id, action: "set-document-status", documentId: document.id, approved }) });
      const payload = await response.json() as ShipmentAdviceData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível revisar o documento.");
      setShipmentAdvice(payload);
      showNotice(approved ? `${document.fileName} aprovado para o Shipment Advice.` : `${document.fileName} voltou para revisão.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao revisar o documento.");
    } finally { setShipmentAdviceAction(false); }
  }

  async function sendShipmentAdvice() {
    if (!shipmentAdvice?.complete) { showNotice("Aprove primeiro todos os documentos obrigatórios da Etapa 09."); return; }
    if (!window.confirm(`Enviar o Shipment Advice para ${settings.customerEmail || shipmentAdvice.generated.recipient} com ${shipmentAdvice.generated.included.length} anexo(s) aprovado(s)?`)) return;
    setShipmentAdviceAction(true);
    try {
      const response = await fetch("/api/shipment-advice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: operation.id, action: "approve-send" }) });
      const payload = await response.json() as ShipmentAdviceData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível enviar o Shipment Advice.");
      setShipmentAdvice(payload);
      showNotice(`Shipment Advice enviado para ${payload.advice?.recipient || settings.customerEmail}.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao enviar o Shipment Advice.");
    } finally { setShipmentAdviceAction(false); }
  }

  async function sendShipmentAdviceTest() {
    if (!shipmentAdvice?.complete) { showNotice("Aprove primeiro todos os documentos obrigatórios da Etapa 09."); return; }
    setShipmentAdviceAction(true);
    try {
      const response = await fetch("/api/shipment-advice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: operation.id, action: "test-send", recipient: settings.customerEmail }) });
      const payload = await response.json() as ShipmentAdviceData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível enviar o teste do Shipment Advice.");
      setShipmentAdvice(payload);
      showNotice(`Teste do Shipment Advice enviado para ${settings.customerEmail} com ${payload.generated.included.length} anexo(s).`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao enviar o teste do Shipment Advice.");
    } finally { setShipmentAdviceAction(false); }
  }

  async function runAiOperationCheck() {
    const payload = await post({ action: "country-check" }, "Relatório da operação atualizado pela IA.");
    if (payload) setAiReportVisible(true);
  }

  if (loading) return <div className="command-loading">Preparando a torre de controle do pedido…</div>;
  if (!data || !selected) return <div className="empty-command">Não foi possível iniciar o acompanhamento deste pedido.</div>;

  const previewSubject = `${operation.reference} · ${selected.title} · ${draft.status}`;
  const previewBody = `Dear customer,\n\nThis is an automatic ExportaTrust update for your order.\n\nOrder/process: ${operation.reference}\nProduct: ${operation.product}\nCurrent stage: ${selected.title}\nStatus: ${draft.status}${operation.bookingNumber ? `\nBooking: ${operation.bookingNumber}` : ""}${operation.containerNumbers ? `\nContainer(s): ${operation.containerNumbers}` : ""}${operation.portOfLoading || operation.portOfDischarge ? `\nRoute: ${operation.portOfLoading || "TBC"} → ${operation.portOfDischarge || "TBC"}` : ""}${draft.note ? `\nUpdate: ${draft.note}` : ""}\n\nAll original documents and compliance records remain available in the ExportaTrust control tower.\n\nBest regards,\nExportaTrust`;
  const activePreview = previewMessage || { subject: previewSubject, body: previewBody };

  return <div className="export-control-view">
    <header className="export-control-hero">
      <div><p className="eyebrow">EXPORT ORDER CONTROL TOWER</p><h3>Da floresta à entrega final</h3><p>Controle operacional, qualidade, documentos, comunicação com o cliente e tracking do embarque no mesmo processo.</p></div>
      <div className="export-control-progress"><strong>{progress}%</strong><span>{completed}/{applicableMilestones.length} etapas aplicáveis concluídas</span><i><b style={{ width: `${progress}%` }} /></i></div>
    </header>

    <div className="export-control-metrics">
      <article><span>Etapa atual</span><strong>{data.milestones.find((milestone) => ["Em andamento", "Aguardando aprovação"].includes(milestone.status))?.title || selected.title}</strong><small>{selected.status}</small></article>
      <article><span>Liberação de embarque</span><strong>{shippingGateReady ? "Liberável" : "Bloqueada"}</strong><small>{shippingGateReady ? (data.compliance.eudrRequired ? "Etapas + qualidade + país + EUDR" : "EUDR não aplicável · etapas e qualidade liberadas") : data.compliance.eudrRequired ? "Etapas + qualidade + país + EUDR" : qualityStatus === "Reprovado" ? "Qualidade reprovada" : "Etapas anteriores pendentes"}</small></article>
      <article className={data.operationalAlerts.missingPlan || data.operationalAlerts.overdue ? "attention" : ""}><span>Pendências operacionais</span><strong>{data.operationalAlerts.missingPlan + data.operationalAlerts.overdue}</strong><small>{data.operationalAlerts.missingPlan} sem plano · {data.operationalAlerts.overdue} atrasada(s)</small></article>
      <article><span>Próximo tracking</span><strong>{data.settings.nextTrackingAt ? formatDate(data.settings.nextTrackingAt) : "A programar"}</strong><small>A cada {data.settings.trackingIntervalDays} dias</small></article>
    </div>

    <section className="export-pipeline" aria-label="Etapas do pedido de exportação">
      {data.milestones.map((milestone) => {
        const count = documents.filter((document) => document.category === milestone.category).length;
        return <button key={milestone.code} className={`${milestone.status.toLowerCase().replaceAll(" ", "-")} ${selected.code === milestone.code ? "selected" : ""}`} onClick={() => setSelectedCode(milestone.code)}>
          <span>{String(milestone.sequence).padStart(2, "0")}</span><div><b>{milestone.title}</b><small>{milestone.status}{count ? ` · ${count} arquivo(s)` : ""}</small></div><i>{milestone.status === "Concluído" ? "✓" : milestone.status === "Bloqueado" ? "!" : "→"}</i>
        </button>;
      })}
    </section>

    <div className="export-control-grid">
      <section className="export-milestone-editor panel">
        <header><div><p className="eyebrow">ETAPA {String(selected.sequence).padStart(2, "0")}</p><h3>{selected.title}</h3><p>{selected.category}</p></div><span className={`export-status ${selected.status.toLowerCase().replaceAll(" ", "-")}`}>{selected.status}</span></header>
        <div className="export-editor-form">
          <label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option>Pendente</option><option>Em andamento</option><option>Aguardando aprovação</option><option>Concluído</option><option>Bloqueado</option><option>Suspenso</option></select></label>
          <label>Prazo<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
          <label>Responsável *<input value={draft.responsibleName} onChange={(event) => setDraft({ ...draft, responsibleName: event.target.value })} placeholder="Pessoa responsável por esta etapa" /></label>
          <label>E-mail do responsável<input type="email" value={draft.responsibleEmail} onChange={(event) => setDraft({ ...draft, responsibleEmail: event.target.value })} placeholder="responsavel@empresa.com" /></label>
          {(["PRODUCTION", "QUALITY_CONTROL", "STUFFING"].includes(selected.code)) && <label>Controle de qualidade<select value={draft.qualityStatus} onChange={(event) => setDraft({ ...draft, qualityStatus: event.target.value })}><option>Não iniciado</option><option>Em inspeção</option><option>Aprovado</option><option>Com ressalvas</option><option>Reprovado</option></select></label>}
          {selected.code === "SHIPMENT_APPROVAL" && <label>Aprovação para embarque<select value={draft.shipmentApproval} onChange={(event) => setDraft({ ...draft, shipmentApproval: event.target.value })}><option>Pendente</option><option>Aprovado</option><option>Reprovado</option></select></label>}
          <label className="wide">Próxima ação *<textarea value={draft.nextAction} onChange={(event) => setDraft({ ...draft, nextAction: event.target.value })} placeholder="Ação objetiva que deve ocorrer para esta etapa avançar…" /></label>
          <label className="wide">Atualização / observação<textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Descreva o avanço, resultado da inspeção, ocorrência ou informação que seguirá ao cliente…" /></label>
        </div>
        {data.operationalAlerts.stages.some((item) => item.code === selected.code) && <div className="export-plan-alert" role="status"><b>Plano operacional incompleto</b><span>{data.operationalAlerts.stages.find((item) => item.code === selected.code)?.overdue ? "Prazo vencido. " : ""}{data.operationalAlerts.stages.find((item) => item.code === selected.code)?.missing.length ? `Falta: ${data.operationalAlerts.stages.find((item) => item.code === selected.code)?.missing.join(", ")}.` : ""}</span></div>}
        {selected.code === "ORIGIN_COMPLIANCE" && <section className="eudr-stage-bridge">
          <div><span>{data.eudrBridge.required ? "SUPPLY CHAIN + DDS EUDR" : "EUDR SUSPENSO"}</span><strong>{data.eudrBridge.required ? `${data.eudrBridge.readiness}%` : "N/A"}</strong><p>{data.eudrBridge.status}{data.eudrBridge.reference ? ` · ${data.eudrBridge.reference}` : ""}</p></div>
          {data.eudrBridge.required ? <button onClick={onOpenSupplyChain}>Abrir Supply Chain e inspeção EUDR →</button> : <button onClick={onOpenSupplyChain}>Abrir supply chain operacional →</button>}
        </section>}
        {selected.code === "SHIPMENT_APPROVAL" && <div className={`shipment-gate ${shippingGateReady ? "ready" : "blocked"}`}><b>{shippingGateReady ? "✓ Pedido pronto para aprovação humana" : "! Aprovação ainda bloqueada"}</b><span>{data.compliance.eudrRequired ? `EUDR ${operation.readiness}% · país ${data.compliance.score}% · ` : "EUDR não aplicável ao destino · "}etapas anteriores {previousStagesComplete ? "concluídas" : "pendentes"} · qualidade {qualityStatus}</span></div>}
        <div className="export-editor-actions"><button disabled={Boolean(action)} onClick={() => saveMilestone()}>Salvar atualização</button><button className="primary" disabled={Boolean(action) || selected.status === "Concluído"} onClick={() => saveMilestone("Concluído")}>Concluir etapa e notificar cliente ✓</button></div>

        <div className="export-stage-files">
          <div><h4>Documentos e fotos desta etapa</h4><span>{selectedDocuments.length}</span></div>
          <label className="export-file-drop"><input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.json,.zip" onChange={(event) => uploadFiles(Array.from(event.target.files || []), selected.category)} /><b>＋ Incluir documentos ou fotos</b><small>Os arquivos permanecem vinculados exclusivamente a esta etapa.</small></label>
          <div className="export-file-list">{selectedDocuments.map((document) => <article key={document.id}><span>{fileIcon(document.fileName)}</span><div><b>{document.fileName}</b><small>{document.documentType || "Documento"} · {document.lifecycleStatus || document.status} · {formatBytes(document.sizeBytes)} · {formatDate(document.uploadedAt)}</small>{document.shipmentSetStatus === "Incluído" && <em>✓ Pasta final do embarque · revisão do cliente pendente</em>}</div><button onClick={() => openSecureDocument(document.id, "operation", true)}>Visualizar</button><button onClick={() => openSecureDocument(document.id, "operation")}>↓</button><button className="danger" onClick={() => removeDocument(document)}>Excluir</button></article>)}{!selectedDocuments.length && <p>Nenhum arquivo anexado nesta etapa.</p>}</div>
        </div>
      </section>

      <aside className="export-control-side">
        <section className="shipment-dossier-card panel">
          <header><div><p className="eyebrow">PASTA FINAL DO EMBARQUE</p><h3>Shipment Advice</h3></div><span className={shipmentAdvice?.complete ? "ready" : "pending"}>{shipmentAdvice?.complete ? "Set completo" : "Em preparação"}</span></header>
          <p>Todos os documentos da Etapa 09 aparecem aqui. Marque individualmente os arquivos conferidos para compor o e-mail e o Shipment Advice.</p>
          <div className="shipment-checklist">{shipmentAdvice?.generated.checklist.map((item) => <article key={item.key} className={item.present ? "ready" : item.required ? "missing" : "optional"}><span>{item.present ? "✓" : item.required ? "!" : "○"}</span><div><b>{item.label}</b><small>{item.present ? "Pronto no set" : item.required ? "Documento final pendente" : "Condicional"}</small></div></article>)}</div>
          <div className="shipment-final-files">{shipmentAdvice?.generated.candidates.map((document) => { const approved = document.shipmentSetStatus === "Incluído" && document.clientShareStatus === "Aprovado"; return <article key={document.id} className={approved ? "approved" : "review"}><span className="shipment-file-icon">{approved ? "✓" : fileIcon(document.fileName)}</span><div><b>{document.documentType || "Documento da Etapa 09"}</b><small>{document.fileName}</small><em>{approved ? "OK para envio" : "Aguardando conferência"}</em></div><button className="view-document" onClick={() => openSecureDocument(document.id, "operation", true)}>Ver</button><button className={approved ? "reopen-document" : "approve-document"} disabled={shipmentAdviceAction} onClick={() => setShipmentDocumentStatus(document, !approved)}>{approved ? "Reabrir" : "Aprovar"}</button></article>; })}{shipmentAdvice && !shipmentAdvice.generated.candidates.length && <p>Nenhum documento foi incluído na Etapa 09.</p>}</div>
          <div className="shipment-advice-status"><b>{shipmentAdvice?.advice?.status || "Rascunho ainda não gerado"}</b><span>{shipmentAdvice?.advice?.humanApproved ? "Aprovado por responsável" : "Envio bloqueado até aprovação humana"}</span></div>
          <button className="primary" disabled={shipmentAdviceAction} onClick={regenerateShipmentAdvice}>{shipmentAdviceAction ? "Preparando…" : "Atualizar rascunho do Shipment Advice"}</button>
          <button disabled={shipmentAdviceAction || !shipmentAdvice?.complete || !settings.customerEmail} onClick={sendShipmentAdviceTest}>{shipmentAdviceAction ? "Enviando…" : "Enviar teste com todos os anexos"}</button>
          <button className="send-shipment" disabled={shipmentAdviceAction || !shipmentAdvice?.complete || !settings.customerEmail} onClick={sendShipmentAdvice}>Aprovar e enviar e-mail com anexos ✓</button>
          {shipmentAdvice && <button onClick={() => setPreviewMessage({ subject: shipmentAdvice.advice?.subject || shipmentAdvice.generated.subject, body: shipmentAdvice.advice?.body || shipmentAdvice.generated.body })}>Ver prévia com cobrança e documentos</button>}
        </section>

        <section className="client-communication-card panel">
          <header><div><p className="eyebrow">CLIENT COMMUNICATION</p><h3>Atualização automática</h3></div><span className={data.emailDelivery.ready ? "active" : "simulation"}>{data.emailDelivery.ready ? "Envio real ativo" : "Configuração necessária"}</span></header>
          <label>Cliente<input value={settings.customerName} onChange={(event) => setSettings({ ...settings, customerName: event.target.value })} placeholder={operation.euImporter} /></label>
          <label>E-mail do cliente<input type="email" value={settings.customerEmail} onChange={(event) => setSettings({ ...settings, customerEmail: event.target.value })} placeholder="logistics@customer.com" /></label>
          <label>Referência do cliente<input value={settings.customerReference} onChange={(event) => setSettings({ ...settings, customerReference: event.target.value })} placeholder="PO / customer order" /></label>
          <div className="communication-inline"><label>Tracking marítimo a cada<input type="number" min="1" max="90" value={settings.trackingIntervalDays} onChange={(event) => setSettings({ ...settings, trackingIntervalDays: Number(event.target.value) })} /><small>dias · não afeta o teste imediato</small></label><label className="communication-toggle"><input type="checkbox" checked={settings.notificationsEnabled} onChange={(event) => setSettings({ ...settings, notificationsEnabled: event.target.checked })} /><span>Notificar ao concluir etapas</span></label></div>
          <button className="primary" disabled={Boolean(action)} onClick={() => post({ action: "settings", ...settings }, "Preferências de comunicação salvas.")}>Salvar comunicação</button>
          <button disabled={Boolean(action) || !settings.customerEmail} onClick={sendTestEmail}>{action === "test-email" ? "Enviando agora…" : "Enviar e-mail de teste agora"}</button>
          <button onClick={() => setPreviewMessage(previewMessage ? null : { subject: previewSubject, body: previewBody })}>{previewMessage ? "Fechar prévia" : "Ver prévia do e-mail"}</button>
          {!data.emailDelivery.ready && <p className="integration-warning"><b>O teste é imediato; não espera 10 dias.</b> O envio externo está bloqueado porque o remetente transacional ainda não foi configurado. A mensagem continuará registrada com o motivo exato, sem indicar envio falso.</p>}
          <p className="email-provider-line"><b>Provedor:</b> {data.emailDelivery.provider} · <b>Remetente:</b> {data.emailDelivery.sender}</p>
        </section>

        <section className="country-ai-card panel">
          <header><div><p className="eyebrow">AI FULL OPERATION CHECK</p><h3>Relatório da operação</h3></div></header>
          <p>Uma única verificação cruza as etapas, os documentos e as exigências de {operation.destinationCountry}.</p>
          <button className="ai-run-button" disabled={Boolean(action)} onClick={runAiOperationCheck}>{action === "country-check" ? "VERIFICANDO…" : "VERIFICAR OPERAÇÃO COM IA"}</button>
          {aiReportVisible && <div className="ai-operation-report">
            <header><div><b>{data.compliance.verdict}</b><span>{data.compliance.opinion}</span></div><strong>{Math.round((data.compliance.score + data.compliance.stageScore) / 2)}%</strong></header>
            <section><h4>Pendências encontradas</h4>{data.compliance.requirements.filter((item) => item.required && !item.present).map((item) => <article key={item.key} className="missing"><span>!</span><div><b>{item.label}</b><small>{item.reason}</small></div></article>)}{!data.compliance.requirements.some((item) => item.required && !item.present) && <p>✓ Nenhuma exigência documental obrigatória pendente.</p>}</section>
            <section><h4>Status de cada etapa</h4><div className="ai-stage-report">{data.compliance.stages.map((stage) => <article key={stage.code} className={stage.passed ? "ready" : stage.applicable ? "missing" : "conditional"}><span>{stage.passed ? "✓" : stage.applicable ? "!" : "—"}</span><div><b>{String(stage.sequence).padStart(2, "0")} · {stage.title}</b><small>{stage.issue} · {stage.documentCount} documento(s)</small></div><em>{stage.status}</em></article>)}</div></section>
            <small>Relatório preliminar; confirme exigências oficiais do país, produto e importador antes do embarque.</small>
          </div>}
        </section>

        <section className="tracking-card panel">
          <header><div><p className="eyebrow">BOOKING TRACKING</p><h3>{operation.bookingNumber || "Booking não cadastrado"}</h3></div><span>10D</span></header>
          {latestTracking ? <article><b>{latestTracking.status}</b><span>{latestTracking.location}</span><p>{latestTracking.details}</p><small>Consultado em {formatDate(latestTracking.checkedAt)} · próximo {formatDate(latestTracking.nextCheckAt)}</small></article> : <p>Nenhuma consulta de tracking registrada.</p>}
          <button disabled={Boolean(action)} onClick={() => post({ action: "tracking-check" }, "Tracking registrado; próximo acompanhamento programado.")}>Atualizar tracking agora ↻</button>
          {!operation.bookingNumber && <small>Preencha armador e booking na edição do processo para conectar a futura API de tracking.</small>}
        </section>
      </aside>
    </div>

    {previewMessage && <section className="email-preview-panel panel">
      <header><div><p className="eyebrow">PRÉVIA EXATA DO E-MAIL</p><h3>Como o cliente receberá</h3></div><button onClick={() => setPreviewMessage(null)}>Fechar ×</button></header>
      <div className="email-preview-envelope"><div className="email-preview-meta"><span>Para</span><b>{settings.customerEmail || "cliente@empresa.com"}</b><span>Assunto</span><b>{activePreview.subject}</b></div><article><header><small>EXPORTATRUST</small><strong>Shipment Advice / Set of Documents</strong></header><p>{activePreview.body}</p></article></div>
      <a className="email-manual-link" href={`mailto:${encodeURIComponent(settings.customerEmail)}?subject=${encodeURIComponent(activePreview.subject)}&body=${encodeURIComponent(activePreview.body)}`}>Abrir esta mensagem no meu e-mail ↗</a>
    </section>}

    <section className="notification-history panel">
      <header><div><p className="eyebrow">TRILHA DE COMUNICAÇÃO</p><h3>E-mails e atualizações do cliente</h3></div><strong>{data.notifications.length}</strong></header>
      <div>{data.notifications.slice(0, 10).map((notification) => <article key={notification.id}><span className={notification.status.toLowerCase().replaceAll(" ", "-")}>{notification.status}</span><div><b>{notification.subject}</b><small>{notification.recipient || "Destinatário pendente"} · {formatDate(notification.createdAt)}</small>{notification.error && <em>{notification.error}</em>}</div><button onClick={() => setPreviewMessage({ subject: notification.subject, body: notification.body })}>Visualizar mensagem</button></article>)}{!data.notifications.length && <p>Nenhuma comunicação gerada. A primeira será criada quando uma etapa for concluída.</p>}</div>
    </section>
  </div>;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

function parseStringArray(value: string) {
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

function parseAgentCandidates(value: string): Array<{ agentId: string; name: string; score: number; price: number }> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      const row = item as Record<string, unknown>;
      return { agentId: String(row.agentId ?? ""), name: String(row.name ?? row.agentId ?? "Service"), score: Number(row.score ?? 0), price: Number(row.price ?? 0) };
    }).filter((item) => item.agentId);
  } catch { return []; }
}

function stageNumber(category: string) {
  const index = supplyChainChecklist.findIndex((item) => item.category === category);
  return index >= 0 ? `STAGE ${String(index + 1).padStart(2, "0")}` : "SUPPLY CHAIN";
}

function fileIcon(name: string) {
  const extension = name.split(".").pop()?.toUpperCase() || "DOC";
  return ["PDF", "XLS", "XLSX", "CSV", "ZIP", "KML", "KMZ", "JSON", "GEOJSON"].includes(extension) ? extension.slice(0, 4) : "DOC";
}

const commercialServices = [
  { key: "eudr-readiness", name: "EUDR Readiness Check", description: "Diagnóstico do fornecedor brasileiro, gaps documentais e plano de adequação.", deliverable: "Readiness report + action plan" },
  { key: "car-geolocation", name: "CAR & Geolocation Pack", description: "CAR/SICAR, geometria, mapa de satélite e dossiê da origem para uso no DDS.", deliverable: "CAR dossier + GeoJSON + map" },
  { key: "supplier-dd", name: "Supplier Due Diligence", description: "Identidade, legalidade, IBAMA, certificados e cadeia documental do fornecedor.", deliverable: "Supplier DD report" },
  { key: "complete-dds", name: "Complete Pre-DDS EUDR", description: "Processo completo, supply chain STAGE 01–13 e dossiê em inglês para revisão do operador europeu.", deliverable: "English Pre-DDS + complete dossier" },
] as const;

function BrazilClientPortal({ suppliers, operations, documents, properties, actions, openOperationDetails, showNotice }: {
  suppliers: SupplierRecord[];
  operations: OperationRecord[];
  documents: DocumentRecord[];
  properties: MapProperty[];
  actions: ExceptionActionRecord[];
  openOperationDetails: (operation: OperationRecord) => void;
  showNotice: (message: string) => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ? String(suppliers[0].id) : "");
  const [paymentStatus, setPaymentStatus] = useState<IntegrationStatusRecord | null>(null);
  const [checkingOut, setCheckingOut] = useState("");
  const supplier = suppliers.find((item) => String(item.id) === supplierId) ?? suppliers[0];
  const clientOperations = supplier ? operations.filter((operation) => operation.supplierId === supplier.id || operation.supplierName === supplier.legalName) : [];
  const operationIds = new Set(clientOperations.map((operation) => operation.id));
  const operationRefs = new Set(clientOperations.map((operation) => operation.reference));
  const clientDocuments = documents.filter((document) => operationIds.has(document.operationId));
  const linkedCarCodes = new Set(clientOperations.flatMap((operation) => parsePropertyIds(operation.propertyIds)));
  const clientProperties = properties.filter((property) => linkedCarCodes.has(property.id));
  const openRisks = actions.filter((action) => operationRefs.has(action.operationReference) && action.status !== "Resolvido");
  const evidenceReadiness = clientOperations.length ? Math.round(clientOperations.reduce((sum, operation) => sum + operation.readiness, 0) / clientOperations.length) : 0;
  const hasGeolocation = clientOperations.length > 0 && clientOperations.every((operation) => {
    const ids = parsePropertyIds(operation.propertyIds);
    return ids.length > 0 && ids.every((id) => properties.some((property) => property.id === id && (property.geometry?.length ?? 0) >= 4));
  });
  const hasLegality = clientDocuments.some((document) => /ibama|certid|legalidade|licen[cç]a|dof|fsc|pefc/i.test(`${document.category} ${document.fileName}`));
  const hasOperatorData = clientOperations.length > 0 && clientOperations.every((operation) => operation.product && operation.hsCode && operation.euImporter);
  const hasEori = clientOperations.length > 0 && clientOperations.every((operation) => Boolean(operation.euOperatorEori));

  useEffect(() => {
    let activeRequest = true;
    fetch(`/api/payments?t=${Date.now()}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { integrations?: IntegrationStatusRecord[] };
        if (activeRequest) setPaymentStatus((data.integrations ?? []).find((item) => item.id === "stripe") ?? null);
      })
      .catch(() => { if (activeRequest) setPaymentStatus(null); });
    return () => { activeRequest = false; };
  }, []);

  async function startCheckout(catalogKey: string) {
    if (!paymentStatus?.live) {
      showNotice("Checkout instalado, mas o Stripe ainda aguarda as credenciais comerciais reais.");
      return;
    }
    setCheckingOut(catalogKey);
    try {
      const response = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stripe_checkout", catalogKey, operationId: clientOperations[0]?.id }) });
      const data = await response.json() as { checkoutUrl?: string; error?: string };
      if (!response.ok || !data.checkoutUrl) throw new Error(data.error || "Não foi possível abrir o checkout.");
      window.location.assign(data.checkoutUrl);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Checkout indisponível.");
    } finally {
      setCheckingOut("");
    }
  }

  const gates = [
    ["1", "Produto & participantes", hasOperatorData ? "Pronto" : "Pendente", "Produto, HS/CN, fornecedor, exportador e operador/importador UE."],
    ["2", "Origem & geolocalização", hasGeolocation ? "Pronto" : "Pendente", "Todos os imóveis de produção precisam estar vinculados com geometria utilizável."],
    ["3", "Legalidade no Brasil", hasLegality ? "Em evidência" : "Pendente", "IBAMA, licenças, DOF/GF e demais evidências aplicáveis ao produto e à cadeia."],
    ["4", "Risk Assessment · Art. 10", "Revisão obrigatória", "Brasil está em risco padrão; a conclusão de risco negligenciável exige avaliação documentada."],
    ["5", "DDS & operador europeu", hasEori && evidenceReadiness === 100 && !openRisks.length ? "Pronto para revisão" : "Pendente", "EORI, cadeia completa, pendências resolvidas e validação final do operador responsável."],
  ];

  return <section className="module-page client-portal-page">
    <header className="client-portal-hero">
      <div><p className="eyebrow">FASE 1 · FORNECEDORES E EXPORTADORES BRASILEIROS</p><h2>Portal do Cliente ExportaTrust</h2><p>Da adequação documental no Brasil ao pacote pré-DDS em inglês para o operador europeu.</p></div>
      <div className="client-deadline"><span>EUDR</span><b>Brasil · risco padrão</b><small>Operadores UE grandes/médios: aplicação a partir de 30/12/2026</small></div>
    </header>

    <div className="client-role-note"><span>i</span><div><b>Nosso cliente brasileiro prepara a evidência; a responsabilidade formal da DDS permanece com o operador abrangido na UE.</b><p>A ExportaTrust organiza, valida e entrega o pacote de due diligence para reduzir o trabalho do importador/operador europeu. O relatório pré-DDS não vira declaração oficial até a validação e transmissão no EUDR Information System.</p></div></div>

    <section className="panel client-account-card">
      <div><p className="eyebrow">EMPRESA EM ACOMPANHAMENTO</p><h3>{supplier?.legalName || "Nenhum fornecedor cadastrado"}</h3>{supplier && <p>{supplier.taxId} · {supplier.city}/{supplier.state} · {supplier.certifications}</p>}</div>
      <label>Selecionar empresa<select value={supplier ? String(supplier.id) : ""} onChange={(event) => setSupplierId(event.target.value)}><option value="">Selecione</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.legalName}</option>)}</select></label>
    </section>

    <div className="client-metrics">
      <article><strong>{clientOperations.length}</strong><span>processos EUDR</span></article>
      <article><strong>{clientProperties.length}</strong><span>origens CAR</span></article>
      <article><strong>{clientDocuments.length}</strong><span>documentos de processo</span></article>
      <article><strong>{evidenceReadiness}%</strong><span>completude documental média</span></article>
      <article className={openRisks.length ? "attention" : ""}><strong>{openRisks.length}</strong><span>pendências abertas</span></article>
    </div>

    <section className="panel client-flow-panel">
      <div className="client-section-heading"><div><p className="eyebrow">JORNADA DO CLIENTE</p><h3>Uma empresa, um processo, uma entrega clara</h3></div></div>
      <div className="client-flow">
        {[['01','Contratar','Escolha o serviço e confirme o pagamento.'],['02','Enviar','Cadastre a operação e anexe cada documento na etapa correta.'],['03','Validar','ExportaTrust + agentes analisam CAR, legalidade, risco e consistência.'],['04','Receber','Baixe o Pre-DDS e o dossiê em inglês para o operador europeu.']].map(([number,title,copy]) => <article key={number}><span>{number}</span><b>{title}</b><p>{copy}</p></article>)}
      </div>
    </section>

    <section className="client-two-column">
      <article className="panel client-regulatory-gates"><div className="client-section-heading"><div><p className="eyebrow">REGULATORY GATE</p><h3>O que falta para o pacote EUDR</h3></div></div>{gates.map(([number,title,status,copy]) => <div key={number} className={`client-gate ${status === "Pronto" || status === "Pronto para revisão" || status === "Em evidência" ? "ready" : "pending"}`}><span>{number}</span><div><b>{title}</b><p>{copy}</p></div><em>{status}</em></div>)}</article>
      <article className="panel client-process-panel"><div className="client-section-heading"><div><p className="eyebrow">MEUS PROCESSOS</p><h3>Acompanhamento e entregas</h3></div><span>{clientOperations.length}</span></div><div className="client-process-list">{clientOperations.map((operation) => { const docs = clientDocuments.filter((document) => document.operationId === operation.id).length; const risks = openRisks.filter((action) => action.operationReference === operation.reference).length; return <article key={operation.id}><header><div><b>{operation.reference}</b><span>{operation.product} · {operation.destinationCountry}</span></div><strong>{operation.readiness}%</strong></header><div><span>{docs} docs</span><span>{parsePropertyIds(operation.propertyIds).length} CAR</span><span>{risks ? `${risks} pendência(s)` : "sem pendência aberta"}</span></div><footer><button onClick={() => openOperationDetails(operation)}>Acompanhar processo</button><a href={`/api/eudr-report?operationId=${operation.id}&attachments=1&lang=en&mode=test`} target="_blank" rel="noreferrer">Baixar TEST Pre-DDS</a></footer></article>; })}{!clientOperations.length && <div className="stage-document-empty">Nenhum processo vinculado a esta empresa.</div>}</div></article>
    </section>

    <section className="client-services-section"><div className="client-section-heading"><div><p className="eyebrow">SERVIÇOS EXPORTATRUST</p><h3>Contrate conforme a necessidade</h3><p>O checkout será aberto no Stripe e poderá oferecer cartão/Pix quando as credenciais comerciais estiverem habilitadas.</p></div><span className={`client-payment-state ${paymentStatus?.live ? "live" : "waiting"}`}>{paymentStatus?.live ? "CHECKOUT ATIVO" : "CHECKOUT AGUARDANDO CREDENCIAL"}</span></div><div className="client-service-grid">{commercialServices.map((service) => <article key={service.key}><span>DDS</span><h4>{service.name}</h4><p>{service.description}</p><small>Entrega: {service.deliverable}</small><button disabled={Boolean(checkingOut)} onClick={() => startCheckout(service.key)}>{checkingOut === service.key ? "Abrindo checkout…" : paymentStatus?.live ? "Contratar serviço →" : "Pagamento a configurar"}</button></article>)}</div></section>
  </section>;
}

function ReportsModule({ operations, openOperationDetails }: { operations: OperationRecord[]; openOperationDetails: (operation: OperationRecord) => void }) {
  return (
    <section className="module-page">
      <header className="module-header"><div><p className="eyebrow">CENTRAL DE SAÍDAS</p><h2>Relatórios EUDR por processo</h2><p>Consulte a prontidão e gere o dossiê completo do processo selecionado.</p></div></header>
      <div className="report-grid process-report-grid">
        {operations.map((operation) => <article className="report-card" key={operation.id}>
          <span className="report-icon">DDS</span>
          <div><h3>{operation.reference}</h3><p>{operation.product} · {operation.destinationCountry}</p><small>{operation.supplierName}</small></div>
          <span className={`report-status ${operation.readiness < 100 ? "pending" : ""}`}>{operation.readiness}%</span>
          <button onClick={() => openOperationDetails(operation)}>Revisar processo →</button>
          <a href={`/api/eudr-report?operationId=${operation.id}&attachments=1&lang=en&mode=test`} target="_blank" rel="noreferrer">Gerar TEST EUDR →</a>
        </article>)}
        {!operations.length && <div className="empty-table">Cadastre um processo para habilitar os relatórios.</div>}
      </div>
    </section>
  );
}

function RisksModule({ actions, operations, openOperationDetails, onActionsChange }: { actions: ExceptionActionRecord[]; operations: OperationRecord[]; openOperationDetails: (operation: OperationRecord) => void; onActionsChange: (actions: ExceptionActionRecord[]) => void }) {
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ operationReference: operations[0]?.reference || "", alertText: "", responsibleName: "", responsibleEmail: "", dueDate: "", message: "" });
  const openActions = actions.filter((action) => action.status !== "Resolvido");

  async function createRisk() {
    if (!form.operationReference || !form.alertText || !form.responsibleName || !form.responsibleEmail || !form.dueDate || !form.message) { setError("Preencha todos os campos do plano de ação."); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/exception-actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json() as { action?: ExceptionActionRecord; error?: string };
      if (!response.ok || !data.action) throw new Error(data.error || "Não foi possível registrar o risco.");
      onActionsChange([data.action, ...actions]);
      const subject = encodeURIComponent(`ExportaTrust EUDR · Plano de ação · ${form.operationReference}`);
      const body = encodeURIComponent(`${form.responsibleName},\n\n${form.message}\n\nPrazo: ${form.dueDate}\nProcesso: ${form.operationReference}\nRegistro: AÇÃO-${data.action.id}`);
      setForm({ operationReference: form.operationReference, alertText: "", responsibleName: "", responsibleEmail: "", dueDate: "", message: "" });
      setFormOpen(false);
      window.location.href = `mailto:${encodeURIComponent(data.action.responsibleEmail)}?subject=${subject}&body=${body}`;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao registrar risco."); }
    finally { setSaving(false); }
  }

  async function resolveRisk(action: ExceptionActionRecord) {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/exception-actions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: action.id }) });
      const data = await response.json() as { action?: ExceptionActionRecord; error?: string };
      if (!response.ok || !data.action) throw new Error(data.error || "Não foi possível concluir o plano.");
      onActionsChange(actions.map((item) => item.id === action.id ? data.action! : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao concluir plano."); }
    finally { setSaving(false); }
  }

  return <section className="module-page">
    <header className="module-header"><div><p className="eyebrow">MATRIZ DE RISCO</p><h2>Riscos e planos de ação</h2><p>Centralize riscos por processo, responsáveis, prazos e situação da mitigação.</p></div><button className="primary" onClick={() => setFormOpen((open) => !open)}>{formOpen ? "Fechar" : "Novo risco +"}</button></header>
    {formOpen && <section className="panel risk-entry-panel"><div><label>Processo *<select value={form.operationReference} onChange={(event) => setForm({ ...form, operationReference: event.target.value })}><option value="">Selecione</option>{operations.map((operation) => <option key={operation.id} value={operation.reference}>{operation.reference}</option>)}</select></label><label>Risco / pendência *<input value={form.alertText} onChange={(event) => setForm({ ...form, alertText: event.target.value })} placeholder="Ex.: Certificado ambiental vencido" /></label><label>Responsável *<input value={form.responsibleName} onChange={(event) => setForm({ ...form, responsibleName: event.target.value })} /></label><label>E-mail *<input type="email" value={form.responsibleEmail} onChange={(event) => setForm({ ...form, responsibleEmail: event.target.value })} /></label><label>Prazo *<input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label><label className="wide">Plano / mensagem *<textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Descreva a evidência necessária e o que deve ser corrigido." /></label></div>{error && <p className="risk-form-error">{error}</p>}<footer><button className="primary" disabled={saving} onClick={createRisk}>{saving ? "Registrando…" : "Registrar e preparar e-mail"}</button></footer></section>}
    {!formOpen && error && <div className="agent-error"><span>{error}</span></div>}
    <div className="module-stats">
      <article className="module-stat"><strong>{actions.length}</strong><span>riscos registrados</span></article>
      <article className="module-stat alert"><strong>{openActions.length}</strong><span>ações abertas</span></article>
      <article className="module-stat"><strong>{actions.filter((item) => item.status === "Resolvido").length}</strong><span>mitigados</span></article>
      <article className="module-stat"><strong>{operations.filter((operation) => !openActions.some((action) => action.operationReference === operation.reference)).length}</strong><span>processos sem risco aberto</span></article>
    </div>
    <article className="panel module-table-panel"><div className="module-table-wrap"><table className="module-table">
      <thead><tr><th>Risco identificado</th><th>Processo</th><th>Responsável</th><th>Prazo</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody>{actions.map((action) => {
        const operation = operations.find((item) => item.reference === action.operationReference);
        return <tr key={action.id}><td>{action.alertText}</td><td>{action.operationReference}</td><td>{action.responsibleName}</td><td>{action.dueDate}</td><td><span className={`table-status ${action.status.toLowerCase()}`}>{action.status}</span></td><td><button disabled={!operation} onClick={() => operation && openOperationDetails(operation)}>Abrir processo →</button>{action.status !== "Resolvido" && <button disabled={saving} onClick={() => resolveRisk(action)}>Marcar resolvido ✓</button>}</td></tr>;
      })}{!actions.length && <tr><td colSpan={6} className="empty-table">Nenhum risco ou plano de ação registrado.</td></tr>}</tbody>
    </table></div></article>
  </section>;
}

type SecurityControl = { id: number; name: string; state: "operational" | "attention" | "prepared" | "testing" | "critical"; detail: string };
type SecurityMember = { id: number; role: string; status: string; email: string; fullName: string; lastLoginAt: string | null };
type SecurityPayload = {
  context: InitialAppData["security"];
  organizations: Array<{ id: number; name: string; slug: string; taxId: string; status: string; role: string }>;
  members: SecurityMember[];
  auditLogs: Array<{ id: number; actorEmail: string; action: string; entityType: string; entityId: string; eventHash: string; createdAt: string }>;
  backups: Array<{ id: number; contentHash: string; sizeBytes: number; status: string; createdAt: string }>;
  integrity: Array<{ id: number; documentType: string; fileName: string; sha256: string; generatedBy: string; createdAt: string }>;
  auditChain: { valid: boolean; checked: number; lastHash?: string };
  legal: { termsVersion: string; termsAccepted: boolean; privacyAccepted: boolean };
  infrastructure: { database: boolean; objectStorage: boolean; authentication: string; recovery: string; environment: string; backupAutomation: { enabled: boolean; frequencyHours: number; ranNow: boolean; lastRunAt: string; nextRunAt: string } };
  monitoring: { openCount: number; events: Array<{ id: number; level: string; source: string; message: string; status: string; occurredAt: string }> };
  controls: SecurityControl[];
};

function SecurityGovernanceModule() {
  const [data, setData] = useState<SecurityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [invite, setInvite] = useState({ fullName: "", email: "", role: "cliente" });
  const [newOrganization, setNewOrganization] = useState({ name: "", taxId: "" });
  const load = () => {
    setLoading(true);
    fetch(`/api/security?t=${Date.now()}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as SecurityPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Segurança indisponível.");
      setData(payload); setError("");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Segurança indisponível.")).finally(() => setLoading(false));
  };
  useEffect(() => {
    let activeRequest = true;
    fetch(`/api/security?t=${Date.now()}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as SecurityPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Segurança indisponível.");
      if (activeRequest) { setData(payload); setError(""); }
    }).catch((reason) => { if (activeRequest) setError(reason instanceof Error ? reason.message : "Segurança indisponível."); }).finally(() => { if (activeRequest) setLoading(false); });
    return () => { activeRequest = false; };
  }, []);
  const post = async (body: Record<string, unknown>, label: string) => {
    setAction(label); setError("");
    try {
      const response = await fetch("/api/security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Ação não concluída.");
      if (body.action === "inviteUser") setInvite({ fullName: "", email: "", role: "cliente" });
      if (["switchOrganization", "createOrganization"].includes(String(body.action))) window.location.reload();
      else load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ação não concluída."); }
    finally { setAction(""); }
  };
  if (loading && !data) return <section className="module-page"><div className="panel security-loading">Verificando governança, isolamento e integridade…</div></section>;
  if (!data) return <section className="module-page"><div className="panel integration-error"><b>Não foi possível abrir a Central de Segurança</b><span>{error}</span><button onClick={load}>Tentar novamente</button></div></section>;
  const operational = data.controls.filter((control) => control.state === "operational").length;
  return <section className="module-page security-page">
    <header className="module-header security-hero"><div><p className="eyebrow">SECURITY & GOVERNANCE</p><h2>Central de Segurança e LGPD</h2><p>Controle de identidade, empresas, perfis, documentos, auditoria, backups e integridade dos dossiês EUDR.</p></div><div><span className={data.auditChain.valid ? "security-seal valid" : "security-seal invalid"}>{data.auditChain.valid ? "✓ Cadeia íntegra" : "! Verificar auditoria"}</span><button className="primary" onClick={load}>Atualizar ↻</button></div></header>
    {error && <div className="agent-error"><span>{error}</span></div>}
    <div className="module-stats security-stats"><article className="module-stat"><strong>{operational}/12</strong><span>controles operacionais</span></article><article className="module-stat"><strong>{data.members.length}</strong><span>usuários da empresa</span></article><article className="module-stat"><strong>{data.auditChain.checked}</strong><span>eventos auditados</span></article><article className={`module-stat ${data.monitoring.openCount ? "alert" : ""}`}><strong>{data.monitoring.openCount}</strong><span>alertas técnicos abertos</span></article></div>
    <section className="security-control-grid">{data.controls.map((control) => <article className={`panel security-control ${control.state}`} key={control.id}><span>{String(control.id).padStart(2, "0")}</span><div><b>{control.name}</b><p>{control.detail}</p></div><em>{control.state === "operational" ? "Operacional" : control.state === "attention" ? "Ação necessária" : control.state === "critical" ? "Crítico" : control.state === "testing" ? "Em teste" : "Preparado"}</em></article>)}</section>
    <div className="security-columns">
      <section className="panel security-section"><header><div><p className="eyebrow">EMPRESA E ACESSOS</p><h3>{data.context.organizationName}</h3><p>Tenant #{data.context.organizationId} · {data.context.email} · {data.context.role}</p></div><span>{data.infrastructure.environment === "production" ? "PRODUÇÃO" : "TESTE"}</span></header>
        <div className="security-company-switch"><label>Empresa ativa<select value={data.context.organizationId} onChange={(event) => post({ action: "switchOrganization", organizationId: Number(event.target.value) }, "switch-org")}>{data.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.role}</option>)}</select></label><small>Todos os processos, documentos, florestas, relatórios e auditorias abaixo pertencem somente à empresa selecionada.</small></div>
        <div className="security-session"><div><b>Identidade protegida</b><small>Login ativo por {data.infrastructure.authentication === "chatgpt-siwc" ? "Sign in with ChatGPT" : "identidade de teste"}. A recuperação é realizada pelo próprio provedor.</small></div><a href="/signout-with-chatgpt?return_to=%2F">Encerrar sessão →</a></div>
        {data.context.role === "administrador" && <><div className="security-create-company"><input placeholder="Nova empresa / cliente" value={newOrganization.name} onChange={(event) => setNewOrganization({ ...newOrganization, name: event.target.value })} /><input placeholder="CNPJ ou VAT ID" value={newOrganization.taxId} onChange={(event) => setNewOrganization({ ...newOrganization, taxId: event.target.value })} /><button disabled={newOrganization.name.trim().length < 2 || !!action} onClick={() => post({ action: "createOrganization", ...newOrganization }, "create-org")}>{action === "create-org" ? "Criando…" : "Criar empresa isolada +"}</button></div><div className="security-invite"><input placeholder="Nome completo" value={invite.fullName} onChange={(event) => setInvite({ ...invite, fullName: event.target.value })} /><input type="email" placeholder="E-mail do usuário" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /><select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value })}><option value="administrador">Administrador</option><option value="analista">Analista</option><option value="fornecedor">Fornecedor</option><option value="auditor">Auditor</option><option value="cliente">Cliente</option></select><button disabled={!invite.email || !!action} onClick={() => post({ action: "inviteUser", ...invite }, "invite")}>{action === "invite" ? "Salvando…" : "Cadastrar perfil"}</button></div><p className="security-invite-note">Após o cadastro, o usuário entra com o mesmo e-mail e recebe somente o perfil e a empresa definidos aqui.</p></>}
        <div className="security-member-list">{data.members.map((member) => <article key={member.id}><span>{member.fullName?.split(/\s+/).map((item) => item[0]).join("").slice(0, 2).toUpperCase() || "US"}</span><div><b>{member.fullName || member.email}</b><small>{member.email}</small></div>{data.context.role === "administrador" ? <><select aria-label={`Perfil de ${member.email}`} value={member.role} disabled={!!action} onChange={(event) => post({ action: "updateMember", membershipId: member.id, role: event.target.value, status: member.status }, `member-${member.id}`)}><option value="administrador">Administrador</option><option value="analista">Analista</option><option value="fornecedor">Fornecedor</option><option value="auditor">Auditor</option><option value="cliente">Cliente</option></select><button disabled={!!action || member.email === data.context.email} onClick={() => post({ action: "updateMember", membershipId: member.id, role: member.role, status: member.status === "Ativo" ? "Inativo" : "Ativo" }, `member-${member.id}`)}>{member.status}</button></> : <><em>{member.role}</em><i>{member.status}</i></>}</article>)}</div>
      </section>
      <section className="panel security-section"><header><div><p className="eyebrow">PROTEÇÃO E PORTABILIDADE</p><h3>Backups e exportação</h3><p>Backup automático diário, teste não destrutivo de restauração e pacote integral com os documentos originais.</p></div><span>AUTO 24H</span></header><div className="security-automation"><span>✓</span><div><b>Rotina automática ativa</b><small>Último: {new Date(data.infrastructure.backupAutomation.lastRunAt).toLocaleString("pt-BR")} · Próximo: {new Date(data.infrastructure.backupAutomation.nextRunAt).toLocaleString("pt-BR")}</small></div></div><div className="security-actions"><button className="primary" disabled={!!action} onClick={() => post({ action: "backup" }, "backup")}>{action === "backup" ? "Criando snapshot…" : "Criar backup agora"}</button><button className="secondary" disabled={!!action || !data.backups.length} onClick={() => post({ action: "verifyBackup" }, "verify")}>{action === "verify" ? "Verificando…" : "Verificar integridade"}</button><button className="secondary" disabled={!!action || !data.backups.length} onClick={() => post({ action: "restoreDrill" }, "restore")}>{action === "restore" ? "Testando…" : "Testar restauração"}</button><a href="/api/security?export=archive">Exportação integral ↓</a><a href="/api/security?export=1">Somente dados JSON ↓</a></div>
        <div className="security-backups">{data.backups.slice(0, 5).map((backup) => <article key={backup.id}><span>✓</span><div><b>Snapshot {new Date(backup.createdAt).toLocaleString("pt-BR")}</b><small>{backup.sizeBytes.toLocaleString("pt-BR")} bytes · SHA-256 {backup.contentHash.slice(0, 20)}…</small></div></article>)}{!data.backups.length && <p>Nenhum snapshot criado. O primeiro backup preservará banco, trilha, metadados e referências dos documentos.</p>}</div>
      </section>
    </div>
    <div className="security-columns">
      <section className="panel security-section"><header><div><p className="eyebrow">LGPD & CONTRATOS</p><h3>Documentos jurídicos</h3><p>Versão {data.legal.termsVersion}. Minutas sujeitas à revisão jurídica antes do lançamento.</p></div></header><div className="legal-actions"><a href="/legal/terms" target="_blank">Termos de Uso ↗</a><button className={data.legal.termsAccepted ? "accepted" : ""} disabled={data.legal.termsAccepted || !!action} onClick={() => post({ action: "acceptLegal", documentType: "terms" }, "terms")}>{data.legal.termsAccepted ? "✓ Aceito" : "Li e aceito"}</button><a href="/legal/privacy" target="_blank">Privacidade/LGPD ↗</a><button className={data.legal.privacyAccepted ? "accepted" : ""} disabled={data.legal.privacyAccepted || !!action} onClick={() => post({ action: "acceptLegal", documentType: "privacy" }, "privacy")}>{data.legal.privacyAccepted ? "✓ Aceito" : "Li e aceito"}</button></div></section>
      <section className="panel security-section"><header><div><p className="eyebrow">AUDITORIA IMUTÁVEL</p><h3>Eventos recentes</h3><p>Cada evento contém o hash do anterior; alteração retroativa rompe a cadeia.</p></div><span>{data.auditChain.valid ? "SHA-256 OK" : "ALERTA"}</span></header><div className="security-audit-list">{data.auditLogs.slice(0, 8).map((log) => <article key={log.id}><span>#{log.id}</span><div><b>{log.action}</b><small>{log.actorEmail} · {new Date(log.createdAt).toLocaleString("pt-BR")}</small></div><code>{log.eventHash.slice(0, 12)}</code></article>)}{!data.auditLogs.length && <p>A trilha começa automaticamente na primeira ação protegida.</p>}</div></section>
    </div>
    <section className="panel security-section security-monitoring"><header><div><p className="eyebrow">MONITORAMENTO DA APLICAÇÃO</p><h3>Erros e disponibilidade</h3><p>Falhas de interface são agrupadas por assinatura; o health check confirma banco e armazenamento.</p></div><span>{data.monitoring.openCount ? `${data.monitoring.openCount} ABERTO(S)` : "SEM ALERTAS"}</span></header><div className="security-audit-list">{data.monitoring.events.slice(0, 8).map((event) => <article key={event.id}><span className={event.level}>!</span><div><b>{event.source}</b><small>{event.message} · {new Date(event.occurredAt).toLocaleString("pt-BR")}</small></div>{event.status === "Aberto" && ["administrador", "analista"].includes(data.context.role) ? <button disabled={!!action} onClick={() => { setAction(`event-${event.id}`); fetch("/api/monitoring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resolve", id: event.id }) }).then(async (response) => { if (!response.ok) throw new Error("Falha ao resolver alerta."); load(); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Falha ao resolver alerta.")).finally(() => setAction("")); }}>Resolver</button> : <code>{event.status}</code>}</article>)}{!data.monitoring.events.length && <p>Nenhum erro capturado para esta empresa.</p>}</div></section>
  </section>;
}

function IntegrationsModule() {
  const [integrations, setIntegrations] = useState<IntegrationStatusRecord[]>([]);
  const [asanaImport, setAsanaImport] = useState<AsanaImportData | null>(null);
  const [agentBrief, setAgentBrief] = useState<AgentBriefData | null>(null);
  const [privateAgent, setPrivateAgent] = useState<PrivateAgentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let activeRequest = true;
    fetch(`/api/integrations?t=${Date.now()}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { integrations?: IntegrationStatusRecord[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Não foi possível verificar as integrações.");
        if (activeRequest) { setIntegrations(data.integrations ?? []); setError(""); }
      })
      .catch((reason) => { if (activeRequest) setError(reason instanceof Error ? reason.message : "Integrações indisponíveis."); })
      .finally(() => { if (activeRequest) setLoading(false); });
    return () => { activeRequest = false; };
  }, [reload]);
  useEffect(() => {
    let activeRequest = true;
    Promise.all([
      fetch(`/api/asana-import?t=${Date.now()}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      fetch(`/api/agent-brief?t=${Date.now()}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      fetch(`/api/agent/status?t=${Date.now()}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
    ]).then(([asanaData, briefData, privateAgentData]) => {
      if (!activeRequest) return;
      setAsanaImport(asanaData as AsanaImportData | null);
      setAgentBrief(briefData as AgentBriefData | null);
      setPrivateAgent(privateAgentData as PrivateAgentStatus | null);
    }).catch(() => undefined);
    return () => { activeRequest = false; };
  }, [reload]);
  const ready = integrations.filter((item) => item.state === "operational" || item.state === "sandbox").length;
  const credentials = integrations.filter((item) => item.state === "credential_required").length;
  const groups: Array<[IntegrationStatusRecord["category"], string]> = [["data", "Dados oficiais & geoespacial"], ["intelligence", "OCR & inteligência documental"], ["agents", "Agent Discovery"], ["eudr", "EUDR Information System"], ["payments", "Pagamentos"]];
  return <section className="module-page integrations-page">
    <header className="module-header"><div><p className="eyebrow">INFRAESTRUTURA OPERACIONAL</p><h2>Integrações & Pagamentos</h2><p>Estado real dos conectores. Credenciais e chaves ficam somente no servidor; nenhum segredo é armazenado no navegador ou no banco do app.</p></div><button className="primary" onClick={() => { setLoading(true); setReload((value) => value + 1); }}>Verificar agora ↻</button></header>
    <div className="module-stats integration-stats"><article className="module-stat"><strong>{integrations.length}</strong><span>conectores instalados</span></article><article className="module-stat"><strong>{ready}</strong><span>operacionais / sandbox</span></article><article className="module-stat"><strong>{credentials}</strong><span>aguardando credencial</span></article><article className="module-stat"><strong>0</strong><span>provedores demo</span></article></div>
    {loading && <div className="panel integration-loading">Verificando conectores no servidor…</div>}
    {error && <div className="panel integration-error"><b>Falha ao verificar integrações</b><span>{error}</span><button onClick={() => { setLoading(true); setReload((value) => value + 1); }}>Tentar novamente</button></div>}
    <section className="panel migration-bridge">
      <header><div><p className="eyebrow">MIGRAÇÃO CONTROLADA</p><h3>Asana · VLP EXPORTAÇÃO</h3><p>Somente este projeto é aceito. Tarefas entram primeiro em uma fila de revisão; modelos, pré-operações, concluídos e itens de FINALIZADO/CANCELADO são separados automaticamente.</p></div><span>FONTE DELIMITADA</span></header>
      <div className="migration-metrics">
        <article><strong>{asanaImport?.summary.total ?? 0}</strong><span>itens preparados</span></article>
        <article><strong>{asanaImport?.summary.review ?? 0}</strong><span>aguardando revisão</span></article>
        <article><strong>{asanaImport?.summary.missingOwner ?? 0}</strong><span>sem responsável</span></article>
        <article><strong>{asanaImport?.summary.missingDueDate ?? 0}</strong><span>sem prazo</span></article>
      </div>
      <div className="migration-map" role="table" aria-label="Mapeamento Asana para Export Control">
        <div role="row"><b role="cell">PEDIDO NOVO / ASSINATURA</b><span role="cell">Pedido confirmado</span></div>
        <div role="row"><b role="cell">EM PRODUÇÃO</b><span role="cell">Produção</span></div>
        <div role="row"><b role="cell">EMBARQUE</b><span role="cell">Booking / logística</span></div>
        <div role="row"><b role="cell">DOCUMENTAÇÃO</b><span role="cell">Set documental</span></div>
        <div role="row"><b role="cell">PÓS-VENDA</b><span role="cell">Em trânsito / chegada</span></div>
      </div>
      <footer><span>Projeto autorizado: <b>{asanaImport?.project.name ?? "VLP EXPORTAÇÃO"}</b></span><span>Importação real somente após revisão humana</span></footer>
    </section>
    <section className="panel personal-agent-bridge"><div><p className="eyebrow">AGENTE PARTICULAR</p><h3>API protegida para Gmail, Asana e automações</h3><p>Infraestrutura server-side em modo simulado: eventos externos entram por Bearer token, documentos são classificados por operação e ações sensíveis vão para aprovação humana.</p></div><div className="agent-brief-status"><span>{privateAgent?.api.mode ?? "SIMULATED_EVENTS_ONLY"}</span><strong>{privateAgent?.api.active ? "API ATIVA" : "VERIFICANDO"}</strong><small>Token integral nunca é exibido no painel</small><code>/api/agent/*</code></div></section>
    <section className="private-agent-dashboard">
      <article><span>Eventos processados</span><strong>{privateAgent?.metrics.eventsProcessed ?? 0}</strong><small>{privateAgent?.metrics.eventsInReview ?? 0} em revisão</small></article>
      <article className={(privateAgent?.metrics.approvalsPending ?? 0) ? "attention" : ""}><span>Aprovações humanas</span><strong>{privateAgent?.metrics.approvalsPending ?? 0}</strong><small>envio, financeiro, conclusão e bancos</small></article>
      <article><span>Documentos do agente</span><strong>{privateAgent?.metrics.documentsProcessed ?? 0}</strong><small>classificação por STAGE</small></article>
      <article><span>Último evento</span><strong>{privateAgent?.lastEvent?.source ?? "—"}</strong><small>{privateAgent?.lastEvent?.matchConfidence ? `match ${privateAgent.lastEvent.matchConfidence}` : "sem evento recebido"}</small></article>
    </section>
    <section className="panel agent-api-policy"><header><div><p className="eyebrow">FASE API — AGENTE PARTICULAR</p><h3>Contrato técnico implantado</h3><p>Primeiro testamos com eventos simulados e dados controlados. Gmail e Asana reais ficam fora desta versão até validação end-to-end.</p></div><span>HUMAN-IN-THE-LOOP</span></header><div>{(privateAgent?.endpoints ?? ["/api/agent/inbox-events", "/api/agent/operations", "/api/agent/daily-brief", "/api/agent/approvals"]).map((endpoint) => <code key={endpoint}>{endpoint}</code>)}</div></section>
    {!loading && !error && groups.map(([category, title]) => {
      const rows = integrations.filter((item) => item.category === category);
      if (!rows.length) return null;
      return <section className="integration-group" key={category}><header><h3>{title}</h3><span>{rows.length}</span></header><div className="integration-grid">{rows.map((item) => <article className="panel integration-card" key={item.id}>
        <div className="integration-card-head"><span className={`integration-state ${item.state}`}>{item.label}</span><small>{item.provider}</small></div>
        <h3>{item.name}</h3><p>{item.detail}</p>
        <footer><span>{item.live ? "● CONEXÃO REAL" : item.state === "sandbox" ? "◐ AMBIENTE CONTROLADO" : "○ SEM TRANSAÇÃO REAL"}</span><code>{item.id}</code></footer>
      </article>)}</div></section>;
    })}
    <div className="panel integration-policy"><b>Política de segurança financeira</b><p>Stripe usa Checkout hospedado para cartão/Pix. x402 nasce em Base testnet e só muda para mainnet por configuração explícita. Jobs externos continuam sujeitos ao nível de autonomia, aprovação humana, limite por transação, limite diário e allow/block list do Agent Control.</p></div>
  </section>;
}

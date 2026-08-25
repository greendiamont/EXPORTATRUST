Warning: truncated output (original token count: 83070)
Total output lines: 3814

"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
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
type AiDocumentReport = {
  document: { id: number; operationId: number; fileName: string; category: string };
  analysis?: {
    documentType: string; summary: string; language: string; confidence: number;
    fields: { invoiceNumber: string | null; blNumber: string | null; exporter: string | null; importer: string | null; destinationCountry: string | null; destinationPort: string | null; currency: string | null; totalAmount: string | null; balanceDue: string | null; paymentTerms: string | null; issueDate: string | null; containers: number | null };
    checks: Array<{ name: string; status: "ok" | "warning" | "missing"; details: string; evidence: string }>;
    warnings: string[];
  };
  error?: string;
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
type GmailStatusData = { configured: boolean; connected: boolean; connection: { gmailAddress: string; status: string; scopesJson: string; lastSyncAt: string | null; lastError: string; connectedAt: string } | null; config: { clientIdMasked: string; redirectUri: string; secretStored: boolean; source: string } | null; canConfigure: boolean; scopes: string[] };
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
  const [active, setActive] = useState(() => {
    if (typeof window === "undefined") return "Dashboard";
    const requested = new URLSearchParams(window.location.search).get("module");
    return requested && nav.includes(requested) ? requested : "Dashboard";
  });
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
              <label>Local da produção (fornecedor)<input readOnly value={operationForm.productionLocation} placeholder="Preenchido ao selecionar o fornece…33070 tokens truncated…report-builder">
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
  const [aiDocumentReports, setAiDocumentReports] = useState<AiDocumentReport[]>([]);

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
    setAction("ai-operation-check");
    setAiReportVisible(false);
    setAiDocumentReports([]);
    try {
      const controlResponse = await fetch("/api/export-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: operation.id, action: "country-check" }) });
      const controlPayload = await controlResponse.json() as ExportControlData & { error?: string };
      if (!controlResponse.ok) throw new Error(controlPayload.error || "Não foi possível verificar as etapas da operação.");
      setData(controlPayload);
      const reports: AiDocumentReport[] = [];
      for (const document of documents) {
        try {
          const response = await fetch("/api/ai/document-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: document.id }) });
          const payload = await response.json() as AiDocumentReport & { error?: string };
          reports.push(response.ok ? payload : { document: { id: document.id, operationId: operation.id, fileName: document.fileName, category: document.category }, error: payload.error || "Documento não analisado." });
        } catch (error) {
          reports.push({ document: { id: document.id, operationId: operation.id, fileName: document.fileName, category: document.category }, error: error instanceof Error ? error.message : "Documento não analisado." });
        }
        setAiDocumentReports([...reports]);
      }
      setAiReportVisible(true);
      const failures = reports.filter((report) => report.error).length;
      showNotice(failures ? `Relatório concluído com ${failures} documento(s) que exigem revisão manual.` : `Operação e ${reports.length} documento(s) verificados pela IA.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Falha ao verificar a operação com IA.");
    } finally { setAction(""); }
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
          <button className="ai-run-button" disabled={Boolean(action)} onClick={runAiOperationCheck}>{action === "ai-operation-check" ? `VERIFICANDO ${aiDocumentReports.length}/${documents.length} DOCUMENTOS…` : "VERIFICAR OPERAÇÃO COM IA"}</button>
          {aiReportVisible && <div className="ai-operation-report">
            <header><div><b>{data.compliance.verdict}</b><span>{data.compliance.opinion}</span></div><strong>{Math.round((data.compliance.score + data.compliance.stageScore) / 2)}%</strong></header>
            <section><h4>Pendências encontradas</h4>{data.compliance.requirements.filter((item) => item.required && !item.present).map((item) => <article key={item.key} className="missing"><span>!</span><div><b>{item.label}</b><small>{item.reason}</small></div></article>)}{!data.compliance.requirements.some((item) => item.required && !item.present) && <p>✓ Nenhuma exigência documental obrigatória pendente.</p>}</section>
            <section><h4>Status de cada etapa</h4><div className="ai-stage-report">{data.compliance.stages.map((stage) => <article key={stage.code} className={stage.passed ? "ready" : stage.applicable ? "missing" : "conditional"}><span>{stage.passed ? "✓" : stage.applicable ? "!" : "—"}</span><div><b>{String(stage.sequence).padStart(2, "0")} · {stage.title}</b><small>{stage.issue} · {stage.documentCount} documento(s)</small></div><em>{stage.status}</em></article>)}</div></section>
            <section><h4>Leitura dos documentos anexados</h4><div className="ai-stage-report">{aiDocumentReports.map((report) => {
              const missingChecks = report.analysis?.checks.filter((check) => check.status !== "ok").length ?? 0;
              const ready = Boolean(report.analysis) && !missingChecks && !report.analysis?.warnings.length;
              return <article key={report.document.id} className={ready ? "ready" : "missing"}><span>{ready ? "✓" : "!"}</span><div><b>{report.document.fileName}</b><small>{report.error || report.analysis?.summary || "Análise indisponível"}</small>{report.analysis && <small>{report.analysis.documentType} · confiança {Math.round(report.analysis.confidence * 100)}% · {missingChecks} alerta(s)</small>}</div><em>{report.error ? "Revisão manual" : ready ? "Conferido" : "Com ressalvas"}</em></article>;
            })}{!aiDocumentReports.length && <p>Nenhum documento anexado nesta operação.</p>}</div></section>
            <small>Parecer preliminar da IA. A aprovação humana continua obrigatória antes do embarque, envio ao cliente ou alteração financeira.</small>
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
  const [gmail, setGmail] = useState<GmailStatusData | null>(null);
  const [gmailStatusError, setGmailStatusError] = useState("");
  const [showGmailConfig, setShowGmailConfig] = useState(false);
  const [gmailAction, setGmailAction] = useState("");
  const [gmailConfig, setGmailConfig] = useState({ clientId: "", clientSecret: "" });
  const [gmailNotice, setGmailNotice] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail") === "connected") return "Gmail conectado com sucesso. Agora você já pode sincronizar mensagens e anexos.";
    if (params.get("gmail") === "error") return `Falha ao conectar Gmail: ${params.get("reason") || "autorização não concluída"}.`;
    return "";
  });
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
      fetch(`/api/integrations/gmail/status?t=${Date.now()}`, { cache: "no-store" }).then(async (response) => {
        const data = await response.json() as GmailStatusData & { error?: string };
        if (!response.ok) throw new Error(data.error || "Não foi possível verificar o Gmail.");
        return data;
      }),
    ]).then(([asanaData, briefData, privateAgentData, gmailData]) => {
      if (!activeRequest) return;
      setAsanaImport(asanaData as AsanaImportData | null);
      setAgentBrief(briefData as AgentBriefData | null);
      setPrivateAgent(privateAgentData as PrivateAgentStatus | null);
      setGmail(gmailData as GmailStatusData | null);
      setGmailStatusError("");
    }).catch((reason) => setGmailStatusError(reason instanceof Error ? reason.message : "Não foi possível verificar o Gmail."));
    return () => { activeRequest = false; };
  }, [reload]);
  async function runGmailAction(action: "sync" | "disconnect") {
    setGmailAction(action);
    setGmailNotice("");
    try {
      const response = await fetch(`/api/integrations/gmail/${action}`, { method: "POST" });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível concluir a ação no Gmail.");
      setGmailNotice(data.message || (action === "disconnect" ? "Gmail desconectado com segurança." : "Sincronização concluída."));
      setReload((value) => value + 1);
    } catch (reason) { setGmailNotice(reason instanceof Error ? reason.message : "Falha na integração Gmail."); }
    finally { setGmailAction(""); }
  }
  async function saveGmailCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGmailAction("config");
    setGmailNotice("");
    try {
      const response = await fetch("/api/integrations/gmail/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(gmailConfig) });
      const data = await response.json() as { error?: string; clientIdMasked?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar as credenciais.");
      setGmailConfig({ clientId: "", clientSecret: "" });
      setGmailNotice(`Credenciais protegidas e salvas${data.clientIdMasked ? ` (${data.clientIdMasked})` : ""}. Agora clique em Conectar Gmail.`);
      setReload((value) => value + 1);
    } catch (reason) { setGmailNotice(reason instanceof Error ? reason.message : "Falha ao salvar as credenciais."); }
    finally { setGmailAction(""); }
  }
  const ready = integrations.filter((item) => item.state === "operational" || item.state === "sandbox").length;
  const credentials = integrations.filter((item) => item.state === "credential_required").length;
  const groups: Array<[IntegrationStatusRecord["category"], string]> = [["data", "Dados oficiais & geoespacial"], ["intelligence", "OCR & inteligência documental"], ["agents", "Agent Discovery"], ["eudr", "EUDR Information System"], ["payments", "Pagamentos"]];
  return <section className="module-page integrations-page">
    <header className="module-header"><div><p className="eyebrow">INFRAESTRUTURA OPERACIONAL</p><h2>Integrações & Pagamentos</h2><p>Estado real dos conectores. Credenciais e chaves ficam somente no servidor; nenhum segredo é armazenado no navegador ou no banco do app.</p></div><button className="primary" onClick={() => { setLoading(true); setReload((value) => value + 1); }}>Verificar agora ↻</button></header>
    <div className="module-stats integration-stats"><article className="module-stat"><strong>{integrations.length}</strong><span>conectores instalados</span></article><article className="module-stat"><strong>{ready}</strong><span>operacionais / sandbox</span></article><article className="module-stat"><strong>{credentials}</strong><span>aguardando credencial</span></article><article className="module-stat"><strong>0</strong><span>provedores demo</span></article></div>
    {loading && <div className="panel integration-loading">Verificando conectores no servidor…</div>}
    {error && <div className="panel integration-error"><b>Falha ao verificar integrações</b><span>{error}</span><button onClick={() => { setLoading(true); setReload((value) => value + 1); }}>Tentar novamente</button></div>}
    <section className="panel gmail-integration-card">
      <div className="gmail-integration-copy"><p className="eyebrow">GMAIL API · OAUTH 2.0</p><h3>{gmail?.connected ? "Caixa postal conectada" : "Conectar e-mail operacional"}</h3><p>{gmail?.connected ? `Conta ${gmail.connection?.gmailAddress || "Google Workspace"}. O agente lê mensagens e anexos, identifica a operação e envia correspondências incertas para revisão.` : gmail?.configured ? "As credenciais estão prontas. Autorize a conta que o ExportaTrust deverá acompanhar." : "A API está instalada, mas as credenciais ainda precisam ser disponibilizadas no ambiente do ExportaTrust."}</p>{gmail?.connection?.lastSyncAt && <small>Última sincronização: {new Date(gmail.connection.lastSyncAt).toLocaleString("pt-BR")}</small>}{gmail?.connection?.lastError && <small className="gmail-error">Última falha: {gmail.connection.lastError}</small>}{gmailNotice && <div className="gmail-notice">{gmailNotice}</div>}</div>
      <div className="gmail-integration-actions">{gmail?.connected ? <><span className="gmail-connected">✓ CONECTADO</span><button className="primary" disabled={!!gmailAction} onClick={() => runGmailAction("sync")}>{gmailAction === "sync" ? "Sincronizando…" : "Sincronizar agora"}</button><button className="secondary" disabled={!!gmailAction} onClick={() => runGmailAction("disconnect")}>{gmailAction === "disconnect" ? "Desconectando…" : "Desconectar"}</button></> : <><span className={gmail?.configured ? "gmail-ready" : "gmail-waiting"}>{gmail?.configured ? "PRONTO PARA AUTORIZAR" : "AGUARDANDO CREDENCIAIS"}</span>{!gmail?.configured && gmail?.canConfigure && <button className="secondary" type="button" onClick={() => setShowGmailConfig((value) => !value)}>{showGmailConfig ? "Fechar configuração" : "Incluir Gmail"}</button>}<a className={`gmail-connect-button ${gmail?.configured ? "" : "disabled"}`} href={gmail?.configured ? "/api/integrations/gmail/connect" : undefined}>Conectar Gmail</a></>}</div>
    </section>
    {gmailStatusError && <div className="panel integration-error"><b>Falha ao carregar a configuração do Gmail</b><span>{gmailStatusError}</span><button onClick={() => setReload((value) => value + 1)}>Tentar novamente</button></div>}
    {!gmail?.configured && gmail?.canConfigure && showGmailConfig && <form className="panel gmail-config-panel" onSubmit={saveGmailCredentials} autoComplete="off">
      <header><div><p className="eyebrow">CONFIGURAÇÃO SEGURA</p><h3>Credenciais do Google Cloud</h3><p>Copie os dois valores do cliente OAuth criado no Google. O Client Secret será criptografado antes de ser armazenado e nunca voltará a aparecer nesta tela.</p></div><span>SOMENTE ADMINISTRADOR</span></header>
      <label>Google Client ID<input type="text" value={gmailConfig.clientId} onChange={(event) => setGmailConfig((current) => ({ ...current, clientId: event.target.value }))} placeholder="000000000000-xxxx.apps.googleusercontent.com" required spellCheck={false} /></label>
      <label>Google Client Secret<input type="password" value={gmailConfig.clientSecret} onChange={(event) => setGmailConfig((current) => ({ ...current, clientSecret: event.target.value }))} placeholder="Cole o segredo diretamente aqui" required spellCheck={false} /></label>
      <div className="gmail-config-security"><span>🔒</span><p><b>Proteção ativa</b><small>Não envie essas chaves por e-mail ou chat. Salve-as somente por este formulário.</small></p></div>
      <button className="primary" disabled={gmailAction === "config"}>{gmailAction === "config" ? "Criptografando e salvando…" : "Salvar credenciais com segurança"}</button>
    </form>}
    {gmail?.config && gmail?.canConfigure && <section className="panel gmail-config-summary"><div><p className="eyebrow">CREDENCIAL PROTEGIDA</p><h3>{gmail.config.clientIdMasked}</h3><small>URI: {gmail.config.redirectUri}</small></div><span>✓ SECRET ARMAZENADO</span></section>}
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

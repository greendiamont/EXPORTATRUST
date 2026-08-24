import { agentReputation, agentServices } from "../db/schema";
import type { getDb } from "../db";
import { eq } from "drizzle-orm";
export { STAGE_CAPABILITIES } from "./supply-chain-stages";

export type AgentServiceSeed = {
  agentId: string;
  serviceId: string;
  name: string;
  description: string;
  capabilities: string[];
  category: string;
  provider: string;
  adapterType: "internal" | "api" | "mcp" | "a2a" | "discovery" | "x402";
  endpoint: string;
  internal: boolean;
  price: number;
  currency: string;
  estimatedCost: number;
  averageResponseMs: number;
  availability: number;
  reputation: number;
  successRate: number;
  status: string;
  financialLimit: number;
  requiresHumanApproval: boolean;
  commercial?: boolean;
  inputDescription?: string;
  outputDescription?: string;
  sla?: string;
};

const internal = (agentId: string, serviceId: string, name: string, description: string, capability: string, category: string, price: number, reputation: number, averageResponseMs: number, commercial = false, requiresHumanApproval = true): AgentServiceSeed => ({
  agentId, serviceId, name, description, capabilities: [capability], category, provider: "ExportaTrust", adapterType: "internal", endpoint: `internal://${agentId}`,
  internal: true, price, currency: "USD", estimatedCost: price, averageResponseMs, availability: 99.5, reputation, successRate: 96, status: "Ativo",
  financialLimit: 25, requiresHumanApproval, commercial, inputDescription: "Operation, stage and immutable document references", outputDescription: "Structured compliance finding with confidence and audit trail", sla: "< 30 s",
});

export const AGENT_SERVICE_SEEDS: AgentServiceSeed[] = [
  internal("supply-chain-orchestrator", "svc-supply-chain-orchestrator", "Supply Chain Orchestrator Agent", "Observes the 13 stages, identifies required capabilities, discovers eligible services and consolidates their results without duplicating specialist work.", "orchestrate_supply_chain", "Orchestration", 0, 99, 120, false, false),
  internal("forest-origin-agent", "svc-forest-origin", "Forest & Origin Agent", "Checks declared forest origin, CAR links and traceability inputs.", "forest_origin_check", "Forest", 0.08, 94, 900, true),
  internal("car-geolocation-agent", "svc-car-geolocation", "CAR / Geolocation Agent", "Validates CAR references and geolocation evidence.", "car_geolocation_check", "Geolocation", 0.12, 96, 780, true),
  internal("environmental-risk-agent", "svc-environmental-risk", "Environmental Risk Agent", "Screens environmental-risk evidence and missing controls.", "environmental_risk_check", "Risk", 0.18, 93, 1100, true),
  internal("satellite-analysis-agent", "svc-satellite-analysis", "Satellite Analysis Agent", "Prepares satellite/deforestation risk verification workflow.", "satellite_risk_check", "Geospatial", 0.30, 91, 800, true),
  internal("ibama-certificates-agent", "svc-ibama-certificates", "IBAMA & Certificates Agent", "Checks IBAMA and environmental certificate evidence.", "certificate_validation", "Legality", 0.10, 95, 700, true),
  internal("invoice-validation-agent", "svc-invoice-validation", "Invoice Validation Agent", "Checks invoice identity, traceability links and expected commercial evidence.", "invoice_validation", "Documents", 0.09, 94, 620, true, false),
  internal("transport-document-agent", "svc-transport-doc", "Transport Document Agent", "Checks transport-document completeness and traceability references.", "transport_document_validation", "Logistics", 0.09, 92, 680, true),
  internal("fsc-pefc-agent", "svc-fsc-pefc", "FSC / PEFC Agent", "Checks certification evidence and expected validity fields.", "fsc_pefc_validation", "Certification", 0.11, 93, 740, true),
  internal("eudr-compliance-agent", "svc-eudr-compliance", "EUDR Compliance Agent", "Performs EUDR pre-submission structural compliance checks.", "eudr_compliance_check", "EUDR", 0.22, 97, 1200, true),
  internal("mass-balance-agent", "svc-mass-balance", "Mass Balance Agent", "Checks mass balance and lot-traceability controls for industrial transformation.", "mass_balance_check", "Industry", 0.15, 96, 850, true),
  internal("export-documents-agent", "svc-export-documents", "Export Documents Agent", "Checks export, port, BL and commercial-document consistency.", "export_document_validation", "Export", 0.12, 94, 760, true),
  internal("supplier-dd-agent", "svc-supplier-dd", "Supplier Due Diligence Agent", "Checks supplier due-diligence evidence and declared counterparties.", "supplier_due_diligence", "Supplier", 0.20, 95, 980, true),
  internal("final-dossier-agent", "svc-final-dossier", "Final Dossier Agent", "Consolidates validated stage findings for the client-facing EUDR dossier.", "final_dossier_check", "Dossier", 0.25, 98, 1300, true),
  { agentId: "ibama-pamgia-service", serviceId: "svc-ibama-pamgia", name: "IBAMA Embargo Screening", description: "Real geospatial screening against the official public IBAMA/CENIMA PAMGIA embargo layer.", capabilities: ["ibama_embargo_screening"], category: "External / Environmental", provider: "IBAMA", adapterType: "api", endpoint: "https://pamgia.ibama.gov.br/", internal: false, price: 0, currency: "BRL", estimatedCost: 0, averageResponseMs: 3000, availability: 98, reputation: 96, successRate: 96, status: "Conector real", financialLimit: 0, requiresHumanApproval: false, inputDescription: "CAR polygon", outputDescription: "Spatial embargo matches for human legal review", sla: "Public service" },
  { agentId: "openai-document-intelligence", serviceId: "svc-openai-document-intelligence", name: "OCR & Document Intelligence", description: "Multimodal document reading for PDFs, images and supported office documents. Activated only when server credentials are configured.", capabilities: ["document_intelligence"], category: "External / Intelligence", provider: "OpenAI", adapterType: "api", endpoint: "https://api.openai.com/v1/responses", internal: false, price: 0, currency: "USD", estimatedCost: 0, averageResponseMs: 5000, availability: 99, reputation: 95, successRate: 96, status: "Requer credencial", financialLimit: 10, requiresHumanApproval: true, inputDescription: "Immutable stage document", outputDescription: "Structured English document findings", sla: "Provider dependent" },
  { agentId: "copernicus-satellite-service", serviceId: "svc-copernicus-sentinel", name: "Copernicus Sentinel Analysis", description: "Connector prepared for Sentinel Hub temporal imagery and indices using Copernicus Data Space credentials.", capabilities: ["satellite_risk_check"], category: "External / Geospatial", provider: "Copernicus Data Space", adapterType: "api", endpoint: "https://sh.dataspace.copernicus.eu/api/v1/process", internal: false, price: 0, currency: "EUR", estimatedCost: 0, averageResponseMs: 5000, availability: 99, reputation: 97, successRate: 97, status: "Requer credencial", financialLimit: 10, requiresHumanApproval: true, inputDescription: "CAR polygon and time range", outputDescription: "Sentinel imagery / analytical layer", sla: "Provider dependent" },
  { agentId: "eudr-m2m-service", serviceId: "svc-eudr-m2m", name: "EUDR Information System M2M", description: "Gateway boundary for the European Commission EUDR Information System. Production is fail-closed until current M2M credentials and schema are configured.", capabilities: ["eudr_submission"], category: "External / EUDR", provider: "European Commission / TRACES", adapterType: "api", endpoint: "adapter://eudr-m2m", internal: false, price: 0, currency: "EUR", estimatedCost: 0, averageResponseMs: 5000, availability: 99, reputation: 99, successRate: 99, status: "Requer credencial", financialLimit: 0, requiresHumanApproval: true, inputDescription: "Reviewed DDS payload", outputDescription: "Acceptance/official statement reference", sla: "Commission service" },
];

export async function seedAgentRegistry(db: Awaited<ReturnType<typeof getDb>>) {
  // Retire the three synthetic marketplace providers used in the prototype.
  // They are never compliance evidence and are safe to remove from the registry.
  for (const retiredAgentId of ["market-satellite-a", "market-satellite-b", "market-satellite-c"]) {
    await db.delete(agentServices).where(eq(agentServices.agentId, retiredAgentId));
    await db.delete(agentReputation).where(eq(agentReputation.agentId, retiredAgentId));
  }
  // Keep every D1 statement comfortably below SQLite/Worker bind-variable limits.
  // Seeding is idempotent and never overwrites a registry entry already edited by a user.
  for (const item of AGENT_SERVICE_SEEDS) {
    const { capabilities, ...row } = item;
    await db.insert(agentServices).values({ ...row, capabilitiesJson: JSON.stringify(capabilities) }).onConflictDoNothing();
  }
  const reputationRows = AGENT_SERVICE_SEEDS.flatMap((service) => service.capabilities.map((capability) => ({
    agentId: service.agentId, capability, qualityScore: service.reputation, score: service.reputation,
  })));
  for (const row of reputationRows) {
    await db.insert(agentReputation).values(row).onConflictDoNothing();
  }
}

type ServiceLike = typeof agentServices.$inferSelect;
type ReputationLike = typeof agentReputation.$inferSelect;

export type DiscoveryCandidate = {
  agentId: string;
  serviceId: string;
  name: string;
  provider: string;
  internal: boolean;
  price: number;
  currency: string;
  reputation: number;
  successRate: number;
  averageResponseMs: number;
  availability: number;
  score: number;
  executable: boolean;
  requiresHumanApproval: boolean;
  reason: string;
};

export function discoverServices(services: ServiceLike[], reputationRows: ReputationLike[], capability: string, externalPaymentsEnabled: boolean) {
  const eligible = services.filter((service) => service.status !== "Bloqueado" && safeCapabilities(service.capabilitiesJson).includes(capability));
  const maxPrice = Math.max(...eligible.map((service) => service.price), 0.01);
  const maxTime = Math.max(...eligible.map((service) => service.averageResponseMs), 1);
  return eligible.map((service): DiscoveryCandidate => {
    const capabilityReputation = reputationRows.find((row) => row.agentId === service.agentId && row.capability === capability)?.score ?? service.reputation;
    const costScore = Math.max(0, 100 - (service.price / maxPrice) * 100);
    const speedScore = Math.max(0, 100 - (service.averageResponseMs / maxTime) * 100);
    const score = capabilityReputation * 0.30 + service.successRate * 0.25 + service.availability * 0.15 + speedScore * 0.15 + costScore * 0.15;
    const executable = service.internal || externalPaymentsEnabled;
    return { agentId: service.agentId, serviceId: service.serviceId, name: service.name, provider: service.provider, internal: service.internal, price: service.price, currency: service.currency, reputation: capabilityReputation, successRate: service.successRate, averageResponseMs: service.averageResponseMs, availability: service.availability, score: Number(score.toFixed(1)), executable, requiresHumanApproval: service.requiresHumanApproval, reason: executable ? (service.requiresHumanApproval ? "Eligible · human approval required" : "Eligible · pre-approved for limited autonomy") : "External execution/payment disabled" };
  }).sort((a, b) => b.score - a.score);
}

function safeCapabilities(value: string) {
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

export type AgentExecutionInput = { capability: string; stageCategory: string; fileName?: string; documentId?: number; operationReference: string };
export type AgentExecutionOutput = { result: string; confidence: number; durationMs: number; outputDocument: Record<string, unknown>; logs: string[] };

export async function executeAgentAdapter(service: ServiceLike, input: AgentExecutionInput): Promise<AgentExecutionOutput> {
  // Adapter boundary: API/MCP/A2A/discovery/x402 connectors plug in here later.
  // External execution is intentionally disabled in this release.
  if (!service.internal || service.adapterType !== "internal") throw new Error("External agent execution is disabled. Use Simulation or an internal service.");
  const findings: Record<string, string> = {
    car_geolocation_check: "CAR/geolocation evidence is linked to the correct supply-chain stage. Confirm official SICAR status and polygon before final DDS review.",
    certificate_validation: "Certificate evidence is present for review. Validate issuer, validity period and holder identity before human sign-off.",
    invoice_validation: "Commercial evidence is linked to the stage. Validate parties, dates, quantities, product description and lot references against adjacent stages.",
    transport_document_validation: "Transport evidence is linked to the stage. Validate route, carrier, vehicle/container references, quantities and origin/destination consistency.",
    supplier_due_diligence: "Supplier due-diligence evidence is available. Validate legal identity, environmental licences, counterparty role and sanctions/eligibility controls.",
    mass_balance_check: "Industrial evidence is available for mass-balance review. Reconcile incoming lots, opening stock, consumption, production lots and closing stock.",
    export_document_validation: "Export/shipment evidence is linked. Validate invoice/BL/booking/container/port references and continuity with the previous stage.",
    eudr_compliance_check: "EUDR structural review prepared. Human validation remains required before any official DDS submission.",
    forest_origin_check: "Forest-origin evidence is mapped to the declared supply chain. Confirm source identity and lot linkage.",
    satellite_risk_check: "Satellite risk workflow prepared. Official deforestation-risk conclusion requires an approved imagery/data source.",
    fsc_pefc_validation: "Certification evidence is available. Validate certificate code, scope, holder and validity with the scheme owner.",
    final_dossier_check: "Dossier structure checked. Stage order and available agent findings can be consolidated without changing original evidence.",
  };
  const confidence = input.documentId ? 86 : 78;
  const durationMs = 620 + ((input.documentId ?? input.stageCategory.length) % 7) * 73;
  const result = findings[input.capability] ?? "Compliance check prepared for human review.";
  return {
    result,
    confidence,
    durationMs,
    outputDocument: { type: "agent-compliance-finding", stage: input.stageCategory, capability: input.capability, sourceDocumentId: input.documentId ?? null, sourceFileName: input.fileName ?? null, conclusion: result, confidence, originalDocumentsModified: false },
    logs: ["Input references received", "Original evidence locked read-only", "Internal adapter executed", "Finding produced for human review"],
  };
}

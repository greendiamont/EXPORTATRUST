import { and, desc, eq, like, or } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../db";
import { agentApprovals, agentCredentials, agentEvents, auditLogs, exportMilestones, operationDocuments, operations, operationTimeline, shipmentAdvices } from "../db/schema";
import { buildShipmentAdvice } from "./shipment-documents";
import { audit, type SecurityContext, sha256Hex } from "./security";

export const AGENT_SAFE_SCOPES = ["operations:read", "events:write", "timeline:write", "documents:write", "stages:suggest", "shipment-advice:draft", "daily-brief:read", "approvals:read"] as const;
const SENSITIVE_ACTIONS = new Set(["send_external_email", "financial_change", "release_shipment", "cancel_operation", "delete_record", "close_operation", "approve_final_documents", "bank_details_change"]);
const SAFE_STAGE_STATUSES = new Set(["Pendente", "Em andamento", "Aguardando documento", "Em revisão", "Aguardando aprovação", "Concluído", "Bloqueado"]);
const DOC_TYPES = ["Commercial Invoice", "Packing List", "Bill of Lading", "Certificate of Origin", "Phytosanitary Certificate", "HT", "NF", "SWIFT", "Booking", "Draft BL", "Final BL", "VGM", "comprovante de envio dos originais", "certificações", "EUDR/DDS", "outros"];

type AgentContext = SecurityContext & { credentialId: string; scopes: string[] };
type EventPayload = {
  event_id?: string;
  message_id?: string;
  thread_id?: string;
  source?: string;
  subject?: string;
  sender?: string;
  recipients?: string[];
  date?: string;
  summary?: string;
  body_summary?: string;
  attachments?: Array<{ file_name?: string; name?: string; content_type?: string; size_bytes?: number; sha256?: string; text?: string }>;
  references?: Record<string, string>;
};

export async function ensurePrivateAgentTables() {
  await ensureBaseTables();
  const { env } = await import("cloudflare:workers");
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agent_credentials (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer DEFAULT 1 NOT NULL, credential_id text NOT NULL UNIQUE, name text DEFAULT 'Agente Particular' NOT NULL, token_hash text NOT NULL, scopes_json text DEFAULT '[]' NOT NULL, status text DEFAULT 'Ativo' NOT NULL, last_four text DEFAULT '' NOT NULL, expires_at text, revoked_at text, last_used_at text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS agent_credentials_org_credential_idx ON agent_credentials (organization_id, credential_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agent_events (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer DEFAULT 1 NOT NULL, event_id text NOT NULL, source text NOT NULL, external_id text DEFAULT '' NOT NULL, subject text DEFAULT '' NOT NULL, sender text DEFAULT '' NOT NULL, recipients_json text DEFAULT '[]' NOT NULL, summary text DEFAULT '' NOT NULL, payload_json text DEFAULT '{}' NOT NULL, matched_operation_id integer, match_confidence text DEFAULT 'NONE' NOT NULL, match_score real DEFAULT 0 NOT NULL, status text DEFAULT 'Recebido' NOT NULL, error text DEFAULT '' NOT NULL, processed_at text, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS agent_events_org_event_idx ON agent_events (organization_id, event_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS operation_timeline (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer DEFAULT 1 NOT NULL, operation_id integer NOT NULL, event_type text DEFAULT 'agent_event' NOT NULL, title text NOT NULL, description text DEFAULT '' NOT NULL, source text DEFAULT 'agent' NOT NULL, external_event_id text DEFAULT '' NOT NULL, document_id integer, metadata_json text DEFAULT '{}' NOT NULL, created_by text DEFAULT 'Agente Particular' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agent_approvals (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer DEFAULT 1 NOT NULL, approval_id text NOT NULL UNIQUE, action_type text NOT NULL, operation_id integer, description text NOT NULL, proposed_action_json text DEFAULT '{}' NOT NULL, current_data_json text DEFAULT '{}' NOT NULL, proposed_data_json text DEFAULT '{}' NOT NULL, risk text DEFAULT 'MEDIUM' NOT NULL, requested_by text DEFAULT 'Agente Particular' NOT NULL, requested_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, status text DEFAULT 'PENDING' NOT NULL, decided_by text DEFAULT '' NOT NULL, decided_at text, decision_note text DEFAULT '' NOT NULL, expires_at text)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS agent_approvals_org_approval_idx ON agent_approvals (organization_id, approval_id)"),
  ]);
}

export function jsonError(error: unknown, fallback = "Erro inesperado") {
  if (error instanceof Response) return error;
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

export async function requireAgent(request: Request, requiredScope: string): Promise<AgentContext> {
  await ensurePrivateAgentTables();
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token || token.length > 512) throw new Response(JSON.stringify({ error: "Token Bearer obrigatório." }), { status: 401, headers: { "content-type": "application/json" } });
  const tokenHash = await sha256Hex(token);
  const { env } = await import("cloudflare:workers");
  const configuredToken = typeof env.AGENT_API_TOKEN === "string" ? env.AGENT_API_TOKEN : "";
  if (configuredToken && token === configuredToken) {
    return { organizationId: 1, organizationName: "ExportaTrust", organizationSlug: "exportatrust", userId: 0, email: "agent:server-token", fullName: "Agente Particular", role: "analista", preview: false, credentialId: "server-token", scopes: [...AGENT_SAFE_SCOPES] };
  }
  const db = await getDb();
  const [credential] = await db.select().from(agentCredentials).where(eq(agentCredentials.tokenHash, tokenHash)).limit(1);
  if (!credential || credential.status !== "Ativo" || credential.revokedAt || (credential.expiresAt && credential.expiresAt < new Date().toISOString())) {
    throw new Response(JSON.stringify({ error: "Credencial do agente inválida ou revogada." }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const scopes = parseList(credential.scopesJson);
  if (!scopes.includes(requiredScope)) throw new Response(JSON.stringify({ error: "Escopo insuficiente para esta ação." }), { status: 403, headers: { "content-type": "application/json" } });
  await db.update(agentCredentials).set({ lastUsedAt: new Date().toISOString() }).where(eq(agentCredentials.id, credential.id));
  return { organizationId: credential.organizationId, organizationName: "ExportaTrust", organizationSlug: "exportatrust", userId: 0, email: `agent:${credential.credentialId}`, fullName: credential.name, role: "analista", preview: false, credentialId: credential.credentialId, scopes };
}

export async function enforceIdempotency(request: Request, context: AgentContext) {
  const method = request.method.toUpperCase();
  if (!["POST", "PATCH"].includes(method)) return "";
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!key || key.length < 8 || key.length > 160) throw new Response(JSON.stringify({ error: "Idempotency-Key obrigatório para POST/PATCH." }), { status: 400, headers: { "content-type": "application/json" } });
  await audit(context, "AGENT_IDEMPOTENCY_ACCEPTED", "agent_request", key, { method });
  return key;
}

export async function matchOperation(context: AgentContext, payload: EventPayload | Record<string, unknown>) {
  const db = await getDb();
  const terms = [
    String((payload as EventPayload).references?.operation_id ?? (payload as Record<string, unknown>).operation_id ?? ""),
    String((payload as EventPayload).references?.process_code ?? (payload as Record<string, unknown>).reference ?? ""),
    String((payload as EventPayload).references?.po ?? (payload as Record<string, unknown>).po ?? ""),
    String((payload as EventPayload).references?.booking ?? (payload as Record<string, unknown>).booking ?? ""),
    String((payload as EventPayload).references?.bl ?? (payload as Record<string, unknown>).bl ?? ""),
    String((payload as EventPayload).references?.container ?? (payload as Record<string, unknown>).container ?? ""),
    String((payload as EventPayload).subject ?? ""),
    String((payload as EventPayload).summary ?? (payload as EventPayload).body_summary ?? ""),
    ...(((payload as EventPayload).attachments ?? []).map((item) => `${item.file_name ?? item.name ?? ""} ${item.text ?? ""}`)),
  ].map((item) => item.trim()).filter(Boolean);
  const rows = await db.select().from(operations).where(eq(operations.organizationId, context.organizationId)).limit(1000);
  const scored = rows.map((operation) => {
    let score = 0;
    const haystack = [operation.reference, operation.contractNumber, operation.bookingNumber, operation.containerNumbers, operation.vesselVoyage, operation.supplierName, operation.euImporter].join(" ").toLowerCase();
    for (const term of terms) {
      const clean = term.toLowerCase();
      if (!clean) continue;
      if (operation.reference.toLowerCase() === clean) score += 100;
      else if (haystack.includes(clean)) score += clean.length > 4 ? 35 : 5;
      else if (clean.includes(operation.reference.toLowerCase())) score += 90;
    }
    return { operation, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return { operation: null, confidence: "NONE", score: 0 };
  if (scored[1] && top.score - scored[1].score < 20) return { operation: top.operation, confidence: "MEDIUM", score: top.score };
  return { operation: top.operation, confidence: top.score >= 90 ? "HIGH" : top.score >= 35 ? "MEDIUM" : "LOW", score: top.score };
}

export async function receiveInboxEvent(request: Request) {
  const context = await requireAgent(request, "events:write");
  await enforceIdempotency(request, context);
  const body = await boundedJson<EventPayload>(request);
  const eventId = String(body.event_id || body.message_id || "");
  if (!eventId) return Response.json({ error: "event_id ou message_id obrigatório." }, { status: 400 });
  const source = String(body.source || "gmail").slice(0, 40);
  const db = await getDb();
  const existing = await db.select().from(agentEvents).where(and(eq(agentEvents.organizationId, context.organizationId), eq(agentEvents.eventId, eventId))).limit(1);
  if (existing.length) return Response.json({ event: existing[0], duplicate: true });
  const match = await matchOperation(context, body);
  const status = match.confidence === "HIGH" ? "Processado" : "Em revisão";
  const [event] = await db.insert(agentEvents).values({
    organizationId: context.organizationId, eventId, source, externalId: String(body.thread_id || body.message_id || ""),
    subject: sanitize(String(body.subject || "")), sender: sanitize(String(body.sender || "")),
    recipientsJson: JSON.stringify((body.recipients ?? []).map(String).slice(0, 20)),
    summary: sanitize(String(body.summary || body.body_summary || "")), payloadJson: JSON.stringify(body).slice(0, 50000),
    matchedOperationId: match.operation?.id, matchConfidence: match.confidence, matchScore: match.score, status, processedAt: new Date().toISOString(),
  }).returning();
  if (match.operation && match.confidence === "HIGH") {
    await db.insert(operationTimeline).values({ organizationId: context.organizationId, operationId: match.operation.id, eventType: "inbox_event", title: `Evento ${source}: ${event.subject || event.eventId}`, description: event.summary, source, externalEventId: eventId, metadataJson: JSON.stringify({ matchConfidence: match.confidence, sender: event.sender }), createdBy: context.fullName });
  }
  await audit(context, "AGENT_INBOX_EVENT_RECEIVED", "agent_event", eventId, { source, matchConfidence: match.confidence, operationId: match.operation?.id ?? null });
  return Response.json({ event, match: { operationId: match.operation?.id ?? null, confidence: match.confidence, score: match.score } }, { status: 201 });
}

export async function listOperationsForAgent(request: Request) {
  const context = await requireAgent(request, "operations:read");
  const url = new URL(request.url);
  const q = sanitize(url.searchParams.get("q") ?? "");
  const db = await getDb();
  const where = q ? and(eq(operations.organizationId, context.organizationId), or(like(operations.reference, `%${q}%`), like(operations.contractNumber, `%${q}%`), like(operations.bookingNumber, `%${q}%`), like(operations.containerNumbers, `%${q}%`), like(operations.euImporter, `%${q}%`), like(operations.supplierName, `%${q}%`))!) : eq(operations.organizationId, context.organizationId);
  const rows = await db.select().from(operations).where(where).orderBy(desc(operations.id)).limit(100);
  return Response.json({ operations: rows });
}

export async function createApproval(context: AgentContext | SecurityContext, actionType: string, operationId: number | null, description: string, proposed: Record<string, unknown>, risk = "HIGH") {
  const db = await getDb();
  const approvalId = `APR-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
  const [approval] = await db.insert(agentApprovals).values({ organizationId: context.organizationId, approvalId, actionType, operationId, description, proposedActionJson: JSON.stringify(proposed), risk, requestedBy: context.fullName || context.email }).returning();
  await audit(context, "AGENT_APPROVAL_CREATED", "agent_approval", approvalId, { actionType, operationId, risk });
  return approval;
}

export function guardAction(actionType: string, payload: Record<string, unknown>) {
  const lower = JSON.stringify(payload).toLowerCase();
  if (SENSITIVE_ACTIONS.has(actionType) || /(price|currency|commercialvalue|commission|bank|swift|iban|cancel|delete|close|concluir|encerrar|send|email)/i.test(lower)) return true;
  return false;
}

export async function createShipmentAdviceDraft(request: Request, operationId: number) {
  const context = await requireAgent(request, "shipment-advice:draft");
  await enforceIdempotency(request, context);
  const db = await getDb();
  const [operation] = await db.select().from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId))).limit(1);
  if (!operation) return Response.json({ error: "Operação não encontrada." }, { status: 404 });
  const documents = await db.select().from(operationDocuments).where(and(eq(operationDocuments.operationId, operationId), eq(operationDocuments.organizationId, context.organizationId))).limit(1000);
  const generated = buildShipmentAdvice(operation, documents, { name: operation.euImporter, email: "" });
  const values = { organizationId: context.organizationId, operationId, status: "DRAFT — AGUARDANDO APROVAÇÃO HUMANA", recipient: generated.recipient, subject: generated.subject, body: generated.body, paymentRequest: "Revisar saldo/pagamento manualmente antes de qualquer envio.", documentIdsJson: JSON.stringify(generated.included.map((doc) => doc.id)), checklistJson: JSON.stringify(generated.checklist), humanApproved: false, approvedBy: "", approvedAt: null, sentAt: null, updatedAt: new Date().toISOString() };
  await db.insert(shipmentAdvices).values(values).onConflictDoUpdate({ target: [shipmentAdvices.organizationId, shipmentAdvices.operationId], set: values });
  const approval = await createApproval(context, "shipment_advice_send", operationId, "Shipment Advice preparado como rascunho. Envio externo exige aprovação humana.", { subject: generated.subject, recipient: generated.recipient }, "HIGH");
  return Response.json({ draft: values, generated, approval }, { status: 201 });
}

export async function dailyBrief(request: Request) {
  const context = await requireAgent(request, "daily-brief:read");
  const db = await getDb();
  const [ops, pendingApprovals, reviewEvents, docs, milestones] = await Promise.all([
    db.select().from(operations).where(eq(operations.organizationId, context.organizationId)).orderBy(desc(operations.id)).limit(50),
    db.select().from(agentApprovals).where(and(eq(agentApprovals.organizationId, context.organizationId), eq(agentApprovals.status, "PENDING"))).orderBy(desc(agentApprovals.id)).limit(50),
    db.select().from(agentEvents).where(and(eq(agentEvents.organizationId, context.organizationId), eq(agentEvents.status, "Em revisão"))).orderBy(desc(agentEvents.id)).limit(50),
    db.select().from(operationDocuments).where(eq(operationDocuments.organizationId, context.organizationId)).orderBy(desc(operationDocuments.id)).limit(100),
    db.select().from(exportMilestones).where(eq(exportMilestones.organizationId, context.organizationId)).orderBy(desc(exportMilestones.id)).limit(100),
  ]);
  return Response.json({ generatedAt: new Date().toISOString(), operations: ops, critical: ops.filter((op) => op.readiness < 70), documentsPending: docs.filter((doc) => doc.status !== "Aprovado"), nextActions: milestones.filter((item) => item.nextAction || item.status !== "Concluído").slice(0, 30), approvals: pendingApprovals, eventsInReview: reviewEvents });
}

export async function approvals(request: Request) {
  const context = await requireAgent(request, "approvals:read");
  const db = await getDb();
  const rows = await db.select().from(agentApprovals).where(eq(agentApprovals.organizationId, context.organizationId)).orderBy(desc(agentApprovals.id)).limit(200);
  return Response.json({ approvals: rows });
}

export async function decideApproval(request: Request, approvalId: string, decision: "APPROVED" | "REJECTED") {
  const context = await requireAgent(request, "approvals:read");
  await enforceIdempotency(request, context);
  const db = await getDb();
  const [approval] = await db.select().from(agentApprovals).where(and(eq(agentApprovals.organizationId, context.organizationId), eq(agentApprovals.approvalId, approvalId))).limit(1);
  if (!approval) return Response.json({ error: "Aprovação não encontrada." }, { status: 404 });
  if (approval.status !== "PENDING") return Response.json({ error: "Aprovação já decidida." }, { status: 409 });
  const [updated] = await db.update(agentApprovals).set({ status: decision, decidedBy: context.fullName, decidedAt: new Date().toISOString() }).where(eq(agentApprovals.id, approval.id)).returning();
  await audit(context, `AGENT_APPROVAL_${decision}`, "agent_approval", approvalId, { actionType: approval.actionType, operationId: approval.operationId });
  return Response.json({ approval: updated });
}

export async function agentAudit(request: Request) {
  const context = await requireAgent(request, "approvals:read");
  const db = await getDb();
  const rows = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, context.organizationId)).orderBy(desc(auditLogs.id)).limit(200);
  return Response.json({ audit: rows.filter((row) => row.actorEmail.startsWith("agent:") || row.action.startsWith("AGENT_")) });
}

export async function boundedJson<T>(request: Request): Promise<T> {
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 512 * 1024) throw new Response(JSON.stringify({ error: "Payload acima do limite permitido." }), { status: 413, headers: { "content-type": "application/json" } });
  return request.json() as Promise<T>;
}

export function classifyDocument(name: string) {
  const lower = name.toLowerCase();
  const type = DOC_TYPES.find((item) => lower.includes(item.toLowerCase().split(" ")[0])) ?? (lower.includes("bl") ? "Bill of Lading" : lower.includes("invoice") ? "Commercial Invoice" : "outros");
  const stage = lower.includes("booking") || lower.includes("bl") || lower.includes("vgm") ? "STAGE 11 · Exportação / Embarque" : lower.includes("phyto") || lower.includes("certificate") ? "STAGE 12 · Documentos finais" : "STAGE 08 · Documentos comerciais";
  return { type, stage };
}

export function sanitize(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
}

function parseList(value: string) {
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

export { SAFE_STAGE_STATUSES };

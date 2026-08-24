import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { agentApprovals, agentCredentials, agentEvents, operationDocuments, operationTimeline } from "../../../../db/schema";
import { ensurePrivateAgentTables, jsonError } from "../../../../lib/private-agent-api";
import { requireSecurityContext } from "../../../../lib/security";

export async function GET() {
  try {
    const context = await requireSecurityContext("read");
    await ensurePrivateAgentTables();
    const db = await getDb();
    const [credentials, events, approvals, documents, timeline] = await Promise.all([
      db.select().from(agentCredentials).where(eq(agentCredentials.organizationId, context.organizationId)).orderBy(desc(agentCredentials.id)).limit(20),
      db.select().from(agentEvents).where(eq(agentEvents.organizationId, context.organizationId)).orderBy(desc(agentEvents.id)).limit(100),
      db.select().from(agentApprovals).where(eq(agentApprovals.organizationId, context.organizationId)).orderBy(desc(agentApprovals.id)).limit(100),
      db.select().from(operationDocuments).where(eq(operationDocuments.organizationId, context.organizationId)).orderBy(desc(operationDocuments.id)).limit(200),
      db.select().from(operationTimeline).where(eq(operationTimeline.organizationId, context.organizationId)).orderBy(desc(operationTimeline.id)).limit(50),
    ]);
    return Response.json({
      api: { active: true, mode: "SIMULATED_EVENTS_ONLY", auth: "Authorization: Bearer server-side only", tokenVisible: false },
      lastEvent: events[0] ?? null,
      lastProcessing: events.find((event) => event.processedAt)?.processedAt ?? "",
      metrics: {
        eventsProcessed: events.filter((event) => event.status === "Processado").length,
        eventsWithError: events.filter((event) => event.status === "Erro" || event.error).length,
        eventsInReview: events.filter((event) => event.status === "Em revisão").length,
        documentsProcessed: documents.filter((document) => document.sourceSystem !== "Upload manual").length,
        approvalsPending: approvals.filter((approval) => approval.status === "PENDING").length,
      },
      credentials: credentials.map((credential) => ({ credentialId: credential.credentialId, name: credential.name, status: credential.status, scopes: credential.scopesJson, lastFour: credential.lastFour, lastUsedAt: credential.lastUsedAt, expiresAt: credential.expiresAt })),
      approvals: approvals.slice(0, 20),
      events: events.slice(0, 20),
      timeline: timeline.slice(0, 20),
      endpoints: ["/api/agent/inbox-events", "/api/agent/operations", "/api/agent/operations/:id/timeline", "/api/agent/operations/:id/documents", "/api/agent/operations/:id/stages/:stageId", "/api/agent/operations/:id/shipment-advice/draft", "/api/agent/daily-brief", "/api/agent/approvals"],
    });
  } catch (error) {
    return jsonError(error);
  }
}

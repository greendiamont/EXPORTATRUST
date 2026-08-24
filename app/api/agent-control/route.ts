import { and, desc, eq, inArray } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { agentJobs, agentLedger, agentOperationSettings, agentReputation, agentServices, operationDocuments, operations, ruralProperties } from "../../../db/schema";
import { discoverServices, executeAgentAdapter, seedAgentRegistry, STAGE_CAPABILITIES } from "../../../lib/agent-system";
import { analyzeImmutableDocument } from "../../../lib/document-intelligence";
import { screenIbamaEmbargo } from "../../../lib/ibama-screening";
import { satelliteMap } from "../../../lib/satellite-map";
import { audit, requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Unexpected error"; }

async function settingsFor(db: Awaited<ReturnType<typeof getDb>>, operationId: number) {
  let [settings] = await db.select().from(agentOperationSettings).where(eq(agentOperationSettings.operationId, operationId)).limit(1);
  if (!settings) [settings] = await db.insert(agentOperationSettings).values({ operationId, autonomyLevel: 1, externalPaymentsEnabled: false }).returning();
  return settings;
}

async function snapshot(db: Awaited<ReturnType<typeof getDb>>, operationId: number) {
  await seedAgentRegistry(db);
  const settings = await settingsFor(db, operationId);
  const [services, jobs, ledger, reputation] = await Promise.all([
    db.select().from(agentServices).orderBy(desc(agentServices.reputation)).limit(200),
    db.select().from(agentJobs).where(eq(agentJobs.operationId, operationId)).orderBy(desc(agentJobs.id)).limit(300),
    db.select().from(agentLedger).where(eq(agentLedger.operationId, operationId)).orderBy(desc(agentLedger.id)).limit(1000),
    db.select().from(agentReputation).limit(1000),
  ]);
  const costTypes = new Set(["COST", "AGENT COST", "EXTERNAL SERVICE COST", "COMPUTE COST"]);
  const cost = ledger.filter((entry) => costTypes.has(entry.entryType)).reduce((sum, entry) => sum + entry.amount, 0);
  const revenue = ledger.filter((entry) => entry.entryType === "REVENUE").reduce((sum, entry) => sum + entry.amount, 0);
  const grossMargin = revenue - cost;
  const metrics = {
    activeAgents: services.filter((service) => service.status === "Ativo").length,
    jobsExecuted: jobs.filter((job) => job.status === "Concluído").length,
    jobsPending: jobs.filter((job) => ["Aguardando aprovação", "Em execução"].includes(job.status)).length,
    awaitingApproval: jobs.filter((job) => job.status === "Aguardando aprovação").length,
    failures: jobs.filter((job) => job.status === "Falhou").length,
    alerts: jobs.filter((job) => job.error || job.confidence > 0 && job.confidence < 80).length,
    cost: Number(cost.toFixed(2)), revenue: Number(revenue.toFixed(2)), grossMargin: Number(grossMargin.toFixed(2)),
    marginPct: revenue ? Number(((grossMargin / revenue) * 100).toFixed(1)) : 0,
    estimatedSavings: Number(jobs.filter((job) => job.status === "Concluído").reduce((sum, job) => sum + Math.max(0, job.expectedPrice - job.actualPrice), 0).toFixed(2)),
  };
  return { settings, services, jobs, ledger, reputation, metrics };
}

async function executeJob(db: Awaited<ReturnType<typeof getDb>>, job: typeof agentJobs.$inferSelect, approvedBy: string) {
  const [service] = await db.select().from(agentServices).where(eq(agentServices.agentId, job.providerAgent)).limit(1);
  if (!service) throw new Error("Selected service is no longer available.");
  const settings = await settingsFor(db, job.operationId);
  if (!service.internal && !settings.externalPaymentsEnabled) throw new Error("External execution and machine-to-machine payments are disabled.");
  if (service.status === "Bloqueado") throw new Error("Selected provider is blocked.");
  const blockedProviders = parseList(settings.blockedProvidersJson);
  const allowedProviders = parseList(settings.allowedProvidersJson);
  if (blockedProviders.includes(service.provider)) throw new Error("Selected provider is blocked by operation policy.");
  if (allowedProviders.length && !allowedProviders.includes(service.provider)) throw new Error("Selected provider is outside the operation allowlist.");
  if (service.price > settings.transactionLimit || service.price > service.financialLimit) throw new Error("This service exceeds the permitted per-transaction budget.");
  const today = new Date().toISOString().slice(0, 10);
  const ledger = await db.select().from(agentLedger).where(eq(agentLedger.operationId, job.operationId)).limit(2000);
  const todayCost = ledger.filter((entry) => entry.createdAt.slice(0, 10) === today && ["COST", "AGENT COST", "EXTERNAL SERVICE COST", "COMPUTE COST"].includes(entry.entryType)).reduce((sum, entry) => sum + entry.amount, 0);
  if (todayCost + service.price > settings.dailyLimit) throw new Error("Daily agent/service budget would be exceeded.");

  let docIds: number[] = [];
  try { const parsed = JSON.parse(job.documentIdsJson) as unknown; if (Array.isArray(parsed)) docIds = parsed.map(Number).filter(Boolean); } catch { /* immutable refs only */ }
  const sourceDocs = docIds.length ? await db.select({ id: operationDocuments.id, fileName: operationDocuments.fileName, objectKey: operationDocuments.objectKey, contentType: operationDocuments.contentType }).from(operationDocuments).where(eq(operationDocuments.operationId, job.operationId)).limit(500) : [];
  const sourceDoc = sourceDocs.find((doc) => docIds.includes(doc.id));
  const [operation] = await db.select().from(operations).where(eq(operations.id, job.operationId)).limit(1);
  if (!operation) throw new Error("Operation not found.");

  const started = Date.now();
  await db.update(agentJobs).set({ status: "Em execução", approvalStatus: "Aprovado", approvedBy, approvedAt: new Date().toISOString(), error: "" }).where(eq(agentJobs.id, job.id));
  try {
    let output = await executeAgentAdapter(service, { capability: job.capability, stageCategory: job.stageCategory, fileName: sourceDoc?.fileName, documentId: sourceDoc?.id, operationReference: operation.reference });
    if (sourceDoc && service.internal) {
      try {
        const intelligence = await analyzeImmutableDocument(sourceDoc, { operationReference: operation.reference, stageCategory: job.stageCategory, capability: job.capability });
        if (intelligence) output = {
          ...output,
          result: `${output.result}\n\nDocument Intelligence: ${intelligence.summary}`,
          confidence: Math.round((output.confidence + intelligence.confidence) / 2),
          logs: [...output.logs, `OCR / Document Intelligence executed with ${intelligence.model}`, "Structured findings attached to the agent output; original file unchanged"],
          outputDocument: { ...output.outputDocument, documentIntelligence: intelligence.structured, documentIntelligenceModel: intelligence.model },
        };
        else output = { ...output, logs: [...output.logs, "OCR / Document Intelligence not configured; specialist analysis used immutable metadata only"] };
      } catch (intelligenceError) {
        output = { ...output, logs: [...output.logs, `OCR / Document Intelligence unavailable: ${errorMessage(intelligenceError)}`] };
      }
    }
    let propertyIds: string[] = [];
    try { const parsed = JSON.parse(operation.propertyIds || "[]") as unknown; if (Array.isArray(parsed)) propertyIds = parsed.map(String).filter(Boolean).slice(0, 5); } catch { /* no linked CAR */ }
    const linkedProperties = propertyIds.length ? await db.select({ carCode: ruralProperties.carCode, geometryJson: ruralProperties.geometryJson }).from(ruralProperties).where(inArray(ruralProperties.carCode, propertyIds)).limit(5) : [];
    if (service.internal && job.capability === "certificate_validation" && linkedProperties.length) {
      try {
        const screenings = [];
        for (const property of linkedProperties) screenings.push({ carCode: property.carCode, ...(await screenIbamaEmbargo(property.geometryJson)) });
        const hitCount = screenings.reduce((sum, item) => sum + item.matchCount, 0);
        output = { ...output, result: `${output.result}\n\nIBAMA PAMGIA screening: ${hitCount ? `${hitCount} spatial embargo match(es) require human legal review.` : "no spatial embargo match was returned for the linked CAR geometries at the time checked."}`, logs: [...output.logs, "Real-time IBAMA/CENIMA PAMGIA embargo screening executed"], outputDocument: { ...output.outputDocument, ibamaScreening: screenings } };
      } catch (ibamaError) { output = { ...output, logs: [...output.logs, `IBAMA screening unavailable: ${errorMessage(ibamaError)}`] }; }
    }
    if (service.internal && job.capability === "car_geolocation_check" && linkedProperties[0]) {
      try {
        const imagery = await satelliteMap(linkedProperties[0].geometryJson);
        if (imagery) output = { ...output, result: `${output.result}\n\nReal satellite reference: ${imagery.provider} imagery loaded for the linked CAR geometry.`, logs: [...output.logs, `Real satellite reference loaded from ${imagery.provider}`], outputDocument: { ...output.outputDocument, satelliteReference: { carCode: linkedProperties[0].carCode, provider: imagery.provider, boundaryIncluded: imagery.boundaryIncluded ?? false } } };
      } catch (satelliteError) { output = { ...output, logs: [...output.logs, `Satellite reference unavailable: ${errorMessage(satelliteError)}`] }; }
    }
    const actualPrice = service.price;
    const completedAt = new Date().toISOString();
    const durationMs = Math.max(output.durationMs, Date.now() - started);
    await db.update(agentJobs).set({ status: "Concluído", result: output.result, confidence: output.confidence, durationMs, actualPrice, logsJson: JSON.stringify(output.logs), outputDocumentJson: JSON.stringify(output.outputDocument), completedAt }).where(eq(agentJobs.id, job.id));
    await db.insert(agentLedger).values({ organizationId: job.organizationId, jobId: job.jobId, operationId: job.operationId, clientName: operation.euImporter || operation.supplierName, stageCategory: job.stageCategory, agentId: service.agentId, serviceId: service.serviceId, entryType: service.internal ? "AGENT COST" : "EXTERNAL SERVICE COST", amount: actualPrice, currency: service.currency, description: `${service.name} · ${job.capability}`, simulated: true });

    const [rep] = await db.select().from(agentReputation).where(and(eq(agentReputation.agentId, service.agentId), eq(agentReputation.capability, job.capability))).limit(1);
    const prior = (rep?.successCount ?? 0) + (rep?.failureCount ?? 0);
    const nextCount = prior + 1;
    const avgDuration = Math.round(((rep?.averageDurationMs ?? 0) * prior + durationMs) / nextCount);
    const avgConfidence = (((rep?.averageConfidence ?? 0) * prior + output.confidence) / nextCount);
    const costVariancePct = job.expectedPrice > 0 ? ((actualPrice - job.expectedPrice) / job.expectedPrice) * 100 : 0;
    const avgCostVariancePct = (((rep?.averageCostVariancePct ?? 0) * prior + costVariancePct) / nextCount);
    const humanValidated = approvedBy !== "Limited Autonomy Policy" ? 100 : 0;
    const humanValidationRate = (((rep?.humanValidationRate ?? 0) * prior + humanValidated) / nextCount);
    const quality = Math.min(100, Math.max(0, output.confidence + 8));
    const score = Number((quality * .40 + service.successRate * .25 + avgConfidence * .20 + Math.max(0, 100 - avgDuration / 100) * .15).toFixed(1));
    if (rep) await db.update(agentReputation).set({ successCount: rep.successCount + 1, averageDurationMs: avgDuration, averageConfidence: avgConfidence, averageCostVariancePct: avgCostVariancePct, humanValidationRate, qualityScore: quality, score, updatedAt: completedAt }).where(eq(agentReputation.id, rep.id));
    await db.update(agentServices).set({ executionCount: service.executionCount + 1, lastUsedAt: completedAt, reputation: score }).where(eq(agentServices.id, service.id));
    return (await db.select().from(agentJobs).where(eq(agentJobs.id, job.id)).limit(1))[0];
  } catch (error) {
    const failedAt = new Date().toISOString();
    await db.update(agentJobs).set({ status: "Falhou", error: errorMessage(error), completedAt: failedAt }).where(eq(agentJobs.id, job.id));
    const [rep] = await db.select().from(agentReputation).where(and(eq(agentReputation.agentId, service.agentId), eq(agentReputation.capability, job.capability))).limit(1);
    if (rep) {
      const executions = rep.successCount + rep.failureCount + 1;
      const failureRate = ((rep.failureCount + 1) / executions) * 100;
      await db.update(agentReputation).set({ failureCount: rep.failureCount + 1, score: Number(Math.max(0, rep.score - Math.min(10, failureRate / 5)).toFixed(1)), updatedAt: failedAt }).where(eq(agentReputation.id, rep.id));
    }
    await db.update(agentServices).set({ executionCount: service.executionCount + 1, lastUsedAt: failedAt }).where(eq(agentServices.id, service.id));
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const operationId = Number(new URL(request.url).searchParams.get("operationId"));
    if (!operationId) return Response.json({ error: "Invalid operation." }, { status: 400 });
    const db = await getDb();
    if (!(await db.select({ id: operations.id }).from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId))).limit(1)).length) return Response.json({ error: "Operation not found." }, { status: 404 });
    return Response.json(await snapshot(db, operationId));
  } catch (error) { return Response.json({ error: errorMessage(error) }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    const body = await request.json() as Record<string, unknown>;
    const operationId = Number(body.operationId);
    const action = String(body.action ?? "orchestrate");
    if (!operationId) return Response.json({ error: "Invalid operation." }, { status: 400 });
    const db = await getDb();
    await seedAgentRegistry(db);
    const [operation] = await db.select().from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId))).limit(1);
    if (!operation) return Response.json({ error: "Operation not found." }, { status: 404 });
    const settings = await settingsFor(db, operationId);

    if (action === "settings") {
      const autonomyLevel = Math.max(0, Math.min(2, Math.round(Number(body.autonomyLevel ?? settings.autonomyLevel))));
      const transactionLimit = Math.max(0, Number(body.transactionLimit ?? settings.transactionLimit));
      const dailyLimit = Math.max(0, Number(body.dailyLimit ?? settings.dailyLimit));
      const [updated] = await db.update(agentOperationSettings).set({ autonomyLevel, transactionLimit, dailyLimit, externalPaymentsEnabled: false, updatedAt: new Date().toISOString() }).where(eq(agentOperationSettings.operationId, operationId)).returning();
      return Response.json({ settings: updated, externalPaymentsEnabled: false });
    }

    if (action === "approve") {
      const jobId = String(body.jobId ?? "");
      const [job] = await db.select().from(agentJobs).where(and(eq(agentJobs.operationId, operationId), eq(agentJobs.jobId, jobId))).limit(1);
      if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
      if (job.status !== "Aguardando aprovação") return Response.json({ error: "Only pending jobs can be approved." }, { status: 409 });
      const completed = await executeJob(db, job, String(body.approvedBy ?? operation.internalResponsible ?? "Human reviewer"));
      return Response.json({ job: completed, ...(await snapshot(db, operationId)) });
    }

    if (action === "reject") {
      const jobId = String(body.jobId ?? "");
      const [job] = await db.select().from(agentJobs).where(and(eq(agentJobs.operationId, operationId), eq(agentJobs.jobId, jobId))).limit(1);
      if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
      await db.update(agentJobs).set({ status: "Cancelado", approvalStatus: "Recusado", approvedBy: String(body.approvedBy ?? operation.internalResponsible ?? "Human reviewer"), approvedAt: new Date().toISOString(), logsJson: JSON.stringify(["Human approval denied; no service executed and no charge incurred"]), completedAt: new Date().toISOString() }).where(eq(agentJobs.id, job.id));
      return Response.json(await snapshot(db, operationId));
    }

    const stageCategory = String(body.stageCategory ?? "").trim();
    const capability = String(body.capability ?? STAGE_CAPABILITIES[stageCategory] ?? "eudr_compliance_check");
    if (!stageCategory) return Response.json({ error: "Stage is required." }, { status: 400 });
    const documentId = Number(body.documentId ?? 0);
    const docs = await db.select().from(operationDocuments).where(eq(operationDocuments.operationId, operationId)).limit(500);
    const stageDocs = documentId ? docs.filter((doc) => doc.id === documentId) : docs.filter((doc) => doc.category === stageCategory);
    if (documentId && !stageDocs.length) return Response.json({ error: "Document does not belong to this operation." }, { status: 400 });
    const [services, reputation] = await Promise.all([db.select().from(agentServices).limit(200), db.select().from(agentReputation).limit(1000)]);
    const candidates = discoverServices(services, reputation, capability, settings.externalPaymentsEnabled);
    if (!candidates.length) return Response.json({ error: `No service registered for ${capability}.` }, { status: 422 });
    const selected = settings.autonomyLevel === 0 ? candidates[0] : candidates.find((candidate) => candidate.executable) ?? candidates[0];
    const simulated = settings.autonomyLevel === 0;
    const jobId = `JOB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const [job] = await db.insert(agentJobs).values({
      organizationId: context.organizationId, jobId, operationId, stageCategory, providerAgent: selected.agentId, capability,
      inputJson: JSON.stringify({ source: "Supply Chain Orchestrator", operationReference: operation.reference, stageCategory, immutableEvidence: true }),
      documentIdsJson: JSON.stringify(stageDocs.map((doc) => doc.id)), candidateScoresJson: JSON.stringify(candidates.slice(0, 6)), expectedPrice: selected.price, currency: selected.currency,
      status: simulated ? "Simulado" : "Aguardando aprovação", approvalStatus: simulated ? "Não requerida" : "Pendente",
      result: simulated ? `Simulation: ${selected.name} would be selected at ${selected.currency} ${selected.price.toFixed(2)}. No service was executed.` : "",
      logsJson: JSON.stringify(["Need identified by Supply Chain Orchestrator", `${candidates.length} service(s) compared by reputation, cost, success, speed and availability`, `Candidate selected: ${selected.name}`, simulated ? "Simulation only; no execution or payment" : "Waiting for human approval"]),
    }).returning();

    if (simulated) {
      await db.insert(agentLedger).values({ organizationId: context.organizationId, jobId, operationId, clientName: operation.euImporter || operation.supplierName, stageCategory, agentId: selected.agentId, serviceId: selected.serviceId, entryType: "AGENT COST", amount: selected.price, currency: selected.currency, description: `SIMULATION · ${selected.name}`, simulated: true });
      await audit(context, "AGENT_JOB_SIMULATED", "agent_job", jobId, { operationId, stageCategory, capability, expectedPrice: selected.price });
      return Response.json({ job, candidates, ...(await snapshot(db, operationId)) }, { status: 201 });
    }
    if (settings.autonomyLevel === 2 && selected.executable && !selected.requiresHumanApproval && selected.price <= settings.transactionLimit) {
      const completed = await executeJob(db, job, "Limited Autonomy Policy");
      return Response.json({ job: completed, candidates, ...(await snapshot(db, operationId)) }, { status: 201 });
    }
    return Response.json({ job, candidates, ...(await snapshot(db, operationId)) }, { status: 201 });
  } catch (error) { return Response.json({ error: errorMessage(error) }, { status: 500 }); }
}

function parseList(value: string) {
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

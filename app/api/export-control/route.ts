import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { clientNotifications, countryComplianceChecks, exportControlSettings, exportMilestones, operationDocuments, operations, shipmentTrackingEvents } from "../../../db/schema";
import { addDays, canApproveShipment, countryRequirements, EXPORT_ORDER_MILESTONES, isEudrRequired, milestoneEmail, requirementMatches } from "../../../lib/export-control";
import { audit, requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

function safeInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

async function ownedOperation(db: Awaited<ReturnType<typeof getDb>>, operationId: number, organizationId: number) {
  return (await db.select().from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, organizationId))).limit(1))[0];
}

async function seedControl(db: Awaited<ReturnType<typeof getDb>>, operation: typeof operations.$inferSelect, organizationId: number) {
  const now = new Date();
  const [existingSettings, existingMilestones] = await Promise.all([
    db.select({ id: exportControlSettings.id }).from(exportControlSettings).where(eq(exportControlSettings.operationId, operation.id)).limit(1),
    db.select().from(exportMilestones).where(eq(exportMilestones.operationId, operation.id)),
  ]);
  if (!existingSettings.length) {
    try {
      await db.insert(exportControlSettings).values({
        organizationId,
        operationId: operation.id,
        customerName: operation.euImporter,
        nextTrackingAt: addDays(now, 10),
      });
    } catch {
      const [settings] = await db.select({ id: exportControlSettings.id }).from(exportControlSettings).where(eq(exportControlSettings.operationId, operation.id)).limit(1);
      if (settings) await db.update(exportControlSettings).set({ organizationId }).where(eq(exportControlSettings.id, settings.id));
    }
  } else {
    await db.update(exportControlSettings).set({ organizationId }).where(eq(exportControlSettings.id, existingSettings[0].id));
  }
  for (const milestone of EXPORT_ORDER_MILESTONES) {
    const existing = existingMilestones.find((row) => row.code === milestone.code);
    const row = {
      organizationId,
      operationId: operation.id,
      code: milestone.code,
      sequence: milestone.sequence,
      title: milestone.title,
      category: milestone.category,
      status: "Pendente",
      responsibleName: operation.internalResponsible,
      responsibleEmail: operation.responsibleEmail,
      dueDate: milestone.code === "BOOKING" || milestone.code === "SHIPPED" ? operation.shipmentDate : "",
      nextAction: milestone.description,
      shipmentApproval: milestone.code === "SHIPMENT_APPROVAL" ? "Pendente" : "Não aplicável",
    };
    if (!existing) {
      try {
        await db.insert(exportMilestones).values(row);
      } catch {
        const [conflicting] = await db.select().from(exportMilestones).where(and(eq(exportMilestones.operationId, operation.id), eq(exportMilestones.code, milestone.code))).limit(1);
        if (conflicting) await db.update(exportMilestones).set({ organizationId, sequence: row.sequence, title: row.title, category: row.category }).where(eq(exportMilestones.id, conflicting.id));
      }
      continue;
    }
    await db.update(exportMilestones).set({ organizationId, sequence: row.sequence, title: row.title, category: row.category }).where(eq(exportMilestones.id, existing.id));
  }

  const synchronizedMilestones = await db.select().from(exportMilestones).where(eq(exportMilestones.operationId, operation.id));
  for (const existing of synchronizedMilestones) {
    const definition = EXPORT_ORDER_MILESTONES.find((item) => item.code === existing.code);
    const plan = {
      responsibleName: existing.responsibleName || operation.internalResponsible,
      responsibleEmail: existing.responsibleEmail || operation.responsibleEmail,
      nextAction: existing.nextAction || definition?.description || "",
    };
    if (plan.responsibleName !== existing.responsibleName || plan.responsibleEmail !== existing.responsibleEmail || plan.nextAction !== existing.nextAction) {
      await db.update(exportMilestones).set({ ...plan, updatedAt: now.toISOString() }).where(and(eq(exportMilestones.id, existing.id), eq(exportMilestones.organizationId, organizationId)));
    }
  }

  const originCompliance = (await db.select().from(exportMilestones).where(and(
    eq(exportMilestones.operationId, operation.id),
    eq(exportMilestones.code, "ORIGIN_COMPLIANCE"),
  )).limit(1))[0];
  const eudrRequired = isEudrRequired(operation.destinationCountry, operation.hsCode, operation.product);
  if (originCompliance && !eudrRequired) {
    await db.update(exportMilestones).set({
      status: "Suspenso",
      note: "Destino fora do escopo EUDR para este produto. Manter documentos comerciais, fitossanitários e exigências do país sem travar a operação por DDS.",
      nextAction: "EUDR não aplicável ao destino; seguir controle operacional e documental padrão.",
      updatedAt: now.toISOString(),
    }).where(eq(exportMilestones.id, originCompliance.id));
  } else if (originCompliance && !["Concluído", "Bloqueado"].includes(originCompliance.status)) {
    const synchronizedStatus = operation.readiness >= 100 ? "Aguardando aprovação" : operation.readiness > 0 ? "Em andamento" : "Pendente";
    const synchronizedNote = operation.eudrReference
      ? `Supply Chain Checklist ${operation.readiness}% concluído; referência DDS ${operation.eudrReference} registrada e aguardando revisão humana.`
      : operation.readiness >= 100
        ? "Supply Chain Checklist 100% concluído; aguardando revisão humana e/ou referência DDS."
        : operation.readiness > 0
          ? `Supply Chain Checklist em andamento (${operation.readiness}%).`
          : "Supply Chain Checklist ainda não iniciado.";
    if (originCompliance.status !== synchronizedStatus || originCompliance.note !== synchronizedNote) {
    await db.update(exportMilestones).set({
      status: synchronizedStatus,
      note: synchronizedNote,
      updatedAt: now.toISOString(),
    }).where(and(eq(exportMilestones.id, originCompliance.id), eq(exportMilestones.organizationId, organizationId)));
    }
  }
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function emailProviderConfiguration() {
  const { env } = await import("cloudflare:workers");
  const runtime = env as unknown as Record<string, unknown>;
  const apiKey = String(runtime.RESEND_API_KEY ?? "").trim();
  const from = String(runtime.EMAIL_FROM ?? "").trim();
  return { apiKey, from, ready: Boolean(apiKey && from), provider: "Resend" };
}

async function tryDeliverEmail(recipient: string, subject: string, body: string, html: string) {
  if (!recipient) return { status: "Rascunho", provider: "none", externalId: "", error: "E-mail do cliente não cadastrado." };
  if (!validEmail(recipient)) return { status: "Falha", provider: "validation", externalId: "", error: "Endereço de e-mail inválido." };
  const { apiKey, from, ready } = await emailProviderConfiguration();
  if (!ready) return { status: "Não enviado", provider: "not-configured", externalId: "", error: "Envio real pendente: configure RESEND_API_KEY e EMAIL_FROM com um domínio remetente verificado." };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [recipient], subject, text: body, html }),
    });
    const payload = await response.json() as { id?: string; message?: string };
    if (!response.ok) return { status: "Falha", provider: "resend", externalId: "", error: payload.message || `HTTP ${response.status}` };
    return { status: "Enviado", provider: "resend", externalId: payload.id || "", error: "" };
  } catch (error) {
    return { status: "Falha", provider: "resend", externalId: "", error: errorMessage(error) };
  }
}

async function createNotification(db: Awaited<ReturnType<typeof getDb>>, organizationId: number, operation: typeof operations.$inferSelect, settings: typeof exportControlSettings.$inferSelect, milestoneCode: string, milestoneTitle: string, status: string, note: string, forceDelivery = false) {
  const email = milestoneEmail(operation.reference, milestoneTitle, status, note, operation);
  const delivery = settings.notificationsEnabled || forceDelivery
    ? await tryDeliverEmail(settings.customerEmail, email.subject, email.body, email.html)
    : { status: "Rascunho", provider: "disabled", externalId: "", error: "Notificações automáticas desativadas." };
  const now = new Date().toISOString();
  const [notification] = await db.insert(clientNotifications).values({
    organizationId,
    operationId: operation.id,
    milestoneCode,
    recipient: settings.customerEmail,
    subject: email.subject,
    body: email.body,
    status: delivery.status,
    provider: delivery.provider,
    externalId: delivery.externalId,
    error: delivery.error,
    sentAt: delivery.status === "Enviado" ? now : null,
  }).returning();
  await db.update(exportControlSettings).set({ emailProviderStatus: delivery.provider === "resend" ? "Ativo" : delivery.provider === "not-configured" ? "Configuração necessária" : delivery.status, updatedAt: now }).where(and(eq(exportControlSettings.operationId, operation.id), eq(exportControlSettings.organizationId, organizationId)));
  return { notification, delivery };
}

async function snapshot(operationId: number, organizationId: number, controlSeeded = false) {
  await ensureBaseTables();
  const db = await getDb();
  const operation = await ownedOperation(db, operationId, organizationId);
  if (!operation) throw new Error("Processo não encontrado.");
  if (!controlSeeded) await seedControl(db, operation, organizationId);
  const [settings, milestones, notifications, tracking, checks, documents] = await Promise.all([
    db.select().from(exportControlSettings).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, organizationId))).limit(1),
    db.select().from(exportMilestones).where(and(eq(exportMilestones.operationId, operationId), eq(exportMilestones.organizationId, organizationId))).orderBy(exportMilestones.sequence),
    db.select().from(clientNotifications).where(and(eq(clientNotifications.operationId, operationId), eq(clientNotifications.organizationId, organizationId))).orderBy(desc(clientNotifications.id)).limit(100),
    db.select().from(shipmentTrackingEvents).where(and(eq(shipmentTrackingEvents.operationId, operationId), eq(shipmentTrackingEvents.organizationId, organizationId))).orderBy(desc(shipmentTrackingEvents.id)).limit(100),
    db.select().from(countryComplianceChecks).where(and(eq(countryComplianceChecks.operationId, operationId), eq(countryComplianceChecks.organizationId, organizationId))).orderBy(desc(countryComplianceChecks.id)).limit(1),
    db.select({ category: operationDocuments.category, fileName: operationDocuments.fileName }).from(operationDocuments).where(and(eq(operationDocuments.operationId, operationId), eq(operationDocuments.organizationId, organizationId))).limit(5000),
  ]);
  const documentTexts = documents.flatMap((document) => [document.category, document.fileName]);
  const eudrRequired = isEudrRequired(operation.destinationCountry, operation.hsCode, operation.product);
  const requirementRows = countryRequirements(operation.destinationCountry, operation.hsCode, operation.product).map((requirement) => ({ ...requirement, present: requirement.key === "eudr" ? Boolean(operation.eudrReference) || requirementMatches(requirement, documentTexts) : requirementMatches(requirement, documentTexts) }));
  const requiredRows = requirementRows.filter((item) => item.required);
  const score = requiredRows.length ? Math.round(requiredRows.filter((item) => item.present).length / requiredRows.length * 100) : 100;
  const emailConfiguration = await emailProviderConfiguration();
  const today = new Date().toISOString().slice(0, 10);
  const activeMilestones = milestones.filter((milestone) => !["Concluído", "Suspenso"].includes(milestone.status));
  const incompletePlans = activeMilestones.filter((milestone) => !milestone.responsibleName || !milestone.dueDate || !milestone.nextAction);
  const overdueMilestones = activeMilestones.filter((milestone) => milestone.dueDate && milestone.dueDate < today);
  return {
    operation,
    settings: settings[0],
    milestones,
    notifications,
    tracking,
    eudrBridge: {
      readiness: operation.readiness,
      reference: operation.eudrReference,
      required: eudrRequired,
      status: !eudrRequired ? "Suspenso · EUDR não aplicável para este destino" : operation.eudrReference ? "Referência DDS registrada" : operation.readiness >= 100 ? "Checklist concluído · revisão pendente" : operation.readiness > 0 ? "Em andamento" : "Não iniciado",
    },
    emailDelivery: { provider: emailConfiguration.provider, ready: emailConfiguration.ready, sender: emailConfiguration.from || "Não configurado" },
    operationalAlerts: {
      missingPlan: incompletePlans.length,
      overdue: overdueMilestones.length,
      stages: activeMilestones.filter((milestone) => incompletePlans.includes(milestone) || overdueMilestones.includes(milestone)).map((milestone) => ({
        code: milestone.code,
        title: milestone.title,
        missing: [!milestone.responsibleName ? "responsável" : "", !milestone.dueDate ? "prazo" : "", !milestone.nextAction ? "próxima ação" : ""].filter(Boolean),
        overdue: Boolean(milestone.dueDate && milestone.dueDate < today),
      })),
    },
    compliance: { score, status: score === 100 ? "Aprovado" : "Pendente", eudrRequired, requirements: requirementRows, lastCheck: checks[0] ?? null },
  };
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    const operationId = Number(new URL(request.url).searchParams.get("operationId"));
    if (!operationId) return Response.json({ error: "Processo inválido." }, { status: 400 });
    return Response.json(await snapshot(operationId, context.organizationId));
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    const body = await request.json() as Record<string, unknown>;
    const operationId = Number(body.operationId);
    const action = String(body.action ?? "");
    if (!operationId) return Response.json({ error: "Processo inválido." }, { status: 400 });
    const db = await getDb();
    const operation = await ownedOperation(db, operationId, context.organizationId);
    if (!operation) return Response.json({ error: "Processo não encontrado." }, { status: 404 });
    await seedControl(db, operation, context.organizationId);
    const settings = (await db.select().from(exportControlSettings).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, context.organizationId))).limit(1))[0];
    const now = new Date();

    if (action === "settings") {
      const customerEmail = String(body.customerEmail ?? "").trim().toLowerCase();
      if (customerEmail && !validEmail(customerEmail)) return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
      await db.update(exportControlSettings).set({
        customerName: String(body.customerName ?? "").trim(),
        customerEmail,
        customerReference: String(body.customerReference ?? "").trim(),
        notificationsEnabled: Boolean(body.notificationsEnabled),
        trackingIntervalDays: safeInteger(body.trackingIntervalDays, 10, 1, 90),
        updatedAt: now.toISOString(),
      }).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, context.organizationId)));
      await audit(context, "EXPORT_CONTROL_SETTINGS_UPDATED", "operation", String(operationId), { customerEmail, notificationsEnabled: Boolean(body.notificationsEnabled) });
      return Response.json(await snapshot(operationId, context.organizationId, true));
    }

    if (action === "milestone") {
      const code = String(body.code ?? "");
      const milestone = (await db.select().from(exportMilestones).where(and(eq(exportMilestones.operationId, operationId), eq(exportMilestones.code, code), eq(exportMilestones.organizationId, context.organizationId))).limit(1))[0];
      if (!milestone) return Response.json({ error: "Etapa operacional não encontrada." }, { status: 404 });
      const status = ["Pendente", "Em andamento", "Aguardando aprovação", "Concluído", "Bloqueado", "Suspenso"].includes(String(body.status)) ? String(body.status) : milestone.status;
      const qualityStatus = ["Não iniciado", "Em inspeção", "Aprovado", "Com ressalvas", "Reprovado"].includes(String(body.qualityStatus)) ? String(body.qualityStatus) : milestone.qualityStatus;
      const shipmentApproval = ["Não aplicável", "Pendente", "Aprovado", "Reprovado"].includes(String(body.shipmentApproval)) ? String(body.shipmentApproval) : milestone.shipmentApproval;
      const responsibleName = String(body.responsibleName ?? "").trim();
      const responsibleEmail = String(body.responsibleEmail ?? "").trim().toLowerCase();
      const dueDate = String(body.dueDate ?? "").trim();
      const nextAction = String(body.nextAction ?? "").trim();
      const note = String(body.note ?? "").trim();
      if (responsibleEmail && !validEmail(responsibleEmail)) return Response.json({ error: "Informe um e-mail válido para o responsável da etapa." }, { status: 400 });
      if (code === "SHIPMENT_APPROVAL" && (shipmentApproval === "Aprovado" || status === "Concluído")) {
        const currentControl = await snapshot(operationId, context.organizationId, true);
        const qualityStatusCurrent = currentControl.milestones.find((item) => item.code === "QUALITY_CONTROL")?.qualityStatus || "Não iniciado";
        const previousStagesComplete = currentControl.milestones
          .filter((item) => item.sequence < 6 && item.status !== "Suspenso")
          .every((item) => item.status === "Concluído");
        const allowed = canApproveShipment({
          eudrRequired: currentControl.compliance.eudrRequired,
          eudrReadiness: currentControl.operation.readiness,
          countryComplianceScore: currentControl.compliance.score,
          qualityStatus: qualityStatusCurrent,
          previousStagesComplete,
        });
        if (!allowed) {
          const error = currentControl.compliance.eudrRequired
            ? "A aprovação exige etapas anteriores concluídas, qualidade aprovada, checklist do país 100% e prontidão EUDR 100%."
            : qualityStatusCurrent === "Reprovado"
              ? "A aprovação foi bloqueada porque a qualidade está reprovada."
              : "Conclua as etapas anteriores. EUDR e checklist documental não bloqueiam destinos fora da União Europeia.";
          return Response.json({ error }, { status: 409 });
        }
      }
      const completedAt = status === "Concluído" ? now.toISOString() : null;
      await db.update(exportMilestones).set({ status, qualityStatus, shipmentApproval, responsibleName, responsibleEmail, dueDate, nextAction, note, completedAt, updatedAt: now.toISOString() }).where(and(eq(exportMilestones.id, milestone.id), eq(exportMilestones.organizationId, context.organizationId)));
      if (status === "Concluído") {
        const next = (await db.select().from(exportMilestones).where(and(eq(exportMilestones.operationId, operationId), eq(exportMilestones.sequence, milestone.sequence + 1), eq(exportMilestones.organizationId, context.organizationId))).limit(1))[0];
        if (next?.status === "Pendente") await db.update(exportMilestones).set({ status: "Em andamento", updatedAt: now.toISOString() }).where(and(eq(exportMilestones.id, next.id), eq(exportMilestones.organizationId, context.organizationId)));
        await createNotification(db, context.organizationId, operation, settings, milestone.code, milestone.title, status, note);
      }
      await db.update(operations).set({ status: status === "Concluído" && milestone.code === "DELIVERED" ? "Concluído" : milestone.title }).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId)));
      await audit(context, "EXPORT_MILESTONE_UPDATED", "operation", String(operationId), { code, status, qualityStatus, shipmentApproval, responsibleName, dueDate, nextAction });
      return Response.json(await snapshot(operationId, context.organizationId, true));
    }

    if (action === "country-check") {
      const current = await snapshot(operationId, context.organizationId, true);
      await db.insert(countryComplianceChecks).values({ organizationId: context.organizationId, operationId, country: operation.destinationCountry, hsCode: operation.hsCode, score: current.compliance.score, status: current.compliance.status, resultJson: JSON.stringify(current.compliance.requirements), checkedAt: now.toISOString() });
      await audit(context, "COUNTRY_COMPLIANCE_CHECKED", "operation", String(operationId), { country: operation.destinationCountry, score: current.compliance.score });
      return Response.json(await snapshot(operationId, context.organizationId, true));
    }

    if (action === "tracking-check") {
      const interval = settings.trackingIntervalDays || 10;
      const nextCheckAt = addDays(now, interval);
      const shipped = (await db.select().from(exportMilestones).where(and(eq(exportMilestones.operationId, operationId), eq(exportMilestones.code, "SHIPPED"))).limit(1))[0];
      const status = shipped?.status === "Concluído" ? "Em trânsito · aguardando posição do armador" : "Aguardando embarque";
      const details = operation.bookingNumber ? `Booking ${operation.bookingNumber}${operation.containerNumbers ? ` · contêiner(es) ${operation.containerNumbers}` : ""}.` : "Cadastre o booking para habilitar a consulta automática do armador.";
      await db.insert(shipmentTrackingEvents).values({ organizationId: context.organizationId, operationId, source: "ExportaTrust scheduler", status, location: operation.portOfLoading || "Origem", eta: "", details, checkedAt: now.toISOString(), nextCheckAt });
      await db.update(exportControlSettings).set({ nextTrackingAt: nextCheckAt, updatedAt: now.toISOString() }).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, context.organizationId)));
      if (settings.notificationsEnabled) await createNotification(db, context.organizationId, operation, settings, "IN_TRANSIT", "Tracking de embarque", status, details);
      await audit(context, "SHIPMENT_TRACKING_CHECKED", "operation", String(operationId), { booking: operation.bookingNumber, nextCheckAt });
      return Response.json(await snapshot(operationId, context.organizationId, true));
    }

    if (action === "test-email") {
      const customerEmail = String(body.customerEmail ?? settings.customerEmail ?? "").trim().toLowerCase();
      if (!validEmail(customerEmail)) return Response.json({ error: "Informe um e-mail válido antes de enviar o teste." }, { status: 400 });
      await db.update(exportControlSettings).set({
        customerName: String(body.customerName ?? settings.customerName ?? "").trim(),
        customerEmail,
        customerReference: String(body.customerReference ?? settings.customerReference ?? "").trim(),
        updatedAt: now.toISOString(),
      }).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, context.organizationId)));
      const refreshedSettings = (await db.select().from(exportControlSettings).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, context.organizationId))).limit(1))[0];
      const result = await createNotification(db, context.organizationId, operation, refreshedSettings, "TEST", "ExportaTrust communication test", "Test message", "This immediate test is independent of the 10-day shipment tracking schedule.", true);
      await audit(context, "EXPORT_EMAIL_TESTED", "operation", String(operationId), { recipient: customerEmail, deliveryStatus: result.delivery.status, provider: result.delivery.provider });
      return Response.json({ ...(await snapshot(operationId, context.organizationId, true)), deliveryResult: result.delivery });
    }

    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    console.error("EXPORT_CONTROL_POST_FAILED", error);
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

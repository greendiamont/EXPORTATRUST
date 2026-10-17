import { and, eq, inArray } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { clientNotifications, exportControlSettings, exportMilestones, importerClients, operations, shipmentReportSettings } from "../../../db/schema";
import { audit, requireSecurityContext, type SecurityContext } from "../../../lib/security";
import { isEudrRequired } from "../../../lib/export-control";
import { readOrderTerms } from "../../../lib/order-terms";
import { clientKeyOf, isDue, phasesOf, reportEmail, reportOrder, type ReportOrder } from "../../../lib/shipment-report";
import { shipmentReportPdf } from "../../../lib/shipment-report-pdf";

// Shipment Report (protótipo "3e"): um e-mail por cliente com todos os pedidos em aberto. Envio pelo botão
// no pedido ou automático (a cada N dias ou quando um pedido muda de fase) — o servidor Railway chama
// a ação "run-scheduled" de hora em hora (server/railway/shipment-report-scheduler.mjs). Só a equipe.

const STAFF_READ = new Set(["administrador", "analista", "auditor"]);
const STAFF_WRITE = new Set(["administrador", "analista"]);
const forbid = () => Response.json({ error: "O Shipment Report é só para a equipe." }, { status: 403 });
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const emailList = (value: unknown) => [...new Set(String(value ?? "").split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];

type Db = Awaited<ReturnType<typeof getDb>>;
type Operation = typeof operations.$inferSelect;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/** Pedidos em aberto do mesmo cliente (ou só o pedido), já no formato do relatório. */
async function buildFor(db: Db, organizationId: number, anchor: Operation, scope: "client" | "order", includePayments: boolean) {
  const key = clientKeyOf(anchor);
  const all = scope === "order" ? [anchor] : (await db.select().from(operations).where(eq(operations.organizationId, organizationId))).filter((operation) => clientKeyOf(operation) === key);
  const open = all.filter((operation) => {
    const terms = readOrderTerms(operation);
    return operation.id === anchor.id || (!terms.cancelled && !terms.completed);
  });
  const ids = open.map((operation) => operation.id);
  const milestones = ids.length ? await db.select().from(exportMilestones).where(and(eq(exportMilestones.organizationId, organizationId), inArray(exportMilestones.operationId, ids))) : [];
  const today = new Date().toISOString().slice(0, 10);
  const orders: ReportOrder[] = open
    .sort((a, b) => (a.shipmentDate || "9999").localeCompare(b.shipmentDate || "9999"))
    .map((operation) => reportOrder(operation, milestones.filter((milestone) => milestone.operationId === operation.id), { includePayments, eudrRequired: isEudrRequired(operation.destinationCountry, operation.hsCode, operation.product), today }));
  const [client] = anchor.importerClientId ? await db.select().from(importerClients).where(and(eq(importerClients.id, anchor.importerClientId), eq(importerClients.organizationId, organizationId))).limit(1) : [];
  const settingsRows = ids.length ? await db.select().from(exportControlSettings).where(and(eq(exportControlSettings.organizationId, organizationId), inArray(exportControlSettings.operationId, ids))) : [];
  const suggestedEmails = [...new Set([client?.email, ...settingsRows.map((row) => row.customerEmail)].map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean))];
  return { key, clientName: client?.legalName || anchor.euImporter || "Customer", exporterName: anchor.exporterName || "Exporter", orders, operations: open, suggestedEmails };
}

async function settingsOf(db: Db, organizationId: number, key: string) {
  const [row] = await db.select().from(shipmentReportSettings).where(and(eq(shipmentReportSettings.organizationId, organizationId), eq(shipmentReportSettings.clientKey, key))).limit(1);
  return row ?? null;
}

async function deliver(db: Db, organizationId: number, recipients: string[], report: Awaited<ReturnType<typeof buildFor>>, message: string) {
  const date = new Date().toISOString().slice(0, 10);
  const email = reportEmail({ clientName: report.clientName, exporterName: report.exporterName, orders: report.orders, message, date });
  const pdf = await shipmentReportPdf({ clientName: report.clientName, exporterName: report.exporterName, orders: report.orders, message, date });
  // @ts-ignore -- módulo virtual do runtime (shim no Railway); sem tipos no tsconfig, como nas outras rotas.
  const { env } = await import("cloudflare:workers");
  const runtime = env as unknown as Record<string, unknown>;
  const apiKey = String(runtime.RESEND_API_KEY ?? "").trim();
  const from = String(runtime.EMAIL_FROM ?? "").trim();
  let result = { status: "Não enviado", provider: "not-configured", externalId: "", error: "Envio de e-mail não configurado (RESEND_API_KEY e EMAIL_FROM)." };
  if (apiKey && from) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipients, subject: email.subject, html: email.html, text: email.text, attachments: [{ filename: `Shipment-Report-${date}.pdf`, content: bytesToBase64(pdf) }] }),
    });
    const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
    result = response.ok ? { status: "Enviado", provider: "resend", externalId: payload.id || "", error: "" } : { status: "Falha", provider: "resend", externalId: "", error: payload.message || `HTTP ${response.status}` };
  }
  // Histórico em cada pedido do relatório (mesma tabela das notificações ao cliente).
  const now = new Date().toISOString();
  for (const operation of report.operations) {
    await db.insert(clientNotifications).values({ organizationId, operationId: operation.id, milestoneCode: "SHIPMENT_REPORT", recipient: recipients.join(", "), subject: email.subject, body: email.text, status: result.status, provider: result.provider, externalId: result.externalId, error: result.error, sentAt: result.status === "Enviado" ? now : null });
  }
  return result;
}

async function saveSent(db: Db, organizationId: number, report: Awaited<ReturnType<typeof buildFor>>, by: string) {
  const now = new Date().toISOString();
  const existing = await settingsOf(db, organizationId, report.key);
  const values = { lastSentAt: now, lastPhasesJson: JSON.stringify(phasesOf(report.orders)), updatedAt: now };
  if (existing) await db.update(shipmentReportSettings).set(values).where(eq(shipmentReportSettings.id, existing.id));
  else await db.insert(shipmentReportSettings).values({ organizationId, clientKey: report.key, clientName: report.clientName, updatedBy: by, ...values });
}

async function loadOperation(db: Db, context: SecurityContext, id: number) {
  const [operation] = await db.select().from(operations).where(and(eq(operations.id, id), eq(operations.organizationId, context.organizationId))).limit(1);
  return operation ?? null;
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    if (!STAFF_READ.has(context.role)) return forbid();
    await ensureBaseTables();
    const db = await getDb();
    const url = new URL(request.url);
    const operation = await loadOperation(db, context, Number(url.searchParams.get("operationId")));
    if (!operation) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
    const scope = url.searchParams.get("scope") === "order" ? "order" : "client";
    const settings = await settingsOf(db, context.organizationId, clientKeyOf(operation));
    const report = await buildFor(db, context.organizationId, operation, scope, settings?.includePayments ?? true);
    const message = String(url.searchParams.get("message") ?? "").slice(0, 2000);
    const date = new Date().toISOString().slice(0, 10);
    if (url.searchParams.get("format") === "pdf") {
      const pdf = await shipmentReportPdf({ clientName: report.clientName, exporterName: report.exporterName, orders: report.orders, message, date });
      return new Response(pdf as unknown as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Shipment-Report-${date}.pdf"`, "cache-control": "no-store" } });
    }
    if (url.searchParams.get("format") === "html") {
      return new Response(reportEmail({ clientName: report.clientName, exporterName: report.exporterName, orders: report.orders, message, date }).html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    const due = settings ? isDue({ ...settings, intervalDays: settings.intervalDays }, report.orders, new Date()) : { due: false, reason: "" };
    const nextAt = settings?.auto && settings.lastSentAt ? new Date(Date.parse(settings.lastSentAt) + settings.intervalDays * 86_400_000).toISOString() : "";
    return Response.json({
      clientKey: report.key, clientName: report.clientName, orders: report.orders.map((order) => ({ id: order.id, reference: order.reference, badge: order.badge })),
      emails: settings?.emails || report.suggestedEmails.join(", "),
      settings: { auto: settings?.auto ?? false, intervalDays: settings?.intervalDays ?? 10, onPhaseChange: settings?.onPhaseChange ?? true, includePayments: settings?.includePayments ?? true, lastSentAt: settings?.lastSentAt ?? "", nextAt, dueNow: due.due },
      canWrite: STAFF_WRITE.has(context.role),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao montar o Shipment Report." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    if (!STAFF_WRITE.has(context.role)) return forbid();
    await ensureBaseTables();
    const db = await getDb();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");

    // Envio automático (chamado de hora em hora pelo servidor): clientes com envio ligado e vencidos.
    if (action === "run-scheduled") {
      if (context.role !== "administrador") return forbid();
      const rows = (await db.select().from(shipmentReportSettings).where(eq(shipmentReportSettings.organizationId, context.organizationId))).filter((row) => row.auto);
      const all = await db.select().from(operations).where(eq(operations.organizationId, context.organizationId));
      const results = [];
      for (const row of rows) {
        const anchor = all.find((operation) => clientKeyOf(operation) === row.clientKey && !readOrderTerms(operation).cancelled && !readOrderTerms(operation).completed);
        if (!anchor) continue;
        const report = await buildFor(db, context.organizationId, anchor, "client", row.includePayments);
        const due = isDue(row, report.orders, new Date());
        const recipients = emailList(row.emails).filter(validEmail);
        if (!due.due || !recipients.length) continue;
        const delivery = await deliver(db, context.organizationId, recipients, report, "");
        if (delivery.status === "Enviado") await saveSent(db, context.organizationId, report, "envio automático");
        await audit(context, "SHIPMENT_REPORT_AUTO_SENT", "client", row.clientKey, { reason: due.reason, status: delivery.status, orders: report.orders.length });
        results.push({ client: row.clientName, reason: due.reason, status: delivery.status, error: delivery.error });
      }
      return Response.json({ ok: true, sent: results });
    }

    const operation = await loadOperation(db, context, Number(body.operationId));
    if (!operation) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
    const key = clientKeyOf(operation);

    if (action === "save-settings") {
      const recipients = emailList(body.emails);
      const invalid = recipients.filter((email) => !validEmail(email));
      if (invalid.length) return Response.json({ error: `E-mail inválido: ${invalid.join(", ")}` }, { status: 400 });
      const auto = Boolean(body.auto);
      if (auto && !recipients.length) return Response.json({ error: "Informe ao menos um e-mail para o envio automático." }, { status: 400 });
      const intervalDays = Math.max(0, Math.min(90, Math.round(Number(body.intervalDays ?? 10))));
      const existing = await settingsOf(db, context.organizationId, key);
      const report = await buildFor(db, context.organizationId, operation, "client", Boolean(body.includePayments ?? true));
      const values = {
        clientName: report.clientName, emails: recipients.join(", "), auto, intervalDays, onPhaseChange: Boolean(body.onPhaseChange ?? true), includePayments: Boolean(body.includePayments ?? true),
        updatedBy: context.email, updatedAt: new Date().toISOString(),
        // Ao ligar: conta os dias a partir de agora e guarda as fases atuais (o primeiro envio é no prazo ou na próxima mudança de fase).
        ...(auto && !existing?.auto ? { lastSentAt: existing?.lastSentAt || new Date().toISOString(), lastPhasesJson: JSON.stringify(phasesOf(report.orders)) } : {}),
      };
      if (existing) await db.update(shipmentReportSettings).set(values).where(eq(shipmentReportSettings.id, existing.id));
      else await db.insert(shipmentReportSettings).values({ organizationId: context.organizationId, clientKey: key, ...values });
      await audit(context, "SHIPMENT_REPORT_SETTINGS_SAVED", "client", key, { auto, intervalDays });
      return Response.json({ ok: true });
    }

    if (action === "send") {
      const recipients = emailList(body.emails);
      if (!recipients.length || recipients.some((email) => !validEmail(email))) return Response.json({ error: "Informe e-mails válidos." }, { status: 400 });
      const settings = await settingsOf(db, context.organizationId, key);
      const scope = body.scope === "order" ? "order" : "client";
      const report = await buildFor(db, context.organizationId, operation, scope, settings?.includePayments ?? true);
      const delivery = await deliver(db, context.organizationId, recipients, report, String(body.message ?? "").trim().slice(0, 2000));
      if (delivery.status === "Enviado" && scope === "client") await saveSent(db, context.organizationId, report, context.email);
      await audit(context, "SHIPMENT_REPORT_SENT", "operation", String(operation.id), { scope, recipients, status: delivery.status, orders: report.orders.length });
      if (delivery.status !== "Enviado") return Response.json({ error: delivery.error, delivery }, { status: 503 });
      return Response.json({ ok: true, delivery, orders: report.orders.length });
    }

    return Response.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha no Shipment Report." }, { status: 500 });
  }
}

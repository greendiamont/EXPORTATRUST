import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { clientNotifications, exportControlSettings, operationDocuments, operations, shipmentAdvices, suppliers } from "../../../db/schema";
import { buildShipmentAdvice, invoiceFinancialsFromStructured, resolvedShipmentDocumentType, SHIPMENT_SET_CATEGORY, type ShipmentInvoiceFinancials } from "../../../lib/shipment-documents";
import { analyzeImmutableDocument } from "../../../lib/document-intelligence";
import { audit, requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

async function ensureSupplierBankDetails() {
  const { env } = await import("cloudflare:workers");
  const info = await env.DB.prepare("PRAGMA table_info(suppliers)").all<{ name: string }>();
  const names = new Set((info.results ?? []).map((column) => column.name));
  if (!names.has("bank_details")) await env.DB.prepare("ALTER TABLE suppliers ADD bank_details text DEFAULT '' NOT NULL").run();
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function deliverShipmentAdvice(recipient: string, subject: string, body: string, documents: Array<{ objectKey: string; fileName: string; sizeBytes: number }>) {
  if (!validEmail(recipient)) return { status: "Falha", provider: "validation", externalId: "", error: "Informe um e-mail válido para o cliente." };
  const { env } = await import("cloudflare:workers");
  const runtime = env as unknown as Record<string, unknown>;
  const apiKey = String(runtime.RESEND_API_KEY ?? "").trim();
  const from = String(runtime.EMAIL_FROM ?? "").trim();
  if (!apiKey || !from) return { status: "Não enviado", provider: "not-configured", externalId: "", error: "Configure RESEND_API_KEY e EMAIL_FROM com um domínio remetente verificado." };
  const totalBytes = documents.reduce((sum, document) => sum + document.sizeBytes, 0);
  if (totalBytes > 35 * 1024 * 1024) return { status: "Falha", provider: "validation", externalId: "", error: "Os anexos aprovados ultrapassam 35 MB. Reduza o set antes do envio." };
  const attachments = [] as Array<{ filename: string; content: string }>;
  for (const document of documents) {
    const object = await env.BUCKET?.get(document.objectKey);
    if (!object) return { status: "Falha", provider: "storage", externalId: "", error: `Arquivo não localizado: ${document.fileName}.` };
    attachments.push({ filename: document.fileName, content: bytesToBase64(new Uint8Array(await object.arrayBuffer())) });
  }
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [recipient], subject, text: body, attachments }) });
  const payload = await response.json() as { id?: string; message?: string };
  return response.ok
    ? { status: "Enviado", provider: "resend", externalId: payload.id || "", error: "" }
    : { status: "Falha", provider: "resend", externalId: "", error: payload.message || `Falha HTTP ${response.status}.` };
}

function storedInvoiceFinancials(document: { analysisSummary: string; notes: string }) {
  for (const value of [document.analysisSummary, document.notes]) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const structured = parsed.documentIntelligence && typeof parsed.documentIntelligence === "object" ? parsed.documentIntelligence as Record<string, unknown> : parsed;
      const result = invoiceFinancialsFromStructured(structured);
      if (result.totalInvoice || result.invoiceNumber) return result;
    } catch { /* legacy free text */ }
  }
  return {} as ShipmentInvoiceFinancials;
}

async function readApprovedInvoiceFinancials(operation: typeof operations.$inferSelect, documents: Array<typeof operationDocuments.$inferSelect>, refresh: boolean) {
  const invoice = documents.find((document) => document.category === SHIPMENT_SET_CATEGORY && document.shipmentSetStatus === "Incluído" && document.clientShareStatus === "Aprovado" && resolvedShipmentDocumentType(document) === "Commercial Invoice");
  if (!invoice) return {} as ShipmentInvoiceFinancials;
  const stored = storedInvoiceFinancials(invoice);
  if (!refresh || stored.totalInvoice) return stored;
  const intelligence = await analyzeImmutableDocument(invoice, { operationReference: operation.reference, stageCategory: SHIPMENT_SET_CATEGORY, capability: "invoice_validation" });
  if (!intelligence) return stored;
  const financials = invoiceFinancialsFromStructured(intelligence.structured);
  const db = await getDb();
  await db.update(operationDocuments).set({ analysisSummary: JSON.stringify({ summary: intelligence.summary, confidence: intelligence.confidence, model: intelligence.model, documentIntelligence: intelligence.structured }) }).where(and(eq(operationDocuments.id, invoice.id), eq(operationDocuments.organizationId, operation.organizationId)));
  return financials;
}

async function snapshot(operationId: number, organizationId: number, refreshInvoice = false) {
  await ensureSupplierBankDetails();
  const db = await getDb();
  const [operation, documents, settings, advice] = await Promise.all([
    db.select().from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, organizationId))).limit(1),
    db.select().from(operationDocuments).where(and(eq(operationDocuments.operationId, operationId), eq(operationDocuments.organizationId, organizationId))).limit(1000),
    db.select().from(exportControlSettings).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, organizationId))).limit(1),
    db.select().from(shipmentAdvices).where(and(eq(shipmentAdvices.operationId, operationId), eq(shipmentAdvices.organizationId, organizationId))).limit(1),
  ]);
  if (!operation[0]) throw new Error("Processo não encontrado.");
  const invoiceFinancials = await readApprovedInvoiceFinancials(operation[0], documents, refreshInvoice);
  const supplier = operation[0].supplierId ? (await db.select().from(suppliers).where(and(eq(suppliers.id, operation[0].supplierId), eq(suppliers.organizationId, organizationId))).limit(1))[0] : null;
  const generated = buildShipmentAdvice(
    { ...operation[0], supplierBankDetails: supplier?.bankDetails || "" },
    documents,
    { name: settings[0]?.customerName || operation[0].euImporter, email: settings[0]?.customerEmail || "" },
    invoiceFinancials,
  );
  return { advice: advice[0] ?? null, documents, generated, invoiceFinancials, complete: generated.checklist.filter((item) => item.required).every((item) => item.present) };
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
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
    const body = await request.json() as { operationId?: number; action?: string; documentId?: number; approved?: boolean; recipient?: string };
    const operationId = Number(body.operationId);
    if (!operationId) return Response.json({ error: "Processo inválido." }, { status: 400 });
    const db = await getDb();
    if (body.action === "set-document-status") {
      const documentId = Number(body.documentId);
      const [document] = await db.select().from(operationDocuments).where(and(eq(operationDocuments.id, documentId), eq(operationDocuments.operationId, operationId), eq(operationDocuments.organizationId, context.organizationId))).limit(1);
      if (!document || document.category !== SHIPMENT_SET_CATEGORY) return Response.json({ error: "Documento da Etapa 09 não encontrado." }, { status: 404 });
      await db.update(operationDocuments).set({ shipmentSetStatus: body.approved ? "Incluído" : "Candidato", clientShareStatus: body.approved ? "Aprovado" : "Revisão pendente" }).where(and(eq(operationDocuments.id, documentId), eq(operationDocuments.organizationId, context.organizationId)));
      await audit(context, body.approved ? "SHIPMENT_DOCUMENT_APPROVED" : "SHIPMENT_DOCUMENT_REVIEW_REOPENED", "operation_document", String(documentId), { operationId, fileName: document.fileName });
      return Response.json(await snapshot(operationId, context.organizationId));
    }
    if (body.action === "approve-send") {
      const current = await snapshot(operationId, context.organizationId, true);
      if (!current.complete) return Response.json({ error: "O set obrigatório ainda está incompleto. Aprove os documentos pendentes da Etapa 09." }, { status: 409 });
      if (!current.generated.included.length) return Response.json({ error: "Nenhum documento foi aprovado para envio." }, { status: 409 });
      const [settings] = await db.select().from(exportControlSettings).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, context.organizationId))).limit(1);
      const recipient = String(settings?.customerEmail || current.generated.recipient).trim().toLowerCase();
      const delivery = await deliverShipmentAdvice(recipient, current.generated.subject, current.generated.body, current.generated.included);
      const now = new Date().toISOString();
      await db.insert(clientNotifications).values({ organizationId: context.organizationId, operationId, milestoneCode: "DOCUMENT_SET", recipient, subject: current.generated.subject, body: current.generated.body, status: delivery.status, provider: delivery.provider, externalId: delivery.externalId, error: delivery.error, sentAt: delivery.status === "Enviado" ? now : null });
      if (delivery.status !== "Enviado") return Response.json({ error: delivery.error, delivery }, { status: 503 });
      const sentAdvice = { organizationId: context.organizationId, operationId, status: "Enviado · aprovado por responsável", recipient, subject: current.generated.subject, body: current.generated.body, paymentRequest: "Solicitar pagamento do saldo e comprovante SWIFT / MT103.", documentIdsJson: JSON.stringify(current.generated.included.map((document) => document.id)), checklistJson: JSON.stringify(current.generated.checklist), humanApproved: true, approvedBy: context.email, approvedAt: now, sentAt: now, updatedAt: now };
      await db.insert(shipmentAdvices).values(sentAdvice).onConflictDoUpdate({ target: [shipmentAdvices.organizationId, shipmentAdvices.operationId], set: sentAdvice });
      await audit(context, "SHIPMENT_ADVICE_APPROVED_AND_SENT", "operation", String(operationId), { recipient, documentCount: current.generated.included.length, externalId: delivery.externalId });
      return Response.json({ ...(await snapshot(operationId, context.organizationId)), delivery });
    }
    if (body.action !== "regenerate") return Response.json({ error: "Ação inválida." }, { status: 400 });
    const current = await snapshot(operationId, context.organizationId, true);
    const values = {
      organizationId: context.organizationId,
      operationId,
      status: "Rascunho · revisão humana",
      recipient: current.generated.recipient,
      subject: current.generated.subject,
      body: current.generated.body,
      paymentRequest: "Solicitar pagamento do saldo e comprovante SWIFT / MT103.",
      documentIdsJson: JSON.stringify(current.generated.included.map((document) => document.id)),
      checklistJson: JSON.stringify(current.generated.checklist),
      humanApproved: false,
      approvedBy: "",
      approvedAt: null,
      sentAt: null,
      updatedAt: new Date().toISOString(),
    };
    await db.insert(shipmentAdvices).values(values).onConflictDoUpdate({ target: [shipmentAdvices.organizationId, shipmentAdvices.operationId], set: values });
    await audit(context, "SHIPMENT_ADVICE_DRAFT_REGENERATED", "operation", String(operationId), { documentCount: current.generated.included.length, complete: current.complete });
    return Response.json(await snapshot(operationId, context.organizationId));
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

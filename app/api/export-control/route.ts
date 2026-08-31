import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { clientNotifications, countryComplianceChecks, exportControlSettings, exportMilestones, importerClients, operationDocuments, operationTasks, operations, shipmentTrackingEvents, suppliers } from "../../../db/schema";
import { addDays, canApproveShipment, countryRequirements, EXPORT_ORDER_MILESTONES, isEudrRequired, milestoneEmail, requirementMatches } from "../../../lib/export-control";
import { gmailDeliveryConfiguration, sendGmailEmail } from "../../../lib/gmail-integration";
import { audit, requireSecurityContext } from "../../../lib/security";
import { encodeTrackingLocation, freeTrackingGuide, shipsGoConfiguration, trackOceanShipment } from "../../../lib/shipsgo";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

function safeInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const DEFAULT_OPERATION_TASKS = [
  "Solicitar emissão da S.O",
  "Conferir S.O",
  "Enviar S.O para o cliente",
  "Cobrar S.O assinada do cliente",
  "Cobrar adiantamento do cliente",
  "Enviar pedido para o fornecedor",
  "Conferir HT com o fornecedor",
  "Cobrar pedido de compra assinado",
  "Enviar S.O assinada para a trading",
  "Cotar frete",
  "Confirmar frete com a trading",
  "Emissão do draft de documentos",
  "Enviar draft ao cliente para conferência",
  "Conferir correções do cliente",
  "Finalizar documentos e preparar Shipment Advice",
];

async function ownedOperation(db: Awaited<ReturnType<typeof getDb>>, operationId: number, organizationId: number) {
  return (await db.select().from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, organizationId))).limit(1))[0];
}

async function seedControl(db: Awaited<ReturnType<typeof getDb>>, operation: typeof operations.$inferSelect, organizationId: number) {
  const now = new Date();
  const [existingSettings, existingMilestones, existingTasks] = await Promise.all([
    db.select({ id: exportControlSettings.id }).from(exportControlSettings).where(eq(exportControlSettings.operationId, operation.id)).limit(1),
    db.select().from(exportMilestones).where(eq(exportMilestones.operationId, operation.id)),
    db.select({ id: operationTasks.id }).from(operationTasks).where(eq(operationTasks.operationId, operation.id)).limit(1),
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

  if (!existingTasks.length) {
    for (const [index, description] of DEFAULT_OPERATION_TASKS.entries()) {
      await db.insert(operationTasks).values({
        organizationId,
        operationId: operation.id,
        sequence: index + 1,
        description,
        responsibleName: operation.internalResponsible,
        responsibleEmail: operation.responsibleEmail,
      });
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

function money(value: number, currency: string) {
  return `${currency || "USD"} ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

const DEFAULT_ORDER_NOTES = `TOLERANCES: -1/+2MM;
ORIGIN COUNTRY: BRAZIL;
10% ALLOWANCE FOR MORE OR LESS IN AMOUNT AND QUANTITY.
QUALITY B GRADE - EVENTUAL BLUESTAIN AND WANES IS ALLOWED.
MANDATORY CERTIFICATES: NIMF 15 CERTIFICATION, CERTIFICATE OF ORIGIN, PHYTOSANITARY CERTIFICATE.
IF ANY SIGNIFICANT INCREASE ON LOG PRICES AND/OR OCEAN FREIGHTS, OR IF A SIGNIFICANT DROP ON THE EXCHANGE RATE HAPPENS, PRICE MAY SUFFER ADJUSTMENT PRIOR TO SHIPMENT.
ANY CLAIM NEED TO BE ADVISED WITHIN MAXIMUM 15 DAYS AFTER ARRIVAL AND FULL QUANTITY NEEDS TO BE AVAILABLE FOR SUPPLIER'S INSPECTION. PICTURES SHOWING THE PROBLEM WITH THE TIMBER MUST BE SENT WITH THE CLAIM REPORT.`;

type OrderItem = { species: string; quality: string; size: string; volume: number; unitPrice: number };
type SupplierOrder = { tradingName?: string; currency?: string; incoterm?: string; paymentTerms?: string; notes?: string; items?: OrderItem[] };

function parsedOrderDetails(operation: typeof operations.$inferSelect) {
  const fallbackItems = [{ species: operation.species || operation.rawMaterial || "Taeda Pine", quality: operation.product, size: operation.lotCodes || "As per order", volume: operation.volumeM3 || operation.quantity || 0, unitPrice: operation.volumeM3 || operation.quantity ? operation.commercialValue / (operation.volumeM3 || operation.quantity) : 0 }];
  try {
    const parsed = JSON.parse(operation.supplyChainNotes || "{}") as { orderItems?: OrderItem[]; paymentTerms?: string; orderNotes?: string; supplierOrder?: SupplierOrder };
    const supplierItems = Array.isArray(parsed.supplierOrder?.items) && parsed.supplierOrder.items.length ? parsed.supplierOrder.items : fallbackItems;
    return {
      items: Array.isArray(parsed.orderItems) && parsed.orderItems.length ? parsed.orderItems : fallbackItems,
      paymentTerms: String(parsed.paymentTerms ?? "").trim(),
      notes: String(parsed.orderNotes ?? "").trim() || DEFAULT_ORDER_NOTES,
      supplierOrder: { ...parsed.supplierOrder, items: supplierItems },
    };
  } catch {
    return { items: fallbackItems, paymentTerms: "", notes: operation.supplyChainNotes || DEFAULT_ORDER_NOTES, supplierOrder: { items: fallbackItems } };
  }
}

function documentTitle(type: string) {
  if (type === "purchase-invoice") return "PURCHASE INVOICE";
  if (type === "supplier-po") return "PEDIDO DE COMPRA";
  return "SALES ORDER";
}

async function orderDocumentHtml(db: Awaited<ReturnType<typeof getDb>>, operation: typeof operations.$inferSelect, organizationId: number, type: string) {
  const [supplier] = operation.supplierId ? await db.select().from(suppliers).where(and(eq(suppliers.id, operation.supplierId), eq(suppliers.organizationId, organizationId))).limit(1) : [];
  const [client] = operation.importerClientId ? await db.select().from(importerClients).where(and(eq(importerClients.id, operation.importerClientId), eq(importerClients.organizationId, organizationId))).limit(1) : [];
  const isSupplierDocument = type === "supplier-po";
  const isPurchaseInvoice = type === "purchase-invoice";
  const title = documentTitle(type);
  const details = parsedOrderDetails(operation);
  const exporterBankDetails = supplier?.bankDetails?.trim() || "";
  const supplierOrder = details.supplierOrder;
  const sellerName = isSupplierDocument ? (supplierOrder.tradingName || operation.exporterName || "HUB DAS AMERICAS / EXPORTATRUST") : (operation.exporterName || supplier?.legalName || operation.supplierName);
  const buyerName = isSupplierDocument ? (supplier?.legalName || operation.supplierName) : (client?.legalName || operation.euImporter);
  const sellerDetails = isSupplierDocument ? "Comprador / trading\nOperação de exportação Brasil" : [supplier?.legalName || operation.exporterName, supplier?.taxId ? `CNPJ/Tax ID: ${supplier.taxId}` : operation.exporterTaxId ? `Tax ID: ${operation.exporterTaxId}` : "", supplier ? `${supplier.city} - ${supplier.state} - ${supplier.country}` : "", supplier?.email ? `Email: ${supplier.email}` : ""].filter(Boolean).join("\n");
  const buyerDetails = isSupplierDocument ? [supplier?.taxId ? `CNPJ/Tax ID: ${supplier.taxId}` : "", supplier ? `${supplier.city} - ${supplier.state} - ${supplier.country}` : "", supplier?.email ? `Email: ${supplier.email}` : ""].filter(Boolean).join("\n") : [client?.taxId ? `${client.taxIdType || "Tax ID"}: ${client.taxId}` : "", client?.address, [client?.city, client?.state, client?.country || operation.destinationCountry].filter(Boolean).join(" - "), client?.email ? `Email: ${client.email}` : ""].filter(Boolean).join("\n");
  const docCurrency = isSupplierDocument ? (supplierOrder.currency || operation.currency) : operation.currency;
  const docItems = isSupplierDocument ? supplierOrder.items || details.items : details.items;
  const rows = isSupplierDocument ? [
    ["Data", new Date().toLocaleDateString("pt-BR")],
    ["Processo", operation.reference],
    ["Referência cliente", operation.contractNumber],
    ["Porto destino", operation.portOfDischarge],
    ["Incoterm compra", supplierOrder.incoterm || operation.incoterm],
    ["Condição pagamento", supplierOrder.paymentTerms],
    ["Previsão embarque", operation.shipmentDate],
    ["Moeda", docCurrency],
    ["NCM / HS Code", operation.hsCode],
  ] : [
    ["Date", new Date().toLocaleDateString("en-GB")],
    ["Reference", operation.reference],
    ["Customer reference", operation.contractNumber],
    ["POD", operation.portOfDischarge],
    ["Incoterm", operation.incoterm],
    ["Payment terms", details.paymentTerms],
    ["Estimated delivery", operation.shipmentDate],
    ["Currency", operation.currency],
    ["NCM / HS Code", operation.hsCode],
  ];
  const populatedRows = rows.filter(([, value]) => value);
  const detailRows = isSupplierDocument
    ? populatedRows.map((row, index, source) => index % 2 ? "" : `<tr><th>${escapeHtml(row[0])}</th><td>${escapeHtml(row[1])}</td><th>${escapeHtml(source[index + 1]?.[0] || "")}</th><td>${escapeHtml(source[index + 1]?.[1] || "")}</td></tr>`).join("")
    : populatedRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("");
  const total = docItems.reduce((sum, item) => sum + safeNumber(item.volume) * safeNumber(item.unitPrice), 0);
  const itemRows = docItems.map((item) => `<tr><td>${escapeHtml(item.species)}</td><td>${escapeHtml(item.quality)}</td><td>${escapeHtml(item.size)}</td><td>${escapeHtml(safeNumber(item.volume))} CBM</td><td>${escapeHtml(money(safeNumber(item.unitPrice), docCurrency))}</td><td>${escapeHtml(money(safeNumber(item.volume) * safeNumber(item.unitPrice), docCurrency))}</td></tr>`).join("");
  const footerBlock = isPurchaseInvoice
    ? `<section class="notes bank-details"><strong>BANK DETAILS</strong><br>${escapeHtml(exporterBankDetails)}</section>`
    : `<section class="notes"><strong>${isSupplierDocument ? "OBSERVAÇÕES" : "NOTES"}</strong><br>${escapeHtml(isSupplierDocument ? supplierOrder.notes || "" : details.notes)}</section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} ${escapeHtml(operation.reference)}</title><style>
    @page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;background:#f3f7f5;color:#20362d;font-size:11px}.page{width:190mm;min-height:277mm;margin:0 auto;background:#fff;padding:8mm;border:1px solid #d8e5df}.top{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #086c55;padding-bottom:10px}.brand{font-weight:800;letter-spacing:2px;color:#086c55}.top p{margin:6px 0 0}.title{text-align:right}.title h1{margin:0;font-size:22px}.title b{display:block;margin-top:5px}.parties{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.box{border:1px solid #dfe9e4;padding:9px;white-space:pre-line;min-height:76px;page-break-inside:avoid}.box h2{margin:0 0 6px;font-size:10px;color:#086c55;letter-spacing:.8px}h2{font-size:13px;margin:12px 0 6px}table{width:100%;border-collapse:collapse;margin-top:8px;table-layout:fixed;page-break-inside:avoid}th,td{border:1px solid #dfe9e4;padding:5px 6px;text-align:left;vertical-align:top;line-height:1.25;word-break:break-word}th{background:#f1f7f4;color:#60756c;font-size:9px;text-transform:uppercase}tfoot td{font-weight:800;background:#f8fbf9}.meta th{width:17%}.meta td{width:33%}.items col:nth-child(1){width:17%}.items col:nth-child(2){width:18%}.items col:nth-child(3){width:21%}.items col:nth-child(4){width:12%}.items col:nth-child(5){width:15%}.items col:nth-child(6){width:17%}.notes{margin-top:10px;border-left:3px solid #086c55;background:#f4faf7;padding:8px;white-space:pre-line;font-size:10px;line-height:1.25;page-break-inside:avoid}.bank-details{background:#fffdf5;border-left-color:#b78922}.sign{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:28px;page-break-inside:avoid}.line{border-top:1px solid #80958b;padding-top:6px;color:#60756c;text-align:center}.line b{display:block;color:#20362d;margin-bottom:2px}@media print{body{background:#fff}.page{margin:0;border:0;width:auto;min-height:auto;padding:0}}</style></head><body><main class="page"><section class="top"><div><div class="brand">EXPORTATRUST</div><p>${isSupplierDocument ? "Export Control · Etapa 01" : "Export Control · Stage 01"}</p></div><div class="title"><h1>${escapeHtml(title)}</h1><b>${escapeHtml(operation.reference)}</b></div></section><section class="parties"><article class="box"><h2>${isSupplierDocument ? "COMPRADOR / EMISSOR" : "SELLER / EXPORTER"}</h2><strong>${escapeHtml(sellerName)}</strong><br>${escapeHtml(sellerDetails)}</article><article class="box"><h2>${isSupplierDocument ? "FORNECEDOR BRASIL" : "BUYER / CONSIGNEE"}</h2><strong>${escapeHtml(buyerName)}</strong><br>${escapeHtml(buyerDetails)}</article></section><table class="meta">${detailRows}</table><h2>${isSupplierDocument ? "ITENS DO PEDIDO" : "ORDER DETAILS"}</h2><table class="items"><colgroup><col><col><col><col><col><col></colgroup><thead><tr><th>${isSupplierDocument ? "Produto" : "Species"}</th><th>${isSupplierDocument ? "Qualidade" : "Quality"}</th><th>${isSupplierDocument ? "Medida" : "Size"}</th><th>${isSupplierDocument ? "Volume" : "Volume"}</th><th>${isSupplierDocument ? "Preco / CBM" : "Price / CBM"}</th><th>Total</th></tr></thead><tbody>${itemRows}</tbody><tfoot><tr><td colspan="5">TOTAL</td><td>${escapeHtml(money(total, docCurrency))}</td></tr></tfoot></table>${footerBlock}<section class="sign"><div class="line"><b>${isSupplierDocument ? "Assinatura do comprador / trading" : "Importer / Buyer signature"}</b>${escapeHtml(sellerName)}</div><div class="line"><b>${isSupplierDocument ? "Assinatura do fornecedor" : "Exporter / Supplier signature"}</b>${escapeHtml(buyerName)}</div></section></main><script>window.print()</script></body></html>`;
}

async function emailProviderConfiguration(context: Awaited<ReturnType<typeof requireSecurityContext>>) {
  const gmail = await gmailDeliveryConfiguration(context);
  if (gmail.ready) return { apiKey: "", from: gmail.sender, ready: true, provider: "Gmail", gmailReady: true };
  const { env } = await import("cloudflare:workers");
  const runtime = env as unknown as Record<string, unknown>;
  const apiKey = String(runtime.RESEND_API_KEY ?? "").trim();
  const from = String(runtime.EMAIL_FROM ?? "").trim();
  return { apiKey, from, ready: Boolean(apiKey && from), provider: "Resend", gmailReady: false };
}

async function tryDeliverEmail(context: Awaited<ReturnType<typeof requireSecurityContext>>, recipient: string, subject: string, body: string, html: string) {
  if (!recipient) return { status: "Rascunho", provider: "none", externalId: "", error: "E-mail do cliente não cadastrado." };
  if (!validEmail(recipient)) return { status: "Falha", provider: "validation", externalId: "", error: "Endereço de e-mail inválido." };
  const { apiKey, from, ready, gmailReady } = await emailProviderConfiguration(context);
  if (gmailReady) return sendGmailEmail(context, recipient, subject, body, html);
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

async function createNotification(context: Awaited<ReturnType<typeof requireSecurityContext>>, db: Awaited<ReturnType<typeof getDb>>, organizationId: number, operation: typeof operations.$inferSelect, settings: typeof exportControlSettings.$inferSelect, milestoneCode: string, milestoneTitle: string, status: string, note: string, forceDelivery = false) {
  const email = milestoneEmail(operation.reference, milestoneTitle, status, note, operation);
  const delivery = settings.notificationsEnabled || forceDelivery
    ? await tryDeliverEmail(context, settings.customerEmail, email.subject, email.body, email.html)
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
  await db.update(exportControlSettings).set({ emailProviderStatus: delivery.provider === "gmail" || delivery.provider === "resend" ? "Ativo" : delivery.provider === "not-configured" || delivery.provider === "gmail-not-connected" ? "Configuração necessária" : delivery.status, updatedAt: now }).where(and(eq(exportControlSettings.operationId, operation.id), eq(exportControlSettings.organizationId, organizationId)));
  return { notification, delivery };
}

async function snapshot(context: Awaited<ReturnType<typeof requireSecurityContext>>, operationId: number, organizationId: number, controlSeeded = false) {
  await ensureBaseTables();
  const db = await getDb();
  const operation = await ownedOperation(db, operationId, organizationId);
  if (!operation) throw new Error("Processo não encontrado.");
  if (!controlSeeded) await seedControl(db, operation, organizationId);
  const [settings, milestones, tasks, notifications, tracking, checks, documents] = await Promise.all([
    db.select().from(exportControlSettings).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, organizationId))).limit(1),
    db.select().from(exportMilestones).where(and(eq(exportMilestones.operationId, operationId), eq(exportMilestones.organizationId, organizationId))).orderBy(exportMilestones.sequence),
    db.select().from(operationTasks).where(and(eq(operationTasks.operationId, operationId), eq(operationTasks.organizationId, organizationId))).orderBy(operationTasks.sequence),
    db.select().from(clientNotifications).where(and(eq(clientNotifications.operationId, operationId), eq(clientNotifications.organizationId, organizationId))).orderBy(desc(clientNotifications.id)).limit(100),
    db.select().from(shipmentTrackingEvents).where(and(eq(shipmentTrackingEvents.operationId, operationId), eq(shipmentTrackingEvents.organizationId, organizationId))).orderBy(desc(shipmentTrackingEvents.id)).limit(100),
    db.select().from(countryComplianceChecks).where(and(eq(countryComplianceChecks.operationId, operationId), eq(countryComplianceChecks.organizationId, organizationId))).orderBy(desc(countryComplianceChecks.id)).limit(1),
    db.select({ category: operationDocuments.category, fileName: operationDocuments.fileName, shipmentSetStatus: operationDocuments.shipmentSetStatus, clientShareStatus: operationDocuments.clientShareStatus }).from(operationDocuments).where(and(eq(operationDocuments.operationId, operationId), eq(operationDocuments.organizationId, organizationId))).limit(5000),
  ]);
  const documentTexts = documents.flatMap((document) => [document.category, document.fileName]);
  const eudrRequired = isEudrRequired(operation.destinationCountry, operation.hsCode, operation.product);
  const requirementRows = countryRequirements(operation.destinationCountry, operation.hsCode, operation.product).map((requirement) => ({ ...requirement, present: requirement.key === "eudr" ? Boolean(operation.eudrReference) || requirementMatches(requirement, documentTexts) : requirementMatches(requirement, documentTexts) }));
  const requiredRows = requirementRows.filter((item) => item.required);
  const score = requiredRows.length ? Math.round(requiredRows.filter((item) => item.present).length / requiredRows.length * 100) : 100;
  const emailConfiguration = await emailProviderConfiguration(context);
  const trackingConfiguration = await shipsGoConfiguration();
  const assistedTracking = freeTrackingGuide(operation);
  const today = new Date().toISOString().slice(0, 10);
  const activeMilestones = milestones.filter((milestone) => !["Concluído", "Suspenso"].includes(milestone.status));
  const openTasks = tasks.filter((task) => task.status !== "Concluído");
  const overdueTasks = openTasks.filter((task) => task.dueDate && task.dueDate < today);
  const incompletePlans = activeMilestones.filter((milestone) => !milestone.responsibleName || !milestone.dueDate || !milestone.nextAction);
  const overdueMilestones = activeMilestones.filter((milestone) => milestone.dueDate && milestone.dueDate < today);
  const stageRows = milestones.map((milestone) => {
    const applicable = milestone.status !== "Suspenso";
    const stageDocuments = documents.filter((document) => document.category === milestone.category);
    const passed = !applicable || milestone.status === "Concluído";
    return { code: milestone.code, sequence: milestone.sequence, title: milestone.title, status: milestone.status, applicable, passed, documentCount: stageDocuments.length, issue: !applicable ? "Não aplicável" : passed ? "Etapa concluída" : `Etapa ${milestone.status.toLowerCase()}` };
  });
  const applicableStages = stageRows.filter((stage) => stage.applicable);
  const stageScore = applicableStages.length ? Math.round(applicableStages.filter((stage) => stage.passed).length / applicableStages.length * 100) : 100;
  const approvedSetDocuments = documents.filter((document) => document.category === "Export Control · Set documental" && document.shipmentSetStatus === "Incluído" && document.clientShareStatus === "Aprovado").length;
  const verdict = score === 100 && stageScore === 100 ? "Aprovado para revisão humana" : "Pendências identificadas";
  const opinion = `${verdict}: ${applicableStages.filter((stage) => stage.passed).length}/${applicableStages.length} etapas aplicáveis concluídas, exigências do destino em ${score}% e ${approvedSetDocuments} documento(s) aprovado(s) na Etapa 09.${eudrRequired ? ` Prontidão EUDR: ${operation.readiness}%.` : " EUDR não aplicável ao destino."}`;
  return {
    operation,
    settings: settings[0],
    milestones,
    tasks,
    notifications,
    tracking,
    eudrBridge: {
      readiness: operation.readiness,
      reference: operation.eudrReference,
      required: eudrRequired,
      status: !eudrRequired ? "Suspenso · EUDR não aplicável para este destino" : operation.eudrReference ? "Referência DDS registrada" : operation.readiness >= 100 ? "Checklist concluído · revisão pendente" : operation.readiness > 0 ? "Em andamento" : "Não iniciado",
    },
    emailDelivery: { provider: emailConfiguration.provider, ready: emailConfiguration.ready, sender: emailConfiguration.from || "Não configurado" },
    trackingProvider: { provider: trackingConfiguration.provider, configured: trackingConfiguration.configured, assisted: assistedTracking },
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
    taskAlerts: {
      open: openTasks.length,
      overdue: overdueTasks.length,
      scheduled: tasks.filter((task) => task.scheduled).length,
    },
    compliance: { score, stageScore, status: score === 100 && stageScore === 100 ? "Aprovado" : "Pendente", verdict, opinion, approvedSetDocuments, eudrRequired, requirements: requirementRows, stages: stageRows, lastCheck: checks[0] ?? null },
  };
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    const url = new URL(request.url);
    const operationId = Number(url.searchParams.get("operationId"));
    if (!operationId) return Response.json({ error: "Processo inválido." }, { status: 400 });
    const document = String(url.searchParams.get("document") ?? "");
    if (document) {
      if (!["sales-order", "purchase-invoice", "supplier-po"].includes(document)) return Response.json({ error: "Documento inválido." }, { status: 400 });
      const db = await getDb();
      const operation = await ownedOperation(db, operationId, context.organizationId);
      if (!operation) return Response.json({ error: "Processo não encontrado." }, { status: 404 });
      return new Response(await orderDocumentHtml(db, operation, context.organizationId, document), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return Response.json(await snapshot(context, operationId, context.organizationId));
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

    if (action === "order-commercial") {
      const orderItems = Array.isArray(body.orderItems) ? body.orderItems.map((item) => {
        const row = item as Record<string, unknown>;
        return { species: String(row.species ?? "").trim(), quality: String(row.quality ?? "").trim(), size: String(row.size ?? "").trim(), volume: safeNumber(row.volume), unitPrice: safeNumber(row.unitPrice) };
      }).filter((item) => item.species || item.quality || item.size || item.volume || item.unitPrice) : [];
      const supplierBody = body.supplierOrder as Record<string, unknown> | undefined;
      const supplierItems = Array.isArray(supplierBody?.items) ? supplierBody.items.map((item) => {
        const row = item as Record<string, unknown>;
        return { species: String(row.species ?? "").trim(), quality: String(row.quality ?? "").trim(), size: String(row.size ?? "").trim(), volume: safeNumber(row.volume), unitPrice: safeNumber(row.unitPrice) };
      }).filter((item) => item.species || item.quality || item.size || item.volume || item.unitPrice) : orderItems;
      const supplierOrder = {
        tradingName: String(supplierBody?.tradingName ?? "").trim(),
        currency: String(supplierBody?.currency ?? body.currency ?? "USD").trim(),
        incoterm: String(supplierBody?.incoterm ?? body.incoterm ?? "FOB").trim(),
        paymentTerms: String(supplierBody?.paymentTerms ?? "").trim(),
        notes: String(supplierBody?.notes ?? "").trim(),
        items: supplierItems,
      };
      const totalVolume = orderItems.reduce((sum, item) => sum + item.volume, 0);
      const totalValue = orderItems.reduce((sum, item) => sum + item.volume * item.unitPrice, 0);
      const orderNotes = String(body.orderNotes ?? DEFAULT_ORDER_NOTES).trim() || DEFAULT_ORDER_NOTES;
      const paymentTerms = String(body.paymentTerms ?? "").trim();
      const values = {
        reference: String(body.reference ?? operation.reference).trim().toUpperCase() || operation.reference,
        contractNumber: String(body.contractNumber ?? "").trim(),
        product: String(body.product ?? "").trim() || operation.product,
        hsCode: String(body.hsCode ?? "").trim(),
        species: orderItems[0]?.species || String(body.species ?? "").trim(),
        lotCodes: orderItems.map((item) => [item.quality, item.size].filter(Boolean).join(" · ")).filter(Boolean).join("; "),
        quantity: safeNumber(body.quantity) || totalVolume,
        quantityUnit: String(body.quantityUnit ?? "MT").trim(),
        volumeM3: safeNumber(body.volumeM3) || totalVolume,
        commercialValue: orderItems.length ? totalValue : safeNumber(body.commercialValue),
        currency: String(body.currency ?? "USD").trim(),
        incoterm: String(body.incoterm ?? "FOB").trim(),
        shipmentDate: String(body.shipmentDate ?? "").trim(),
        portOfLoading: String(body.portOfLoading ?? "").trim(),
        portOfDischarge: String(body.portOfDischarge ?? "").trim(),
        exporterName: String(body.exporterName ?? "").trim(),
        exporterTaxId: String(body.exporterTaxId ?? "").trim(),
        supplyChainNotes: JSON.stringify({ orderItems, paymentTerms, orderNotes, supplierOrder }),
      };
      await db.update(operations).set(values).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId)));
      const customerEmail = String(body.customerEmail ?? settings.customerEmail ?? "").trim().toLowerCase();
      if (customerEmail && !validEmail(customerEmail)) return Response.json({ error: "Informe um e-mail válido para o comprador." }, { status: 400 });
      await db.update(exportControlSettings).set({ customerName: String(body.customerName ?? settings.customerName ?? "").trim(), customerEmail, updatedAt: now.toISOString() }).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, context.organizationId)));
      await audit(context, "ORDER_COMMERCIAL_DETAILS_UPDATED", "operation", String(operationId), { reference: values.reference, incoterm: values.incoterm, currency: values.currency, volumeM3: values.volumeM3, commercialValue: values.commercialValue });
      return Response.json(await snapshot(context, operationId, context.organizationId, true));
    }

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
      return Response.json(await snapshot(context, operationId, context.organizationId, true));
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
        const currentControl = await snapshot(context, operationId, context.organizationId, true);
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
        await createNotification(context, db, context.organizationId, operation, settings, milestone.code, milestone.title, status, note);
      }
      await db.update(operations).set({ status: status === "Concluído" && milestone.code === "DELIVERED" ? "Concluído" : milestone.title }).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId)));
      await audit(context, "EXPORT_MILESTONE_UPDATED", "operation", String(operationId), { code, status, qualityStatus, shipmentApproval, responsibleName, dueDate, nextAction });
      return Response.json(await snapshot(context, operationId, context.organizationId, true));
    }

    if (action === "country-check") {
      const current = await snapshot(context, operationId, context.organizationId, true);
      await db.insert(countryComplianceChecks).values({ organizationId: context.organizationId, operationId, country: operation.destinationCountry, hsCode: operation.hsCode, score: Math.round((current.compliance.score + current.compliance.stageScore) / 2), status: current.compliance.status, resultJson: JSON.stringify({ requirements: current.compliance.requirements, stages: current.compliance.stages, verdict: current.compliance.verdict, opinion: current.compliance.opinion }), checkedAt: now.toISOString() });
      await audit(context, "COUNTRY_COMPLIANCE_CHECKED", "operation", String(operationId), { country: operation.destinationCountry, documentScore: current.compliance.score, stageScore: current.compliance.stageScore, verdict: current.compliance.verdict });
      return Response.json(await snapshot(context, operationId, context.organizationId, true));
    }

    if (action === "booking-logistics") {
      const values = {
        carrier: String(body.carrier ?? "").trim(),
        bookingNumber: String(body.bookingNumber ?? "").trim(),
        billOfLadingNumber: String(body.billOfLadingNumber ?? "").trim(),
        containerNumbers: String(body.containerNumbers ?? "").trim(),
        vesselVoyage: String(body.vesselVoyage ?? "").trim(),
        portOfLoading: String(body.portOfLoading ?? "").trim(),
        portOfDischarge: String(body.portOfDischarge ?? "").trim(),
        shipmentDate: String(body.shipmentDate ?? "").trim(),
      };
      await db.update(operations).set(values).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId)));
      await audit(context, "BOOKING_LOGISTICS_UPDATED", "operation", String(operationId), values);
      return Response.json(await snapshot(context, operationId, context.organizationId, true));
    }

    if (action === "operation-task-create") {
      const existingTasks = await db.select().from(operationTasks).where(and(eq(operationTasks.operationId, operationId), eq(operationTasks.organizationId, context.organizationId))).orderBy(operationTasks.sequence);
      const sequence = safeInteger(body.sequence, existingTasks.length + 1, 1, 999);
      const description = String(body.description ?? "Nova tarefa").trim() || "Nova tarefa";
      const responsibleEmail = String(body.responsibleEmail ?? operation.responsibleEmail ?? "").trim().toLowerCase();
      if (responsibleEmail && !validEmail(responsibleEmail)) return Response.json({ error: "Informe um e-mail válido para o responsável da tarefa." }, { status: 400 });
      await db.insert(operationTasks).values({
        organizationId: context.organizationId,
        operationId,
        sequence,
        description,
        dueDate: String(body.dueDate ?? "").trim(),
        responsibleName: String(body.responsibleName ?? operation.internalResponsible ?? "").trim(),
        responsibleEmail,
        scheduled: Boolean(body.scheduled),
        status: ["Pendente", "Agendada", "Em andamento", "Concluído", "Atrasada"].includes(String(body.status)) ? String(body.status) : "Pendente",
        note: String(body.note ?? "").trim(),
      });
      await audit(context, "OPERATION_TASK_CREATED", "operation", String(operationId), { sequence, description });
      return Response.json(await snapshot(context, operationId, context.organizationId, true));
    }

    if (action === "operation-task-update") {
      const taskId = Number(body.taskId);
      const [task] = await db.select().from(operationTasks).where(and(eq(operationTasks.id, taskId), eq(operationTasks.operationId, operationId), eq(operationTasks.organizationId, context.organizationId))).limit(1);
      if (!task) return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
      const responsibleEmail = String(body.responsibleEmail ?? "").trim().toLowerCase();
      if (responsibleEmail && !validEmail(responsibleEmail)) return Response.json({ error: "Informe um e-mail válido para o responsável da tarefa." }, { status: 400 });
      const status = ["Pendente", "Agendada", "Em andamento", "Concluído", "Atrasada"].includes(String(body.status)) ? String(body.status) : task.status;
      await db.update(operationTasks).set({
        sequence: safeInteger(body.sequence, task.sequence, 1, 999),
        description: String(body.description ?? task.description).trim() || task.description,
        dueDate: String(body.dueDate ?? "").trim(),
        responsibleName: String(body.responsibleName ?? "").trim(),
        responsibleEmail,
        scheduled: Boolean(body.scheduled),
        status,
        note: String(body.note ?? "").trim(),
        completedAt: status === "Concluído" ? (task.completedAt || now.toISOString()) : null,
        updatedAt: now.toISOString(),
      }).where(and(eq(operationTasks.id, task.id), eq(operationTasks.organizationId, context.organizationId)));
      await audit(context, "OPERATION_TASK_UPDATED", "operation", String(operationId), { taskId, status });
      return Response.json(await snapshot(context, operationId, context.organizationId, true));
    }

    if (action === "operation-task-toggle-scheduled" || action === "operation-task-complete") {
      const taskId = Number(body.taskId);
      const [task] = await db.select().from(operationTasks).where(and(eq(operationTasks.id, taskId), eq(operationTasks.operationId, operationId), eq(operationTasks.organizationId, context.organizationId))).limit(1);
      if (!task) return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
      if (action === "operation-task-toggle-scheduled") {
        const scheduled = typeof body.scheduled === "boolean" ? Boolean(body.scheduled) : !task.scheduled;
        await db.update(operationTasks).set({ scheduled, status: scheduled && task.status === "Pendente" ? "Agendada" : task.status, updatedAt: now.toISOString() }).where(and(eq(operationTasks.id, task.id), eq(operationTasks.organizationId, context.organizationId)));
        await audit(context, "OPERATION_TASK_SCHEDULED_TOGGLED", "operation", String(operationId), { taskId, scheduled });
      } else {
        const completed = Boolean(body.completed);
        await db.update(operationTasks).set({ status: completed ? "Concluído" : "Pendente", completedAt: completed ? now.toISOString() : null, updatedAt: now.toISOString() }).where(and(eq(operationTasks.id, task.id), eq(operationTasks.organizationId, context.organizationId)));
        await audit(context, "OPERATION_TASK_COMPLETION_TOGGLED", "operation", String(operationId), { taskId, completed });
      }
      return Response.json(await snapshot(context, operationId, context.organizationId, true));
    }

    if (action === "operation-task-delay-note") {
      const taskId = Number(body.taskId);
      const [task] = await db.select().from(operationTasks).where(and(eq(operationTasks.id, taskId), eq(operationTasks.operationId, operationId), eq(operationTasks.organizationId, context.organizationId))).limit(1);
      if (!task) return Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
      if (!task.responsibleEmail || !validEmail(task.responsibleEmail)) return Response.json({ error: "Cadastre um e-mail válido para o responsável antes de enviar a nota de atraso." }, { status: 400 });
      const subject = `${operation.reference} - tarefa atrasada`;
      const bodyText = `Olá ${task.responsibleName || "responsável"},\n\nA tarefa abaixo está atrasada no ExportaTrust:\n\n${task.sequence}. ${task.description}\nPrazo: ${task.dueDate || "não informado"}\nProcesso: ${operation.reference}\n\nAtualize a tarefa no controle do processo assim que possível.\n\nExportaTrust`;
      const html = `<p>Olá ${escapeHtml(task.responsibleName || "responsável")},</p><p>A tarefa abaixo está atrasada no ExportaTrust:</p><p><strong>${task.sequence}. ${escapeHtml(task.description)}</strong><br/>Prazo: ${escapeHtml(task.dueDate || "não informado")}<br/>Processo: ${escapeHtml(operation.reference)}</p><p>Atualize a tarefa no controle do processo assim que possível.</p><p>ExportaTrust</p>`;
      const delivery = await tryDeliverEmail(context, task.responsibleEmail, subject, bodyText, html);
      await db.insert(clientNotifications).values({ organizationId: context.organizationId, operationId, milestoneCode: "TASK_DELAY", recipient: task.responsibleEmail, subject, body: bodyText, status: delivery.status, provider: delivery.provider, externalId: delivery.externalId, error: delivery.error, sentAt: delivery.status === "Enviado" ? now.toISOString() : null });
      await db.update(operationTasks).set({ status: task.status === "Concluído" ? task.status : "Atrasada", note: [task.note, `Nota de atraso enviada em ${now.toISOString().slice(0, 10)}.`].filter(Boolean).join("\n"), updatedAt: now.toISOString() }).where(and(eq(operationTasks.id, task.id), eq(operationTasks.organizationId, context.organizationId)));
      await audit(context, "OPERATION_TASK_DELAY_NOTE_SENT", "operation", String(operationId), { taskId, recipient: task.responsibleEmail, deliveryStatus: delivery.status });
      return Response.json({ ...(await snapshot(context, operationId, context.organizationId, true)), deliveryResult: delivery });
    }

    if (action === "tracking-check") {
      const interval = settings.trackingIntervalDays || 10;
      const nextCheckAt = addDays(now, interval);
      const [previousTracking] = await db.select().from(shipmentTrackingEvents).where(and(eq(shipmentTrackingEvents.operationId, operationId), eq(shipmentTrackingEvents.organizationId, context.organizationId))).orderBy(desc(shipmentTrackingEvents.id)).limit(1);
      const previousRequestId = previousTracking?.source.startsWith("ShipsGo · ") ? previousTracking.source.slice("ShipsGo · ".length) : "";
      const result = await trackOceanShipment({ ...operation, requestId: previousRequestId });
      await db.insert(shipmentTrackingEvents).values({ organizationId: context.organizationId, operationId, source: `ShipsGo · ${result.requestId}`, status: result.status, location: encodeTrackingLocation(result.location, result.latitude, result.longitude), eta: result.eta, details: result.details, checkedAt: now.toISOString(), nextCheckAt });
      await db.update(exportControlSettings).set({ nextTrackingAt: nextCheckAt, updatedAt: now.toISOString() }).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, context.organizationId)));
      let deliveryResult = null;
      if (settings.customerEmail) {
        const notification = await createNotification(context, db, context.organizationId, operation, settings, "IN_TRANSIT", "Atualização de tracking marítimo", result.status, `${result.details}${result.location ? ` · Localização: ${result.location}` : ""}${result.eta ? ` · ETA: ${result.eta}` : ""}`, true);
        deliveryResult = notification.delivery;
      }
      await audit(context, "SHIPMENT_TRACKING_CHECKED", "operation", String(operationId), { booking: operation.bookingNumber, nextCheckAt });
      return Response.json({ ...(await snapshot(context, operationId, context.organizationId, true)), deliveryResult });
    }

    if (action === "assisted-tracking-log") {
      const status = String(body.status ?? "").trim();
      if (!status) return Response.json({ error: "Informe o status encontrado no site do armador." }, { status: 400 });
      const location = String(body.location ?? "").trim();
      const eta = String(body.eta ?? "").trim();
      const note = String(body.note ?? "").trim();
      const interval = settings.trackingIntervalDays || 10;
      const nextCheckAt = addDays(now, interval);
      const guide = freeTrackingGuide(operation);
      const details = [guide.reference ? `Referência ${guide.reference}` : "", guide.carrier, note].filter(Boolean).join(" · ");
      await db.insert(shipmentTrackingEvents).values({ organizationId: context.organizationId, operationId, source: `Assistido Free · ${guide.carrier}`, status, location, eta, details, checkedAt: now.toISOString(), nextCheckAt });
      await db.update(exportControlSettings).set({ nextTrackingAt: nextCheckAt, updatedAt: now.toISOString() }).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, context.organizationId)));
      await audit(context, "ASSISTED_SHIPMENT_TRACKING_LOGGED", "operation", String(operationId), { carrier: guide.carrier, reference: guide.reference, status, eta });
      return Response.json(await snapshot(context, operationId, context.organizationId, true));
    }

    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    console.error("EXPORT_CONTROL_POST_FAILED", error);
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

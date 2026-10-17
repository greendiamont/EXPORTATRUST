import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../../db";
import { auditLogs, operations } from "../../../../db/schema";
import { audit, requireSecurityContext } from "../../../../lib/security";
import { readFinance } from "../../../../lib/finance";
import { deliverInvoice, invoiceEmail, invoiceRecipient } from "../../../../lib/finance-email";

// Explicit staff action only. Never scheduled, never called just by opening/printing an invoice.
export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    if (!["administrador", "analista"].includes(context.role)) return Response.json({ error: "Envio permitido somente à equipe responsável." }, { status: 403 });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    let recipient: string;
    try { recipient = invoiceRecipient(body.recipient); } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 400 });
    }
    await ensureBaseTables();
    const db = await getDb();
    const [operation] = await db.select().from(operations).where(and(eq(operations.organizationId, context.organizationId), eq(operations.id, Number(body.operationId)))).limit(1);
    const doc = operation && readFinance(operation).documents.find((item) => item.id === body.doc);
    if (!operation || !doc) return Response.json({ error: "Fatura não encontrada." }, { status: 404 });
    // Commission history stays in staff audit, never in client-visible shipment notifications.
    const events = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, context.organizationId), eq(auditLogs.entityType, "finance_document"), eq(auditLogs.entityId, doc.id))).orderBy(desc(auditLogs.id));
    const history = events.flatMap((row) => {
      try {
        const metadata = JSON.parse(row.metadataJson) as Record<string, unknown>;
        return metadata.recipient === recipient ? [{ ...row, externalId: String(metadata.externalId ?? "") }] : [];
      } catch { return []; }
    });
    const sent = history.find((row) => row.action === "FINANCE_DOCUMENT_EMAILED");
    if (sent) return Response.json({ status: "Enviado", recipient, externalId: sent.externalId, alreadySent: true });
    // Provider deduplication lasts 24h. Never blindly repeat an unconfirmed older dispatch.
    if (history.some((row) => row.action === "FINANCE_EMAIL_REQUESTED" && Date.now() - Date.parse(row.createdAt.endsWith("Z") ? row.createdAt : `${row.createdAt.replace(" ", "T")}Z`) > 23 * 60 * 60 * 1000)) {
      return Response.json({ error: "Existe um envio antigo sem confirmação. Confira o histórico no provedor antes de tentar novamente; a fatura está salva." }, { status: 409 });
    }
    // @ts-expect-error -- virtual runtime module, same binding used by Shipment Report.
    const { env } = await import("cloudflare:workers");
    const runtime = env as unknown as Record<string, unknown>;
    const apiKey = String(runtime.RESEND_API_KEY ?? "").trim();
    const from = String(runtime.EMAIL_FROM ?? "").trim();
    if (!apiKey || !from) return Response.json({ error: "Envio de e-mail não configurado. A fatura está salva, sem envio." }, { status: 503 });
    const message = invoiceEmail(doc, operation.reference);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${context.organizationId}:${doc.id}:${recipient}`));
    const key = `commission-${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`;
    await audit(context, "FINANCE_EMAIL_REQUESTED", "finance_document", doc.id, { operationId: operation.id, recipient, key });
    let externalId: string;
    try { externalId = await deliverInvoice({ apiKey, from, recipient, key, message }); } catch (error) {
      const message = error instanceof Error ? error.message : "Envio não confirmado. A fatura está salva.";
      await audit(context, "FINANCE_EMAIL_UNCONFIRMED", "finance_document", doc.id, { operationId: operation.id, recipient });
      return Response.json({ error: message }, { status: 502 });
    }
    await audit(context, "FINANCE_DOCUMENT_EMAILED", "finance_document", doc.id, { operationId: operation.id, number: doc.number, recipient, externalId });
    return Response.json({ status: "Enviado", recipient, externalId });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao enviar. A fatura emitida permanece salva." }, { status: 500 });
  }
}

import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { operations } from "../../../db/schema";
import { audit, requireSecurityContext } from "../../../lib/security";
import { readOrderTerms } from "../../../lib/order-terms";
import { cleanInstallments, paymentSummary, readPayments, saleTotalOf, statusOf, writePayments } from "../../../lib/order-payments";

// Financeiro do pedido (só o cliente): parcelas, recebimentos com SWIFT e saldo. Só a equipe; o convidado
// não acessa (a trava do servidor bloqueia esta rota para convidados).

const STAFF_READ = new Set(["administrador", "analista", "auditor"]);
const STAFF_WRITE = new Set(["administrador", "analista"]);
const forbid = () => Response.json({ error: "O financeiro do pedido é só para a equipe." }, { status: 403 });
const today = () => new Date().toISOString().slice(0, 10);

type Operation = typeof operations.$inferSelect;

function view(operation: Operation, canWrite: boolean) {
  const paymentTerms = readOrderTerms(operation).paymentTerms;
  const payments = readPayments(operation.supplyChainNotes, saleTotalOf(operation), paymentTerms);
  return {
    operationId: operation.id, reference: operation.reference, currency: operation.currency || "USD", paymentTerms, saved: payments.saved,
    total: payments.total, installments: payments.installments.map((item) => ({ ...item, status: statusOf(item) })),
    summary: paymentSummary(payments, today()), canWrite, today: today(),
  };
}

async function load(organizationId: number, operationId: number) {
  const db = await getDb();
  const [operation] = await db.select().from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, organizationId))).limit(1);
  return { db, operation };
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    if (!STAFF_READ.has(context.role)) return forbid();
    await ensureBaseTables();
    const { operation } = await load(context.organizationId, Number(new URL(request.url).searchParams.get("operationId")));
    if (!operation) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
    return Response.json(view(operation, STAFF_WRITE.has(context.role)), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao abrir o financeiro do pedido." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    if (!STAFF_WRITE.has(context.role)) return forbid();
    await ensureBaseTables();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const { db, operation } = await load(context.organizationId, Number(body.operationId));
    if (!operation) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
    const payments = readPayments(operation.supplyChainNotes, saleTotalOf(operation), readOrderTerms(operation).paymentTerms);
    const action = String(body.action ?? "");
    let event = "";

    if (action === "save-plan") {
      const total = Number(body.total);
      if (Number.isFinite(total) && total > 0) payments.total = Math.round(total * 100) / 100;
      payments.installments = cleanInstallments(body.installments, payments.installments);
      if (!payments.installments.length) return Response.json({ error: "O plano precisa de ao menos uma parcela." }, { status: 400 });
      event = "ORDER_PAYMENT_PLAN_SAVED";
    } else if (action === "receive") {
      const installment = payments.installments.find((item) => item.id === String(body.installmentId));
      const amount = Math.round(Number(body.amount) * 100) / 100;
      if (!installment) return Response.json({ error: "Parcela não encontrada." }, { status: 404 });
      if (!(amount > 0)) return Response.json({ error: "Informe o valor recebido." }, { status: 400 });
      installment.receipts.push({ id: crypto.randomUUID(), date: String(body.date || today()).slice(0, 10), amount, documentId: Number(body.documentId) || null, note: String(body.note ?? "").trim().slice(0, 300), by: context.email });
      event = "ORDER_PAYMENT_RECEIVED";
    } else if (action === "remove-receipt") {
      for (const item of payments.installments) item.receipts = item.receipts.filter((receipt) => receipt.id !== String(body.receiptId));
      event = "ORDER_PAYMENT_RECEIPT_REMOVED";
    } else if (action === "set-requested") {
      const installment = payments.installments.find((item) => item.id === String(body.installmentId));
      if (!installment) return Response.json({ error: "Parcela não encontrada." }, { status: 404 });
      installment.requestedAt = body.requested ? new Date().toISOString() : "";
      event = "ORDER_PAYMENT_REQUESTED";
    } else {
      return Response.json({ error: "Ação desconhecida." }, { status: 400 });
    }

    const supplyChainNotes = writePayments(operation.supplyChainNotes, payments);
    await db.update(operations).set({ supplyChainNotes }).where(and(eq(operations.id, operation.id), eq(operations.organizationId, context.organizationId)));
    await audit(context, event, "operation", String(operation.id), { reference: operation.reference, ...(body.amount ? { amount: Number(body.amount) } : {}) });
    return Response.json(view({ ...operation, supplyChainNotes }, true));
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha no financeiro do pedido." }, { status: 500 });
  }
}

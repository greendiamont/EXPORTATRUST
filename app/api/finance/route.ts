import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { financeIssuers, operations } from "../../../db/schema";
import { audit, requireSecurityContext, type SecurityContext } from "../../../lib/security";
import { PAYER_ROLES, cleanIssuer, nextDocumentNumber, processGain, readFinance, writeFinance, type FinanceDocument, type FinanceStatus } from "../../../lib/finance";
import { readOrderTerms } from "../../../lib/order-terms";

// Financeiro: comissões e margens de cada processo, emissão da invoice/nota da comissão e situação
// (a faturar → faturado → recebido). Só a equipe (administrador e analista; auditor só lê).

const STAFF_READ = new Set(["administrador", "analista", "auditor"]);
const STAFF_WRITE = new Set(["administrador", "analista"]);

function forbid() {
  return Response.json({ error: "O Financeiro é só para a equipe (administrador ou analista)." }, { status: 403 });
}

async function snapshot(context: SecurityContext) {
  const db = await getDb();
  const [rows, issuers] = await Promise.all([
    db.select().from(operations).where(eq(operations.organizationId, context.organizationId)).orderBy(desc(operations.id)).limit(500),
    db.select().from(financeIssuers).where(eq(financeIssuers.organizationId, context.organizationId)).orderBy(financeIssuers.name),
  ]);
  const processes = rows
    .map((operation) => {
      const terms = readOrderTerms(operation);
      const gain = processGain(operation);
      return {
        id: operation.id, reference: operation.reference, client: operation.euImporter, etd: operation.shipmentDate,
        supplierName: operation.supplierName, exporterName: operation.exporterName,
        cancelled: Boolean(terms.cancelled), completed: Boolean(terms.completed),
        ...gain,
      };
    })
    .filter((row) => !row.cancelled);
  return { processes, issuers, payerRoles: PAYER_ROLES, today: new Date().toISOString().slice(0, 10), canWrite: STAFF_WRITE.has(context.role) };
}

export async function GET() {
  try {
    const context = await requireSecurityContext("read");
    if (!STAFF_READ.has(context.role)) return forbid();
    await ensureBaseTables();
    return Response.json(await snapshot(context), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao montar o financeiro." }, { status: 500 });
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

    if (action === "save-issuer") {
      const issuer = cleanIssuer(body.issuer);
      if (!issuer.name) return Response.json({ error: "Informe o nome do emitente." }, { status: 400 });
      await db.insert(financeIssuers).values({ organizationId: context.organizationId, ...issuer, createdBy: context.email });
      await audit(context, "FINANCE_ISSUER_SAVED", "finance_issuer", "", { name: issuer.name });
      return Response.json(await snapshot(context));
    }
    if (action === "delete-issuer") {
      await db.delete(financeIssuers).where(and(eq(financeIssuers.id, Number(body.issuerId)), eq(financeIssuers.organizationId, context.organizationId)));
      await audit(context, "FINANCE_ISSUER_DELETED", "finance_issuer", String(body.issuerId));
      return Response.json(await snapshot(context));
    }

    const id = Number(body.operationId);
    const [current] = await db.select().from(operations).where(and(eq(operations.id, id), eq(operations.organizationId, context.organizationId))).limit(1);
    if (!current) return Response.json({ error: "Processo não encontrado." }, { status: 404 });
    const finance = readFinance(current);
    const save = async (event: string, metadata: Record<string, unknown>) => {
      await db.update(operations).set({ supplyChainNotes: writeFinance(current, finance) }).where(and(eq(operations.id, id), eq(operations.organizationId, context.organizationId)));
      await audit(context, event, "operation", String(id), { reference: current.reference, ...metadata });
      return Response.json(await snapshot(context));
    };

    if (action === "set-status") {
      const status = String(body.status) as FinanceStatus;
      if (!["a_faturar", "faturado", "recebido"].includes(status)) return Response.json({ error: "Situação inválida." }, { status: 400 });
      finance.status = status;
      finance.receivedAt = status === "recebido" ? String(body.receivedAt || new Date().toISOString().slice(0, 10)).slice(0, 10) : "";
      return save("FINANCE_STATUS_CHANGED", { status });
    }

    if (action === "emit") {
      const kind = body.kind === "nfse" ? "nfse" : "invoice";
      const issuer = cleanIssuer(body.issuer);
      const amount = Number(body.amount);
      if (!issuer.name || !issuer.taxId) return Response.json({ error: "Preencha o emitente (nome e CPF/CNPJ)." }, { status: 400 });
      if (!(amount > 0)) return Response.json({ error: "Informe o valor da comissão." }, { status: 400 });
      const payerRole = PAYER_ROLES.includes(String(body.payerRole) as typeof PAYER_ROLES[number]) ? String(body.payerRole) : "Outro";
      const payer = String(body.payer ?? "").trim().slice(0, 200);
      if (!payer) return Response.json({ error: "Informe quem paga a comissão." }, { status: 400 });
      // Numeração sequencial por organização, a partir dos documentos já emitidos.
      const all = await db.select({ notes: operations.supplyChainNotes }).from(operations).where(eq(operations.organizationId, context.organizationId));
      const numbers = all.flatMap((row) => readFinance({ supplyChainNotes: row.notes }).documents.map((doc) => doc.number));
      const today = new Date().toISOString().slice(0, 10);
      const document: FinanceDocument = {
        id: crypto.randomUUID(), kind, number: nextDocumentNumber(kind, numbers, today.slice(0, 4)), date: today, issuer, payer, payerRole,
        description: String(body.description ?? "").trim().slice(0, 1000), amount: Math.round(amount * 100) / 100,
        currency: kind === "nfse" ? "BRL" : String(body.currency || current.currency || "USD").slice(0, 3).toUpperCase(),
        exchangeRate: Number(body.exchangeRate) || 0, dueDate: String(body.dueDate ?? "").slice(0, 10), createdAt: new Date().toISOString(), by: context.email,
      };
      finance.documents = [...finance.documents, document];
      finance.payerRole = payerRole;
      finance.payerName = payer;
      if (finance.status === "a_faturar") finance.status = "faturado";
      return save("FINANCE_DOCUMENT_ISSUED", { number: document.number, kind, amount: document.amount, currency: document.currency });
    }

    return Response.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha no financeiro." }, { status: 500 });
  }
}

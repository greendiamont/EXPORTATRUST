import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { financeIssuers, operations } from "../../../db/schema";
import { audit, requireSecurityContext, type SecurityContext } from "../../../lib/security";
import { PAYER_ROLES, cleanIssuer, cleanPayer, nextDocumentNumber, processGain, readFinance, writeFinance, type FinanceDocument, type FinanceStatus } from "../../../lib/finance";
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
  const [rows, parties] = await Promise.all([
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
  // Emitentes e pagadores salvos: os campos completos ficam em details_json (registros antigos só têm as colunas).
  const saved = parties.map((row) => {
    let details: Record<string, unknown> = {};
    try { details = JSON.parse(row.detailsJson || "{}"); } catch { details = {}; }
    return { id: row.id, kind: row.kind, ...(row.kind === "payer" ? cleanPayer({ name: row.name, taxId: row.taxId, ...details }) : cleanIssuer({ name: row.name, taxId: row.taxId, city: row.city, bank: row.bank, ...details })) };
  });
  const issuers = saved.filter((row) => row.kind !== "payer");
  const payers = saved.filter((row) => row.kind === "payer");
  const numbers = rows.flatMap((row) => readFinance(row).documents.map((doc) => doc.number));
  const year = new Date().toISOString().slice(0, 4);
  return { processes, issuers, payers, nextNumbers: { invoice: nextDocumentNumber("invoice", numbers, year), nfse: nextDocumentNumber("nfse", numbers, year) }, payerRoles: PAYER_ROLES, today: new Date().toISOString().slice(0, 10), canWrite: STAFF_WRITE.has(context.role) };
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

    if (action === "save-issuer" || action === "save-payer") {
      const payer = action === "save-payer";
      const party = payer ? cleanPayer(body.payer) : cleanIssuer(body.issuer);
      if (!party.name) return Response.json({ error: payer ? "Informe o nome de quem paga." : "Informe o nome do emitente." }, { status: 400 });
      // Mesmo nome e documento: atualiza o cadastro salvo em vez de duplicar.
      const kind = payer ? "payer" : "issuer";
      const existing = (await db.select().from(financeIssuers).where(and(eq(financeIssuers.organizationId, context.organizationId), eq(financeIssuers.kind, kind))))
        .find((row) => row.name.trim().toLowerCase() === party.name.toLowerCase() && row.taxId.trim() === party.taxId);
      const values = { name: party.name, taxId: party.taxId, city: "city" in party ? party.city : "", bank: "bank" in party ? party.bank : "", kind, detailsJson: JSON.stringify(party) };
      if (existing) await db.update(financeIssuers).set(values).where(eq(financeIssuers.id, existing.id));
      else await db.insert(financeIssuers).values({ organizationId: context.organizationId, ...values, createdBy: context.email });
      await audit(context, payer ? "FINANCE_PAYER_SAVED" : "FINANCE_ISSUER_SAVED", "finance_issuer", existing ? String(existing.id) : "", { name: party.name });
      return Response.json(await snapshot(context));
    }
    if (action === "delete-issuer") {
      await db.delete(financeIssuers).where(and(eq(financeIssuers.id, Number(body.issuerId)), eq(financeIssuers.organizationId, context.organizationId)));
      await audit(context, "FINANCE_ISSUER_DELETED", "finance_issuer", String(body.issuerId));
      return Response.json(await snapshot(context));
    }

    // Emitir comissão: uma invoice (ou espelho de nota) para um ou vários processos, como a 001/2026
    // (PO0639 e PO0657). O documento fica em cada processo, com a parte daquele processo.
    if (action === "emit") {
      const kind = body.kind === "nfse" ? "nfse" : "invoice";
      const issuer = cleanIssuer(body.issuer);
      const payerDetails = cleanPayer(body.payerDetails ?? { name: body.payer });
      const amount = Math.round(Number(body.amount) * 100) / 100;
      if (!issuer.name || !issuer.taxId) return Response.json({ error: "Preencha o emitente (nome e CPF/CNPJ)." }, { status: 400 });
      if (!payerDetails.name) return Response.json({ error: "Informe quem paga a comissão." }, { status: 400 });
      if (!(amount > 0)) return Response.json({ error: "Informe o valor da comissão." }, { status: 400 });
      const shares = (Array.isArray(body.shares) ? body.shares as Array<Record<string, unknown>> : [{ operationId: body.operationId, amount }])
        .map((share) => ({ operationId: Number(share.operationId), amount: Math.round(Number(share.amount) * 100) / 100, volume: Number(share.volume) || 0 }))
        .filter((share) => share.operationId > 0);
      if (!shares.length) return Response.json({ error: "Escolha ao menos um processo." }, { status: 400 });
      const all = await db.select().from(operations).where(eq(operations.organizationId, context.organizationId));
      const targets = shares.map((share) => ({ share, operation: all.find((row) => row.id === share.operationId) }));
      if (targets.some((target) => !target.operation)) return Response.json({ error: "Processo não encontrado." }, { status: 404 });
      const numbers = all.flatMap((row) => readFinance(row).documents.map((doc) => doc.number));
      const today = new Date().toISOString().slice(0, 10);
      const requested = String(body.number ?? "").trim().slice(0, 40);
      // Número sugerido na sequência; pode ser trocado (ex.: continuar a numeração das invoices feitas fora do app), sem repetir.
      const number = requested || nextDocumentNumber(kind, numbers, today.slice(0, 4));
      if (numbers.includes(number)) return Response.json({ error: `Já existe um documento com o número ${number}.` }, { status: 409 });
      const payerRole = PAYER_ROLES.includes(String(body.payerRole) as typeof PAYER_ROLES[number]) ? String(body.payerRole) : "Outro";
      const basis = body.basis === "per_m3" ? "per_m3" as const : "percent" as const;
      const document: Omit<FinanceDocument, "share"> = {
        id: crypto.randomUUID(), kind, number, date: String(body.date || today).slice(0, 10), issuer, payer: payerDetails.name, payerRole, payerDetails,
        description: String(body.description ?? "").trim().slice(0, 1000), basis, rate: Number(body.rate) || 0, volume: Number(body.volume) || 0,
        references: targets.map((target) => target.operation!.reference), notes: String(body.notes ?? "").trim().slice(0, 1000), amount,
        currency: kind === "nfse" ? "BRL" : String(body.currency || "USD").slice(0, 3).toUpperCase(),
        exchangeRate: Number(body.exchangeRate) || 0, dueDate: String(body.dueDate ?? "").slice(0, 10), createdAt: new Date().toISOString(), by: context.email,
      };
      for (const { share, operation } of targets) {
        const finance = readFinance(operation!);
        finance.documents = [...finance.documents, { ...document, share: share.amount }];
        finance.payerRole = payerRole;
        finance.payerName = payerDetails.name;
        if (finance.status === "a_faturar") finance.status = "faturado";
        await db.update(operations).set({ supplyChainNotes: writeFinance(operation!, finance) }).where(and(eq(operations.id, operation!.id), eq(operations.organizationId, context.organizationId)));
        await audit(context, "FINANCE_DOCUMENT_ISSUED", "operation", String(operation!.id), { reference: operation!.reference, number, kind, amount: share.amount, total: amount, currency: document.currency });
      }
      return Response.json({ ...(await snapshot(context)), issued: { id: document.id, operationId: targets[0].operation!.id } });
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

    return Response.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha no financeiro." }, { status: 500 });
  }
}

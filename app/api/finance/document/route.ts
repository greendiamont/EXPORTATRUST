import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../../db";
import { operations } from "../../../../db/schema";
import { requireSecurityContext } from "../../../../lib/security";
import { readFinance } from "../../../../lib/finance";

// Documento de comissão emitido no Financeiro, em página pronta para imprimir ou salvar em PDF.
// Invoice (exterior, em inglês) ou espelho da nota fiscal de serviço (Brasil, a nota oficial é
// autorizada na prefeitura).

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const date = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value;

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    if (!["administrador", "analista", "auditor"].includes(context.role)) return new Response("Acesso negado.", { status: 403 });
    await ensureBaseTables();
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("operationId"));
    const db = await getDb();
    const [operation] = await db.select().from(operations).where(and(eq(operations.id, id), eq(operations.organizationId, context.organizationId))).limit(1);
    const doc = operation && readFinance(operation).documents.find((item) => item.id === url.searchParams.get("doc"));
    if (!operation || !doc) return new Response("Documento não encontrado.", { status: 404 });
    const nf = doc.kind === "nfse";
    const amount = `${doc.currency === "BRL" ? "R$" : doc.currency === "USD" ? "US$" : doc.currency} ${doc.amount.toLocaleString(nf ? "pt-BR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const t = nf
      ? { title: "NOTA FISCAL DE SERVIÇO · ESPELHO", to: "Tomador", desc: "Descrição do serviço", value: "Valor", total: "Total", due: "Vencimento", ref: "Referência", bank: "Dados para pagamento", note: "Espelho para conferência. A nota fiscal oficial é emitida e autorizada na prefeitura; anexe o PDF/XML autorizado ao pedido." }
      : { title: "COMMISSION INVOICE", to: "Bill to", desc: "Description", value: "Amount", total: "Total", due: "Due date", ref: "Reference", bank: "Payment details", note: "Payment by international bank transfer to the account above." };
    const html = `<!doctype html><html lang="${nf ? "pt-BR" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(doc.number)} · ${escape(operation.reference)}</title>
<style>
body{margin:0;background:#f3f4f6;font-family:"IBM Plex Sans",system-ui,sans-serif;color:#111827;font-size:13px}
.page{max-width:780px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;padding:40px 44px;box-sizing:border-box}
.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}
h1{font-size:18px;margin:0;letter-spacing:.5px;text-align:right}.mono{font-family:"IBM Plex Mono",ui-monospace,monospace}
.muted{color:#6b7280}.box{margin-top:24px;padding-top:14px;border-top:1px solid #e5e7eb}
table{width:100%;border-collapse:collapse;margin-top:20px}th{text-align:left;color:#6b7280;font-weight:500;border-bottom:1px solid #e5e7eb;padding:8px 0}
td{padding:10px 0;border-bottom:1px solid #f0f1f3;vertical-align:top}.num{text-align:right;white-space:nowrap}
tfoot td{font-weight:600;border-bottom:0}.bar{max-width:780px;margin:16px auto 0;display:flex;justify-content:flex-end;gap:8px}
button{min-height:36px;padding:0 14px;border:0;border-radius:6px;background:#0f1b2d;color:#fff;font:inherit;cursor:pointer}
@media print{body{background:#fff}.page{border:0;margin:0;max-width:none}.bar{display:none}}
@media (max-width:600px){.page{padding:24px 18px}.top{flex-direction:column}h1{text-align:left}}
</style></head><body>
<div class="bar"><button onclick="window.print()">${nf ? "Imprimir / salvar PDF" : "Print / save as PDF"}</button></div>
<div class="page">
<div class="top"><div><b style="font-size:15px">${escape(doc.issuer.name)}</b><div class="muted">${escape(doc.issuer.taxId)}${doc.issuer.city ? ` · ${escape(doc.issuer.city)}` : ""}</div></div>
<div><h1>${t.title}</h1><div class="mono" style="text-align:right">${escape(doc.number)}</div><div class="muted" style="text-align:right">${date(doc.date)}</div></div></div>
<div class="box"><span class="muted">${t.to}:</span> <b>${escape(doc.payer)}</b>${doc.payerRole ? ` <span class="muted">(${escape(doc.payerRole)})</span>` : ""}
<div class="muted">${t.ref}: ${escape(operation.reference)}${operation.contractNumber ? ` · PO ${escape(operation.contractNumber)}` : ""}${operation.euImporter ? ` · ${escape(operation.euImporter)}` : ""}</div></div>
<table><thead><tr><th>${t.desc}</th><th class="num">${t.value}</th></tr></thead>
<tbody><tr><td>${escape(doc.description)}</td><td class="num mono">${amount}</td></tr></tbody>
<tfoot><tr><td>${t.total}</td><td class="num mono">${amount}</td></tr></tfoot></table>
${doc.dueDate ? `<p><span class="muted">${t.due}:</span> ${date(doc.dueDate)}</p>` : ""}
${doc.issuer.bank ? `<div class="box"><div class="muted">${t.bank}</div><div style="white-space:pre-wrap">${escape(doc.issuer.bank)}</div></div>` : ""}
<p class="muted" style="margin-top:24px">${t.note}</p>
</div></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response(error instanceof Error ? error.message : "Falha ao abrir o documento.", { status: 500 });
  }
}

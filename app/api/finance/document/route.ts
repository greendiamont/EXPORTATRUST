import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../../db";
import { operations } from "../../../../db/schema";
import { requireSecurityContext } from "../../../../lib/security";
import { readFinance } from "../../../../lib/finance";

// Documento de comissão emitido no Financeiro, em página pronta para imprimir ou salvar em PDF.
// Invoice no modelo de Ivam (invoice 001/2026: Issuer / Bill to, volume × rate, Total due, Bank details,
// Notes e assinatura) ou espelho da nota fiscal de serviço (a nota oficial é autorizada na prefeitura).
// A assinatura digital (gov.br) é feita depois, sobre o PDF salvo.

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
    const lang = nf ? "pt-BR" : "en-US";
    const code = doc.currency === "BRL" ? "BRL" : doc.currency;
    const money = (value: number) => `${nf ? "R$" : code} ${value.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const longDate = (value: string) => {
      const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
      return Number.isNaN(parsed.getTime()) ? date(value) : nf ? date(value) : parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    };
    const issuer = doc.issuer;
    const payer = doc.payerDetails ?? { name: doc.payer, address: "", taxId: "", registration: "", email: "" };
    const references = doc.references?.length ? doc.references : [operation.reference];
    const perM3 = doc.basis === "per_m3";
    const volume = doc.volume ? doc.volume.toLocaleString(lang, { maximumFractionDigits: 4 }) : "";
    const rate = perM3 ? money(doc.rate ?? 0) : doc.rate ? `${doc.rate.toLocaleString(lang)}%` : "";
    // Pessoa física (CPF com 11 dígitos) ou empresa, como no rodapé da invoice 001/2026.
    const individual = issuer.taxId.replace(/\D/g, "").length === 11;
    const taxLabel = individual ? "CPF" : "CNPJ";
    const t = nf
      ? { title: "NOTA FISCAL DE SERVIÇO", subtitle: "ESPELHO PARA CONFERÊNCIA", number: "Número", date: "Data", currency: "Moeda", issuer: "PRESTADOR", to: "TOMADOR", desc: "Descrição", volume: "Volume (m³)", rate: "Base", amount: "Valor", total: "TOTAL", bank: "DADOS PARA PAGAMENTO", notes: "OBSERVAÇÕES", due: "Vencimento",
          beneficiary: "Favorecido", swift: "SWIFT / BIC", account: "Conta", bankName: "Banco", bankAddress: "Endereço do banco", email: "E-mail", phone: "Telefone",
          footer: "Espelho para conferência. A nota fiscal oficial é emitida e autorizada na prefeitura; anexe o PDF/XML autorizado ao pedido." }
      : { title: "INVOICE", subtitle: "", number: "Invoice No.", date: "Date", currency: "Currency", issuer: "ISSUER", to: "BILL TO", desc: "Description", volume: "Volume (m³)", rate: "Rate", amount: "Amount", total: "TOTAL DUE", bank: "BANK DETAILS", notes: "NOTES", due: "Due date",
          beneficiary: "Beneficiary", swift: "SWIFT / BIC", account: "Account Number", bankName: "Bank", bankAddress: "Bank Address", email: "Email", phone: "Phone",
          footer: `Invoice issued by ${individual ? "an individual" : escape(issuer.name)} (Brazil) - Amount payable in ${escape(doc.currency)}` };
    const notes = doc.notes || (perM3 && !nf ? `Charge calculated at ${money(doc.rate ?? 0)} per m³ over a total shipped volume of ${volume} m³. References: ${references.join(references.length > 2 ? ", " : " and ")}.` : "");
    const bankRows = [[t.beneficiary, issuer.beneficiary], [t.swift, issuer.swift], [t.account, issuer.account], [t.bankName, issuer.bankName], [t.bankAddress, issuer.bankAddress]].filter(([, value]) => value);
    const lines = (values: string[]) => values.filter(Boolean).map((value) => `<div>${escape(value)}</div>`).join("");
    const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(doc.number)} · ${escape(references.join(", "))}</title>
<style>
body{margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2933;font-size:14px}
.page{max-width:820px;margin:24px auto;background:#fff;padding:48px 56px;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.head{display:flex;justify-content:flex-end}.head-box{min-width:330px}
h1{font-size:44px;margin:0 0 18px;text-align:right;color:#2d3a45;letter-spacing:.5px}.sub{text-align:right;color:#6b7280;margin:-12px 0 16px;font-size:12px;letter-spacing:.5px}
.meta{display:grid;grid-template-columns:1fr auto;gap:14px 40px}.meta b{text-align:right}.meta span{text-align:right}
.parties{display:grid;grid-template-columns:1fr 1fr;margin-top:40px;border:2px solid #e2e5e9}
.parties>div{padding:0}.parties h3{margin:0;padding:16px 14px;background:#eceef1;color:#3b4752;font-size:15px;border-bottom:2px solid #e2e5e9}
.parties>div+div{border-left:2px solid #e2e5e9}.parties .body{padding:14px;font-weight:700;line-height:1.55}
table{width:100%;border-collapse:collapse;margin-top:28px}th{background:#3b4752;color:#fff;padding:14px 10px;font-weight:700;border:2px solid #d5d9de}
td{padding:12px 10px;border:2px solid #d5d9de;vertical-align:top;height:90px}td.num{text-align:right;white-space:nowrap}
.total{display:flex;justify-content:flex-end;margin-top:28px}.total div{border:3px solid #3b4752;display:grid;grid-template-columns:auto auto;background:#eceef1}
.total b{padding:16px 22px;font-size:18px;color:#2d3a45}.total b+b{border-left:3px solid #3b4752;min-width:150px;text-align:right}
h4{margin:28px 0 12px;color:#3b4752;font-size:17px}.bank{display:grid;grid-template-columns:220px 1fr;gap:18px 20px}.bank b{font-weight:700}
.sign{margin-top:48px;width:300px;text-align:center;font-size:11px;line-height:1.4}.sign .line{border-top:1px solid #333;margin-bottom:6px;height:0}
.foot{margin-top:40px;text-align:center;color:#6b7280;font-size:12px}
.bar{max-width:820px;margin:16px auto 0;display:flex;justify-content:flex-end;gap:8px}
button{min-height:36px;padding:0 14px;border:0;border-radius:6px;background:#0f1b2d;color:#fff;font:inherit;cursor:pointer}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;padding:24px 32px}.bar{display:none}}
@media (max-width:640px){.page{padding:24px 16px}.parties{grid-template-columns:1fr}.parties>div+div{border-left:0;border-top:2px solid #e2e5e9}.bank{grid-template-columns:1fr;gap:4px}.head-box{min-width:0;width:100%}h1{font-size:32px}td{height:auto}}
</style></head><body>
<div class="bar"><button onclick="window.print()">${nf ? "Imprimir / salvar PDF" : "Print / save as PDF"}</button></div>
<div class="page">
<div class="head"><div class="head-box"><h1>${t.title}</h1>${t.subtitle ? `<div class="sub">${t.subtitle}</div>` : ""}
<div class="meta"><b>${t.number}</b><span>${escape(doc.number)}</span><b>${t.date}</b><span>${longDate(doc.date)}</span><b>${t.currency}</b><span>${escape(doc.currency)}</span>${doc.dueDate ? `<b>${t.due}</b><span>${longDate(doc.dueDate)}</span>` : ""}</div></div></div>
<div class="parties">
<div><h3>${t.issuer}</h3><div class="body"><div>${escape(issuer.name)}</div>${lines([issuer.address, issuer.city])}${issuer.taxId ? `<div>${taxLabel}: ${escape(issuer.taxId)}</div>` : ""}${issuer.email ? `<div>${t.email}: ${escape(issuer.email)}</div>` : ""}${issuer.phone ? `<div>${t.phone}: ${escape(issuer.phone)}</div>` : ""}</div></div>
<div><h3>${t.to}</h3><div class="body"><div>${escape(payer.name)}</div>${lines([payer.address, payer.taxId, payer.registration])}${payer.email ? `<div>${t.email}: ${escape(payer.email)}</div>` : ""}</div></div>
</div>
<table><thead><tr><th style="width:34%">${t.desc}</th><th>${t.volume}</th><th>${t.rate}</th><th>${t.amount}</th></tr></thead>
<tbody><tr><td>${escape(doc.description)}</td><td class="num">${volume}</td><td class="num">${rate}</td><td class="num">${money(doc.amount)}</td></tr></tbody></table>
<div class="total"><div><b>${t.total}</b><b>${money(doc.amount)}</b></div></div>
${bankRows.length || issuer.bank ? `<h4>${t.bank}</h4><div class="bank">${bankRows.map(([label, value]) => `<b>${label}</b><span>${escape(value)}</span>`).join("")}${!bankRows.length ? `<span style="white-space:pre-wrap;grid-column:1/-1">${escape(issuer.bank)}</span>` : ""}</div>` : ""}
${notes ? `<h4>${t.notes}</h4><div>${escape(notes)}</div>` : ""}
<div class="sign"><div style="height:56px"></div><div class="line"></div><b>${escape(issuer.name.toUpperCase())}</b>${issuer.taxId ? `<div>${taxLabel}: ${escape(issuer.taxId)}</div>` : ""}${issuer.email ? `<div>EMAIL: ${escape(issuer.email)}</div>` : ""}${issuer.phone ? `<div>PHONE: ${escape(issuer.phone)}</div>` : ""}</div>
<div class="foot">${t.footer}</div>
</div></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response(error instanceof Error ? error.message : "Falha ao abrir o documento.", { status: 500 });
  }
}

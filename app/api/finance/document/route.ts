import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../../db";
import { operations } from "../../../../db/schema";
import { requireSecurityContext } from "../../../../lib/security";
import { readFinance } from "../../../../lib/finance";

// Documento de comissão emitido no Financeiro, em página pronta para imprimir ou salvar em PDF.
// Invoice com o conteúdo do modelo de Ivam (invoice 001/2026: Issuer / Bill to, volume × rate, Total due,
// Bank details, Notes e assinatura) no padrão visual dos documentos do pedido, ou espelho da nota fiscal
// de serviço (a nota oficial é autorizada na prefeitura). Em português quando cobrado do exportador/fornecedor,
// em inglês quando cobrado do importador.
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
    // Português quando cobrado de empresa no Brasil (exportador/fornecedor); inglês para o importador.
    const pt = nf || doc.language === "pt";
    const lang = pt ? "pt-BR" : "en-US";
    const symbol = pt ? ({ BRL: "R$", USD: "US$", EUR: "€" } as Record<string, string>)[doc.currency] ?? doc.currency : doc.currency;
    const money = (value: number) => `${symbol} ${value.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const longDate = (value: string) => {
      const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
      return Number.isNaN(parsed.getTime()) || pt ? date(value) : parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    };
    const issuer = doc.issuer;
    const payer = doc.payerDetails ?? { name: doc.payer, address: "", taxId: "", registration: "", email: "" };
    const references = doc.references?.length ? doc.references : [operation.reference];
    const perM3 = doc.basis === "per_m3";
    const volume = doc.volume ? doc.volume.toLocaleString(lang, { maximumFractionDigits: 4 }) : "";
    // Valor por m³ é sempre combinado em US$, mesmo quando a cobrança sai em reais.
    const usdRate = (doc.rate ?? 0).toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rate = perM3 ? `${pt ? "US$" : "USD"} ${usdRate}` : doc.rate ? `${doc.rate.toLocaleString(lang)}%` : "";
    const fxRow = doc.currency === "BRL" && doc.exchangeRate ? [[pt ? "Câmbio" : "Exchange rate", `${pt ? "US$" : "USD"} 1 = ${pt ? "R$" : "BRL"} ${doc.exchangeRate.toLocaleString(lang, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`]] : [];
    // Pessoa física (CPF com 11 dígitos) ou empresa, como no rodapé da invoice 001/2026.
    const individual = issuer.taxId.replace(/\D/g, "").length === 11;
    const taxLabel = individual ? "CPF" : "CNPJ";
    const ptLabels = { number: "Número", date: "Data", currency: "Moeda", desc: "Descrição", volume: "Volume (m³)", amount: "Valor", due: "Vencimento",
      beneficiary: "Favorecido", swift: "SWIFT / BIC", account: "Conta", bankName: "Banco", bankAddress: "Endereço do banco", email: "E-mail", phone: "Telefone",
      references: "Referências", details: "SERVIÇO", notes: "OBSERVAÇÕES", print: "Imprimir / salvar PDF", kicker: "Comissão · intermediação comercial" };
    const t = nf
      ? { ...ptLabels, title: "NOTA FISCAL DE SERVIÇO", subtitle: "ESPELHO PARA CONFERÊNCIA", issuer: "PRESTADOR", to: "TOMADOR", rate: "Base", total: "TOTAL", bank: "DADOS PARA PAGAMENTO",
          footer: "Espelho para conferência. A nota fiscal oficial é emitida e autorizada na prefeitura; anexe o PDF/XML autorizado ao pedido." }
      : pt
        ? { ...ptLabels, title: "FATURA", subtitle: "", issuer: "EMITENTE", to: "COBRAR DE", rate: perM3 ? "Valor por m³" : "Base", total: "TOTAL A PAGAR", bank: "DADOS BANCÁRIOS",
            footer: `Fatura emitida por ${individual ? "pessoa física" : escape(issuer.name)} (Brasil) · valor a pagar em ${escape(doc.currency)}` }
        : { title: "INVOICE", subtitle: "", number: "Invoice No.", date: "Date", currency: "Currency", issuer: "ISSUER", to: "BILL TO", desc: "Description", volume: "Volume (m³)", rate: "Rate", amount: "Amount", total: "TOTAL DUE", bank: "BANK DETAILS", notes: "NOTES", due: "Due date",
            beneficiary: "Beneficiary", swift: "SWIFT / BIC", account: "Account Number", bankName: "Bank", bankAddress: "Bank Address", email: "Email", phone: "Phone",
            references: "References", details: "DETAILS", print: "Print / save as PDF", kicker: "Commission · commercial service",
            footer: `Invoice issued by ${individual ? "an individual" : escape(issuer.name)} (Brazil) - Amount payable in ${escape(doc.currency)}` };
    const refList = references.join(references.length > 2 ? ", " : pt ? " e " : " and ");
    const notes = doc.notes || (perM3 && !nf ? (pt ? `Cobrança calculada a ${rate} por m³ sobre o volume total embarcado de ${volume} m³. Referências: ${refList}.` : `Charge calculated at ${rate} per m³ over a total shipped volume of ${volume} m³. References: ${refList}.`) : "");
    const bankRows = [[t.beneficiary, issuer.beneficiary], [t.swift, issuer.swift], [t.account, issuer.account], [t.bankName, issuer.bankName], [t.bankAddress, issuer.bankAddress]].filter(([, value]) => value);
    const lines = (values: string[]) => values.filter(Boolean).map((value) => `<div>${escape(value)}</div>`).join("");
    // Mesmo padrão visual dos documentos emitidos no pedido (Sales Order, Purchase Invoice, Packing List:
    // app/api/export-control/route.ts orderDocumentHtml): A4, faixa verde, caixas de partes, tabela de dados,
    // itens, notas, dados bancários e assinatura.
    const meta = [[t.number, doc.number], [t.date, longDate(doc.date)], [t.currency, doc.currency], [t.references, references.join(", ")], ...fxRow, ...(doc.dueDate ? [[t.due, longDate(doc.dueDate)]] : [])];
    const metaRows = meta.map((row, index, source) => index % 2 ? "" : `<tr><th>${escape(row[0])}</th><td>${escape(row[1])}</td><th>${escape(source[index + 1]?.[0] ?? "")}</th><td>${escape(source[index + 1]?.[1] ?? "")}</td></tr>`).join("");
    const issuerLines = [issuer.address, issuer.city, issuer.taxId ? `${taxLabel}: ${issuer.taxId}` : "", issuer.email ? `${t.email}: ${issuer.email}` : "", issuer.phone ? `${t.phone}: ${issuer.phone}` : ""].filter(Boolean).map(escape).join("<br>");
    const payerLines = [payer.address, payer.taxId, payer.registration, payer.email ? `${t.email}: ${payer.email}` : ""].filter(Boolean).map(escape).join("<br>");
    const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(doc.number)} · ${escape(references.join(", "))}</title>
<style>
@page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;background:#f3f7f5;color:#20362d;font-size:11px}
.page{width:190mm;min-height:277mm;margin:0 auto;background:#fff;padding:8mm;border:1px solid #d8e5df}
.top{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #086c55;padding-bottom:10px}.brand{font-weight:800;letter-spacing:2px;color:#086c55;text-transform:uppercase}.top p{margin:6px 0 0}
.title{text-align:right}.title h1{margin:0;font-size:22px}.title b{display:block;margin-top:5px}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.box{border:1px solid #dfe9e4;padding:9px;min-height:76px;line-height:1.45;page-break-inside:avoid}.box h2{margin:0 0 6px;font-size:10px;color:#086c55;letter-spacing:.8px}
h2{font-size:13px;margin:12px 0 6px}table{width:100%;border-collapse:collapse;margin-top:8px;table-layout:fixed;page-break-inside:avoid}
th,td{border:1px solid #dfe9e4;padding:5px 6px;text-align:left;vertical-align:top;line-height:1.25;word-break:break-word}th{background:#f1f7f4;color:#60756c;font-size:9px;text-transform:uppercase}
tfoot td{font-weight:800;background:#f8fbf9}.meta th{width:17%}.meta td{width:33%}.num{text-align:right}
.notes{margin-top:10px;border-left:3px solid #086c55;background:#f4faf7;padding:8px;white-space:pre-line;font-size:10px;line-height:1.35;page-break-inside:avoid}
.bank-details{background:#fffdf5;border-left-color:#b78922;white-space:normal}.bank-details dl{display:grid;grid-template-columns:120px 1fr;gap:3px 10px;margin:6px 0 0}.bank-details dt{color:#60756c}.bank-details dd{margin:0}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:40px;page-break-inside:avoid;break-inside:avoid;align-items:end}.line{border-top:1px solid #80958b;padding-top:6px;color:#60756c;text-align:center;line-height:1.4}.line b{display:block;color:#20362d;margin-bottom:2px}
.foot{margin-top:18px;text-align:center;color:#60756c;font-size:10px}
.bar{width:190mm;max-width:100%;margin:12px auto 0;display:flex;justify-content:flex-end}button{min-height:34px;padding:0 14px;border:0;border-radius:6px;background:#086c55;color:#fff;font:inherit;font-size:12px;cursor:pointer}
@media print{body{background:#fff}.page{margin:0;border:0;width:auto;min-height:auto;padding:0}.bar{display:none}}
@media (max-width:760px){.page{width:auto;min-height:0;margin:8px}.parties,.sign{grid-template-columns:1fr}.top{flex-direction:column}.title{text-align:left}}
</style></head><body>
<div class="bar"><button onclick="window.print()">${t.print}</button></div>
<main class="page">
<section class="top"><div><div class="brand">${escape(issuer.name)}</div><p>${t.kicker}</p></div><div class="title"><h1>${t.title}</h1><b>${escape(doc.number)}</b>${t.subtitle ? `<div>${t.subtitle}</div>` : ""}</div></section>
<section class="parties"><article class="box"><h2>${t.issuer}</h2><strong>${escape(issuer.name)}</strong><br>${issuerLines}</article><article class="box"><h2>${t.to}</h2><strong>${escape(payer.name)}</strong>${payerLines ? `<br>${payerLines}` : ""}</article></section>
<table class="meta">${metaRows}</table>
<h2>${t.details}</h2>
<table><colgroup><col style="width:46%"><col style="width:18%"><col style="width:16%"><col style="width:20%"></colgroup>
<thead><tr><th>${t.desc}</th><th class="num">${t.volume}</th><th class="num">${t.rate}</th><th class="num">${t.amount}</th></tr></thead>
<tbody><tr><td>${escape(doc.description)}</td><td class="num">${volume}</td><td class="num">${rate}</td><td class="num">${money(doc.amount)}</td></tr></tbody>
<tfoot><tr><td colspan="3">${t.total}</td><td class="num">${money(doc.amount)}</td></tr></tfoot></table>
${bankRows.length || issuer.bank ? `<section class="notes bank-details"><strong>${t.bank}</strong>${bankRows.length ? `<dl>${bankRows.map(([label, value]) => `<dt>${label}</dt><dd>${escape(value)}</dd>`).join("")}</dl>` : `<br><span style="white-space:pre-line">${escape(issuer.bank)}</span>`}</section>` : ""}
${notes ? `<section class="notes"><strong>${t.notes}</strong><br>${escape(notes)}</section>` : ""}
<section class="sign"><div>${issuer.signature ? `<img src="${escape(issuer.signature)}" alt="" style="display:block;max-height:60px;max-width:220px;margin:0 auto 4px">` : ""}<div class="line"><b>${escape(issuer.name.toUpperCase())}</b>${issuer.taxId ? `${taxLabel}: ${escape(issuer.taxId)}<br>` : ""}${issuer.email ? `${escape(issuer.email)}<br>` : ""}${issuer.phone ? escape(issuer.phone) : ""}</div></div><div></div></section>
<div class="foot">${t.footer}</div>
</main></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response(error instanceof Error ? error.message : "Falha ao abrir o documento.", { status: 500 });
  }
}

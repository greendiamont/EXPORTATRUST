import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFile } from "node:fs/promises";
register("./ts-resolve.mjs", import.meta.url);
const { supplierPayer, findSupplierPayer } = await import("../lib/finance-suppliers.ts");
const { cleanPayer, cleanIssuer, readFinance, writeFinance } = await import("../lib/finance.ts");
const { invoiceEmail, invoiceRecipient, deliverInvoice } = await import("../lib/finance-email.ts");
const { financeDocumentHtml } = await import("../lib/finance-document.ts");

const supplier = { id: 7, legalName: "J V J Hauber Ltda", tradeName: "JV J Hauber", aliases: "Hauber; HAÚBER Madeiras", taxId: "12.345.678/0001-90", address: "Rua das Árvores, 10 · CEP 89100-000", city: "Blumenau", state: "SC", country: "Brasil", email: "financeiro@example.test", phone: "+55 47 1234-5678", contactName: "Financeiro Hauber", bankDetails: "FORNECEDOR-CONTA-NUNCA-RECEBE-COMISSAO" };
const payer = supplierPayer(supplier);
const doc = { id: "issued-test", kind: "invoice", number: "010/2026", date: "2026-10-17", issuer: cleanIssuer({ name: "Emissor", taxId: "12345678901", bank: "CONTA-DO-EMISSOR", email: "emissor@example.test" }), payer: payer.name, payerDetails: cleanPayer(payer), payerRole: "Fornecedor", description: "Comissão de intermediação", amount: 300, currency: "BRL", language: "pt", exchangeRate: 5, dueDate: "2026-10-30", createdAt: "2026-10-17T14:00:00Z", by: "test@example.test", references: ["PO0639", "PO0657"], basis: "per_m3", rate: 3, volume: 20, notes: "Valor convertido" };

test("cadastro do fornecedor preenche todos os campos correspondentes da invoice", () => {
  assert.equal(payer.name, supplier.legalName);
  for (const value of [supplier.address, supplier.city, supplier.state, supplier.country]) assert.ok(payer.address.includes(value));
  for (const key of ["taxId", "email", "phone", "contactName"]) assert.equal(payer[key], supplier[key]);
  assert.equal("bankDetails" in payer, false);
  assert.equal(cleanPayer(payer).address, payer.address);
});

test("fornecedor por vínculo, razão social, nome fantasia, alias, CNPJ e sem adivinhação ambígua", () => {
  for (const name of ["JV J Hauber", "j v j hauber ltda", "HAUBER MADEIRAS", "12345678000190"]) assert.equal(findSupplierPayer([payer], name)?.supplierId, 7);
  const second = { ...payer, supplierId: 8, taxId: "other" };
  assert.equal(findSupplierPayer([payer, second], "JV J Hauber"), undefined);
  assert.equal(findSupplierPayer([payer, second], "nome antigo", 8)?.supplierId, 8);
  assert.equal(findSupplierPayer([payer], "JV J Hauber", 99), undefined);
  assert.equal(findSupplierPayer([payer], "Haub"), undefined);
  assert.equal(findSupplierPayer([payer], ""), undefined);
});

test("documento, assinatura e conta do emitente preservados; novas consultas não alteram invoices antigas", () => {
  const original = JSON.stringify(doc);
  const source = { supplyChainNotes: JSON.stringify({ eudr: { keep: true }, finance: { documents: [doc], status: "faturado" } }) };
  supplierPayer({ ...supplier, address: "NOVO ENDEREÇO" });
  const record = readFinance(source);
  const notes = JSON.parse(writeFinance(source, { ...record, status: "recebido" }));
  assert.deepEqual(notes.eudr, { keep: true });
  assert.equal(JSON.stringify(notes.finance.documents[0]), original);
  const html = financeDocumentHtml(doc, "fallback");
  for (const value of [supplier.address, supplier.taxId, supplier.email, supplier.phone, supplier.contactName, "CONTA-DO-EMISSOR", "PO0639", "PO0657", "FATURA", "BRL"]) assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /FORNECEDOR-CONTA|NOVO ENDEREÇO/);
  assert.match(financeDocumentHtml({ ...doc, language: "en", currency: "USD" }, "fallback"), /INVOICE/);
  assert.match(financeDocumentHtml({ ...doc, kind: "nfse", language: "en" }, "fallback"), /ESPELHO PARA CONFERÊNCIA/);
  assert.match(financeDocumentHtml({ ...doc, payerDetails: undefined }, "fallback"), /J V J Hauber Ltda/);
});

test("HTML anexo é a mesma fatura salva, sem links privados ou botão executável", () => {
  const mail = invoiceEmail(doc, "fallback");
  assert.match(mail.subject, /Fatura de comissão 010\/2026 · PO0639, PO0657/);
  assert.equal(mail.attachments[0].filename, "Invoice-010-2026.html");
  assert.equal(Buffer.from(mail.attachments[0].content, "base64").toString("utf8"), mail.html);
  assert.doesNotMatch(mail.html, /onclick=|<script|\/api\/finance/);
  assert.match(mail.html, /Rua das Árvores/);
  const escaped = invoiceEmail({ ...doc, payerDetails: { ...payer, name: '<script>alert("X")</script>' }, description: "<img src=x onerror=alert(1)>" }, "fallback");
  assert.doesNotMatch(escaped.html, /<script>|<img src=x/);
  assert.match(escaped.html, /&lt;script&gt;/);
});

test("destinatário editável validado; não aceita lista, quebra de cabeçalho ou nome ambíguo", () => {
  assert.equal(invoiceRecipient(" Test@Example.test "), "test@example.test");
  for (const value of ["", null, "inválido", "a@x.test,b@y.test", "a@x.test; b@y.test", "a@x.test\r\nBcc:secret@y.test", "Nome <a@x.test>"]) assert.throws(() => invoiceRecipient(value));
});

test("envio usa transporte simulado, chave estável, destinatário e fatura completa", async () => {
  const options = { apiKey: "fake-local-only", from: "sender@example.test", recipient: "payer@example.test", key: "commission-stable-key", message: invoiceEmail(doc, "fallback") };
  const calls = [];
  const transport = async (url, init) => { calls.push({ url, init }); return Response.json({ id: "email-mocked" }); };
  assert.equal(await deliverInvoice(options, transport), "email-mocked");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers["Idempotency-Key"], options.key);
  const payload = JSON.parse(calls[0].init.body);
  assert.deepEqual(payload.to, [options.recipient]);
  assert.equal(payload.html, options.message.html);
  assert.deepEqual(payload.attachments, options.message.attachments);
  await assert.rejects(() => deliverInvoice({ ...options, apiKey: "" }, transport), /não configurado/);
  assert.equal(calls.length, 1);
  await assert.rejects(() => deliverInvoice(options, async () => Response.json({ message: "provider failed" }, { status: 429 })), /fatura está salva/);
  await assert.rejects(() => deliverInvoice(options, async () => Response.json({})), /confirmar o envio/);
  await assert.rejects(() => deliverInvoice(options, async () => { throw new Error("network timeout"); }), /network timeout/);
});

test("API: autenticação, organização, histórico e envio explícito; sem mudanças no gate de convidados", async () => {
  const route = await readFile(new URL("../app/api/finance/email/route.ts", import.meta.url), "utf8");
  const snapshot = await readFile(new URL("../app/api/finance/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireSecurityContext\("write"\)/);
  assert.match(route, /\["administrador", "analista"\]\.includes\(context.role\)/);
  assert.match(route, /eq\(operations.organizationId, context.organizationId\)/);
  assert.match(route, /eq\(auditLogs.organizationId, context.organizationId\)/);
  assert.match(snapshot, /from\(suppliers\)\.where\(eq\(suppliers.organizationId, context.organizationId\)\)/);
  assert.match(route, /alreadySent: true/);
  assert.match(route, /FINANCE_EMAIL_REQUESTED/);
  assert.doesNotMatch(route, /clientNotifications/);
  assert.match(route, /FINANCE_DOCUMENT_EMAILED/);
  assert.doesNotMatch(route, /export async function GET|run-scheduled/);
});

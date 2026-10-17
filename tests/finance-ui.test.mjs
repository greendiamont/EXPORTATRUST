import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
register("./ts-resolve.mjs", import.meta.url);

// Local synthetic data only. No login, customer data, Railway or external mail transport.
test("Financeiro: fornecedor completo, destinatário editável, falha e retry sem reemitir, cancelar e só emitir", { skip: !process.env.FINANCE_PLAYWRIGHT_MODULE }, async () => {
  const { chromium } = await import(process.env.FINANCE_PLAYWRIGHT_MODULE);
  const { build } = await import("esbuild");
  const { supplierPayer } = await import("../lib/finance-suppliers.ts");
  const supplier = supplierPayer({ id: 7, legalName: "J V J Hauber Ltda", tradeName: "JV J Hauber", aliases: "Hauber", taxId: "12.345.678/0001-90", address: "Rua das Árvores, 10", city: "Blumenau", state: "SC", country: "Brasil", email: "financeiro@example.test", phone: "4712345678", contactName: "Financeiro Hauber" });
  const snapshot = { today: "2026-10-17", canWrite: true, nextNumbers: { invoice: "010/2026", nfse: "NFS-010/2026" }, payerRoles: ["Fornecedor", "Exportador", "Importador", "Parceiro", "Outro"], payers: [], supplierPayers: [supplier], issuers: [{ name: "Emitente teste", taxId: "12345678901", address: "Rua do Emitente", city: "SC", email: "emissor@example.test", phone: "", beneficiary: "Emissor", swift: "", account: "CONTA-EMISSOR", bankName: "Banco", bankAddress: "", bank: "", signature: "" }], processes: [{ id: 1, reference: "PO0639", client: "Cliente teste", etd: "2026-10-20", supplierId: 7, supplierName: "JV J Hauber", exporterName: "JV J Hauber", completed: false, mode: "comissao", sale: 10000, currency: "USD", volume: 100, rate: 5, percent: 3, gain: 300, gainUsd: 300, gainBrl: 1500, payerRole: "Fornecedor", payerName: "JV J Hauber", ready: true, finance: { status: "a_faturar", receivedAt: "", documents: [] } }] };
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import View from './app/ui/financeiro-view.tsx';
    const snapshot=${JSON.stringify(snapshot)}; window.__calls=[]; window.__opened=[]; window.open=(url)=>window.__opened.push(url); let fail=true;
    window.fetch=async(path,init={})=>{const body=init.body?JSON.parse(init.body):null; window.__calls.push({path,body});
      if(path==='/api/finance/email'){if(fail){fail=false;return Response.json({error:'Envio simulado indisponível; fatura salva.'},{status:502});} return Response.json({status:'Enviado'});}
      if(body?.action==='emit') return Response.json({...snapshot,issued:{id:'mock-invoice',operationId:1}});
      return Response.json(snapshot);}; createRoot(document.getElementById('root')).render(<View/>);`, resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "tsx" }, bundle: true, format: "iife", platform: "browser", jsx: "automatic", write: false });
  const css = await readFile(new URL("../app/ui/et2.css", import.meta.url));
  const server = createServer((request, response) => {
    if (request.url === "/app.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].contents); }
    else if (request.url === "/app.css") { response.setHeader("content-type", "text/css"); response.end(css); }
    else { response.setHeader("content-type", "text/html; charset=utf-8"); response.end('<html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Emitir comissão", exact: true }).click();
    const dialog = page.getByRole("dialog");
    assert.equal(await dialog.getByLabel("Nome *", { exact: true }).inputValue(), supplier.name);
    assert.equal(await dialog.getByLabel("VAT / CNPJ", { exact: true }).inputValue(), supplier.taxId);
    assert.equal(await dialog.getByLabel("Endereço", { exact: true }).last().inputValue(), supplier.address);
    assert.equal(await dialog.getByLabel("E-mail do destinatário (editável)").inputValue(), supplier.email);
    assert.ok((await dialog.getByLabel("Prévia do documento").innerText()).includes(supplier.phone));
    await dialog.getByLabel("E-mail do destinatário (editável)").fill("inválido");
    await dialog.getByRole("button", { name: "Enviar por e-mail", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.body?.action === "emit").length), 0);
    await dialog.getByLabel("E-mail do destinatário (editável)").fill("destino@example.test");
    await dialog.getByRole("button", { name: "Enviar por e-mail", exact: true }).click();
    await dialog.getByRole("button", { name: "Tentar enviar por e-mail" }).waitFor();
    assert.equal(await dialog.getByLabel("Nome *", { exact: true }).isDisabled(), true);
    assert.match(await dialog.innerText(), /fatura.*salva/i);
    await dialog.getByRole("button", { name: "Tentar enviar por e-mail" }).click();
    await dialog.waitFor({ state: "hidden" });
    const calls = await page.evaluate(() => window.__calls);
    assert.equal(calls.filter((call) => call.body?.action === "emit").length, 1);
    assert.equal(calls.filter((call) => call.path === "/api/finance/email").length, 2);
    assert.equal(calls.find((call) => call.path === "/api/finance/email").body.recipient, "destino@example.test");
    await page.getByRole("button", { name: "Emitir comissão", exact: true }).click();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__calls.length), calls.length);
    await page.getByRole("button", { name: "Emitir comissão", exact: true }).click();
    await dialog.getByRole("button", { name: "Emitir fatura", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.path === "/api/finance/email").length), 2);
    assert.equal(await page.evaluate(() => window.__opened.length), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Emitir comissão", exact: true }).click();
    assert.equal(await dialog.getByRole("button", { name: "Enviar por e-mail", exact: true }).isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
});

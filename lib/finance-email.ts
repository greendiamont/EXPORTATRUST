import type { FinanceDocument } from "./finance";
import { financeDocumentHtml } from "./finance-document";
import { invoiceRecipient } from "./finance-recipient";
export { invoiceRecipient } from "./finance-recipient";

export function invoiceEmail(doc: FinanceDocument, reference: string) {
  const pt = doc.kind === "nfse" || doc.language === "pt";
  const title = doc.kind === "nfse" ? "Espelho da nota fiscal" : pt ? "Fatura de comissão" : "Commission invoice";
  const subject = `${title} ${doc.number} · ${(doc.references?.length ? doc.references : [reference]).join(", ")}`.replace(/[\r\n]/g, " ");
  const html = financeDocumentHtml(doc, reference).replace(/<div class="bar">.*?<\/div>/, "");
  const text = [subject, doc.payerDetails?.name || doc.payer, doc.description,
    `${doc.currency} ${doc.amount.toFixed(2)}`, doc.dueDate ? `${pt ? "Vencimento" : "Due date"}: ${doc.dueDate}` : "",
    pt ? "Fatura completa no anexo HTML. Abra no navegador para imprimir ou salvar em PDF." : "Full invoice in the HTML attachment. Open in a browser to print or save as PDF.",
    doc.issuer.name, doc.issuer.email].filter(Boolean).join("\n");
  const bytes = new TextEncoder().encode(html);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { subject, html, text, attachments: [{ filename: `Invoice-${doc.number.replace(/[^a-zA-Z0-9_-]/g, "-")}.html`, content: btoa(binary) }] };
}

/** Inject transport in tests: no real e-mail is sent by automated verification. */
export async function deliverInvoice(options: { apiKey: string; from: string; recipient: string; key: string; message: ReturnType<typeof invoiceEmail> }, transport: typeof fetch = fetch) {
  if (!options.apiKey || !options.from) throw new Error("Envio de e-mail não configurado. A fatura permanece emitida; tente novamente após configurar o remetente.");
  const response = await transport("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": options.key },
    body: JSON.stringify({ from: options.from, to: [invoiceRecipient(options.recipient)], ...options.message }),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => ({})) as { id?: string };
  if (!response.ok || !result.id) throw new Error(`Não foi possível confirmar o envio (HTTP ${response.status}). A fatura está salva; você pode tentar enviar novamente.`);
  return result.id;
}

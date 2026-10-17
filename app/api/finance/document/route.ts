import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../../db";
import { operations } from "../../../../db/schema";
import { requireSecurityContext } from "../../../../lib/security";
import { readFinance } from "../../../../lib/finance";
import { financeDocumentHtml } from "../../../../lib/finance-document";

// Documento de comissão emitido no Financeiro, em página pronta para imprimir ou salvar em PDF.
// Invoice com o conteúdo do modelo de Ivam (invoice 001/2026: Issuer / Bill to, volume × rate, Total due,
// Bank details, Notes e assinatura) no padrão visual dos documentos do pedido, ou espelho da nota fiscal
// de serviço (a nota oficial é autorizada na prefeitura). Em português quando cobrado do exportador/fornecedor,
// em inglês quando cobrado do importador.
// A assinatura digital (gov.br) é feita depois, sobre o PDF salvo.

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
    const html = financeDocumentHtml(doc, operation.reference);
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response(error instanceof Error ? error.message : "Falha ao abrir o documento.", { status: 500 });
  }
}

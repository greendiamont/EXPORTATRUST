"use client";

import { useEffect, useState } from "react";
import { api, formatDate, money } from "./format";

// Financeiro do pedido (protótipo "3d · Financeiro do pedido", aprovado por Ivam em 2026-10-17): só o
// cliente. Parcelas pela condição de pagamento, recebimentos com SWIFT e saldo — o Shipment Advice usa
// estes dados no e-mail. Regras: lib/order-payments.ts.

type Receipt = { id: string; date: string; amount: number; documentId: number | null; note: string; by: string };
type Installment = { id: string; label: string; percent: number; amount: number; dueDate: string; rule: string; requestedAt: string; receipts: Receipt[]; status: "a_solicitar" | "solicitado" | "parcial" | "recebido" };
export type OrderPayments = {
  operationId: number; reference: string; currency: string; paymentTerms: string; saved: boolean; total: number; installments: Installment[]; canWrite: boolean; today: string;
  summary: { total: number; received: number; balance: number; planned: number; nextDue: { label: string; dueDate: string; amount: number; late: boolean } | null; receipts: Array<Receipt & { installment: string }> };
};
type Doc = { id: number; fileName: string; category: string; uploadedAt?: string };

const STATUS = { a_solicitar: ["A solicitar", "todo"], solicitado: ["Solicitado", "warn"], parcial: ["Recebido em parte", "warn"], recebido: ["Recebido", "ok"] } as const;
const FIN_CATEGORY = "Financeiro · pagamentos";
const parse = (value: string) => Number(value.replace(/\./g, "").replace(",", ".")) || 0;
const typed = (value: number) => value ? value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";

export function OrderPaymentsPanel({ operationId, onChanged, onView }: { operationId: number; onChanged?: (data: OrderPayments) => void; onView: (doc: { id: number; fileName: string }) => void }) {
  const [data, setData] = useState<OrderPayments | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Array<{ id: string; label: string; amount: string; dueDate: string; rule: string; percent: number }> | null>(null);
  const [receiving, setReceiving] = useState<{ installmentId: string; date: string; amount: string; note: string; file: File | null } | null>(null);

  const loadDocs = () => api<{ documents: Doc[] }>(`/api/documents?operationId=${operationId}`).then((result) => setDocs(result.documents.filter((doc) => doc.category.startsWith("Financeiro")))).catch(() => setDocs([]));
  useEffect(() => {
    api<OrderPayments>(`/api/order-payments?operationId=${operationId}`).then((result) => { setData(result); onChanged?.(result); }).catch((reason: Error) => setError(reason.message));
    loadDocs();
  }, [operationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const result = await api<OrderPayments>("/api/order-payments", { method: "POST", body: JSON.stringify({ operationId, ...body }) });
      setData(result);
      onChanged?.(result);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    const form = new FormData();
    form.set("operationId", String(operationId));
    form.set("category", FIN_CATEGORY);
    form.set("file", file);
    const response = await fetch("/api/documents", { method: "POST", body: form });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    await loadDocs();
    return body.document as { id: number };
  }

  async function receive() {
    if (!receiving) return;
    setBusy(true);
    try {
      const document = receiving.file ? await upload(receiving.file) : null;
      setBusy(false);
      if (await post({ action: "receive", installmentId: receiving.installmentId, date: receiving.date, amount: parse(receiving.amount), note: receiving.note, documentId: document?.id ?? null })) setReceiving(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao anexar o SWIFT.");
      setBusy(false);
    }
  }

  if (!data) return <section className="pd-card" style={{ padding: 20 }}>{error ? <div className="et2-alert et2-alert--bad" role="alert">{error}</div> : <p className="pd-sub">Carregando financeiro do pedido…</p>}</section>;
  const { summary, currency, canWrite } = data;
  const fmt = (value: number) => money(value, currency) === "—" ? `${currency} 0` : money(value, currency);
  const docName = (id: number | null) => docs.find((doc) => doc.id === id)?.fileName ?? "comprovante";

  return (
    <div className="op-wrap">
      {error && <div className="et2-alert et2-alert--bad" role="alert">{error}</div>}
      <section className="db-hero op-hero" aria-label="Balanço do pedido">
        <div><div className="db-hero-label">Valor da invoice</div><div className="db-hero-value">{fmt(summary.total)}</div><div className="db-hero-sub">{data.paymentTerms || "condição de pagamento não informada"}</div></div>
        <div><div className="db-hero-label">Recebido</div><div className="db-hero-value">{fmt(summary.received)}</div><div className="db-hero-sub">{summary.receipts.length ? `${summary.receipts.length} recebimento(s) · último ${formatDate(summary.receipts[summary.receipts.length - 1].date)}` : "nenhum recebimento registrado"}</div></div>
        <div><div className="db-hero-label">Saldo a receber</div><div className="db-hero-value">{fmt(summary.balance)}</div><div className="db-hero-sub">{summary.balance ? "usado no Shipment Advice" : "pedido quitado"}</div></div>
        <div><div className="db-hero-label">Próximo vencimento</div><div className="db-hero-value">{summary.nextDue ? formatDate(summary.nextDue.dueDate).slice(0, 5) : "—"}</div><div className={`db-hero-sub${summary.nextDue?.late ? " op-late" : ""}`}>{summary.nextDue ? `${summary.nextDue.label} · ${fmt(summary.nextDue.amount)}${summary.nextDue.late ? " · atrasado" : ""}` : "sem vencimento em aberto"}</div></div>
      </section>

      <section className="pd-card">
        <div className="pd-card-head">
          <div><h2>A receber do cliente · plano de recebimento</h2><span className="pd-sub">{data.saved ? "Plano salvo para este pedido." : `Sugerido pela condição do pedido${data.paymentTerms ? ` ("${data.paymentTerms}")` : ""}. Salve para fixar.`} Valor total = invoice do pedido.</span></div>
          {canWrite && !editing && <button className="pd-btn pd-btn--xs" onClick={() => setEditing(data.installments.map((item) => ({ id: item.id, label: item.label, amount: typed(item.amount), dueDate: item.dueDate, rule: item.rule, percent: item.percent })))}>Editar parcelas</button>}
        </div>
        {editing ? (
          <div className="op-edit">
            {editing.map((item, index) => (
              <div key={item.id} className="op-edit-row">
                <label>Parcela<input className="pd-input" value={item.label} onChange={(event) => setEditing(editing.map((row, i) => i === index ? { ...row, label: event.target.value } : row))} /></label>
                <label>Valor ({currency})<input className="pd-input mono" inputMode="decimal" value={item.amount} onChange={(event) => setEditing(editing.map((row, i) => i === index ? { ...row, amount: event.target.value } : row))} /></label>
                <label>Vencimento<input className="pd-input" type="date" value={item.dueDate} onChange={(event) => setEditing(editing.map((row, i) => i === index ? { ...row, dueDate: event.target.value } : row))} /></label>
                <label>Regra<input className="pd-input" value={item.rule} placeholder="ex.: contra cópia do BL" onChange={(event) => setEditing(editing.map((row, i) => i === index ? { ...row, rule: event.target.value } : row))} /></label>
                <button className="pd-row-del" aria-label={`Remover ${item.label}`} onClick={() => setEditing(editing.filter((_, i) => i !== index))}>×</button>
              </div>
            ))}
            <div className="op-edit-foot">
              <button className="pd-btn pd-btn--xs" onClick={() => setEditing([...editing, { id: `novo-${Date.now()}`, label: "Parcela", amount: "", dueDate: "", rule: "", percent: 0 }])}>+ Parcela</button>
              <span className="pd-sub">Soma das parcelas: {fmt(editing.reduce((sum, row) => sum + parse(row.amount), 0))} de {fmt(data.total)}</span>
              <span style={{ flex: 1 }} />
              <button className="pd-btn pd-btn--xs" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="pd-btn pd-btn--dark" disabled={busy} onClick={async () => { if (await post({ action: "save-plan", installments: editing.map((row) => ({ ...row, amount: parse(row.amount) })) })) setEditing(null); }}>Salvar parcelas</button>
            </div>
          </div>
        ) : (
          <div className="pd-scroll"><table className="pd-table">
            <thead><tr><th>Parcela</th><th style={{ textAlign: "right" }}>Valor</th><th>Vencimento</th><th>Situação</th><th>Recebido · SWIFT</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {data.installments.map((item) => {
                const [label, tone] = STATUS[item.status];
                const late = item.status !== "recebido" && item.dueDate && item.dueDate < data.today;
                return (
                  <tr key={item.id}>
                    <td><b style={{ fontWeight: 500 }}>{item.label}</b>{item.rule && <span className="pd-sub" style={{ display: "block" }}>{item.rule}</span>}</td>
                    <td className="mono" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmt(item.amount)}</td>
                    <td style={{ whiteSpace: "nowrap", color: late ? "var(--et2-bad)" : undefined, fontWeight: late ? 600 : undefined }}>{formatDate(item.dueDate) || "—"}{late ? " · atrasado" : ""}</td>
                    <td><span className={`pd-badge pd-badge--${tone}`}>{label}</span>{item.requestedAt && <span className="pd-sub" style={{ display: "block", marginTop: 3 }}>solicitado em {formatDate(item.requestedAt.slice(0, 10))}</span>}</td>
                    <td>{item.receipts.length ? item.receipts.map((receipt) => (
                      <div key={receipt.id} className="op-receipt">
                        <span className="mono">{fmt(receipt.amount)}</span> em {formatDate(receipt.date)}{receipt.note && <> · {receipt.note}</>}
                        {receipt.documentId && <button className="pd-link op-swift" onClick={() => onView({ id: receipt.documentId!, fileName: docName(receipt.documentId) })}>SWIFT</button>}
                        {canWrite && <button className="pd-row-del" title="Remover este recebimento" aria-label="Remover recebimento" disabled={busy} onClick={() => { if (window.confirm("Remover este recebimento?")) post({ action: "remove-receipt", receiptId: receipt.id }); }}>×</button>}
                      </div>
                    )) : <span className="pd-sub">—</span>}</td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      {canWrite && item.status !== "recebido" && <>
                        {!item.requestedAt && <button className="pd-btn pd-btn--xs" disabled={busy} onClick={() => post({ action: "set-requested", installmentId: item.id, requested: true })}>Marcar solicitado</button>}{" "}
                        <button className="pd-btn pd-btn--xs pd-btn--dark" disabled={busy} onClick={() => setReceiving({ installmentId: item.id, date: data.today, amount: typed(Math.max(0, item.amount - item.receipts.reduce((sum, receipt) => sum + receipt.amount, 0))), note: "", file: null })}>Registrar recebimento</button>
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        {receiving && (
          <div className="op-receive">
            <b className="op-wide">Registrar recebimento · {data.installments.find((item) => item.id === receiving.installmentId)?.label}</b>
            <label>Data do crédito<input className="pd-input" type="date" value={receiving.date} onChange={(event) => setReceiving({ ...receiving, date: event.target.value })} /></label>
            <label>Valor recebido ({currency})<input className="pd-input mono" inputMode="decimal" value={receiving.amount} onChange={(event) => setReceiving({ ...receiving, amount: event.target.value })} /></label>
            <label>Observação<input className="pd-input" value={receiving.note} placeholder="opcional (ex.: ref. do SWIFT)" onChange={(event) => setReceiving({ ...receiving, note: event.target.value })} /></label>
            <label>SWIFT / MT103<input className="pd-input" type="file" accept=".pdf,image/*" onChange={(event) => setReceiving({ ...receiving, file: event.target.files?.[0] ?? null })} /></label>
            <div className="op-receive-actions"><button className="pd-btn pd-btn--xs" onClick={() => setReceiving(null)}>Cancelar</button><button className="pd-btn pd-btn--dark" disabled={busy || !(parse(receiving.amount) > 0)} onClick={receive}>{busy ? "Salvando…" : "Salvar recebimento"}</button></div>
          </div>
        )}
      </section>

      <section className="pd-card">
        <div className="pd-card-head" style={{ alignItems: "center" }}>
          <h2>Documentos financeiros <span style={{ fontWeight: 400, color: "var(--et2-muted)" }}>· {docs.length}</span></h2>
          {canWrite && <label className="pd-btn pd-btn--xs" style={{ cursor: "pointer" }}>+ Anexar<input type="file" hidden onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) { try { setBusy(true); await upload(file); } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao anexar."); } finally { setBusy(false); } } }} /></label>}
        </div>
        {docs.map((doc) => <div key={doc.id} className="op-doc"><button className="pd-link" onClick={() => onView(doc)}>📄 {doc.fileName}</button><span className="pd-sub">{doc.uploadedAt ? formatDate(doc.uploadedAt.slice(0, 10)) : ""}</span></div>)}
        {!docs.length && <p className="pd-sub" style={{ padding: "0 20px 16px" }}>Proformas, SWIFTs e comprovantes do cliente ficam aqui.</p>}
      </section>
      <p className="pd-sub" style={{ margin: 0 }}>No Shipment Advice (fase Documentos), o e-mail sai com o total da invoice, os recebimentos registrados aqui e o saldo a pagar. Ao enviar, as parcelas em aberto passam para "Solicitado".</p>
    </div>
  );
}

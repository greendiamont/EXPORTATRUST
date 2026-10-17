"use client";

import { useCallback, useEffect, useState } from "react";
import { SHIPMENT_ADVICE_CHECKLIST, SHIPMENT_SET_CATEGORY, resolvedShipmentDocumentType } from "../../lib/shipment-documents";

// Shipment Advice na fase Documentos do pedido (protótipo "3b · Shipment Advice").
// Mesmas regras da versão anterior (/api/shipment-advice): cada documento do set precisa de
// aprovação humana; o envio só libera com todos os obrigatórios aprovados.

type SetDoc = { id: number; fileName: string; category: string; documentType: string; analysisSummary?: string; shipmentSetStatus: string; clientShareStatus: string; createdAt?: string };
type AdviceSnapshot = {
  documents: SetDoc[];
  generated: { recipient: string; subject: string; body: string; included: Array<{ id: number; fileName: string }> };
  complete: boolean;
  advice: { status: string; sentAt: string | null; recipient: string } | null;
  /** Financeiro do pedido (lib/order-payments.ts): o e-mail usa estes valores. */
  payments?: { total: number; received: number; balance: number; receipts: Array<{ date: string; amount: number }> };
};

const approvedDoc = (doc: SetDoc) => doc.shipmentSetStatus === "Incluído" && doc.clientShareStatus === "Aprovado";

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/shipment-advice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result as AdviceSnapshot;
}

export function ShipmentAdviceCard({ operationId, onView, onChanged, onError }: { operationId: number; onView: (documentId: number, fileName: string) => void; onChanged: () => void; onError: (message: string) => void }) {
  const [data, setData] = useState<AdviceSnapshot | null>(null);
  const [busy, setBusy] = useState("");
  const [recipient, setRecipient] = useState("");
  const [showBody, setShowBody] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    fetch(`/api/shipment-advice?operationId=${operationId}`).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setData(result);
      setRecipient(result.generated.recipient || "");
    }).catch((reason: Error) => onError(`Shipment Advice: ${reason.message}`));
  }, [operationId, onError]);
  useEffect(load, [load]);

  async function act(key: string, body: Record<string, unknown>, done?: string) {
    setBusy(key);
    setNotice("");
    try {
      const result = await post({ operationId, ...body });
      setData(result);
      setRecipient(result.generated.recipient || "");
      if (done) setNotice(done);
      onChanged();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Falha no Shipment Advice.";
      onError(/RESEND_API_KEY|EMAIL_FROM/.test(message) ? "O envio de e-mail ainda não está ligado no servidor (falta configurar o Resend). Os documentos e aprovações ficaram salvos." : message);
    } finally {
      setBusy("");
    }
  }

  async function upload(type: string, file: File | undefined) {
    if (!file) return;
    setBusy(`up-${type}`);
    try {
      const form = new FormData();
      form.set("operationId", String(operationId));
      form.set("category", SHIPMENT_SET_CATEGORY);
      form.set("documentType", type);
      form.set("file", file);
      const response = await fetch("/api/documents", { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
      load();
      onChanged();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao anexar.");
    } finally {
      setBusy("");
    }
  }

  if (!data) return <section className="pd-card sa"><div className="pd-card-head"><h2>Shipment Advice · set de documentos</h2></div><p className="pd-sub" style={{ padding: "0 20px 16px" }}>Carregando…</p></section>;

  const setDocs = data.documents.filter((doc) => doc.category === SHIPMENT_SET_CATEGORY);
  const cards = SHIPMENT_ADVICE_CHECKLIST.map((item) => {
    const docs = setDocs.filter((doc) => (item.types as readonly string[]).includes(resolvedShipmentDocumentType(doc)));
    const approved = docs.filter(approvedDoc);
    return { ...item, docs, approved: approved.length > 0 };
  });
  const required = cards.filter((card) => card.required);
  const readyCount = required.filter((card) => card.approved).length;
  const missing = required.filter((card) => !card.approved).map((card) => card.label);
  const unmatched = setDocs.filter((doc) => !cards.some((card) => card.docs.includes(doc)));
  const sent = data.advice?.sentAt ? data.advice : null;
  const canEmit = data.complete && data.generated.included.length > 0 && Boolean(recipient.trim());

  const fileRow = (doc: SetDoc) => (
    <div key={doc.id} className="sa-file">
      <span title={doc.fileName}>📄 {doc.fileName}</span>
      <span className="sa-file-actions">
        <button type="button" className="sa-link" onClick={() => onView(doc.id, doc.fileName)}>Ver</button>
        <button type="button" className={approvedDoc(doc) ? "pd-btn pd-btn--xs" : "pd-btn pd-btn--xs sa-approve"} disabled={Boolean(busy)}
          onClick={() => act(`doc-${doc.id}`, { action: "set-document-status", documentId: doc.id, approved: !approvedDoc(doc) })}>
          {busy === `doc-${doc.id}` ? "…" : approvedDoc(doc) ? "Reabrir" : "Aprovar"}
        </button>
      </span>
    </div>
  );

  return (
    <section className="pd-card sa" aria-labelledby="sa-title">
      <div className="sa-head">
        <div>
          <h2 id="sa-title">Shipment Advice · set de documentos</h2>
          <div className="pd-sub">Anexe e aprove cada documento. O Shipment Advice só pode ser emitido com todos os obrigatórios aprovados.</div>
        </div>
        <div className="sa-progress">
          <div className="sa-progress-text"><span>{readyCount} de {required.length} obrigatórios aprovados</span><b className={data.complete ? "ok" : "warn"}>{sent ? "Enviado" : data.complete ? "Pronto para emitir" : "Em preparação"}</b></div>
          <div className="sa-bar"><div className={data.complete ? "ok" : "warn"} style={{ width: `${Math.round((readyCount / required.length) * 100)}%` }} /></div>
        </div>
      </div>

      <div className="sa-grid">
        {cards.map((card) => {
          const tone = card.approved ? "ok" : card.docs.length ? "warn" : card.required ? "bad" : "muted";
          const label = card.approved ? "Aprovado" : card.docs.length ? "Aguardando aprovação" : card.required ? "Falta anexar" : "Opcional";
          const type = card.types[0];
          return (
            <div key={card.key} className={`sa-card${card.approved ? " sa-card--ok" : ""}`}>
              <div className="sa-card-head">
                <div><b>{card.label}</b><div className="pd-sub">{card.required ? "Obrigatório" : "Condicional"}</div></div>
                <span className={`sa-badge sa-badge--${tone}`}>{label}</span>
              </div>
              {card.docs.map(fileRow)}
              <label className={card.docs.length ? "pd-btn pd-btn--xs sa-upload-small" : "sa-drop"}
                onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); upload(type, event.dataTransfer.files?.[0]); }}>
                {busy === `up-${type}` ? "Enviando…" : card.docs.length ? "+ Anexar outra versão" : <>Arraste o arquivo aqui ou <u>escolha</u></>}
                <input type="file" hidden disabled={Boolean(busy)} onChange={(event) => { upload(type, event.target.files?.[0]); event.target.value = ""; }} />
              </label>
            </div>
          );
        })}
      </div>
      {unmatched.length > 0 && (
        <details className="sa-unmatched">
          <summary>Outros arquivos da pasta Set documental · {unmatched.length}</summary>
          {unmatched.map((doc) => <div key={doc.id} className="sa-file"><span>📄 {doc.fileName}</span><button type="button" className="sa-link" onClick={() => onView(doc.id, doc.fileName)}>Ver</button></div>)}
        </details>
      )}

      <div className="sa-mail">
        <div className="sa-mail-preview">
          {data.payments && (
            <div className={`sa-pay ${data.payments.received > 0 ? "sa-pay--ok" : ""}`}>
              {data.payments.received > 0
                ? <>✓ Recebido registrado no Financeiro do pedido: <b>{data.payments.received.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</b> ({data.payments.receipts.length} SWIFT). Saldo no e-mail: <b>{data.payments.balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</b>.</>
                : <>Nenhum adiantamento registrado no Financeiro do pedido: o e-mail cobra o total da invoice.</>}
            </div>
          )}
          <div className="sa-label">Prévia do e-mail</div>
          <label className="sa-to">Para:
            <input className="pd-input" type="email" placeholder="e-mail do cliente" value={recipient} onChange={(event) => setRecipient(event.target.value)}
              onBlur={() => { if (recipient.trim() && recipient.trim().toLowerCase() !== (data.generated.recipient || "").toLowerCase()) act("to", { action: "set-recipient", recipient }); }} />
          </label>
          <div className="sa-subject"><span className="pd-sub">Assunto:</span> <span className="mono">{data.generated.subject}</span></div>
          <div className={`sa-body${showBody ? " sa-body--open" : ""}`}>{data.generated.body}</div>
          <button type="button" className="sa-link" onClick={() => setShowBody(!showBody)}>{showBody ? "Mostrar menos" : "Ver prévia completa"}</button>
        </div>
        <div className="sa-mail-side">
          <div className="sa-label">Anexos ({data.generated.included.length})</div>
          {data.generated.included.length ? data.generated.included.map((doc) => <div key={doc.id} className="sa-attach">✓ {doc.fileName}</div>) : <div className="pd-sub">Nenhum documento aprovado ainda.</div>}
          <div className="sa-emit">
            <button type="button" className="sa-emit-btn" disabled={!canEmit || Boolean(busy)}
              onClick={() => { if (window.confirm(`Enviar o Shipment Advice para ${recipient} com ${data.generated.included.length} anexo(s)?`)) act("send", { action: "approve-send" }, "Shipment Advice enviado ao cliente."); }}>
              {busy === "send" ? "Enviando…" : sent ? "Emitir novamente" : "Emitir Shipment Advice"}
            </button>
            <div className="pd-sub">
              {notice || (sent ? `Enviado para ${sent.recipient} em ${new Date(sent.sentAt!).toLocaleString("pt-BR")}.`
                : !data.complete ? `Falta aprovar: ${missing.join(", ")}.`
                : !recipient.trim() ? "Informe o e-mail do cliente."
                : "Envia o e-mail ao cliente com os anexos aprovados e registra no histórico do pedido.")}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

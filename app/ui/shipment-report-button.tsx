"use client";

import { useEffect, useState } from "react";
import { api, formatDate } from "./format";

// Botão "Shipment Report" no pedido (protótipo "3e", aprovado por Ivam em 2026-10-17): envia ao cliente
// o relatório de todos os pedidos em aberto (ou só deste) e configura o envio automático do cliente
// (a cada N dias ou quando um pedido muda de fase). Montagem e envio: /api/shipment-report.

type Info = {
  clientName: string; emails: string; orders: Array<{ id: number; reference: string; badge: string }>; canWrite: boolean;
  settings: { auto: boolean; intervalDays: number; onPhaseChange: boolean; includePayments: boolean; lastSentAt: string; nextAt: string };
};

export function ShipmentReportButton({ operationId, onSent }: { operationId: number; onSent?: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [emails, setEmails] = useState("");
  const [scope, setScope] = useState<"client" | "order">("client");
  const [message, setMessage] = useState("");
  const [auto, setAuto] = useState({ auto: false, intervalDays: 10, onPhaseChange: true, includePayments: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setNotice("");
    api<Info>(`/api/shipment-report?operationId=${operationId}`).then((result) => {
      setInfo(result);
      setEmails(result.emails);
      setAuto({ auto: result.settings.auto, intervalDays: result.settings.intervalDays, onPhaseChange: result.settings.onPhaseChange, includePayments: result.settings.includePayments });
    }).catch((reason: Error) => setError(reason.message));
  }, [open, operationId]);

  const link = (format: string) => `/api/shipment-report?operationId=${operationId}&scope=${scope}&format=${format}&message=${encodeURIComponent(message)}`;

  async function send() {
    if (!window.confirm(`Enviar o Shipment Report para ${emails}?`)) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ orders: number }>("/api/shipment-report", { method: "POST", body: JSON.stringify({ action: "send", operationId, emails, scope, message }) });
      const text = `Shipment Report enviado (${result.orders} pedido${result.orders === 1 ? "" : "s"}) para ${emails}.`;
      onSent?.(text);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao enviar.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAuto() {
    setBusy(true);
    setError("");
    try {
      await api("/api/shipment-report", { method: "POST", body: JSON.stringify({ action: "save-settings", operationId, emails, ...auto }) });
      const refreshed = await api<Info>(`/api/shipment-report?operationId=${operationId}`);
      setInfo(refreshed);
      setNotice(auto.auto ? "Envio automático ligado para este cliente." : "Envio automático desligado.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="pd-btn" onClick={() => setOpen(true)} title="Enviar ao cliente a situação dos pedidos dele">Shipment Report</button>
      {open && (
        <div className="cb-modal" role="dialog" aria-modal="true" aria-labelledby="sr-title" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="cb-dialog sr-dialog">
            <div className="cb-dialog-head">
              <div><h2 id="sr-title">Shipment Report · {info?.clientName ?? "…"}</h2><div className="pd-sub">O cliente recebe a situação dos pedidos: fase, booking, embarque, qualidade, documentos, pagamento e EUDR. Sem margem, compra ou tarefas internas.</div></div>
              <button type="button" className="cb-remove" aria-label="Fechar" onClick={() => setOpen(false)}>×</button>
            </div>
            {!info && !error && <p className="pd-sub" style={{ padding: 20 }}>Carregando…</p>}
            {info && (
              <div className="sr-body">
                <section className="sr-box">
                  <b>Enviar agora</b>
                  <label>Para (e-mails separados por vírgula)<input className="pd-input" value={emails} onChange={(event) => setEmails(event.target.value)} placeholder="cliente@empresa.com" /></label>
                  <div className="sr-radios">
                    <label><input type="radio" checked={scope === "client"} onChange={() => setScope("client")} /> Todos os pedidos em aberto do cliente ({info.orders.length})</label>
                    <label><input type="radio" checked={scope === "order"} onChange={() => setScope("order")} /> Só este pedido</label>
                  </div>
                  {scope === "client" && <div className="pd-sub">{info.orders.map((order) => `${order.reference} (${order.badge})`).join(" · ")}</div>}
                  <label>Mensagem (opcional, em inglês)<textarea className="pd-input" rows={2} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="e.g. Booking confirmed — loading next week." /></label>
                  <div className="sr-actions">
                    <a className="pd-btn pd-btn--xs" href={link("html")} target="_blank" rel="noreferrer">Ver prévia</a>
                    <a className="pd-btn pd-btn--xs" href={link("pdf")} target="_blank" rel="noreferrer">PDF</a>
                    {info.canWrite && <button className="pd-btn pd-btn--dark" disabled={busy || !emails.trim()} onClick={send}>{busy ? "Enviando…" : "Enviar agora"}</button>}
                  </div>
                </section>
                {info.canWrite && (
                  <section className="sr-box">
                    <b>Envio automático para este cliente</b>
                    <label className="sr-check"><input type="checkbox" checked={auto.auto} onChange={(event) => setAuto({ ...auto, auto: event.target.checked })} /> Enviar o Shipment Report automaticamente (todos os pedidos em aberto)</label>
                    <label>Frequência<select className="pd-input" value={auto.intervalDays} onChange={(event) => setAuto({ ...auto, intervalDays: Number(event.target.value) })}>
                      <option value={10}>A cada 10 dias</option><option value={15}>A cada 15 dias</option><option value={7}>Toda semana</option><option value={0}>Só quando muda de fase</option>
                    </select></label>
                    <label className="sr-check"><input type="checkbox" checked={auto.onPhaseChange || auto.intervalDays === 0} disabled={auto.intervalDays === 0} onChange={(event) => setAuto({ ...auto, onPhaseChange: event.target.checked })} /> Também enviar quando um pedido muda de fase (booking, embarque, chegada…)</label>
                    <label className="sr-check"><input type="checkbox" checked={auto.includePayments} onChange={(event) => setAuto({ ...auto, includePayments: event.target.checked })} /> Incluir pagamentos (recebido, saldo e vencimento)</label>
                    <div className="sr-status">{info.settings.auto
                      ? <>Ligado · último envio {info.settings.lastSentAt ? formatDate(info.settings.lastSentAt.slice(0, 10)) : "—"}{info.settings.intervalDays && info.settings.nextAt ? ` · próximo até ${formatDate(info.settings.nextAt.slice(0, 10))}` : ""}{info.settings.onPhaseChange || !info.settings.intervalDays ? " · ou antes, se algum pedido mudar de fase" : ""}</>
                      : <>Desligado. Os e-mails usados são os do campo "Para".</>}</div>
                    <div className="sr-actions"><button className="pd-btn pd-btn--dark" disabled={busy} onClick={saveAuto}>Salvar envio automático</button></div>
                  </section>
                )}
                {notice && <div className="cb-result" role="status">{notice}</div>}
              </div>
            )}
            {error && <div className="cb-error" role="alert" style={{ margin: "0 20px 16px" }}>{error}</div>}
          </div>
        </div>
      )}
    </>
  );
}

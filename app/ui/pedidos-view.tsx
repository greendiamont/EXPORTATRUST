"use client";

import { useEffect, useMemo, useState } from "react";
import { api, formatDate, money, normalize, processHref, relativeDue } from "./format";
import { PHASE_NAMES, type Overview } from "./overview-types";

export default function PedidosView({ initialPhase }: { initialPhase: number | null }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<number | null>(initialPhase);
  const [onlyCancelled, setOnlyCancelled] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const load = () => api<Overview>("/api/overview").then(setData).catch((reason: Error) => setError(reason.message));
  useEffect(() => { load(); }, []);

  // Cancelar / reabrir: cancelados saem das fases e ficam no fim da lista, em vermelho.
  async function toggleCancel(operation: Overview["operations"][number]) {
    const cancel = !operation.cancelled;
    if (!window.confirm(cancel ? `Cancelar o pedido ${operation.reference}? Ele vai para o fim da lista, em "Cancelados". Dá para reabrir depois.` : `Reabrir o pedido ${operation.reference}?`)) return;
    setBusyId(operation.id);
    try {
      await api("/api/operations", { method: "PATCH", body: JSON.stringify({ id: operation.id, action: cancel ? "cancel" : "reopen" }) });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao cancelar o pedido.");
    } finally {
      setBusyId(null);
    }
  }

  const rows = useMemo(() => {
    const term = normalize(query.trim());
    return (data?.operations ?? []).filter((operation) =>
      (onlyCancelled ? operation.cancelled : phase === null || (!operation.cancelled && operation.phaseIndex === phase))
      && (!term || normalize([operation.reference, operation.client, operation.product, operation.supplierName, operation.country].join(" ")).includes(term)))
      .sort((a, b) => Number(a.cancelled) - Number(b.cancelled));
  }, [data, phase, query, onlyCancelled]);
  const cancelledCount = (data?.operations ?? []).filter((operation) => operation.cancelled).length;

  function pickPhase(next: number | null) {
    setPhase(next);
    setOnlyCancelled(false);
    const url = new URL(window.location.href);
    if (next === null) url.searchParams.delete("fase"); else url.searchParams.set("fase", String(next));
    window.history.replaceState(null, "", url);
  }

  return (
    <main className="et2-main">
      <div className="et2-head">
        <h1>Pedidos</h1>
        <a className="et2-btn et2-btn--primary" href="/novo-processo">+ Novo processo</a>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div className="et2-seg" role="group" aria-label="Filtrar por fase">
          <button aria-pressed={phase === null && !onlyCancelled} onClick={() => pickPhase(null)}>Todos {data ? `(${data.operations.length})` : ""}</button>
          {PHASE_NAMES.map((name, index) => (
            <button key={name} aria-pressed={phase === index && !onlyCancelled} onClick={() => pickPhase(index)}>{name} {data ? `(${data.phaseCounts[index]?.count ?? 0})` : ""}</button>
          ))}
          {cancelledCount > 0 && <button aria-pressed={onlyCancelled} onClick={() => { setOnlyCancelled(true); setPhase(null); }}>Cancelados ({cancelledCount})</button>}
        </div>
        <label style={{ display: "flex" }}>
          <span className="sr-only">Buscar pedidos</span>
          <input className="et2-input" style={{ width: 320, maxWidth: "100%" }} placeholder="Buscar pedido, cliente, produto ou fornecedor" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>

      {error && <div className="et2-alert et2-alert--bad" role="alert">Não foi possível carregar os pedidos: {error}</div>}

      <section className="et2-card et2-scroll" aria-label="Lista de pedidos">
        <table className="et2-table" style={{ minWidth: 1040 }}>
          <thead><tr><th>Pedido</th><th>Cliente / destino</th><th>Andamento</th><th>Próximo passo</th><th>ETD</th><th className="num">Valor</th><th>EUDR</th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {rows.map((operation) => {
              const due = operation.next ? relativeDue(operation.next.due, data!.today) : null;
              return (
                <tr key={operation.id} className={operation.cancelled ? "pd-cancelled" : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}><a className="mono" style={{ fontWeight: 500 }} href={processHref(operation.id)}>{operation.reference}</a><span className="et2-sub">{operation.product}</span></td>
                  <td>{operation.client || "—"}<span className="et2-sub">{operation.country || "Destino a definir"}</span></td>
                  <td style={{ minWidth: 200 }}>
                    <div className="et2-progress" aria-hidden="true">
                      {PHASE_NAMES.map((name, index) => <span key={name} className={index < operation.phaseIndex || (index === 5 && operation.phaseIndex === 5) ? "done" : index === operation.phaseIndex ? "now" : ""} />)}
                    </div>
                    {operation.cancelled
                      ? <span className="et2-badge et2-badge--bad">Cancelado</span>
                      : <span className="et2-sub" style={{ color: "var(--et2-ink-2)" }}>{operation.phaseIndex + 1}/6 · {operation.phaseName}{operation.blocked ? " · bloqueado" : ""}</span>}
                  </td>
                  <td>{operation.next?.what || "—"}{operation.next?.detail && <span className="et2-sub">{operation.next.detail}</span>}{due && <span className="et2-sub" style={{ color: due.tone === "bad" ? "var(--et2-bad)" : due.tone === "warn" ? "var(--et2-warn)" : undefined, fontWeight: due.tone === "todo" ? 400 : 600 }}>{due.label}{operation.next?.who ? ` · ${operation.next.who}` : ""}</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatDate(operation.etd)}</td>
                  <td className="num mono">{money(operation.value, operation.currency || "USD")}</td>
                  <td>{operation.eudrRequired
                    ? <span className={`et2-badge et2-badge--${operation.readiness >= 100 ? "ok" : "warn"}`}>{operation.readiness >= 100 ? "Completo" : `Pendente · ${operation.readiness}%`}</span>
                    : <span className="et2-badge et2-badge--todo">N/A</span>}</td>
                  <td><button className="et2-btn et2-btn--sm pd-cancel-btn" disabled={busyId === operation.id} onClick={() => toggleCancel(operation)} title={operation.cancelled ? "Reabrir este pedido" : "Cancelar este pedido"}>{busyId === operation.id ? "…" : operation.cancelled ? "Reabrir" : "Cancelar"}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && !rows.length && <p className="et2-empty">Nenhum pedido {phase !== null ? `na fase ${PHASE_NAMES[phase]}` : "encontrado"}.</p>}
        {!data && !error && <p className="et2-empty">Carregando…</p>}
      </section>
    </main>
  );
}

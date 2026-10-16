"use client";

import { useEffect, useMemo, useState } from "react";
import { api, formatDate, money, normalize, processHref, relativeDue } from "./format";
import type { Overview } from "./overview-types";

export default function PainelView({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api<Overview>("/api/overview").then(setData).catch((reason: Error) => setError(reason.message));
  }, []);

  const pending = useMemo(() => {
    if (!data) return [];
    const me = [normalize(userName), normalize(userEmail.split("@")[0])].filter(Boolean);
    return data.pending.filter((item) => !mine || me.some((name) => normalize(item.who).includes(name) || name.includes(normalize(item.who || "-"))));
  }, [data, mine, userName, userEmail]);

  // Processos · negociação: o que foi negociado em cada pedido (protótipo aprovado em 2026-10-16).
  const processes = useMemo(() => {
    const query = normalize(search.trim());
    return (data?.operations ?? []).filter((operation) => !query || normalize([operation.reference, operation.contractNumber, operation.client, operation.exporterName, operation.supplierName, operation.product, operation.terms?.sizes].join(" ")).includes(query));
  }, [data, search]);

  const departures = useMemo(() => (data?.operations ?? [])
    .filter((operation) => operation.etd && operation.phaseIndex < 4)
    .sort((a, b) => a.etd.localeCompare(b.etd))
    .slice(0, 6), [data]);

  return (
    <main className="et2-main">
      <div className="et2-head">
        <div>
          <h1>Painel</h1>
          <p>Situação dos pedidos em andamento</p>
        </div>
        <a className="et2-btn et2-btn--primary" href="/novo-processo">+ Novo processo</a>
      </div>

      {error && <div className="et2-alert et2-alert--bad" role="alert">Não foi possível carregar o painel: {error}</div>}

      <section className="et2-card et2-phases" aria-label="Pedidos por fase">
        {(data?.phaseCounts ?? Array.from({ length: 6 }, (_, index) => ({ name: ["Pedido", "Produção", "Embarque", "Documentos", "Trânsito", "Entregue"][index], count: 0, blocked: 0 }))).map((phase, index) => (
          <a key={phase.name} href={`/pedidos?fase=${index}`}>
            <span className="label">{index + 1} · {phase.name}</span>
            <span className="count">{data ? phase.count : "–"}</span>
            <span className={phase.blocked ? "note note--bad" : "note"}>{phase.blocked ? `${phase.blocked} bloqueado(s)` : " "}</span>
          </a>
        ))}
      </section>

      <section className="et2-card" aria-labelledby="processos">
        <div className="et2-card-head" style={{ flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 id="processos">Processos · negociação</h2>
            <span className="et2-sub" style={{ margin: 0 }}>O que foi negociado em cada pedido. Clique no processo para abrir o acompanhamento do pedido.</span>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--et2-ink-2)" }}>Buscar
            <input className="et2-input" style={{ width: 240 }} placeholder="Processo, cliente, produto…" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
        </div>
        <div className="et2-scroll">
          <table className="et2-table pn-procs" lang="pt-BR" style={{ minWidth: 1100, fontSize: 12.5 }}>
            <colgroup><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "11%" }} /><col style={{ width: "9%" }} /><col style={{ width: "7%" }} /><col style={{ width: "9%" }} /><col style={{ width: "9%" }} /><col style={{ width: "7%" }} /><col style={{ width: "8%" }} /></colgroup>
            <thead><tr><th>Processo</th><th>Cliente / importador</th><th>Exportador</th><th>Fornecedor</th><th>Produto · medidas</th><th>Incoterm</th><th className="num">Quantidade</th><th className="num">Preço · total</th><th>Pagamento</th><th>Fase</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {processes.map((operation) => (
                <tr key={operation.id}>
                  <td><a className="mono" style={{ fontWeight: 500 }} href={processHref(operation.id)}>{operation.reference}</a>{operation.contractNumber && <span className="et2-sub">PO {operation.contractNumber}</span>}</td>
                  <td>{operation.client || "—"}</td>
                  <td>{operation.exporterName || "—"}</td>
                  <td>{operation.supplierName || "—"}</td>
                  <td>{operation.product || "—"}{operation.terms?.sizes && <span className="et2-sub">{operation.terms.sizes}</span>}</td>
                  <td>{[operation.incoterm, operation.incoterm?.startsWith("F") || operation.incoterm === "EXW" ? operation.portOfLoading : operation.portOfDischarge].filter(Boolean).join(" ") || "—"}</td>
                  <td className="num">{operation.quantity ? `${operation.quantity.toLocaleString("pt-BR")} ${operation.quantityUnit}` : "—"}</td>
                  <td className="num">
                    {operation.terms?.unitPrice ? <>{operation.currency} {operation.terms.unitPrice.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}<span className="et2-sub" style={{ marginTop: 0 }}>por {operation.quantityUnit}</span></> : operation.terms?.itemCount > 1 ? "vários itens" : "—"}
                    <span className="et2-sub">{operation.value ? money(operation.value, operation.currency || "USD") : ""}</span>
                  </td>
                  <td><span title={operation.terms?.paymentTerms || undefined} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{operation.terms?.paymentTerms || "—"}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}><span className={`et2-badge et2-badge--${operation.phaseIndex === 5 ? "ok" : operation.phaseIndex === 0 ? "todo" : "warn"}`}>{operation.phaseName}</span></td>
                  <td><a className="et2-btn et2-btn--sm" style={{ whiteSpace: "normal", textAlign: "center", lineHeight: 1.2, padding: "4px 6px", minHeight: 0, maxWidth: "100%", boxSizing: "border-box" }} href={`/novo-processo?processo=${operation.id}`} title="Editar a negociação deste processo">Editar</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !processes.length && <p className="et2-empty">{search ? "Nenhum processo encontrado." : "Nenhum processo cadastrado ainda."}</p>}
        </div>
      </section>

      <div className="et2-row">
        <section className="et2-card et2-grow" aria-labelledby="pendencias">
          <div className="et2-card-head">
            <h2 id="pendencias">Pendências</h2>
            <div className="et2-seg" role="group" aria-label="Filtrar pendências">
              <button aria-pressed={!mine} onClick={() => setMine(false)}>Todas</button>
              <button aria-pressed={mine} onClick={() => setMine(true)}>Minhas</button>
            </div>
          </div>
          <div className="et2-scroll">
            <table className="et2-table" style={{ minWidth: 640 }}>
              <thead><tr><th>Prazo</th><th>Pedido</th><th>O que fazer</th><th>Responsável</th></tr></thead>
              <tbody>
                {pending.slice(0, 40).map((item, index) => {
                  const due = relativeDue(item.due, data!.today);
                  return (
                    <tr key={`${item.operationId}-${item.kind}-${index}`}>
                      <td><span className={`et2-badge et2-badge--${due.tone}`}>{due.label}</span></td>
                      <td><a className="mono" href={processHref(item.operationId)}>{item.reference}</a></td>
                      <td>{item.what}{item.detail && <span className="et2-sub">{item.detail}</span>}</td>
                      <td>{item.who || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data && !pending.length && <p className="et2-empty">{mine ? "Nenhuma pendência com prazo atribuída a você." : "Nenhuma pendência com prazo. Defina prazos nas etapas dos pedidos."}</p>}
            {!data && !error && <p className="et2-empty">Carregando…</p>}
          </div>
        </section>

        <section className="et2-card et2-side" aria-labelledby="embarques">
          <div className="et2-card-head"><h2 id="embarques">Próximos embarques</h2></div>
          {departures.map((operation) => (
            <div key={operation.id} style={{ padding: "12px 20px", borderTop: "1px solid var(--et2-line-2)", display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <a className="mono" href={processHref(operation.id)}>{operation.reference}</a>
                <span className="et2-sub">{operation.route || operation.country || operation.product}</span>
              </div>
              <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <div style={{ fontWeight: 500 }}>{formatDate(operation.etd)}</div>
                <span className="et2-sub">ETD</span>
              </div>
            </div>
          ))}
          {data && !departures.length && <p className="et2-empty">Nenhum embarque com data prevista.</p>}
        </section>
      </div>
    </main>
  );
}

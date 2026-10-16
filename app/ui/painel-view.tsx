"use client";

import { useEffect, useMemo, useState } from "react";
import { addMonths, amounts, exportedSeries, exportedTotals, isActive, isExported, monthKey, referenceRate, shipmentsByMonth, type Range } from "../../lib/dashboard";
import { api, formatDate, money, normalize, processHref, relativeDue } from "./format";
import { PHASE_NAMES, type Overview, type OverviewOperation } from "./overview-types";

// Painel em formato de dashboard (protótipo "1b · Painel dashboard", aprovado por Ivam em 2026-10-16).
// As contas ficam em lib/dashboard.ts; a tabela "Processos · negociação" continua aqui, recolhida.

const RANGES = ["Este ano", "12 meses", "Tudo"];
const PHASE_RAMP = ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf"];
const MONTH_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function compact(value: number, prefix: string) {
  if (Math.abs(value) >= 1_000_000) return `${prefix} ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (Math.abs(value) >= 1_000) return `${prefix} ${Math.round(value / 1_000).toLocaleString("pt-BR")} mil`;
  return `${prefix} ${Math.round(value).toLocaleString("pt-BR")}`;
}
const m3 = (value: number) => `${Math.round(value).toLocaleString("pt-BR")} m³`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const daysUntil = (date: string, today: string) => Math.round((Date.parse(date.slice(0, 10)) - Date.parse(today)) / 86_400_000);

function niceMax(value: number) {
  if (value <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(value)));
  const top = [1, 2, 2.5, 5, 10].map((factor) => factor * step).find((candidate) => candidate >= value) ?? 10 * step;
  return Math.ceil(top / 4) * 4 === top ? top : Math.ceil(value / 4) * 4;
}

function Panel({ title, total, bars, color, format }: { title: string; total: string; bars: Array<{ key: string; name: string; value: number }>; color: string; format: (value: number) => string }) {
  const max = Math.max(...bars.map((bar) => bar.value), 0) || 1;
  const dense = bars.length > 12;
  return (
    <figure className="db-panel">
      <figcaption><b>{title}</b><span>{total}</span></figcaption>
      <div className="db-bars" role="img" aria-label={`${title}: ${bars.map((bar) => `${bar.name} ${format(bar.value)}`).join(", ")}`}>
        {bars.map((bar) => (
          <div key={bar.key} className="db-col" title={`${bar.name}: ${format(bar.value)}`}>
            {!dense && <span className="db-val">{bar.value ? format(bar.value) : ""}</span>}
            <div className="db-bar" style={{ height: `${bar.value ? Math.max(3, (bar.value / max) * 112) : 0}px`, background: color }} />
          </div>
        ))}
      </div>
      <div className="db-axis">{bars.map((bar, index) => <span key={bar.key}>{dense && index % 2 ? "" : bar.name}</span>)}</div>
    </figure>
  );
}

export default function PainelView(_props: { userName: string; userEmail: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<Range>(1);
  const [yearly, setYearly] = useState(false);

  useEffect(() => {
    api<Overview>("/api/overview").then(setData).catch((reason: Error) => setError(reason.message));
  }, []);

  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const operations = useMemo(() => data?.operations ?? [], [data]);
  const rate = useMemo(() => referenceRate(operations), [operations]);
  const usdOf = (operation: OverviewOperation) => amounts(operation, rate).usd ?? 0;

  const totals = useMemo(() => exportedTotals(operations, range, today), [operations, range, today]);
  const series = useMemo(() => exportedSeries(operations, yearly ? "year" : "month", range, today), [operations, yearly, range, today]);
  const months = useMemo(() => shipmentsByMonth(operations, today), [operations, today]);

  const active = operations.filter(isActive);
  const toShip = active.filter((operation) => !isExported(operation));
  const next30 = toShip.filter((operation) => operation.etd && daysUntil(operation.etd, today) >= 0 && daysUntil(operation.etd, today) <= 30).sort((a, b) => a.etd.localeCompare(b.etd));
  const inTransit = active.filter((operation) => operation.phaseIndex === 4);
  const year = today.slice(0, 4);
  const completedThisYear = operations.filter((operation) => !operation.cancelled && operation.completed && operation.completedAt.startsWith(year));
  const blockedOps = active.filter((operation) => operation.blocked);
  const lateItems = (data?.pending ?? []).filter((item) => item.late);
  const lateOps = new Set(lateItems.map((item) => item.operationId).filter((id) => !blockedOps.some((operation) => operation.id === id)));

  // Precisa de atenção: bloqueados, depois atrasados, depois prazos dos próximos 7 dias.
  const alerts = [
    ...blockedOps.map((operation) => ({ id: operation.id, ref: operation.reference, text: `${operation.blockedStep?.what || "Etapa"} bloqueada`, who: operation.blockedStep?.who || "", tone: "bad" })),
    ...lateItems.map((item) => ({ id: item.operationId, ref: item.reference, text: `${item.what} atrasado (prazo ${formatDate(item.due)})`, who: [relativeDue(item.due, today).label, item.who].filter(Boolean).join(" · "), tone: "late" })),
    ...(data?.pending ?? []).filter((item) => !item.late && daysUntil(item.due, today) <= 7).map((item) => ({ id: item.operationId, ref: item.reference, text: item.what, who: [`Prazo ${formatDate(item.due)}`, item.who].filter(Boolean).join(" · "), tone: "info" })),
  ].slice(0, 6);

  const upcoming = toShip.filter((operation) => operation.etd).sort((a, b) => a.etd.localeCompare(b.etd)).slice(0, 5);
  const clients = Object.entries(toShip.reduce<Record<string, number>>((sum, operation) => {
    const name = operation.client || "Sem cliente";
    sum[name] = (sum[name] ?? 0) + usdOf(operation);
    return sum;
  }, {})).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const clientMax = clients[0]?.[1] || 1;

  const processes = useMemo(() => {
    const query = normalize(search.trim());
    return operations.filter((operation) => !query || normalize([operation.reference, operation.contractNumber, operation.client, operation.exporterName, operation.supplierName, operation.product, operation.terms?.sizes].join(" ")).includes(query))
      .sort((a, b) => (Number(a.cancelled) * 2 + Number(a.completed)) - (Number(b.cancelled) * 2 + Number(b.completed)));
  }, [operations, search]);

  const shipMax = niceMax(Math.max(...months.map((month) => month.shipped + month.planned), 0));
  const currentMonth = months.find((month) => month.current);
  const phaseCounts = data?.phaseCounts ?? PHASE_NAMES.map((name) => ({ name, count: 0, blocked: 0 }));
  const phaseMax = Math.max(...phaseCounts.map((phase) => phase.count), 1);
  const containers = operations.filter((operation) => isExported(operation) && monthKey(operation.etd) && (range === 2 || monthKey(operation.etd) >= (range === 0 ? `${year}-01` : addMonths(monthKey(today), -11)))).reduce((sum, operation) => sum + operation.containers, 0);
  const totalVolume = series.reduce((sum, bucket) => sum + bucket.volume, 0);
  const totalUsd = series.reduce((sum, bucket) => sum + bucket.usd, 0);
  const periodLabel = yearly ? "no total" : "no período";
  const show = Boolean(data);

  return (
    <main className="et2-main">
      <div className="et2-head">
        <div>
          <h1>Painel</h1>
          <p>Embarques e pedidos em andamento</p>
        </div>
        <div className="db-actions">
          <div className="et2-seg" role="group" aria-label="Período">
            {RANGES.map((label, index) => <button key={label} aria-pressed={range === index} onClick={() => setRange(index as Range)}>{label}</button>)}
          </div>
          <a className="et2-btn et2-btn--primary" href="/novo-processo">+ Novo processo</a>
        </div>
      </div>

      {error && <div className="et2-alert et2-alert--bad" role="alert">Não foi possível carregar o painel: {error}</div>}

      <section className="db-hero" aria-label={`Exportado ${["em " + year, "nos últimos 12 meses", "desde o início"][range]}`}>
        <div><div className="db-hero-label">Exportado em US$</div><div className="db-hero-value">{show ? compact(totals.usd, "US$") : "–"}</div><div className="db-hero-sub">{plural(totals.count, "pedido embarcado", "pedidos embarcados")}{totals.unconverted ? ` · ${totals.unconverted} em outra moeda fora da soma` : ""}</div></div>
        <div><div className="db-hero-label">Em reais</div><div className="db-hero-value">{show ? (totals.brl ? compact(totals.brl, "R$") : "—") : "–"}</div><div className="db-hero-sub">{rate ? "pelo câmbio de cada processo" : "informe o câmbio nos custos logísticos"}</div></div>
        <div><div className="db-hero-label">Volume exportado</div><div className="db-hero-value">{show ? m3(totals.volume) : "–"}</div><div className="db-hero-sub">{containers ? `≈ ${plural(containers, "contêiner", "contêineres")}` : ["em " + year, "últimos 12 meses", "desde o início"][range]}</div></div>
        <div><div className="db-hero-label">Preço médio</div><div className="db-hero-value">{show && totals.volume ? `US$ ${Math.round(totals.usd / totals.volume).toLocaleString("pt-BR")}/m³` : "—"}</div><div className="db-hero-sub">valor ÷ volume</div></div>
      </section>

      <section className="et2-card db-card" aria-labelledby="vv">
        <div className="db-card-head">
          <div>
            <h2 id="vv">Volume e valor exportados</h2>
            <div className="et2-sub">{yearly ? "Comparação por ano · m³, US$ e preço médio" : "Mês a mês pela data de embarque · m³, US$ e preço médio"}</div>
          </div>
          <div className="et2-seg" role="group" aria-label="Agrupar por">
            <button aria-pressed={!yearly} onClick={() => setYearly(false)}>Mês a mês</button>
            <button aria-pressed={yearly} onClick={() => setYearly(true)}>Ano a ano</button>
          </div>
        </div>
        <div className="db-panels">
          <Panel title="Volume (m³)" total={`${m3(totalVolume)} ${periodLabel}`} color="#2a78d6" format={(value) => Math.round(value).toLocaleString("pt-BR")} bars={series.map((bucket) => ({ key: bucket.key, name: bucket.name, value: bucket.volume }))} />
          <Panel title="Valor (US$ mil)" total={`${compact(totalUsd, "US$")} ${periodLabel}`} color="#1baf7a" format={(value) => Math.round(value / 1000).toLocaleString("pt-BR")} bars={series.map((bucket) => ({ key: bucket.key, name: bucket.name, value: bucket.usd }))} />
          <Panel title="Preço médio (US$/m³)" total={totalVolume ? `média US$ ${Math.round(totalUsd / totalVolume).toLocaleString("pt-BR")}/m³` : "—"} color="#6250d6" format={(value) => Math.round(value).toLocaleString("pt-BR")} bars={series.map((bucket) => ({ key: bucket.key, name: bucket.name, value: bucket.price }))} />
        </div>
      </section>

      <section className="db-tiles" aria-label="Indicadores">
        <a className="db-tile" href="/pedidos"><span>Em andamento</span><b>{show ? active.length : "–"}</b><small>{compact(active.reduce((sum, operation) => sum + usdOf(operation), 0), "US$")} em carteira</small></a>
        <div className="db-tile"><span>A embarcar · 30 dias</span><b>{show ? next30.length : "–"}</b><small>{next30[0] ? `próximo: ${formatDate(next30[0].etd).slice(0, 5)} · ${next30[0].reference}` : "nenhum com ETD nos próximos 30 dias"}</small></div>
        <a className="db-tile" href="/pedidos?fase=4"><span>Em trânsito</span><b>{show ? inTransit.length : "–"}</b><small>a caminho do cliente</small></a>
        <div className="db-tile"><span>Concluídos em {year}</span><b>{show ? completedThisYear.length : "–"}</b><small>entregues ao cliente</small></div>
        <div className={`db-tile${blockedOps.length + lateOps.size ? " db-tile--bad" : ""}`}><span>Precisa de atenção</span><b>{show ? blockedOps.length + lateOps.size : "–"}</b><small>{plural(blockedOps.length, "bloqueado", "bloqueados")} · {plural(lateOps.size, "atrasado", "atrasados")}</small></div>
      </section>

      <div className="db-grid">
        <section className="et2-card db-card" aria-labelledby="emb">
          <div className="db-card-head">
            <div><h2 id="emb">Embarques por mês</h2><div className="et2-sub">Pedidos pela data de embarque (ETD)</div></div>
            <div className="db-legend"><span><i style={{ background: "#2a78d6" }} />Embarcados</span><span><i style={{ background: "#eb6834" }} />A embarcar</span></div>
          </div>
          <div className="db-stack">
            <div className="db-yaxis">{[4, 3, 2, 1, 0].map((step) => <span key={step}>{(shipMax * step) / 4 % 1 ? "" : (shipMax * step) / 4}</span>)}</div>
            <div className="db-stack-plot" role="img" aria-label={months.map((month) => `${month.name}: ${month.shipped} embarcados, ${month.planned} a embarcar`).join("; ")}>
              {months.map((month) => (
                <div key={month.key} className="db-stack-col" title={`${month.name}: ${plural(month.shipped, "embarcado", "embarcados")}, ${month.planned} a embarcar`}>
                  <span className="db-val">{month.shipped + month.planned || ""}</span>
                  {month.planned > 0 && <div className="db-bar" style={{ height: `${(month.planned / shipMax) * 198}px`, background: "#eb6834", marginBottom: month.shipped ? 2 : 0, borderRadius: "4px 4px 0 0" }} />}
                  {month.shipped > 0 && <div className="db-bar" style={{ height: `${(month.shipped / shipMax) * 198}px`, background: "#2a78d6", borderRadius: month.planned ? 0 : "4px 4px 0 0" }} />}
                  <span className={`db-month${month.current ? " db-month--now" : ""}`}>{month.name}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="db-foot">
            {currentMonth && `${MONTH_FULL[Number(currentMonth.key.slice(5)) - 1]}: ${plural(currentMonth.shipped, "embarcado", "embarcados")}, ${plural(currentMonth.planned, "programado", "programados")}`} · próximos 30 dias: {plural(next30.length, "embarque", "embarques")}{next30.length ? ` (${compact(next30.reduce((sum, operation) => sum + usdOf(operation), 0), "US$")})` : ""}
          </p>
        </section>

        <section className="et2-card db-card" aria-labelledby="fase">
          <h2 id="fase">Pedidos por fase</h2>
          <div className="et2-sub">Clique na fase para ver os pedidos</div>
          <div className="db-phases">
            {phaseCounts.map((phase, index) => (
              <a key={phase.name} href={`/pedidos?fase=${index}`} title={`${phase.name}: ${plural(phase.count, "pedido", "pedidos")}${phase.blocked ? ` · ${phase.blocked} bloqueado(s)` : ""}`}>
                <span>{index + 1} · {phase.name}</span>
                <span className="db-track"><span style={{ width: `${(phase.count / phaseMax) * 100}%`, background: PHASE_RAMP[index] }} /></span>
                <span className="mono">{show ? phase.count : "–"}</span>
              </a>
            ))}
          </div>
          <p className="db-foot" style={{ marginTop: 14 }}>{active.length} em andamento · {plural(operations.filter((operation) => operation.completed && !operation.cancelled).length, "concluído", "concluídos")} · {plural(operations.filter((operation) => operation.cancelled).length, "cancelado", "cancelados")}</p>
        </section>
      </div>

      <div className="db-grid">
        <section className="et2-card" aria-labelledby="prox">
          <div className="et2-card-head"><h2 id="prox">Próximos embarques</h2><a href="/pedidos" style={{ fontSize: 13 }}>Ver todos →</a></div>
          {upcoming.map((operation) => {
            const docs = operation.phaseSteps[3] ?? { total: 0, done: 0 };
            const days = daysUntil(operation.etd, today);
            const ready = docs.total > 0 && docs.done === docs.total;
            const badge = operation.blocked ? { label: "bloqueado", tone: "bad" } : days < 0 ? { label: `ETD passou há ${-days} d`, tone: "bad" } : ready ? { label: "pronto", tone: "ok" } : { label: days === 0 ? "hoje" : days === 1 ? "amanhã" : `em ${days} dias`, tone: "warn" };
            const month = Number(operation.etd.slice(5, 7)) - 1;
            return (
              <div key={operation.id} className="db-up">
                <div className="db-date"><span>{["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][month] ?? ""}</span><b className="mono">{operation.etd.slice(8, 10)}</b></div>
                <div style={{ minWidth: 0 }}>
                  <div><a className="mono" style={{ fontWeight: 500 }} href={processHref(operation.id)}>{operation.reference}</a> <span className="muted">· {operation.client || "—"}</span></div>
                  <div className="db-up-sub">{[operation.route || operation.country, operation.containers ? plural(operation.containers, "contêiner", "contêineres") : "", operation.value ? money(operation.value, operation.currency || "USD") : ""].filter(Boolean).join(" · ")}</div>
                  <div className="db-progress"><div style={{ width: `${docs.total ? Math.round((docs.done / docs.total) * 100) : 0}%`, background: ready ? "#0ca30c" : "#2a78d6" }} /></div>
                  <div className="db-up-docs">{docs.total ? `${docs.done} de ${docs.total} etapas de documentos concluídas` : "sem etapas de documentos"}</div>
                </div>
                <span className={`et2-badge et2-badge--${badge.tone}`}>{badge.label}</span>
              </div>
            );
          })}
          {show && !upcoming.length && <p className="et2-empty">Nenhum embarque com data prevista.</p>}
          {!show && !error && <p className="et2-empty">Carregando…</p>}
        </section>

        <div className="db-stackcol">
          <section className="et2-card" aria-labelledby="aten">
            <div className="et2-card-head"><h2 id="aten">Precisa de atenção</h2></div>
            {alerts.map((alert, index) => (
              <div key={`${alert.id}-${index}`} className="db-alert">
                <span className={`db-icon db-icon--${alert.tone}`} aria-hidden="true">{alert.tone === "info" ? "i" : "!"}</span>
                <div><a className="mono" style={{ fontWeight: 600 }} href={processHref(alert.id)}>{alert.ref}</a> — {alert.text}{alert.who && <div className="db-up-docs">{alert.who}</div>}</div>
              </div>
            ))}
            {show && !alerts.length && <p className="et2-empty">Nada bloqueado ou atrasado.</p>}
          </section>

          <section className="et2-card db-card" aria-labelledby="cart">
            <h2 id="cart">Valor a embarcar por cliente</h2>
            <div className="et2-sub">Pedidos ainda não embarcados · US$</div>
            <div className="db-clients">
              {clients.map(([name, value]) => (
                <div key={name} title={`${name}: ${money(value, "USD")}`}>
                  <span className="db-ellipsis">{name}</span>
                  <span className="db-track db-track--thin"><span style={{ width: `${(value / clientMax) * 100}%`, background: "#2a78d6" }} /></span>
                  <span className="mono" style={{ textAlign: "right" }}>{compact(value, "").trim()}</span>
                </div>
              ))}
              {show && !clients.length && <p className="et2-sub">Nenhum pedido a embarcar com valor.</p>}
            </div>
          </section>
        </div>
      </div>

      <details className="et2-card db-procs">
        <summary><h2 id="processos">Processos · negociação</h2> <span className="muted">· {processes.length}</span></summary>
        <div className="et2-card-head" style={{ flexWrap: "wrap", gap: 12 }}>
          <span className="et2-sub" style={{ margin: 0 }}>O que foi negociado em cada pedido. Clique no processo para abrir o acompanhamento do pedido.</span>
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
                <tr key={operation.id} className={operation.cancelled ? "pd-cancelled" : undefined}>
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
                  <td style={{ whiteSpace: "nowrap" }}><span className={`et2-badge et2-badge--${operation.cancelled ? "bad" : operation.completed || operation.phaseIndex === 5 ? "ok" : operation.phaseIndex === 0 ? "todo" : "warn"}`}>{operation.cancelled ? "Cancelado" : operation.completed ? "Concluída" : operation.phaseName}</span></td>
                  <td><a className="et2-btn et2-btn--sm" style={{ whiteSpace: "normal", textAlign: "center", lineHeight: 1.2, padding: "4px 6px", minHeight: 0, maxWidth: "100%", boxSizing: "border-box" }} href={`/novo-processo?processo=${operation.id}`} title="Editar a negociação deste processo">Editar</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !processes.length && <p className="et2-empty">{search ? "Nenhum processo encontrado." : "Nenhum processo cadastrado ainda."}</p>}
        </div>
      </details>
    </main>
  );
}

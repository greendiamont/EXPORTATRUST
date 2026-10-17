"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { addMonths, monthKey, monthLabel, rangeStart, type Range } from "../../lib/dashboard";
import { api, formatDate, money, processHref } from "./format";

// Financeiro (protótipo "7 · Financeiro", pedido por Ivam em 2026-10-17): comissões e margens de cada
// processo, emissão da comissão (invoice ou espelho de nota) e situação a faturar → faturado → recebido.

type Issuer = { id?: number; name: string; taxId: string; city: string; bank: string };
type FinanceDoc = { id: string; kind: "invoice" | "nfse"; number: string; date: string; payer: string; amount: number; currency: string };
type Process = {
  id: number; reference: string; client: string; etd: string; supplierName: string; exporterName: string; completed: boolean;
  mode: "comissao" | "margem"; sale: number; currency: string; volume: number; rate: number; percent: number; gain: number;
  gainUsd: number | null; gainBrl: number | null; payerRole: string; payerName: string; ready: boolean;
  finance: { status: "a_faturar" | "faturado" | "recebido"; receivedAt: string; documents: FinanceDoc[] };
};
type Snapshot = { processes: Process[]; issuers: Issuer[]; payerRoles: string[]; today: string; canWrite: boolean };

const RANGES = ["Este ano", "12 meses", "Tudo"];
const KINDS = ["Todos", "Comissão", "Margem"];
const STATUS = { a_faturar: { label: "A faturar", tone: "todo" }, faturado: { label: "Faturado", tone: "warn" }, recebido: { label: "Recebido", tone: "ok" } } as const;
const COLORS = { comissao: "#2a78d6", margem: "#1baf7a" };
const EMPTY_ISSUER: Issuer = { name: "", taxId: "", city: "", bank: "" };

const usd = (value: number) => money(Math.round(value), "USD");
function compact(value: number) {
  if (Math.abs(value) >= 1_000_000) return `US$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (Math.abs(value) >= 10_000) return `US$ ${Math.round(value / 1_000).toLocaleString("pt-BR")} mil`;
  return usd(value);
}
const pct = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export default function FinanceiroView() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState<Range>(0);
  const [kind, setKind] = useState(0);
  const [emitting, setEmitting] = useState<Process | null>(null);

  useEffect(() => {
    api<Snapshot>("/api/finance").then(setData).catch((reason: Error) => setError(reason.message));
  }, []);

  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const start = rangeStart(range, today);
  const all = useMemo(() => (data?.processes ?? []).filter((row) => row.ready && row.gain > 0), [data]);
  const inRange = all.filter((row) => !start || (monthKey(row.etd) && monthKey(row.etd) >= start));
  const rows = inRange.filter((row) => kind === 0 || (kind === 1 ? row.mode === "comissao" : row.mode === "margem"))
    .sort((a, b) => (b.etd || "").localeCompare(a.etd || ""));
  const missing = (data?.processes ?? []).filter((row) => !row.ready && !row.completed).length;

  const gainUsd = (row: Process) => row.gainUsd ?? 0;
  const sum = (list: Process[], pick: (row: Process) => number) => list.reduce((total, row) => total + pick(row), 0);
  const commissions = inRange.filter((row) => row.mode === "comissao");
  const margins = inRange.filter((row) => row.mode === "margem");
  const byStatus = (status: Process["finance"]["status"]) => sum(inRange.filter((row) => row.finance.status === status), gainUsd);
  const toInvoice = byStatus("a_faturar");
  const invoiced = byStatus("faturado");
  const received = byStatus("recebido");
  const unconverted = inRange.filter((row) => row.gainUsd === null).length;
  const weighted = (list: Process[]) => {
    const sale = sum(list, (row) => row.sale);
    return sale ? (sum(list, (row) => row.gain) / sale) * 100 : 0;
  };
  const perM3 = (list: Process[]) => {
    const volume = sum(list, (row) => row.volume);
    return volume ? sum(list, gainUsd) / volume : 0;
  };

  const current = monthKey(today);
  const months = Array.from({ length: 8 }, (_, index) => addMonths(current, index - 5)).map((key) => {
    const list = all.filter((row) => (row.etd || "").startsWith(key));
    return { key, name: monthLabel(key), current: key === current, comissao: sum(list.filter((row) => row.mode === "comissao"), gainUsd), margem: sum(list.filter((row) => row.mode === "margem"), gainUsd) };
  });
  const monthMax = Math.max(...months.map((month) => month.comissao + month.margem), 1);
  const stageMax = Math.max(toInvoice, invoiced, received, 1);
  const show = Boolean(data);

  async function post(body: Record<string, unknown>) {
    const result = await api<Snapshot>("/api/finance", { method: "POST", body: JSON.stringify(body) });
    setData(result);
    return result;
  }

  return (
    <main className="et2-main">
      <div className="et2-head">
        <div>
          <h1>Financeiro</h1>
          <p>Comissões e margens de cada processo · o que faturar e o que receber</p>
        </div>
        <div className="et2-seg" role="group" aria-label="Período">
          {RANGES.map((label, index) => <button key={label} aria-pressed={range === index} onClick={() => setRange(index as Range)}>{label}</button>)}
        </div>
      </div>

      {error && <div className="et2-alert et2-alert--bad" role="alert">{error}</div>}

      <section className="db-hero" aria-label="Resumo do financeiro">
        <div><div className="db-hero-label">Ganho previsto</div><div className="db-hero-value">{show ? compact(sum(inRange, gainUsd)) : "–"}</div><div className="db-hero-sub">{inRange.length === 1 ? "1 processo" : `${inRange.length} processos`}{unconverted ? ` · ${unconverted} sem câmbio fora da soma` : ""}</div></div>
        <div><div className="db-hero-label">Comissões</div><div className="db-hero-value">{show ? compact(sum(commissions, gainUsd)) : "–"}</div><div className="db-hero-sub">{commissions.length === 1 ? "1 processo comissionado" : `${commissions.length} processos comissionados`}</div></div>
        <div><div className="db-hero-label">Margens (VLP)</div><div className="db-hero-value">{show ? compact(sum(margins, gainUsd)) : "–"}</div><div className="db-hero-sub">{margins.length === 1 ? "1 processo" : `${margins.length} processos`} · cobradas da VLP</div></div>
        <div><div className="db-hero-label">A receber</div><div className="db-hero-value">{show ? compact(toInvoice + invoiced) : "–"}</div><div className="db-hero-sub">{compact(toInvoice)} ainda a faturar</div></div>
      </section>

      <div className="db-grid">
        <section className="et2-card db-card" aria-labelledby="fn-mes">
          <div className="db-card-head">
            <div><h2 id="fn-mes">Ganho por mês</h2><div className="et2-sub">Comissões e margens pela data de embarque · US$</div></div>
            <div className="db-legend"><span><i style={{ background: COLORS.comissao }} />Comissão</span><span><i style={{ background: COLORS.margem }} />Margem</span></div>
          </div>
          <div className="fn-plot" role="img" aria-label={months.map((month) => `${month.name}: comissão ${usd(month.comissao)}, margem ${usd(month.margem)}`).join("; ")}>
            {months.map((month) => (
              <div key={month.key} className="db-stack-col" title={`${month.name}: comissão ${usd(month.comissao)} · margem ${usd(month.margem)}`}>
                <span className="db-val">{month.comissao + month.margem ? (Math.round((month.comissao + month.margem) / 100) / 10).toLocaleString("pt-BR") + " mil" : ""}</span>
                {month.margem > 0 && <div className="db-bar" style={{ height: `${(month.margem / monthMax) * 160}px`, background: COLORS.margem, marginBottom: month.comissao ? 2 : 0, borderRadius: "4px 4px 0 0" }} />}
                {month.comissao > 0 && <div className="db-bar" style={{ height: `${(month.comissao / monthMax) * 160}px`, background: COLORS.comissao, borderRadius: month.margem ? 0 : "4px 4px 0 0" }} />}
                <span className={`db-month${month.current ? " db-month--now" : ""}`}>{month.name}</span>
              </div>
            ))}
          </div>
          <p className="db-foot">Próximos 30 dias: {compact(sum(all.filter((row) => row.etd && row.etd.slice(0, 10) >= today && row.etd.slice(0, 10) <= addDays(today, 30)), gainUsd))} em ganhos de processos a embarcar.</p>
        </section>

        <section className="et2-card db-card" aria-labelledby="fn-sit">
          <h2 id="fn-sit">Situação do faturamento</h2>
          <div className="et2-sub">Ganho dos processos por etapa · US$</div>
          <div className="db-clients" style={{ marginTop: 16, gap: 12 }}>
            {([["A faturar", toInvoice, "#eb6834"], ["Faturado", invoiced, "#2a78d6"], ["Recebido", received, "#0ca30c"]] as const).map(([name, value, color]) => (
              <div key={name} title={`${name}: ${usd(value)}`}>
                <span>{name}</span>
                <span className="db-track"><span style={{ width: `${(value / stageMax) * 100}%`, background: color }} /></span>
                <span className="mono" style={{ textAlign: "right" }}>{compact(value).replace("US$ ", "")}</span>
              </div>
            ))}
          </div>
          <div className="fn-avg">
            <div><span className="et2-sub" style={{ margin: 0 }}>Margem média</span><b className="mono">{margins.length ? pct(weighted(margins)) : "—"}</b><span className="et2-sub" style={{ margin: 0 }}>{margins.length ? `US$ ${perM3(margins).toFixed(0)}/m³` : ""}</span></div>
            <div><span className="et2-sub" style={{ margin: 0 }}>Comissão média</span><b className="mono">{commissions.length ? pct(weighted(commissions)) : "—"}</b><span className="et2-sub" style={{ margin: 0 }}>{commissions.length ? `US$ ${perM3(commissions).toFixed(0)}/m³` : ""}</span></div>
          </div>
        </section>
      </div>

      <section className="et2-card" aria-labelledby="fn-proc">
        <div className="et2-card-head">
          <div>
            <h2 id="fn-proc">Por processo</h2>
            <span className="et2-sub" style={{ margin: 0 }}>Comissão: cobrada do fornecedor, exportador ou importador. Margem (parceria VLP): a margem é cobrada da VLP como comissão.</span>
          </div>
          <div className="et2-seg" role="group" aria-label="Tipo">
            {KINDS.map((label, index) => <button key={label} aria-pressed={kind === index} onClick={() => setKind(index)}>{label}</button>)}
          </div>
        </div>
        <div className="et2-scroll">
          <table className="et2-table" style={{ minWidth: 1100, fontSize: 13 }}>
            <thead><tr><th>Processo</th><th>Cliente</th><th>Tipo</th><th className="num">Valor do pedido</th><th className="num">Ganho US$</th><th className="num">Ganho R$</th><th>Situação</th><th>Documentos</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const status = STATUS[row.finance.status];
                return (
                  <tr key={row.id}>
                    <td><a className="mono" style={{ fontWeight: 500 }} href={processHref(row.id)}>{row.reference}</a><span className="et2-sub">ETD {formatDate(row.etd)}</span></td>
                    <td>{row.client || "—"}</td>
                    <td><span className={`et2-badge et2-badge--${row.mode === "comissao" ? "new" : "ok"}`} style={{ fontSize: 12, padding: "2px 8px" }}>{row.mode === "comissao" ? "Comissão" : "Margem · VLP"}</span>
                      <span className="et2-sub">{pct(row.percent)} {row.mode === "comissao" ? `sobre o pedido · paga: ${row.payerRole.toLowerCase()}` : "· cobrada da VLP"}</span></td>
                    <td className="num mono">{money(row.sale, row.currency)}</td>
                    <td className="num mono" style={{ fontWeight: 600 }}>{row.gainUsd === null ? "informe o câmbio" : usd(row.gainUsd)}{row.volume > 0 && row.gainUsd !== null && <span className="et2-sub" style={{ fontWeight: 400 }}>US$ {(row.gainUsd / row.volume).toFixed(0)}/m³</span>}</td>
                    <td className="num mono">{row.gainBrl === null ? "—" : money(row.gainBrl, "BRL")}</td>
                    <td>
                      {data?.canWrite
                        ? <select className="et2-input fn-status" aria-label={`Situação de ${row.reference}`} value={row.finance.status} onChange={(event) => post({ action: "set-status", operationId: row.id, status: event.target.value }).catch((reason: Error) => setError(reason.message))}>
                            {Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
                          </select>
                        : <span className={`et2-badge et2-badge--${status.tone}`}>{status.label}</span>}
                      {row.finance.status === "recebido" && row.finance.receivedAt && <span className="et2-sub">em {formatDate(row.finance.receivedAt)}</span>}
                    </td>
                    <td>
                      <div className="fn-docs">
                        {row.finance.documents.map((doc) => <a key={doc.id} className="et2-btn et2-btn--sm" href={`/api/finance/document?operationId=${row.id}&doc=${doc.id}`} target="_blank" rel="noreferrer" title={`${doc.kind === "nfse" ? "Espelho da nota" : "Invoice"} · ${money(doc.amount, doc.currency)} · ${doc.payer}`}>{doc.number}</a>)}
                        {data?.canWrite && <button className={`et2-btn et2-btn--sm${row.finance.documents.length ? "" : " et2-btn--primary"}`} onClick={() => setEmitting(row)}>{row.finance.documents.length ? "+ Emitir outro" : row.mode === "comissao" ? "Emitir comissão" : "Emitir comissão VLP"}</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr className="fn-total">
                <td colSpan={3}>Total · {rows.length} processos</td>
                <td className="num mono">{compact(sum(rows, (row) => row.currency === "USD" ? row.sale : 0))}</td>
                <td className="num mono">{usd(sum(rows, gainUsd))}</td>
                <td className="num mono">{money(sum(rows, (row) => row.gainBrl ?? 0), "BRL")}</td>
                <td colSpan={2}><span className="et2-sub" style={{ margin: 0, fontWeight: 400 }}>pelo câmbio de cada processo</span></td>
              </tr></tfoot>
            )}
          </table>
          {show && !rows.length && <p className="et2-empty">Nenhum processo com comissão ou margem calculada neste período.</p>}
          {!show && !error && <p className="et2-empty">Carregando…</p>}
          {missing > 0 && <p className="et2-empty" style={{ textAlign: "left", padding: "10px 20px" }}>{missing} processo(s) ainda sem ganho calculado (falta percentual de comissão, preço de compra ou câmbio). Complete em Editar processo → Preços e margem.</p>}
        </div>
      </section>

      {emitting && data && (
        <EmitDialog process={emitting} issuers={data.issuers} payerRoles={data.payerRoles} today={today}
          onClose={() => setEmitting(null)}
          onSaveIssuer={(issuer) => post({ action: "save-issuer", issuer })}
          onEmit={async (body) => {
            const result = await post({ action: "emit", operationId: emitting.id, ...body });
            const updated = result.processes.find((row) => row.id === emitting.id);
            const doc = updated?.finance.documents.at(-1);
            if (doc) window.open(`/api/finance/document?operationId=${emitting.id}&doc=${doc.id}`, "_blank");
            setEmitting(null);
          }} />
      )}
    </main>
  );
}

function addDays(date: string, days: number) {
  const value = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function EmitDialog({ process, issuers, payerRoles, today, onClose, onSaveIssuer, onEmit }: {
  process: Process; issuers: Issuer[]; payerRoles: string[]; today: string;
  onClose: () => void; onSaveIssuer: (issuer: Issuer) => Promise<unknown>; onEmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const commission = process.mode === "comissao";
  const [nf, setNf] = useState(false);
  const [issuer, setIssuer] = useState<Issuer>(issuers.length === 1 ? issuers[0] : EMPTY_ISSUER);
  const [remember, setRemember] = useState(false);
  const [payerRole, setPayerRole] = useState(process.payerRole);
  const [payer, setPayer] = useState(process.payerName);
  const [rate, setRate] = useState(process.rate ? String(process.rate).replace(".", ",") : "");
  const [due, setDue] = useState(addDays(process.etd?.slice(0, 10) || today, 30));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rateNumber = Number(rate.replace(/\./g, "").replace(",", ".")) || 0;
  const baseAmount = nf ? (process.gainBrl ?? (process.currency === "USD" && rateNumber ? process.gain * rateNumber : 0)) : process.currency === "USD" ? process.gain : (process.gainUsd ?? 0);
  const [amount, setAmount] = useState("");
  const value = amount ? Number(amount.replace(/\./g, "").replace(",", ".")) || 0 : Math.round(baseAmount * 100) / 100;
  const currency = nf ? "BRL" : "USD";
  const volume = process.volume ? ` (${process.volume.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³)` : "";
  const defaultDescription = commission
    ? (nf ? `Comissão de ${pct(process.percent)} sobre a venda ${process.reference} — ${process.client}${volume}, ${money(process.sale, process.currency)}`
          : `Commission of ${process.percent.toLocaleString("en-US")}% on sale ${process.reference} — ${process.client}${volume}, ${process.currency} ${process.sale.toLocaleString("en-US", { minimumFractionDigits: 2 })}`)
    : (nf ? `Comissão sobre a operação ${process.reference} — ${process.client}${volume}` : `Commission on operation ${process.reference} — ${process.client}${volume}`);
  const [description, setDescription] = useState("");
  const finalDescription = description || defaultDescription;

  async function emit() {
    setBusy(true);
    setError("");
    try {
      if (remember && !issuers.some((item) => item.name === issuer.name && item.taxId === issuer.taxId)) await onSaveIssuer(issuer);
      await onEmit({ kind: nf ? "nfse" : "invoice", issuer, payerRole, payer, amount: value, currency, exchangeRate: rateNumber, description: finalDescription, dueDate: due });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao emitir.");
      setBusy(false);
    }
  }

  const field = (label: string, input: ReactNode, wide = false) => <label className={wide ? "fn-wide" : undefined}>{label}{input}</label>;
  return (
    <div className="cb-modal" role="dialog" aria-modal="true" aria-labelledby="fn-emit" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cb-dialog fn-dialog">
        <div className="cb-dialog-head">
          <div>
            <h2 id="fn-emit">{commission ? "Emitir comissão" : "Emitir comissão VLP"} · {process.reference}</h2>
            <div className="pd-sub">{commission ? `${pct(process.percent)} sobre o valor do pedido (${money(process.sale, process.currency)}).` : `Margem do processo (${pct(process.percent)}) cobrada da VLP como comissão. Ajuste o valor se combinarem diferente.`}</div>
          </div>
          <button type="button" className="cb-remove" aria-label="Fechar" onClick={onClose}>×</button>
        </div>
        <div className="fn-emit">
          <div className="fn-form">
            <div className="fn-wide fn-row"><b>Documento</b>
              <div className="et2-seg" role="group" aria-label="Documento">
                <button aria-pressed={!nf} onClick={() => { setNf(false); setAmount(""); setDescription(""); }}>Invoice (exterior)</button>
                <button aria-pressed={nf} onClick={() => { setNf(true); setAmount(""); setDescription(""); }}>Nota fiscal (Brasil)</button>
              </div>
            </div>
            <div className="fn-wide fn-section">Emitente · quem recebe a comissão</div>
            {issuers.length > 0 && field("Emitente salvo", <select className="pd-input" value={issuers.findIndex((item) => item.name === issuer.name && item.taxId === issuer.taxId)} onChange={(event) => setIssuer(issuers[Number(event.target.value)] ?? EMPTY_ISSUER)}>
              <option value={-1}>— preencher abaixo —</option>
              {issuers.map((item, index) => <option key={item.id ?? index} value={index}>{item.name} · {item.taxId}</option>)}
            </select>, true)}
            {field("Nome / razão social *", <input className="pd-input" value={issuer.name} onChange={(event) => setIssuer({ ...issuer, name: event.target.value })} placeholder="quem emite e recebe" />, true)}
            {field("CPF ou CNPJ *", <input className="pd-input" value={issuer.taxId} onChange={(event) => setIssuer({ ...issuer, taxId: event.target.value })} />)}
            {field("Cidade / país", <input className="pd-input" value={issuer.city} onChange={(event) => setIssuer({ ...issuer, city: event.target.value })} />)}
            {field("Dados bancários para receber", <textarea className="pd-input" rows={2} value={issuer.bank} onChange={(event) => setIssuer({ ...issuer, bank: event.target.value })} placeholder="banco, agência, conta / SWIFT, IBAN" />, true)}
            <label className="fn-wide fn-check"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Salvar como emitente para as próximas</label>
            <div className="fn-wide fn-section">Cobrar de</div>
            {field("Quem paga", <select className="pd-input" value={payerRole} onChange={(event) => {
              const role = event.target.value;
              setPayerRole(role);
              setPayer(role === "Fornecedor" ? process.supplierName : role === "Exportador" ? process.exporterName : role === "Importador" ? process.client : role === "Parceiro" ? "VLP" : "");
            }}>{payerRoles.map((role) => <option key={role}>{role}</option>)}</select>)}
            {field("Nome", <input className="pd-input" value={payer} onChange={(event) => setPayer(event.target.value)} />)}
            {field(`Valor (${currency === "BRL" ? "R$" : "US$"})`, <input className="pd-input mono" inputMode="decimal" value={amount || value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} onChange={(event) => setAmount(event.target.value)} />)}
            {nf ? field("Câmbio (R$ por US$)", <input className="pd-input mono" inputMode="decimal" value={rate} onChange={(event) => { setRate(event.target.value); setAmount(""); }} />) : field("Vencimento", <input className="pd-input" type="date" value={due} onChange={(event) => setDue(event.target.value)} />)}
            {nf && field("Vencimento", <input className="pd-input" type="date" value={due} onChange={(event) => setDue(event.target.value)} />)}
            {field("Descrição", <textarea className="pd-input" rows={3} value={finalDescription} onChange={(event) => setDescription(event.target.value)} />, true)}
            {nf && <div className="fn-wide cb-info">Espelho para conferência: a nota fiscal de serviço oficial é emitida e autorizada na prefeitura. Depois, anexe o PDF/XML autorizado ao pedido.</div>}
            {error && <div className="fn-wide cb-error" role="alert">{error}</div>}
          </div>
          <div className="fn-preview" aria-label="Prévia do documento">
            <div className="fn-preview-top">
              <div><b>{issuer.name || "Emitente (preencher)"}</b><div className="pd-sub">{issuer.name ? [issuer.taxId, issuer.city].filter(Boolean).join(" · ") : "nome, CPF/CNPJ e dados bancários de quem recebe"}</div></div>
              <div style={{ textAlign: "right" }}><b>{nf ? "NFS-e · ESPELHO" : "COMMISSION INVOICE"}</b><div className="pd-sub">número ao emitir · {formatDate(today)}</div></div>
            </div>
            <div className="fn-preview-to"><span className="pd-sub">{nf ? "Tomador" : "Bill to"}:</span> <b>{payer || "—"}</b> <span className="pd-sub">({payerRole})</span><div className="pd-sub">{process.reference} · {process.client}</div></div>
            <table><tbody><tr><td>{finalDescription}</td><td className="num mono">{money(value, currency)}</td></tr></tbody>
              <tfoot><tr><td>Total</td><td className="num mono">{money(value, currency)}</td></tr></tfoot></table>
            {issuer.bank && <div className="pd-sub" style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{issuer.bank}</div>}
          </div>
        </div>
        <div className="cb-dialog-foot">
          <button type="button" className="pd-btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="pd-btn pd-btn--dark" disabled={busy || !issuer.name.trim() || !issuer.taxId.trim() || !payer.trim() || !(value > 0)} onClick={emit}>{busy ? "Emitindo…" : nf ? "Salvar espelho da nota" : "Emitir invoice"}</button>
        </div>
      </div>
    </div>
  );
}

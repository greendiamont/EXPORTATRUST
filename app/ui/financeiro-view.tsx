"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { addMonths, monthKey, monthLabel, rangeStart, type Range } from "../../lib/dashboard";
import { api, formatDate, money, processHref } from "./format";

// Financeiro (protótipo "7 · Financeiro", pedido por Ivam em 2026-10-17): comissões e margens de cada
// processo, emissão da comissão (invoice ou espelho de nota) e situação a faturar → faturado → recebido.

type Issuer = {
  id?: number; name: string; taxId: string; address: string; city: string; email: string; phone: string;
  beneficiary: string; swift: string; account: string; bankName: string; bankAddress: string; bank: string;
};
type Payer = { id?: number; name: string; address: string; taxId: string; registration: string; email: string };
type FinanceDoc = { id: string; kind: "invoice" | "nfse"; number: string; date: string; payer: string; amount: number; currency: string };
type Process = {
  id: number; reference: string; client: string; etd: string; supplierName: string; exporterName: string; completed: boolean;
  mode: "comissao" | "margem"; sale: number; currency: string; volume: number; rate: number; percent: number; gain: number;
  gainUsd: number | null; gainBrl: number | null; payerRole: string; payerName: string; ready: boolean;
  finance: { status: "a_faturar" | "faturado" | "recebido"; receivedAt: string; documents: FinanceDoc[] };
};
type Snapshot = { processes: Process[]; issuers: Issuer[]; payers: Payer[]; nextNumbers: { invoice: string; nfse: string }; payerRoles: string[]; today: string; canWrite: boolean };

const RANGES = ["Este ano", "12 meses", "Tudo"];
const KINDS = ["Todos", "Comissão", "Margem"];
const STATUS = { a_faturar: { label: "A faturar", tone: "todo" }, faturado: { label: "Faturado", tone: "warn" }, recebido: { label: "Recebido", tone: "ok" } } as const;
const COLORS = { comissao: "#2a78d6", margem: "#1baf7a" };
const EMPTY_ISSUER: Issuer = { name: "", taxId: "", address: "", city: "", email: "", phone: "", beneficiary: "", swift: "", account: "", bankName: "", bankAddress: "", bank: "" };
const EMPTY_PAYER: Payer = { name: "", address: "", taxId: "", registration: "", email: "" };

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
  const [emitting, setEmitting] = useState<Process[] | null>(null);
  // Vários processos na mesma invoice (como a 001/2026: PO0639 e PO0657).
  const [selected, setSelected] = useState<number[]>([]);

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
          <div className="db-actions">
            {data?.canWrite && selected.length > 0 && <button className="et2-btn et2-btn--primary" onClick={() => setEmitting(all.filter((row) => selected.includes(row.id)))}>Emitir uma invoice para {selected.length === 1 ? "1 processo" : `${selected.length} processos`}</button>}
            <div className="et2-seg" role="group" aria-label="Tipo">
              {KINDS.map((label, index) => <button key={label} aria-pressed={kind === index} onClick={() => setKind(index)}>{label}</button>)}
            </div>
          </div>
        </div>
        <div className="et2-scroll">
          <table className="et2-table" style={{ minWidth: 1100, fontSize: 13 }}>
            <thead><tr>{data?.canWrite && <th style={{ width: 36 }}><span className="sr-only">Selecionar</span></th>}<th>Processo</th><th>Cliente</th><th>Tipo</th><th className="num">Valor do pedido</th><th className="num">Ganho US$</th><th className="num">Ganho R$</th><th>Situação</th><th>Documentos</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const status = STATUS[row.finance.status];
                return (
                  <tr key={row.id}>
                    {data?.canWrite && <td><input type="checkbox" aria-label={`Incluir ${row.reference} na mesma invoice`} checked={selected.includes(row.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} /></td>}
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
                        {data?.canWrite && <button className={`et2-btn et2-btn--sm${row.finance.documents.length ? "" : " et2-btn--primary"}`} onClick={() => setEmitting([row])}>{row.finance.documents.length ? "+ Emitir outro" : row.mode === "comissao" ? "Emitir comissão" : "Emitir comissão VLP"}</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr className="fn-total">
                <td colSpan={data?.canWrite ? 4 : 3}>Total · {rows.length} processos</td>
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
        <EmitDialog processes={emitting} issuers={data.issuers} payers={data.payers} nextNumbers={data.nextNumbers} payerRoles={data.payerRoles} today={today}
          onClose={() => setEmitting(null)}
          onSave={(body) => post(body)}
          onEmit={async (body) => {
            const result = await post({ action: "emit", ...body }) as Snapshot & { issued?: { id: string; operationId: number } };
            if (result.issued) window.open(`/api/finance/document?operationId=${result.issued.operationId}&doc=${result.issued.id}`, "_blank");
            setEmitting(null);
            setSelected([]);
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

function EmitDialog({ processes, issuers, payers, nextNumbers, payerRoles, today, onClose, onSave, onEmit }: {
  processes: Process[]; issuers: Issuer[]; payers: Payer[]; nextNumbers: { invoice: string; nfse: string }; payerRoles: string[]; today: string;
  onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<unknown>; onEmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const first = processes[0];
  const commission = processes.every((row) => row.mode === "comissao");
  const references = processes.map((row) => row.reference);
  const refText = references.length > 2 ? references.join(", ") : references.join(" and ");
  const totalVolume = Math.round(processes.reduce((total, row) => total + row.volume, 0) * 10000) / 10000;
  const [nf, setNf] = useState(false);
  const [perM3, setPerM3] = useState(!commission);
  const [issuer, setIssuer] = useState<Issuer>(issuers.length === 1 ? { ...EMPTY_ISSUER, ...issuers[0] } : EMPTY_ISSUER);
  const [rememberIssuer, setRememberIssuer] = useState(false);
  const [payerRole, setPayerRole] = useState(first.payerRole);
  const savedPayer = payers.find((item) => item.name.toLowerCase() === first.payerName.toLowerCase());
  const [payer, setPayer] = useState<Payer>(savedPayer ? { ...EMPTY_PAYER, ...savedPayer } : { ...EMPTY_PAYER, name: first.payerName });
  const [rememberPayer, setRememberPayer] = useState(false);
  const [number, setNumber] = useState(nextNumbers.invoice);
  const [date, setDate] = useState(today);
  const [due, setDue] = useState("");
  const [rateText, setRateText] = useState("");
  const [fx, setFx] = useState(first.rate ? String(first.rate).replace(".", ",") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parse = (value: string) => Number(value.replace(/\./g, "").replace(",", ".")) || 0;
  const fxNumber = parse(fx);
  const toUsd = (row: Process) => row.currency === "USD" ? row.gain : (row.gainUsd ?? 0);
  // Parte de cada processo: por m³ = volume × valor; senão, o ganho calculado (comissão % ou margem).
  const rate = parse(rateText);
  const shares = processes.map((row) => {
    const usd = perM3 ? row.volume * rate : toUsd(row);
    return { operationId: row.id, volume: row.volume, amount: Math.round((nf ? usd * (fxNumber || row.rate || 0) : usd) * 100) / 100 };
  });
  const computed = Math.round(shares.reduce((total, share) => total + share.amount, 0) * 100) / 100;
  const [amountText, setAmountText] = useState("");
  const amount = amountText ? parse(amountText) : computed;
  const currency = nf ? "BRL" : "USD";
  const percent = commission && processes.length === 1 ? first.percent : 0;
  const defaultDescription = nf
    ? `Serviço de intermediação comercial — embarques ${references.join(", ")}`
    : commission
      ? `Commercial service fee related to ${first.client || "the"} shipments - references ${refText}`
      : `Commercial service fee related to shipments - references ${refText}`;
  const [description, setDescription] = useState("");
  const finalDescription = description || defaultDescription;
  const defaultNotes = perM3 && !nf && rate ? `Charge calculated at USD ${rate.toFixed(2)} per m³ over a total shipped volume of ${totalVolume.toLocaleString("en-US", { maximumFractionDigits: 4 })} m³. References: ${refText}.` : "";
  const [notes, setNotes] = useState("");
  const finalNotes = notes || defaultNotes;
  // Partes proporcionais ao valor final quando ele é ajustado à mão.
  const scaled = shares.map((share) => ({ ...share, amount: computed ? Math.round(share.amount * (amount / computed) * 100) / 100 : Math.round((amount / shares.length) * 100) / 100 }));

  async function emit() {
    setBusy(true);
    setError("");
    try {
      if (rememberIssuer) await onSave({ action: "save-issuer", issuer });
      if (rememberPayer) await onSave({ action: "save-payer", payer });
      await onEmit({
        kind: nf ? "nfse" : "invoice", number, date, issuer, payerRole, payer: payer.name, payerDetails: payer, amount, currency, shares: scaled,
        basis: perM3 ? "per_m3" : "percent", rate: perM3 ? rate : percent, volume: totalVolume, exchangeRate: fxNumber,
        description: finalDescription, notes: finalNotes, dueDate: due,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao emitir.");
      setBusy(false);
    }
  }

  const field = (label: string, input: ReactNode, wide = false) => <label className={wide ? "fn-wide" : undefined}>{label}{input}</label>;
  const issuerInput = (key: Exclude<keyof Issuer, "id">, props: Record<string, unknown> = {}) =>
    <input className="pd-input" value={issuer[key]} onChange={(event) => setIssuer({ ...issuer, [key]: event.target.value })} {...props} />;
  const payerInput = (key: Exclude<keyof Payer, "id">, props: Record<string, unknown> = {}) =>
    <input className="pd-input" value={payer[key]} onChange={(event) => setPayer({ ...payer, [key]: event.target.value })} {...props} />;
  const fmt = (value: number) => money(value, currency);
  return (
    <div className="cb-modal" role="dialog" aria-modal="true" aria-labelledby="fn-emit" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cb-dialog fn-dialog">
        <div className="cb-dialog-head">
          <div>
            <h2 id="fn-emit">{commission ? "Emitir comissão" : "Emitir comissão VLP"} · {references.join(", ")}</h2>
            <div className="pd-sub">{processes.length > 1 ? `Uma invoice para ${processes.length} processos (${totalVolume.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} m³). ` : ""}{perM3 ? "Valor por m³ embarcado." : commission ? `${pct(first.percent)} sobre o valor do pedido.` : "Margem do processo cobrada da VLP como comissão."}</div>
          </div>
          <button type="button" className="cb-remove" aria-label="Fechar" onClick={onClose}>×</button>
        </div>
        <div className="fn-emit">
          <div className="fn-form">
            <div className="fn-wide fn-row"><b>Documento</b>
              <div className="et2-seg" role="group" aria-label="Documento">
                <button aria-pressed={!nf} onClick={() => { setNf(false); setAmountText(""); setDescription(""); setNumber(nextNumbers.invoice); }}>Invoice (exterior)</button>
                <button aria-pressed={nf} onClick={() => { setNf(true); setAmountText(""); setDescription(""); setNumber(nextNumbers.nfse); }}>Nota fiscal (Brasil)</button>
              </div>
            </div>
            {field("Número", <input className="pd-input mono" value={number} onChange={(event) => setNumber(event.target.value)} />)}
            {field("Data", <input className="pd-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />)}
            <div className="fn-wide fn-row"><b>Cobrança</b>
              <div className="et2-seg" role="group" aria-label="Base da cobrança">
                <button aria-pressed={perM3} onClick={() => { setPerM3(true); setAmountText(""); }}>US$ por m³</button>
                <button aria-pressed={!perM3} onClick={() => { setPerM3(false); setAmountText(""); }}>{commission ? "% do pedido" : "Margem do processo"}</button>
              </div>
            </div>
            {perM3 && field("Valor por m³ (US$)", <input className="pd-input mono" inputMode="decimal" value={rateText} placeholder="ex.: 3,00" onChange={(event) => { setRateText(event.target.value); setAmountText(""); }} />)}
            {perM3 && field("Volume embarcado (m³)", <input className="pd-input mono" readOnly value={totalVolume.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} />)}
            {nf && field("Câmbio (R$ por US$)", <input className="pd-input mono" inputMode="decimal" value={fx} onChange={(event) => { setFx(event.target.value); setAmountText(""); }} />)}
            {field(`Valor total (${nf ? "R$" : "US$"})`, <input className="pd-input mono" inputMode="decimal" value={amountText || amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} onChange={(event) => setAmountText(event.target.value)} />)}
            {field("Vencimento (opcional)", <input className="pd-input" type="date" value={due} onChange={(event) => setDue(event.target.value)} />)}

            <div className="fn-wide fn-section">Emitente (issuer) · quem recebe</div>
            {issuers.length > 0 && field("Emitente salvo", <select className="pd-input" value={issuers.findIndex((item) => item.name === issuer.name && item.taxId === issuer.taxId)} onChange={(event) => setIssuer({ ...EMPTY_ISSUER, ...(issuers[Number(event.target.value)] ?? {}) })}>
              <option value={-1}>— preencher abaixo —</option>
              {issuers.map((item, index) => <option key={item.id ?? index} value={index}>{item.name} · {item.taxId}</option>)}
            </select>, true)}
            {field("Nome / razão social *", issuerInput("name"), true)}
            {field("CPF ou CNPJ *", issuerInput("taxId"))}
            {field("Telefone", issuerInput("phone"))}
            {field("Endereço", issuerInput("address", { placeholder: "rua, número, complemento" }), true)}
            {field("CEP · cidade · estado · país", issuerInput("city"))}
            {field("E-mail", issuerInput("email", { type: "email" }))}
            <div className="fn-wide fn-section">Dados bancários (bank details)</div>
            {field("Beneficiário", issuerInput("beneficiary"))}
            {field("SWIFT / BIC", issuerInput("swift"))}
            {field("Conta (account number / IBAN)", issuerInput("account"))}
            {field("Banco", issuerInput("bankName"))}
            {field("Endereço do banco", issuerInput("bankAddress"), true)}
            <label className="fn-wide fn-check"><input type="checkbox" checked={rememberIssuer} onChange={(event) => setRememberIssuer(event.target.checked)} /> Salvar este emitente para as próximas</label>

            <div className="fn-wide fn-section">Cobrar de (bill to)</div>
            {payers.length > 0 && field("Pagador salvo", <select className="pd-input" value={payers.findIndex((item) => item.name === payer.name)} onChange={(event) => setPayer({ ...EMPTY_PAYER, ...(payers[Number(event.target.value)] ?? {}) })}>
              <option value={-1}>— preencher abaixo —</option>
              {payers.map((item, index) => <option key={item.id ?? index} value={index}>{item.name}</option>)}
            </select>, true)}
            {field("Quem paga", <select className="pd-input" value={payerRole} onChange={(event) => {
              const role = event.target.value;
              setPayerRole(role);
              const name = role === "Fornecedor" ? first.supplierName : role === "Exportador" ? first.exporterName : role === "Importador" ? first.client : role === "Parceiro" ? "VLP" : "";
              setPayer({ ...EMPTY_PAYER, ...(payers.find((item) => item.name.toLowerCase() === name.toLowerCase()) ?? { name }) });
            }}>{payerRoles.map((role) => <option key={role}>{role}</option>)}</select>)}
            {field("Nome *", payerInput("name"))}
            {field("Endereço", payerInput("address", { placeholder: "rua, CEP, cidade, país" }), true)}
            {field("VAT / CNPJ", payerInput("taxId", { placeholder: "VAT: NL..." }))}
            {field("Registro (ex.: KVK)", payerInput("registration", { placeholder: "KVK: ..." }))}
            {field("E-mail", payerInput("email", { type: "email" }), true)}
            <label className="fn-wide fn-check"><input type="checkbox" checked={rememberPayer} onChange={(event) => setRememberPayer(event.target.checked)} /> Salvar este pagador para as próximas</label>

            {field("Descrição", <textarea className="pd-input" rows={3} value={finalDescription} onChange={(event) => setDescription(event.target.value)} />, true)}
            {field("Observações (notes)", <textarea className="pd-input" rows={2} value={finalNotes} onChange={(event) => setNotes(event.target.value)} />, true)}
            {nf && <div className="fn-wide cb-info">Espelho para conferência: a nota fiscal de serviço oficial é emitida e autorizada na prefeitura. Depois, anexe o PDF/XML autorizado ao pedido.</div>}
            {error && <div className="fn-wide cb-error" role="alert">{error}</div>}
          </div>
          <div className="fn-preview" aria-label="Prévia do documento">
            <div className="fn-preview-title">{nf ? "NOTA FISCAL · ESPELHO" : "INVOICE"}</div>
            <div className="fn-preview-meta"><span>{nf ? "Número" : "Invoice No."}</span><b className="mono">{number}</b><span>{nf ? "Data" : "Date"}</span><b>{formatDate(date)}</b><span>{nf ? "Moeda" : "Currency"}</span><b>{currency}</b></div>
            <div className="fn-preview-parties">
              <div><span>{nf ? "PRESTADOR" : "ISSUER"}</span><b>{issuer.name || "—"}</b><div>{[issuer.address, issuer.city, issuer.taxId && `${issuer.taxId.replace(/\D/g, "").length === 11 ? "CPF" : "CNPJ"}: ${issuer.taxId}`, issuer.email, issuer.phone].filter(Boolean).join(" · ")}</div></div>
              <div><span>{nf ? "TOMADOR" : "BILL TO"}</span><b>{payer.name || "—"}</b><div>{[payer.address, payer.taxId, payer.registration, payer.email].filter(Boolean).join(" · ")}</div></div>
            </div>
            <table>
              <thead><tr><th>{nf ? "Descrição" : "Description"}</th><th className="num">m³</th><th className="num">{nf ? "Base" : "Rate"}</th><th className="num">{nf ? "Valor" : "Amount"}</th></tr></thead>
              <tbody><tr><td>{finalDescription}</td><td className="num mono">{totalVolume ? totalVolume.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : ""}</td><td className="num mono">{perM3 ? `US$ ${rate.toFixed(2)}` : percent ? pct(percent) : ""}</td><td className="num mono">{fmt(amount)}</td></tr></tbody>
              <tfoot><tr><td colSpan={3}>{nf ? "Total" : "TOTAL DUE"}</td><td className="num mono">{fmt(amount)}</td></tr></tfoot>
            </table>
            {processes.length > 1 && <div className="pd-sub" style={{ marginTop: 6 }}>Por processo: {scaled.map((share, index) => `${references[index]} ${fmt(share.amount)}`).join(" · ")}</div>}
            {(issuer.beneficiary || issuer.swift || issuer.account) && <div className="pd-sub" style={{ marginTop: 10 }}>{[issuer.beneficiary, issuer.swift && `SWIFT ${issuer.swift}`, issuer.account && `Conta ${issuer.account}`, issuer.bankName].filter(Boolean).join(" · ")}</div>}
            {finalNotes && <div className="pd-sub" style={{ marginTop: 8 }}>{finalNotes}</div>}
          </div>
        </div>
        <div className="cb-dialog-foot">
          <button type="button" className="pd-btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="pd-btn pd-btn--dark" disabled={busy || !issuer.name.trim() || !issuer.taxId.trim() || !payer.name.trim() || !(amount > 0) || !number.trim()} onClick={emit}>{busy ? "Emitindo…" : nf ? "Salvar espelho da nota" : "Emitir invoice"}</button>
        </div>
      </div>
    </div>
  );
}

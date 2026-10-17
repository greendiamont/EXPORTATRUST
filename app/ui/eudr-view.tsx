"use client";

import { useEffect, useMemo, useState } from "react";
import { api, formatDate, processHref } from "./format";

// EUDR · rastreabilidade (protótipo "4b · EUDR rastreabilidade", aprovado por Ivam em 2026-10-17).
// Pedidos para a UE em 5 etapas (origem, legalidade, transformação, exportação, pacote) e florestas
// cadastradas uma vez, com documentos (validade) e verificações. Contas e regras: lib/eudr.ts.

type DocStatus = "ok" | "pendente" | "nao_se_aplica";
type DocRecord = { status: DocStatus; validUntil: string; documentId: number | null; note: string };
type DocDefinition = { key: string; label: string; who: string; optional?: boolean; validity?: boolean };
type Check = { done: boolean; at: string; by: string; note: string };
type ForestEudr = { originType: "Plantio" | "Nativa"; producer: string; relation: "propria" | "terceiro"; species: string; scientificName: string; docs: Record<string, DocRecord>; checks: Record<string, Check> };
type Forest = {
  carCode: string; name: string; areaHa: number; city: string; supplier: string; registryStatus: string; geometryKind: string; usedIn: string[]; eudr: ForestEudr;
  status: { docsDone: number; docsTotal: number; checksDone: number; checksTotal: number; expiring: number; hasGeometry: boolean; identity: boolean; ok: boolean };
};
type Origin = { carCode: string; harvestFrom: string; harvestTo: string; inputQuantity: number; invoices: string };
type OrderEudr = { productKind: "serrado" | "pellets"; yieldPercent: number; origins: Origin[]; docs: Record<string, DocRecord>; packageGeneratedAt: string; sentAt: string; ddsVerification: string };
type Order = {
  id: number; reference: string; client: string; country: string; product: string; hsCode: string; etd: string; supplierName: string; exporterName: string;
  eori: string; eudrReference: string; netWeightKg: number; volumeM3: number; containers: string; portOfLoading: string; portOfDischarge: string; billOfLading: string;
  completed: boolean; eudr: OrderEudr; steps: Array<{ name: string; done: number; total: number }>; readiness: number; exported: number;
  balance: { input: number; possible: number; exported: number; margin: number; ok: boolean }; chainDocs: DocDefinition[];
};
type Snapshot = { orders: Order[]; forests: Forest[]; forestDocs: Record<"Plantio" | "Nativa", DocDefinition[]>; forestChecks: Array<{ key: string; label: string; source: string }>; today: string; canWrite: boolean };

const STATUS_LABEL: Record<DocStatus, string> = { ok: "Recebido", pendente: "Pendente", nao_se_aplica: "Não se aplica" };
const EMPTY_DOC: DocRecord = { status: "pendente", validUntil: "", documentId: null, note: "" };
const tone = (done: number, total: number) => done >= total ? "ok" : done ? "warn" : "bad";
const qty = (value: number, digits = 2) => value.toLocaleString("pt-BR", { maximumFractionDigits: digits });

function docTone(record: DocRecord | undefined, today: string) {
  if (!record || record.status === "pendente") return { label: "Pendente", tone: "todo" };
  if (record.status === "nao_se_aplica") return { label: "Não se aplica", tone: "todo" };
  if (record.validUntil && record.validUntil < today) return { label: `Vencido ${formatDate(record.validUntil)}`, tone: "bad" };
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  if (record.validUntil && record.validUntil <= soon.toISOString().slice(0, 10)) return { label: `Vence ${formatDate(record.validUntil)}`, tone: "warn" };
  return { label: "Recebido", tone: "ok" };
}

async function upload(url: string, fields: Record<string, string>, file: File) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => form.set(key, value));
  form.set("file", file);
  const response = await fetch(url, { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body.document as { id: number };
}

export default function EudrView() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"pedidos" | "florestas">("pedidos");
  const [orderId, setOrderId] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [card, setCard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Snapshot>("/api/eudr").then((snapshot) => {
      setData(snapshot);
      const wanted = Number(new URLSearchParams(window.location.search).get("pedido"));
      setOrderId(snapshot.orders.find((order) => order.id === wanted)?.id ?? snapshot.orders.find((order) => !order.completed)?.id ?? snapshot.orders[0]?.id ?? null);
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      setData(await api<Snapshot>("/api/eudr", { method: "POST", body: JSON.stringify(body) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  const order = data?.orders.find((item) => item.id === orderId) ?? null;
  const forestsByCar = useMemo(() => new Map((data?.forests ?? []).map((forest) => [forest.carCode, forest])), [data]);
  const saveOrder = (eudr: Partial<OrderEudr>, extra: Record<string, unknown> = {}) => order && post({ action: "save-order", operationId: order.id, eudr, ...extra });
  const canWrite = Boolean(data?.canWrite);
  const today = data?.today ?? new Date().toISOString().slice(0, 10);

  return (
    <main className="et2-main">
      <div className="et2-head">
        <div>
          <h1>EUDR · Rastreabilidade</h1>
          <p>Da floresta ao importador · Regulamento (UE) 2023/1115, alterado pelo 2025/2650 · vale a partir de 30/12/2026</p>
        </div>
        <div className="et2-seg" role="group" aria-label="Visão">
          <button aria-pressed={view === "pedidos"} onClick={() => setView("pedidos")}>Pedidos</button>
          <button aria-pressed={view === "florestas"} onClick={() => setView("florestas")}>Florestas</button>
        </div>
      </div>

      {error && <div className="et2-alert et2-alert--bad" role="alert">{error}</div>}
      {!data && !error && <p className="et2-empty">Carregando…</p>}

      {data && view === "pedidos" && (
        <div className="eu-layout">
          <aside className="et2-card eu-list" aria-labelledby="eu-pedidos">
            <div className="eu-list-head"><h2 id="eu-pedidos">Pedidos para a UE</h2><span className="et2-sub" style={{ margin: 0 }}>EUDR obrigatória: destino UE + produto de madeira</span></div>
            {data.orders.map((item) => (
              <button key={item.id} className="eu-list-item" aria-pressed={item.id === orderId} onClick={() => { setOrderId(item.id); setStep(0); }}>
                <span className="eu-row"><span className="mono" style={{ fontWeight: 500 }}>{item.reference}</span><span className={`et2-badge et2-badge--${item.readiness >= 100 ? "ok" : item.readiness >= 50 ? "warn" : "bad"}`}>{item.readiness}%</span></span>
                <span className="et2-sub" style={{ margin: 0 }}>{[item.product, item.country, item.etd ? `ETD ${formatDate(item.etd)}` : ""].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
            {!data.orders.length && <p className="et2-empty">Nenhum pedido para a UE com produto de madeira.</p>}
          </aside>

          {order && (
            <div className="eu-main">
              <section className="et2-card db-card" aria-label="Etapas">
                <div className="db-card-head">
                  <h2><a className="mono" href={processHref(order.id)}>{order.reference}</a> · {order.client || "—"}</h2>
                  <span className="et2-sub" style={{ margin: 0 }}>5 etapas · serrado, pellets e nativa</span>
                </div>
                <ol className="eu-steps">
                  {order.steps.map((item, index) => (
                    <li key={item.name}><button className={`eu-step eu-step--${tone(item.done, item.total)}`} aria-pressed={step === index} onClick={() => setStep(index)}>
                      <span className="et2-sub" style={{ margin: 0 }}>Etapa {index + 1}</span><b>{item.name}</b><span className="eu-step-count">{Math.min(item.done, item.total)} de {item.total}</span>
                    </button></li>
                  ))}
                </ol>
              </section>

              {step === 0 && <OriginStep order={order} forests={data.forests} forestsByCar={forestsByCar} canWrite={canWrite} busy={busy} onSave={saveOrder} onCard={setCard} />}
              {step === 1 && <LegalStep order={order} forestsByCar={forestsByCar} forestDocs={data.forestDocs} today={today} canWrite={canWrite} busy={busy} onSave={saveOrder} onCard={setCard} onError={setError} />}
              {step === 2 && <BalanceStep order={order} forestsByCar={forestsByCar} canWrite={canWrite} busy={busy} onSave={saveOrder} />}
              {step === 3 && <ExportStep order={order} canWrite={canWrite} busy={busy} onSave={saveOrder} />}
              {step === 4 && <PackageStep order={order} forestsByCar={forestsByCar} today={today} canWrite={canWrite} busy={busy} onSave={saveOrder} />}
            </div>
          )}
        </div>
      )}

      {data && view === "florestas" && <ForestList data={data} canWrite={canWrite} onCard={setCard} onReload={() => api<Snapshot>("/api/eudr").then(setData)} onError={setError} />}

      {data && card && forestsByCar.get(card) && (
        <ForestCard forest={forestsByCar.get(card)!} docs={data.forestDocs[forestsByCar.get(card)!.eudr.originType]} checks={data.forestChecks} today={today} canWrite={canWrite} busy={busy}
          onClose={() => setCard(null)} onSave={(eudr) => post({ action: "save-forest", carCode: card, eudr })} onIbama={() => post({ action: "check-ibama", carCode: card })} onError={setError} />
      )}
    </main>
  );
}

type SaveOrder = (eudr: Partial<OrderEudr>, extra?: Record<string, unknown>) => unknown;

function OriginStep({ order, forests, forestsByCar, canWrite, busy, onSave, onCard }: { order: Order; forests: Forest[]; forestsByCar: Map<string, Forest>; canWrite: boolean; busy: boolean; onSave: SaveOrder; onCard: (car: string) => void }) {
  const [origins, setOrigins] = useState(order.eudr.origins);
  const [pick, setPick] = useState("");
  useEffect(() => setOrigins(order.eudr.origins), [order]);
  const unit = order.eudr.productKind === "pellets" ? "t" : "m³";
  const dirty = JSON.stringify(origins) !== JSON.stringify(order.eudr.origins);
  const set = (index: number, change: Partial<Origin>) => setOrigins(origins.map((origin, i) => i === index ? { ...origin, ...change } : origin));
  const linked = origins.map((origin) => forestsByCar.get(origin.carCode)).filter(Boolean) as Forest[];
  return (
    <section className="et2-card">
      <div className="et2-card-head">
        <div><h3 className="eu-h3">1 · Origem — de quais florestas saiu a madeira</h3><span className="et2-sub" style={{ margin: 0 }}>Floresta própria do fornecedor ou de produtores rurais de quem ele compra. Cada floresta é cadastrada uma vez (aba Florestas) e reaproveitada.</span></div>
        {canWrite && <div className="db-actions">
          <select className="pd-input" style={{ width: 260 }} value={pick} onChange={(event) => setPick(event.target.value)} aria-label="Floresta para vincular">
            <option value="">Escolher floresta cadastrada…</option>
            {forests.filter((forest) => !origins.some((origin) => origin.carCode === forest.carCode)).map((forest) => <option key={forest.carCode} value={forest.carCode}>{forest.name} · {forest.eudr.producer || forest.supplier}</option>)}
          </select>
          <button className="et2-btn" disabled={!pick} onClick={() => { setOrigins([...origins, { carCode: pick, harvestFrom: "", harvestTo: "", inputQuantity: 0, invoices: "" }]); setPick(""); }}>+ Vincular floresta</button>
        </div>}
      </div>
      <div className="eu-stats">
        <div><span>Florestas</span><b>{origins.length}</b></div>
        <div><span>Geolocalização</span><b>{linked.filter((forest) => forest.geometryKind).length} de {origins.length}</b></div>
        <div className={linked.some((forest) => !forest.eudr.checks.desmatamento?.done) ? "eu-stat--warn" : undefined}><span>Sem desmatamento pós-2020</span><b>{linked.filter((forest) => forest.eudr.checks.desmatamento?.done).length} de {origins.length}</b></div>
        <div><span>Matéria-prima declarada</span><b>{qty(origins.reduce((sum, origin) => sum + (Number(origin.inputQuantity) || 0), 0))} {unit}</b></div>
      </div>
      <div className="et2-scroll">
        <table className="et2-table" style={{ minWidth: 1050, fontSize: 13 }}>
          <thead><tr><th>Floresta (CAR)</th><th>Produtor</th><th>Tipo · espécie</th><th>Colheita (de / até)</th><th className="num">Entrada ({unit})</th><th>NFs de entrada</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {origins.map((origin, index) => {
              const forest = forestsByCar.get(origin.carCode);
              return (
                <tr key={origin.carCode}>
                  <td><b>{forest?.name ?? "Floresta não cadastrada"}</b><span className="et2-sub mono">{origin.carCode}</span></td>
                  <td>{forest?.eudr.producer || "—"}<span className="et2-sub">{forest?.eudr.relation === "terceiro" ? "compra de terceiro" : "floresta do fornecedor"}</span></td>
                  <td><span className={`et2-badge et2-badge--${forest?.eudr.originType === "Nativa" ? "warn" : "ok"}`}>{forest?.eudr.originType ?? "—"}</span> {forest?.eudr.species}<span className="et2-sub"><i>{forest?.eudr.scientificName || "nome científico pendente"}</i></span></td>
                  <td><div className="eu-dates"><input className="pd-input" type="date" disabled={!canWrite} value={origin.harvestFrom} onChange={(event) => set(index, { harvestFrom: event.target.value })} aria-label="Colheita de" /><input className="pd-input" type="date" disabled={!canWrite} value={origin.harvestTo} onChange={(event) => set(index, { harvestTo: event.target.value })} aria-label="Colheita até" /></div></td>
                  <td className="num"><input className="pd-input mono" style={{ width: 100, textAlign: "right" }} inputMode="decimal" disabled={!canWrite} value={origin.inputQuantity ? String(origin.inputQuantity).replace(".", ",") : ""} onChange={(event) => set(index, { inputQuantity: Number(event.target.value.replace(/\./g, "").replace(",", ".")) || 0 })} aria-label="Quantidade de entrada" /></td>
                  <td><input className="pd-input" disabled={!canWrite} value={origin.invoices} placeholder="NF 1520, 1533" onChange={(event) => set(index, { invoices: event.target.value })} aria-label="NFs de entrada" /></td>
                  <td>{forest ? <span className={`et2-badge et2-badge--${forest.status.ok ? "ok" : "warn"}`}>{forest.status.ok ? "OK" : "Revisar"}</span> : <span className="et2-badge et2-badge--bad">Cadastrar</span>}
                    {forest && !forest.status.ok && <span className="et2-sub">{[!forest.geometryKind && "sem contorno", !forest.status.identity && "dados da floresta", forest.status.checksDone < forest.status.checksTotal && "verificações", forest.status.docsDone < forest.status.docsTotal && "documentos"].filter(Boolean).join(" · ")}</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{forest && <button className="et2-btn et2-btn--sm" onClick={() => onCard(forest.carCode)}>Ficha</button>} {canWrite && <button className="et2-btn et2-btn--sm" aria-label="Remover floresta do pedido" onClick={() => setOrigins(origins.filter((_, i) => i !== index))}>×</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!origins.length && <p className="et2-empty">Nenhuma floresta vinculada a este pedido. Escolha acima (ou cadastre na aba Florestas).</p>}
      </div>
      {canWrite && dirty && <div className="eu-save"><button className="et2-btn" onClick={() => setOrigins(order.eudr.origins)}>Desfazer</button><button className="et2-btn et2-btn--primary" disabled={busy} onClick={() => onSave({ origins })}>{busy ? "Salvando…" : "Salvar origens"}</button></div>}
    </section>
  );
}

function DocRow({ definition, record, today, canWrite, busy, onChange, onUpload, viewHref, compact }: {
  definition: DocDefinition; record: DocRecord | undefined; today: string; canWrite: boolean; busy: boolean; compact?: boolean;
  onChange: (record: DocRecord) => void; onUpload: (file: File) => void; viewHref: (id: number) => string;
}) {
  const current = record ?? EMPTY_DOC;
  const state = docTone(record, today);
  return (
    <tr>
      <td>{definition.label}{definition.optional && <span className="et2-sub">se houver</span>}</td>
      {!compact && <td className="et2-sub" style={{ margin: 0 }}>{definition.who}</td>}
      <td>{canWrite
        ? <select className={`pd-input eu-status eu-status--${state.tone}`} value={current.status} disabled={busy} onChange={(event) => onChange({ ...current, status: event.target.value as DocStatus })} aria-label={`Situação: ${definition.label}`}>
            {(Object.keys(STATUS_LABEL) as DocStatus[]).map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
          </select>
        : <span className={`et2-badge et2-badge--${state.tone}`}>{state.label}</span>}
        {canWrite && (state.tone === "warn" || state.tone === "bad") && <span className={`et2-badge et2-badge--${state.tone}`} style={{ display: "block", width: "fit-content", marginTop: 4 }}>{state.label}</span>}</td>
      <td>{definition.validity || current.validUntil
        ? <input className="pd-input" type="date" style={{ width: compact ? 136 : 150 }} disabled={!canWrite || busy} value={current.validUntil} onChange={(event) => onChange({ ...current, validUntil: event.target.value })} aria-label={`Validade: ${definition.label}`} />
        : <span className="et2-sub" style={{ margin: 0 }}>—</span>}</td>
      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
        {current.documentId && <a className="et2-btn et2-btn--sm" href={viewHref(current.documentId)} target="_blank" rel="noreferrer">Ver</a>}{" "}
        {canWrite && <label className="et2-btn et2-btn--sm" style={{ cursor: "pointer" }}>{current.documentId ? "Trocar" : "Anexar"}<input type="file" hidden disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ""; }} /></label>}
      </td>
    </tr>
  );
}

function LegalStep({ order, forestsByCar, forestDocs, today, canWrite, busy, onSave, onCard, onError }: {
  order: Order; forestsByCar: Map<string, Forest>; forestDocs: Snapshot["forestDocs"]; today: string; canWrite: boolean; busy: boolean; onSave: SaveOrder; onCard: (car: string) => void; onError: (message: string) => void;
}) {
  const forests = order.eudr.origins.map((origin) => forestsByCar.get(origin.carCode)).filter(Boolean) as Forest[];
  const saveDoc = (key: string, record: DocRecord) => onSave({ docs: { [key]: record } });
  async function attach(key: string, label: string, file: File) {
    try {
      const document = await upload("/api/documents", { operationId: String(order.id), category: `EUDR · ${label}` }, file);
      await onSave({ docs: { [key]: { ...(order.eudr.docs[key] ?? EMPTY_DOC), status: "ok", documentId: document.id } } });
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao anexar.");
    }
  }
  return (
    <section className="et2-card">
      <div className="et2-card-head"><div><h3 className="eu-h3">2 · Legalidade — documentos exigidos</h3><span className="et2-sub" style={{ margin: 0 }}>A lista muda pelo tipo de origem: plantio (pinus, eucalipto) ou nativa (manejo). Pedido com as duas vale as duas listas. Lista proposta: valide com consultor florestal ou despachante.</span></div></div>
      {forests.map((forest) => {
        const definitions = forestDocs[forest.eudr.originType];
        const done = definitions.filter((definition) => docTone(forest.eudr.docs[definition.key], today).tone === "ok" || forest.eudr.docs[definition.key]?.status === "nao_se_aplica").length;
        return (
          <div key={forest.carCode} className="eu-forest-docs">
            <span><b>{forest.name}</b> <span className={`et2-badge et2-badge--${forest.eudr.originType === "Nativa" ? "warn" : "ok"}`}>{forest.eudr.originType}</span> · documentos da floresta {done} de {definitions.length} · verificações {forest.status.checksDone} de {forest.status.checksTotal}</span>
            <button className="et2-btn et2-btn--sm" onClick={() => onCard(forest.carCode)}>Abrir ficha da floresta</button>
          </div>
        );
      })}
      <div className="et2-scroll">
        <table className="et2-table" style={{ minWidth: 900, fontSize: 13 }}>
          <thead><tr><th>Documento da cadeia</th><th>De quem</th><th>Situação</th><th>Validade</th><th></th></tr></thead>
          <tbody>
            {order.chainDocs.map((definition) => (
              <DocRow key={definition.key} definition={definition} record={order.eudr.docs[definition.key]} today={today} canWrite={canWrite} busy={busy}
                onChange={(record) => saveDoc(definition.key, record)} onUpload={(file) => attach(definition.key, definition.label, file)}
                viewHref={(id) => `/api/documents?documentId=${id}&inline=1`} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BalanceStep({ order, forestsByCar, canWrite, busy, onSave }: { order: Order; forestsByCar: Map<string, Forest>; canWrite: boolean; busy: boolean; onSave: SaveOrder }) {
  const [yieldText, setYieldText] = useState(order.eudr.yieldPercent ? String(order.eudr.yieldPercent).replace(".", ",") : "");
  useEffect(() => setYieldText(order.eudr.yieldPercent ? String(order.eudr.yieldPercent).replace(".", ",") : ""), [order]);
  const pellets = order.eudr.productKind === "pellets";
  const unit = pellets ? "t" : "m³";
  const yieldValue = Number(yieldText.replace(",", ".")) || 0;
  const { balance } = order;
  return (
    <section className="et2-card db-card">
      <div className="db-card-head">
        <div><h3 className="eu-h3">3 · Transformação — {pellets ? "balanço de massa da fábrica de pellets" : "balanço de volume da serraria"}</h3>
          <div className="et2-sub">{pellets ? "Matéria-prima (toras, cavaco, serragem) de cada origem × pellets exportados." : "Toras de cada floresta × madeira serrada exportada."} Prova que o exportado cabe nas origens declaradas.</div></div>
        {canWrite && <div className="et2-seg" role="group" aria-label="Produto">
          <button aria-pressed={!pellets} disabled={busy} onClick={() => onSave({ productKind: "serrado" })}>Serrado (m³)</button>
          <button aria-pressed={pellets} disabled={busy} onClick={() => onSave({ productKind: "pellets" })}>Pellets (t)</button>
        </div>}
      </div>
      <div className="eu-stats" style={{ padding: "14px 0 0" }}>
        <div><span>Matéria-prima das origens</span><b>{qty(balance.input)} {unit}</b></div>
        <div><span>Rendimento {pellets ? "da fábrica" : "da serraria"} (%)</span>
          {canWrite ? <span className="eu-inline"><input className="pd-input mono" inputMode="decimal" style={{ width: 90 }} value={yieldText} onChange={(event) => setYieldText(event.target.value)} aria-label="Rendimento" />{yieldValue !== order.eudr.yieldPercent && <button className="et2-btn et2-btn--sm et2-btn--primary" disabled={busy} onClick={() => onSave({ yieldPercent: yieldValue })}>Salvar</button>}</span> : <b>{qty(order.eudr.yieldPercent, 1)}%</b>}</div>
        <div><span>{pellets ? "Pellets possíveis" : "Serrado possível"}</span><b>{qty(balance.possible)} {unit}</b></div>
        <div className={balance.ok ? "eu-stat--ok" : "eu-stat--warn"}><span>Exportado neste pedido</span><b>{qty(balance.exported)} {unit}</b><span>{balance.exported ? (balance.ok ? `saldo ${qty(balance.margin)} ${unit} · OK` : "maior que o possível · revisar") : pellets ? "informe o peso líquido no pedido" : "informe o volume no pedido"}</span></div>
      </div>
      <table className="et2-table" style={{ marginTop: 14, fontSize: 13 }}>
        <thead><tr><th>Origem</th><th>NFs de entrada</th><th className="num">Entrada ({unit})</th><th className="num">{pellets ? "Pellets" : "Serrado"} possível ({unit})</th></tr></thead>
        <tbody>{order.eudr.origins.map((origin) => <tr key={origin.carCode}><td>{forestsByCar.get(origin.carCode)?.name ?? origin.carCode}</td><td className="mono" style={{ fontSize: 12 }}>{origin.invoices || "—"}</td><td className="num mono">{qty(origin.inputQuantity)}</td><td className="num mono">{qty(origin.inputQuantity * order.eudr.yieldPercent / 100)}</td></tr>)}</tbody>
      </table>
      <p className="et2-sub">A quantidade de entrada de cada floresta é informada na etapa 1 (Origem).</p>
    </section>
  );
}

function ExportStep({ order, canWrite, busy, onSave }: { order: Order; canWrite: boolean; busy: boolean; onSave: SaveOrder }) {
  const [eori, setEori] = useState(order.eori);
  useEffect(() => setEori(order.eori), [order]);
  const rows: Array<[string, string, boolean]> = [
    ["Produto e NCM", [order.product, order.hsCode].filter(Boolean).join(" · "), Boolean(order.product && order.hsCode)],
    ["Quantidade", [order.netWeightKg ? `${qty(order.netWeightKg, 0)} kg líquido` : "", order.volumeM3 ? `${qty(order.volumeM3, 3)} m³` : ""].filter(Boolean).join(" · "), order.exported > 0],
    ["Fornecedor", order.supplierName, Boolean(order.supplierName)],
    ["Cliente (operador na UE)", order.client, Boolean(order.client && order.eori)],
    ["Embarque previsto", order.etd ? formatDate(order.etd) : "", Boolean(order.etd)],
    ["Rota", [order.portOfLoading, order.portOfDischarge].filter(Boolean).join(" → "), true],
    ["Contêineres", order.containers, true],
    ["BL", order.billOfLading, true],
  ];
  return (
    <section className="et2-card">
      <div className="et2-card-head"><div><h3 className="eu-h3">4 · Exportação — produto, quantidade e embarque</h3><span className="et2-sub" style={{ margin: 0 }}>Vem do pedido; para corrigir, edite o pedido. Só o EORI do importador é informado aqui.</span></div><a className="et2-btn et2-btn--sm" href={processHref(order.id)}>Abrir pedido</a></div>
      <dl className="eu-dl">
        {rows.map(([label, value, ok]) => <div key={label}><dt>{label}</dt><dd>{value || <span className={ok ? "et2-sub" : "eu-missing"} style={{ margin: 0 }}>{ok ? "—" : "falta no pedido"}</span>}</dd></div>)}
        <div><dt>EORI do importador</dt><dd>{canWrite
          ? <span className="eu-inline"><input className="pd-input" value={eori} placeholder="ex.: DE123456789012345" onChange={(event) => setEori(event.target.value)} aria-label="EORI do importador" />{eori !== order.eori && <button className="et2-btn et2-btn--sm et2-btn--primary" disabled={busy} onClick={() => onSave({}, { eori })}>Salvar</button>}</span>
          : order.eori || "—"}</dd></div>
      </dl>
    </section>
  );
}

function PackageStep({ order, forestsByCar, today, canWrite, busy, onSave }: { order: Order; forestsByCar: Map<string, Forest>; today: string; canWrite: boolean; busy: boolean; onSave: SaveOrder }) {
  const [dds, setDds] = useState(order.eudrReference);
  const [verification, setVerification] = useState(order.eudr.ddsVerification);
  useEffect(() => { setDds(order.eudrReference); setVerification(order.eudr.ddsVerification); }, [order]);
  const forests = order.eudr.origins.map((origin) => forestsByCar.get(origin.carCode)).filter(Boolean) as Forest[];
  const all = forests.length > 0 && forests.length === order.eudr.origins.length;
  const items: Array<[string, boolean]> = [
    ["Descrição, NCM e quantidade (kg e m³)", Boolean(order.product && order.hsCode && order.exported > 0)],
    ["Espécie com nome científico", all && forests.every((forest) => forest.eudr.scientificName)],
    ["País de produção (Brasil)", true],
    ["Geolocalização de todas as áreas", all && forests.every((forest) => forest.geometryKind)],
    ["Data / período da colheita", order.eudr.origins.length > 0 && order.eudr.origins.every((origin) => origin.harvestFrom)],
    ["Fornecedor e cliente identificados", Boolean(order.supplierName && order.client)],
    ["Sem desmatamento após 31/12/2020", all && forests.every((forest) => forest.eudr.checks.desmatamento?.done)],
    ["Legalidade conforme a lei brasileira", order.steps[1].done >= order.steps[1].total],
    ["Balanço de volume / massa", order.balance.ok],
    ["Nº de referência da DDS (importador)", Boolean(order.eudrReference)],
  ];
  const pkg = `/api/eudr?operationId=${order.id}&package=`;
  return (
    <section className="et2-card">
      <div className="et2-card-head"><div><h3 className="eu-h3">5 · Pacote EUDR para o importador</h3><span className="et2-sub" style={{ margin: 0 }}>Quem registra a DDS no sistema da UE é o importador. Nós entregamos o pacote e guardamos o número da DDS no pedido.</span></div></div>
      <div className="eu-package">
        <div className="eu-box">
          <div className="eu-box-head">Informações exigidas na DDS (Art. 9 / Anexo II)</div>
          {items.map(([label, ok]) => <div key={label} className="eu-check"><span>{label}</span><span className={`et2-badge et2-badge--${ok ? "ok" : "todo"}`}>{ok ? "Pronto" : "Pendente"}</span></div>)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="eu-box" style={{ padding: "12px 14px" }}>
            <b>O pacote contém</b>
            <ul className="eu-ul"><li>Declaração EUDR do exportador (abre para salvar em PDF, em inglês)</li><li>Arquivo de geolocalização no formato da UE (GeoJSON, 6 casas decimais)</li><li>Verificações e documentos de cada floresta, e o balanço</li></ul>
            <div className="db-actions" style={{ marginTop: 10 }}>
              <a className="et2-btn et2-btn--primary" href={`${pkg}declaration`} target="_blank" rel="noreferrer">Abrir declaração (PDF)</a>
              <a className="et2-btn" href={`${pkg}geojson`}>Baixar GeoJSON</a>
            </div>
            {canWrite && <label className="eu-check-line"><input type="checkbox" checked={Boolean(order.eudr.sentAt)} disabled={busy} onChange={(event) => onSave({ sentAt: event.target.checked ? new Date().toISOString() : "" })} /> Pacote enviado ao importador{order.eudr.sentAt ? ` em ${formatDate(order.eudr.sentAt.slice(0, 10))}` : ""}</label>}
          </div>
          <div className="eu-box eu-dds">
            <label>Nº de referência da DDS<input className="pd-input" value={dds} disabled={!canWrite} placeholder="informado pelo importador" onChange={(event) => setDds(event.target.value)} /></label>
            <label>Nº de verificação<input className="pd-input" value={verification} disabled={!canWrite} placeholder="opcional" onChange={(event) => setVerification(event.target.value)} /></label>
            {canWrite && (dds !== order.eudrReference || verification !== order.eudr.ddsVerification) && <button className="et2-btn et2-btn--primary" disabled={busy} onClick={() => onSave({ ddsVerification: verification }, { ddsReference: dds })}>Salvar DDS</button>}
            <span className="et2-sub" style={{ margin: 0, gridColumn: "1 / -1" }}>Com o número da DDS registrado, a etapa fica verde e o número aparece no pedido.{today >= "2026-12-30" ? "" : " A EUDR passa a valer em 30/12/2026."}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function ForestList({ data, canWrite, onCard, onReload, onError }: { data: Snapshot; canWrite: boolean; onCard: (car: string) => void; onReload: () => Promise<unknown>; onError: (message: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [car, setCar] = useState("");
  const [producer, setProducer] = useState("");
  const [busy, setBusy] = useState(false);
  // Cadastro pela consulta pública do SICAR (mesma rota da versão anterior): o contorno vem do CAR.
  async function add() {
    setBusy(true);
    try {
      const found = await api<{ carCode: string; propertyName: string; municipality: string; state: string; areaHa: number; nativeAreaHa?: number; status: string; geometry: unknown }>("/api/sicar-lookup", { method: "POST", body: JSON.stringify({ carCode: car.trim() }) });
      await api("/api/properties", { method: "POST", body: JSON.stringify({ carCode: found.carCode, name: found.propertyName || `Imóvel CAR · ${found.municipality}`, city: `${found.municipality}/${found.state}`, supplier: producer.trim(), areaHa: found.areaHa, nativeAreaHa: found.nativeAreaHa ?? 0, geometry: found.geometry, status: found.status || "Em análise", sourceFile: "SICAR" }) });
      await api("/api/eudr", { method: "POST", body: JSON.stringify({ action: "save-forest", carCode: found.carCode, eudr: { producer: producer.trim() } }) });
      await onReload();
      setAdding(false);
      setCar("");
      setProducer("");
      onCard(found.carCode);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao cadastrar a floresta.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="et2-card">
      <div className="et2-card-head">
        <div><h2>Florestas cadastradas</h2><span className="et2-sub" style={{ margin: 0 }}>Cada floresta é cadastrada uma vez: verificações e documentos com validade. Amarelo = vence em 30 dias.</span></div>
        {canWrite && <button className="et2-btn et2-btn--primary" onClick={() => setAdding(!adding)}>+ Floresta (buscar CAR)</button>}
      </div>
      {adding && (
        <div className="eu-add">
          <label>Código do CAR<input className="pd-input mono" value={car} placeholder="SC-4205407-…" onChange={(event) => setCar(event.target.value)} /></label>
          <label>Produtor / dono da floresta<input className="pd-input" value={producer} onChange={(event) => setProducer(event.target.value)} /></label>
          <button className="et2-btn et2-btn--primary" disabled={busy || !car.trim() || !producer.trim()} onClick={add}>{busy ? "Buscando no SICAR…" : "Buscar e cadastrar"}</button>
        </div>
      )}
      <div className="et2-scroll">
        <table className="et2-table" style={{ minWidth: 960, fontSize: 13 }}>
          <thead><tr><th>Floresta</th><th>Produtor</th><th>Tipo</th><th className="num">Área (ha)</th><th>Verificações</th><th>Documentos</th><th>Usada em</th><th></th></tr></thead>
          <tbody>
            {data.forests.map((forest) => (
              <tr key={forest.carCode}>
                <td><b>{forest.name}</b><span className="et2-sub mono">{forest.carCode}</span></td>
                <td>{forest.eudr.producer || forest.supplier || "—"}</td>
                <td><span className={`et2-badge et2-badge--${forest.eudr.originType === "Nativa" ? "warn" : "ok"}`}>{forest.eudr.originType}</span></td>
                <td className="num mono">{qty(forest.areaHa)}</td>
                <td><span className={`et2-badge et2-badge--${tone(forest.status.checksDone, forest.status.checksTotal)}`}>{forest.status.checksDone} de {forest.status.checksTotal}</span></td>
                <td><span className={`et2-badge et2-badge--${forest.status.expiring ? "warn" : tone(forest.status.docsDone, forest.status.docsTotal)}`}>{forest.status.docsDone} de {forest.status.docsTotal}{forest.status.expiring ? " · vencendo" : ""}</span></td>
                <td className="et2-sub" style={{ margin: 0 }}>{forest.usedIn.join(", ") || "—"}</td>
                <td><button className="et2-btn et2-btn--sm" onClick={() => onCard(forest.carCode)}>Ficha</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.forests.length && <p className="et2-empty">Nenhuma floresta cadastrada.</p>}
      </div>
    </section>
  );
}

function ForestCard({ forest, docs, checks, today, canWrite, busy, onClose, onSave, onIbama, onError }: {
  forest: Forest; docs: DocDefinition[]; checks: Snapshot["forestChecks"]; today: string; canWrite: boolean; busy: boolean;
  onClose: () => void; onSave: (eudr: Partial<ForestEudr>) => Promise<unknown> | unknown; onIbama: () => unknown; onError: (message: string) => void;
}) {
  const [identity, setIdentity] = useState({ originType: forest.eudr.originType, producer: forest.eudr.producer, relation: forest.eudr.relation, species: forest.eudr.species, scientificName: forest.eudr.scientificName });
  useEffect(() => setIdentity({ originType: forest.eudr.originType, producer: forest.eudr.producer, relation: forest.eudr.relation, species: forest.eudr.species, scientificName: forest.eudr.scientificName }), [forest]);
  const dirty = JSON.stringify(identity) !== JSON.stringify({ originType: forest.eudr.originType, producer: forest.eudr.producer, relation: forest.eudr.relation, species: forest.eudr.species, scientificName: forest.eudr.scientificName });
  const [mapFailed, setMapFailed] = useState(false);
  async function attach(key: string, label: string, file: File) {
    try {
      const document = await upload("/api/forest-documents", { carCode: forest.carCode, category: label, source: "EUDR" }, file);
      await onSave({ docs: { [key]: { ...(forest.eudr.docs[key] ?? EMPTY_DOC), status: "ok", documentId: document.id } } });
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao anexar.");
    }
  }
  return (
    <div className="cb-modal" role="dialog" aria-modal="true" aria-labelledby="eu-ficha" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cb-dialog eu-card">
        <div className="cb-dialog-head">
          <div><h2 id="eu-ficha">Ficha da floresta · {forest.name}</h2><div className="pd-sub mono">{forest.carCode} · {forest.city} · {qty(forest.areaHa)} ha · CAR {forest.registryStatus}</div></div>
          <button type="button" className="cb-remove" aria-label="Fechar" onClick={onClose}>×</button>
        </div>
        <div className="eu-card-body">
          <div>
            {mapFailed
              ? <div className="eu-map-empty">Imagem de satélite indisponível agora.<br />Contorno: {forest.geometryKind || "não cadastrado"}</div>
              : <img className="eu-map" src={`/api/satellite-map?carCode=${encodeURIComponent(forest.carCode)}`} alt={`Imagem de satélite com o contorno de ${forest.name}`} onError={() => setMapFailed(true)} />}
            <div className="et2-sub">Contorno: {forest.geometryKind || "não cadastrado"} · {forest.areaHa > 4 ? "área acima de 4 ha: polígono exigido" : "até 4 ha: um ponto basta"}</div>
            <div className="eu-form">
              <label>Tipo de origem<select className="pd-input" disabled={!canWrite} value={identity.originType} onChange={(event) => setIdentity({ ...identity, originType: event.target.value as ForestEudr["originType"] })}><option>Plantio</option><option>Nativa</option></select></label>
              <label>Relação com o fornecedor<select className="pd-input" disabled={!canWrite} value={identity.relation} onChange={(event) => setIdentity({ ...identity, relation: event.target.value as ForestEudr["relation"] })}><option value="propria">Floresta do fornecedor</option><option value="terceiro">Compra de produtor rural</option></select></label>
              <label className="eu-wide">Produtor / dono da floresta<input className="pd-input" disabled={!canWrite} value={identity.producer} onChange={(event) => setIdentity({ ...identity, producer: event.target.value })} /></label>
              <label>Espécie<input className="pd-input" disabled={!canWrite} value={identity.species} placeholder="Pinus" onChange={(event) => setIdentity({ ...identity, species: event.target.value })} /></label>
              <label>Nome científico<input className="pd-input" disabled={!canWrite} value={identity.scientificName} placeholder="Pinus taeda" onChange={(event) => setIdentity({ ...identity, scientificName: event.target.value })} /></label>
              {canWrite && dirty && <button className="et2-btn et2-btn--primary eu-wide" disabled={busy} onClick={() => onSave(identity)}>Salvar dados da floresta</button>}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div className="eu-box">
              <div className="eu-box-head">Verificações</div>
              {checks.map((check) => {
                const item = forest.eudr.checks[check.key];
                return (
                  <div key={check.key} className="eu-check">
                    <label className="eu-check-line" style={{ margin: 0 }}><input type="checkbox" disabled={!canWrite || busy} checked={Boolean(item?.done)} onChange={(event) => onSave({ checks: { [check.key]: { ...(item ?? { at: "", by: "", note: "" }), done: event.target.checked } } as ForestEudr["checks"] })} />
                      <span>{check.label}<span className="et2-sub" style={{ margin: 0 }}>{item?.done ? `${item.note || "verificado"} · ${item.by} · ${formatDate(item.at.slice(0, 10))}` : check.source}</span></span></label>
                    {check.key === "ibama" && canWrite && <button className="et2-btn et2-btn--sm" disabled={busy} onClick={onIbama}>Consultar IBAMA</button>}
                  </div>
                );
              })}
              <div className="et2-sub" style={{ padding: "6px 12px 10px", margin: 0 }}>Fase 1: a equipe registra a revisão (com evidência nos documentos). Verificação automática de desmatamento e TI/UC na fase 2.</div>
            </div>
            <div className="eu-box">
              <div className="eu-box-head">Documentos da floresta · {forest.eudr.originType}</div>
              <div className="et2-scroll"><table className="et2-table" style={{ fontSize: 12.5, minWidth: 520 }}>
                <tbody>
                  {docs.map((definition) => (
                    <DocRow key={definition.key} definition={definition} record={forest.eudr.docs[definition.key]} today={today} canWrite={canWrite} busy={busy}
                      onChange={(record) => onSave({ docs: { [definition.key]: record } })} onUpload={(file) => attach(definition.key, definition.label, file)}
                      viewHref={(id) => `/api/forest-documents?documentId=${id}&inline=1`} compact />
                  ))}
                </tbody>
              </table></div>
            </div>
            {forest.usedIn.length > 0 && <div className="et2-sub" style={{ margin: 0 }}>Usada nos pedidos: {forest.usedIn.join(", ")}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

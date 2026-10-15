"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatDate, money, relativeDue } from "./format";
import { ORDER_PHASES, currentPhaseIndex, isClosedStatus, phaseIndexOfCode } from "../../lib/order-phases";
import { PHASE_UPLOAD_CATEGORY, documentPhaseIndex } from "../../lib/document-phase";

// Página do pedido na interface nova: 6 fases, etapas de cada fase, emissão de documentos
// (fase Pedido), arquivos por fase com visualizar/baixar/anexar e todos os dados do pedido.
// Usa as APIs existentes (export-control, documents); nada do app anterior é exibido.

type Operation = Record<string, string | number | null> & { id: number; reference: string };
type Milestone = { id: number; code: string; sequence: number; title: string; category: string; status: string; responsibleName: string; responsibleEmail: string; dueDate: string; nextAction: string; note: string; qualityStatus: string; shipmentApproval: string; updatedAt: string };
type Task = { id: number; sequence: number; description: string; dueDate: string; responsibleName: string; responsibleEmail: string; status: string; note: string; scheduled: boolean; updatedAt: string };
type Member = { email: string; name: string };
type Activity = { me: string; comments: Array<{ id: number; authorEmail: string; authorName: string; body: string; mentionsJson: string; createdAt: string }>; viewing: Array<{ email: string; name: string }>; activity: Array<{ id: number; who: string; what: string; detail: string; at: string }>; members: Member[] };

/** POST na API do Export Control devolvendo também o conflito (409) em vez de lançar erro. */
async function postControl(body: Record<string, unknown>) {
  const response = await fetch("/api/export-control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as { error?: string; conflict?: boolean; current?: Record<string, unknown> };
  if (response.status === 409 && data.conflict) return { conflict: data.current ?? {}, error: data.error ?? "Conflito" };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return { conflict: null, error: "" };
}

function initials(name: string) {
  return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}
type Snapshot = { operation: Operation; milestones: Milestone[]; tasks: Task[]; eudrBridge: { required: boolean; status: string; readiness: number } };
type Doc = { id: number; category: string; fileName: string; documentType: string; contentType: string; sizeBytes: number; uploadedAt: string; status: string };

const STATUSES = ["Pendente", "Em andamento", "Aguardando aprovação", "Concluído", "Bloqueado", "Suspenso"];
const TONE: Record<string, string> = { "Concluído": "ok", "Em andamento": "warn", "Aguardando aprovação": "warn", "Bloqueado": "bad", "Suspenso": "todo", "Pendente": "todo" };
const ISSUE = [
  { key: "sales-order", label: "Sales Order", hint: "Pedido de venda ao cliente" },
  { key: "supplier-po", label: "Pedido de compra", hint: "Ordem ao fornecedor" },
  { key: "purchase-invoice", label: "Invoice", hint: "Fatura comercial" },
  { key: "packing-list", label: "Packing List", hint: "Romaneio de carga" },
];

const FIELD_GROUPS: Array<{ title: string; fields: Array<[string, string]> }> = [
  { title: "Comercial", fields: [["euImporter", "Cliente / importador"], ["contractNumber", "Contrato / PO"], ["incoterm", "Incoterm"], ["currency", "Moeda"], ["commercialValue", "Valor comercial"], ["quantity", "Quantidade"], ["quantityUnit", "Unidade"], ["volumeM3", "Volume (m³)"], ["netWeightKg", "Peso líquido (kg)"], ["grossWeightKg", "Peso bruto (kg)"]] },
  { title: "Produto e origem", fields: [["product", "Produto"], ["hsCode", "NCM / HS"], ["rawMaterial", "Matéria-prima"], ["species", "Espécie"], ["forestOriginType", "Origem"], ["supplierName", "Fornecedor"], ["exporterName", "Exportador"], ["exporterTaxId", "CNPJ exportador"], ["productionUnit", "Unidade produtiva"], ["productionLocation", "Local de produção"], ["lotCodes", "Lotes"]] },
  { title: "Logística", fields: [["transportMode", "Modal"], ["portOfLoading", "Porto de embarque"], ["portOfDischarge", "Porto de destino"], ["destinationCountry", "País de destino"], ["shipmentDate", "ETD"], ["carrier", "Armador"], ["bookingNumber", "Booking"], ["billOfLadingNumber", "BL"], ["containerNumbers", "Contêineres"], ["vesselVoyage", "Navio / viagem"]] },
  { title: "EUDR e responsáveis", fields: [["euOperatorEori", "EORI"], ["eudrReference", "Referência DDS"], ["internalResponsible", "Responsável interno"], ["responsibleEmail", "E-mail do responsável"], ["status", "Situação"], ["supplyChainNotes", "Observações da supply chain"]] },
];

function valueOf(operation: Operation, key: string) {
  const value = operation[key];
  if (value === null || value === undefined || value === "") return "";
  if (key === "shipmentDate") return formatDate(String(value));
  if (key === "commercialValue") return Number(value) ? money(Number(value), String(operation.currency || "USD")) : "";
  if (typeof value === "number") return value ? value.toLocaleString("pt-BR") : "";
  return String(value);
}

function sizeLabel(bytes: number) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function PedidoView({ operationId }: { operationId: number }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [phase, setPhase] = useState<number | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [seenEvents, setSeenEvents] = useState<number | null>(null);

  const load = useCallback(() => Promise.all([
    api<Snapshot>(`/api/export-control?operationId=${operationId}`),
    api<{ documents: Doc[] }>(`/api/documents?operationId=${operationId}`),
  ]).then(([snapshot, documents]) => {
    setData(snapshot);
    setDocs(documents.documents);
  }).catch((reason: Error) => setError(reason.message)), [operationId]);

  const loadActivity = useCallback(() => api<Activity>(`/api/operation-activity?operationId=${operationId}`).then((next) => {
    setActivity(next);
    setSeenEvents((previous) => previous ?? (next.activity[0]?.id ?? 0));
  }).catch(() => {}), [operationId]);

  useEffect(() => { load(); loadActivity(); }, [load, loadActivity]);

  // Presença e atualização: avisa quem está no pedido e acompanha alterações da equipe.
  useEffect(() => {
    const beat = () => fetch("/api/operation-activity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId, action: "presence" }) }).catch(() => {});
    beat();
    const timer = window.setInterval(() => { beat(); loadActivity(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [operationId, loadActivity]);

  const latestOther = activity?.activity.find((event) => event.who !== activity.me);
  const othersChanged = Boolean(latestOther && seenEvents !== null && latestOther.id > seenEvents);
  const refreshAll = () => { load(); loadActivity(); setSeenEvents(activity?.activity[0]?.id ?? 0); };

  const milestones = useMemo(() => [...(data?.milestones ?? [])].sort((a, b) => a.sequence - b.sequence), [data]);
  const current = currentPhaseIndex(milestones);
  const selected = phase ?? current;
  const phaseDocs = docs.filter((doc) => documentPhaseIndex(doc.category) === selected);
  const otherDocs = docs.filter((doc) => documentPhaseIndex(doc.category) === null);
  const today = new Date().toISOString().slice(0, 10);

  if (error) return <main className="et2-main"><div className="et2-alert et2-alert--bad" role="alert">Não foi possível abrir o pedido: {error}</div></main>;
  if (!data) return <main className="et2-main"><p className="et2-empty">Carregando pedido…</p></main>;
  const operation = data.operation;

  return (
    <main className="et2-main">
      <nav className="et2-crumbs" aria-label="Caminho"><Link href="/pedidos">Pedidos</Link> / {operation.reference}</nav>
      <div className="et2-head">
        <div>
          <h1 className="mono">{operation.reference}</h1>
          <p>{[operation.euImporter, operation.product, operation.destinationCountry].filter(Boolean).join(" · ")}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {data.eudrBridge.required && <span className={`et2-badge et2-badge--${data.eudrBridge.readiness >= 100 ? "ok" : "warn"}`}>EUDR {data.eudrBridge.readiness}%</span>}
          <span className="et2-badge et2-badge--todo">ETD {formatDate(String(operation.shipmentDate || "")) }</span>
          <span className="et2-badge et2-badge--todo">{valueOf(operation, "commercialValue") || "Sem valor"}</span>
          {activity && activity.viewing.length > 0 && (
            <span aria-label="Vendo este pedido agora" title={activity.viewing.map((person) => person.name || person.email).join(", ")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--et2-muted)" }}>
              {activity.viewing.slice(0, 4).map((person) => <span key={person.email} style={{ width: 26, height: 26, borderRadius: 13, background: "#dbeafe", color: "#1e3a8a", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 11 }}>{initials(person.name || person.email)}</span>)}
              vendo agora
            </span>
          )}
        </div>
      </div>
      {notice && <div className="et2-alert et2-alert--ok" role="status" style={{ marginTop: 12 }}>{notice}</div>}
      {othersChanged && latestOther && (
        <div className="et2-alert et2-alert--info" role="status" style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span><strong>{latestOther.who}</strong> {latestOther.what}{latestOther.detail ? ` (${latestOther.detail})` : ""}. Atualize para ver a versão mais recente.</span>
          <button className="et2-btn et2-btn--sm" onClick={refreshAll}>Atualizar</button>
        </div>
      )}

      <section className="et2-card et2-phases" aria-label="Fases do pedido" style={{ marginTop: 18 }}>
        {ORDER_PHASES.map((item, index) => {
          const steps = milestones.filter((milestone) => phaseIndexOfCode(milestone.code) === index);
          const done = steps.filter((milestone) => isClosedStatus(milestone.status)).length;
          const blocked = steps.some((milestone) => milestone.status === "Bloqueado");
          return (
            <a key={item.key} href={`#fase-${index}`} onClick={(event) => { event.preventDefault(); setPhase(index); }} aria-current={index === selected ? "step" : undefined}
              style={index === selected ? { background: "#f3f4f6", boxShadow: "inset 0 -3px 0 var(--et2-navy)" } : undefined}>
              <span className="label">{index + 1}. {item.name}</span>
              <span className="count" style={{ fontSize: 20 }}>{steps.length ? `${done}/${steps.length}` : "—"}</span>
              <span className={`note${blocked ? " note--bad" : ""}`}>{blocked ? "Bloqueado" : index < current ? "Concluída" : index === current ? "Fase atual" : "A seguir"}</span>
            </a>
          );
        })}
      </section>

      <div className="et2-row" style={{ marginTop: 18 }}>
        <div className="et2-grow" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {selected === 0 && (
            <section className="et2-card" aria-labelledby="emissao">
              <div className="et2-card-head"><h2 id="emissao">Emissão de documentos</h2><span className="et2-sub" style={{ margin: 0 }}>Gerados com os dados deste pedido</span></div>
              <div className="et2-card-body et2-grid">
                {ISSUE.map((item) => (
                  <div key={item.key} style={{ border: "1px solid var(--et2-line)", borderRadius: 6, padding: 12 }}>
                    <div style={{ fontWeight: 600 }}>{item.label}</div>
                    <div className="et2-sub">{item.hint}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      <a className="et2-btn et2-btn--sm" href={`/api/export-control?operationId=${operationId}&document=${item.key}`} target="_blank" rel="noreferrer">Visualizar / PDF</a>
                      <a className="et2-btn et2-btn--sm" href={`/api/export-control?operationId=${operationId}&document=${item.key}&format=docx`}>Word</a>
                    </div>
                  </div>
                ))}
              </div>
              <div className="et2-card-body" style={{ paddingTop: 0 }}><span className="et2-sub" style={{ margin: 0 }}>PDF: abra em Visualizar e use Imprimir → Salvar como PDF.</span></div>
            </section>
          )}

          <section className="et2-card" aria-labelledby="etapas">
            <div className="et2-card-head"><h2 id="etapas">Etapas · {ORDER_PHASES[selected].name}</h2></div>
            <div className="et2-card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {milestones.filter((milestone) => phaseIndexOfCode(milestone.code) === selected).map((milestone) => (
                <MilestoneRow key={`${milestone.code}-${milestone.updatedAt}`} operationId={operationId} milestone={milestone} today={today} onSaved={(message) => { setNotice(message); refreshAll(); }} onError={setError} />
              ))}
            </div>
          </section>

          <section className="et2-card" aria-labelledby="arquivos">
            <div className="et2-card-head">
              <h2 id="arquivos">Arquivos desta fase ({phaseDocs.length})</h2>
              <UploadButton operationId={operationId} category={PHASE_UPLOAD_CATEGORY[selected]} onDone={(message) => { setNotice(message); load(); }} />
            </div>
            <DocumentTable docs={phaseDocs} empty="Nenhum arquivo nesta fase." />
          </section>

          {otherDocs.length > 0 && (
            <section className="et2-card" aria-labelledby="outros">
              <div className="et2-card-head"><h2 id="outros">Outros documentos do pedido ({otherDocs.length})</h2></div>
              <DocumentTable docs={otherDocs} empty="" />
            </section>
          )}
        </div>

        <aside className="et2-side" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <TasksCard operationId={operationId} tasks={data.tasks} members={activity?.members ?? []} today={today} onChanged={(message) => { setNotice(message); refreshAll(); }} onError={setError} />
          <ActivityCard operationId={operationId} activity={activity} onPosted={refreshAll} onError={setError} />
          {FIELD_GROUPS.map((group) => (
            <section key={group.title} className="et2-card">
              <div className="et2-card-head"><h2>{group.title}</h2></div>
              <div className="et2-card-body">
                <dl className="et2-dl" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  {group.fields.map(([key, label]) => (
                    <div key={key} className={key === "supplyChainNotes" || key === "containerNumbers" ? "wide" : undefined}>
                      <dt>{label}</dt><dd>{valueOf(operation, key) || <span className="muted">—</span>}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>
          ))}
          <a className="et2-sub" href={`/classico?processo=${operationId}`} style={{ margin: 0 }}>Abrir na versão anterior (EUDR, supply chain e edição completa)</a>
        </aside>
      </div>
    </main>
  );
}

function MilestoneRow({ operationId, milestone, today, onSaved, onError }: { operationId: number; milestone: Milestone; today: string; onSaved: (message: string) => void; onError: (message: string) => void }) {
  const [draft, setDraft] = useState(milestone);
  const [saving, setSaving] = useState(false);
  const changed = draft.status !== milestone.status || draft.responsibleName !== milestone.responsibleName || draft.dueDate !== milestone.dueDate || draft.nextAction !== milestone.nextAction;
  const due = relativeDue(milestone.dueDate, today);

  const [conflict, setConflict] = useState<Record<string, unknown> | null>(null);

  async function save(force = false) {
    setSaving(true);
    try {
      // A API regrava responsável, prazo, próxima ação e nota: envia sempre a etapa completa.
      // expectedUpdatedAt: se outra pessoa salvou antes, a API recusa e mostramos o conflito.
      const result = await postControl({ action: "milestone", operationId, code: milestone.code, status: draft.status, qualityStatus: milestone.qualityStatus, shipmentApproval: milestone.shipmentApproval, responsibleName: draft.responsibleName, responsibleEmail: milestone.responsibleEmail, dueDate: draft.dueDate, nextAction: draft.nextAction, note: milestone.note, ...(force ? {} : { expectedUpdatedAt: milestone.updatedAt }) });
      if (result.conflict) { setConflict(result.conflict); return; }
      setConflict(null);
      onSaved(`Etapa "${milestone.title}" salva.`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao salvar a etapa.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--et2-line)", borderRadius: 6, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontWeight: 600 }}>{milestone.sequence}. {milestone.title}</div>
        <span className={`et2-badge et2-badge--${TONE[milestone.status] ?? "todo"}`}>{milestone.status}{milestone.dueDate && !isClosedStatus(milestone.status) ? ` · ${due.label}` : ""}</span>
      </div>
      <div className="et2-grid" style={{ marginTop: 10 }}>
        <label className="et2-field"><span>Situação</span>
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
        </label>
        <label className="et2-field"><span>Responsável</span><input value={draft.responsibleName} onChange={(event) => setDraft({ ...draft, responsibleName: event.target.value })} /></label>
        <label className="et2-field"><span>Prazo</span><input type="date" value={draft.dueDate?.slice(0, 10) ?? ""} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
        <label className="et2-field et2-field--wide"><span>Próxima ação</span><input value={draft.nextAction} onChange={(event) => setDraft({ ...draft, nextAction: event.target.value })} /></label>
      </div>
      {conflict && (
        <div className="et2-alert et2-alert--warn" role="alert" aria-label="Alterações simultâneas" style={{ marginTop: 10 }}>
          <strong>Outra pessoa alterou esta etapa enquanto você editava.</strong>
          <div style={{ marginTop: 4 }}>Versão salva agora: {String(conflict.status ?? "")} · {String(conflict.responsibleName ?? "sem responsável")} · prazo {formatDate(String(conflict.dueDate ?? "")) } · {String(conflict.nextAction ?? "")}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="et2-btn et2-btn--sm" onClick={() => { setConflict(null); onSaved("Versão mais recente carregada."); }}>Usar a versão salva</button>
            <button className="et2-btn et2-btn--sm et2-btn--ok" onClick={() => save(true)} disabled={saving}>Manter a minha alteração</button>
          </div>
        </div>
      )}
      {changed && !conflict && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
          <button className="et2-btn et2-btn--sm" onClick={() => setDraft(milestone)} disabled={saving}>Desfazer</button>
          <button className="et2-btn et2-btn--sm et2-btn--ok" onClick={() => save()} disabled={saving}>{saving ? "Salvando…" : "Salvar etapa"}</button>
        </div>
      )}
    </div>
  );
}

function DocumentTable({ docs, empty }: { docs: Doc[]; empty: string }) {
  if (!docs.length) return <p className="et2-empty">{empty}</p>;
  return (
    <div className="et2-scroll">
      <table className="et2-table">
        <thead><tr><th>Arquivo</th><th>Tipo</th><th>Enviado</th><th className="num">Ações</th></tr></thead>
        <tbody>
          {docs.map((doc) => (
            <tr key={doc.id}>
              <td style={{ wordBreak: "break-word" }}>{doc.fileName}<span className="et2-sub">{sizeLabel(doc.sizeBytes)}</span></td>
              <td>{doc.documentType || "—"}<span className="et2-sub">{doc.category.replace(/^Export Control · /, "")}</span></td>
              <td style={{ whiteSpace: "nowrap" }}>{formatDate(doc.uploadedAt)}</td>
              <td className="num" style={{ whiteSpace: "nowrap" }}>
                <a className="et2-btn et2-btn--sm" href={`/api/documents?documentId=${doc.id}&inline=1`} target="_blank" rel="noreferrer">Visualizar</a>{" "}
                <a className="et2-btn et2-btn--sm" href={`/api/documents?documentId=${doc.id}`}>Baixar</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UploadButton({ operationId, category, onDone }: { operationId: number; category: string; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.set("operationId", String(operationId));
      form.set("category", category);
      form.set("file", file);
      const response = await fetch("/api/documents", { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
      onDone(`Arquivo "${file.name}" anexado.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao anexar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {error && <span style={{ color: "var(--et2-bad)", fontSize: 12 }}>{error}</span>}
      <label className="et2-btn et2-btn--sm et2-btn--primary" style={{ cursor: busy ? "wait" : "pointer" }}>
        {busy ? "Enviando…" : "+ Anexar arquivo"}
        <input type="file" hidden disabled={busy} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} />
      </label>
    </span>
  );
}

function TasksCard({ operationId, tasks, members, today, onChanged, onError }: { operationId: number; tasks: Task[]; members: Member[]; today: string; onChanged: (message: string) => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const visible = tasks.filter((task) => showDone || task.status !== "Concluído");
  const doneCount = tasks.filter((task) => task.status === "Concluído").length;

  async function run(body: Record<string, unknown>, message: string) {
    setBusy(true);
    try {
      const result = await postControl({ operationId, ...body });
      if (result.conflict) onError("Outra pessoa alterou esta tarefa enquanto você editava. Atualize e tente de novo.");
      else onChanged(message);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao salvar a tarefa.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="et2-card" aria-labelledby="tarefas">
      <div className="et2-card-head">
        <h2 id="tarefas">Tarefas ({tasks.length - doneCount} abertas)</h2>
        {doneCount > 0 && <button className="et2-btn et2-btn--sm" onClick={() => setShowDone(!showDone)}>{showDone ? "Ocultar concluídas" : `Ver concluídas (${doneCount})`}</button>}
      </div>
      <form className="et2-card-body" style={{ display: "flex", gap: 8, paddingBottom: 6 }} onSubmit={(event) => { event.preventDefault(); if (adding.trim()) { run({ action: "operation-task-create", description: adding.trim() }, "Tarefa criada."); setAdding(""); } }}>
        <input className="et2-input" placeholder="+ Adicionar tarefa" value={adding} onChange={(event) => setAdding(event.target.value)} aria-label="Nova tarefa" />
        <button className="et2-btn et2-btn--sm et2-btn--primary" disabled={busy || !adding.trim()}>Adicionar</button>
      </form>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {visible.map((task) => {
          const done = task.status === "Concluído";
          const due = relativeDue(task.dueDate, today);
          return (
            <div key={`${task.id}-${task.updatedAt}`} style={{ borderTop: "1px solid var(--et2-line-2)", padding: "10px 20px" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <input type="checkbox" aria-label={`Concluir: ${task.description}`} checked={done} disabled={busy} style={{ width: 18, height: 18, marginTop: 2, flex: "none", accentColor: "var(--et2-ok)" }}
                  onChange={() => run({ action: "operation-task-complete", taskId: task.id, completed: !done }, done ? "Tarefa reaberta." : "Tarefa concluída.")} />
                <button onClick={() => setOpen(open === task.id ? null : task.id)} style={{ all: "unset", cursor: "pointer", flex: 1 }} aria-expanded={open === task.id}>
                  <div style={{ textDecoration: done ? "line-through" : undefined, color: done ? "var(--et2-muted)" : undefined }}>{task.description}</div>
                  <span className="et2-sub" style={{ color: !done && due.tone === "bad" ? "var(--et2-bad)" : undefined }}>
                    {[task.responsibleName || "Sem responsável", task.dueDate ? due.label : "Sem prazo"].join(" · ")}
                  </span>
                </button>
              </div>
              {open === task.id && <TaskEditor task={task} members={members} busy={busy} onSave={(changes) => run({ action: "operation-task-update", taskId: task.id, sequence: task.sequence, scheduled: task.scheduled, expectedUpdatedAt: task.updatedAt, ...changes }, "Tarefa salva.")} />}
            </div>
          );
        })}
        {!visible.length && <p className="et2-empty">Nenhuma tarefa aberta.</p>}
      </div>
    </section>
  );
}

function TaskEditor({ task, members, busy, onSave }: { task: Task; members: Member[]; busy: boolean; onSave: (changes: Record<string, unknown>) => void }) {
  const [draft, setDraft] = useState({ description: task.description, responsibleEmail: task.responsibleEmail, responsibleName: task.responsibleName, dueDate: task.dueDate?.slice(0, 10) ?? "", status: task.status, note: task.note });
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 10, paddingLeft: 28 }}>
      <label className="et2-field"><span>Tarefa</span><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className="et2-field"><span>Responsável</span>
        <select value={draft.responsibleEmail} onChange={(event) => { const member = members.find((item) => item.email === event.target.value); setDraft({ ...draft, responsibleEmail: event.target.value, responsibleName: member?.name ?? draft.responsibleName }); }}>
          <option value="">{draft.responsibleName || "Sem responsável"}</option>
          {members.map((member) => <option key={member.email} value={member.email}>{member.name} ({member.email})</option>)}
        </select>
      </label>
      <label className="et2-field"><span>Prazo</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
      <label className="et2-field"><span>Situação</span>
        <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{["Pendente", "Agendada", "Em andamento", "Concluído", "Atrasada"].map((status) => <option key={status}>{status}</option>)}</select>
      </label>
      <label className="et2-field"><span>Nota</span><textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} style={{ minHeight: 60 }} /></label>
      <div style={{ display: "flex", justifyContent: "flex-end" }}><button className="et2-btn et2-btn--sm et2-btn--ok" disabled={busy} onClick={() => onSave(draft)}>Salvar tarefa</button></div>
    </div>
  );
}

function ActivityCard({ operationId, activity, onPosted, onError }: { operationId: number; activity: Activity | null; onPosted: () => void; onError: (message: string) => void }) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const members = activity?.members ?? [];
  const feed = [
    ...(activity?.comments ?? []).map((comment) => ({ key: `c${comment.id}`, at: comment.createdAt, who: comment.authorName || comment.authorEmail, comment: comment.body, mentioned: comment.mentionsJson.includes(activity?.me ?? "~"), what: "comentou" })),
    ...(activity?.activity ?? []).map((event) => ({ key: `a${event.id}`, at: event.at, who: event.who, comment: "", mentioned: false, what: `${event.what}${event.detail ? ` · ${event.detail}` : ""}` })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 60);

  async function post() {
    setBusy(true);
    try {
      const used = mentions.filter((member) => text.includes(`@${member.name}`)).map((member) => member.email);
      await api("/api/operation-activity", { method: "POST", body: JSON.stringify({ operationId, action: "comment", text, mentions: used }) });
      setText(""); setMentions([]);
      onPosted();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao comentar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="et2-card" aria-labelledby="ativ">
      <div className="et2-card-head"><h2 id="ativ">Comentários e atividade</h2></div>
      <div className="et2-card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea className="et2-input" style={{ minHeight: 70, padding: 8 }} placeholder="Escreva um comentário… use Mencionar para avisar alguém" value={text} onChange={(event) => setText(event.target.value)} aria-label="Comentário" />
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <select className="et2-input" style={{ width: "auto" }} value="" aria-label="Mencionar" onChange={(event) => {
            const member = members.find((item) => item.email === event.target.value);
            if (member) { setText(`${text}${text && !text.endsWith(" ") ? " " : ""}@${member.name} `); setMentions([...mentions, member]); }
          }}>
            <option value="">@ Mencionar…</option>
            {members.map((member) => <option key={member.email} value={member.email}>{member.name}</option>)}
          </select>
          <button className="et2-btn et2-btn--sm et2-btn--primary" disabled={busy || !text.trim()} onClick={post}>Comentar</button>
        </div>
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {feed.map((item) => (
          <div key={item.key} style={{ borderTop: "1px solid var(--et2-line-2)", padding: "8px 20px", background: item.mentioned ? "#eff6ff" : undefined }}>
            <div style={{ fontSize: 13 }}><strong>{item.who}</strong> {item.what}</div>
            {item.comment && <div style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{item.comment}</div>}
            <span className="et2-sub">{formatDate(String(item.at))} {String(item.at).slice(11, 16)}{item.mentioned ? " · você foi mencionado" : ""}</span>
          </div>
        ))}
        {!feed.length && <p className="et2-empty">Sem atividade ainda.</p>}
      </div>
    </section>
  );
}

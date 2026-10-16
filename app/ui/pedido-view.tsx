"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { api, formatDate, money, relativeDue } from "./format";
import { ORDER_PHASES, currentPhaseIndex, isClosedStatus, phaseIndexOfCode } from "../../lib/order-phases";
import { PHASE_UPLOAD_CATEGORY, documentPhaseIndex, taskPhaseIndex } from "../../lib/document-phase";
import { type LogisticsDraft, costsFromDraft, logisticsByCurrency, logisticsDraft, logisticsTotal, logisticsTotalIn, parseLogisticsCosts } from "../../lib/logistics-costs";
import { LogisticsCostsEditor, LogisticsCostsSummary } from "./logistics-costs-editor";
import { amountsOf, estimateMargin } from "../../lib/margin";
import { readOrderTerms } from "../../lib/order-terms";

// Página do pedido — reprodução do protótipo aprovado (docs/redesign/prototipo/Processo.dc.html):
// cabeçalho com os 6 dados-chave, fases em linha do tempo, emissão de documentos na fase
// Pedido (Sales Order, Pedido de compra, Invoice, Packing List editáveis), etapas e tarefas
// em tabela com check (estilo Asana) e painel lateral de comentários, arquivos da fase,
// documentos, atividade da equipe e financeiro. Vários usuários editam ao mesmo tempo:
// presença, quem está editando, aviso de alterações e combinação campo a campo no conflito.

type Operation = Record<string, string | number | null> & { id: number; reference: string };
type Milestone = { id: number; code: string; sequence: number; title: string; category: string; status: string; responsibleName: string; responsibleEmail: string; dueDate: string; nextAction: string; note: string; qualityStatus: string; shipmentApproval: string; updatedAt: string };
type Task = { id: number; sequence: number; description: string; dueDate: string; responsibleName: string; responsibleEmail: string; status: string; note: string; scheduled: boolean; updatedAt: string };
type Member = { email: string; name: string };
type Comment = { id: number; authorEmail: string; authorName: string; body: string; mentionsJson: string; targetKey: string; createdAt: string };
type Activity = { me: string; comments: Comment[]; viewing: Array<{ email: string; name: string; editing?: string }>; followers: Member[]; activity: Array<{ id: number; who: string; what: string; detail: string; at: string }>; members: Member[] };
type OrderItem = { species: string; quality: string; size: string; volume: number; unitPrice: number };
type PackingItem = { description: string; cbm: number; totalPcs: number; piecesPerPackage: number; packages: number; length: number; width: number; thickness: number; grossWeight: number; netWeight: number };
type OrderDetails = {
  items: OrderItem[]; paymentTerms: string; notes: string;
  supplierOrder: { tradingName?: string; currency?: string; incoterm?: string; paymentTerms?: string; notes?: string; items: OrderItem[] };
  packingList: { consigneeName?: string; netWeight?: number; grossWeight?: number; packages?: number; marks?: string; containerReference?: string; items: PackingItem[] };
};
type Settings = { customerName: string; customerEmail: string; updatedAt: string };
type Snapshot = { operation: Operation; orderDetails: OrderDetails; settings: Settings; milestones: Milestone[]; tasks: Task[]; eudrBridge: { required: boolean; status: string; readiness: number } };
type Doc = { id: number; category: string; fileName: string; documentType: string; contentType: string; sizeBytes: number; uploadedAt: string; status: string; sourceSystem: string };

const STATUSES = ["Pendente", "Em andamento", "Aguardando aprovação", "Concluído", "Bloqueado", "Suspenso"];
const TASK_STATUSES = ["Pendente", "Agendada", "Em andamento", "Concluído", "Atrasada"];
const TONE: Record<string, string> = { "Concluído": "ok", "Em andamento": "warn", "Aguardando aprovação": "warn", "Agendada": "warn", "Bloqueado": "bad", "Atrasada": "bad", "Suspenso": "todo", "Pendente": "todo" };
const COLORS = ["#0F1B2D", "#0F766E", "#7C3AED", "#B45309", "#1D4ED8", "#BE185D", "#4D7C0F"];

/** POST na API do Export Control devolvendo também o conflito (409) em vez de lançar erro. */
async function postControl(body: Record<string, unknown>) {
  const response = await fetch("/api/export-control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as { error?: string; conflict?: boolean; current?: Record<string, unknown> };
  if (response.status === 409 && data.conflict) return { conflict: data.current ?? {}, error: data.error ?? "Conflito" };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return { conflict: null, error: "" };
}

function postActivity(body: Record<string, unknown>) {
  return api("/api/operation-activity", { method: "POST", body: JSON.stringify(body) });
}

function initials(name: string) {
  return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function Avatar({ name, email, size = 24 }: { name: string; email?: string; size?: number }) {
  const key = (email || name || "?").toLowerCase();
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return <span className="pd-av" title={name} style={{ width: size, height: size, background: COLORS[hash % COLORS.length], fontSize: size > 26 ? 11 : 10 }}>{initials(name || email || "?")}</span>;
}

function sizeLabel(bytes: number) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function when(value: string) {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return `hoje ${time}`;
  if (date.toDateString() === new Date(Date.now() - 86400000).toDateString()) return `ontem ${time}`;
  return `${date.toLocaleDateString("pt-BR")} ${time}`;
}

/** Número digitado no padrão brasileiro (1.234,56) ou internacional (1234.56). */
const num = (value: unknown) => {
  const raw = String(value ?? "").replace(/\s/g, "");
  // "4.500" sem vírgula = milhar no padrão brasileiro; "4.5" continua decimal.
  const normalized = raw.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};
const fmt = (value: number, digits = 2) => value ? value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits }) : "";

// ---------------------------------------------------------------------------------------
// Formulário da emissão de documentos: espelha o que a ação "order-commercial" grava.

type ItemDraft = Record<string, string>;
type Form = {
  customerName: string; contractNumber: string; incoterm: string; currency: string; portOfLoading: string; portOfDischarge: string;
  shipmentDate: string; hsCode: string; paymentTerms: string; quantityUnit: string; soItems: ItemDraft[];
  poTrading: string; poIncoterm: string; poCurrency: string; poPayment: string; poNotes: string; poItems: ItemDraft[];
  plConsignee: string; plMarks: string; plContainers: string; plNet: string; plGross: string; plPackages: string; plItems: ItemDraft[];
};
const ORDER_KEYS = ["species", "quality", "size", "volume", "unitPrice"] as const;
const PACK_KEYS = ["description", "packages", "totalPcs", "netWeight", "grossWeight", "cbm"] as const;
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const orderDraft = (items: OrderItem[]) => items.map((item) => Object.fromEntries(ORDER_KEYS.map((key) => [key, typeof item[key] === "number" ? fmt(item[key] as number, 4) : text(item[key])])));

function formFrom(snapshot: { operation: Operation; orderDetails: OrderDetails; settings: Settings }): Form {
  const { operation, orderDetails: details, settings } = snapshot;
  const supplier = details.supplierOrder ?? { items: [] };
  const packing = details.packingList ?? { items: [] };
  return {
    customerName: text(settings?.customerName || operation.euImporter), contractNumber: text(operation.contractNumber), incoterm: text(operation.incoterm),
    currency: text(operation.currency || "USD"), portOfLoading: text(operation.portOfLoading), portOfDischarge: text(operation.portOfDischarge),
    shipmentDate: text(operation.shipmentDate).slice(0, 10), hsCode: text(operation.hsCode), paymentTerms: text(details.paymentTerms), quantityUnit: text(operation.quantityUnit || "MT"),
    soItems: orderDraft(details.items ?? []),
    poTrading: text(supplier.tradingName), poIncoterm: text(supplier.incoterm || operation.incoterm), poCurrency: text(supplier.currency || operation.currency || "USD"),
    poPayment: text(supplier.paymentTerms), poNotes: text(supplier.notes), poItems: orderDraft(supplier.items ?? []),
    plConsignee: text(packing.consigneeName), plMarks: text(packing.marks ?? "MADE IN BRAZIL"), plContainers: text(packing.containerReference || operation.containerNumbers),
    plNet: fmt(Number(packing.netWeight) || 0, 3), plGross: fmt(Number(packing.grossWeight) || 0, 3), plPackages: fmt(Number(packing.packages) || 0, 0),
    plItems: (packing.items ?? []).map((item) => Object.fromEntries(PACK_KEYS.map((key) => [key, key === "description" ? text(item.description) : fmt(Number(item[key]) || 0, 3)]))),
  };
}

const orderItems = (rows: ItemDraft[]) => rows.map((row) => ({ species: row.species?.trim() ?? "", quality: row.quality?.trim() ?? "", size: row.size?.trim() ?? "", volume: num(row.volume), unitPrice: num(row.unitPrice) }));
const itemsTotal = (rows: ItemDraft[]) => orderItems(rows).reduce((sum, item) => ({ volume: sum.volume + item.volume, value: sum.value + item.volume * item.unitPrice }), { volume: 0, value: 0 });
const isM3 = (unit: string) => /m3|m³/i.test(unit);

function commercialBody(form: Form, snapshot: Snapshot) {
  const { operation, orderDetails, settings } = snapshot;
  const so = itemsTotal(form.soItems);
  return {
    action: "order-commercial", operationId: operation.id,
    // A ação regrava estes campos do pedido: envia os valores atuais para não apagar nada.
    reference: operation.reference, product: operation.product, species: operation.species, exporterName: operation.exporterName, exporterTaxId: operation.exporterTaxId,
    quantity: so.volume || operation.quantity, volumeM3: isM3(form.quantityUnit) && so.volume ? so.volume : operation.volumeM3, commercialValue: operation.commercialValue,
    customerEmail: settings?.customerEmail ?? "", orderNotes: orderDetails.notes,
    customerName: form.customerName, contractNumber: form.contractNumber, incoterm: form.incoterm, currency: form.currency, portOfLoading: form.portOfLoading,
    portOfDischarge: form.portOfDischarge, shipmentDate: form.shipmentDate, hsCode: form.hsCode, paymentTerms: form.paymentTerms, quantityUnit: form.quantityUnit,
    orderItems: orderItems(form.soItems),
    supplierOrder: { tradingName: form.poTrading, incoterm: form.poIncoterm, currency: form.poCurrency, paymentTerms: form.poPayment, notes: form.poNotes, items: orderItems(form.poItems) },
    packingList: {
      consigneeName: form.plConsignee, marks: form.plMarks, containerReference: form.plContainers, netWeight: num(form.plNet), grossWeight: num(form.plGross), packages: num(form.plPackages),
      items: form.plItems.map((row) => ({ description: row.description?.trim() ?? "", packages: num(row.packages), totalPcs: num(row.totalPcs), netWeight: num(row.netWeight), grossWeight: num(row.grossWeight), cbm: num(row.cbm) })),
    },
  };
}

/** Campos comparados no conflito (rótulo e valor legível). */
const FORM_LABELS: Array<[keyof Form, string]> = [
  ["customerName", "Comprador"], ["contractNumber", "PO do cliente"], ["incoterm", "Incoterm"], ["currency", "Moeda"], ["portOfLoading", "Porto de embarque"],
  ["portOfDischarge", "Porto de destino"], ["shipmentDate", "Embarque até"], ["hsCode", "NCM / HS"], ["paymentTerms", "Pagamento"], ["quantityUnit", "Unidade"],
  ["soItems", "Itens do pedido de venda"], ["poTrading", "Comprador / trading"], ["poIncoterm", "Incoterm compra"], ["poCurrency", "Moeda da compra"],
  ["poPayment", "Pagamento ao fornecedor"], ["poNotes", "Observações da compra"], ["poItems", "Itens do pedido de compra"], ["plConsignee", "Consignee"],
  ["plMarks", "Marcação"], ["plContainers", "Contêiner(es)"], ["plNet", "Peso líquido total (kg)"], ["plGross", "Peso bruto total (kg)"], ["plPackages", "Total de volumes"], ["plItems", "Itens do packing list"],
];
const show = (value: Form[keyof Form]) => Array.isArray(value)
  ? value.map((row) => Object.values(row).filter(Boolean).join(" · ")).join(" | ") || "—"
  : value || "—";
const same = (a: Form[keyof Form], b: Form[keyof Form]) => JSON.stringify(a) === JSON.stringify(b);

const DOC_TABS = [
  { key: "sales-order", prefix: "SO", name: "Pedido de venda (Sales Order)", short: "Sales Order", list: "Pedido de venda", hint: "Enviado ao cliente para assinatura" },
  { key: "supplier-po", prefix: "PC", name: "Pedido de compra (fornecedor)", short: "pedido de compra", list: "Pedido de compra", hint: "Preço, incoterm e pagamento do fornecedor podem ser diferentes da venda" },
  { key: "purchase-invoice", prefix: "INV", name: "Invoice (Commercial / Proforma)", short: "invoice", list: "Invoice", hint: "Gerada a partir do pedido de venda e do packing list" },
  { key: "packing-list", prefix: "PL", name: "Packing List", short: "packing list", list: "Packing List", hint: "Volumes, pesos e contêineres da carga" },
] as const;

// ---------------------------------------------------------------------------------------

type Target = { kind: "m"; code: string } | { kind: "t"; id: number };
type Preview = { title: string; src: string; download: string };
type SaveMilestone = (milestone: Milestone, changes: Partial<Milestone>, force?: boolean) => Promise<{ conflict: Record<string, unknown> | null }>;

export default function PedidoView({ operationId }: { operationId: number }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<number | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [toast, setToast] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const baseRef = useRef<Form | null>(null);
  const versionRef = useRef("");
  const lastSeen = useRef<number | null>(null);
  const editingRef = useRef("");

  const load = useCallback(() => Promise.all([
    api<Snapshot>(`/api/export-control?operationId=${operationId}`),
    api<{ documents: Doc[] }>(`/api/documents?operationId=${operationId}`),
  ]).then(([snapshot, documents]) => {
    setData(snapshot);
    setDocs(documents.documents);
    if (!dirtyRef.current) {
      const next = formFrom(snapshot);
      setForm(next);
      baseRef.current = next;
      versionRef.current = snapshot.settings?.updatedAt ?? "";
    }
  }).catch((reason: Error) => setError(reason.message)), [operationId]);

  const loadActivity = useCallback(() => api<Activity>(`/api/operation-activity?operationId=${operationId}`).then((next) => {
    setActivity(next);
    const newest = next.activity[0]?.id ?? 0;
    if (lastSeen.current === null) { lastSeen.current = newest; return; }
    const fresh = next.activity.filter((event) => event.id > (lastSeen.current ?? 0) && event.who !== next.me);
    lastSeen.current = Math.max(lastSeen.current, newest);
    if (fresh.length) {
      const event = fresh[0];
      const who = next.members.find((member) => member.email === event.who)?.name || event.who;
      setToast(`${who} ${event.what}${event.detail ? ` “${event.detail}”` : ""} · agora`);
      load();
    }
  }).catch(() => {}), [operationId, load]);

  useEffect(() => { load(); loadActivity(); }, [load, loadActivity]);

  // Presença: avisa quem está no pedido (e em qual documento está editando) e acompanha a equipe.
  useEffect(() => {
    const beat = () => fetch("/api/operation-activity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId, action: "presence", editing: editingRef.current }) }).catch(() => {});
    beat();
    const timer = window.setInterval(() => { beat(); loadActivity(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [operationId, loadActivity]);

  const refreshAll = useCallback(() => { load(); loadActivity(); }, [load, loadActivity]);
  const onEditing = useCallback((key: string) => { editingRef.current = key; }, []);
  const onFormSaved = useCallback(() => { dirtyRef.current = false; setDirty(false); refreshAll(); }, [refreshAll]);
  const milestones = useMemo(() => [...(data?.milestones ?? [])].sort((a, b) => a.sequence - b.sequence), [data]);
  const current = currentPhaseIndex(milestones);
  const selected = phase ?? current;
  const today = new Date().toISOString().slice(0, 10);
  const members = activity?.members ?? [];
  const nameOf = (email: string, fallback = "") => members.find((member) => member.email === email)?.name || fallback || email;

  const phaseOfTask = (task: Task) => taskPhaseIndex(task.description) ?? current;
  const comments = activity?.comments ?? [];
  const countFor = (key: string) => comments.filter((comment) => comment.targetKey === key).length;

  if (error && !data) return <main className="et2-main"><div className="et2-alert et2-alert--bad" role="alert">Não foi possível abrir o pedido: {error}</div></main>;
  if (!data || !form) return <main className="et2-main"><p className="et2-empty">Carregando pedido…</p></main>;
  const operation = data.operation;
  const currency = String(operation.currency || "USD");

  const phaseInfo = ORDER_PHASES.map((item, index) => {
    const steps = milestones.filter((milestone) => phaseIndexOfCode(milestone.code) === index);
    const tasks = data.tasks.filter((task) => phaseOfTask(task) === index);
    const total = steps.length + tasks.length;
    const done = steps.filter((milestone) => isClosedStatus(milestone.status)).length + tasks.filter((task) => task.status === "Concluído").length;
    const files = docs.filter((doc) => documentPhaseIndex(doc.category, doc.fileName) === index).length;
    return { ...item, total, done, files };
  });
  const phaseMilestones = milestones.filter((milestone) => phaseIndexOfCode(milestone.code) === selected);
  const phaseTasks = data.tasks.filter((task) => phaseOfTask(task) === selected).sort((a, b) => a.sequence - b.sequence);
  const phaseDocs = docs.filter((doc) => documentPhaseIndex(doc.category, doc.fileName) === selected);
  const otherDocs = docs.filter((doc) => documentPhaseIndex(doc.category, doc.fileName) === null);
  const openStep = milestones.find((milestone) => phaseIndexOfCode(milestone.code) === current && !isClosedStatus(milestone.status));
  const meFollowing = Boolean(activity?.followers?.some((follower) => follower.email === activity.me));

  const so = itemsTotal(form.soItems);
  const po = itemsTotal(form.poItems);
  const saleValue = so.value || Number(operation.commercialValue) || 0;
  const logistics = parseLogisticsCosts(operation.logisticsCostsJson);
  // Custos em R$ e US$ convertidos pelo câmbio informado para a moeda da venda.
  const hasLogistics = logisticsTotal(logistics) > 0;
  const logisticsValue = hasLogistics ? logisticsTotalIn(logistics, form.currency) : 0;
  const logisticsParts = Object.entries(logisticsByCurrency(logistics)).map(([code, value]) => money(value, code)).join(" + ");
  // Margem = venda − compra − prévia logística (mesma conta da seção 4 do Novo processo, lib/margin).
  // Compra: o pedido de compra emitido na fase Pedido; antes dele, o preço indicativo de compra × quantidade.
  const terms = readOrderTerms({ supplyChainNotes: text(operation.supplyChainNotes) || null, product: text(operation.product), species: text(operation.species), rawMaterial: text(operation.rawMaterial), lotCodes: text(operation.lotCodes), quantity: Number(operation.quantity) || 0, volumeM3: Number(operation.volumeM3) || 0, commercialValue: Number(operation.commercialValue) || 0 });
  // Pedido de compra igual ao de venda é a cópia automática da emissão (ainda não preenchido): vale o indicativo.
  const poIsSaleCopy = po.value === so.value && terms.purchaseUnitPrice > 0;
  const purchaseIndicative = !(terms.hasSupplierOrder && po.value) || poIsSaleCopy;
  const purchase = purchaseIndicative
    ? { value: terms.purchaseUnitPrice * (Number(operation.volumeM3) || Number(operation.quantity) || 0), currency: terms.purchaseCurrency }
    : { value: po.value, currency: form.poCurrency || form.currency };
  const estimate = estimateMargin({ sale: { value: saleValue, currency: form.currency }, purchase, logistics: amountsOf(logisticsByCurrency(logistics)), rate: logistics.exchangeRate });
  const margin = estimate.percent;

  function run(work: () => Promise<unknown>) {
    setBusy(true);
    work().then(refreshAll).catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false));
  }

  const saveMilestone: SaveMilestone = (milestone, changes, force = false) => {
    const draft = { ...milestone, ...changes };
    return postControl({ action: "milestone", operationId, code: milestone.code, status: draft.status, qualityStatus: draft.qualityStatus, shipmentApproval: draft.shipmentApproval, responsibleName: draft.responsibleName, responsibleEmail: draft.responsibleEmail, dueDate: draft.dueDate, nextAction: draft.nextAction, note: draft.note, ...(force ? {} : { expectedUpdatedAt: milestone.updatedAt }) });
  };

  function toggleMilestone(milestone: Milestone) {
    run(async () => {
      const result = await saveMilestone(milestone, { status: isClosedStatus(milestone.status) ? "Em andamento" : "Concluído" });
      if (result.conflict) setToast("Outra pessoa alterou esta etapa agora. A versão mais recente foi carregada.");
    });
  }

  // Exclui o arquivo do storage e o registro (rota DELETE /api/documents, com auditoria).
  function deleteDoc(doc: Doc) {
    if (!window.confirm(`Excluir o arquivo "${doc.fileName}" deste pedido? Ele será apagado do armazenamento e não poderá ser recuperado.`)) return;
    run(async () => {
      const response = await fetch(`/api/documents?id=${doc.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
      setToast(`Arquivo "${doc.fileName}" excluído.`);
    });
  }

  function toggleTask(task: Task) {
    run(() => postControl({ action: "operation-task-complete", operationId, taskId: task.id, completed: task.status !== "Concluído" }));
  }

  function mailUpdate() {
    const lines = phaseInfo.map((item, index) => `${index + 1}. ${item.name}: ${item.total ? `${item.done}/${item.total}` : "—"}${index === current ? " (fase atual)" : ""}`);
    const body = [`Pedido ${operation.reference}`, `Fase atual: ${ORDER_PHASES[current].name}`, "", ...lines, "", openStep ? `Próximo passo: ${openStep.title}${openStep.nextAction ? ` — ${openStep.nextAction}` : ""}` : ""].join("\n");
    window.open(`mailto:${encodeURIComponent(data?.settings?.customerEmail ?? "")}?subject=${encodeURIComponent(`Atualização do pedido ${operation.reference}`)}&body=${encodeURIComponent(body)}`, "_self");
  }

  const viewers = [{ email: activity?.me ?? "", name: nameOf(activity?.me ?? "", "Você") }, ...(activity?.viewing ?? [])].filter((person) => person.email);
  const selectedMilestone = target?.kind === "m" ? milestones.find((milestone) => milestone.code === target.code) : undefined;
  const selectedTask = target?.kind === "t" ? data.tasks.find((task) => task.id === target.id) : undefined;
  const drawerPhase = selectedMilestone ? phaseIndexOfCode(selectedMilestone.code) : selectedTask ? phaseOfTask(selectedTask) : selected;

  return (
    <main className="et2-main pd">
      <nav className="et2-crumbs" aria-label="Caminho"><Link href="/pedidos">Pedidos</Link> / {operation.reference}</nav>
      {error && <div className="et2-alert et2-alert--bad" role="alert" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{error}</span><button className="pd-btn pd-btn--xs" onClick={() => setError("")}>Fechar</button></div>}

      <section className="pd-card">
        <div className="pd-hero">
          <div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <h1 className="mono">{operation.reference}</h1>
              <span className={`pd-badge pd-badge--${phaseInfo[5].total && phaseInfo[5].done === phaseInfo[5].total ? "ok" : "warn"}`}>{ORDER_PHASES[current].name} · {current + 1}/6</span>
              {data.eudrBridge.required && <span className={`pd-badge pd-badge--${data.eudrBridge.readiness >= 100 ? "ok" : "todo"}`}>EUDR {data.eudrBridge.readiness}%</span>}
            </div>
            <div className="sub">{[operation.product, form.customerName || operation.euImporter, [operation.portOfLoading, operation.portOfDischarge || operation.destinationCountry].filter(Boolean).join(" → ")].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="pd-actions">
            {viewers.length > 0 && (
              <div className="pd-viewers" aria-label="Vendo este pedido agora">
                <span>Vendo agora</span>
                <span style={{ display: "flex" }}>{viewers.slice(0, 5).map((person) => <Avatar key={person.email} name={person.name || person.email} email={person.email} size={30} />)}</span>
              </div>
            )}
            <button className={`pd-btn${meFollowing ? " pd-btn--on" : ""}`} aria-pressed={meFollowing} disabled={busy} onClick={() => run(() => postActivity({ operationId, action: "follow", follow: !meFollowing }))}>{meFollowing ? "✓ Seguindo" : "Seguir pedido"}</button>
            <button className="pd-btn" onClick={mailUpdate}>Enviar atualização ao cliente</button>
            <button className="pd-btn pd-btn--dark" disabled={busy || !openStep} title={openStep ? `Concluir “${openStep.title}”` : "Nenhuma etapa aberta"}
              onClick={() => { if (openStep && window.confirm(`Concluir a etapa “${openStep.title}”? O cliente é avisado conforme as configurações do pedido.`)) toggleMilestone(openStep); }}>Concluir etapa</button>
          </div>
        </div>
        <dl className="pd-facts">
          <div><dt>Valor de venda</dt><dd className="mono">{saleValue ? money(saleValue, currency) : "—"}</dd></div>
          <div><dt>Quantidade</dt><dd className="mono">{Number(operation.quantity) ? `${fmt(Number(operation.quantity), 3)} ${operation.quantityUnit || ""}` : "—"}</dd></div>
          <div><dt>Incoterm</dt><dd>{[operation.incoterm, operation.portOfLoading].filter(Boolean).join(" ") || "—"}</dd></div>
          <div><dt>ETD / ETA</dt><dd>{formatDate(String(operation.shipmentDate || "")) || "—"} / —</dd></div>
          <div><dt>Fornecedor</dt><dd>{operation.supplierName || "—"}</dd></div>
          <div><dt>Responsável</dt><dd>{operation.internalResponsible || "—"}</dd></div>
        </dl>
      </section>

      <section className="pd-card pd-phases" aria-label="Fases do pedido">
        <ol>
          {phaseInfo.map((item, index) => {
            const state = index < current ? "past" : index === current ? "now" : "next";
            return (
              <li key={item.key}>
                <div className={`line${index < current ? " line--done" : ""}`} aria-hidden="true" style={{ left: index === 0 ? "50%" : 0, right: index === 5 ? "50%" : 0 }} />
                <button aria-pressed={index === selected} onClick={() => setPhase(index)}>
                  <span className={`dot dot--${state}`}>{state === "past" ? "✓" : index + 1}</span>
                  <span className="name">{item.name}</span>
                  <span className="sum">{item.done}/{item.total} · {item.files} arq.</span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="pd-cols">
        <div className="pd-main">
          {selected === 0 && (
            <Emission operationId={operationId} data={data} form={form} dirty={dirty} activity={activity}
              setForm={(next) => { setForm(next); setDirty(true); dirtyRef.current = true; }}
              onEditing={onEditing} baseRef={baseRef} versionRef={versionRef} onSaved={onFormSaved}
              onReset={(next) => { setForm(next); baseRef.current = next; dirtyRef.current = false; setDirty(false); }}
              onPreview={setPreview} onError={setError} />
          )}

          <section className="pd-card pd-card--scroll" aria-labelledby="etapas">
            <div className="pd-card-head">
              <h2 id="etapas">Fase {selected + 1} · {ORDER_PHASES[selected].name}</h2>
              <span className="hint">{phaseInfo[selected].done} de {phaseInfo[selected].total} etapas concluídas</span>
            </div>
            <table className="pd-table">
              <thead><tr><th>Tarefa</th><th>Responsável</th><th>Prazo</th><th>Situação</th><th><span className="sr-only">Comentários</span></th></tr></thead>
              <tbody>
                {phaseMilestones.map((milestone) => {
                  const done = isClosedStatus(milestone.status);
                  const late = !done && Boolean(milestone.dueDate) && relativeDue(milestone.dueDate, today).tone === "bad";
                  const count = countFor(`m:${milestone.code}`);
                  return (
                    <tr key={milestone.code}>
                      <td>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                          <button className="pd-check" aria-pressed={done} aria-label={`Marcar como concluída: ${milestone.title}`} disabled={busy} onClick={() => toggleMilestone(milestone)}>{done ? "✓" : ""}</button>
                          <button className="pd-link" onClick={() => setTarget({ kind: "m", code: milestone.code })}>
                            <span className="t" style={{ color: done ? "var(--et2-muted)" : undefined }}>{milestone.title}</span>
                            <span className="d">{milestone.nextAction || "Etapa do pedido"}</span>
                          </button>
                        </div>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{milestone.responsibleName ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Avatar name={milestone.responsibleName} email={milestone.responsibleEmail} />{milestone.responsibleName}</span> : <span className="pd-sub">Sem responsável</span>}</td>
                      <td style={{ whiteSpace: "nowrap", color: milestone.status === "Bloqueado" || late ? "var(--et2-bad)" : "var(--et2-ink-2)", fontWeight: milestone.status === "Bloqueado" ? 600 : undefined }}>{formatDate(milestone.dueDate) || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}><span className={`pd-badge pd-badge--${TONE[milestone.status] ?? "todo"}`}>{milestone.status}</span></td>
                      <td style={{ whiteSpace: "nowrap" }}><button className="pd-btn pd-btn--xs" onClick={() => setTarget({ kind: "m", code: milestone.code })}>{count ? `${count} coment.` : "Comentar"}</button></td>
                    </tr>
                  );
                })}
                {phaseTasks.map((task) => {
                  const done = task.status === "Concluído";
                  const late = !done && Boolean(task.dueDate) && relativeDue(task.dueDate, today).tone === "bad";
                  const count = countFor(`t:${task.id}`);
                  return (
                    <tr key={`t${task.id}`}>
                      <td>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                          <button className="pd-check" aria-pressed={done} aria-label={`Concluir: ${task.description}`} disabled={busy} onClick={() => toggleTask(task)}>{done ? "✓" : ""}</button>
                          <button className="pd-link" onClick={() => setTarget({ kind: "t", id: task.id })}>
                            <span className="t" style={{ color: done ? "var(--et2-muted)" : undefined, textDecoration: done ? "line-through" : undefined }}>{task.description}</span>
                            <span className="d">{task.note || "Tarefa"}</span>
                          </button>
                        </div>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{task.responsibleName ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Avatar name={task.responsibleName} email={task.responsibleEmail} />{task.responsibleName}</span> : <span className="pd-sub">Sem responsável</span>}</td>
                      <td style={{ whiteSpace: "nowrap", color: late ? "var(--et2-bad)" : "var(--et2-ink-2)" }}>{formatDate(task.dueDate) || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}><span className={`pd-badge pd-badge--${TONE[task.status] ?? "todo"}`}>{task.status === "Pendente" ? "A fazer" : task.status}</span></td>
                      <td style={{ whiteSpace: "nowrap" }}><button className="pd-btn pd-btn--xs" onClick={() => setTarget({ kind: "t", id: task.id })}>{count ? `${count} coment.` : "Comentar"}</button></td>
                    </tr>
                  );
                })}
                <AddTask disabled={busy} onAdd={(description) => run(() => postControl({ action: "operation-task-create", operationId, description }))} />
              </tbody>
            </table>
          </section>

          <section className="pd-card pd-card--scroll" aria-labelledby="arquivos">
            <div className="pd-card-head" style={{ alignItems: "center" }}>
              <h2 id="arquivos">Arquivos desta fase <span style={{ fontWeight: 400, color: "var(--et2-muted)" }}>· {phaseDocs.length}</span></h2>
              <UploadButton operationId={operationId} category={PHASE_UPLOAD_CATEGORY[selected]} onDone={refreshAll} onError={setError} />
            </div>
            <FileTable docs={phaseDocs} onView={setPreview} onDelete={deleteDoc} empty="Nenhum arquivo nesta fase ainda." />
            {otherDocs.length > 0 && (
              <details className="pd-more">
                <summary>Outros arquivos do pedido <span style={{ fontWeight: 400, color: "var(--et2-muted)" }}>· {otherDocs.length}</span></summary>
                <FileTable docs={otherDocs} onView={setPreview} onDelete={deleteDoc} empty="" />
              </details>
            )}
          </section>

          <details className="pd-card">
            <summary style={{ padding: "14px 20px", cursor: "pointer", fontWeight: 600, fontSize: 16 }}>Todos os dados do pedido</summary>
            <AllFields operation={operation} onSaved={refreshAll} onError={setError} />
          </details>
        </div>

        <aside className="pd-side">
          <section className="pd-card" aria-labelledby="docs">
            <div className="pd-card-head"><h2 id="docs">Documentos do pedido</h2></div>
            <OrderDocuments docs={docs} form={form} data={data} onPhase={setPhase} />
          </section>

          <TeamActivity operationId={operationId} activity={activity} milestones={milestones} tasks={data.tasks} onPosted={loadActivity} onError={setError} />

          <section className="pd-card" aria-labelledby="fin" style={{ padding: "14px 20px" }}>
            <h2 id="fin" style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>Financeiro</h2>
            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <div><dt className="pd-sub">Venda</dt><dd className="mono" style={{ margin: "3px 0 0" }}>{saleValue ? money(saleValue, form.currency || currency) : "—"}</dd></div>
              <div><dt className="pd-sub">Compra</dt><dd className="mono" style={{ margin: "3px 0 0" }}>{purchase.value ? money(purchase.value, purchase.currency) : "—"}{purchase.value > 0 && purchaseIndicative && <span className="pd-sub" style={{ display: "block" }}>indicativo · {money(terms.purchaseUnitPrice, purchase.currency)} por {Number(operation.volumeM3) ? "m³" : form.quantityUnit}</span>}</dd></div>
              <div><dt className="pd-sub">Logística (prévia)</dt><dd className="mono" style={{ margin: "3px 0 0" }}>{!hasLogistics ? "—" : logisticsValue !== null ? money(logisticsValue, form.currency) : logisticsParts}{hasLogistics && <span className="pd-sub" style={{ display: "block" }}>{logisticsValue !== null ? logisticsParts : "informe o câmbio"}</span>}</dd></div>
              <div><dt className="pd-sub">Margem{logisticsValue ? " (com logística)" : ""}</dt><dd className="mono" style={{ margin: "3px 0 0" }}>{margin === null ? (purchase.value && saleValue ? "informe o câmbio" : "—") : `${margin.toFixed(1).replace(".", ",")}%`}{margin !== null && estimate.inSale !== null && <span className="pd-sub" style={{ display: "block" }}>{money(estimate.inSale, form.currency)}</span>}</dd></div>
              <div><dt className="pd-sub">Pagamento</dt><dd style={{ margin: "3px 0 0" }}>{form.paymentTerms || "Não registrado"}</dd></div>
            </dl>
          </section>
          <Link className="pd-sub" href={`/classico?processo=${operationId}`}>Abrir na versão anterior (EUDR e supply chain)</Link>
        </aside>
      </div>

      {(selectedMilestone || selectedTask) && (
        <TaskDrawer key={selectedMilestone ? `m${selectedMilestone.code}${selectedMilestone.updatedAt}` : `t${selectedTask?.id}${selectedTask?.updatedAt}`}
          operation={operation} phaseName={`Fase ${drawerPhase + 1} · ${ORDER_PHASES[drawerPhase].name}`}
          milestone={selectedMilestone} task={selectedTask} activity={activity} uploadCategory={PHASE_UPLOAD_CATEGORY[drawerPhase]}
          onClose={() => setTarget(null)} onChanged={refreshAll} onError={setError} saveMilestone={saveMilestone} />
      )}

      {preview && (
        <div className="pd-overlay" role="dialog" aria-modal="true" aria-label="Visualizar arquivo" onClick={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
          <div className="pd-modal pd-modal--wide">
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--et2-line)", display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{preview.title}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <a className="pd-btn pd-btn--sm" href={preview.download}>Baixar</a>
                <button className="pd-btn pd-btn--sm pd-btn--dark" onClick={() => setPreview(null)}>Fechar</button>
              </div>
            </div>
            <iframe title={preview.title} src={preview.src} style={{ flex: 1, width: "100%", border: 0, background: "#e5e7eb" }} />
          </div>
        </div>
      )}

      {toast && (
        <div className="pd-toast" role="status">
          <span>{toast}</span>
          <button onClick={() => setToast("")}>Ok</button>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------------------

type Conflict = { theirs: Form; base: Form; version: string; picks: Partial<Record<keyof Form, "mine" | "theirs">> };

function Emission({ operationId, data, form, dirty, activity, setForm, onEditing, baseRef, versionRef, onSaved, onReset, onPreview, onError }: {
  operationId: number; data: Snapshot; form: Form; dirty: boolean; activity: Activity | null;
  setForm: (form: Form) => void; onEditing: (key: string) => void;
  baseRef: MutableRefObject<Form | null>; versionRef: MutableRefObject<string>;
  onSaved: () => void; onReset: (form: Form) => void; onPreview: (preview: Preview) => void; onError: (message: string) => void;
}) {
  const [tab, setTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const doc = DOC_TABS[tab];
  const operation = data.operation;
  const reference = String(operation.reference);
  const set = (key: keyof Form, value: string) => setForm({ ...form, [key]: value });
  const setItems = (key: "soItems" | "poItems" | "plItems", items: ItemDraft[]) => setForm({ ...form, [key]: items });
  const editor = activity?.viewing.find((person) => person.editing === doc.key);

  useEffect(() => { onEditing(dirty ? doc.key : ""); }, [dirty, doc.key, onEditing]);

  const save = useCallback(async (payload: Form, version: string, force = false) => {
    setSaving(true);
    try {
      const result = await postControl({ ...commercialBody(payload, data), ...(force ? {} : { expectedUpdatedAt: version }) });
      if (result.conflict) {
        const current = result.conflict as unknown as { operation: Operation; orderDetails: OrderDetails; settings: Settings };
        setConflict({ theirs: formFrom(current), base: baseRef.current ?? payload, version: current.settings?.updatedAt ?? "", picks: {} });
        return false;
      }
      baseRef.current = payload;
      setSavedAt(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
      onSaved();
      return true;
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao salvar o documento.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [data, baseRef, onSaved, onError]);

  // Salvamento automático: 2,5 s depois da última alteração.
  useEffect(() => {
    if (!dirty || saving || conflict) return;
    const timer = window.setTimeout(() => { save(form, versionRef.current); }, 2500);
    return () => window.clearTimeout(timer);
  }, [form, dirty, saving, conflict, save, versionRef]);

  const docUrl = (format = "") => `/api/export-control?operationId=${operationId}&document=${doc.key}${format ? `&format=${format}` : ""}`;
  async function ensureSaved() {
    if (!dirty) return true;
    return save(form, versionRef.current);
  }
  async function view(title = `${doc.prefix}-${reference} — ${doc.name}`) {
    if (await ensureSaved()) onPreview({ title, src: docUrl(), download: docUrl("docx") });
  }
  async function printPdf() {
    if (!(await ensureSaved())) return;
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
    frame.src = docUrl();
    frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(() => frame.remove(), 60_000); };
    document.body.appendChild(frame);
  }

  const status = docStatus(form, data);
  const check = docCheck(tab, form);

  // Conflito: o que só a outra pessoa mudou entra automaticamente; o que os dois mudaram pede escolha.
  const base = conflict?.base ?? form;
  const rows = conflict ? FORM_LABELS.filter(([key]) => !same(conflict.theirs[key], base[key]) && !same(conflict.theirs[key], form[key])) : [];
  const lastEditor = activity?.activity.find((item) => item.what === "editou os documentos do pedido" && item.who !== activity.me);
  const editorName = lastEditor ? { name: activity?.members.find((member) => member.email === lastEditor.who)?.name || lastEditor.who, at: when(lastEditor.at) } : null;

  async function resolve(choice: "discard" | "mine" | "combine") {
    if (!conflict) return;
    const { theirs, version, picks } = conflict;
    setConflict(null);
    versionRef.current = version;
    if (choice === "discard") { onReset(theirs); return; }
    const next = { ...form };
    if (choice === "combine") {
      for (const [key] of FORM_LABELS) {
        const mineChanged = !same(form[key], base[key]);
        const theirsChanged = !same(theirs[key], base[key]);
        if (theirsChanged && (!mineChanged || picks[key] === "theirs")) (next as Record<string, unknown>)[key] = theirs[key];
      }
    }
    baseRef.current = theirs;
    setForm(next);
    await save(next, version);
  }

  const field = (key: keyof Form, label: string, type = "text") => (
    <label key={key}>{label}
      <input className="pd-input" type={type} value={String(form[key])} onChange={(event) => set(key, event.target.value)} />
    </label>
  );
  const fixed = (label: string, value: unknown) => (
    <label key={label}>{label}<input className="pd-input" readOnly value={text(value) || "—"} title="Preenchido em outra parte do pedido" /></label>
  );

  return (
    <section className="pd-card" aria-labelledby="emissao">
      <div className="pd-card-head">
        <h2 id="emissao">Emissão de documentos</h2>
        <span className="hint">Os dados do pedido alimentam todos os documentos</span>
      </div>
      <div className="pd-emit">
        <div className="pd-tabs" role="tablist" aria-label="Documentos">
          {DOC_TABS.map((item, index) => (
            <button key={item.key} role="tab" aria-selected={tab === index} onClick={() => setTab(index)}>
              <span style={{ fontWeight: 500 }}>{item.name}</span>
              <span className="num mono">{item.prefix}-{reference}</span>
              <span className={`pd-badge pd-badge--${status[index].tone}`}>{status[index].label}</span>
            </button>
          ))}
        </div>

        <div className="pd-panel" role="tabpanel" aria-label={doc.name}>
          <div className="pd-panel-head">
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{doc.name}</div>
              <div className="pd-sub">{doc.hint}</div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button className="pd-btn pd-btn--sm" onClick={() => view()} disabled={saving}>Visualizar</button>
              <button className="pd-btn pd-btn--sm" onClick={printPdf} disabled={saving}>Baixar PDF</button>
              <a className="pd-btn pd-btn--sm" href={docUrl("docx")} onClick={async (event) => { if (dirty) { event.preventDefault(); if (await ensureSaved()) window.location.href = docUrl("docx"); } }}>Baixar Word</a>
              <button className="pd-btn pd-btn--sm pd-btn--dark" disabled={saving} onClick={() => view(`${doc.prefix}-${reference} — ${doc.name} · emitido em ${new Date().toLocaleDateString("pt-BR")}`)}>{status[tab].label === "Emitido" ? "Emitir nova revisão" : `Emitir ${doc.short}`}</button>
            </div>
          </div>

          {editor && (
            <div className="pd-lock" role="status">
              <Avatar name={editor.name || editor.email} email={editor.email} size={26} />
              <span><b>{editor.name || editor.email}</b> está editando este documento agora. Você pode continuar: se os dois mudarem o mesmo campo, a tela pede para escolher.</span>
            </div>
          )}

          {tab === 0 && (
            <div className="pd-fields">
              {field("customerName", "Comprador / Consignee")}{field("contractNumber", "PO do cliente")}{field("incoterm", "Incoterm")}
              {field("currency", "Moeda")}{field("portOfLoading", "Porto de embarque")}{field("portOfDischarge", "Porto de destino")}
              {field("shipmentDate", "Embarque até", "date")}{field("hsCode", "NCM / HS")}{field("paymentTerms", "Pagamento")}
            </div>
          )}
          {tab === 1 && (
            <div className="pd-fields">
              {fixed("Fornecedor", operation.supplierName)}{field("poTrading", "Comprador / trading")}{field("poIncoterm", "Incoterm compra")}
              {field("poCurrency", "Moeda")}{fixed("Entrega até", formatDate(form.shipmentDate))}{field("poPayment", "Pagamento")}
            </div>
          )}
          {tab === 2 && (
            <div className="pd-fields">
              {fixed("Tipo", "Commercial Invoice")}{fixed("Data", new Date().toLocaleDateString("pt-BR"))}{field("customerName", "Comprador / Consignee")}
              {fixed("Navio / viagem", operation.vesselVoyage)}{field("plContainers", "Contêiner(es)")}{field("incoterm", "Incoterm")}
              {fixed("Exportador", operation.exporterName)}{field("paymentTerms", "Pagamento")}{field("hsCode", "NCM / HS")}
            </div>
          )}
          {tab === 3 && (
            <div className="pd-fields">
              {field("plConsignee", "Consignee")}{field("plMarks", "Marcação / Marks")}{field("plContainers", "Contêiner(es)")}
              {field("plNet", "Peso líquido total (kg)")}{field("plGross", "Peso bruto total (kg)")}{field("plPackages", "Total de volumes")}
            </div>
          )}

          {tab !== 3
            ? <OrderItemsTable rows={tab === 1 ? form.poItems : form.soItems} currency={tab === 1 ? form.poCurrency : form.currency} unit={form.quantityUnit}
                invoice={tab === 2} onChange={(rows) => setItems(tab === 1 ? "poItems" : "soItems", rows)} />
            : <PackingTable rows={form.plItems} containers={form.plContainers} onChange={(rows) => setItems("plItems", rows)} />}

          <div className="pd-foot">
            <span style={{ color: check.startsWith("!") ? "var(--et2-warn)" : check.startsWith("✓") ? "var(--et2-ok)" : undefined }}>{check}</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="pd-sub">{saving ? "Salvando…" : dirty ? "Alterações não salvas" : savedAt ? `Salvo automaticamente · ${savedAt}` : "Tudo salvo"}</span>
              <button className="pd-btn pd-btn--sm" disabled={saving || !dirty} onClick={() => save(form, versionRef.current)}>Salvar</button>
            </span>
          </div>
        </div>
      </div>

      {conflict && (
        <div className="pd-overlay" role="dialog" aria-modal="true" aria-label="Alterações simultâneas">
          <div className="pd-modal pd-conflict">
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--et2-line)" }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{editorName ? `${editorName.name} salvou este documento ${editorName.at}` : "Outra pessoa salvou este documento"}</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#4b5563" }}>Nada foi perdido. Escolha como combinar as alterações:</p>
            </div>
            <table className="pd-table" style={{ minWidth: 0, fontSize: 13 }}>
              <thead><tr><th>Campo</th><th>Versão de {editorName?.name ?? "outra pessoa"}</th><th>Sua versão</th></tr></thead>
              <tbody>
                {rows.map(([key, label]) => {
                  const mineChanged = !same(form[key], base[key]);
                  const pick = mineChanged ? (conflict.picks[key] ?? "mine") : "theirs";
                  const choose = (value: "mine" | "theirs") => { if (mineChanged) setConflict({ ...conflict, picks: { ...conflict.picks, [key]: value } }); };
                  return (
                    <tr key={key}>
                      <td>{label}</td>
                      <td className={`${mineChanged ? "pick" : ""} ${pick === "theirs" ? "on" : ""}`} onClick={() => choose("theirs")}>{show(conflict.theirs[key])}{pick === "theirs" ? " (novo)" : ""}</td>
                      <td className={`mine ${mineChanged ? "pick" : ""} ${pick === "mine" ? "on" : ""}`} onClick={() => choose("mine")}>{show(form[key])}{mineChanged && pick === "mine" ? " (seu)" : ""}</td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={3}>As alterações não se sobrepõem.</td></tr>}
              </tbody>
            </table>
            <div style={{ padding: "12px 20px", fontSize: 12, color: "#4b5563", borderTop: "1px solid var(--et2-line-2)" }}>Campos diferentes são combinados automaticamente. Só o que os dois mudaram precisa de escolha — clique na versão que fica.</div>
            <div style={{ padding: "14px 20px", borderTop: "1px solid var(--et2-line)", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
              <button className="pd-btn" onClick={() => resolve("discard")}>Descartar as minhas</button>
              <button className="pd-btn" onClick={() => resolve("mine")}>Manter as minhas</button>
              <button className="pd-btn pd-btn--dark" onClick={() => resolve("combine")}>Combinar as duas ✓</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function docStatus(form: Form, data: Snapshot) {
  const so = itemsTotal(form.soItems);
  const po = itemsTotal(form.poItems);
  const confirmed = data.milestones.some((milestone) => milestone.code === "ORDER_CONFIRMED" && milestone.status === "Concluído");
  const plVolume = form.plItems.reduce((sum, row) => sum + num(row.cbm), 0);
  const divergent = plVolume > 0 && so.volume > 0 && isM3(form.quantityUnit) && Math.abs(plVolume - so.volume) / so.volume > 0.005;
  return [
    so.value ? (confirmed ? { label: "Emitido", tone: "ok" } : { label: "Pronto", tone: "ok" }) : { label: "A preencher", tone: "todo" },
    po.value ? { label: "Pronto", tone: "ok" } : { label: "A preencher", tone: "todo" },
    so.value ? { label: "A emitir", tone: "todo" } : { label: "A preencher", tone: "todo" },
    !form.plItems.length ? { label: "A preencher", tone: "todo" } : divergent ? { label: "Divergente", tone: "bad" } : { label: "Pronto", tone: "ok" },
  ];
}

function docCheck(tab: number, form: Form) {
  const so = itemsTotal(form.soItems);
  const po = itemsTotal(form.poItems);
  if (tab === 0) return so.value ? (form.contractNumber ? "✓ Ligado ao PO do cliente" : "! Informe o PO do cliente") : "! Preencha os itens do pedido";
  if (tab === 1) return po.value && so.value && form.poCurrency === form.currency ? `Margem estimada: ${(((so.value - po.value) / so.value) * 100).toFixed(1).replace(".", ",")}%` : po.value ? "Moeda da compra diferente da venda" : "! Preencha os itens da compra";
  if (tab === 2) return form.plItems.length ? "✓ Packing list preenchido" : "! Aguardando packing list";
  const plVolume = form.plItems.reduce((sum, row) => sum + num(row.cbm), 0);
  if (plVolume && so.volume && isM3(form.quantityUnit) && Math.abs(plVolume - so.volume) / so.volume > 0.005) return `! Volume ${fmt(plVolume, 3)} m³ diverge do pedido (${fmt(so.volume, 3)} m³)`;
  return form.plItems.length ? "✓ Conferido com o pedido" : "! Adicione os volumes da carga";
}

function OrderItemsTable({ rows, currency, unit, invoice, onChange }: { rows: ItemDraft[]; currency: string; unit: string; invoice: boolean; onChange: (rows: ItemDraft[]) => void }) {
  const total = itemsTotal(rows);
  const edit = (index: number, key: string, value: string) => onChange(rows.map((row, position) => position === index ? { ...row, [key]: value } : row));
  return (
    <div className="pd-items">
      <table>
        <thead><tr><th>{invoice ? "Descrição" : "Produto"}</th><th>{invoice ? "Lote / qualidade" : "Qualidade"}</th><th>Medida</th><th className="r">Quantidade ({unit})</th><th className="r">Preço unit.</th><th className="r">Total</th><th><span className="sr-only">Remover</span></th></tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td><input aria-label="Produto" value={row.species ?? ""} onChange={(event) => edit(index, "species", event.target.value)} /></td>
              <td><input aria-label="Qualidade" value={row.quality ?? ""} onChange={(event) => edit(index, "quality", event.target.value)} /></td>
              <td><input aria-label="Medida" value={row.size ?? ""} onChange={(event) => edit(index, "size", event.target.value)} /></td>
              <td className="r"><input aria-label="Quantidade" inputMode="decimal" value={row.volume ?? ""} onChange={(event) => edit(index, "volume", event.target.value)} /></td>
              <td className="r"><input aria-label="Preço unitário" inputMode="decimal" value={row.unitPrice ?? ""} onChange={(event) => edit(index, "unitPrice", event.target.value)} /></td>
              <td className="r" style={{ padding: "8px 10px" }}>{fmt(num(row.volume) * num(row.unitPrice))}</td>
              <td><button className="pd-x" aria-label="Remover item" onClick={() => onChange(rows.filter((_, position) => position !== index))}>×</button></td>
            </tr>
          ))}
          <tr className="total"><td>Total</td><td /><td /><td className="r">{fmt(total.volume, 3)} {unit}</td><td /><td className="r">{currency} {fmt(total.value)}</td><td /></tr>
        </tbody>
      </table>
      <div className="add"><button className="pd-dashed" onClick={() => onChange([...rows, { species: "", quality: "", size: "", volume: "", unitPrice: "" }])}>+ Adicionar item</button></div>
    </div>
  );
}

function PackingTable({ rows, containers, onChange }: { rows: ItemDraft[]; containers: string; onChange: (rows: ItemDraft[]) => void }) {
  const edit = (index: number, key: string, value: string) => onChange(rows.map((row, position) => position === index ? { ...row, [key]: value } : row));
  const sum = (key: string) => rows.reduce((total, row) => total + num(row[key]), 0);
  const columns: Array<[string, string]> = [["packages", "Volumes"], ["totalPcs", "Peças"], ["netWeight", "Peso líq. kg"], ["grossWeight", "Peso bruto kg"], ["cbm", "m³"]];
  return (
    <div className="pd-items">
      <table>
        <thead><tr><th>Descrição</th>{columns.map(([key, label]) => <th key={key} className="r">{label}</th>)}<th>Contêiner</th><th><span className="sr-only">Remover</span></th></tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td><input aria-label="Descrição" value={row.description ?? ""} onChange={(event) => edit(index, "description", event.target.value)} /></td>
              {columns.map(([key, label]) => <td key={key} className="r"><input aria-label={label} inputMode="decimal" value={row[key] ?? ""} onChange={(event) => edit(index, key, event.target.value)} /></td>)}
              <td style={{ padding: "8px 10px", color: "var(--et2-ink-2)" }}>{containers || "—"}</td>
              <td><button className="pd-x" aria-label="Remover item" onClick={() => onChange(rows.filter((_, position) => position !== index))}>×</button></td>
            </tr>
          ))}
          <tr className="total"><td>Total</td>{columns.map(([key]) => <td key={key} className="r">{fmt(sum(key), 3)}</td>)}<td /><td /></tr>
        </tbody>
      </table>
      <div className="add"><button className="pd-dashed" onClick={() => onChange([...rows, { description: "", packages: "", totalPcs: "", netWeight: "", grossWeight: "", cbm: "" }])}>+ Adicionar item</button></div>
    </div>
  );
}

function AddTask({ disabled, onAdd }: { disabled: boolean; onAdd: (description: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <tr>
      <td colSpan={5}>
        <form style={{ display: "flex", gap: 8 }} onSubmit={(event) => { event.preventDefault(); if (value.trim()) { onAdd(value.trim()); setValue(""); } }}>
          <input className="pd-input" placeholder="+ Adicionar tarefa nesta fase" aria-label="Nova tarefa" value={value} onChange={(event) => setValue(event.target.value)} />
          <button className="pd-btn pd-btn--sm" disabled={disabled || !value.trim()}>Adicionar</button>
        </form>
      </td>
    </tr>
  );
}

function extOf(doc: Doc) {
  const ext = (doc.fileName.includes(".") ? doc.fileName.split(".").pop() ?? "" : "").toUpperCase().slice(0, 4);
  const kind = ext === "PDF" ? "pdf" : /JPG|JPEG|PNG|GIF|WEBP|HEIC/.test(ext) ? "img" : "";
  return { ext: ext || "ARQ", kind };
}

function FileTable({ docs, onView, onDelete, empty }: { docs: Doc[]; onView: (preview: Preview) => void; onDelete: (doc: Doc) => void; empty: string }) {
  if (!docs.length) return empty ? <p style={{ margin: 0, padding: "18px 20px", color: "var(--et2-muted)" }}>{empty}</p> : null;
  return (
    <table className="pd-table">
      <thead><tr><th>Arquivo</th><th>Etapa</th><th>Enviado</th><th style={{ textAlign: "right" }}>Ações</th></tr></thead>
      <tbody>
        {docs.map((doc) => {
          const { ext, kind } = extOf(doc);
          return (
            <tr key={doc.id}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className={`pd-ext${kind ? ` pd-ext--${kind}` : ""}`}>{ext}</span>
                  <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>{doc.fileName}<div className="pd-sub">{sizeLabel(doc.sizeBytes)}{doc.documentType && doc.documentType !== "Outro documento" ? ` · ${doc.documentType}` : ""}</div></div>
                </div>
              </td>
              <td style={{ color: "var(--et2-ink-2)" }}>{doc.category.replace(/^Export Control · /, "")}</td>
              <td style={{ color: "var(--et2-ink-2)", whiteSpace: "nowrap" }}>{doc.sourceSystem && doc.sourceSystem !== "ExportaTrust" ? doc.sourceSystem : "Equipe"}<div className="pd-sub">{formatDate(doc.uploadedAt)}</div></td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button className="pd-btn pd-btn--sm" onClick={() => onView({ title: doc.fileName, src: `/api/documents?documentId=${doc.id}&inline=1`, download: `/api/documents?documentId=${doc.id}` })}>Visualizar</button>
                <a className="pd-btn pd-btn--sm" style={{ marginLeft: 6 }} href={`/api/documents?documentId=${doc.id}`}>Baixar</a>
                <button className="pd-btn pd-btn--sm" style={{ marginLeft: 6, color: "var(--et2-bad)" }} aria-label={`Excluir ${doc.fileName}`} onClick={() => onDelete(doc)}>Excluir</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

async function uploadFile(operationId: number, category: string, file: File) {
  const form = new FormData();
  form.set("operationId", String(operationId));
  form.set("category", category);
  form.set("file", file);
  const response = await fetch("/api/documents", { method: "POST", body: form });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
}

function UploadButton({ operationId, category, onDone, onError }: { operationId: number; category: string; onDone: () => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await uploadFile(operationId, category, file);
      onDone();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao anexar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className="pd-btn pd-btn--sm" style={{ cursor: busy ? "wait" : "pointer" }}>
      {busy ? "Enviando…" : "+ Anexar arquivo"}
      <input type="file" hidden disabled={busy} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} />
    </label>
  );
}

function OrderDocuments({ docs, form, data, onPhase }: { docs: Doc[]; form: Form; data: Snapshot; onPhase: (phase: number) => void }) {
  const [all, setAll] = useState(false);
  const status = docStatus(form, data);
  const list: Array<{ key: string; name: string; phase: number | null; status: string; tone: string }> = [
    ...DOC_TABS.map((item, index) => ({ key: item.key, name: item.list, phase: 0, status: status[index].label, tone: status[index].tone })),
    ...docs.map((doc) => ({
      key: `d${doc.id}`, name: doc.documentType && doc.documentType !== "Outro documento" ? doc.documentType : doc.fileName, phase: documentPhaseIndex(doc.category, doc.fileName),
      status: doc.status || "Recebido", tone: /aprovad|vigente|recebid|validad/i.test(doc.status) ? "ok" : /pendente|revis/i.test(doc.status) ? "warn" : "todo",
    })),
  ];
  const visible = all ? list : list.slice(0, 10);
  return (
    <div>
      {visible.map((item) => (
        <div key={item.key} className="pd-row">
          <div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{item.name}
            <div>{item.phase === null ? <span className="pd-sub">Sem fase</span> : <button className="pd-link pd-sub" onClick={() => onPhase(item.phase as number)}>Fase {(item.phase as number) + 1} · {ORDER_PHASES[item.phase as number].name}</button>}</div>
          </div>
          <span className={`pd-badge pd-badge--${item.tone}`}>{item.status}</span>
        </div>
      ))}
      {list.length > 10 && <div className="pd-row"><button className="pd-btn pd-btn--xs" onClick={() => setAll(!all)}>{all ? "Mostrar menos" : `Ver todos (${list.length})`}</button></div>}
    </div>
  );
}

/** Campo de texto com sugestão de @menção (membros da empresa) e, opcionalmente, arrastar arquivo. */
function MentionInput({ value, onChange, members, placeholder, label, onSubmit, onFile }: { value: string; onChange: (value: string) => void; members: Member[]; placeholder: string; label: string; onSubmit: () => void; onFile?: (file: File) => void }) {
  const [drag, setDrag] = useState(false);
  const query = /(?:^|\s)@([^\s@]*)$/.exec(value)?.[1];
  const options = query === undefined ? [] : members.filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  return (
    <div style={{ position: "relative", flex: 1, borderRadius: 6 }} className={drag ? "pd-compose--drop" : undefined}
      onDragOver={onFile ? (event) => { event.preventDefault(); setDrag(true); } : undefined} onDragLeave={() => setDrag(false)}
      onDrop={onFile ? (event) => { event.preventDefault(); setDrag(false); const file = event.dataTransfer.files?.[0]; if (file) onFile(file); } : undefined}>
      <input className="pd-input" aria-label={label} placeholder={placeholder} value={value} style={{ fontSize: 13 }}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !options.length && value.trim()) { event.preventDefault(); onSubmit(); } }} />
      {options.length > 0 && (
        <ul role="listbox" aria-label="Mencionar" style={{ position: "absolute", left: 0, right: 0, bottom: "100%", margin: "0 0 4px", padding: 4, listStyle: "none", background: "#fff", border: "1px solid var(--et2-line)", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,.08)", zIndex: 5 }}>
          {options.map((member) => (
            <li key={member.email}>
              <button type="button" role="option" aria-selected="false" className="pd-link" style={{ display: "flex", gap: 8, alignItems: "center", width: "100%", padding: "6px 8px" }}
                onClick={() => onChange(value.replace(/@([^\s@]*)$/, `@${member.name} `))}>
                <Avatar name={member.name} email={member.email} size={22} />{member.name} <span className="pd-sub">{member.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const mentionsIn = (value: string, members: Member[]) => members.filter((member) => value.includes(`@${member.name}`)).map((member) => member.email);

function TeamActivity({ operationId, activity, milestones, tasks, onPosted, onError }: { operationId: number; activity: Activity | null; milestones: Milestone[]; tasks: Task[]; onPosted: () => void; onError: (message: string) => void }) {
  const [value, setValue] = useState("");
  const [all, setAll] = useState(false);
  const members = activity?.members ?? [];
  const nameOf = (email: string, fallback = "") => members.find((member) => member.email === email)?.name || fallback || email.split("@")[0];
  const targetName = (key: string) => key.startsWith("m:") ? milestones.find((milestone) => `m:${milestone.code}` === key)?.title : key.startsWith("t:") ? tasks.find((task) => `t:${task.id}` === key)?.description : "";
  const feed = [
    ...(activity?.comments ?? []).map((comment) => {
      const where = comment.targetKey ? targetName(comment.targetKey) : "";
      return { key: `c${comment.id}`, at: comment.createdAt, email: comment.authorEmail, who: nameOf(comment.authorEmail, comment.authorName), text: `${where ? `comentou em “${where}”: ` : "comentou: "}${comment.body}`, mentioned: comment.mentionsJson.includes(activity?.me ?? "~") };
    }),
    ...(activity?.activity ?? []).map((event) => ({ key: `a${event.id}`, at: event.at, email: event.who, who: nameOf(event.who), text: `${event.what}${event.detail ? ` “${event.detail}”` : ""}`, mentioned: false })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const visible = all ? feed.slice(0, 80) : feed.slice(0, 6);

  async function post() {
    if (!value.trim()) return;
    try {
      await postActivity({ operationId, action: "comment", text: value, mentions: mentionsIn(value, members) });
      setValue("");
      onPosted();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao comentar.");
    }
  }

  return (
    <section className="pd-card" aria-labelledby="ativ">
      <div className="pd-card-head"><h2 id="ativ">Atividade da equipe</h2></div>
      {visible.map((item) => (
        <div key={item.key} className="pd-row" style={{ alignItems: "flex-start", fontSize: 13, background: item.mentioned ? "#eff6ff" : undefined }}>
          <Avatar name={item.who} email={item.email} size={28} />
          <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><b>{item.who}</b> {item.text}<div className="pd-sub" style={{ marginTop: 2 }}>{when(String(item.at))}{item.mentioned ? " · você foi mencionado" : ""}</div></div>
        </div>
      ))}
      {!feed.length && <p style={{ margin: 0, padding: "12px 20px", color: "var(--et2-muted)" }}>Sem atividade ainda.</p>}
      {feed.length > 6 && <div className="pd-row"><button className="pd-btn pd-btn--xs" onClick={() => setAll(!all)}>{all ? "Mostrar menos" : `Ver toda a atividade (${feed.length})`}</button></div>}
      <div style={{ padding: "12px 20px", borderTop: "1px solid var(--et2-line)", display: "flex", gap: 8 }}>
        <MentionInput value={value} onChange={setValue} members={members} label="Comentar no pedido" placeholder="Comentar no pedido… use @ para mencionar" onSubmit={post} />
        <button className="pd-btn pd-btn--sm pd-btn--dark" disabled={!value.trim()} onClick={post}>Enviar</button>
      </div>
    </section>
  );
}

function TaskDrawer({ operation, phaseName, milestone, task, activity, uploadCategory, onClose, onChanged, onError, saveMilestone }: {
  operation: Operation; phaseName: string; milestone?: Milestone; task?: Task; activity: Activity | null; uploadCategory: string;
  onClose: () => void; onChanged: () => void; onError: (message: string) => void; saveMilestone: SaveMilestone;
}) {
  const start = milestone
    ? { title: milestone.title, responsibleName: milestone.responsibleName, responsibleEmail: milestone.responsibleEmail, dueDate: milestone.dueDate?.slice(0, 10) ?? "", status: milestone.status, detail: milestone.nextAction }
    : { title: task?.description ?? "", responsibleName: task?.responsibleName ?? "", responsibleEmail: task?.responsibleEmail ?? "", dueDate: task?.dueDate?.slice(0, 10) ?? "", status: task?.status ?? "Pendente", detail: task?.note ?? "" };
  const [draft, setDraft] = useState(start);
  const [conflict, setConflict] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState("");
  const members = activity?.members ?? [];
  const key = milestone ? `m:${milestone.code}` : `t:${task?.id}`;
  const thread = (activity?.comments ?? []).filter((comment) => comment.targetKey === key).sort((a, b) => a.id - b.id);
  const changed = JSON.stringify(draft) !== JSON.stringify(start);
  const nameOf = (email: string, fallback = "") => members.find((member) => member.email === email)?.name || fallback || email.split("@")[0];
  const responsibleKnown = members.some((member) => member.email === draft.responsibleEmail);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  async function save(force = false) {
    setBusy(true);
    try {
      let result: { conflict: Record<string, unknown> | null };
      if (milestone) {
        result = await saveMilestone(milestone, { responsibleName: draft.responsibleName, responsibleEmail: draft.responsibleEmail, dueDate: draft.dueDate, status: draft.status, nextAction: draft.detail }, force);
      } else if (task) {
        result = await postControl({ action: "operation-task-update", operationId: operation.id, taskId: task.id, sequence: task.sequence, scheduled: task.scheduled, description: draft.title, responsibleName: draft.responsibleName, responsibleEmail: draft.responsibleEmail, dueDate: draft.dueDate, status: draft.status, note: draft.detail, ...(force ? {} : { expectedUpdatedAt: task.updatedAt }) });
      } else return;
      if (result.conflict) setConflict(result.conflict);
      else { setConflict(null); onChanged(); }
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function send(body = value) {
    if (!body.trim()) return;
    try {
      await postActivity({ operationId: operation.id, action: "comment", target: key, text: body, mentions: mentionsIn(body, members) });
      setValue("");
      onChanged();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao comentar.");
    }
  }

  async function attach(file: File) {
    try {
      await uploadFile(operation.id, uploadCategory, file);
      await send(`📎 Anexou o arquivo ${file.name}${value.trim() ? ` — ${value.trim()}` : ""}`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao anexar.");
    }
  }

  const followers = activity?.followers ?? [];
  return (
    <aside className="pd-drawer" role="dialog" aria-label={milestone ? "Etapa" : "Tarefa"}>
      <div className="pd-drawer-head">
        <div><div className="pd-sub mono">{operation.reference} · {phaseName}</div><h2>{draft.title}</h2></div>
        <button className="pd-btn" aria-label="Fechar" style={{ minWidth: 36, justifyContent: "center", padding: 0 }} onClick={onClose}>×</button>
      </div>
      <dl>
        {task && <><dt>Tarefa</dt><dd><input className="pd-input" aria-label="Tarefa" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></dd></>}
        <dt>Responsável</dt>
        <dd>
          <select className="pd-input" aria-label="Responsável" value={responsibleKnown ? draft.responsibleEmail : ""} onChange={(event) => { const member = members.find((item) => item.email === event.target.value); setDraft({ ...draft, responsibleEmail: member?.email ?? "", responsibleName: member?.name ?? "" }); }}>
            <option value="">{!responsibleKnown && draft.responsibleName ? draft.responsibleName : "Sem responsável"}</option>
            {members.map((member) => <option key={member.email} value={member.email}>{member.name}</option>)}
          </select>
        </dd>
        <dt>Prazo</dt><dd><input className="pd-input" type="date" aria-label="Prazo" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></dd>
        <dt>Situação</dt>
        <dd><select className="pd-input" aria-label="Situação" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{(milestone ? STATUSES : TASK_STATUSES).map((status) => <option key={status}>{status}</option>)}</select></dd>
        <dt>{milestone ? "Próxima ação" : "Nota"}</dt><dd><input className="pd-input" aria-label={milestone ? "Próxima ação" : "Nota"} value={draft.detail} onChange={(event) => setDraft({ ...draft, detail: event.target.value })} /></dd>
        <dt>Seguidores</dt><dd>{followers.length ? followers.map((follower) => nameOf(follower.email, follower.name)).join(", ") : <span className="pd-sub">Ninguém segue este pedido ainda</span>}</dd>
      </dl>
      {conflict && (
        <div className="et2-alert et2-alert--warn" role="alert" aria-label="Alterações simultâneas" style={{ margin: "12px 18px 0" }}>
          <strong>Outra pessoa alterou {milestone ? "esta etapa" : "esta tarefa"} enquanto você editava.</strong>
          <div style={{ marginTop: 4 }}>Versão salva: {String(conflict.status ?? "")} · {String(conflict.responsibleName || "sem responsável")} · prazo {formatDate(String(conflict.dueDate ?? "")) || "—"}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="pd-btn pd-btn--sm" onClick={() => { setConflict(null); onChanged(); }}>Usar a versão salva</button>
            <button className="pd-btn pd-btn--sm pd-btn--dark" disabled={busy} onClick={() => save(true)}>Manter a minha</button>
          </div>
        </div>
      )}
      {changed && !conflict && (
        <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--et2-line)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="pd-btn pd-btn--sm" disabled={busy} onClick={() => setDraft(start)}>Desfazer</button>
          <button className="pd-btn pd-btn--sm pd-btn--dark" disabled={busy} onClick={() => save()}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      )}
      <div className="pd-thread">
        <h3>Comentários e anexos</h3>
        {thread.map((comment) => (
          <div key={comment.id} style={{ display: "flex", gap: 10, fontSize: 13 }}>
            <Avatar name={nameOf(comment.authorEmail, comment.authorName)} email={comment.authorEmail} size={28} />
            <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><b>{nameOf(comment.authorEmail, comment.authorName)}</b> <span className="pd-sub">· {when(comment.createdAt)}</span><div style={{ marginTop: 3, whiteSpace: "pre-wrap" }}>{comment.body}</div></div>
          </div>
        ))}
        {!thread.length && <p className="pd-sub" style={{ margin: 0 }}>Nenhum comentário ainda. Use @ para chamar alguém da equipe.</p>}
      </div>
      <div className="pd-compose">
        <MentionInput value={value} onChange={setValue} members={members} label="Escrever comentário" placeholder="Escreva… @ menciona, arraste arquivos" onSubmit={() => send()} onFile={attach} />
        <button className="pd-btn pd-btn--dark" disabled={!value.trim()} onClick={() => send()}>Enviar</button>
      </div>
    </aside>
  );
}

const FIELD_GROUPS: Array<{ title: string; fields: Array<[string, string]> }> = [
  { title: "Comercial", fields: [["euImporter", "Cliente / importador"], ["contractNumber", "Contrato / PO"], ["incoterm", "Incoterm"], ["currency", "Moeda"], ["commercialValue", "Valor comercial"], ["quantity", "Quantidade"], ["quantityUnit", "Unidade"], ["volumeM3", "Volume (m³)"], ["netWeightKg", "Peso líquido (kg)"], ["grossWeightKg", "Peso bruto (kg)"]] },
  { title: "Produto e origem", fields: [["product", "Produto"], ["hsCode", "NCM / HS"], ["rawMaterial", "Matéria-prima"], ["species", "Espécie"], ["forestOriginType", "Origem"], ["supplierName", "Fornecedor"], ["exporterName", "Exportador"], ["exporterTaxId", "CNPJ exportador"], ["productionUnit", "Unidade produtiva"], ["productionLocation", "Local de produção"], ["lotCodes", "Lotes"]] },
  { title: "Logística", fields: [["transportMode", "Modal"], ["portOfLoading", "Porto de embarque"], ["portOfDischarge", "Porto de destino"], ["destinationCountry", "País de destino"], ["shipmentDate", "ETD"], ["carrier", "Armador"], ["bookingNumber", "Booking"], ["billOfLadingNumber", "BL"], ["containerNumbers", "Contêineres"], ["vesselVoyage", "Navio / viagem"]] },
  { title: "EUDR e responsáveis", fields: [["euOperatorEori", "EORI"], ["eudrReference", "Referência DDS"], ["internalResponsible", "Responsável interno"], ["responsibleEmail", "E-mail do responsável"], ["status", "Situação"]] },
];
const NUMBER_FIELDS = new Set(["commercialValue", "quantity", "volumeM3", "netWeightKg", "grossWeightKg"]);
const READONLY_FIELDS = new Set(["status"]);
type Option = { id: number; name: string };

/** Dados do pedido: leitura e edição (grava só os campos alterados, com aviso se outra pessoa mudou antes). */
function AllFields({ operation, onSaved, onError }: { operation: Operation; onSaved: () => void; onError: (message: string) => void }) {
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [costsDraft, setCostsDraft] = useState<LogisticsDraft | null>(null);
  const [clients, setClients] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState("");
  const original = (key: string) => key === "shipmentDate" ? text(operation[key]).slice(0, 10) : NUMBER_FIELDS.has(key) ? fmt(Number(operation[key]) || 0, 3) : text(operation[key]);
  const valueOf = (key: string) => {
    const value = operation[key];
    if (value === null || value === undefined || value === "") return "";
    if (key === "shipmentDate") return formatDate(String(value));
    if (key === "commercialValue") return Number(value) ? money(Number(value), String(operation.currency || "USD")) : "";
    if (typeof value === "number") return value ? value.toLocaleString("pt-BR") : "";
    return String(value);
  };

  function startEdit() {
    const next: Record<string, string> = {};
    for (const group of FIELD_GROUPS) for (const [key] of group.fields) next[key] = original(key);
    setCostsDraft(logisticsDraft(parseLogisticsCosts(operation.logisticsCostsJson)));
    next.supplierId = text(operation.supplierId);
    next.importerClientId = text(operation.importerClientId);
    setDraft(next);
    setConflict("");
    api<{ clients: Array<{ id: number; legalName: string }> }>("/api/importer-clients").then((data) => setClients(data.clients.map((client) => ({ id: client.id, name: client.legalName })))).catch(() => {});
    api<{ suppliers: Array<{ id: number; legalName: string }> }>("/api/suppliers").then((data) => setSuppliers(data.suppliers.map((supplier) => ({ id: supplier.id, name: supplier.legalName })))).catch(() => {});
  }

  async function save(force = false) {
    if (!draft) return;
    const fields: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const costsChanged = costsDraft && JSON.stringify(costsFromDraft(costsDraft)) !== JSON.stringify(parseLogisticsCosts(operation.logisticsCostsJson));
    if (costsChanged) {
      fields.logisticsCosts = costsFromDraft(costsDraft);
      before.logisticsCostsJson = operation.logisticsCostsJson;
    }
    for (const [key, value] of Object.entries(draft)) {
      if (READONLY_FIELDS.has(key) || key === "supplierName") continue;
      const was = key === "supplierId" || key === "importerClientId" ? text(operation[key]) : original(key);
      if (value === was) continue;
      fields[key] = NUMBER_FIELDS.has(key) ? num(value) : value;
      if (key !== "supplierId" && key !== "importerClientId") before[key] = operation[key];
    }
    if (!Object.keys(fields).length) { setDraft(null); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/operations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: operation.id, fields, ...(force ? {} : { original: before }) }) });
      const result = await response.json().catch(() => ({})) as { error?: string; conflict?: boolean };
      if (response.status === 409 && result.conflict) { setConflict(result.error ?? "Outra pessoa alterou os dados."); return; }
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setDraft(null);
      onSaved();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Falha ao salvar os dados do pedido.");
    } finally {
      setBusy(false);
    }
  }

  const input = (key: string, label: string) => {
    if (!draft) return null;
    if (READONLY_FIELDS.has(key)) return <label key={key}>{label}<input className="pd-input" readOnly value={text(operation[key]) || "—"} title="Muda conforme as etapas" /></label>;
    if (key === "supplierName") return (
      <label key={key}>{label}
        <select className="pd-input" value={draft.supplierId} onChange={(event) => setDraft({ ...draft, supplierId: event.target.value })}>
          {!suppliers.some((item) => String(item.id) === draft.supplierId) && <option value={draft.supplierId}>{text(operation.supplierName) || "—"}</option>}
          {suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    );
    if (key === "euImporter") return (
      <label key={key}>{label}
        <select className="pd-input" value={clients.some((item) => String(item.id) === draft.importerClientId) ? draft.importerClientId : ""}
          onChange={(event) => { const client = clients.find((item) => String(item.id) === event.target.value); setDraft({ ...draft, importerClientId: event.target.value, euImporter: client?.name ?? draft.euImporter }); }}>
          <option value="">{draft.euImporter || "Selecione o cliente"}</option>
          {clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    );
    return <label key={key}>{label}<input className="pd-input" type={key === "shipmentDate" ? "date" : "text"} inputMode={NUMBER_FIELDS.has(key) ? "decimal" : undefined} value={draft[key] ?? ""} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>;
  };

  return (
    <div style={{ padding: "0 20px 16px", display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        {draft
          ? <><button className="pd-btn pd-btn--sm" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button><button className="pd-btn pd-btn--sm pd-btn--dark" disabled={busy} onClick={() => save()}>{busy ? "Salvando…" : "Salvar dados"}</button></>
          : <button className="pd-btn pd-btn--sm" onClick={startEdit}>Editar dados</button>}
      </div>
      {conflict && (
        <div className="et2-alert et2-alert--warn" role="alert">
          <strong>{conflict}</strong>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="pd-btn pd-btn--sm" onClick={() => { setDraft(null); setConflict(""); onSaved(); }}>Usar a versão salva</button>
            <button className="pd-btn pd-btn--sm pd-btn--dark" disabled={busy} onClick={() => { setConflict(""); save(true); }}>Manter a minha</button>
          </div>
        </div>
      )}
      {FIELD_GROUPS.map((group) => (
        <div key={group.title}>
          <h3 style={{ margin: "8px 0", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--et2-muted)" }}>{group.title}</h3>
          {draft
            ? <div className="pd-fields">{group.fields.map(([key, label]) => input(key, label))}</div>
            : <dl className="et2-dl" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                {group.fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{valueOf(key) || <span className="muted">—</span>}</dd></div>)}
              </dl>}
        </div>
      ))}
      <div>
        <h3 style={{ margin: "8px 0", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--et2-muted)" }}>Custos logísticos (prévia)</h3>
        {draft && costsDraft
          ? <LogisticsCostsEditor value={costsDraft} onChange={setCostsDraft} />
          : <LogisticsCostsSummary costs={parseLogisticsCosts(operation.logisticsCostsJson)} />}
      </div>
    </div>
  );
}

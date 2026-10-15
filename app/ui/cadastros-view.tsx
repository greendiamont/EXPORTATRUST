"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, normalize, processHref } from "./format";
import type { Overview, OverviewOperation } from "./overview-types";
import EquipeView from "./equipe-view";
import ImportarFornecedores from "./importar-fornecedores";

// Cadastros da interface nova. Usa as mesmas APIs da versão anterior:
// nada é apagado e a edição sempre envia o registro completo (a API regrava todos os campos).

type Row = Record<string, unknown> & { id: number };
type FieldKind = "text" | "email" | "textarea" | "select" | "bool" | "suppliers";
type Field = { key: string; label: string; kind?: FieldKind; options?: string[]; required?: boolean; isNew?: boolean; wide?: boolean; help?: string };
type Section = { title: string; fields: Field[] };
type TabKey = "clientes" | "fornecedores" | "produtos" | "florestas" | "equipe";
type DedupItem = { id: number; entityType: string; primaryRecordId: number; possibleDuplicateId: number; reason: string; status: string };

type Entity = {
  tab: Exclude<TabKey, "equipe">;
  label: string;
  singular: string;
  endpoint: string;
  listKey: string;
  dedupType?: "client" | "supplier" | "product";
  editable: boolean;
  title: (row: Row) => string;
  subtitle: (row: Row) => string;
  sections: Section[];
  completeness: string[];
  related: (operation: OverviewOperation, row: Row) => boolean;
  defaults: Record<string, unknown>;
};

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const filled = (value: unknown) => (typeof value === "boolean" ? true : typeof value === "number" ? value !== 0 : text(value).trim() !== "");
const parseIds = (value: unknown): number[] => {
  if (Array.isArray(value)) return value.map(Number).filter(Boolean);
  try { const parsed = JSON.parse(text(value) || "[]"); return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : []; } catch { return []; }
};
const parseCodes = (value: string) => {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
};

const INCOTERMS = ["", "EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
const CURRENCIES = ["", "USD", "EUR", "GBP", "BRL"];

const ENTITIES: Entity[] = [
  {
    tab: "clientes", label: "Clientes", singular: "cliente", endpoint: "/api/importer-clients", listKey: "clients", dedupType: "client", editable: true,
    title: (row) => text(row.legalName), subtitle: (row) => [row.country, row.eori ? `EORI ${row.eori}` : ""].filter(Boolean).join(" · "),
    sections: [
      { title: "Identificação", fields: [
        { key: "legalName", label: "Razão social", required: true }, { key: "aliases", label: "Outros nomes / apelidos" },
        { key: "taxIdType", label: "Tipo de ID fiscal", kind: "select", options: ["VAT", "GST", "EORI", "CNPJ", "Tax ID"] }, { key: "taxId", label: "ID fiscal" },
        { key: "eori", label: "EORI" },
      ] },
      { title: "Endereço", fields: [
        { key: "address", label: "Endereço", wide: true }, { key: "city", label: "Cidade" }, { key: "state", label: "Estado / região" },
        { key: "postalCode", label: "Código postal" }, { key: "country", label: "País", required: true },
      ] },
      { title: "Contato", fields: [{ key: "contactName", label: "Contato" }, { key: "email", label: "E-mail", kind: "email" }, { key: "phone", label: "Telefone" }] },
      { title: "Condições comerciais", fields: [
        { key: "preferredPort", label: "Porto de destino preferido" }, { key: "preferredIncoterm", label: "Incoterm padrão", kind: "select", options: INCOTERMS, isNew: true },
        { key: "preferredCurrency", label: "Moeda padrão", kind: "select", options: CURRENCIES, isNew: true }, { key: "paymentTerms", label: "Condição de pagamento" },
        { key: "notifyParty", label: "Notify party", kind: "textarea", isNew: true, help: "Sai no BL e nos documentos de embarque" },
        { key: "bankDetails", label: "Dados bancários", kind: "textarea" },
        { key: "documentRequirements", label: "Exigências documentais", kind: "textarea", wide: true },
      ] },
    ],
    completeness: ["legalName", "taxId", "eori", "address", "city", "postalCode", "country", "contactName", "email", "phone", "preferredPort", "preferredIncoterm", "paymentTerms", "notifyParty"],
    related: (operation, row) => operation.importerClientId === row.id || (!operation.importerClientId && normalize(operation.client) === normalize(text(row.legalName))),
    defaults: { taxIdType: "VAT", dataStatus: "Verificado" },
  },
  {
    tab: "fornecedores", label: "Fornecedores", singular: "fornecedor", endpoint: "/api/suppliers", listKey: "suppliers", dedupType: "supplier", editable: true,
    title: (row) => text(row.legalName), subtitle: (row) => [row.city && row.state ? `${row.city}/${row.state}` : row.city, row.taxId].filter(Boolean).join(" · "),
    sections: [
      { title: "Identificação", fields: [
        { key: "legalName", label: "Razão social", required: true }, { key: "tradeName", label: "Nome fantasia" },
        { key: "taxId", label: "CNPJ / ID fiscal", required: true, help: "Brasil: CNPJ válido com 14 dígitos" }, { key: "aliases", label: "Outros nomes / apelidos" },
        { key: "certifications", label: "Certificações", help: "FSC, PEFC, SBP…" },
      ] },
      { title: "Endereço", fields: [
        { key: "address", label: "Endereço", wide: true, isNew: true }, { key: "city", label: "Município", required: true },
        { key: "state", label: "Estado / UF", required: true }, { key: "country", label: "País", required: true },
      ] },
      { title: "Contato", fields: [{ key: "contactName", label: "Responsável", required: true }, { key: "email", label: "E-mail", kind: "email", required: true }, { key: "phone", label: "Telefone" }] },
      { title: "Produção e pagamento", fields: [
        { key: "products", label: "Produtos fornecidos", kind: "textarea" }, { key: "productionUnits", label: "Unidades produtivas", kind: "textarea" },
        { key: "bankDetails", label: "Dados bancários", kind: "textarea" },
      ] },
    ],
    completeness: ["legalName", "tradeName", "taxId", "address", "city", "state", "country", "contactName", "email", "phone", "products", "productionUnits", "bankDetails"],
    related: (operation, row) => operation.supplierId === row.id,
    defaults: { country: "Brasil", certifications: "Sem certificação" },
  },
  {
    tab: "produtos", label: "Produtos", singular: "produto", endpoint: "/api/master-products", listKey: "products", dedupType: "product", editable: true,
    title: (row) => text(row.name), subtitle: (row) => [row.hsCode ? `NCM ${row.hsCode}` : "", row.species].filter(Boolean).join(" · "),
    sections: [
      { title: "Identificação", fields: [
        { key: "name", label: "Nome do produto", required: true }, { key: "hsCode", label: "NCM / HS Code", required: true },
        { key: "rawMaterial", label: "Matéria-prima", required: true }, { key: "species", label: "Espécie(s)" }, { key: "scientificName", label: "Nome científico" },
        { key: "originType", label: "Tipo de origem", kind: "select", options: ["Reflorestamento", "Plantação", "Floresta natural", "Reciclado", "Mista"] },
      ] },
      { title: "Especificação", fields: [
        { key: "dimensionalSpecification", label: "Especificação dimensional" }, { key: "grade", label: "Grau / qualidade" }, { key: "moisture", label: "Umidade" },
        { key: "kd", label: "Seco em estufa (KD)", kind: "bool" }, { key: "ht", label: "Tratamento térmico (HT)", kind: "bool" }, { key: "certifications", label: "Certificações" },
      ] },
      { title: "Venda", fields: [
        { key: "salesUnit", label: "Unidade de venda", isNew: true, help: "MT, m³, peças… preenche o novo processo" }, { key: "packaging", label: "Embalagem", isNew: true, help: "Big bag, pallet, granel…" },
        { key: "eligibleSupplierIds", label: "Fornecedores habilitados", kind: "suppliers", wide: true },
      ] },
    ],
    completeness: ["name", "hsCode", "rawMaterial", "species", "scientificName", "originType", "dimensionalSpecification", "salesUnit", "packaging"],
    related: (operation, row) => operation.masterProductId === row.id || (!operation.masterProductId && normalize(operation.product) === normalize(text(row.name))),
    defaults: { originType: "Reflorestamento", dataStatus: "Verificado", eligibleSupplierIds: [] },
  },
  {
    tab: "florestas", label: "Florestas (CAR)", singular: "floresta", endpoint: "/api/properties", listKey: "properties", editable: false,
    title: (row) => text(row.name), subtitle: (row) => [row.carCode, row.city].filter(Boolean).join(" · "),
    sections: [
      { title: "Imóvel rural", fields: [
        { key: "carCode", label: "Código CAR" }, { key: "name", label: "Nome" }, { key: "city", label: "Município" }, { key: "supplier", label: "Fornecedor / proprietário" },
      ] },
      { title: "Área e risco", fields: [
        { key: "areaHa", label: "Área total (ha)" }, { key: "nativeAreaHa", label: "Vegetação nativa (ha)" }, { key: "status", label: "Situação" }, { key: "risk", label: "Risco" },
        { key: "sourceFile", label: "Arquivo de origem" },
      ] },
    ],
    completeness: ["carCode", "name", "city", "supplier", "areaHa"],
    related: (operation, row) => parseCodes(operation.propertyIds).includes(text(row.carCode)),
    defaults: {},
  },
];

const TABS: Array<{ key: TabKey; label: string }> = [...ENTITIES.map((entity) => ({ key: entity.tab as TabKey, label: entity.label })), { key: "equipe", label: "Equipe" }];

function completeness(entity: Entity, row: Row) {
  const missing = entity.completeness.filter((key) => !filled(row[key]));
  return { percent: Math.round(((entity.completeness.length - missing.length) / entity.completeness.length) * 100), missing };
}

function labelOf(entity: Entity, key: string) {
  for (const section of entity.sections) for (const field of section.fields) if (field.key === key) return field.label;
  return key;
}

function asTab(value: string): TabKey {
  return TABS.some((tab) => tab.key === value) ? value as TabKey : "clientes";
}

export default function CadastrosView({ isAdmin, initialTab, initialId }: { isAdmin: boolean; initialTab: string; initialId: number | null }) {
  const [tab, setTab] = useState<TabKey>(() => asTab(initialTab));
  const [firstTab] = useState(tab);
  const [counts, setCounts] = useState<Partial<Record<TabKey, number>>>({});

  function pickTab(next: TabKey) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    url.searchParams.delete("id");
    window.history.replaceState(null, "", url);
  }

  const onCount = useCallback((key: TabKey, count: number) => setCounts((current) => (current[key] === count ? current : { ...current, [key]: count })), []);

  return (
    <main className="et2-main">
      <div className="et2-head">
        <div>
          <h1>Cadastros</h1>
          <p>Clientes, fornecedores, produtos e origens usados nos processos. Alterações ficam registradas na auditoria.</p>
        </div>
      </div>
      <div className="et2-tabs" role="tablist" aria-label="Tipo de cadastro">
        {TABS.map((item) => (
          <button key={item.key} role="tab" aria-selected={tab === item.key} onClick={() => pickTab(item.key)}>
            {item.label}{counts[item.key] !== undefined ? ` (${counts[item.key]})` : ""}
          </button>
        ))}
      </div>
      {tab === "equipe"
        ? <EquipeView isAdmin={isAdmin} onCount={(count) => onCount("equipe", count)} />
        : <EntityView key={tab} entity={ENTITIES.find((entity) => entity.tab === tab)!} initialId={tab === firstTab ? initialId : null} onCount={(count) => onCount(tab, count)} />}
    </main>
  );
}

function EntityView({ entity, initialId, onCount }: { entity: Entity; initialId: number | null; onCount: (count: number) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [operations, setOperations] = useState<OverviewOperation[]>([]);
  const [dedup, setDedup] = useState<DedupItem[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(initialId);
  const [editing, setEditing] = useState<"edit" | "new" | "import" | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback((selectAfter?: number) => api<Record<string, Row[]>>(entity.endpoint).then((data) => {
    const list = data[entity.listKey] ?? [];
    setRows(list);
    onCount(list.length);
    setSelectedId((current) => selectAfter ?? (current && list.some((row) => row.id === current) ? current : list[0]?.id ?? null));
  }).catch((reason: Error) => setError(reason.message || "Falha ao carregar.")), [entity, onCount]);

  useEffect(() => {
    load();
    api<Overview>("/api/overview").then((data) => setOperations(data.operations)).catch(() => {});
    if (entity.dedupType) api<{ queue: DedupItem[] }>("/api/deduplication").then((data) => setDedup(data.queue.filter((item) => item.entityType === entity.dedupType && item.status === "Possível duplicidade"))).catch(() => {});
    if (entity.tab === "produtos") api<{ suppliers: Row[] }>("/api/suppliers").then((data) => setSuppliers(data.suppliers)).catch(() => {});
  }, [entity, load]);

  function select(id: number) {
    setSelectedId(id);
    setEditing(null);
    setNotice("");
    const url = new URL(window.location.href);
    url.searchParams.set("id", String(id));
    window.history.replaceState(null, "", url);
  }

  const visible = useMemo(() => {
    const term = normalize(query.trim());
    return (rows ?? []).filter((row) => (!onlyIncomplete || completeness(entity, row).percent < 100)
      && (!term || normalize(Object.values(row).filter((value) => typeof value === "string").join(" ")).includes(term)));
  }, [rows, query, onlyIncomplete, entity]);
  const incompleteCount = useMemo(() => (rows ?? []).filter((row) => completeness(entity, row).percent < 100).length, [rows, entity]);
  const selected = rows?.find((row) => row.id === selectedId) ?? null;

  return (
    <div className="et2-row" style={{ marginTop: 18 }}>
      <section className="et2-card et2-side" style={{ flexBasis: 340, maxWidth: 420 }} aria-label={`Lista de ${entity.label.toLowerCase()}`}>
        <div className="et2-card-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: 1, display: "flex" }}><span className="sr-only">Buscar</span>
              <input className="et2-input" placeholder={`Buscar ${entity.singular}`} value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            {entity.editable && <button className="et2-btn et2-btn--primary" onClick={() => { setEditing("new"); setNotice(""); }}>+ Novo</button>}
          </div>
          <div className="et2-seg" role="group" aria-label="Filtro">
            <button aria-pressed={!onlyIncomplete} onClick={() => setOnlyIncomplete(false)}>Todos ({rows?.length ?? 0})</button>
            <button aria-pressed={onlyIncomplete} onClick={() => setOnlyIncomplete(true)}>Incompletos ({incompleteCount})</button>
          </div>
          {entity.tab === "fornecedores" && <button className="et2-btn et2-btn--sm" onClick={() => { setEditing("import"); setNotice(""); }}>Importar do app antigo…</button>}
        </div>
        <div className="et2-list" style={{ maxHeight: 640, overflowY: "auto" }}>
          {visible.map((row) => {
            const score = completeness(entity, row);
            const duplicated = dedup.some((item) => item.primaryRecordId === row.id || item.possibleDuplicateId === row.id);
            return (
              <button key={row.id} className="et2-item" aria-pressed={row.id === selectedId && editing !== "new"} onClick={() => select(row.id)}>
                <span style={{ fontWeight: 500 }}>{entity.title(row) || "(sem nome)"}</span>
                <span className="et2-sub" style={{ marginTop: -4 }}>{entity.subtitle(row) || "—"}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                  <span className="et2-bar"><span style={{ width: `${score.percent}%`, background: score.percent >= 100 ? "var(--et2-ok)" : score.percent >= 60 ? "#f59e0b" : "var(--et2-bad)" }} /></span>
                  <span className="et2-sub" style={{ margin: 0 }}>{score.percent}%</span>
                  {duplicated && <span className="et2-badge et2-badge--warn">Duplicidade?</span>}
                </span>
              </button>
            );
          })}
          {rows && !visible.length && <p className="et2-empty">Nada encontrado.</p>}
          {!rows && !error && <p className="et2-empty">Carregando…</p>}
        </div>
      </section>

      <section className="et2-card et2-grow" aria-label="Ficha do cadastro">
        {error && <div className="et2-card-body"><div className="et2-alert et2-alert--bad" role="alert">{error}</div></div>}
        {notice && <div className="et2-card-body" style={{ paddingBottom: 0 }}><div className="et2-alert et2-alert--ok" role="status">{notice}</div></div>}
        {editing === "import"
          ? <ImportarFornecedores onCancel={() => setEditing(null)} onImported={(message) => { setEditing(null); setNotice(message); void load(); }} />
          : editing
          ? <EntityForm entity={entity} initial={editing === "edit" && selected ? selected : { ...entity.defaults, id: 0 } as Row} suppliers={suppliers}
              onCancel={() => setEditing(null)}
              onSaved={(id, message) => { setEditing(null); setNotice(message); void load(id); }} />
          : selected
            ? <EntityCard entity={entity} row={selected} suppliers={suppliers} rows={rows ?? []} dedup={dedup}
                operations={operations.filter((operation) => entity.related(operation, selected))}
                onEdit={() => { setEditing("edit"); setNotice(""); }} onSelect={select} />
            : rows && <p className="et2-empty">Selecione um cadastro na lista{entity.editable ? " ou crie um novo" : ""}.</p>}
      </section>
    </div>
  );
}

function display(field: Field, row: Row, suppliers: Row[]) {
  const value = row[field.key];
  if (field.kind === "bool") return value ? "Sim" : "Não";
  if (field.kind === "suppliers") {
    const ids = parseIds(value);
    return ids.length ? ids.map((id) => text(suppliers.find((supplier) => supplier.id === id)?.legalName) || `#${id}`).join(", ") : "";
  }
  if (typeof value === "number") return value.toLocaleString("pt-BR");
  return text(value);
}

function EntityCard({ entity, row, suppliers, rows, dedup, operations, onEdit, onSelect }: {
  entity: Entity; row: Row; suppliers: Row[]; rows: Row[]; dedup: DedupItem[]; operations: OverviewOperation[]; onEdit: () => void; onSelect: (id: number) => void;
}) {
  const score = completeness(entity, row);
  const duplicates = dedup.filter((item) => item.primaryRecordId === row.id || item.possibleDuplicateId === row.id).map((item) => {
    const otherId = item.primaryRecordId === row.id ? item.possibleDuplicateId : item.primaryRecordId;
    return { item, other: rows.find((candidate) => candidate.id === otherId) };
  });
  return (
    <>
      <div className="et2-card-head">
        <div>
          <h2 style={{ fontSize: 18 }}>{entity.title(row) || "(sem nome)"}</h2>
          <span className="et2-sub">{entity.subtitle(row)}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {entity.tab === "florestas" && <a className="et2-btn" href="/classico?module=Florestas">Mapa, SICAR e GeoJSON ↗</a>}
          {entity.editable && <button className="et2-btn et2-btn--primary" onClick={onEdit}>Editar</button>}
        </div>
      </div>
      <div className="et2-card-body">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>Cadastro {score.percent}% completo</span>
          <span className="et2-bar" style={{ maxWidth: 260 }}><span style={{ width: `${score.percent}%`, background: score.percent >= 100 ? "var(--et2-ok)" : "#f59e0b" }} /></span>
        </div>
        {score.missing.length > 0 && <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>Falta: {score.missing.map((key) => labelOf(entity, key)).join(", ")}.</p>}
        {duplicates.map(({ item, other }) => (
          <div key={item.id} className="et2-alert et2-alert--warn" style={{ marginTop: 12 }} role="status">
            Possível duplicidade com{" "}
            {other ? <button className="et2-btn et2-btn--sm" style={{ margin: "0 4px" }} onClick={() => onSelect(other.id)}>{entity.title(other)}</button> : `#${item.primaryRecordId === row.id ? item.possibleDuplicateId : item.primaryRecordId}`}
            {" "}— {item.reason}. A decisão (confirmar ou descartar) continua em <a href="/classico?module=Duplicidades">Duplicidades</a>.
          </div>
        ))}

        {entity.sections.map((section) => (
          <div key={section.title} className="et2-group">
            <h3>{section.title}</h3>
            <dl className="et2-dl">
              {section.fields.map((field) => {
                const value = display(field, row, suppliers);
                return (
                  <div key={field.key} className={field.wide || field.kind === "textarea" ? "wide" : undefined}>
                    <dt>{field.label} {field.isNew && <span className="et2-badge et2-badge--new">NOVO</span>}</dt>
                    <dd>{value || <span className="muted">—</span>}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}

        <div className="et2-group">
          <h3>Processos relacionados ({operations.length})</h3>
          {operations.length
            ? <table className="et2-table"><tbody>
                {operations.slice(0, 50).map((operation) => (
                  <tr key={operation.id}>
                    <td style={{ paddingLeft: 0 }}><a className="mono" href={processHref(operation.id)}>{operation.reference}</a><span className="et2-sub">{operation.product}</span></td>
                    <td>{operation.client}<span className="et2-sub">{operation.country}</span></td>
                    <td>{operation.phaseIndex + 1}/6 · {operation.phaseName}</td>
                  </tr>
                ))}
              </tbody></table>
            : <p className="muted" style={{ margin: 0 }}>Nenhum processo usa este cadastro.</p>}
        </div>
      </div>
    </>
  );
}

function EntityForm({ entity, initial, suppliers, onCancel, onSaved }: {
  entity: Entity; initial: Row; suppliers: Row[]; onCancel: () => void; onSaved: (id: number, message: string) => void;
}) {
  const [draft, setDraft] = useState<Row>(() => ({ ...initial, ...(entity.tab === "produtos" ? { eligibleSupplierIds: parseIds(initial.eligibleSupplierIds) } : {}) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isNew = !initial.id;

  const set = (key: string, value: unknown) => setDraft((current) => ({ ...current, [key]: value }));

  async function save() {
    setError("");
    const missing = entity.sections.flatMap((section) => section.fields).filter((field) => field.required && !filled(draft[field.key])).map((field) => field.label);
    if (missing.length) { setError(`Preencha: ${missing.join(", ")}.`); return; }
    setSaving(true);
    try {
      // Envia o registro inteiro: a API regrava todos os campos e não pode perder o que não foi editado.
      const body = { ...draft, ...(isNew ? { id: undefined } : {}) };
      const result = await api<Record<string, Row | string>>(entity.endpoint, { method: isNew ? "POST" : "PUT", body: JSON.stringify(body) });
      const saved = Object.values(result).find((value): value is Row => typeof value === "object" && value !== null && "id" in value);
      onSaved(saved?.id ?? initial.id, result.action === "updated_existing" ? "Já existia um cadastro com este nome: ele foi completado com os novos dados." : isNew ? "Cadastro criado." : "Alterações salvas.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="et2-card-head">
        <h2 style={{ fontSize: 18 }}>{isNew ? `Novo ${entity.singular}` : `Editar ${entity.title(initial)}`}</h2>
      </div>
      <div className="et2-card-body">
        {error && <div className="et2-alert et2-alert--bad" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
        {entity.sections.map((section) => (
          <div key={section.title} className="et2-group">
            <h3>{section.title}</h3>
            <div className="et2-grid">
              {section.fields.map((field) => (
                <FieldInput key={field.key} field={field} value={draft[field.key]} suppliers={suppliers} onChange={(value) => set(field.key, value)} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="et2-card-body" style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--et2-line)" }}>
        <button className="et2-btn" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="et2-btn et2-btn--ok" onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</button>
      </div>
    </>
  );
}

function FieldInput({ field, value, suppliers, onChange }: { field: Field; value: unknown; suppliers: Row[]; onChange: (value: unknown) => void }) {
  const caption = <span>{field.label}{field.required && <span className="et2-req"> *</span>} {field.isNew && <span className="et2-badge et2-badge--new">NOVO</span>}</span>;
  const wide = field.wide || field.kind === "textarea" || field.kind === "suppliers" ? " et2-field--wide" : "";
  if (field.kind === "bool") {
    return (
      <label className="et2-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" style={{ width: 18, minHeight: 18 }} checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />{caption}
      </label>
    );
  }
  if (field.kind === "suppliers") {
    const ids = parseIds(value);
    return (
      <div className={`et2-field${wide}`}>
        {caption}
        <div className="et2-chips">
          {suppliers.map((supplier) => (
            <button key={supplier.id} type="button" aria-pressed={ids.includes(supplier.id)} onClick={() => onChange(ids.includes(supplier.id) ? ids.filter((id) => id !== supplier.id) : [...ids, supplier.id])}>
              {text(supplier.legalName)}
            </button>
          ))}
          {!suppliers.length && <small>Nenhum fornecedor cadastrado.</small>}
        </div>
      </div>
    );
  }
  return (
    <label className={`et2-field${wide}`}>
      {caption}
      {field.kind === "textarea"
        ? <textarea value={text(value)} onChange={(event) => onChange(event.target.value)} />
        : field.kind === "select"
          ? <select value={text(value)} onChange={(event) => onChange(event.target.value)}>
              {[...new Set([text(value), ...(field.options ?? [])])].map((option) => <option key={option} value={option}>{option || "—"}</option>)}
            </select>
          : <input type={field.kind === "email" ? "email" : "text"} value={text(value)} onChange={(event) => onChange(event.target.value)} />}
      {field.help && <small>{field.help}</small>}
    </label>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, normalize, processHref } from "./format";
import { LEGACY_COST_FIELDS, costsFromDraft, logisticsDraft, parseAmount, parseLogisticsCosts, type LogisticsDraft } from "../../lib/logistics-costs";
import { LogisticsCostsEditor } from "./logistics-costs-editor";
import { readOrderTerms } from "../../lib/order-terms";
import { logisticsByCurrency } from "../../lib/logistics-costs";
import { amountsOf, estimateCommission, estimateMargin } from "../../lib/margin";

type Supplier = { id: number; legalName: string; tradeName: string; taxId: string; city: string; state: string; country: string; products: string; productionUnits: string };
type Client = { id: number; legalName: string; aliases: string; country: string; eori: string; preferredPort: string; preferredIncoterm?: string; preferredCurrency?: string };
type Product = { id: number; name: string; hsCode: string; rawMaterial: string; species: string; originType: string; salesUnit?: string };
type Property = { carCode: string; name: string; city: string; supplier: string; areaHa: number };

/** Linha da tabela "Itens do pedido" (vira os itens do pedido de venda ao salvar). */
type OrderItemDraft = { species: string; quality: string; size: string; volume: string; unitPrice: string };
const emptyItem = (species = "", quality = ""): OrderItemDraft => ({ species, quality, size: "", volume: "", unitPrice: "" });

const EMPTY = {
  reference: "", product: "", hsCode: "", contractNumber: "", internalResponsible: "", responsibleEmail: "",
  supplierId: "", exporterId: "", exporterName: "", exporterTaxId: "", euImporter: "", importerClientId: "", euOperatorEori: "", eudrReference: "",
  rawMaterial: "", species: "", forestOriginType: "Reflorestamento", productionUnit: "", lotCodes: "", propertyIds: [] as string[],
  quantity: "", quantityUnit: "MT", volumeM3: "", netWeightKg: "", grossWeightKg: "", incoterm: "FOB", currency: "USD", commercialValue: "",
  transportMode: "Marítimo", shipmentDate: "", destinationCountry: "", portOfLoading: "", portOfDischarge: "", carrier: "", bookingNumber: "", billOfLadingNumber: "", containerNumbers: "", vesselVoyage: "",
  supplyChainNotes: "", paymentTerms: "", itemSize: "", unitPrice: "", purchaseUnitPrice: "", purchaseCurrency: "BRL", purchaseNote: "", gainMode: "margem", commissionPercent: "",
  orderItems: [emptyItem()] as OrderItemDraft[],
  logistics: logisticsDraft(parseLogisticsCosts("{}")) as LogisticsDraft,
};
type Form = typeof EMPTY;
type Key = Exclude<keyof Form, "propertyIds" | "logistics" | "orderItems">;

const DRAFT_KEY = "et2-novo-processo-rascunho";

// Edição da negociação (Painel → "Editar negociação"): o mesmo formulário, preenchido com o
// processo; ao salvar, só os campos alterados vão para PATCH /api/operations.
const TEXT_FIELDS = ["reference", "contractNumber", "product", "hsCode", "destinationCountry", "incoterm", "currency", "quantityUnit", "rawMaterial", "species", "forestOriginType", "exporterName", "exporterTaxId", "productionUnit", "lotCodes", "transportMode", "portOfLoading", "portOfDischarge", "shipmentDate", "carrier", "bookingNumber", "billOfLadingNumber", "containerNumbers", "vesselVoyage", "euOperatorEori", "eudrReference", "internalResponsible", "responsibleEmail", "euImporter"] as const;
const NUMBER_FIELDS = ["quantity", "volumeM3", "netWeightKg", "grossWeightKg", "commercialValue"] as const;
type OperationRow = Record<string, string | number | null> & { id: number; reference: string; supplyChainNotes: string | null };

function formFromOperation(operation: OperationRow): Form {
  const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
  const number = (value: unknown) => (Number(value) ? String(Math.round(Number(value) * 1000) / 1000) : "");
  const terms = readOrderTerms({ supplyChainNotes: operation.supplyChainNotes, product: text(operation.product), species: text(operation.species), rawMaterial: text(operation.rawMaterial), lotCodes: text(operation.lotCodes), quantity: Number(operation.quantity) || 0, volumeM3: Number(operation.volumeM3) || 0, commercialValue: Number(operation.commercialValue) || 0 });
  const costs = parseLogisticsCosts(operation.logisticsCostsJson);
  let propertyIds: string[] = [];
  try { propertyIds = JSON.parse(text(operation.propertyIds) || "[]"); } catch { /* sem imóveis */ }
  return {
    ...EMPTY,
    ...Object.fromEntries(TEXT_FIELDS.map((key) => [key, key === "shipmentDate" ? text(operation[key]).slice(0, 10) : text(operation[key])])),
    ...Object.fromEntries(NUMBER_FIELDS.map((key) => [key, number(operation[key])])),
    reference: operation.reference, supplierId: text(operation.supplierId), importerClientId: text(operation.importerClientId),
    propertyIds: Array.isArray(propertyIds) ? propertyIds.map(String) : [],
    supplyChainNotes: terms.notes, paymentTerms: terms.paymentTerms, itemSize: terms.sizes, unitPrice: terms.unitPrice ? String(terms.unitPrice) : "",
    purchaseUnitPrice: terms.purchaseUnitPrice ? String(terms.purchaseUnitPrice) : "", purchaseCurrency: terms.purchaseCurrency,
    gainMode: terms.gainMode, commissionPercent: terms.commissionPercent ? String(terms.commissionPercent) : "",
    orderItems: terms.items.map((item) => ({ species: item.species, quality: item.quality, size: item.size, volume: item.volume ? String(Math.round(item.volume * 1000) / 1000) : "", unitPrice: item.unitPrice ? String(Math.round(item.unitPrice * 10000) / 10000) : "" })),
    purchaseNote: terms.supplierItemCount > 1 ? "Pedido de compra já emitido com vários itens: o Financeiro do pedido usa os valores dele." : "",
    logistics: logisticsDraft(costs),
  } as Form;
}

/** Valor digitado no padrão brasileiro (1.234,56) ou internacional (1234.56). */
const amount = parseAmount;
/** Campo <input type="number">: o navegador sempre entrega com ponto decimal (ex.: "203.212"). */
const numberInput = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const SECTIONS = [
  { title: "Identificação da operação", hint: "Referência, produto, contrato", description: "Se a referência ficar vazia, o sistema gera uma automaticamente." },
  { title: "Empresas da cadeia", hint: "Fornecedor, cliente, exportador", description: "Escolha dos cadastros: os dados de cada empresa são preenchidos automaticamente." },
  { title: "Produto, origem e rastreabilidade", hint: "Matéria-prima, espécie, CAR", description: "Base da rastreabilidade e do dossiê EUDR deste processo." },
  { title: "Quantidades e condição comercial", hint: "Volumes, incoterm, valor", description: "Os itens com preço por unidade entram depois, na emissão do pedido." },
  { title: "Logística internacional", hint: "Modal, portos, booking", description: "Pode ser completada depois, quando houver booking." },
  { title: "Observações da supply chain", hint: "Fluxo e particularidades", description: "Participantes ainda não cadastrados e particularidades do caminho até o importador." },
];

function loadDraft(): Form | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    // Rascunho da versão anterior (campos lc* fixos): os valores viram linhas da cotação.
    if (!saved.logistics) {
      const legacy = (key: string) => saved[`lc${key[0].toUpperCase()}${key.slice(1)}`];
      saved.logistics = logisticsDraft(parseLogisticsCosts({
        exchangeRate: amount(saved.lcRate), notes: saved.lcNotes,
        currencies: Object.fromEntries(LEGACY_COST_FIELDS.map(([key]) => [key, legacy(`cur${key[0].toUpperCase()}${key.slice(1)}`)])),
        ...Object.fromEntries(LEGACY_COST_FIELDS.map(([key]) => [key, amount(legacy(key))])),
      }));
    }
    return { ...EMPTY, ...saved } as Form;
  } catch {
    return null;
  }
}

export default function NovoProcessoView({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>({ ...EMPTY, internalResponsible: userName, responsibleEmail: userEmail });
  const [restored, setRestored] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ operation: OperationRow; original: Form } | null>(null);

  useEffect(() => {
    const editId = Number(new URLSearchParams(window.location.search).get("processo"));
    const suppliersLoaded = api<{ suppliers: Supplier[] }>("/api/suppliers").then((d) => { setSuppliers(d.suppliers); return d.suppliers; }).catch(() => [] as Supplier[]);
    if (editId) {
      Promise.all([api<{ operation: OperationRow }>(`/api/export-control?operationId=${editId}`), suppliersLoaded]).then(([snapshot, list]) => {
        const loaded = formFromOperation(snapshot.operation);
        const exporter = list.find((item) => normalize(item.legalName) === normalize(loaded.exporterName));
        const next = { ...loaded, exporterId: exporter && String(exporter.id) !== loaded.supplierId ? String(exporter.id) : "" };
        setForm(next);
        setEditing({ operation: snapshot.operation, original: next });
      }).catch((reason: Error) => setError(`Não foi possível abrir o processo: ${reason.message}`));
    } else {
      const draft = loadDraft();
      if (draft) { setForm(draft); setRestored(true); }
    }
    api<{ clients: Client[] }>("/api/importer-clients").then((d) => setClients(d.clients)).catch(() => {});
    api<{ products: Product[] }>("/api/master-products").then((d) => setProducts(d.products)).catch(() => {});
    api<{ properties: Property[] }>("/api/properties").then((d) => setProperties(d.properties)).catch(() => {});
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("processo")) return;
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch { /* rascunho é só conveniência */ }
  }, [form]);

  const supplier = suppliers.find((item) => String(item.id) === form.supplierId);
  const supplierProperties = useMemo(() => {
    if (!supplier) return properties;
    const names = [supplier.legalName, supplier.tradeName].filter(Boolean).map(normalize);
    const own = properties.filter((property) => names.some((name) => normalize(property.supplier).includes(name) || name.includes(normalize(property.supplier))));
    return own.length ? own : properties;
  }, [properties, supplier]);

  function set(key: Key, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  // O exportador (quem aparece nos documentos) é o próprio fornecedor ou uma trading do cadastro;
  // nome e CNPJ vêm do cadastro.
  function logisticsCosts() {
    return costsFromDraft(form.logistics);
  }

  function pickSupplier(id: string) {
    const chosen = suppliers.find((item) => String(item.id) === id);
    setForm((current) => current.exporterId && current.exporterId !== id
      ? { ...current, supplierId: id }
      : { ...current, supplierId: id, exporterId: "", exporterName: chosen?.legalName ?? "", exporterTaxId: chosen?.taxId ?? "" });
  }

  function pickExporter(id: string) {
    const chosen = suppliers.find((item) => String(item.id) === (id || form.supplierId));
    setForm((current) => ({ ...current, exporterId: id, exporterName: chosen?.legalName ?? "", exporterTaxId: chosen?.taxId ?? "" }));
  }

  function pickClient(name: string) {
    const client = clients.find((item) => normalize(item.legalName) === normalize(name.trim()));
    setForm((current) => ({
      ...current,
      euImporter: name,
      importerClientId: client ? String(client.id) : "",
      euOperatorEori: client?.eori || current.euOperatorEori,
      destinationCountry: client?.country || current.destinationCountry,
      portOfDischarge: client?.preferredPort || current.portOfDischarge,
      incoterm: client?.preferredIncoterm || current.incoterm,
      currency: client?.preferredCurrency || current.currency,
    }));
  }

  function pickProduct(name: string) {
    const product = products.find((item) => normalize(item.name) === normalize(name.trim()));
    setForm((current) => ({
      ...current,
      product: name,
      hsCode: product?.hsCode || current.hsCode,
      rawMaterial: product?.rawMaterial || current.rawMaterial,
      species: product?.species || current.species,
      forestOriginType: product?.originType || current.forestOriginType,
      quantityUnit: product?.salesUnit || current.quantityUnit,
    }));
  }

  function toggleProperty(carCode: string) {
    setForm((current) => ({ ...current, propertyIds: current.propertyIds.includes(carCode) ? current.propertyIds.filter((code) => code !== carCode) : [...current.propertyIds, carCode] }));
  }

  function discardDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    setForm({ ...EMPTY, internalResponsible: userName, responsibleEmail: userEmail });
    setRestored(false);
    setStep(0);
  }

  async function submit() {
    setError("");
    if (!form.supplierId || !form.euImporter.trim()) {
      setError("Preencha o fornecedor principal e o importador (seção 2).");
      setStep(1);
      return;
    }
    setSaving(true);
    try {
      if (editing) { await saveEdit(); return; }
      const result = await api<{ operation: { id: number; reference: string }; duplicate?: boolean }>("/api/operations", { method: "POST", body: JSON.stringify({ ...form, logisticsCosts: logisticsCosts(), terms: { paymentTerms: form.paymentTerms, items: itemsPayload(form.orderItems), remuneration: { mode: form.gainMode, percent: amount(form.commissionPercent) }, purchaseUnitPrice: amount(form.purchaseUnitPrice), purchaseCurrency: form.purchaseCurrency } }) });
      if (result.duplicate) {
        setError(`Já existe um processo com a referência ${result.operation.reference}. Use outra referência ou deixe em branco.`);
        setStep(0);
        return;
      }
      try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      window.location.href = processHref(result.operation.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao criar o processo.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const { operation, original } = editing;
    const fields: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    for (const key of TEXT_FIELDS) if (form[key] !== original[key]) { fields[key] = form[key]; before[key] = operation[key]; }
    for (const key of NUMBER_FIELDS) if (form[key] !== original[key]) { fields[key] = numberInput(form[key]); before[key] = operation[key]; }
    if (form.supplierId !== original.supplierId) fields.supplierId = Number(form.supplierId);
    if (form.importerClientId !== original.importerClientId) fields.importerClientId = Number(form.importerClientId) || null;
    if (JSON.stringify(logisticsCosts()) !== JSON.stringify(costsFromDraft(original.logistics))) { fields.logisticsCosts = logisticsCosts(); before.logisticsCostsJson = operation.logisticsCostsJson; }
    const terms: Record<string, unknown> = {};
    if (form.paymentTerms !== original.paymentTerms) terms.paymentTerms = form.paymentTerms;
    if (JSON.stringify(form.orderItems) !== JSON.stringify(original.orderItems)) terms.items = itemsPayload(form.orderItems);
    if (form.gainMode !== original.gainMode || form.commissionPercent !== original.commissionPercent) terms.remuneration = { mode: form.gainMode, percent: amount(form.commissionPercent) };
    if (form.purchaseUnitPrice !== original.purchaseUnitPrice || form.purchaseCurrency !== original.purchaseCurrency) { terms.purchaseUnitPrice = amount(form.purchaseUnitPrice); terms.purchaseCurrency = form.purchaseCurrency; }
    if (form.supplyChainNotes !== original.supplyChainNotes) terms.notes = form.supplyChainNotes;
    if (Object.keys(terms).length) { fields.terms = terms; before.supplyChainNotes = operation.supplyChainNotes; }
    const propertiesChanged = JSON.stringify(form.propertyIds) !== JSON.stringify(original.propertyIds);
    if (!Object.keys(fields).length && !propertiesChanged) { window.location.href = "/"; return; }
    if (Object.keys(fields).length) await api("/api/operations", { method: "PATCH", body: JSON.stringify({ id: operation.id, fields, original: before }) });
    if (propertiesChanged) await api("/api/operations", { method: "PATCH", body: JSON.stringify({ id: operation.id, propertyIds: form.propertyIds }) });
    window.location.href = "/";
  }

  const input = (key: Key, label: string, options: { placeholder?: string; required?: boolean; help?: string; type?: string; list?: string; onChange?: (value: string) => void } = {}) => (
    <label className="et2-field" key={key}>
      <span>{label}{options.required && <span className="et2-req"> *</span>}</span>
      <input type={options.type ?? "text"} list={options.list} value={form[key]} placeholder={options.placeholder} onChange={(event) => (options.onChange ?? ((value) => set(key, value)))(event.target.value)} />
      {options.help && <small>{options.help}</small>}
    </label>
  );
  const select = (key: Key, label: string, values: string[], help?: string) => (
    <label className="et2-field" key={key}>
      <span>{label}</span>
      <select value={form[key]} onChange={(event) => set(key, event.target.value)}>{values.map((value) => <option key={value}>{value}</option>)}</select>
      {help && <small>{help}</small>}
    </label>
  );

  const eudrHint = form.destinationCountry || form.hsCode ? `${form.destinationCountry || "destino ?"} · NCM ${form.hsCode || "?"}` : "Defina destino e NCM";

  return (
    <main className="et2-main">
      {editing
        ? <nav className="et2-crumbs" aria-label="Caminho"><Link href="/">Painel</Link> / <a href={processHref(editing.operation.id)}>{editing.operation.reference}</a> / Editar negociação</nav>
        : <nav className="et2-crumbs" aria-label="Caminho"><Link href="/pedidos">Pedidos</Link> / Novo processo</nav>}
      <div className="et2-head">
        <div>
          <h1>{editing ? <>Processo <span className="mono">{editing.operation.reference}</span> · editar negociação</> : "Novo processo de exportação"}</h1>
          <p>{editing ? "Altere o que foi negociado. Ao salvar, só os campos alterados são gravados; o acompanhamento do pedido continua igual." : "Registre pedido, participantes, produto, origem, volumes e logística. Estes dados alimentam o acompanhamento, os documentos e o dossiê EUDR."}</p>
        </div>
      </div>

      {restored && <div className="et2-alert et2-alert--info" role="status">Rascunho recuperado deste navegador. <button className="et2-btn et2-btn--sm" style={{ marginLeft: 8 }} onClick={discardDraft}>Começar do zero</button></div>}
      {error && <div className="et2-alert et2-alert--bad" role="alert">{error}</div>}

      <div className="et2-row">
        <aside style={{ flex: "1 1 260px", maxWidth: 300, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <nav className="et2-card" aria-label="Seções do formulário">
            <ol className="et2-steps">
              {SECTIONS.map((section, index) => (
                <li key={section.title}>
                  <button aria-current={index === step ? "step" : undefined} onClick={() => setStep(index)}>
                    <span className={index < step ? "dot done" : "dot"}>{index < step ? "✓" : index + 1}</span>
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}><span style={{ fontWeight: 500 }}>{section.title}</span><span className="et2-sub" style={{ marginTop: 0 }}>{section.hint}</span></span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <section className="et2-card et2-card-body" aria-labelledby="resumo">
            <h2 id="resumo" style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600 }}>Resumo</h2>
            <dl className="et2-dl" style={{ gridTemplateColumns: "1fr" }}>
              <div><dt>Referência</dt><dd className="mono">{form.reference || "automática"}</dd></div>
              <div><dt>Cliente</dt><dd>{form.euImporter || "—"}{form.destinationCountry ? ` · ${form.destinationCountry}` : ""}</dd></div>
              <div><dt>Fornecedor</dt><dd>{supplier?.legalName || "—"}</dd></div>
              <div><dt>Produto</dt><dd>{form.product || "—"}{form.hsCode ? ` · ${form.hsCode}` : ""}</dd></div>
              <div><dt>EUDR</dt><dd>{eudrHint}</dd></div>
            </dl>
          </section>
        </aside>

        <section className="et2-card et2-grow" aria-labelledby="secao">
          <div className="et2-card-head" style={{ display: "block" }}>
            <div className="muted" style={{ fontSize: 12 }}>Seção {step + 1} de {SECTIONS.length}</div>
            <h2 id="secao" style={{ marginTop: 2, fontSize: 18 }}>{SECTIONS[step].title}</h2>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{SECTIONS[step].description}</p>
          </div>
          <div className="et2-card-body">
            <datalist id="et2-products">{products.map((item) => <option key={item.id} value={item.name} />)}</datalist>
            <datalist id="et2-clients">{clients.map((item) => <option key={item.id} value={item.legalName} />)}</datalist>

            {step === 0 && <div className="et2-grid">
              {editing
                ? input("reference", "Referência da operação", { help: "Muda também a referência do pedido e do acompanhamento" })
                : input("reference", "Referência da operação", { placeholder: "Ex.: GBU003/26 · vazio gera automático" })}
              {input("product", "Produto", { list: "et2-products", placeholder: "Selecione ou digite", help: "Do cadastro: preenche NCM, espécie e unidade", onChange: pickProduct })}
              {input("hsCode", "NCM / HS Code", { placeholder: "Pode preencher depois" })}
              {input("contractNumber", "Contrato / PO do cliente")}
              {input("internalResponsible", "Responsável interno")}
              {input("responsibleEmail", "E-mail do responsável", { type: "email" })}
            </div>}

            {step === 1 && <div className="et2-grid">
              <label className="et2-field">
                <span>Fornecedor principal<span className="et2-req"> *</span></span>
                <select value={form.supplierId} onChange={(event) => pickSupplier(event.target.value)}>
                  <option value="">Selecione…</option>
                  {suppliers.map((item) => <option key={item.id} value={item.id}>{item.legalName}</option>)}
                </select>
                <small>{supplier ? `${supplier.city}/${supplier.state} · ${supplier.country}` : <a href="/cadastros?tab=fornecedores">Cadastrar fornecedor</a>}</small>
              </label>
              <label className="et2-field">
                <span>Exportador / trading</span>
                <select value={form.exporterId} onChange={(event) => pickExporter(event.target.value)}>
                  <option value="">O próprio fornecedor{supplier ? ` (${supplier.legalName})` : ""}</option>
                  {suppliers.filter((item) => String(item.id) !== form.supplierId).map((item) => <option key={item.id} value={item.id}>{item.legalName}</option>)}
                </select>
                <small>É quem aparece na documentação do pedido · <a href="/cadastros?tab=fornecedores">Cadastrar trading</a></small>
              </label>
              {input("exporterTaxId", "CNPJ do exportador", { help: "Preenchido do cadastro ao selecionar o exportador" })}
              {input("euImporter", "Importador / operador europeu", { list: "et2-clients", required: true, placeholder: "Selecione ou digite um novo", help: form.importerClientId ? "Cliente cadastrado: EORI, porto e pagamento preenchidos" : "Novo nome cria o cliente no cadastro", onChange: pickClient })}
              {input("euOperatorEori", "EORI do operador")}
              {input("eudrReference", "Referência DDS / EUDR", { placeholder: "Quando emitida no sistema europeu" })}
            </div>}

            {step === 2 && <>
              <div className="et2-grid">
                {input("rawMaterial", "Matéria-prima")}
                {input("species", "Espécie(s)")}
                {select("forestOriginType", "Tipo de origem", ["Reflorestamento", "Plantação", "Floresta natural", "Reciclado", "Mista"])}
                {input("productionUnit", "Unidade produtiva", { placeholder: supplier?.productionUnits || "Planta ou unidade" })}
                {input("lotCodes", "Códigos dos lotes", { placeholder: "Separar por vírgula" })}
              </div>
              <div style={{ marginTop: 18 }}>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>Origens CAR deste processo</div>
                {supplierProperties.length
                  ? <div className="et2-chips">{supplierProperties.map((property) => (
                    <button key={property.carCode} aria-pressed={form.propertyIds.includes(property.carCode)} onClick={() => toggleProperty(property.carCode)}>
                      <span className="mono" style={{ fontSize: 12 }}>{property.carCode.length > 22 ? `${property.carCode.slice(0, 22)}…` : property.carCode}</span> · {property.name}
                    </button>))}</div>
                  : <p className="muted" style={{ margin: 0 }}>Nenhuma floresta cadastrada. <a href="/cadastros?tab=florestas">Cadastrar floresta</a></p>}
                <small className="muted">{supplier ? "Imóveis do fornecedor selecionado." : "Selecione o fornecedor para filtrar os imóveis."} Ficam vinculados ao dossiê EUDR.</small>
              </div>
            </>}

            {step === 3 && <div className="et2-grid">
              {input("quantity", "Quantidade", { type: "number" })}
              {select("quantityUnit", "Unidade", ["MT", "KG", "M³", "Unidades", "Contêineres"])}
              {input("volumeM3", "Volume (m³)", { type: "number" })}
              {input("netWeightKg", "Peso líquido (kg)", { type: "number" })}
              {input("grossWeightKg", "Peso bruto (kg)", { type: "number" })}
              {select("incoterm", "Incoterm", ["FOB", "EXW", "FCA", "CFR", "CIF", "DAP", "DDP"])}
              {select("currency", "Moeda da venda", ["USD", "EUR", "GBP", "BRL"])}
              {input("commercialValue", "Valor comercial", { type: "number", help: "Soma dos itens (volume × preço) ao salvar" })}
              {input("paymentTerms", "Condição de pagamento", { placeholder: "Ex.: 30% adiantado · 70% contra BL" })}
            </div>}
            {step === 3 && <OrderItemsEditor form={form} setForm={setForm} />}
            {step === 3 && <PricesAndMargin form={form} setForm={setForm} />}

            {step === 4 && <div className="et2-grid">
              {select("transportMode", "Modal", ["Marítimo", "Rodoviário", "Ferroviário", "Aéreo", "Multimodal"])}
              {input("shipmentDate", "Data prevista de embarque", { type: "date" })}
              {input("destinationCountry", "País de destino")}
              {input("portOfLoading", "Porto / local de embarque")}
              {input("portOfDischarge", "Porto / local de destino")}
              {input("carrier", "Armador / transportadora")}
              {input("bookingNumber", "Booking")}
              {input("billOfLadingNumber", "BL / Bill of Lading", { placeholder: "Ex.: SA0600284400" })}
              {input("containerNumbers", "Contêiner(es)")}
              {input("vesselVoyage", "Navio / viagem")}
            </div>}
            {step === 4 && <div style={{ marginTop: 22 }}>
              <div style={{ fontWeight: 500 }}>Prévia dos custos logísticos</div>
              <small className="et2-sub" style={{ display: "block", margin: "2px 0 10px" }}>Lance a cotação do agente/armador linha por linha, cada serviço na sua moeda. O total sai por moeda e convertido em US$ e R$. Pode ser ajustada depois, dentro do pedido.</small>
              <LogisticsCostsEditor value={form.logistics} onChange={(logistics) => setForm((current) => ({ ...current, logistics }))} />
            </div>}

            {step === 5 && <label className="et2-field">
              <span>Fluxo, particularidades e participantes ainda não cadastrados</span>
              <textarea rows={7} value={form.supplyChainNotes} placeholder="Descreva o caminho da matéria-prima até o importador europeu…" onChange={(event) => set("supplyChainNotes", event.target.value)} />
            </label>}
          </div>
          <div className="et2-foot">
            <button className="et2-btn" disabled={step === 0} onClick={() => setStep(step - 1)}>← Voltar</button>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12 }}>{editing ? "As alterações só são gravadas ao salvar" : "Rascunho salvo automaticamente neste navegador"}</span>
              {step < SECTIONS.length - 1
                ? <button className="et2-btn et2-btn--primary" onClick={() => setStep(step + 1)}>Próximo →</button>
                : <button className="et2-btn et2-btn--ok" disabled={saving} onClick={submit}>{saving ? (editing ? "Salvando…" : "Criando…") : editing ? "Salvar alterações ✓" : "Criar processo ✓"}</button>}
              {editing && step < SECTIONS.length - 1 && <button className="et2-btn et2-btn--ok" disabled={saving} onClick={submit}>{saving ? "Salvando…" : "Salvar alterações ✓"}</button>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

// Seção 4 · Preços para a margem e margem estimada (protótipo "5c · Preços e margem",
// aprovado por Ivam em 2026-10-16). O câmbio é o mesmo da prévia logística (seção 5).
const SYMBOL: Record<string, string> = { USD: "US$", BRL: "R$", EUR: "€", GBP: "£" };
const two = (value: number) => value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const show = (value: number | null, currency: string) => value === null ? "—" : `${SYMBOL[currency] ?? currency} ${two(value)}`;

function PricesAndMargin({ form, setForm }: { form: Form; setForm: (update: (current: Form) => Form) => void }) {
  // Base por unidade: volume dos itens; senão o volume em m³; senão a quantidade (igual ao Financeiro do pedido).
  const itemsVolume = form.orderItems.reduce((sum, item) => sum + amount(item.volume), 0);
  const quantity = itemsVolume || numberInput(form.volumeM3) || numberInput(form.quantity);
  const unit = itemsVolume || numberInput(form.volumeM3) ? "m³" : form.quantityUnit || "unidade";
  const purchasePrice = amount(form.purchaseUnitPrice);
  const rate = amount(form.logistics.exchangeRate);
  const itemsTotal = form.orderItems.reduce((sum, item) => sum + amount(item.volume) * amount(item.unitPrice), 0);
  const sale = { value: itemsTotal || numberInput(form.commercialValue), currency: form.currency };
  const purchase = { value: purchasePrice * quantity, currency: form.purchaseCurrency };
  const margin = estimateMargin({ sale, purchase, logistics: amountsOf(logisticsByCurrency(costsFromDraft(form.logistics))), rate });
  const qty = quantity ? `${quantity.toLocaleString("pt-BR")} ${unit}` : "";
  const commission = form.gainMode === "comissao";
  const commissionPercent = amount(form.commissionPercent);
  const gain = estimateCommission({ sale, percent: commissionPercent, rate });
  const setMode = (mode: string) => setForm((current) => ({ ...current, gainMode: mode }));
  const field = (key: "unitPrice" | "purchaseUnitPrice", currencyKey: "currency" | "purchaseCurrency", label: string, total: number) => (
    <label className="et2-field">
      <span>{label}</span>
      <span style={{ display: "flex", gap: 6 }}>
        <select aria-label={`Moeda: ${label}`} style={{ width: 84, flex: "none" }} value={form[currencyKey]} onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, [currencyKey]: value })); }}>
          {(currencyKey === "currency" ? ["USD", "BRL", "EUR", "GBP"] : ["BRL", "USD"]).map((code) => <option key={code} value={code}>{SYMBOL[code]}</option>)}
        </select>
        <input aria-label={label} inputMode="decimal" placeholder="0,00" value={form[key]} onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, [key]: value })); }} style={{ flex: 1, minWidth: 0 }} />
      </span>
      <small>Por {unit}{total && qty ? ` · total ${show(total, form[currencyKey])} (${qty})` : ""}</small>
      {key === "purchaseUnitPrice" && form.purchaseNote && <small style={{ color: "#92400e" }}>{form.purchaseNote}</small>}
    </label>
  );
  const given = (items: Array<{ value: number; currency: string }>) => items.length ? items.map((item) => item.currency === "USD" || item.currency === "BRL" ? `${item.currency} ${two(item.value)}` : show(item.value, item.currency)).join(" + ") : "—";
  return (
    <>
      <div className="pm-prices">
        <div className="pm-prices-title">Preços para a margem</div>
        <div className="pm-mode" role="radiogroup" aria-label="Como ganhamos neste processo">
          <span>Como ganhamos neste processo:</span>
          <label><input type="radio" name="gainMode" checked={!commission} onChange={() => setMode("margem")} /> Margem (compra e venda)</label>
          <label><input type="radio" name="gainMode" checked={commission} onChange={() => setMode("comissao")} /> Comissão</label>
        </div>
        <div className="et2-grid">
          <div className="et2-field"><span>Preço indicativo de venda</span><div className="pm-multi">{itemsTotal ? `Itens · total ${show(itemsTotal, form.currency)}` : "Preencha os preços na tabela de itens"}</div><small>Preço de cada item na tabela “Itens do pedido” acima ({form.currency})</small></div>
          {commission
            ? <label className="et2-field">
                <span>Comissão (%)</span>
                <input inputMode="decimal" placeholder="Ex.: 3" value={form.commissionPercent} onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, commissionPercent: value })); }} />
                <small>Sobre o valor do pedido{gain.gain ? ` · ${show(gain.gain, form.currency)}` : ""}</small>
              </label>
            : field("purchaseUnitPrice", "purchaseCurrency", "Preço de compra (fornecedor)", purchasePrice * quantity)}
          <label className="et2-field">
            <span>Câmbio (R$ por US$ 1)</span>
            <input inputMode="decimal" placeholder="Ex.: 5,40" value={form.logistics.exchangeRate} onChange={(event) => { const value = event.target.value; setForm((current) => ({ ...current, logistics: { ...current.logistics, exchangeRate: value } })); }} />
            <small>O mesmo da prévia logística (seção 5)</small>
          </label>
        </div>
      </div>
      {commission ? (
        <div className="pm-margin">
          <div className="pm-margin-head">Comissão estimada do processo</div>
          <table className="pm-table">
            <thead><tr><th><span className="sr-only">Item</span></th><th className="num">Valor lançado</th><th className="num">Em US$</th><th className="num">Em R$</th></tr></thead>
            <tbody>
              <tr><td>Valor do pedido{itemsTotal && form.orderItems.length ? ` (${form.orderItems.length} ${form.orderItems.length > 1 ? "itens" : "item"})` : ""}</td><td className="num">{sale.value ? show(sale.value, sale.currency) : "—"}</td><td className="num">{sale.value ? show(gain.saleUsd, "USD") : "—"}</td><td className="num">{sale.value ? show(gain.saleBrl, "BRL") : "—"}</td></tr>
              <tr className="pm-total"><td>Comissão ({commissionPercent ? `${commissionPercent.toLocaleString("pt-BR")}%` : "informe o %"})</td><td className="num">{commissionPercent ? `${commissionPercent.toLocaleString("pt-BR")}%` : "—"}</td><td className="num">{gain.gain ? show(gain.usd, "USD") : "—"}</td><td className="num">{gain.gain ? show(gain.brl, "BRL") : "—"}</td></tr>
              <tr className="pm-total"><td>Comissão por {unit}{qty ? ` (÷ ${qty})` : ""}</td><td className="num">{commissionPercent ? `${commissionPercent.toLocaleString("pt-BR")}%` : "—"}</td><td className="num">{gain.usd === null || !gain.gain || !quantity ? "—" : `${show(gain.usd / quantity, "USD")} / ${unit}`}</td><td className="num">{gain.brl === null || !gain.gain || !quantity ? "—" : `${show(gain.brl / quantity, "BRL")} / ${unit}`}</td></tr>
            </tbody>
          </table>
          <div className="pm-note">{gain.gain && (gain.usd === null || gain.brl === null) ? "Informe o câmbio para converter reais e dólares. " : ""}Processo por comissão: não há compra nem margem de revenda. A mesma conta aparece no card Financeiro do pedido.</div>
        </div>
      ) : (
      <div className="pm-margin">
        <div className="pm-margin-head">Margem estimada do processo</div>
        <table className="pm-table">
          <thead><tr><th><span className="sr-only">Item</span></th><th className="num">Valor lançado</th><th className="num">Em US$</th><th className="num">Em R$</th></tr></thead>
          <tbody>
            {margin.rows.map((row, index) => (
              <tr key={row.label}>
                <td>{index === 0 ? `Venda${itemsTotal && form.orderItems.length ? ` (${form.orderItems.length} ${form.orderItems.length > 1 ? "itens" : "item"})` : ""}` : index === 1 ? `Compra${purchasePrice && qty ? ` (${qty} × ${show(purchasePrice, form.purchaseCurrency)})` : ""}` : "Logística (prévia da seção 5)"}</td>
                <td className="num">{given(row.given)}</td>
                <td className="num">{row.given.length ? show(row.usd, "USD") : "—"}</td>
                <td className="num">{row.given.length ? show(row.brl, "BRL") : "—"}</td>
              </tr>
            ))}
            <tr className={`pm-total${(margin.usd ?? margin.brl ?? 0) < 0 ? " pm-negative" : ""}`}>
              <td>Margem (venda − compra − logística)</td>
              <td className="num">{margin.percent === null ? "—" : `${margin.percent.toFixed(1).replace(".", ",")}%`}</td>
              <td className="num">{show(margin.usd, "USD")}</td>
              <td className="num">{show(margin.brl, "BRL")}</td>
            </tr>
            <tr className={`pm-total${(margin.usd ?? margin.brl ?? 0) < 0 ? " pm-negative" : ""}`}>
              <td>Margem por {unit}{qty ? ` (÷ ${qty})` : ""}</td>
              <td className="num">{margin.percent === null ? "—" : `${margin.percent.toFixed(1).replace(".", ",")}%`}</td>
              <td className="num">{margin.usd === null || !quantity ? "—" : `${show(margin.usd / quantity, "USD")} / ${unit}`}</td>
              <td className="num">{margin.brl === null || !quantity ? "—" : `${show(margin.brl / quantity, "BRL")} / ${unit}`}</td>
            </tr>
          </tbody>
        </table>
        <div className="pm-note">{margin.percent === null && sale.value && purchase.value ? "Informe o câmbio para converter reais e dólares. " : ""}A mesma conta aparece no card Financeiro do pedido. Quando o pedido de compra e o de venda forem emitidos (fase Pedido), os valores deles substituem estes indicativos.</div>
      </div>
      )}
    </>
  );
}

// Itens do pedido: uma linha por item, com "+ Adicionar item". Ao salvar, viram os itens do pedido
// de venda (emissão de documentos), o valor comercial (soma volume × preço) e a base do Financeiro.
function itemsPayload(items: OrderItemDraft[]) {
  return items.map((item) => ({ species: item.species, quality: item.quality, size: item.size, volume: amount(item.volume), unitPrice: amount(item.unitPrice) }));
}

function OrderItemsEditor({ form, setForm }: { form: Form; setForm: (update: (current: Form) => Form) => void }) {
  const setItem = (index: number, patch: Partial<OrderItemDraft>) => setForm((current) => ({ ...current, orderItems: current.orderItems.map((item, at) => at === index ? { ...item, ...patch } : item) }));
  const add = () => setForm((current) => ({ ...current, orderItems: [...current.orderItems, emptyItem(current.orderItems.at(-1)?.species || current.species, current.orderItems.at(-1)?.quality || current.product)] }));
  const remove = (index: number) => setForm((current) => ({ ...current, orderItems: current.orderItems.length > 1 ? current.orderItems.filter((_, at) => at !== index) : [emptyItem()] }));
  const total = form.orderItems.reduce((sum, item) => sum + amount(item.volume) * amount(item.unitPrice), 0);
  const volume = form.orderItems.reduce((sum, item) => sum + amount(item.volume), 0);
  const cell = (index: number, key: keyof OrderItemDraft, label: string, placeholder: string, numeric = false) => (
    <input className="pd-input" style={numeric ? { textAlign: "right" } : undefined} inputMode={numeric ? "decimal" : undefined} aria-label={`${label} do item ${index + 1}`} placeholder={placeholder}
      value={form.orderItems[index][key]} onChange={(event) => setItem(index, { [key]: event.target.value })} />
  );
  return (
    <div className="pm-margin">
      <div className="pm-margin-head">Itens do pedido · {form.orderItems.length}</div>
      <table className="pm-table pm-items">
        <thead><tr><th>Espécie</th><th>Produto / qualidade</th><th>Medidas</th><th className="num">Volume (m³)</th><th className="num">Preço ({SYMBOL[form.currency] ?? form.currency}/m³)</th><th className="num">Total</th><th><span className="sr-only">Remover</span></th></tr></thead>
        <tbody>
          {form.orderItems.map((item, index) => (
            <tr key={index}>
              <td>{cell(index, "species", "Espécie", "Ex.: Pinus taeda")}</td>
              <td>{cell(index, "quality", "Produto", "Ex.: S4S A grade")}</td>
              <td>{cell(index, "size", "Medidas", "Ex.: 18 × 89 × 2440")}</td>
              <td className="num">{cell(index, "volume", "Volume", "0,000", true)}</td>
              <td className="num">{cell(index, "unitPrice", "Preço", "0,00", true)}</td>
              <td className="num">{show(amount(item.volume) * amount(item.unitPrice), form.currency)}</td>
              <td style={{ textAlign: "center" }}><button type="button" className="lc-remove" aria-label={`Remover item ${index + 1}`} onClick={() => remove(index)}>×</button></td>
            </tr>
          ))}
          <tr className="pm-total"><td colSpan={3}>Total dos itens (vira o valor comercial ao salvar)</td><td className="num">{volume.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</td><td /><td className="num">{show(total, form.currency)}</td><td /></tr>
        </tbody>
      </table>
      <div className="lc-add-row"><button type="button" className="lc-add" onClick={add}>+ Adicionar item</button></div>
    </div>
  );
}

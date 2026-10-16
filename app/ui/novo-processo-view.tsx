"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, money, normalize, processHref } from "./format";
import { LOGISTICS_COST_FIELDS } from "../../lib/logistics-costs";

type Supplier = { id: number; legalName: string; tradeName: string; taxId: string; city: string; state: string; country: string; products: string; productionUnits: string };
type Client = { id: number; legalName: string; aliases: string; country: string; eori: string; preferredPort: string; preferredIncoterm?: string; preferredCurrency?: string };
type Product = { id: number; name: string; hsCode: string; rawMaterial: string; species: string; originType: string; salesUnit?: string };
type Property = { carCode: string; name: string; city: string; supplier: string; areaHa: number };

const EMPTY = {
  reference: "", product: "", hsCode: "", contractNumber: "", internalResponsible: "", responsibleEmail: "",
  supplierId: "", exporterId: "", exporterName: "", exporterTaxId: "", euImporter: "", importerClientId: "", euOperatorEori: "", eudrReference: "",
  rawMaterial: "", species: "", forestOriginType: "Reflorestamento", productionUnit: "", lotCodes: "", propertyIds: [] as string[],
  quantity: "", quantityUnit: "MT", volumeM3: "", netWeightKg: "", grossWeightKg: "", incoterm: "FOB", currency: "USD", commercialValue: "",
  transportMode: "Marítimo", shipmentDate: "", destinationCountry: "", portOfLoading: "", portOfDischarge: "", carrier: "", bookingNumber: "", billOfLadingNumber: "", containerNumbers: "", vesselVoyage: "",
  supplyChainNotes: "",
  lcCurrency: "BRL", lcInlandFreight: "", lcPortCharges: "", lcCustomsBroker: "", lcOceanFreight: "", lcInsurance: "", lcOther: "", lcNotes: "",
};
type Form = typeof EMPTY;
type Key = Exclude<keyof Form, "propertyIds">;

const DRAFT_KEY = "et2-novo-processo-rascunho";

/** Campo do formulário de cada custo logístico (ex.: inlandFreight → lcInlandFreight). */
const costKey = (key: string) => `lc${key[0].toUpperCase()}${key.slice(1)}` as Key;
/** Valor digitado no padrão brasileiro (1.234,56) ou internacional (1234.56). */
const amount = (value: unknown) => {
  const raw = String(value ?? "").replace(/\s/g, "");
  const parsed = Number(raw.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw);
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
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : null;
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

  useEffect(() => {
    const draft = loadDraft();
    if (draft) { setForm(draft); setRestored(true); }
    api<{ suppliers: Supplier[] }>("/api/suppliers").then((d) => setSuppliers(d.suppliers)).catch(() => {});
    api<{ clients: Client[] }>("/api/importer-clients").then((d) => setClients(d.clients)).catch(() => {});
    api<{ products: Product[] }>("/api/master-products").then((d) => setProducts(d.products)).catch(() => {});
    api<{ properties: Property[] }>("/api/properties").then((d) => setProperties(d.properties)).catch(() => {});
  }, []);

  useEffect(() => {
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
    return { currency: form.lcCurrency, notes: form.lcNotes, ...Object.fromEntries(LOGISTICS_COST_FIELDS.map(([key]) => [key, amount(form[costKey(key)])])) };
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
      const result = await api<{ operation: { id: number; reference: string }; duplicate?: boolean }>("/api/operations", { method: "POST", body: JSON.stringify({ ...form, logisticsCosts: logisticsCosts() }) });
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
      <nav className="et2-crumbs" aria-label="Caminho"><Link href="/pedidos">Pedidos</Link> / Novo processo</nav>
      <div className="et2-head">
        <div>
          <h1>Novo processo de exportação</h1>
          <p>Registre pedido, participantes, produto, origem, volumes e logística. Estes dados alimentam o acompanhamento, os documentos e o dossiê EUDR.</p>
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
              {input("reference", "Referência da operação", { placeholder: "Ex.: GBU003/26 · vazio gera automático" })}
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
              {select("currency", "Moeda", ["USD", "EUR", "GBP", "BRL"])}
              {input("commercialValue", "Valor comercial", { type: "number" })}
            </div>}

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
              <small className="et2-sub" style={{ display: "block", margin: "2px 0 10px" }}>Estimativa para o financeiro calcular a margem do pedido. Pode ser ajustada depois, dentro do pedido.</small>
              <div className="et2-grid">
                {select("lcCurrency", "Moeda dos custos", ["BRL", "USD", "EUR"])}
                {LOGISTICS_COST_FIELDS.map(([key, label]) => input(costKey(key), label, { placeholder: "0,00" }))}
                {input("lcNotes", "Observações dos custos", { placeholder: "Ex.: cotação do armador, validade" })}
              </div>
              <div style={{ marginTop: 10, fontWeight: 600 }}>Total estimado: {money(LOGISTICS_COST_FIELDS.reduce((sum, [key]) => sum + amount(form[costKey(key)]), 0), form.lcCurrency)}</div>
            </div>}

            {step === 5 && <label className="et2-field">
              <span>Fluxo, particularidades e participantes ainda não cadastrados</span>
              <textarea rows={7} value={form.supplyChainNotes} placeholder="Descreva o caminho da matéria-prima até o importador europeu…" onChange={(event) => set("supplyChainNotes", event.target.value)} />
            </label>}
          </div>
          <div className="et2-foot">
            <button className="et2-btn" disabled={step === 0} onClick={() => setStep(step - 1)}>← Voltar</button>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12 }}>Rascunho salvo automaticamente neste navegador</span>
              {step < SECTIONS.length - 1
                ? <button className="et2-btn et2-btn--primary" onClick={() => setStep(step + 1)}>Próximo →</button>
                : <button className="et2-btn et2-btn--ok" disabled={saving} onClick={submit}>{saving ? "Criando…" : "Criar processo ✓"}</button>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

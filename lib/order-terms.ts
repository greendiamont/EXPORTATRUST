// Termos negociados do processo que ficam junto dos dados do pedido em
// operations.supply_chain_notes (JSON da emissão de documentos: orderItems, paymentTerms,
// orderNotes, supplierOrder, packingList). Texto livre antigo (sem JSON) vira orderNotes,
// como já faz a emissão de documentos — nada é perdido.
// O preço indicativo de compra (antes do pedido de compra ser emitido) fica em `purchasePrice`
// ({ unitPrice, currency }) no mesmo JSON; serve para a margem estimada do processo.
// Se o pedido de compra já foi emitido com um único item, o preço de compra editado no processo
// atualiza também esse item (como o preço de venda atualiza o pedido de venda), para o processo
// e o Financeiro do pedido mostrarem a mesma conta.

export type OrderTermsSource = {
  supplyChainNotes: string | null;
  product: string;
  species: string;
  rawMaterial: string;
  lotCodes: string;
  quantity: number;
  volumeM3: number;
  commercialValue: number;
};

type Item = { species: string; quality: string; size: string; volume: number; unitPrice: number };

function parse(source: OrderTermsSource): { json: Record<string, unknown> | null; text: string } {
  const raw = source.supplyChainNotes ?? "";
  try {
    const value = JSON.parse(raw || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) return { json: value as Record<string, unknown>, text: "" };
  } catch { /* texto livre */ }
  return { json: null, text: raw };
}

function fallbackItem(source: OrderTermsSource): Item {
  const volume = source.volumeM3 || source.quantity || 0;
  return { species: source.species || source.rawMaterial || "", quality: source.product, size: source.lotCodes || "", volume, unitPrice: volume ? source.commercialValue / volume : 0 };
}

function items(json: Record<string, unknown> | null): Item[] {
  const list = json && Array.isArray(json.orderItems) ? json.orderItems as Array<Record<string, unknown>> : [];
  return list.map((item) => ({ species: String(item.species ?? ""), quality: String(item.quality ?? ""), size: String(item.size ?? ""), volume: Number(item.volume) || 0, unitPrice: Number(item.unitPrice) || 0 }));
}

/** Termos para leitura (Painel, edição do processo). */
export function readOrderTerms(source: OrderTermsSource) {
  const { json, text } = parse(source);
  const list = items(json);
  const effective = list.length ? list : [fallbackItem(source)];
  const purchase = json && json.purchasePrice && typeof json.purchasePrice === "object" ? json.purchasePrice as Record<string, unknown> : {};
  const supplierOrder = json && json.supplierOrder && typeof json.supplierOrder === "object" ? json.supplierOrder as Record<string, unknown> : null;
  const supplierItems = supplierOrder && Array.isArray(supplierOrder.items) ? supplierOrder.items as Array<Record<string, unknown>> : [];
  const singleSupplierPrice = supplierItems.length === 1 ? Number(supplierItems[0].unitPrice) || 0 : 0;
  return {
    purchaseUnitPrice: Number(purchase.unitPrice) || singleSupplierPrice,
    purchaseCurrency: String(purchase.currency ?? "") || (singleSupplierPrice ? String(supplierOrder?.currency ?? "") : "") || "BRL",
    supplierItemCount: supplierItems.length,
    /** Pedido de compra emitido (com itens) na fase Pedido: substitui o preço indicativo de compra. */
    hasSupplierOrder: Boolean(supplierOrder && Array.isArray(supplierOrder.items) && supplierOrder.items.length),
    paymentTerms: json ? String(json.paymentTerms ?? "") : "",
    notes: json ? String(json.orderNotes ?? "") : text,
    sizes: [...new Set(effective.map((item) => item.size).filter(Boolean))].join("; "),
    unitPrice: effective.length === 1 ? effective[0].unitPrice : null,
    itemCount: effective.length,
    /** Pedido cancelado (fica no fim das listas, em vermelho); null se ativo. */
    cancelled: json && json.cancelled && typeof json.cancelled === "object" ? json.cancelled as { at: string; by: string; previousStatus: string } : null,
    /** Como ganhamos no processo: margem (compra e venda) ou comissão (% sobre o valor do pedido). */
    gainMode: json && json.remuneration && typeof json.remuneration === "object" && (json.remuneration as Record<string, unknown>).mode === "comissao" ? "comissao" : "margem",
    commissionPercent: json && json.remuneration && typeof json.remuneration === "object" ? Number((json.remuneration as Record<string, unknown>).percent) || 0 : 0,
    /** Itens do pedido de venda (com vários itens, medida e preço são editados item a item). */
    items: effective,
  };
}

export type OrderItemChange = { species?: string; quality?: string; size?: string; volume?: number; unitPrice?: number };
export type OrderTermsChanges = { remuneration?: { mode: string; percent: number }; paymentTerms?: string; size?: string; unitPrice?: number; notes?: string; purchaseUnitPrice?: number; purchaseCurrency?: string; items?: OrderItemChange[] };

/**
 * Aplica mudanças nos termos. Medida e preço só mudam quando o pedido tem um único item
 * (com vários itens a edição é feita na emissão de documentos). Devolve o novo JSON e,
 * se o preço mudou, o novo valor comercial (quantidade × preço).
 */
export function applyOrderTerms(source: OrderTermsSource, changes: OrderTermsChanges): { supplyChainNotes: string; commercialValue?: number; error?: string } {
  const { json, text } = parse(source);
  const next: Record<string, unknown> = json ? { ...json } : (text ? { orderNotes: text } : {});
  if (changes.paymentTerms !== undefined) next.paymentTerms = changes.paymentTerms.trim();
  if (changes.notes !== undefined) next.orderNotes = changes.notes.trim();
  if (changes.remuneration) {
    const percent = Number(changes.remuneration.percent);
    next.remuneration = { mode: changes.remuneration.mode === "comissao" ? "comissao" : "margem", percent: Number.isFinite(percent) && percent > 0 ? Math.round(percent * 10000) / 10000 : 0 };
  }
  if (changes.purchaseUnitPrice !== undefined || changes.purchaseCurrency !== undefined) {
    const previous = next.purchasePrice && typeof next.purchasePrice === "object" ? next.purchasePrice as Record<string, unknown> : {};
    const unitPrice = changes.purchaseUnitPrice !== undefined && Number.isFinite(changes.purchaseUnitPrice) ? Math.max(0, changes.purchaseUnitPrice) : Number(previous.unitPrice) || 0;
    const currency = (changes.purchaseCurrency ?? String(previous.currency ?? "BRL")).trim().toUpperCase().slice(0, 3) || "BRL";
    next.purchasePrice = { unitPrice, currency };
    const supplierOrder = next.supplierOrder && typeof next.supplierOrder === "object" ? next.supplierOrder as Record<string, unknown> : null;
    if (supplierOrder && Array.isArray(supplierOrder.items) && supplierOrder.items.length === 1) {
      next.supplierOrder = { ...supplierOrder, currency, items: [{ ...(supplierOrder.items[0] as Record<string, unknown>), unitPrice }] };
    }
  }
  let commercialValue: number | undefined;
  // Lista de itens do pedido (tabela com "+ Adicionar item"): substitui os itens na ordem dada,
  // preservando campos extras de cada item existente; o valor comercial passa a ser a soma
  // volume × preço, como na emissão de documentos.
  if (changes.items) {
    const raw = json && Array.isArray(json.orderItems) ? json.orderItems as Array<Record<string, unknown>> : [];
    const text = (value: unknown) => String(value ?? "").trim();
    const updated = changes.items.map((change, index) => {
      const item = raw[index] ?? {};
      const number = (value: unknown, fallback: unknown) => value !== undefined && Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : Number(fallback) || 0;
      return {
        ...item,
        species: change.species !== undefined ? text(change.species) : text(item.species),
        quality: change.quality !== undefined ? text(change.quality) : text(item.quality),
        size: change.size !== undefined ? text(change.size) : text(item.size),
        volume: number(change.volume, item.volume),
        unitPrice: number(change.unitPrice, item.unitPrice),
      } as Record<string, unknown>;
    }).filter((item) => item.species || item.quality || item.size || item.volume || item.unitPrice);
    next.orderItems = updated;
    const total = updated.reduce((sum, item) => sum + (Number(item.volume) || 0) * (Number(item.unitPrice) || 0), 0);
    if (total > 0) commercialValue = Math.round(total * 100) / 100;
    return { supplyChainNotes: JSON.stringify(next), ...(commercialValue !== undefined ? { commercialValue } : {}) };
  }
  if (changes.size !== undefined || changes.unitPrice !== undefined) {
    const list = items(json);
    if (list.length > 1) return { supplyChainNotes: source.supplyChainNotes ?? "", error: "Este pedido tem vários itens: altere medidas e preços na emissão de documentos (fase Pedido)." };
    const item = list[0] ?? fallbackItem(source);
    if (changes.size !== undefined) item.size = changes.size.trim();
    if (changes.unitPrice !== undefined && Number.isFinite(changes.unitPrice)) {
      item.unitPrice = changes.unitPrice;
      if (item.volume) commercialValue = Math.round(item.volume * item.unitPrice * 100) / 100;
    }
    next.orderItems = [item];
  }
  return { supplyChainNotes: JSON.stringify(next), ...(commercialValue !== undefined ? { commercialValue } : {}) };
}

/** Marca ou desfaz o cancelamento do pedido no JSON do pedido (a situação do processo muda a cada etapa). */
export function setOrderCancelled(source: { supplyChainNotes: string | null; status: string }, cancel: boolean, by: string, at = new Date().toISOString()) {
  const { json, text } = parse({ supplyChainNotes: source.supplyChainNotes } as OrderTermsSource);
  const next: Record<string, unknown> = json ? { ...json } : (text ? { orderNotes: text } : {});
  const previous = next.cancelled && typeof next.cancelled === "object" ? next.cancelled as Record<string, unknown> : null;
  if (cancel) next.cancelled = { at, by, previousStatus: previous ? String(previous.previousStatus ?? "") : source.status };
  else delete next.cancelled;
  return { supplyChainNotes: JSON.stringify(next), status: cancel ? "Cancelado" : String(previous?.previousStatus || "Em andamento") };
}

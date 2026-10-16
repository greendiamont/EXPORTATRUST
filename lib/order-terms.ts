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
    /** Itens do pedido de venda (com vários itens, medida e preço são editados item a item). */
    items: effective,
  };
}

export type OrderItemChange = { size?: string; unitPrice?: number };
export type OrderTermsChanges = { paymentTerms?: string; size?: string; unitPrice?: number; notes?: string; purchaseUnitPrice?: number; purchaseCurrency?: string; items?: OrderItemChange[] };

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
  // Vários itens: medida e preço de cada item (mesma ordem do pedido); o valor comercial passa a
  // ser a soma volume × preço, como na emissão de documentos. Demais campos do item são mantidos.
  if (changes.items) {
    const raw = json && Array.isArray(json.orderItems) ? json.orderItems as Array<Record<string, unknown>> : [];
    const base = raw.length ? raw : [fallbackItem(source) as unknown as Record<string, unknown>];
    if (changes.items.length !== base.length) return { supplyChainNotes: source.supplyChainNotes ?? "", error: "Os itens do pedido mudaram enquanto você editava. Abra o processo de novo." };
    const updated = base.map((item, index) => {
      const change = changes.items![index];
      const unitPrice = change.unitPrice !== undefined && Number.isFinite(change.unitPrice) ? change.unitPrice : Number(item.unitPrice) || 0;
      return { ...item, size: change.size !== undefined ? change.size.trim() : String(item.size ?? ""), unitPrice } as Record<string, unknown>;
    });
    next.orderItems = updated;
    commercialValue = Math.round(updated.reduce((sum, item) => sum + (Number(item.volume) || 0) * (Number(item.unitPrice) || 0), 0) * 100) / 100;
    return { supplyChainNotes: JSON.stringify(next), commercialValue };
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

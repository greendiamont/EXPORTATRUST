// Termos negociados do processo que ficam junto dos dados do pedido em
// operations.supply_chain_notes (JSON da emissão de documentos: orderItems, paymentTerms,
// orderNotes, supplierOrder, packingList). Texto livre antigo (sem JSON) vira orderNotes,
// como já faz a emissão de documentos — nada é perdido.

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
  return {
    paymentTerms: json ? String(json.paymentTerms ?? "") : "",
    notes: json ? String(json.orderNotes ?? "") : text,
    sizes: [...new Set(effective.map((item) => item.size).filter(Boolean))].join("; "),
    unitPrice: effective.length === 1 ? effective[0].unitPrice : null,
    itemCount: effective.length,
  };
}

export type OrderTermsChanges = { paymentTerms?: string; size?: string; unitPrice?: number; notes?: string };

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
  let commercialValue: number | undefined;
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

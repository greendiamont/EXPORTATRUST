export type ShipmentDocumentAnalysis = {
  documentType: string;
  category: string;
  lifecycleStatus: "Rascunho" | "Vigente" | "Final" | "Histórico";
  shipmentSetStatus: "Fora do set" | "Candidato" | "Incluído";
  clientShareStatus: "Interno" | "Revisão pendente" | "Aprovado";
  analysisSummary: string;
};

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_-]+/g, " ");
}

export function analyzeShipmentDocument(fileName: string, extractedText = ""): ShipmentDocumentAnalysis {
  const text = normalized(`${fileName} ${extractedText.slice(0, 4000)}`);
  const finalMarker = /\b(final|original|retificado|adjusted)\b/.test(text);
  const draftMarker = /\b(draft|rascunho)\b/.test(text);
  const signedMarker = /\b(signed|assinad[oa])\b/.test(text);
  let documentType = "Outro documento";
  let category = "Export Control · Set documental";
  let clientFacing = false;

  if (/sales\s*order|s\.o\b|\bso\b/.test(text)) {
    documentType = "Sales Order";
    category = "Export Control · Pedido confirmado";
  } else if (/booking|reserva\s*(maritima|de\s*carga)/.test(text)) {
    documentType = "Booking / reserva marítima";
    category = "Export Control · Booking";
  } else if (/swift|mt103|pagamento|payment|fechamento/.test(text)) {
    documentType = "Comprovante financeiro / SWIFT";
    category = "Export Control · Set documental";
  } else if (/tally/.test(text)) {
    documentType = "Tally / conferência de carga";
    category = "Export Control · Estufagem e fotos";
  } else if (/limpeza\s*de\s*container|container\s*clean/.test(text)) {
    documentType = "Certificado de limpeza do contêiner";
    category = "Export Control · Estufagem e fotos";
  } else if (/freight|frete|numerario|proposta\s*comercial|fatura.*brz/.test(text)) {
    documentType = "Cotação / fatura de frete";
    category = "Export Control · Booking";
  } else if (/packing\s*list|romaneio/.test(text)) {
    documentType = "Packing List";
    clientFacing = true;
  } else if (/bill\s*of\s*lading|\bbl\b|\bb\/l\b/.test(text)) {
    documentType = "Bill of Lading";
    category = finalMarker ? "Export Control · Embarcado" : "Export Control · Set documental";
    clientFacing = true;
  } else if (/certificate\s*of\s*origin|certificado\s*(comum|de\s*origem)|\bco\b/.test(text)) {
    documentType = "Certificado de Origem";
    clientFacing = true;
  } else if (/tratamento\s*termico|heat\s*treatment|\bht\b|ispm|nimf/.test(text)) {
    documentType = "Certificado de Tratamento Térmico";
    clientFacing = true;
  } else if (/phytosanitary|fitossanit|\bphyto\b|\bfito\b/.test(text)) {
    documentType = "Certificado Fitossanitário";
    clientFacing = true;
  } else if (/commercial\s*invoice|\binvoice\b|\bfatura\b/.test(text) && !/freight|frete/.test(text)) {
    documentType = "Commercial Invoice";
    clientFacing = true;
  } else if (/purchase\s*order|ordem\s*(de\s*)?compra|\bpo\d/.test(text)) {
    documentType = "Purchase Order";
    category = "Export Control · Pedido confirmado";
  } else if (/nota\s*fiscal|\bnf[e]?\b|carta\s*de\s*correcao|\bcce\b/.test(text)) {
    documentType = "Documento fiscal brasileiro";
  } else if (/certificado|certificate|\bcert\b/.test(text)) {
    documentType = "Certificado de embarque";
    clientFacing = true;
  }

  const lifecycleStatus: ShipmentDocumentAnalysis["lifecycleStatus"] = draftMarker ? "Rascunho" : finalMarker ? "Final" : signedMarker ? "Vigente" : "Vigente";
  const shipmentSetStatus: ShipmentDocumentAnalysis["shipmentSetStatus"] = clientFacing
    ? lifecycleStatus === "Final" ? "Incluído" : "Candidato"
    : "Fora do set";
  const clientShareStatus: ShipmentDocumentAnalysis["clientShareStatus"] = clientFacing ? "Revisão pendente" : "Interno";
  const analysisSummary = `${documentType}; ${lifecycleStatus.toLowerCase()}. ${clientFacing ? "Documento potencialmente compartilhável no Shipment Advice, sujeito à conferência humana." : "Evidência interna preservada na etapa operacional correspondente."}`;
  return { documentType, category, lifecycleStatus, shipmentSetStatus, clientShareStatus, analysisSummary };
}

export const SHIPMENT_ADVICE_CHECKLIST = [
  { key: "invoice", label: "Commercial Invoice", types: ["Commercial Invoice"], required: true },
  { key: "packing", label: "Packing List", types: ["Packing List"], required: true },
  { key: "bl", label: "Bill of Lading", types: ["Bill of Lading"], required: true },
  { key: "origin", label: "Certificado de Origem", types: ["Certificado de Origem"], required: true },
  { key: "phyto", label: "Certificado Fitossanitário", types: ["Certificado Fitossanitário"], required: true },
  { key: "ht", label: "Tratamento térmico / HT", types: ["Certificado de Tratamento Térmico"], required: false },
  { key: "photos", label: "Fotos / evidências de carregamento", types: ["Tally / conferência de carga", "Certificado de limpeza do contêiner"], required: false },
] as const;

export function resolvedShipmentDocumentType(document: { fileName?: string; documentType?: string; analysisSummary?: string }) {
  const stored = String(document.documentType || "").trim();
  if (stored && stored !== "Outro documento" && stored !== "Documento") return stored;
  return analyzeShipmentDocument(document.fileName || "", document.analysisSummary || "").documentType;
}

export function shipmentChecklist(documents: Array<{ fileName?: string; documentType?: string; analysisSummary?: string; shipmentSetStatus: string }>) {
  return SHIPMENT_ADVICE_CHECKLIST.map((item) => ({
    key: item.key,
    label: item.label,
    required: item.required,
    present: documents.some((document) => document.shipmentSetStatus === "Incluído" && item.types.includes(resolvedShipmentDocumentType(document) as never)),
  }));
}

export const SHIPMENT_SET_CATEGORY = "Export Control · Set documental";

export function isShipmentSetDocument(document: { category?: string }) {
  return document.category === SHIPMENT_SET_CATEGORY;
}

export function buildShipmentAdvice(
  operation: {
    reference: string;
    product?: string;
    supplierName?: string;
    euImporter?: string;
    contractNumber?: string;
    bookingNumber: string;
    containerNumbers: string;
    vesselVoyage: string;
    portOfLoading: string;
    portOfDischarge: string;
    destinationCountry?: string;
    shipmentDate?: string;
    currency?: string;
    commercialValue?: number;
    quantity?: number;
    quantityUnit?: string;
    supplierBankDetails?: string;
  },
  documents: Array<{ id: number; fileName: string; category?: string; documentType: string; shipmentSetStatus: string; clientShareStatus?: string }>,
  customer: { name: string; email: string },
) {
  const candidates = documents.filter(isShipmentSetDocument).map((document) => ({ ...document, documentType: resolvedShipmentDocumentType(document) }));
  const included = candidates.filter((document) => document.shipmentSetStatus === "Incluído" && document.clientShareStatus === "Aprovado");
  const checklist = shipmentChecklist(included);
  const invoice = operation.contractNumber || operation.reference;
  const destination = operation.portOfDischarge || operation.destinationCountry || "TBC";
  const containerCount = operation.containerNumbers
    ? `${operation.containerNumbers.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean).length || 1}*40HC`
    : "40HC";
  const customerName = customer.name || operation.euImporter || "customer";
  const supplierName = operation.supplierName || "supplier";
  const subject = `SHIPMENT - ${operation.bookingNumber || operation.reference} - INVOICE ${invoice} // ${supplierName} X ${customerName} // ${destination} // ${containerCount}`;
  const attachedTypes = included.length
    ? [...new Set(included.map((document) => document.documentType))].join(", ")
    : "BL, Invoice, Packing List, CO and Phyto copy";
  const currency = operation.currency || "USD";
  const total = Number(operation.commercialValue || 0);
  const advance = total > 0 ? total * 0.3 : 0;
  const balance = total > 0 ? Math.max(0, total - advance) : 0;
  const money = (value: number) => value > 0 ? `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${currency} TBC`;
  const etd = operation.shipmentDate ? new Date(operation.shipmentDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "TBC";
  const greeting = customer.name ? `Dear ${customer.name}` : "Dear customer";
  const bankDetails = operation.supplierBankDetails?.trim() || "Supplier bank details pending in ExportaTrust supplier master data.";
  const body = `${greeting}

Pls find attached the draft docs for ${subject}

Note we have 14day free time - for the equipment - 40'HC, not for the POD port - mustly of that work with 7days.

===========================================================

ATT ${customerName.toUpperCase()}

We need the balanced payment so we can send you the original set by fedex!

INVOICE: ${invoice}

* ETD: ${etd}

* ETA AT DESTINATION: TBC

ATTACHED: ${attachedTypes}.

* Please note ETA at POD is just an estimation and should not be considered as the official arrival date.

* Please refer to the carrier's website for track purposes.

________________________________________________________________________________

Find attached copy of shipping documents (draft).

Please note that any changes or corrections after this date will incur additional costs.

Please kindly provide the payment of this invoice, and send us the swift copy.

PAYMENT TERM: 30% ADV 70% TT AGAINST COPY OF DOCUMENTS.

TOTAL INVOICE     = ${money(total)}

30% ADV           = ${money(advance)}

TOTAL TO BE PAID  = ${money(balance)}

COMMERCIAL INVOICE: ${invoice}

________________________________________________________________________________

PLEASE CREDIT:

BANK DETAILS:

${bankDetails}`;
  return {
    recipient: customer.email,
    subject,
    body,
    candidates,
    included,
    checklist,
  };
}

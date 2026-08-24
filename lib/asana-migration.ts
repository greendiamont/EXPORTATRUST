export const VLP_ASANA_PROJECT = {
  id: "1210731947360004",
  name: "VLP EXPORTAÇÃO",
  url: "https://app.asana.com/1/1210685321414912/project/1210731947360004",
} as const;

export const ASANA_SECTION_MAP: Record<string, string> = {
  "PEDIDO NOVO - ENVIAR PARA EMISSÃO": "ORDER_CONFIRMED",
  "AGUARDANDO ASSINATURA CLIENTE": "ORDER_CONFIRMED",
  "EM PRODUCAO": "PRODUCTION",
  "EMBARQUE": "BOOKING",
  "DOCUMENTACAO": "DOCUMENT_SET",
  "POS VENDA": "IN_TRANSIT",
};

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

export function asanaMilestoneForSection(sectionName: string) {
  return ASANA_SECTION_MAP[normalized(sectionName)] ?? "";
}

export function classifyAsanaCandidate(input: {
  name: string;
  sectionName: string;
  sourceStatus?: string;
  parentTaskGid?: string;
  dueDate?: string;
  assigneeName?: string;
  completed?: boolean;
}) {
  const name = normalized(input.name);
  const section = normalized(input.sectionName);
  const sourceStatus = normalized(input.sourceStatus ?? "");
  const reasons: string[] = [];
  let importStatus = "Aguardando revisão";

  if (input.completed) importStatus = "Ignorado · concluído na origem";
  if (name.includes("MODELO") || name.includes("TEMPLATE")) importStatus = "Ignorado · modelo";
  if (sourceStatus === "LIQUIDADO") importStatus = "Ignorado · liquidado";
  if (sourceStatus === "STAND-BY" || sourceStatus === "STANDBY") importStatus = "Em espera · stand-by";
  if (section === "FINALIZADO/CANCELADO") importStatus = "Ignorado · arquivo";
  if (section === "INICIO APROACH" || section === "ENVIO DE PROPOSTA") importStatus = "Ignorado · pré-operação";
  if (input.parentTaskGid) reasons.push("Subtarefa: vincular à operação-pai");
  if (!input.assigneeName) reasons.push("Sem responsável");
  if (!input.dueDate) reasons.push("Sem prazo");
  if (!asanaMilestoneForSection(section) && importStatus === "Aguardando revisão") reasons.push("Etapa sem mapeamento automático");

  return {
    proposedMilestoneCode: asanaMilestoneForSection(section),
    importStatus,
    attentionReasons: reasons,
  };
}

function valueAfterLabel(notes: string, labels: string[]) {
  const lines = notes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, "i"));
      if (match?.[1]?.trim()) return match[1].trim();
    }
  }
  return "";
}

function yearDate(value: string) {
  const match = value.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!match) return "";
  const year = match[3] ? Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]) : 2026;
  const month = Number(match[2]);
  const day = Number(match[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function asanaOperationReference(name: string, taskGid: string) {
  const gbu = name.match(/\bGBU\s*\d{2,4}\s*[-/]\s*\d{2}\b/i)?.[0];
  const purchaseOrder = name.match(/\bPO\s*\d{3,8}\b/i)?.[0];
  const numbered = name.match(/\b\d{3}\/\d{2}(?:\s*[A-Z])?/i)?.[0];
  return (gbu || purchaseOrder || numbered || `ASANA-${taskGid.slice(-8)}`).replace(/\s+/g, " ").trim().toUpperCase();
}

export function asanaReferenceKey(value: string) {
  return normalized(value).replace(/[^A-Z0-9]/g, "");
}

export function parseAsanaOperation(input: {
  taskGid: string;
  name: string;
  notes: string;
  sectionName: string;
  assigneeName: string;
  assigneeEmail: string;
  dueDate: string;
  sourceUrl: string;
}) {
  const notes = input.notes.trim();
  const upper = normalized(`${input.name}\n${notes}`);
  const importer = valueAfterLabel(notes, ["CLIENTE", "CUSTOMER", "COSTUMER"]);
  const supplier = valueAfterLabel(notes, ["FORNECEDOR", "SUPPLIER"]);
  const destination = valueAfterLabel(notes, ["DESTINO", "DESTINATION"]);
  const volumeText = valueAfterLabel(notes, ["VOLUME"]);
  const volumeContainers = Number(volumeText.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(",", ".") ?? 0);
  const size = valueAfterLabel(notes, ["SIZE VENDA", "SALE SIZE", "DIMENSÕES", "DIMENSIONS"]);
  const quality = valueAfterLabel(notes, ["QUALITY", "QUALIDADE"]);
  const agent = valueAfterLabel(notes, ["AGENTE DE CARGA", "FREIGHT FORWARDER"]);
  const vessel = valueAfterLabel(notes, ["NAVIO", "VESSEL"]);
  const etd = valueAfterLabel(notes, ["ETD"]);
  const destinationCountry = upper.includes("INDIA") || upper.includes("NHAVA SHEVA") || upper.includes("MUNDRA") ? "Índia"
    : upper.includes("VIETNA") || upper.includes("CAT LAI") || upper.includes("HO CHI MINH") ? "Vietnã"
      : upper.includes("INGLATERRA") || upper.includes("UNITED KINGDOM") || upper.includes("FELIXSTOWE") ? "Reino Unido"
        : upper.includes("HOLANDA") || upper.includes("NETHERLANDS") || upper.includes("ROTTERDAM") ? "Países Baixos"
          : upper.includes("CHINA") ? "China" : "Revisar destino";
  const rawMaterial = upper.includes("TEAK") || upper.includes("TECA") ? "Madeira de teca"
    : upper.includes("PARICA") ? "Madeira de paricá" : "Madeira de pinus";
  const species = rawMaterial.includes("teca") ? "Tectona grandis" : rawMaterial.includes("paricá") ? "Schizolobium parahyba var. amazonicum" : "Pinus spp.";
  const incoterm = upper.includes("PRECO FOB") || upper.includes("PREÇO FOB") ? "FOB" : upper.includes("CIF") ? "CIF" : "Revisar";
  const shipmentDate = yearDate(etd) || yearDate(input.dueDate);
  return {
    reference: asanaOperationReference(input.name, input.taskGid),
    product: upper.includes("VENEER") || upper.includes("LAMINA") ? "Lâmina de madeira" : "Madeira serrada",
    hsCode: upper.includes("VENEER") || upper.includes("LAMINA") ? "4408" : "4407",
    destinationCountry,
    euImporter: importer || "Revisar importador",
    supplierName: supplier || "Fornecedor a confirmar",
    shipmentDate,
    exporterName: supplier,
    internalResponsible: input.assigneeName || "Responsável a definir",
    responsibleEmail: input.assigneeEmail.toLowerCase(),
    contractNumber: asanaOperationReference(input.name, input.taskGid),
    incoterm,
    currency: "USD",
    quantity: volumeContainers,
    quantityUnit: volumeContainers ? "contêiner(es)" : "A confirmar",
    lotCodes: "Importado do Asana · lotes a confirmar",
    rawMaterial,
    species,
    forestOriginType: "Reflorestamento",
    productionUnit: supplier || "A confirmar",
    productionLocation: "A confirmar",
    transportMode: "Marítimo",
    portOfDischarge: destination,
    carrier: "",
    vesselVoyage: vessel,
    supplyChainNotes: [
      `Origem: Asana · ${input.name}`,
      `Seção de origem: ${input.sectionName}`,
      input.sourceUrl ? `Link da tarefa: ${input.sourceUrl}` : "",
      size ? `Medidas: ${size}` : "",
      quality ? `Qualidade: ${quality}` : "",
      agent ? `Agente de carga: ${agent}` : "",
      notes,
    ].filter(Boolean).join("\n").slice(0, 16000),
    readiness: 10,
    status: input.sectionName === "POS VENDA" ? "Pós-venda · revisar tracking" : `${input.sectionName} · importado do Asana`,
  };
}

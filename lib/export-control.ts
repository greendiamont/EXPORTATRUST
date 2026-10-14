export const EXPORT_ORDER_MILESTONES = [
  { code: "ORDER_CONFIRMED", sequence: 1, title: "Pedido confirmado", titleEn: "Order confirmed", category: "Export Control · Pedido confirmado", description: "Contrato, PO, especificações, preço, prazo e condição comercial confirmados." },
  { code: "ORIGIN_COMPLIANCE", sequence: 2, title: "Origem e compliance EUDR", titleEn: "Origin and EUDR compliance", category: "Export Control · Origem e EUDR", description: "Florestas, fornecedores, DDS e legalidade da origem liberados para o pedido." },
  { code: "PRODUCTION_PLAN", sequence: 3, title: "Programação da produção", titleEn: "Production scheduled", category: "Export Control · Programação da produção", description: "Ordem de produção, matéria-prima, lotes e data prometida programados." },
  { code: "PRODUCTION", sequence: 4, title: "Produção", titleEn: "Production", category: "Export Control · Produção", description: "Acompanhamento do volume produzido, lotes e eventuais desvios." },
  { code: "QUALITY_CONTROL", sequence: 5, title: "Controle de qualidade", titleEn: "Quality control", category: "Export Control · Controle de qualidade", description: "Inspeção dimensional, umidade, embalagem, marcação e registro de não conformidades." },
  { code: "SHIPMENT_APPROVAL", sequence: 6, title: "Aprovação para embarque", titleEn: "Shipment approval", category: "Export Control · Aprovação de embarque", description: "Liberação humana após as etapas anteriores e a qualidade; EUDR é obrigatório somente para destinos da União Europeia." },
  { code: "BOOKING", sequence: 7, title: "Booking confirmado", titleEn: "Booking confirmed", category: "Export Control · Booking", description: "Armador, booking, navio, viagem, cut-off, porto e previsão de embarque." },
  { code: "STUFFING", sequence: 8, title: "Estufagem e fotos", titleEn: "Container stuffing and photos", category: "Export Control · Estufagem e fotos", description: "Contêiner, lacre, carregamento, fotos, tally, peso e condição da carga." },
  { code: "DOCUMENT_SET", sequence: 9, title: "Set documental", titleEn: "Document set", category: "Export Control · Set documental", description: "Invoice, packing list, certificados e documentos exigidos pelo destino revisados." },
  { code: "CUSTOMS_PORT", sequence: 10, title: "Despacho e porto", titleEn: "Customs and port", category: "Export Control · Despacho e porto", description: "DU-E/despacho, gate-in, VGM, terminal e liberações portuárias." },
  { code: "SHIPPED", sequence: 11, title: "Embarcado", titleEn: "Shipped on board", category: "Export Control · Embarcado", description: "Confirmação on board, BL e comunicação formal de embarque ao cliente." },
  { code: "IN_TRANSIT", sequence: 12, title: "Em trânsito", titleEn: "In transit", category: "Export Control · Tracking marítimo", description: "Tracking do booking/contêiner e atualização automática a cada 10 dias." },
  { code: "ARRIVAL", sequence: 13, title: "Chegada ao destino", titleEn: "Arrival at destination", category: "Export Control · Chegada", description: "Atracação, descarga, disponibilidade e eventuais ocorrências no destino." },
  { code: "DELIVERED", sequence: 14, title: "Entregue ao cliente", titleEn: "Delivered to customer", category: "Export Control · Entrega final", description: "Entrega confirmada, aceite do cliente, pendências encerradas e processo concluído." },
] as const;

export type ExportMilestoneDefinition = (typeof EXPORT_ORDER_MILESTONES)[number];

export type ComplianceRequirement = {
  key: string;
  label: string;
  reason: string;
  required: boolean;
  keywords: string[];
};

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Estados-membros da UE em português, inglês e código ISO-3166 alfa-2.
// Antes só havia nomes em português sem acento: "Italy", "Germany" ou "DE"
// desligavam a exigência EUDR e liberavam a aprovação de embarque.
const EU_COUNTRY_NAMES = [
  "alemanha", "germany", "austria", "belgica", "belgium", "bulgaria", "chipre", "cyprus", "croacia", "croatia",
  "dinamarca", "denmark", "eslovaquia", "slovakia", "eslovenia", "slovenia", "espanha", "spain", "estonia",
  "finlandia", "finland", "franca", "france", "grecia", "greece", "hungria", "hungary", "irlanda", "ireland",
  "italia", "italy", "letonia", "latvia", "lituania", "lithuania", "luxemburgo", "luxembourg", "malta",
  "paises baixos", "netherlands", "the netherlands", "holanda", "holland", "polonia", "poland", "portugal",
  "republica tcheca", "tchequia", "chequia", "czech republic", "czechia", "romenia", "romania", "suecia", "sweden",
  "uniao europeia", "european union",
];
const EU_COUNTRY_CODES = ["at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "el", "hu", "ie", "it", "lv", "lt", "lu", "mt", "nl", "pl", "pt", "ro", "sk", "si", "es", "se", "eu"];

// Posições do Anexo I do Regulamento (UE) 2023/1115 (EUDR), por prefixo do SH.
const EUDR_HS_PREFIXES = [
  // bovinos
  "0102", "0201", "0202", "020610", "020629", "160250", "4101", "4104", "4107",
  // cacau
  "1801", "1802", "1803", "1804", "1805", "1806",
  // café
  "0901",
  // dendê / palma
  "120710", "1511", "151321", "151329", "230660", "290545", "291570", "382311", "382312", "382319", "382370",
  // borracha
  "4001", "4005", "4006", "4007", "4008", "4010", "4011", "4012", "4013", "4015", "4016", "4017",
  // soja
  "1201", "120810", "1507", "2304",
  // madeira e derivados
  "44", "47", "48", "49", "9401", "9403", "940610", "9406",
];
const EUDR_PRODUCT_KEYWORDS = [
  "madeira", "wood", "timber", "lumber", "pellet", "serrad", "compensado", "plywood", "mdf", "osb", "carvao vegetal", "charcoal",
  "celulose", "pulp", "papel", "paper", "movel", "moveis", "furniture",
  "cacau", "cocoa", "chocolate", "cafe", "coffee", "soja", "soy", "borracha", "rubber", "latex",
  "dende", "palma", "palm oil", "oleo de palma", "gado", "bovino", "cattle", "beef", "carne bovina", "couro", "leather",
];
const WOOD_PRODUCT_KEYWORDS = ["madeira", "wood", "timber", "lumber", "pellet", "serrad", "compensado", "plywood", "mdf", "osb", "pallet", "palete"];

function words(value: string) {
  return ` ${normalized(value).replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function containsTerm(text: string, term: string) {
  // Termos curtos exigem palavra inteira; termos longos aceitam radical ("serrad" → "serrada").
  const haystack = words(text);
  const needle = normalized(term).replace(/[^a-z0-9]+/g, " ").trim();
  if (!needle) return false;
  return needle.length <= 3 ? haystack.includes(` ${needle} `) : haystack.includes(` ${needle}`);
}

function hsDigits(hsCode: string) {
  return hsCode.replace(/\D/g, "");
}

export function isEuDestination(country: string) {
  const destination = words(country);
  if (EU_COUNTRY_CODES.some((code) => destination.trim() === code)) return true;
  return EU_COUNTRY_NAMES.some((name) => destination.includes(` ${name} `));
}

export function isEudrCommodity(hsCode: string, product: string) {
  const hs = hsDigits(hsCode);
  if (hs.length >= 2 && EUDR_HS_PREFIXES.some((prefix) => hs.startsWith(prefix))) return true;
  return EUDR_PRODUCT_KEYWORDS.some((keyword) => containsTerm(product, keyword));
}

export function isWoodProduct(hsCode: string, product: string) {
  return hsDigits(hsCode).startsWith("44") || WOOD_PRODUCT_KEYWORDS.some((keyword) => containsTerm(product, keyword));
}

export function isEudrRequired(country: string, hsCode: string, product: string) {
  return isEuDestination(country) && isEudrCommodity(hsCode, product);
}

export type ShipmentApprovalGateInput = {
  eudrRequired: boolean;
  eudrReadiness: number;
  countryComplianceScore: number;
  qualityStatus: string;
  previousStagesComplete: boolean;
};

export function canApproveShipment(input: ShipmentApprovalGateInput) {
  if (!input.previousStagesComplete || input.qualityStatus === "Reprovado") return false;
  if (!input.eudrRequired) return true;
  return input.qualityStatus === "Aprovado"
    && input.countryComplianceScore === 100
    && input.eudrReadiness === 100;
}

export function countryRequirements(country: string, hsCode: string, product: string): ComplianceRequirement[] {
  const destination = words(country);
  const isUk = ["reino unido", "united kingdom", "inglaterra", "england", "great britain", "gra bretanha"].some((name) => destination.includes(` ${name} `)) || ["uk", "gb"].includes(destination.trim());
  const isUs = ["estados unidos", "united states", "united states of america"].some((name) => destination.includes(` ${name} `)) || ["us", "usa", "eua"].includes(destination.trim());
  const isWood = isWoodProduct(hsCode, product);
  const requirements: ComplianceRequirement[] = [
    { key: "commercial_invoice", label: "Commercial Invoice", reason: "Documento comercial básico para exportação e desembaraço.", required: true, keywords: ["invoice", "fatura comercial"] },
    { key: "packing_list", label: "Packing List", reason: "Volumes, pesos, dimensões, lotes e identificação das embalagens.", required: true, keywords: ["packing list", "romaneio"] },
    { key: "transport_document", label: "Bill of Lading / documento de transporte", reason: "Evidência do contrato de transporte e embarque.", required: true, keywords: ["bill of lading", "b/l", "bl", "awb", "crt"] },
    { key: "origin", label: "Certificado ou declaração de origem", reason: "Origem preferencial ou não preferencial conforme país e acordo aplicável.", required: false, keywords: ["certificado de origem", "certificate of origin", "declaração de origem"] },
  ];
  if (isWood) requirements.push(
    { key: "phytosanitary", label: "Certificado Fitossanitário", reason: "Aplicável conforme produto, tratamento, espécie e exigência fitossanitária do destino.", required: true, keywords: ["fitossanit", "phytosanitary", "phyto"] },
    { key: "ispm15", label: "NIMF 15 / ISPM 15", reason: "Embalagens e suportes de madeira devem possuir tratamento e marcação quando aplicável.", required: true, keywords: ["nimf", "ispm", "ht", "heat treatment"] },
  );
  if (isEudrRequired(country, hsCode, product)) requirements.push(
    { key: "eudr", label: "DDS / referência EUDR", reason: "Mercadoria abrangida destinada ao mercado da União Europeia.", required: true, keywords: ["eudr", "dds", "due diligence statement"] },
  );
  if (isUk && isWood) requirements.push(
    { key: "uk_timber", label: "UK Timber Regulation due diligence", reason: "Comprovação de legalidade e rastreabilidade para madeira e derivados no Reino Unido.", required: true, keywords: ["uktr", "timber regulation", "due diligence"] },
  );
  if (isUs && isWood) requirements.push(
    { key: "lacey", label: "Lacey Act declaration", reason: "Declaração de espécie, país de colheita e quantidade para produtos abrangidos.", required: true, keywords: ["lacey", "ppq 505"] },
  );
  return requirements;
}

export function requirementMatches(requirement: ComplianceRequirement, documentTexts: string[]) {
  // Palavra inteira para termos curtos: antes "ht" casava com "weight"/"freight"
  // e dava o NIMF 15 como cumprido.
  return documentTexts.some((text) => requirement.keywords.some((keyword) => containsTerm(text, keyword)));
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

export function milestoneEmail(reference: string, milestoneTitle: string, status: string, note: string, operation: { product: string; bookingNumber: string; containerNumbers: string; vesselVoyage: string; portOfLoading: string; portOfDischarge: string; shipmentDate: string }) {
  const subject = `${reference} - ${milestoneTitle} - ${status}`;
  const rows = [
    ["Order/process", reference],
    ["Product", operation.product],
    ["Current stage", milestoneTitle],
    ["Status", status],
    ["Booking", operation.bookingNumber],
    ["Container(s)", operation.containerNumbers],
    ["Vessel / voyage", operation.vesselVoyage],
    ["Route", operation.portOfLoading || operation.portOfDischarge ? `${operation.portOfLoading || "TBC"} → ${operation.portOfDischarge || "TBC"}` : ""],
    ["Expected shipment", operation.shipmentDate],
  ].filter(([, value]) => value);
  const details = rows.map(([label, value]) => `${label}: ${value}`);
  const body = `Dear customer,\n\nThis is an ExportaTrust update for your order.\n\n${details.join("\n")}${note ? `\n\nUpdate:\n${note}` : ""}\n\nAll original documents and compliance records remain available in the ExportaTrust control tower.\n\nBest regards,\nExportaTrust`;
  const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
  const detailRows = rows.map(([label, value]) => `<tr><td style="width:34%;padding:10px 12px;border-bottom:1px solid #e8f0ec;color:#60756c;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.4px">${escapeHtml(label)}</td><td style="padding:10px 12px;border-bottom:1px solid #e8f0ec;color:#20362d;font:14px Arial,sans-serif;line-height:1.45">${escapeHtml(value)}</td></tr>`).join("");
  const updateBlock = note ? `<tr><td style="padding:18px 28px 0"><div style="padding:14px 16px;background:#f4faf7;border-left:4px solid #086c55;border-radius:8px"><div style="margin:0 0 6px;color:#086c55;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.6px">Update</div><div style="color:#20362d;font:14px Arial,sans-serif;line-height:1.6;white-space:pre-line">${escapeHtml(note)}</div></div></td></tr>` : "";
  const html = `<div style="margin:0;padding:24px;background:#f3f7f5"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:auto;background:#ffffff;border:1px solid #d9e6df;border-radius:12px;overflow:hidden"><tr><td style="padding:24px 28px;background:#086c55;color:#ffffff"><div style="font:700 12px Arial,sans-serif;letter-spacing:1.4px">EXPORTATRUST</div><div style="margin-top:8px;font:700 23px Arial,sans-serif;line-height:1.25">Order update</div><div style="margin-top:8px;color:#dff2e9;font:13px Arial,sans-serif">${escapeHtml(reference)} · ${escapeHtml(milestoneTitle)}</div></td></tr><tr><td style="padding:24px 28px 10px"><p style="margin:0 0 14px;color:#20362d;font:15px Arial,sans-serif">Dear customer,</p><p style="margin:0;color:#52645b;font:14px Arial,sans-serif;line-height:1.6">This is an ExportaTrust update for your order.</p></td></tr><tr><td style="padding:6px 28px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e8f0ec;border-radius:8px;overflow:hidden">${detailRows}</table></td></tr>${updateBlock}<tr><td style="padding:22px 28px 26px"><p style="margin:0;color:#52645b;font:13px Arial,sans-serif;line-height:1.6">All original documents and compliance records remain available in the ExportaTrust control tower.</p><p style="margin:18px 0 0;color:#20362d;font:14px Arial,sans-serif;line-height:1.5">Best regards,<br><strong>ExportaTrust</strong></p></td></tr></table></div>`;
  return { subject, body, html };
}

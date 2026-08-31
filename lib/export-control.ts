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

const EU_COUNTRIES = ["alemanha", "austria", "belgica", "bulgaria", "chipre", "croacia", "dinamarca", "eslovaquia", "eslovenia", "espanha", "estonia", "finlandia", "franca", "grecia", "hungria", "irlanda", "italia", "letonia", "lituania", "luxemburgo", "malta", "paises baixos", "holanda", "polonia", "portugal", "republica tcheca", "romenia", "suecia"];

export function isEudrRequired(country: string, hsCode: string, product: string) {
  const destination = normalized(country);
  const goods = normalized(`${hsCode} ${product}`);
  const isEu = EU_COUNTRIES.some((item) => destination.includes(item));
  const isWood = goods.includes("44") || goods.includes("madeira") || goods.includes("pellet") || goods.includes("wood");
  return isEu && isWood;
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
  const destination = normalized(country);
  const goods = normalized(`${hsCode} ${product}`);
  const isEu = EU_COUNTRIES.some((item) => destination.includes(item));
  const isUk = destination.includes("reino unido") || destination.includes("united kingdom") || destination === "uk";
  const isUs = destination.includes("estados unidos") || destination.includes("united states") || destination === "usa";
  const isWood = goods.includes("44") || goods.includes("madeira") || goods.includes("pellet") || goods.includes("wood");
  const requirements: ComplianceRequirement[] = [
    { key: "commercial_invoice", label: "Commercial Invoice", reason: "Documento comercial básico para exportação e desembaraço.", required: true, keywords: ["invoice", "fatura comercial"] },
    { key: "packing_list", label: "Packing List", reason: "Volumes, pesos, dimensões, lotes e identificação das embalagens.", required: true, keywords: ["packing list", "romaneio"] },
    { key: "transport_document", label: "Bill of Lading / documento de transporte", reason: "Evidência do contrato de transporte e embarque.", required: true, keywords: ["bill of lading", "b/l", " bl", "awb", "crt"] },
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
  return documentTexts.some((text) => requirement.keywords.some((keyword) => normalized(text).includes(normalized(keyword))));
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

export const SUPPLY_CHAIN_STAGES = [
  { number: "01", stage: "Floresta e origem", titleEn: "Forest and origin", category: "Floresta · CAR e mapas", legacy: ["CAR e mapas"], evidence: "CAR, polígonos GeoJSON/KML, identificação das florestas e vínculo com os lotes", capability: "car_geolocation_check" },
  { number: "02", stage: "IBAMA e certidões", titleEn: "Forest IBAMA and certificates", category: "Floresta · IBAMA e certidões", legacy: ["Legalidade / DOF", "FSC / PEFC"], evidence: "CTF/IBAMA, certidões ambientais, autorizações, FSC/PEFC e evidências de legalidade", capability: "certificate_validation" },
  { number: "03", stage: "Invoice florestal", titleEn: "Forest invoice", category: "Floresta · Invoice / NF", legacy: ["Nota fiscal"], evidence: "Nota fiscal ou invoice da madeira, resíduos ou biomassa fornecida pela origem", capability: "invoice_validation" },
  { number: "04", stage: "Transporte florestal", titleEn: "Forest transport", category: "Transporte florestal · documentos", legacy: [], evidence: "DOF/GF, CT-e, MDF-e, romaneio, placa e identificação do transportador", capability: "transport_document_validation" },
  { number: "05", stage: "Invoice do transporte", titleEn: "Transport invoice", category: "Transporte florestal · Invoice", legacy: [], evidence: "Invoice, fatura ou nota fiscal do frete entre floresta e planta industrial", capability: "invoice_validation" },
  { number: "06", stage: "Cadastro e licenciamento da planta", titleEn: "Industrial plant registration and licences", category: "Planta industrial · cadastro e licenças", legacy: [], evidence: "CNPJ, contrato social, inscrição estadual, licença ambiental de operação, alvará municipal e autorizações aplicáveis", capability: "supplier_due_diligence" },
  { number: "07", stage: "IBAMA e certidões da planta", titleEn: "Industrial plant IBAMA and certificates", category: "Planta industrial · IBAMA e certidões", legacy: [], evidence: "CTF/APP do IBAMA, Certificado de Regularidade, certidões ambientais federais e estaduais e comprovações de legalidade", capability: "certificate_validation" },
  { number: "08", stage: "Produção na planta industrial", titleEn: "Industrial production and mass balance", category: "Planta industrial · produção", legacy: ["Produção / balanço de massa"], evidence: "Recebimento da matéria-prima, estoque, transformação, ordens de produção, balanço de massa, cadeia de custódia e rastreabilidade dos lotes", capability: "mass_balance_check" },
  { number: "09", stage: "Invoice de exportação", titleEn: "Export invoice", category: "Exportação · Invoice industrial", legacy: ["Invoice comercial"], evidence: "Commercial invoice do fabricante/exportador e documentos comerciais da venda", capability: "invoice_validation" },
  { number: "10", stage: "Transporte até o porto", titleEn: "Transport to port", category: "Transporte ao porto · documentos", legacy: [], evidence: "CT-e, MDF-e, booking, gate-in, contêiner, lacre e comprovantes do transporte", capability: "transport_document_validation" },
  { number: "11", stage: "Porto e embarque", titleEn: "Port and shipment", category: "Porto · embarque e BL", legacy: ["Transporte / BL", "Fitossanitário"], evidence: "Draft/final BL, VGM, terminal, certificado fitossanitário e documentos portuários", capability: "export_document_validation" },
  { number: "12", stage: "Trading", titleEn: "Trading registration and contract", category: "Trading · cadastro e contrato", legacy: ["Cadastro do fornecedor", "Contratos"], evidence: "Cadastro, contrato, EORI, operador europeu e responsabilidade na cadeia", capability: "supplier_due_diligence" },
  { number: "13", stage: "Invoice da Trading", titleEn: "Trading final invoice", category: "Trading · Invoice final", legacy: [], evidence: "Invoice emitida pela Trading ao importador e vínculo com a invoice de origem", capability: "invoice_validation" },
] as const;

export type SupplyChainStage = (typeof SUPPLY_CHAIN_STAGES)[number];

export function normalizeStageCategory(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function stageAcceptsCategory(stage: SupplyChainStage, category: string) {
  const normalized = normalizeStageCategory(category);
  return [stage.category, ...stage.legacy].some((candidate) => normalizeStageCategory(candidate) === normalized);
}

export const STAGE_CAPABILITIES = Object.fromEntries(
  SUPPLY_CHAIN_STAGES.map((stage) => [stage.category, stage.capability]),
) as Record<string, string>;

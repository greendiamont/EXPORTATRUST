import type { PDFFont, PDFPage } from "pdf-lib";
import { PDFDocument, rgb } from "pdf-lib";

const A4: [number, number] = [595.28, 841.89];
const green = rgb(0.03, 0.47, 0.36);
const deep = rgb(0.02, 0.30, 0.24);
const ink = rgb(0.09, 0.15, 0.13);
const muted = rgb(0.39, 0.46, 0.43);
const border = rgb(0.84, 0.89, 0.86);
const pale = rgb(0.96, 0.98, 0.97);
const mint = rgb(0.91, 0.96, 0.94);
const amber = rgb(0.79, 0.55, 0.13);
const paleAmber = rgb(1, 0.96, 0.86);
const white = rgb(1, 1, 1);

export type StandardStageRow = {
  number: string;
  title: string;
  detail: string;
  status: "Complete" | "Pending" | "Review" | "Not applicable";
};

export type StandardEvidenceRow = {
  stage: string;
  fileName: string;
  purpose: string;
  type: string;
  status: string;
};

export type StandardRiskRow = {
  area: string;
  result: string;
  basis: string;
};

export type StandardPlotRow = {
  carCode: string;
  area: string;
  geometryStatus: string;
};

export type EudrStandardData = {
  testMode: boolean;
  reviewed: boolean;
  reference: string;
  officialReference: string;
  product: string;
  hsCode: string;
  species: string;
  quantity: string;
  netMass: string;
  productionCountry: string;
  productionPeriod: string;
  destination: string;
  supplier: string;
  exporter: string;
  euOperator: string;
  eori: string;
  readiness: number;
  plots: StandardPlotRow[];
  stages: StandardStageRow[];
  evidence: StandardEvidenceRow[];
  risks: StandardRiskRow[];
  gaps: string[];
  generatedAt: string;
};

type Fonts = { regular: PDFFont; bold: PDFFont };

function clean(value: unknown) {
  return String(value ?? "")
    .replaceAll("→", " to ")
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("’", "'")
    .replace(/[^\u0020-\u00FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrappedLines(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = clean(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function textBlock(page: PDFPage, text: string, x: number, y: number, maxWidth: number, font: PDFFont, size: number, color = ink, leading = size * 1.35, maxLines = 10) {
  const lines = wrappedLines(text, font, size, maxWidth).slice(0, maxLines);
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * leading, size, font, color }));
  return y - lines.length * leading;
}

function headerFooter(page: PDFPage, fonts: Fonts, data: EudrStandardData, pageNumber: number) {
  page.drawRectangle({ x: 0, y: 790, width: A4[0], height: 52, color: deep });
  page.drawText("EXPORTATRUST - DDS EUDR", { x: 48, y: 812, size: 8, font: fonts.bold, color: white });
  const status = data.testMode
    ? "TEST EXAMPLE - NOT FOR OFFICIAL SUBMISSION"
    : data.officialReference
      ? `SUBMITTED DDS - ${clean(data.officialReference)}`
      : "REVIEWED PRE-DDS - READY FOR TRANSMISSION";
  const statusSize = 6.2;
  page.drawText(status, { x: 547 - fonts.bold.widthOfTextAtSize(status, statusSize), y: 812, size: statusSize, font: fonts.bold, color: white });
  page.drawLine({ start: { x: 48, y: 31 }, end: { x: 547, y: 31 }, color: border, thickness: 0.7 });
  page.drawText("Illustrative/supporting EUDR due diligence package", { x: 48, y: 18, size: 6.5, font: fonts.regular, color: muted });
  const pageText = `Core page ${pageNumber} of 5`;
  page.drawText(pageText, { x: 547 - fonts.regular.widthOfTextAtSize(pageText, 6.5), y: 18, size: 6.5, font: fonts.regular, color: muted });
}

function standardPage(pdf: PDFDocument, fonts: Fonts, data: EudrStandardData, pageNumber: number, eyebrow: string, title: string, subtitle: string) {
  const page = pdf.addPage(A4);
  headerFooter(page, fonts, data, pageNumber);
  page.drawText(clean(eyebrow).toUpperCase(), { x: 54, y: 752, size: 7, font: fonts.bold, color: green });
  textBlock(page, title, 54, 725, 487, fonts.bold, 19, deep, 23, 2);
  textBlock(page, subtitle, 54, 680, 487, fonts.regular, 8.5, muted, 12, 3);
  return page;
}

function sectionBand(page: PDFPage, fonts: Fonts, title: string, y: number, width = 487) {
  page.drawRectangle({ x: 54, y, width, height: 24, color: mint, borderColor: border, borderWidth: 0.4 });
  page.drawText(clean(title).toUpperCase(), { x: 62, y: y + 8, size: 7.2, font: fonts.bold, color: green });
}

function fieldCell(page: PDFPage, fonts: Fonts, x: number, y: number, width: number, height: number, label: string, value: string, valueSize = 8) {
  page.drawRectangle({ x, y, width, height, color: white, borderColor: border, borderWidth: 0.45 });
  page.drawText(clean(label).toUpperCase(), { x: x + 7, y: y + height - 12, size: 5.6, font: fonts.bold, color: muted });
  textBlock(page, value || "Not provided", x + 7, y + height - 26, width - 14, fonts.bold, valueSize, ink, 10, 2);
}

function statusColor(status: string) {
  const normalized = status.toLowerCase();
  if (
    normalized.includes("complete")
    || normalized.includes("verified")
    || normalized.includes("validated")
    || normalized.includes("clear")
    || normalized.includes("recorded")
    || normalized.includes("present")
    || normalized.includes("controlled")
  ) return green;
  if (normalized.includes("not applicable")) return muted;
  return amber;
}

function coverPage(pdf: PDFDocument, fonts: Fonts, data: EudrStandardData) {
  const page = pdf.addPage(A4);
  headerFooter(page, fonts, data, 1);
  page.drawText("ILLUSTRATIVE CUSTOMER DELIVERABLE", { x: 54, y: 752, size: 7, font: fonts.bold, color: green });
  textBlock(page, "EUDR Due Diligence Statement and Supporting Evidence Package", 54, 716, 487, fonts.bold, 23, deep, 28, 2);
  textBlock(page, "ExportaTrust organizes the electronic DDS data and the audit-ready supporting dossier for the responsible EU operator.", 54, 648, 487, fonts.regular, 9, muted, 13, 3);

  const statusLabel = data.testMode ? "TEST / PRE-SUBMISSION" : data.officialReference ? "SUBMITTED SUPPORT PACKAGE" : "REVIEWED PRE-DDS";
  const regulatoryResult = data.officialReference ? "DDS REFERENCE RECORDED" : data.gaps.length ? "OPEN ACTIONS BEFORE SUBMISSION" : "PENDING EU OPERATOR APPROVAL";
  fieldCell(page, fonts, 48, 556, 94, 55, "Document status", statusLabel, 7.3);
  fieldCell(page, fonts, 142, 556, 150, 55, "Internal reference", data.reference, 8.6);
  fieldCell(page, fonts, 292, 556, 105, 55, "Regulatory result", regulatoryResult, 6.9);
  fieldCell(page, fonts, 397, 556, 150, 55, "Official DDS reference", data.officialReference || "Assigned after LIVE submission", 7.1);

  const rows = [
    ["Brazilian supplier", data.supplier, "EU operator", data.euOperator],
    ["Exporter / data provider", data.exporter, "EORI", data.eori],
    ["Product", `${data.product} - ${data.species}`, "HS/CN code", data.hsCode],
    ["Quantity", `${data.quantity} | ${data.netMass}`, "Country of production", data.productionCountry],
    ["Production period", data.productionPeriod, "Destination", data.destination],
  ];
  rows.forEach((row, index) => {
    const y = 504 - index * 48;
    page.drawRectangle({ x: 48, y, width: 105, height: 48, color: white, borderColor: border, borderWidth: 0.45 });
    page.drawText(clean(row[0]).toUpperCase(), { x: 55, y: y + 29, size: 5.6, font: fonts.bold, color: muted });
    page.drawRectangle({ x: 153, y, width: 145, height: 48, color: white, borderColor: border, borderWidth: 0.45 });
    textBlock(page, row[1], 160, y + 27, 131, fonts.bold, 7.2, ink, 9, 2);
    page.drawRectangle({ x: 298, y, width: 105, height: 48, color: white, borderColor: border, borderWidth: 0.45 });
    page.drawText(clean(row[2]).toUpperCase(), { x: 305, y: y + 29, size: 5.6, font: fonts.bold, color: muted });
    page.drawRectangle({ x: 403, y, width: 144, height: 48, color: white, borderColor: border, borderWidth: 0.45 });
    textBlock(page, row[3], 410, y + 27, 130, fonts.bold, 7.2, ink, 9, 2);
  });

  page.drawText("WHAT THE CUSTOMER RECEIVES", { x: 54, y: 240, size: 10, font: fonts.bold, color: deep });
  const deliverables = [
    ["01", "Pre-DDS submission sheet", "Fields prepared in English for the electronic DDS."],
    ["02", "Risk assessment", "Deforestation, legality, supplier and traceability review."],
    ["03", "Supply chain dossier", "Evidence ordered by STAGE 01-13."],
    ["04", "GeoJSON and plot summary", "Production plots prepared for system upload."],
  ];
  deliverables.forEach((item, index) => {
    const y = 199 - index * 39;
    page.drawRectangle({ x: 54, y, width: 487, height: 36, color: pale, borderColor: border, borderWidth: 0.35 });
    page.drawText(item[0], { x: 63, y: y + 14, size: 7.5, font: fonts.bold, color: green });
    page.drawText(item[1], { x: 91, y: y + 14, size: 7.5, font: fonts.bold, color: ink });
    textBlock(page, item[2], 235, y + 16, 296, fonts.regular, 6.8, muted, 8, 2);
  });
}

function annexPage(pdf: PDFDocument, fonts: Fonts, data: EudrStandardData) {
  const page = standardPage(pdf, fonts, data, 2, "Annex II data view", "Due Diligence Statement - structured presentation", "Core information prepared for the electronic DDS. A system reference is generated only after LIVE submission.");
  sectionBand(page, fonts, "1. Operator identification", 628);
  const operator = [["Operator name", data.euOperator], ["EORI", data.eori], ["Internal reference", data.reference]];
  operator.forEach((row, index) => {
    const y = 590 - index * 38;
    fieldCell(page, fonts, 54, y, 145, 38, row[0], row[1], 7.6);
    page.drawRectangle({ x: 199, y, width: 342, height: 38, color: white, borderColor: border, borderWidth: 0.45 });
    textBlock(page, row[1], 207, y + 15, 326, fonts.bold, 7.6, ink, 9, 2);
  });

  sectionBand(page, fonts, "2. Product information", 458);
  const products = [
    ["Commodity", data.product, "HS/CN code", data.hsCode],
    ["Scientific name", data.species, "Net mass", data.netMass],
    ["Country of production", data.productionCountry, "Activity", `Import into ${data.destination}`],
  ];
  products.forEach((row, index) => {
    const y = 420 - index * 42;
    page.drawRectangle({ x: 54, y, width: 121, height: 42, color: white, borderColor: border, borderWidth: 0.45 });
    page.drawText(clean(row[0]).toUpperCase(), { x: 61, y: y + 25, size: 5.6, font: fonts.bold, color: muted });
    page.drawRectangle({ x: 175, y, width: 121, height: 42, color: white, borderColor: border, borderWidth: 0.45 });
    textBlock(page, row[1], 182, y + 23, 107, fonts.bold, 7.1, ink, 9, 2);
    page.drawRectangle({ x: 296, y, width: 121, height: 42, color: white, borderColor: border, borderWidth: 0.45 });
    page.drawText(clean(row[2]).toUpperCase(), { x: 303, y: y + 25, size: 5.6, font: fonts.bold, color: muted });
    page.drawRectangle({ x: 417, y, width: 124, height: 42, color: white, borderColor: border, borderWidth: 0.45 });
    textBlock(page, row[3], 424, y + 23, 110, fonts.bold, 7.1, ink, 9, 2);
  });

  sectionBand(page, fonts, "3. Geolocation of production plots", 278);
  const plots = data.plots.slice(0, 3);
  const plotRows = plots.length ? plots : [{ carCode: "No production plot linked", area: "-", geometryStatus: "Pending" }];
  plotRows.forEach((plot, index) => {
    const y = 240 - index * 36;
    fieldCell(page, fonts, 54, y, 244, 36, index ? "Plot / CAR" : "Plot / CAR", plot.carCode, 6.9);
    fieldCell(page, fonts, 298, y, 84, 36, "Area", plot.area, 6.9);
    fieldCell(page, fonts, 382, y, 159, 36, "Geometry", plot.geometryStatus, 6.6);
  });

  sectionBand(page, fonts, "4. Operator confirmation", 112);
  textBlock(page, "The responsible operator confirms that due diligence under Regulation (EU) 2023/1115 has been carried out and that no or only negligible risk of non-compliance was identified.", 62, 91, 471, fonts.regular, 7.3, ink, 9.5, 3);
  const signature = data.officialReference ? `DDS reference: ${data.officialReference}` : "Electronic signature: PENDING | Submission date: PENDING | DDS reference: PENDING";
  page.drawRectangle({ x: 54, y: 47, width: 487, height: 27, color: paleAmber, borderColor: rgb(0.91, 0.80, 0.57), borderWidth: 0.5 });
  page.drawText(clean(signature), { x: 62, y: 57, size: 7, font: fonts.bold, color: ink });
}

function riskPage(pdf: PDFDocument, fonts: Fonts, data: EudrStandardData) {
  const page = standardPage(pdf, fonts, data, 3, "Due diligence assessment", "Risk conclusion and supply chain traceability", "Supporting analysis available to substantiate the responsible operator's conclusion.");
  const top = 630;
  page.drawRectangle({ x: 54, y: top, width: 487, height: 28, color: deep });
  page.drawText("ASSESSMENT AREA", { x: 62, y: top + 10, size: 5.8, font: fonts.bold, color: white });
  page.drawText("RESULT", { x: 225, y: top + 10, size: 5.8, font: fonts.bold, color: white });
  page.drawText("BASIS REVIEWED", { x: 343, y: top + 10, size: 5.8, font: fonts.bold, color: white });
  data.risks.slice(0, 5).forEach((row, index) => {
    const y = top - 58 - index * 58;
    page.drawRectangle({ x: 54, y, width: 487, height: 58, color: index % 2 ? pale : white, borderColor: border, borderWidth: 0.4 });
    page.drawLine({ start: { x: 216, y }, end: { x: 216, y: y + 58 }, color: border, thickness: 0.4 });
    page.drawLine({ start: { x: 334, y }, end: { x: 334, y: y + 58 }, color: border, thickness: 0.4 });
    textBlock(page, row.area, 62, y + 38, 146, fonts.bold, 7.2, ink, 9, 3);
    textBlock(page, row.result, 225, y + 38, 101, fonts.bold, 7.2, statusColor(row.result), 9, 3);
    textBlock(page, row.basis, 343, y + 38, 190, fonts.regular, 6.8, ink, 8.5, 4);
  });
  const conclusionY = 236;
  page.drawRectangle({ x: 54, y: conclusionY, width: 487, height: 56, color: paleAmber, borderColor: rgb(0.91, 0.80, 0.57), borderWidth: 0.5 });
  page.drawText("PRELIMINARY CONCLUSION", { x: 62, y: conclusionY + 36, size: 5.8, font: fonts.bold, color: muted });
  const conclusion = data.gaps.length ? "CONDITIONAL - OPEN ACTIONS BEFORE SUBMISSION" : "ELIGIBLE FOR FINAL EU OPERATOR REVIEW";
  page.drawText(conclusion, { x: 200, y: conclusionY + 34, size: 7.4, font: fonts.bold, color: ink });
  page.drawText(`Evidence completeness: ${data.readiness}%`, { x: 200, y: conclusionY + 17, size: 6.8, font: fonts.regular, color: muted });

  sectionBand(page, fonts, "Open actions", 188);
  const gaps = data.gaps.slice(0, 5);
  if (!gaps.length) page.drawText("No structural data gap identified. Final human validation remains mandatory.", { x: 62, y: 169, size: 7.2, font: fonts.regular, color: green });
  gaps.forEach((gap, index) => {
    page.drawCircle({ x: 65, y: 169 - index * 22, size: 5, color: amber });
    page.drawText(String(index + 1), { x: 63.2, y: 167.2 - index * 22, size: 4.7, font: fonts.bold, color: white });
    textBlock(page, gap, 78, 170 - index * 22, 455, fonts.regular, 7, ink, 8.5, 2);
  });
}

function stagesPage(pdf: PDFDocument, fonts: Fonts, data: EudrStandardData) {
  const page = standardPage(pdf, fonts, data, 4, "Supply chain traceability", "Supply chain checklist - STAGE 01-13", "Every document remains linked to its applicable stage and keeps the same sequence in the final dossier.");
  data.stages.slice(0, 13).forEach((stage, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 54 + column * 244;
    const y = 610 - row * 72;
    page.drawRectangle({ x, y, width: 243, height: 67, color: pale, borderColor: border, borderWidth: 0.4 });
    page.drawText(stage.number, { x: x + 8, y: y + 45, size: 7, font: fonts.bold, color: ink });
    textBlock(page, stage.title, x + 35, y + 47, 145, fonts.bold, 7.3, ink, 9, 2);
    const status = clean(stage.status);
    page.drawText(status, { x: x + 234 - fonts.bold.widthOfTextAtSize(status, 5.8), y: y + 46, size: 5.8, font: fonts.bold, color: statusColor(status) });
    textBlock(page, stage.detail, x + 35, y + 22, 196, fonts.regular, 6.3, muted, 8, 2);
  });
}

function evidencePage(pdf: PDFDocument, fonts: Fonts, data: EudrStandardData) {
  const page = standardPage(pdf, fonts, data, 5, "Supporting dossier", "Evidence index and final handoff", "Original files remain immutable and are indexed under their supply chain stage for audit and operator review.");
  const top = 630;
  page.drawRectangle({ x: 54, y: top, width: 487, height: 26, color: deep });
  [["STAGE", 62], ["FILE", 98], ["PURPOSE", 305], ["TYPE", 457], ["STATUS", 499]].forEach(([label, x]) => page.drawText(String(label), { x: Number(x), y: top + 9, size: 5.5, font: fonts.bold, color: white }));
  const rows = data.evidence.slice(0, 11);
  const shownRows = rows.length ? rows : [{ stage: "--", fileName: "No document attached", purpose: "Evidence pending", type: "-", status: "Pending" }];
  shownRows.forEach((row, index) => {
    const y = top - 34 - index * 34;
    page.drawRectangle({ x: 54, y, width: 487, height: 34, color: index % 2 ? pale : white, borderColor: border, borderWidth: 0.35 });
    page.drawLine({ start: { x: 91, y }, end: { x: 91, y: y + 34 }, color: border, thickness: 0.35 });
    page.drawLine({ start: { x: 298, y }, end: { x: 298, y: y + 34 }, color: border, thickness: 0.35 });
    page.drawLine({ start: { x: 450, y }, end: { x: 450, y: y + 34 }, color: border, thickness: 0.35 });
    page.drawLine({ start: { x: 491, y }, end: { x: 491, y: y + 34 }, color: border, thickness: 0.35 });
    page.drawText(clean(row.stage), { x: 62, y: y + 13, size: 6.8, font: fonts.bold, color: ink });
    textBlock(page, row.fileName, 98, y + 19, 194, fonts.regular, 6.3, ink, 7.5, 2);
    textBlock(page, row.purpose, 305, y + 19, 139, fonts.regular, 6.3, ink, 7.5, 2);
    page.drawText(clean(row.type).slice(0, 8), { x: 457, y: y + 13, size: 5.7, font: fonts.regular, color: muted });
    page.drawText(clean(row.status).slice(0, 10), { x: 499, y: y + 13, size: 5.8, font: fonts.bold, color: statusColor(row.status) });
  });
  if (data.evidence.length > rows.length) {
    page.drawText(`+ ${data.evidence.length - rows.length} additional item(s) listed in the complete evidence appendix`, { x: 54, y: 241, size: 6.4, font: fonts.bold, color: green });
  }
  sectionBand(page, fonts, "Customer handoff", 196);
  const handoff = [
    "1. Brazilian supplier completes and uploads evidence by supply chain stage.",
    "2. ExportaTrust validates completeness, geolocation, legality and risk.",
    "3. The EU operator reviews the Pre-DDS and open actions.",
    "4. Once approved, the operator or authorised representative transmits the DDS through the EUDR Information System.",
    "5. The system returns the official DDS reference for customs and downstream traceability.",
  ];
  handoff.forEach((item, index) => textBlock(page, item, 62, 174 - index * 22, 471, fonts.regular, 7, ink, 8.5, 2));
  page.drawText(`Generated: ${clean(data.generatedAt)}`, { x: 54, y: 48, size: 6.2, font: fonts.regular, color: muted });
}

export function appendEudrStandardCore(pdf: PDFDocument, fonts: Fonts, data: EudrStandardData) {
  coverPage(pdf, fonts, data);
  annexPage(pdf, fonts, data);
  riskPage(pdf, fonts, data);
  stagesPage(pdf, fonts, data);
  evidencePage(pdf, fonts, data);
}

export const EUDR_PDF_PALETTE = { green, dark: ink, gray: muted, pale };

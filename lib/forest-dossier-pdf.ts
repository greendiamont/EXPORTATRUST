import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type ForestDossierProperty = {
  carCode: string;
  name: string;
  city: string;
  supplier: string;
  areaHa: number;
  nativeAreaHa: number;
  status: string;
  risk: string;
  geometryJson: string;
  sourceFile: string;
  createdAt: string;
};

export type ForestDossierEvidence = {
  category: string;
  fileName: string;
  sizeBytes: number;
  source: string;
  uploadedAt: string;
};

export type ForestDossierSicar = {
  state?: string;
  municipality?: string;
  municipalityCode?: string;
  propertyType?: string;
  fiscalModules?: number;
  condition?: string;
  registrationCreatedAt?: string;
  sourceUpdatedAt?: string;
  checkedAt?: string;
};

export type ForestDossierSatelliteMap = {
  bytes: Uint8Array;
  contentType: "image/png" | "image/jpeg";
  provider: "Google Maps" | "Esri World Imagery";
  bbox?: [number, number, number, number];
  bboxCrs?: "EPSG:4326" | "EPSG:3857";
  boundaryIncluded?: boolean;
};

export type ForestDossierOfficialSicarFile = {
  bytes: Uint8Array;
  fileName: string;
  category: string;
};

type Point = [number, number];

const green = rgb(0.03, 0.39, 0.29);
const deep = rgb(0.02, 0.24, 0.2);
const dark = rgb(0.08, 0.14, 0.12);
const gray = rgb(0.36, 0.43, 0.4);
const pale = rgb(0.92, 0.97, 0.94);
const grid = rgb(0.83, 0.89, 0.86);

function pdfSafe(value: unknown) {
  return String(value ?? "")
    .replaceAll("–", "-").replaceAll("—", "-").replaceAll("→", " to ")
    .replaceAll("“", '"').replaceAll("”", '"').replaceAll("’", "'")
    .replace(/[^ -ÿ]/g, " ");
}

function pdfEnglish(value: unknown) {
  let text = String(value ?? "");
  const replacements: Array<[string, string]> = [
    ["Recibo CAR", "CAR receipt"], ["Demonstrativo CAR", "CAR statement"],
    ["Documento de legalidade da origem", "Origin legality document"], ["Autorização / licença florestal", "Forest authorization / licence"],
    ["Certidão ambiental", "Environmental certificate"], ["Outros documentos da origem", "Other origin documents"],
    ["Aguardando análise", "Awaiting review"], ["WFS público", "public WFS"],
    ["Fornecido pelo responsável", "Supplied by the responsible party"], ["documento conferido", "verified document"],
    ["Ativo", "Active"], ["Pendente", "Pending"], ["Cancelado", "Cancelled"], ["atenção", "attention"], ["baixo", "low"],
  ];
  for (const [from, to] of replacements) text = text.replaceAll(from, to);
  return pdfSafe(text);
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = `${line} ${word}`.trim();
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function ringsFromGeometry(input: unknown): Point[][] {
  const value = input as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[] };
  if (value?.type === "FeatureCollection" && Array.isArray(value.features)) return value.features.flatMap((feature) => ringsFromGeometry(feature));
  if (value?.type === "Feature" && value.geometry) return ringsFromGeometry(value.geometry);
  if (value?.type === "Polygon" && Array.isArray(value.coordinates)) return [validRing((value.coordinates[0] as number[][]) ?? [])].filter((ring) => ring.length >= 3);
  if (value?.type === "MultiPolygon" && Array.isArray(value.coordinates)) return (value.coordinates as number[][][][]).map((polygon) => validRing(polygon?.[0] ?? [])).filter((ring) => ring.length >= 3);
  return [];
}

function validRing(points: number[][]): Point[] {
  return points.filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))) as Point[];
}

function bounds(points: Point[]) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const centroid: Point = [xs.reduce((sum, value) => sum + value, 0) / xs.length, ys.reduce((sum, value) => sum + value, 0) / ys.length];
  return { minX, maxX, minY, maxY, centroid };
}

function webMercator([longitude, latitude]: Point): Point {
  const limitedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  return [
    longitude * 20037508.342789244 / 180,
    Math.log(Math.tan((90 + limitedLatitude) * Math.PI / 360)) / (Math.PI / 180) * 20037508.342789244 / 180,
  ];
}

function pageHeader(page: PDFPage, bold: PDFFont, reference: string, pageNumber: number, pageLabel = `${pageNumber}/2`) {
  page.drawRectangle({ x: 0, y: 808, width: 595.28, height: 33.89, color: deep });
  page.drawText("EXPORTATRUST - DDS - DUE DILIGENCE EUDR APP", { x: 38, y: 820, size: 8, font: bold, color: rgb(1, 1, 1) });
  const right = `CAR ${pdfSafe(reference)}  |  ${pageLabel}`;
  page.drawText(right, { x: 557 - bold.widthOfTextAtSize(right, 7), y: 820, size: 7, font: bold, color: rgb(0.8, 0.92, 0.87) });
}

function sectionBar(page: PDFPage, bold: PDFFont, title: string, y: number) {
  page.drawRectangle({ x: 38, y: y - 5, width: 519, height: 25, color: pale });
  page.drawText(pdfSafe(title), { x: 47, y: y + 3, size: 10, font: bold, color: green });
}

function field(page: PDFPage, regular: PDFFont, bold: PDFFont, label: string, value: string, x: number, y: number, width: number) {
  page.drawText(pdfSafe(label).toUpperCase(), { x, y, size: 6.6, font: bold, color: gray });
  const lines = wrap(regular, value || "Not provided", 9, width).slice(0, 2);
  lines.forEach((line, index) => page.drawText(line, { x, y: y - 13 - index * 11, size: 9, font: index === 0 ? bold : regular, color: dark }));
}

async function drawReferenceMap(page: PDFPage, pdf: PDFDocument, regular: PDFFont, bold: PDFFont, rings: Point[][], x: number, y: number, width: number, height: number, satellite?: ForestDossierSatelliteMap) {
  const points = rings.flat();
  page.drawRectangle({ x, y, width, height, color: rgb(0.975, 0.987, 0.98), borderColor: grid, borderWidth: 1 });
  let mapX = x;
  let mapY = y;
  let mapWidth = width;
  let mapHeight = height;
  let imageDrawn = false;
  if (satellite?.bytes?.length) {
    try {
      const image = satellite.contentType === "image/png" ? await pdf.embedPng(satellite.bytes) : await pdf.embedJpg(satellite.bytes);
      const imageAspect = image.width / image.height;
      const frameAspect = width / height;
      if (imageAspect > frameAspect) {
        mapHeight = width / imageAspect;
        mapY = y + (height - mapHeight) / 2;
      } else {
        mapWidth = height * imageAspect;
        mapX = x + (width - mapWidth) / 2;
      }
      page.drawImage(image, { x: mapX, y: mapY, width: mapWidth, height: mapHeight });
      page.drawRectangle({ x, y, width, height, borderColor: grid, borderWidth: 1 });
      imageDrawn = true;
    } catch { /* fall back to the vector reference map */ }
  }
  if (!imageDrawn) for (let i = 1; i < 5; i += 1) {
    page.drawLine({ start: { x: x + (width * i) / 5, y }, end: { x: x + (width * i) / 5, y: y + height }, color: grid, thickness: 0.45 });
    page.drawLine({ start: { x, y: y + (height * i) / 5 }, end: { x: x + width, y: y + (height * i) / 5 }, color: grid, thickness: 0.45 });
  }
  if (points.length < 3) {
    page.drawText("No usable polygon is stored for this CAR.", { x: x + 20, y: y + height / 2, size: 10, font: regular, color: gray });
    return;
  }
  const { minX, maxX, minY, maxY, centroid } = bounds(points);
  const spanX = maxX - minX || 0.000001;
  const spanY = maxY - minY || 0.000001;
  const padding = 26;
  const plotW = width - padding * 2;
  const plotH = height - padding * 2;
  const scale = Math.min(plotW / spanX, plotH / spanY);
  const usedW = spanX * scale;
  const usedH = spanY * scale;
  const offsetX = x + (width - usedW) / 2;
  const offsetY = y + (height - usedH) / 2;
  const project = satellite?.bbox && imageDrawn
    ? (point: Point) => {
      const [projectedX, projectedY] = satellite.bboxCrs === "EPSG:3857" ? webMercator(point) : point;
      return {
        x: mapX + ((projectedX - satellite.bbox![0]) / (satellite.bbox![2] - satellite.bbox![0])) * mapWidth,
        y: mapY + ((projectedY - satellite.bbox![1]) / (satellite.bbox![3] - satellite.bbox![1])) * mapHeight,
      };
    }
    : ([lon, lat]: Point) => ({ x: offsetX + (lon - minX) * scale, y: offsetY + (lat - minY) * scale });
  if (!satellite?.boundaryIncluded) {
    for (const ring of rings) {
      const step = Math.max(1, Math.ceil(ring.length / 450));
      const sampled = ring.filter((_, index) => index % step === 0);
      if (sampled[0] && sampled[sampled.length - 1] !== sampled[0]) sampled.push(sampled[0]);
      for (let i = 1; i < sampled.length; i += 1) {
        page.drawLine({ start: project(sampled[i - 1]), end: project(sampled[i]), color: rgb(0.09, 0.12, 0.1), thickness: 3.4, opacity: 0.72 });
        page.drawLine({ start: project(sampled[i - 1]), end: project(sampled[i]), color: rgb(1, 0.82, 0), thickness: 2.1 });
      }
    }
    page.drawCircle({ ...project(centroid), size: 3.2, color: rgb(0.83, 0.36, 0.13), borderColor: rgb(1, 1, 1), borderWidth: 1 });
  }
  page.drawText("N", { x: x + width - 27, y: y + height - 24, size: 9, font: bold, color: deep });
  page.drawLine({ start: { x: x + width - 24, y: y + height - 44 }, end: { x: x + width - 24, y: y + height - 28 }, color: deep, thickness: 1.2 });
  page.drawText(`${maxY.toFixed(6)}, ${minX.toFixed(6)}`, { x: x + 7, y: y + height - 12, size: 6.3, font: regular, color: gray });
  const lower = `${minY.toFixed(6)}, ${maxX.toFixed(6)}`;
  page.drawText(lower, { x: x + width - regular.widthOfTextAtSize(lower, 6.3) - 7, y: y + 7, size: 6.3, font: regular, color: gray });
  page.drawText(`CENTROID  ${centroid[1].toFixed(6)}, ${centroid[0].toFixed(6)}`, { x: x + 8, y: y + 7, size: 6.3, font: bold, color: green });
  if (satellite) {
    const attribution = satellite.provider === "Google Maps" ? "Satellite imagery: Google Maps" : "Satellite imagery: Esri World Imagery";
    const labelWidth = regular.widthOfTextAtSize(attribution, 6.2) + 10;
    page.drawRectangle({ x: x + width - labelWidth - 5, y: y + 4, width: labelWidth, height: 13, color: rgb(1, 1, 1), opacity: 0.82 });
    page.drawText(attribution, { x: x + width - labelWidth, y: y + 8, size: 6.2, font: regular, color: dark });
  }
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || "Not provided" : date.toLocaleString("en-GB", { timeZone: "America/Sao_Paulo", dateStyle: "medium", timeStyle: "short" });
}

export async function generateForestDossierPdf(property: ForestDossierProperty, evidence: ForestDossierEvidence[], linkedProcesses: string[], sicar: ForestDossierSicar = {}, satellite?: ForestDossierSatelliteMap, officialSicarFile?: ForestDossierOfficialSicarFile) {
  let parsedGeometry: unknown = {};
  try { parsedGeometry = JSON.parse(property.geometryJson || "{}"); } catch { parsedGeometry = {}; }
  const rings = ringsFromGeometry(parsedGeometry);
  const geometryPoints = rings.flat();
  const geo = geometryPoints.length >= 3 ? bounds(geometryPoints) : null;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`EUDR Forest Origin Dossier ${property.carCode}`);
  pdf.setAuthor("ExportaTrust EUDR");
  pdf.setSubject("Forest origin, CAR/SICAR geolocation and supporting evidence for EUDR due diligence");
  pdf.setCreator("ExportaTrust EUDR");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page1 = pdf.addPage([595.28, 841.89]);
  pageHeader(page1, bold, property.carCode, 1, "1/3");
  page1.drawText("FOREST ORIGIN DOSSIER - EUDR", { x: 38, y: 766, size: 21, font: bold, color: deep });
  page1.drawText("CAR/SICAR PROPERTY RECORD AND EUDR GEOLOCATION EVIDENCE", { x: 38, y: 748, size: 9, font: regular, color: gray });
  page1.drawRectangle({ x: 38, y: 692, width: 519, height: 39, color: green });
  page1.drawText(pdfSafe(property.name), { x: 49, y: 712, size: 12, font: bold, color: rgb(1, 1, 1) });
  page1.drawText(pdfSafe(property.carCode), { x: 49, y: 699, size: 8, font: regular, color: rgb(0.82, 0.94, 0.89) });

  sectionBar(page1, bold, "1. Property identification", 664);
  field(page1, regular, bold, "Municipality / State", [sicar.municipality || property.city, sicar.state].filter(Boolean).join(" / "), 48, 628, 225);
  field(page1, regular, bold, "Responsible supplier", property.supplier, 310, 628, 230);
  field(page1, regular, bold, "Total area", `${Number(property.areaHa).toLocaleString("en-US", { maximumFractionDigits: 4 })} ha`, 48, 580, 225);
  field(page1, regular, bold, "Native vegetation", `${Number(property.nativeAreaHa).toLocaleString("en-US", { maximumFractionDigits: 4 })} ha`, 310, 580, 230);
  field(page1, regular, bold, "SICAR status / condition", [pdfEnglish(property.status), pdfEnglish(sicar.condition)].filter(Boolean).join(" / "), 48, 532, 225);
  field(page1, regular, bold, "Property type / fiscal modules", `${pdfEnglish(sicar.propertyType || "Not provided")} / ${Number(sicar.fiscalModules || 0).toLocaleString("en-US", { maximumFractionDigits: 4 })}`, 310, 532, 230);

  sectionBar(page1, bold, "2. Satellite location map and SICAR property boundary", 490);
  await drawReferenceMap(page1, pdf, regular, bold, rings, 48, 148, 499, 315, satellite);
  page1.drawText("Satellite reference with SICAR/CAR geometry. Supporting evidence only; it does not replace the official CAR receipt/statement or cadastral survey.", { x: 48, y: 128, size: 6.8, font: regular, color: gray });
  page1.drawText(`Generated ${formatDate(new Date().toISOString())}`, { x: 38, y: 48, size: 7, font: regular, color: gray });

  const page2 = pdf.addPage([595.28, 841.89]);
  pageHeader(page2, bold, property.carCode, 2, "2/3");
  page2.drawText("SICAR / CAR REGISTRATION DETAILS", { x: 38, y: 766, size: 19, font: bold, color: deep });
  let y = 724;
  sectionBar(page2, bold, "3. CAR registration data", y); y -= 42;
  const registrationRows = [
    ["CAR code", property.carCode],
    ["Municipality IBGE code", sicar.municipalityCode || "Not provided"],
    ["Registration date", sicar.registrationCreatedAt || "Not provided"],
    ["SICAR source update", sicar.sourceUpdatedAt || "Not provided"],
    ["Public database checked", sicar.checkedAt ? formatDate(sicar.checkedAt) : "Not available for this record"],
  ];
  for (const [label, value] of registrationRows) {
    page2.drawText(pdfSafe(label), { x: 48, y, size: 7.5, font: bold, color: gray });
    page2.drawText(pdfEnglish(value), { x: 190, y, size: 8.5, font: regular, color: dark });
    y -= 19;
  }
  y -= 5; sectionBar(page2, bold, "4. Geolocation evidence", y); y -= 38;
  const geoRows = geo ? [
    ["Centroid", `${geo.centroid[1].toFixed(6)}, ${geo.centroid[0].toFixed(6)}`],
    ["North-west reference", `${geo.maxY.toFixed(6)}, ${geo.minX.toFixed(6)}`],
    ["South-east reference", `${geo.minY.toFixed(6)}, ${geo.maxX.toFixed(6)}`],
    ["Polygon vertices", String(geometryPoints.length)],
    ["Coordinate basis", "Geographic longitude / latitude from stored SICAR GeoJSON"],
  ] : [["Geometry", "No usable polygon stored"]];
  for (const [label, value] of geoRows) {
    page2.drawText(pdfSafe(label), { x: 48, y, size: 7.5, font: bold, color: gray });
    page2.drawText(pdfSafe(value), { x: 190, y, size: 8.5, font: regular, color: dark });
    y -= 21;
  }
  y -= 5; sectionBar(page2, bold, "5. Source and verification trail", y); y -= 38;
  const sourceLines = wrap(regular, pdfEnglish(property.sourceFile || "Manual registration / source not provided"), 8.3, 355);
  page2.drawText("Registration source", { x: 48, y, size: 7.5, font: bold, color: gray });
  sourceLines.slice(0, 4).forEach((line, index) => page2.drawText(line, { x: 190, y: y - index * 11, size: 8.3, font: regular, color: dark }));
  y -= Math.max(26, sourceLines.slice(0, 4).length * 11 + 8);
  page2.drawText("Record created", { x: 48, y, size: 7.5, font: bold, color: gray });
  page2.drawText(pdfSafe(formatDate(property.createdAt)), { x: 190, y, size: 8.3, font: regular, color: dark });
  y -= 30;

  sectionBar(page2, bold, "6. Supporting evidence linked to this CAR", y); y -= 39;
  if (!evidence.length) {
    page2.drawText("No additional source documents have been uploaded to this CAR yet.", { x: 48, y, size: 8.5, font: regular, color: gray });
    y -= 25;
  } else {
    for (const [index, item] of evidence.slice(0, 9).entries()) {
      const sizeKb = Math.max(1, Math.round(item.sizeBytes / 1024));
      const title = `${String(index + 1).padStart(2, "0")}  ${pdfEnglish(item.category)} - ${item.fileName}`;
      page2.drawText(pdfSafe(title).slice(0, 94), { x: 48, y, size: 8, font: bold, color: dark });
      page2.drawText(pdfSafe(`${sizeKb} KB | ${pdfEnglish(item.source)} | ${formatDate(item.uploadedAt)}`).slice(0, 118), { x: 64, y: y - 11, size: 6.6, font: regular, color: gray });
      y -= 27;
      if (y < 210) break;
    }
  }

  y -= 14;
  if (y > 195) {
    sectionBar(page2, bold, "7. Linked EUDR processes", y); y -= 39;
    page2.drawText(pdfSafe(linkedProcesses.length ? linkedProcesses.join(" | ") : "No EUDR process currently linked to this CAR."), { x: 48, y, size: 8.2, font: regular, color: dark });
    y -= 34;
  }
  page2.drawRectangle({ x: 38, y: 56, width: 519, height: 78, color: rgb(1, 0.97, 0.9), borderColor: rgb(0.9, 0.77, 0.43), borderWidth: 0.7 });
  page2.drawText("EUDR SUPPORTING EVIDENCE", { x: 50, y: 113, size: 8, font: bold, color: rgb(0.43, 0.3, 0.08) });
  const disclaimer = "This dossier consolidates CAR/SICAR registration data and geolocation evidence for due diligence support. CAR registration alone does not prove deforestation-free status or legal compliance. The obligated EU operator remains responsible for risk assessment and the Due Diligence Statement.";
  wrap(regular, disclaimer, 7.3, 494).slice(0, 4).forEach((line, index) => page2.drawText(line, { x: 50, y: 98 - index * 10, size: 7.3, font: regular, color: rgb(0.43, 0.34, 0.2) }));

  const section8 = pdf.addPage([595.28, 841.89]);
  pageHeader(section8, bold, property.carCode, 3, "3/3 · SECTION 8");
  section8.drawText("8. OFFICIAL SICAR / CAR DOCUMENT", { x: 38, y: 755, size: 20, font: bold, color: deep });
  section8.drawText("PRIMARY SOURCE EVIDENCE - ORIGINAL FILE", { x: 38, y: 735, size: 9, font: bold, color: green });
  section8.drawRectangle({ x: 38, y: 566, width: 519, height: 132, color: pale, borderColor: grid, borderWidth: 0.8 });
  section8.drawText(officialSicarFile ? "OFFICIAL FILE ATTACHED TO THIS DOSSIER" : "OFFICIAL FILE NOT YET ATTACHED", { x: 54, y: 668, size: 11, font: bold, color: officialSicarFile ? green : rgb(0.64, 0.39, 0.08) });
  const sourceName = officialSicarFile?.fileName || "Upload the SICAR Demonstrativo or CAR receipt in the Forest property record.";
  wrap(regular, sourceName, 9, 470).slice(0, 3).forEach((line, index) => section8.drawText(line, { x: 54, y: 645 - index * 13, size: 9, font: index === 0 ? bold : regular, color: dark }));
  if (officialSicarFile) {
    section8.drawText(`Evidence type: ${pdfEnglish(officialSicarFile.category)}`, { x: 54, y: 598, size: 8, font: regular, color: gray });
    section8.drawText("The following pages are copied from the uploaded official SICAR/CAR PDF without transcription or recreation.", { x: 54, y: 580, size: 7.4, font: regular, color: gray });
  } else {
    section8.drawText("The dossier remains usable, but Section 8 will only be complete after the official SICAR/CAR PDF is attached.", { x: 54, y: 598, size: 7.4, font: regular, color: gray });
  }
  section8.drawText("Integrity rule", { x: 38, y: 515, size: 9, font: bold, color: deep });
  const integrity = "ExportaTrust does not recreate or translate the official SICAR/CAR pages. They are embedded as primary evidence exactly from the source PDF, preserving the document issued by SICAR.";
  wrap(regular, integrity, 8.2, 505).slice(0, 4).forEach((line, index) => section8.drawText(line, { x: 38, y: 495 - index * 12, size: 8.2, font: regular, color: dark }));

  if (officialSicarFile?.bytes?.length) {
    try {
      const source = await PDFDocument.load(officialSicarFile.bytes, { ignoreEncryption: true });
      const copied = await pdf.copyPages(source, source.getPageIndices());
      copied.forEach((page) => pdf.addPage(page));
    } catch {
      section8.drawText("The official file could not be embedded. Re-upload a valid PDF in the Forest property record.", { x: 38, y: 414, size: 8, font: bold, color: rgb(0.7, 0.18, 0.14) });
    }
  }

  return pdf.save();
}

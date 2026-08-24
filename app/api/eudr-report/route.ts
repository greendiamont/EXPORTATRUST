import { and, asc, eq, inArray } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ensureBaseTables, getDb } from "../../../db";
import { agentJobs, forestDocuments, industrialPlans, operationDocuments, operationPartners, operations, operationStageSettings, pdfIntegrityRecords, ruralProperties } from "../../../db/schema";
import { translateToEnglish } from "../../i18n";
import { generateForestDossierPdf } from "../../../lib/forest-dossier-pdf";
import { satelliteMap } from "../../../lib/satellite-map";
import { SUPPLY_CHAIN_STAGES, stageAcceptsCategory } from "../../../lib/supply-chain-stages";
import { appendEudrStandardCore } from "../../../lib/eudr-pdf-standard";
import { hasPolygonGeometry } from "../../../lib/readiness";
import { fetchCurrentSicarProperty } from "../../../lib/sicar-current";
import { audit, requireSecurityContext, sha256Hex } from "../../../lib/security";

const chainOrder = [...SUPPLY_CHAIN_STAGES.flatMap((stage) => [stage.category, ...stage.legacy]), "Outros"];

function dossierStage(category: string) {
  const stage = SUPPLY_CHAIN_STAGES.find((item) => stageAcceptsCategory(item, category));
  return stage ? { number: stage.number, title: stage.titleEn } : { number: "--", title: "Other supporting evidence" };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

function parseIds(value: string) {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function officialSicarPdf(evidence: Array<{ category: string; fileName: string; contentType: string; objectKey: string }>) {
  const record = [...evidence].reverse().find((item) =>
    item.contentType === "application/pdf" && ["Demonstrativo CAR", "Recibo CAR"].includes(item.category)
  );
  if (!record) return undefined;
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET) return undefined;
    const object = await env.BUCKET.get(record.objectKey);
    if (!object) return undefined;
    return { bytes: new Uint8Array(await object.arrayBuffer()), fileName: record.fileName, category: record.category };
  } catch {
    return undefined;
  }
}

function safeText(value: unknown) {
  return String(value ?? "")
    .replaceAll("→", " para ")
    .replaceAll("←", " de ")
    .replaceAll("↔", " e ")
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("’", "'")
    .replace(/[^\u0020-\u00FF]/g, " ");
}

function wrap(text: string, max = 88) {
  const words = safeText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > max) {
      if (current) lines.push(current);
      current = word;
    } else current = `${current} ${word}`.trim();
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("export");
    await ensureBaseTables();
    const url = new URL(request.url);
    const operationId = Number(url.searchParams.get("operationId"));
    const includeAttachments = url.searchParams.get("attachments") !== "0";
    const testMode = url.searchParams.get("mode") !== "official";
    const reviewed = url.searchParams.get("reviewed") === "1";
    // All client-facing EUDR documents are issued in English, independently
    // from the language selected for the application interface.
    const pdfText = (value: unknown) => safeText(translateToEnglish(String(value ?? "")));
    if (!operationId) return Response.json({ error: "Operação inválida." }, { status: 400 });
    const db = await getDb();
    const [operation] = await db.select().from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, context.organizationId))).limit(1);
    if (!operation) return Response.json({ error: "Operação não encontrada." }, { status: 404 });
    const propertyIds = parseIds(operation.propertyIds);
    const [documents, originDocuments, partners, plans, stageSettings, completedAgentJobs] = await Promise.all([
      db.select().from(operationDocuments).where(eq(operationDocuments.operationId, operationId)).orderBy(asc(operationDocuments.id)).limit(500),
      propertyIds.length ? db.select().from(forestDocuments).where(inArray(forestDocuments.propertyCarCode, propertyIds)).orderBy(asc(forestDocuments.id)).limit(1000) : Promise.resolve([]),
      db.select().from(operationPartners).where(eq(operationPartners.operationId, operationId)).orderBy(asc(operationPartners.id)).limit(300),
      db.select().from(industrialPlans).where(eq(industrialPlans.operationId, operationId)).limit(1),
      db.select().from(operationStageSettings).where(eq(operationStageSettings.operationId, operationId)).limit(100),
      db.select().from(agentJobs).where(eq(agentJobs.operationId, operationId)).orderBy(asc(agentJobs.id)).limit(300),
    ]);
    const properties = propertyIds.length ? await db.select().from(ruralProperties).where(inArray(ruralProperties.carCode, propertyIds)).limit(300) : [];
    const originEvidence = originDocuments.map((document) => ({
      id: 1_000_000 + document.id,
      category: /legalidade|certid|autoriza|licen[cç]a/i.test(document.category) ? "Floresta · IBAMA e certidões" : "Floresta · CAR e mapas",
      fileName: document.fileName,
      objectKey: document.objectKey,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes,
      status: "Recebido",
      notes: `${document.category} · CAR ${document.propertyCarCode}${document.notes ? ` · ${document.notes}` : ""}`,
      uploadedAt: document.uploadedAt,
    }));
    const sortedDocuments = [...documents, ...originEvidence].sort((a, b) => {
      const aIndex = chainOrder.indexOf(a.category);
      const bIndex = chainOrder.indexOf(b.category);
      return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) || a.id - b.id;
    });
    const plan = plans[0];
    const inactiveStageCategories = new Set(stageSettings.filter((setting) => !setting.enabled).map((setting) => setting.stageCategory));
    const legalityDocuments = sortedDocuments.filter((document) => /ibama|legalidade|dof|fsc|pefc|certid/i.test(`${document.category} ${document.fileName}`));
    const geolocationDocuments = sortedDocuments.filter((document) => /car|geojson|kml|mapa|geolocal/i.test(`${document.category} ${document.fileName}`));
    const completedRiskJobs = completedAgentJobs.filter((job) => job.status === "Concluído" && /risk|satellite|deforestation|geolocation|environmental/i.test(`${job.capability} ${job.providerAgent}`));
    const completedDocumentJobs = completedAgentJobs.filter((job) => job.status === "Concluído" && /invoice|document|certificate|transport/i.test(`${job.capability} ${job.providerAgent}`));
    const allPlotsGeolocated = properties.length > 0 && properties.every((property) => hasPolygonGeometry(property.geometryJson));
    const productionCountry = "Brazil";
    const productionPeriod = plan?.periodStart && plan?.periodEnd ? `${plan.periodStart} to ${plan.periodEnd}` : "Not provided";
    const submissionGaps = [
      !operation.euOperatorEori && "EU operator/importer EORI",
      !allPlotsGeolocated && "Validated geolocation of all production plots",
      !plan?.periodStart && "Production date or time range",
      !operation.species && "Common and full scientific names of the wood species",
      !legalityDocuments.length && "Conclusive and verifiable legality evidence",
      !completedRiskJobs.length && "Documented Article 10 risk assessment and negligible-risk conclusion",
    ].filter(Boolean) as string[];
    if (!testMode && !reviewed) {
      return Response.json({
        error: "Official-ready mode requires explicit confirmation that the real operation data were reviewed.",
        gaps: submissionGaps.map((gap) => translateToEnglish(gap)),
      }, { status: 422 });
    }

    const pdf = await PDFDocument.create();
    pdf.setTitle(`${testMode ? "TEST " : ""}EUDR Due Diligence Dossier ${operation.reference}`);
    pdf.setAuthor("ExportaTrust EUDR");
    pdf.setSubject("EUDR due diligence statement preparation and supply-chain evidence");
    pdf.setCreator("ExportaTrust EUDR");
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const green = rgb(0.03, 0.39, 0.29);
    const dark = rgb(0.08, 0.14, 0.12);
    const gray = rgb(0.38, 0.45, 0.42);
    const pale = rgb(0.91, 0.96, 0.93);

    const stageDetails: Record<string, string> = {
      "Floresta · CAR e mapas": `${properties.length} geolocated CAR origin(s) linked`,
      "Floresta · IBAMA e certidões": "Legality and forest-chain supporting evidence",
      "Floresta · Invoice / NF": "Commercial evidence for the forest raw material",
      "Transporte florestal · documentos": "DOF/GF, CT-e, MDF-e and transport records",
      "Transporte florestal · Invoice": "Freight billing from forest origin to industrial plant",
      "Planta industrial · cadastro e licenças": operation.productionUnit || "Industrial unit not provided",
      "Planta industrial · IBAMA e certidões": "CTF/APP, environmental regularity and applicable licences",
      "Planta industrial · produção": plan ? `${plan.rawMaterialConsumedKg} kg consumed to ${plan.pelletsProducedKg} kg produced` : "Industrial plan pending",
      "Exportação · Invoice industrial": "Manufacturer/exporter commercial invoice",
      "Transporte ao porto · documentos": operation.portOfLoading || "Loading location pending",
      "Porto · embarque e BL": `${operation.bookingNumber || "Booking pending"} - ${operation.vesselVoyage || "Vessel/voyage pending"}`,
      "Trading · cadastro e contrato": operation.exporterName || "Trading party pending",
      "Trading · Invoice final": "Final sale evidence to the EU importer/operator",
    };
    const stageRows = SUPPLY_CHAIN_STAGES.map((stage) => {
      const stageDocuments = sortedDocuments.filter((document) => stageAcceptsCategory(stage, document.category));
      const systemEvidence = stage.category === "Floresta · CAR e mapas"
        ? allPlotsGeolocated
        : stage.category === "Planta industrial · produção"
          ? Boolean(plan?.periodStart && plan?.periodEnd && plan?.receivingLots && plan?.productionLots)
          : false;
      const inactive = inactiveStageCategories.has(stage.category);
      return {
        number: stage.number,
        title: stage.titleEn,
        detail: inactive ? "This stage is not applicable to the current process" : stageDetails[stage.category] || stage.evidence,
        status: inactive ? "Not applicable" as const : stageDocuments.length || systemEvidence ? "Complete" as const : "Pending" as const,
      };
    });
    const massAvailable = plan ? plan.openingStockKg + plan.rawMaterialReceivedKg : 0;
    const massAccounted = plan ? plan.rawMaterialConsumedKg + plan.closingStockKg : 0;
    const massDifference = massAvailable - massAccounted;
    const riskRows = [
      {
        area: "Deforestation after 31 Dec 2020",
        result: completedRiskJobs.length ? "Screening recorded" : "Human review required",
        basis: completedRiskJobs[0]?.result || `${properties.length} CAR plot(s), satellite imagery and land-cover comparison`,
      },
      {
        area: "Forest degradation",
        result: completedRiskJobs.length ? "Screening recorded" : "Human review required",
        basis: "Harvesting pattern, forest-cover continuity and production-plot review",
      },
      {
        area: "Legality in country of production",
        result: legalityDocuments.length ? "Evidence present" : "Pending",
        basis: `${legalityDocuments.length} IBAMA, certificate, licence, DOF/GF or other legality item(s)`,
      },
      {
        area: "Traceability / mixing risk",
        result: plan && Math.abs(massDifference) < 0.01 && massAvailable > 0 ? "Controlled" : "Review required",
        basis: plan ? `Lot records and mass balance difference: ${massDifference.toFixed(2)} kg` : "Industrial receiving, production lots and mass balance pending",
      },
      {
        area: "Document consistency",
        result: completedDocumentJobs.length ? "Checks recorded" : "Human review required",
        basis: completedDocumentJobs[0]?.result || `${sortedDocuments.length} indexed evidence item(s) awaiting final consistency review`,
      },
    ];
    const evidenceRows = sortedDocuments.map((document) => {
      const stage = dossierStage(document.category);
      const extension = document.fileName.includes(".") ? document.fileName.split(".").pop()!.toUpperCase() : document.contentType.split("/").pop()!.toUpperCase();
      return {
        stage: stage.number,
        fileName: pdfText(document.fileName),
        purpose: pdfText(stage.title),
        type: extension,
        status: pdfText(document.status || "Received"),
      };
    });

    appendEudrStandardCore(pdf, { regular, bold }, {
      testMode,
      reviewed,
      reference: pdfText(operation.reference),
      officialReference: pdfText(operation.eudrReference),
      product: pdfText(operation.product),
      hsCode: pdfText(operation.hsCode),
      species: pdfText(operation.species || "Not provided"),
      quantity: pdfText(`${operation.quantity} ${operation.quantityUnit}`),
      netMass: pdfText(`${operation.netWeightKg} kg net mass`),
      productionCountry,
      productionPeriod: pdfText(productionPeriod),
      destination: pdfText(operation.destinationCountry),
      supplier: pdfText(operation.supplierName),
      exporter: pdfText(operation.exporterName || operation.supplierName),
      euOperator: pdfText(operation.euImporter || "Not provided"),
      eori: pdfText(operation.euOperatorEori || "Not provided"),
      readiness: operation.readiness,
      plots: properties.map((property) => ({
        carCode: pdfText(property.carCode),
        area: `${property.areaHa} ha`,
        geometryStatus: hasPolygonGeometry(property.geometryJson) ? "Polygon validated" : "Geometry pending",
      })),
      stages: stageRows,
      evidence: evidenceRows,
      risks: riskRows,
      gaps: submissionGaps.map(pdfText),
      generatedAt: new Date().toLocaleString("en-GB", { timeZone: "America/Sao_Paulo" }),
    });

    // The previous verbose report remains available only as a hidden migration
    // fallback. Standard customer reports always use the five-page core above.
    if (url.searchParams.get("legacy") === "1") {

    let page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: green });
    page.drawText("EXPORTATRUST EUDR", { x: 48, y: 760, size: 11, font: bold, color: rgb(0.72, 0.9, 0.82) });
    page.drawText("EUDR DUE DILIGENCE DOSSIER", { x: 48, y: 650, size: 27, font: bold, color: rgb(1, 1, 1) });
    wrap(pdfText(operation.reference), 34).slice(0, 2).forEach((text, index) => {
      page.drawText(text, { x: 48, y: 610 - index * 32, size: 27, font: bold, color: rgb(1, 1, 1) });
    });
    page.drawText(pdfText(`${operation.product} · HS ${operation.hsCode}`), { x: 48, y: 530, size: 13, font: regular, color: rgb(0.82, 0.93, 0.88) });
    wrap(pdfText(`${operation.exporterName} to ${operation.euImporter}`), 70).slice(0, 2).forEach((text, index) => {
      page.drawText(text, { x: 48, y: 500 - index * 14, size: 11, font: regular, color: rgb(0.82, 0.93, 0.88) });
    });
    if (testMode) {
      page.drawRectangle({ x: 48, y: 410, width: 390, height: 42, color: rgb(0.96, 0.72, 0.25) });
      page.drawText("TEST DATA - NOT FOR OFFICIAL SUBMISSION", { x: 62, y: 426, size: 12, font: bold, color: dark });
    }
    page.drawText(`Generated on ${new Date().toLocaleString("en-GB", { timeZone: "America/Sao_Paulo" })}`, { x: 48, y: 75, size: 9, font: regular, color: rgb(0.72, 0.9, 0.82) });

    let y = 780;
    const addPage = (title: string) => {
      page = pdf.addPage([595.28, 841.89]);
      page.drawRectangle({ x: 0, y: 810, width: 595.28, height: 31.89, color: green });
      page.drawText("EXPORTATRUST EUDR", { x: 38, y: 821, size: 8, font: bold, color: rgb(1, 1, 1) });
      const headerReference = pdfText(operation.reference);
      page.drawText(headerReference, { x: 557 - regular.widthOfTextAtSize(headerReference, 8), y: 821, size: 8, font: regular, color: rgb(1, 1, 1) });
      if (testMode) {
        page.drawText("TEST - NOT OFFICIAL", { x: 445, y: 797, size: 7, font: bold, color: rgb(0.72, 0.26, 0.08) });
      }
      page.drawText(pdfText(title), { x: 38, y: 775, size: 18, font: bold, color: dark });
      y = 744;
    };
    const line = (label: string, value: unknown, indent = 0) => {
      const lines = wrap(`${pdfText(label)}: ${pdfText(value)}`, 82 - indent);
      if (y - lines.length * 13 < 55) addPage("Continued");
      lines.forEach((text, index) => {
        page.drawText(text, { x: 42 + indent, y, size: 9, font: index === 0 ? bold : regular, color: index === 0 ? dark : gray });
        y -= 13;
      });
      // Extra paragraph spacing keeps the next section band clear of wrapped text.
      y -= 12;
    };
    const section = (title: string) => {
      if (y < 110) addPage(title);
      page.drawRectangle({ x: 38, y: y - 5, width: 519, height: 24, color: pale });
      page.drawText(pdfText(title), { x: 46, y: y + 3, size: 10, font: bold, color: green });
      y -= 34;
    };

    addPage("1. Draft Due Diligence Statement");
    page.drawRectangle({ x: 38, y: y - 10, width: 519, height: 42, color: rgb(1, 0.95, 0.82) });
    page.drawText(testMode ? "TEST PRE-SUBMISSION - ANNEX II DATA STRUCTURE - REGULATION (EU) 2023/1115" : "PRE-SUBMISSION - ANNEX II DATA STRUCTURE - REGULATION (EU) 2023/1115", { x: 48, y: y + 11, size: 8, font: bold, color: rgb(0.55, 0.37, 0.05) });
    page.drawText(testMode ? "Non-official test dossier. It must not be submitted or presented as an official DDS." : "This dossier is not an official DDS until validated and submitted through the EUDR Information System.", { x: 48, y: y - 2, size: 7, font: regular, color: rgb(0.55, 0.37, 0.05) });
    y -= 60;
    section("1. Operator responsible for submission");
    line("Name / legal entity", operation.euImporter || "Not provided");
    line("EORI", operation.euOperatorEori || "Not provided");
    line("Operator country", operation.destinationCountry || "Not provided");
    line("Brazilian data provider / representative", operation.exporterName || operation.supplierName);
    line("Dossier responsible person", `${operation.internalResponsible || "Not provided"} · ${operation.responsibleEmail || "Not provided"}`);
    section("2. Relevant product");
    line("Commodity", operation.product);
    line("HS/CN code", operation.hsCode);
    line("Commercial description", `${operation.rawMaterial || operation.product} · ${operation.species || "species not provided"}`);
    line("Declared quantity", `${operation.quantity} ${operation.quantityUnit}`);
    line("Net mass", `${operation.netWeightKg} kg`);
    line("Volume", `${operation.volumeM3} m³`);
    section("3. Origin and production");
    line("Country of production", productionCountry);
    line("Production period", productionPeriod);
    line("Geolocated plots", `${properties.length} CAR origin(s)`);
    line("Geospatial evidence", `${geolocationDocuments.length} item(s)`);
    line("Species", operation.species || "Not provided");
    section("4. Operator due diligence conclusion");
    line("Declaration", "The responsible EU operator must confirm that due diligence under Regulation (EU) 2023/1115 has been exercised and that no risk, or only negligible risk, of non-compliance was found before submission.");
    line("Statement status", submissionGaps.length ? `DRAFT · ${submissionGaps.length} pending field(s)` : "READY FOR OPERATOR REVIEW AND SUBMISSION");

    addPage("2. Pre-submission verification");
    section("Mandatory fields and evidence");
    line("Operator identification", operation.euImporter ? "Provided" : "Pending");
    line("EORI", operation.euOperatorEori || "Pending");
    line("Product and HS/CN code", operation.product && operation.hsCode ? "Provided" : "Pending");
    line("Quantity", operation.quantity ? `${operation.quantity} ${operation.quantityUnit}` : "Pending");
    line("Country of production", productionCountry);
    line("Geolocation", properties.length ? `${properties.length} plot(s) linked` : "Pending");
    line("Production period", productionPeriod);
    line("Legality", legalityDocuments.length ? `${legalityDocuments.length} evidence item(s) linked` : "Pending");
    line("Country risk classification", "Brazil · standard risk · EU benchmarking checked 7 August 2026");
    line("Risk assessment", "Required under Article 10 and must support a no-risk or negligible-risk conclusion before DDS submission");
    line("Risk mitigation", "Required under Article 11 whenever the assessment identifies more than negligible risk");
    section("Gaps before official transmission");
    if (!submissionGaps.length) line("Status", "No structural data gap identified; regulatory risk review and EU operator validation remain mandatory.");
    submissionGaps.forEach((gap, index) => line(`Gap ${index + 1}`, gap));
    section("Statement traceability");
    line("Internal reference", operation.reference);
    line("Official EUDR reference", operation.eudrReference || "Returned by the EUDR Information System after submission");
    line("Status", operation.eudrReference ? "Reference provided" : "Pre-submission");

    // The consolidated DDS dossier must preserve the same satellite/geolocation
    // evidence used by each forest-origin dossier. One page is added per linked CAR.
    for (const property of properties) {
      const satellite = await satelliteMap(property.geometryJson);
      const forestPdfBytes = await generateForestDossierPdf(property, [], [operation.reference], {}, satellite);
      const forestPdf = await PDFDocument.load(forestPdfBytes);
      const [satellitePage] = await pdf.copyPages(forestPdf, [0]);
      pdf.addPage(satellitePage);
    }

    addPage("3. Operation executive summary");
    section("Identification and participants");
    line("Product", operation.product); line("HS/CN", operation.hsCode); line("Destination", operation.destinationCountry);
    line("Primary supplier", operation.supplierName); line("Exporter", operation.exporterName); line("EU importer/operator", operation.euImporter);
    line("Internal responsible person", `${operation.internalResponsible} · ${operation.responsibleEmail}`);
    section("Commercial terms and logistics");
    line("Quantity", `${operation.quantity} ${operation.quantityUnit}`); line("Net mass", `${operation.netWeightKg} kg`);
    line("Incoterm", operation.incoterm); line("Commercial value", `${operation.currency} ${operation.commercialValue}`);
    line("Route", `${operation.portOfLoading} → ${operation.portOfDischarge || operation.destinationCountry}`);
    line("Carrier", operation.carrier); line("Booking / containers", `${operation.bookingNumber} · ${operation.containerNumbers}`);
    section("Evidence completeness");
    line("Supply-chain evidence completeness", `${operation.readiness}%`); line("Operational status", operation.status); line("DDS/EUDR reference", operation.eudrReference || "Not issued yet");
    line("Legal meaning", "Evidence completeness does not by itself constitute EUDR compliance or a negligible-risk conclusion.");
    section("Automated compliance checks");
    const dossierAgentFindings = completedAgentJobs.filter((job) => job.status === "Concluído" && job.result);
    if (!dossierAgentFindings.length) line("Status", "No completed automated compliance checks recorded");
    dossierAgentFindings.slice(0, 20).forEach((job) => {
      const stage = dossierStage(job.stageCategory);
      line(`STAGE ${stage.number}`, `${job.result} · Confidence ${job.confidence}% · Human review required`);
    });

    addPage("4. Complete supply chain");
    const stages = SUPPLY_CHAIN_STAGES.map((stage) => [stage.number, stage.titleEn, stageDetails[stage.category] || stage.evidence, stage.category]);
    for (const [number, title, detail, category] of stages) {
      if (y < 75) addPage("4. Complete supply chain - continued");
      page.drawCircle({ x: 54, y: y + 3, size: 13, color: green });
      page.drawText(number, { x: 47, y, size: 7, font: bold, color: rgb(1, 1, 1) });
      page.drawText(pdfText(title), { x: 78, y: y + 4, size: 10, font: bold, color: dark });
      page.drawText(pdfText(inactiveStageCategories.has(category) ? "NOT APPLICABLE TO THIS PROCESS" : detail), { x: 78, y: y - 9, size: 8, font: regular, color: gray });
      y -= 39;
    }

    addPage("5. Linked CAR origins");
    if (!properties.length) line("Status", "No CAR origin linked");
    properties.forEach((property, index) => {
      section(`${index + 1}. ${property.name}`);
      line("CAR", property.carCode); line("Municipality", property.city); line("Supplier", property.supplier);
      line("Total area", `${property.areaHa} ha`); line("Native vegetation", `${property.nativeAreaHa} ha`); line("Operational risk flag", property.risk);
    });

    addPage("6. Industrial plan and mass balance");
    if (!plan) line("Status", "Industrial plan not completed yet");
    else {
      const available = plan.openingStockKg + plan.rawMaterialReceivedKg;
      const accounted = plan.rawMaterialConsumedKg + plan.closingStockKg;
      const difference = available - accounted;
      const yieldValue = plan.rawMaterialConsumedKg ? (plan.pelletsProducedKg / plan.rawMaterialConsumedKg) * 100 : 0;
      line("Period", `${plan.periodStart} to ${plan.periodEnd}`); line("Receiving lots", plan.receivingLots);
      line("Opening stock", `${plan.openingStockKg} kg`); line("Raw material received", `${plan.rawMaterialReceivedKg} kg`);
      line("Raw material consumed", `${plan.rawMaterialConsumedKg} kg`); line("Closing stock", `${plan.closingStockKg} kg`);
      line("Production output", `${plan.pelletsProducedKg} kg`); line("Production lots", plan.productionLots);
      line("Mass-balance difference", `${difference} kg`); line("Industrial yield", `${yieldValue.toFixed(1)}%`); line("Notes", plan.notes || "No notes");
    }

    addPage("7. Partners and third parties");
    if (!partners.length) line("Status", "No third-party participant registered");
    partners.forEach((partner, index) => {
      section(`${index + 1}. ${partner.companyName}`);
      line("Role", partner.role); line("Contact", `${partner.contactName} · ${partner.email}`); line("Country", partner.country);
    });

    addPage("8. Supply-chain evidence by stage");
    if (!sortedDocuments.length) line("Status", "No document attached");
    sortedDocuments.forEach((document, index) => {
      if (y < 65) addPage("8. Document index - continued");
      const stage = dossierStage(document.category);
      page.drawText(pdfText(`STAGE ${stage.number} · ${stage.title}`), { x: 42, y, size: 9, font: bold, color: green });
      y -= 13;
      page.drawText(pdfText(`${String(index + 1).padStart(2, "0")}. ${document.fileName}`), { x: 58, y, size: 8, font: bold, color: dark });
      y -= 12;
      page.drawText(pdfText(`${document.category} · ${document.contentType} · ${Math.max(1, Math.round(document.sizeBytes / 1024))} KB · ${document.notes}`), { x: 58, y, size: 7, font: regular, color: gray });
      y -= 18;
    });
    }

    // Preserve the full CAR/SICAR geographic dossier after the five-page core
    // only in the complete package. The summary remains a compact five-page PDF.
    if (includeAttachments) {
      for (const property of properties) {
        const propertyEvidence = originDocuments.filter((document) => document.propertyCarCode === property.carCode);
        const currentSicar = await fetchCurrentSicarProperty(property.carCode);
        const effectiveGeometryJson = currentSicar.geometryJson || property.geometryJson;
        const satellite = await satelliteMap(effectiveGeometryJson);
        const officialFile = await officialSicarPdf(propertyEvidence);
        const forestPdfBytes = await generateForestDossierPdf(
          { ...property, geometryJson: effectiveGeometryJson },
          propertyEvidence,
          [operation.reference],
          currentSicar.record,
          satellite,
          officialFile,
        );
        const forestPdf = await PDFDocument.load(forestPdfBytes);
        const forestPages = await pdf.copyPages(forestPdf, forestPdf.getPageIndices());
        forestPages.forEach((forestPage) => pdf.addPage(forestPage));
      }
    }

    const { env } = await import("cloudflare:workers");
    if (includeAttachments && !env.BUCKET) throw new Error("Armazenamento de documentos indisponível.");
    if (includeAttachments) for (let index = 0; index < sortedDocuments.length; index += 1) {
      const document = sortedDocuments[index];
      const stage = dossierStage(document.category);
      const divider = pdf.addPage([595.28, 841.89]);
      divider.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: pale });
      divider.drawText(`STAGE ${stage.number} · ${pdfText(stage.title)}`, { x: 48, y: 735, size: 12, font: bold, color: green });
      divider.drawText(`EVIDENCE ${String(index + 1).padStart(2, "0")}`, { x: 48, y: 716, size: 8, font: bold, color: gray });
      if (testMode) divider.drawText("TEST EVIDENCE - NOT FOR OFFICIAL SUBMISSION", { x: 48, y: 695, size: 8, font: bold, color: rgb(0.72, 0.26, 0.08) });
      divider.drawText(pdfText(document.category), { x: 48, y: 670, size: 19, font: bold, color: dark });
      wrap(pdfText(document.fileName), 65).forEach((text, lineIndex) => divider.drawText(text, { x: 48, y: 630 - lineIndex * 15, size: 11, font: regular, color: gray }));
      const object = await env.BUCKET!.get(document.objectKey);
      if (!object) {
        divider.drawText("File not found in document storage.", { x: 48, y: 560, size: 10, font: regular, color: rgb(0.7, 0.1, 0.1) });
        continue;
      }
      const bytes = new Uint8Array(await object.arrayBuffer());
      try {
        if (document.contentType === "application/pdf" || document.fileName.toLowerCase().endsWith(".pdf")) {
          const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const copied = await pdf.copyPages(source, source.getPageIndices());
          copied.forEach((copiedPage) => pdf.addPage(copiedPage));
        } else if (document.contentType.startsWith("image/jpeg") || /\.jpe?g$/i.test(document.fileName)) {
          const image = await pdf.embedJpg(bytes);
          const imagePage = pdf.addPage([595.28, 841.89]);
          const scaled = image.scaleToFit(515, 760);
          imagePage.drawImage(image, { x: (595.28 - scaled.width) / 2, y: (841.89 - scaled.height) / 2, width: scaled.width, height: scaled.height });
        } else if (document.contentType.startsWith("image/png") || /\.png$/i.test(document.fileName)) {
          const image = await pdf.embedPng(bytes);
          const imagePage = pdf.addPage([595.28, 841.89]);
          const scaled = image.scaleToFit(515, 760);
          imagePage.drawImage(image, { x: (595.28 - scaled.width) / 2, y: (841.89 - scaled.height) / 2, width: scaled.width, height: scaled.height });
        } else {
          divider.drawText("Evidence recorded in the index; original format available in the document centre.", { x: 48, y: 560, size: 9, font: regular, color: gray });
        }
      } catch {
        divider.drawText("The file remains recorded but could not be embedded in the PDF.", { x: 48, y: 560, size: 9, font: regular, color: rgb(0.7, 0.1, 0.1) });
      }
    }

    const bytes = await pdf.save();
    const fileName = `${testMode ? "TEST-" : ""}Pre-DDS-EUDR-${operation.reference.replace(/[^a-zA-Z0-9_-]+/g, "-")}.pdf`;
    const sha256 = await sha256Hex(bytes);
    await db.insert(pdfIntegrityRecords).values({ organizationId: context.organizationId, operationId: operation.id, documentType: testMode ? "PRE_DDS_TEST" : "DDS_EUDR", fileName, sha256, generatedBy: context.email });
    await audit(context, "PDF_GENERATED", "eudr_report", String(operation.id), { fileName, sha256, testMode, includeAttachments });
    return new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${fileName}"`,
        "content-length": String(bytes.byteLength),
        "cache-control": "no-store",
        "digest": `sha-256=${sha256}`,
        "x-exportatrust-sha256": sha256,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const message = translateToEnglish(errorMessage(error));
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PDF generation failed</title><style>body{margin:0;padding:28px;background:#f4f7f5;color:#17211d;font-family:system-ui}main{max-width:620px;margin:8vh auto;padding:28px;background:#fff;border:1px solid #dce3df;border-radius:14px}b{display:grid;width:46px;height:46px;place-items:center;border-radius:50%;background:#fdeaea;color:#c83636;font-size:24px}h1{font-size:22px}p{color:#66736d;line-height:1.6}a{display:inline-block;margin-top:12px;padding:11px 16px;color:#fff;background:#08785c;border-radius:8px;text-decoration:none;font-weight:700}</style></head><body><main><b>!</b><h1>This PDF could not be generated</h1><p>${safeText(message)}</p><p>Return to the command centre and try the summary version without attachments.</p><a href="javascript:history.back()">Return to report</a></main></body></html>`;
    return new Response(html, { status: 500, headers: { "content-type": "text/html; charset=utf-8" } });
  }
}

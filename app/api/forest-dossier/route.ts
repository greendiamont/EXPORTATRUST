import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { forestDocuments, operations, pdfIntegrityRecords, ruralProperties } from "../../../db/schema";
import { generateForestDossierPdf } from "../../../lib/forest-dossier-pdf";
import { satelliteMap } from "../../../lib/satellite-map";
import { fetchCurrentSicarProperty } from "../../../lib/sicar-current";
import { audit, requireSecurityContext, sha256Hex } from "../../../lib/security";

function parseIds(value: string) {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
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
  } catch { return undefined; }
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("export");
    await ensureBaseTables();
    const carCode = String(new URL(request.url).searchParams.get("carCode") ?? "").trim().toUpperCase();
    if (!carCode) return Response.json({ error: "CAR is required." }, { status: 400 });
    const db = await getDb();
    const [property] = await db.select().from(ruralProperties).where(and(eq(ruralProperties.carCode, carCode), eq(ruralProperties.organizationId, context.organizationId))).limit(1);
    if (!property) return Response.json({ error: "CAR property not found." }, { status: 404 });
    const [evidence, operationRows] = await Promise.all([
      db.select().from(forestDocuments).where(and(eq(forestDocuments.propertyCarCode, carCode), eq(forestDocuments.organizationId, context.organizationId))).limit(500),
      db.select({ reference: operations.reference, propertyIds: operations.propertyIds }).from(operations).where(eq(operations.organizationId, context.organizationId)).limit(1000),
    ]);
    const linkedProcesses = operationRows.filter((operation) => parseIds(operation.propertyIds).includes(carCode)).map((operation) => operation.reference);
    const [currentSicar, officialFile] = await Promise.all([fetchCurrentSicarProperty(carCode), officialSicarPdf(evidence)]);
    const effectiveGeometryJson = currentSicar.geometryJson || property.geometryJson;
    const satellite = await satelliteMap(effectiveGeometryJson);
    const bytes = await generateForestDossierPdf({ ...property, geometryJson: effectiveGeometryJson }, evidence, linkedProcesses, currentSicar.record, satellite, officialFile);
    const safeCar = carCode.replace(/[^A-Z0-9_-]+/g, "-");
    const fileName = `EUDR-Forest-Origin-Dossier-${safeCar}.pdf`;
    const sha256 = await sha256Hex(bytes);
    await db.insert(pdfIntegrityRecords).values({ organizationId: context.organizationId, propertyCarCode: carCode, documentType: "FOREST_DOSSIER", fileName, sha256, generatedBy: context.email });
    await audit(context, "PDF_GENERATED", "forest_dossier", carCode, { fileName, sha256 });
    return new Response(bytes, { headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileName}"`,
      "content-length": String(bytes.byteLength),
      "cache-control": "no-store",
      "digest": `sha-256=${sha256}`,
      "x-exportatrust-sha256": sha256,
      "x-content-type-options": "nosniff",
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forest dossier could not be generated.";
    return Response.json({ error: message }, { status: 500 });
  }
}

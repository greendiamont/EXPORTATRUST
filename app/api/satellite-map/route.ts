import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { ruralProperties } from "../../../db/schema";
import { satelliteMap } from "../../../lib/satellite-map";
import { fetchCurrentSicarProperty } from "../../../lib/sicar-current";
import { requireSecurityContext } from "../../../lib/security";

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const carCode = String(new URL(request.url).searchParams.get("carCode") ?? "").trim().toUpperCase();
    if (!carCode) return Response.json({ error: "CAR is required." }, { status: 400 });
    const db = await getDb();
    const [property] = await db.select({ geometryJson: ruralProperties.geometryJson }).from(ruralProperties).where(and(eq(ruralProperties.carCode, carCode), eq(ruralProperties.organizationId, context.organizationId))).limit(1);
    if (!property) return Response.json({ error: "CAR property not found." }, { status: 404 });
    const currentSicar = await fetchCurrentSicarProperty(carCode);
    const satellite = await satelliteMap(currentSicar.geometryJson || property.geometryJson);
    if (!satellite?.bytes?.length) return Response.json({ error: "Satellite imagery is unavailable for this CAR geometry." }, { status: 404 });
    return new Response(satellite.bytes, { headers: { "content-type": satellite.contentType, "cache-control": "private, max-age=1800", "x-map-provider": satellite.provider } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Satellite map could not be loaded." }, { status: 500 });
  }
}

import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { ruralProperties } from "../../../db/schema";
import { screenIbamaEmbargo } from "../../../lib/ibama-screening";
import { requireSecurityContext } from "../../../lib/security";

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const carCode = String(new URL(request.url).searchParams.get("carCode") ?? "").trim().toUpperCase();
    if (!carCode) return Response.json({ error: "CAR is required." }, { status: 400 });
    const db = await getDb();
    const [property] = await db.select({ carCode: ruralProperties.carCode, geometryJson: ruralProperties.geometryJson }).from(ruralProperties).where(and(eq(ruralProperties.carCode, carCode), eq(ruralProperties.organizationId, context.organizationId))).limit(1);
    if (!property) return Response.json({ error: "CAR property not found in the forest registry." }, { status: 404 });
    return Response.json({ carCode, ...(await screenIbamaEmbargo(property.geometryJson)), interpretation: "Screening result only. A spatial intersection must be reviewed against the official embargo record before a legal conclusion." }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "IBAMA screening failed." }, { status: 502 });
  }
}

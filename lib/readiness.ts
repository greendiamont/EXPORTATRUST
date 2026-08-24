import { eq } from "drizzle-orm";
import type { getDb } from "../db";
import { industrialPlans, operationDocuments, operations, operationStageSettings, ruralProperties } from "../db/schema";
import { normalizeStageCategory, SUPPLY_CHAIN_STAGES } from "./supply-chain-stages";

export function calculateReadiness(
  operationId: number,
  documents: Array<{ operationId: number; category: string }>,
  settings: Array<{ operationId: number; stageCategory: string; enabled: boolean }>,
  hasGeolocatedProperties = false,
  completedSystemStages: string[] = [],
) {
  const inactive = new Set(settings.filter((setting) => setting.operationId === operationId && !setting.enabled).map((setting) => setting.stageCategory));
  const active = SUPPLY_CHAIN_STAGES.filter((stage) => !inactive.has(stage.category));
  if (!active.length) return 0;
  const categories = new Set(documents.filter((document) => document.operationId === operationId).map((document) => normalizeStageCategory(document.category)));
  const systemCompleted = new Set(completedSystemStages);
  const completed = active.filter((stage) =>
    (stage.category === "Floresta · CAR e mapas" && hasGeolocatedProperties)
    || systemCompleted.has(stage.category)
    || [stage.category, ...stage.legacy].some((accepted) => categories.has(normalizeStageCategory(accepted)))
  ).length;
  return Math.round((completed / active.length) * 100);
}

export async function refreshOperationReadiness(db: Awaited<ReturnType<typeof getDb>>, operationId: number) {
  const [documents, settings, operationRows, plans] = await Promise.all([
    db.select({ operationId: operationDocuments.operationId, category: operationDocuments.category }).from(operationDocuments).where(eq(operationDocuments.operationId, operationId)).limit(500),
    db.select({ operationId: operationStageSettings.operationId, stageCategory: operationStageSettings.stageCategory, enabled: operationStageSettings.enabled }).from(operationStageSettings).where(eq(operationStageSettings.operationId, operationId)).limit(100),
    db.select({ propertyIds: operations.propertyIds }).from(operations).where(eq(operations.id, operationId)).limit(1),
    db.select().from(industrialPlans).where(eq(industrialPlans.operationId, operationId)).limit(1),
  ]);
  const propertyIds = (() => {
    try {
      const parsed = JSON.parse(operationRows[0]?.propertyIds ?? "[]");
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  })();
  const properties = propertyIds.length
    ? await db.select({ carCode: ruralProperties.carCode, geometryJson: ruralProperties.geometryJson }).from(ruralProperties).limit(2000)
    : [];
  const hasGeolocatedProperties = properties.some((property) => propertyIds.includes(property.carCode) && hasPolygonGeometry(property.geometryJson));
  const plan = plans[0];
  const completedSystemStages = plan?.periodStart && plan.periodEnd && plan.receivingLots && plan.productionLots ? ["Planta industrial · produção"] : [];
  const readiness = calculateReadiness(operationId, documents, settings, hasGeolocatedProperties, completedSystemStages);
  await db.update(operations).set({ readiness }).where(eq(operations.id, operationId));
  return readiness;
}

export function hasPolygonGeometry(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    const geometry = parsed?.type === "Feature" ? parsed.geometry : parsed?.type === "FeatureCollection" ? parsed.features?.[0]?.geometry : parsed;
    if (geometry?.type === "Polygon") return Array.isArray(geometry.coordinates?.[0]) && geometry.coordinates[0].length >= 4;
    if (geometry?.type === "MultiPolygon") return Array.isArray(geometry.coordinates?.[0]?.[0]) && geometry.coordinates[0][0].length >= 4;
    return false;
  } catch {
    return false;
  }
}

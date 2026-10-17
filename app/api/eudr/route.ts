import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { operations, ruralProperties } from "../../../db/schema";
import { audit, requireSecurityContext, type SecurityContext } from "../../../lib/security";
import { isEudrRequired } from "../../../lib/export-control";
import { readOrderTerms } from "../../../lib/order-terms";
import { screenIbamaEmbargo } from "../../../lib/ibama-screening";
import { FOREST_CHECKS, FOREST_DOCS, balanceOf, cleanForestEudr, eudrGeoJson, exportedQuantity, forestStatus, geometryKind, orderDocs, orderSteps, readForestEudr, readOrderEudr, readinessOf, writeOrderEudr, type ForestSummary } from "../../../lib/eudr";
import { eudrDeclarationHtml } from "../../../lib/eudr-declaration";

// EUDR · rastreabilidade (protótipo "4b"): pedidos para a UE com as 5 etapas, florestas com documentos e
// verificações, e o pacote para o importador (declaração + GeoJSON). Só a equipe; convidado bloqueado.

const STAFF_READ = new Set(["administrador", "analista", "auditor"]);
const STAFF_WRITE = new Set(["administrador", "analista"]);
const forbid = () => Response.json({ error: "A EUDR é só para a equipe (administrador ou analista)." }, { status: 403 });
const today = () => new Date().toISOString().slice(0, 10);

type Operation = typeof operations.$inferSelect;
type Property = typeof ruralProperties.$inferSelect;

function forestOf(property: Property): ForestSummary & { city: string; status: string; supplier: string } {
  return { carCode: property.carCode, name: property.name, geometryJson: property.geometryJson, areaHa: property.areaHa, city: property.city, status: property.status, supplier: property.supplier, eudr: readForestEudr(property.eudrJson, property.supplier) };
}

function orderView(operation: Operation, forests: ForestSummary[], now: string) {
  const eudr = readOrderEudr(operation.supplyChainNotes, operation.hsCode);
  const terms = readOrderTerms(operation);
  const itemsVolume = terms.items.reduce((sum, item) => sum + (Number(item.volume) || 0), 0);
  const exported = exportedQuantity(eudr.productKind, operation, itemsVolume);
  const steps = orderSteps({ eudr, forests, operation, exported, today: now });
  const hasNative = eudr.origins.some((origin) => forests.find((forest) => forest.carCode === origin.carCode)?.eudr.originType === "Nativa");
  return {
    id: operation.id, reference: operation.reference, client: operation.euImporter, country: operation.destinationCountry, product: operation.product,
    hsCode: operation.hsCode, etd: operation.shipmentDate, supplierName: operation.supplierName, exporterName: operation.exporterName,
    eori: operation.euOperatorEori, eudrReference: operation.eudrReference, netWeightKg: operation.netWeightKg, volumeM3: itemsVolume || operation.volumeM3,
    containers: operation.containerNumbers, portOfLoading: operation.portOfLoading, portOfDischarge: operation.portOfDischarge, billOfLading: operation.billOfLadingNumber,
    species: operation.species, cancelled: Boolean(terms.cancelled), completed: Boolean(terms.completed),
    eudr, steps, readiness: readinessOf(steps), exported, balance: balanceOf(eudr, exported), chainDocs: orderDocs(eudr.productKind, hasNative),
  };
}

async function load(context: SecurityContext) {
  const db = await getDb();
  const [rows, properties] = await Promise.all([
    db.select().from(operations).where(eq(operations.organizationId, context.organizationId)).orderBy(desc(operations.id)).limit(500),
    db.select().from(ruralProperties).where(eq(ruralProperties.organizationId, context.organizationId)).orderBy(ruralProperties.name).limit(2000),
  ]);
  return { db, rows, properties };
}

async function snapshot(context: SecurityContext) {
  const { rows, properties } = await load(context);
  const now = today();
  const forests = properties.map(forestOf);
  const orders = rows
    .filter((operation) => isEudrRequired(operation.destinationCountry, operation.hsCode, operation.product) || readOrderEudr(operation.supplyChainNotes).origins.length > 0)
    .map((operation) => orderView(operation, forests, now))
    .filter((order) => !order.cancelled);
  const usedIn = new Map<string, string[]>();
  for (const order of orders) for (const origin of order.eudr.origins) usedIn.set(origin.carCode, [...(usedIn.get(origin.carCode) ?? []), order.reference]);
  return {
    orders,
    forests: forests.map((forest) => ({ ...forest, geometryKind: geometryKind(forest.geometryJson), geometryJson: undefined, status: forestStatus(forest, now), registryStatus: forest.status, usedIn: usedIn.get(forest.carCode) ?? [] })),
    forestDocs: FOREST_DOCS, forestChecks: FOREST_CHECKS, today: now, canWrite: STAFF_WRITE.has(context.role),
  };
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    if (!STAFF_READ.has(context.role)) return forbid();
    await ensureBaseTables();
    const url = new URL(request.url);
    const packageKind = url.searchParams.get("package");
    if (packageKind) {
      const { rows, properties } = await load(context);
      const operation = rows.find((row) => row.id === Number(url.searchParams.get("operationId")));
      if (!operation) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
      const forests = properties.map(forestOf);
      const order = orderView(operation, forests, today());
      const used = order.eudr.origins.map((origin) => ({ origin, forest: forests.find((forest) => forest.carCode === origin.carCode) })).filter((item) => item.forest);
      if (packageKind === "geojson") {
        const body = JSON.stringify(eudrGeoJson(used.map(({ origin, forest }) => ({ ...forest!, harvestFrom: origin.harvestFrom, harvestTo: origin.harvestTo }))), null, 2);
        return new Response(body, { headers: { "content-type": "application/geo+json; charset=utf-8", "content-disposition": `attachment; filename="EUDR-${operation.reference.replace(/[^\w.-]+/g, "_")}.geojson"`, "cache-control": "no-store" } });
      }
      return new Response(eudrDeclarationHtml({ order, origins: used.map(({ origin, forest }) => ({ origin, forest: forest! })), today: today() }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    return Response.json(await snapshot(context), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao montar a EUDR." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    if (!STAFF_WRITE.has(context.role)) return forbid();
    await ensureBaseTables();
    const db = await getDb();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "save-forest" || action === "check-ibama") {
      const carCode = String(body.carCode ?? "").trim().toUpperCase();
      const [property] = await db.select().from(ruralProperties).where(and(eq(ruralProperties.carCode, carCode), eq(ruralProperties.organizationId, context.organizationId))).limit(1);
      if (!property) return Response.json({ error: "Floresta/CAR não encontrada." }, { status: 404 });
      const current = readForestEudr(property.eudrJson, property.supplier);
      let next = cleanForestEudr(body.eudr ?? {}, current);
      if (action === "check-ibama") {
        // Consulta a camada pública de embargos do IBAMA; o resultado fica registrado como verificação.
        const result = await screenIbamaEmbargo(property.geometryJson);
        next = cleanForestEudr({ checks: { ibama: { done: !result.intersects, at: result.checkedAt, by: context.email, note: result.intersects ? `${result.matchCount} embargo(s) na área do imóvel — revisar` : "Nenhum embargo encontrado (consulta automática)" } } }, next);
      } else {
        // Marcar/desmarcar verificação registra quem e quando.
        for (const check of FOREST_CHECKS) {
          const before = current.checks[check.key];
          const after = next.checks[check.key];
          if (after && before && after.done !== before.done) next.checks[check.key] = { ...after, at: after.done ? new Date().toISOString() : "", by: after.done ? context.email : "" };
        }
      }
      await db.update(ruralProperties).set({ eudrJson: JSON.stringify(next) }).where(and(eq(ruralProperties.carCode, carCode), eq(ruralProperties.organizationId, context.organizationId)));
      await audit(context, action === "check-ibama" ? "EUDR_FOREST_IBAMA_CHECKED" : "EUDR_FOREST_UPDATED", "rural_property", carCode, {});
      return Response.json(await snapshot(context));
    }

    if (action === "save-order") {
      const id = Number(body.operationId);
      const [operation] = await db.select().from(operations).where(and(eq(operations.id, id), eq(operations.organizationId, context.organizationId))).limit(1);
      if (!operation) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
      const current = readOrderEudr(operation.supplyChainNotes, operation.hsCode);
      const input = body.eudr && typeof body.eudr === "object" ? body.eudr as Record<string, unknown> : {};
      const merged = readOrderEudr(JSON.stringify({ eudr: { ...current, ...input, docs: { ...current.docs, ...(input.docs && typeof input.docs === "object" ? input.docs as object : {}) } } }), operation.hsCode);
      const changes: Partial<Operation> = { supplyChainNotes: writeOrderEudr(operation.supplyChainNotes, merged) };
      if (typeof body.ddsReference === "string") changes.eudrReference = body.ddsReference.trim().slice(0, 120);
      if (typeof body.eori === "string") changes.euOperatorEori = body.eori.trim().slice(0, 40);
      await db.update(operations).set(changes).where(and(eq(operations.id, id), eq(operations.organizationId, context.organizationId)));
      await audit(context, "EUDR_ORDER_UPDATED", "operation", String(id), { reference: operation.reference, ...(typeof body.ddsReference === "string" ? { ddsReference: changes.eudrReference } : {}) });
      return Response.json(await snapshot(context));
    }

    return Response.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha na EUDR." }, { status: 500 });
  }
}

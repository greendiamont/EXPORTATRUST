import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, exportMilestones, industrialPlans, operationPartners, operations, ruralProperties, shipmentAdvices } from "../../../db/schema";
import { EXPORT_ORDER_MILESTONES } from "../../../lib/export-control";
import { convertOperation, convertProperty, extractProcessBundle, legacyNumber, legacyText, milestonesFor, sourceOperationId } from "../../../lib/process-import";
import { audit, requireSecurityContext } from "../../../lib/security";

// Importa os processos do app antigo para a empresa ativa: florestas (CAR) usadas pelos
// processos, processos com vínculos aos cadastros já importados, etapas recriadas pelo
// status antigo, parceiros, avisos de embarque e planos industriais. Prévia com dryRun.
// Nunca apaga nem sobrescreve; referência de processo e código CAR são únicos no banco.
// Documentos (arquivos) ficam para a importação de arquivos.

type Outcome = {
  sourceId: number | null;
  legalName: string;
  taxId: string;
  action: "criar" | "completar" | "já existe" | "ignorado";
  targetId: number | null;
  completed: string[];
  adjustments: string[];
  warnings: string[];
};

const parse = (value: string) => {
  try { return JSON.parse(value || "{}") as Record<string, unknown>; } catch { return {}; }
};

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    const body = await request.json() as { payload?: unknown; dryRun?: boolean };
    const bundle = extractProcessBundle(body.payload);
    if (!bundle.operations.length) return Response.json({ error: "Nenhum processo encontrado no arquivo. Use o backup ou a exportação do app antigo." }, { status: 400 });
    if (bundle.operations.length > 2000) return Response.json({ error: "Limite de 2000 processos por importação." }, { status: 400 });
    const dryRun = body.dryRun !== false;
    const db = await getDb();
    const org = context.organizationId;
    const now = new Date().toISOString();

    // Mapas id antigo → id novo das importações anteriores.
    const history = await db.select({ action: auditLogs.action, entityId: auditLogs.entityId, metadataJson: auditLogs.metadataJson }).from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org), inArray(auditLogs.action, ["SUPPLIER_IMPORTED", "REGISTRY_IMPORTED", "PROCESS_IMPORTED"])));
    const maps = { suppliers: new Map<number, number>(), clientes: new Map<number, number>(), produtos: new Map<number, number>(), processos: new Map<number, number>() };
    for (const event of history) {
      const metadata = parse(event.metadataJson);
      const sourceId = Number(metadata.sourceId);
      const targetId = Number(event.entityId);
      if (!sourceId || !targetId) continue;
      if (event.action === "SUPPLIER_IMPORTED") maps.suppliers.set(sourceId, targetId);
      else if (event.action === "PROCESS_IMPORTED") maps.processos.set(sourceId, targetId);
      else if (metadata.kind === "clientes" || metadata.kind === "produtos") maps[metadata.kind].set(sourceId, targetId);
    }

    // Florestas (CAR) — código CAR é único no banco inteiro.
    const propertyNotes: string[] = [];
    const carCodes = bundle.properties.map((row) => legacyText(row, "carCode")).filter(Boolean);
    const existingCars = carCodes.length ? await db.select({ carCode: ruralProperties.carCode, organizationId: ruralProperties.organizationId }).from(ruralProperties).where(inArray(ruralProperties.carCode, carCodes)) : [];
    let propertiesCreated = 0;
    for (const row of bundle.properties) {
      const property = convertProperty(row);
      if (!property.carCode) continue;
      const found = existingCars.find((item) => item.carCode === property.carCode);
      if (found) {
        if (found.organizationId !== org) propertyNotes.push(`CAR ${property.carCode} já pertence a outra empresa; não foi copiado`);
        continue;
      }
      propertiesCreated += 1;
      if (!dryRun) {
        await db.insert(ruralProperties).values({ ...property, organizationId: org });
        await audit(context, "PROPERTY_IMPORTED", "rural_property", property.carCode, { name: property.name });
      }
    }

    const references = bundle.operations.map((row) => legacyText(row, "reference")).filter(Boolean);
    const existingOps = references.length ? await db.select({ id: operations.id, reference: operations.reference, organizationId: operations.organizationId }).from(operations).where(inArray(operations.reference, references)) : [];
    const outcomes: Outcome[] = [];
    const created = new Map<number, number>();

    for (const row of bundle.operations) {
      const legacy = convertOperation(row);
      const base = { sourceId: legacy.sourceId, legalName: legacy.reference, taxId: String(legacy.values.status), completed: [] as string[], targetId: null as number | null, adjustments: [] as string[], warnings: [] as string[] };
      if (!legacy.reference) {
        outcomes.push({ ...base, action: "ignorado", warnings: ["Processo sem referência"] });
        continue;
      }
      const previous = legacy.sourceId ? maps.processos.get(legacy.sourceId) : undefined;
      const sameReference = existingOps.find((item) => item.reference === legacy.reference);
      if (previous || sameReference) {
        if (sameReference && sameReference.organizationId !== org) {
          outcomes.push({ ...base, action: "ignorado", warnings: ["Referência já usada por processo de outra empresa"] });
          continue;
        }
        const targetId = previous ?? sameReference!.id;
        if (legacy.sourceId) created.set(legacy.sourceId, targetId);
        outcomes.push({ ...base, action: "já existe", targetId });
        continue;
      }

      const supplierId = legacy.sourceSupplierId ? maps.suppliers.get(legacy.sourceSupplierId) ?? null : null;
      const importerClientId = legacy.sourceClientId ? maps.clientes.get(legacy.sourceClientId) ?? null : null;
      const masterProductId = legacy.sourceProductId ? maps.produtos.get(legacy.sourceProductId) ?? null : null;
      if (legacy.sourceSupplierId && !supplierId) base.warnings.push("Fornecedor do processo ainda não importado (fica só o nome)");
      if (legacy.sourceClientId && !importerClientId) base.warnings.push("Cliente do processo ainda não importado (fica só o nome)");
      if (legacy.sourceProductId && !masterProductId) base.warnings.push("Produto do processo ainda não importado (fica só o nome)");
      const milestones = milestonesFor({ status: String(legacy.values.status), shipmentDate: String(legacy.values.shipmentDate), internalResponsible: String(legacy.values.internalResponsible), responsibleEmail: String(legacy.values.responsibleEmail) }, now, EXPORT_ORDER_MILESTONES);
      const current = milestones.find((item) => item.status === "Em andamento");
      base.adjustments.push(current ? `Etapa atual: ${current.title}` : "Todas as etapas concluídas");

      let targetId: number | null = null;
      if (!dryRun) {
        const insert = { ...legacy.values, organizationId: org, supplierId, importerClientId, masterProductId, propertyIds: JSON.stringify(legacy.propertyIds) } as typeof operations.$inferInsert;
        const [operation] = await db.insert(operations).values(insert).returning();
        targetId = operation.id;
        for (const milestone of milestones) await db.insert(exportMilestones).values({ ...milestone, organizationId: org, operationId: operation.id });
        await audit(context, "PROCESS_IMPORTED", "operation", String(operation.id), { sourceId: legacy.sourceId, reference: legacy.reference });
        if (legacy.sourceId) created.set(legacy.sourceId, operation.id);
      }
      outcomes.push({ ...base, action: "criar", targetId });
    }

    // Registros ligados aos processos criados agora.
    const related = { parceiros: 0, avisos: 0, planos: 0 };
    const target = (row: Record<string, unknown>) => {
      const sourceId = sourceOperationId(row);
      return sourceId ? created.get(sourceId) : undefined;
    };
    const newlyCreated = new Set(outcomes.filter((item) => item.action === "criar").map((item) => item.sourceId));
    for (const row of bundle.partners) {
      if (!newlyCreated.has(sourceOperationId(row))) continue;
      related.parceiros += 1;
      const operationId = target(row);
      if (!dryRun && operationId) await db.insert(operationPartners).values({ organizationId: org, operationId, role: legacyText(row, "role"), companyName: legacyText(row, "companyName"), contactName: legacyText(row, "contactName"), email: legacyText(row, "email"), country: legacyText(row, "country"), ...(legacyText(row, "createdAt") ? { createdAt: legacyText(row, "createdAt") } : {}) });
    }
    for (const row of bundle.shipmentAdvices) {
      if (!newlyCreated.has(sourceOperationId(row))) continue;
      related.avisos += 1;
      const operationId = target(row);
      if (!dryRun && operationId) await db.insert(shipmentAdvices).values({
        organizationId: org, operationId, status: legacyText(row, "status") || "Rascunho", recipient: legacyText(row, "recipient"), subject: legacyText(row, "subject"), body: legacyText(row, "body"),
        paymentRequest: legacyText(row, "paymentRequest"), documentIdsJson: legacyText(row, "documentIdsJson") || "[]", checklistJson: legacyText(row, "checklistJson") || "[]",
        humanApproved: Boolean(Number(row.humanApproved) || row.humanApproved === true), approvedBy: legacyText(row, "approvedBy"), approvedAt: legacyText(row, "approvedAt") || null, sentAt: legacyText(row, "sentAt") || null,
        ...(legacyText(row, "createdAt") ? { createdAt: legacyText(row, "createdAt") } : {}),
      } as never);
    }
    for (const row of bundle.industrialPlans) {
      if (!newlyCreated.has(sourceOperationId(row))) continue;
      related.planos += 1;
      const operationId = target(row);
      if (!dryRun && operationId) await db.insert(industrialPlans).values({
        organizationId: org, operationId, periodStart: legacyText(row, "periodStart"), periodEnd: legacyText(row, "periodEnd"), receivingLots: legacyText(row, "receivingLots"),
        openingStockKg: legacyNumber(row, "openingStockKg"), rawMaterialReceivedKg: legacyNumber(row, "rawMaterialReceivedKg"), rawMaterialConsumedKg: legacyNumber(row, "rawMaterialConsumedKg"),
        pelletsProducedKg: legacyNumber(row, "pelletsProducedKg"), closingStockKg: legacyNumber(row, "closingStockKg"), productionLots: legacyText(row, "productionLots"), notes: legacyText(row, "notes"), status: legacyText(row, "status") || "Em elaboração",
      } as never);
    }

    const summary = {
      total: outcomes.length,
      criar: outcomes.filter((item) => item.action === "criar").length,
      completar: 0,
      existentes: outcomes.filter((item) => item.action === "já existe").length,
      ignorados: outcomes.filter((item) => item.action === "ignorado").length,
      florestas: propertiesCreated,
      ...related,
    };
    if (!dryRun) await audit(context, "PROCESS_IMPORT_FINISHED", "operation", "import", { ...summary, mapping: outcomes.filter((item) => item.targetId).map((item) => [item.sourceId, item.targetId]) });
    return Response.json({ dryRun, organization: context.organizationName, summary, outcomes, notes: propertyNotes });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("PROCESS_IMPORT_FAILED", error);
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao importar processos." }, { status: 500 });
  }
}

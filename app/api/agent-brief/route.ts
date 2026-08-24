import { asc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { exportMilestones, operations } from "../../../db/schema";
import { requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

export async function GET() {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const db = await getDb();
    const [operationRows, milestoneRows] = await Promise.all([
      db.select().from(operations).where(eq(operations.organizationId, context.organizationId)).orderBy(asc(operations.shipmentDate)).limit(250),
      db.select().from(exportMilestones).where(eq(exportMilestones.organizationId, context.organizationId)).orderBy(asc(exportMilestones.sequence)).limit(5000),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const items = operationRows.map((operation) => {
      const milestones = milestoneRows.filter((milestone) => milestone.operationId === operation.id);
      const active = milestones.filter((milestone) => milestone.status !== "Concluído");
      const current = active[0] ?? null;
      const missingPlan = active.filter((milestone) => !milestone.responsibleName || !milestone.dueDate || !milestone.nextAction);
      const overdue = active.filter((milestone) => milestone.dueDate && milestone.dueDate < today);
      return {
        operationId: operation.id,
        reference: operation.reference,
        product: operation.product,
        supplierName: operation.supplierName,
        destinationCountry: operation.destinationCountry,
        importer: operation.euImporter,
        responsible: operation.internalResponsible,
        shipmentDate: operation.shipmentDate,
        readiness: operation.readiness,
        eudrReference: operation.eudrReference,
        currentStage: current ? { code: current.code, title: current.title, status: current.status, dueDate: current.dueDate, nextAction: current.nextAction } : null,
        alerts: {
          overdue: overdue.map((milestone) => ({ code: milestone.code, title: milestone.title, dueDate: milestone.dueDate, responsible: milestone.responsibleName })),
          missingPlan: missingPlan.map((milestone) => milestone.code),
        },
      };
    });
    return Response.json({
      schemaVersion: 1,
      source: "ExportaTrust",
      organization: { id: context.organizationId, name: context.organizationName },
      generatedAt: new Date().toISOString(),
      summary: {
        operations: items.length,
        overdueStages: items.reduce((sum, item) => sum + item.alerts.overdue.length, 0),
        stagesMissingPlan: items.reduce((sum, item) => sum + item.alerts.missingPlan.length, 0),
        eudrReady: items.filter((item) => item.readiness >= 100).length,
      },
      operations: items,
    }, { headers: { "cache-control": "no-store", "x-exportatrust-agent-schema": "1" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

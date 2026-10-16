import { desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { exportMilestones, operationTasks, operations } from "../../../db/schema";
import { EXPORT_ORDER_MILESTONES, isEudrRequired } from "../../../lib/export-control";
import { ORDER_PHASES, currentPhaseIndex, isClosedStatus, phaseIndexOfCode } from "../../../lib/order-phases";
import { requireSecurityContext } from "../../../lib/security";
import { readOrderTerms } from "../../../lib/order-terms";
import { parseLogisticsCosts } from "../../../lib/logistics-costs";
import { containerCount } from "../../../lib/dashboard";

// Visão consolidada para o Painel e a lista de Pedidos da interface nova:
// fase atual de cada pedido, próximo passo e pendências com prazo.

type Pending = {
  operationId: number;
  reference: string;
  kind: "etapa" | "tarefa";
  what: string;
  detail: string;
  due: string;
  who: string;
  late: boolean;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const db = await getDb();
    const [operationRows, milestoneRows, taskRows] = await Promise.all([
      db.select().from(operations).where(eq(operations.organizationId, context.organizationId)).orderBy(desc(operations.id)).limit(500),
      db.select().from(exportMilestones).where(eq(exportMilestones.organizationId, context.organizationId)),
      db.select().from(operationTasks).where(eq(operationTasks.organizationId, context.organizationId)),
    ]);
    const now = today();
    const milestonesByOperation = new Map<number, typeof milestoneRows>();
    for (const milestone of milestoneRows) {
      const list = milestonesByOperation.get(milestone.operationId) ?? [];
      list.push(milestone);
      milestonesByOperation.set(milestone.operationId, list);
    }
    const tasksByOperation = new Map<number, typeof taskRows>();
    for (const task of taskRows) {
      const list = tasksByOperation.get(task.operationId) ?? [];
      list.push(task);
      tasksByOperation.set(task.operationId, list);
    }

    const pending: Pending[] = [];
    const rows = operationRows.map((operation) => {
      const milestones = (milestonesByOperation.get(operation.id) ?? []).sort((a, b) => a.sequence - b.sequence);
      const tasks = (tasksByOperation.get(operation.id) ?? []).sort((a, b) => a.sequence - b.sequence);
      const phaseIndex = currentPhaseIndex(milestones);
      const openMilestones = milestones.filter((milestone) => !isClosedStatus(milestone.status));
      const openTasks = tasks.filter((task) => task.status !== "Concluído");

      const isCancelled = Boolean(readOrderTerms(operation).cancelled || readOrderTerms(operation).completed);
      for (const milestone of isCancelled ? [] : openMilestones) {
        if (!milestone.dueDate) continue;
        pending.push({ operationId: operation.id, reference: operation.reference, kind: "etapa", what: milestone.title, detail: milestone.nextAction !== EXPORT_ORDER_MILESTONES.find((item) => item.code === milestone.code)?.description ? milestone.nextAction : "", due: milestone.dueDate, who: milestone.responsibleName, late: milestone.dueDate.slice(0, 10) < now });
      }
      for (const task of isCancelled ? [] : openTasks) {
        if (!task.dueDate) continue;
        pending.push({ operationId: operation.id, reference: operation.reference, kind: "tarefa", what: task.description, detail: task.note, due: task.dueDate, who: task.responsibleName, late: task.dueDate.slice(0, 10) < now });
      }

      const nextMilestone = openMilestones[0];
      const nextTask = openTasks[0];
      // Mostra o nome da etapa; a próxima ação só quando foi escrita pela equipe (não o texto padrão).
      const defaultAction = nextMilestone ? EXPORT_ORDER_MILESTONES.find((item) => item.code === nextMilestone.code)?.description : "";
      const next = nextMilestone
        ? { what: nextMilestone.title, detail: nextMilestone.nextAction && nextMilestone.nextAction !== defaultAction ? nextMilestone.nextAction : "", due: nextMilestone.dueDate, who: nextMilestone.responsibleName }
        : nextTask ? { what: nextTask.description, detail: nextTask.note, due: nextTask.dueDate, who: nextTask.responsibleName } : null;
      const phaseSteps = ORDER_PHASES.map((phase) => {
        const inPhase = milestones.filter((milestone) => phaseIndexOfCode(milestone.code) === ORDER_PHASES.indexOf(phase));
        return { total: inPhase.length, done: inPhase.filter((milestone) => isClosedStatus(milestone.status)).length };
      });
      const blockedMilestone = openMilestones.find((milestone) => milestone.status === "Bloqueado");
      const blocked = Boolean(blockedMilestone);
      const terms = readOrderTerms(operation);
      let exchangeRate = 0;
      try { exchangeRate = parseLogisticsCosts(operation.logisticsCostsJson).exchangeRate || 0; } catch { exchangeRate = 0; }
      return {
        id: operation.id,
        reference: operation.reference,
        product: operation.product,
        hsCode: operation.hsCode,
        client: operation.euImporter,
        importerClientId: operation.importerClientId,
        country: operation.destinationCountry,
        supplierName: operation.supplierName,
        supplierId: operation.supplierId,
        masterProductId: operation.masterProductId,
        propertyIds: operation.propertyIds,
        status: operation.status,
        phaseIndex,
        phaseName: ORDER_PHASES[phaseIndex].name,
        phaseSteps,
        blocked,
        next: next ? { ...next, late: Boolean(next.due && next.due.slice(0, 10) < now) } : null,
        etd: operation.shipmentDate,
        route: [operation.portOfLoading, operation.portOfDischarge].filter(Boolean).join(" → "),
        value: operation.commercialValue,
        currency: operation.currency,
        quantity: operation.quantity,
        quantityUnit: operation.quantityUnit,
        eudrRequired: isEudrRequired(operation.destinationCountry, operation.hsCode, operation.product),
        readiness: operation.readiness,
        createdAt: operation.createdAt,
        contractNumber: operation.contractNumber,
        exporterName: operation.exporterName,
        incoterm: operation.incoterm,
        portOfLoading: operation.portOfLoading,
        portOfDischarge: operation.portOfDischarge,
        terms,
        cancelled: Boolean(terms.cancelled),
        completed: Boolean(terms.completed),
        // Painel (dashboard): volume dos itens do pedido, câmbio do processo e contêineres informados.
        // Sem itens nem volume informado, a quantidade só vale como m³ se a unidade for m³ (não contêineres/MT).
        volume: !operation.volumeM3 && terms.items.length === 1 && terms.items[0].volume === operation.quantity && !/m[³3]/i.test(operation.quantityUnit) ? 0
          : Math.round(terms.items.reduce((sum, item) => sum + (Number(item.volume) || 0), 0) * 1000) / 1000,
        exchangeRate,
        containers: containerCount(operation.containerNumbers, operation.quantity, operation.quantityUnit),
        completedAt: terms.completed?.at ?? "",
        blockedStep: blockedMilestone ? { what: blockedMilestone.title, who: blockedMilestone.responsibleName } : null,
      };
    });

    pending.sort((a, b) => a.due.localeCompare(b.due));
    const phaseCounts = ORDER_PHASES.map((phase, index) => ({
      name: phase.name,
      count: rows.filter((row) => !row.cancelled && !row.completed && row.phaseIndex === index).length,
      blocked: rows.filter((row) => !row.cancelled && !row.completed && row.phaseIndex === index && row.blocked).length,
    }));
    return Response.json({ operations: rows, pending: pending.slice(0, 200), phaseCounts, today: now }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao montar o painel." }, { status: 500 });
  }
}

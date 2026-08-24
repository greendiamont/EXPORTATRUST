import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { asanaImportCandidates, exportMilestones, operations, suppliers } from "../../../db/schema";
import { requireAsanaImportContext } from "../../../lib/asana-import-security";
import { asanaMilestoneForSection, asanaReferenceKey, classifyAsanaCandidate, parseAsanaOperation, VLP_ASANA_PROJECT } from "../../../lib/asana-migration";
import { EXPORT_ORDER_MILESTONES } from "../../../lib/export-control";
import { audit, requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

function text(value: unknown, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function snapshot(rows: Array<typeof asanaImportCandidates.$inferSelect>) {
  return {
    project: VLP_ASANA_PROJECT,
    summary: {
      total: rows.length,
      review: rows.filter((row) => row.importStatus === "Aguardando revisão").length,
      ignored: rows.filter((row) => row.importStatus.startsWith("Ignorado")).length,
      approved: rows.filter((row) => row.importStatus === "Aprovado para migração").length,
      missingOwner: rows.filter((row) => JSON.parse(row.attentionReasonsJson || "[]").includes("Sem responsável")).length,
      missingDueDate: rows.filter((row) => JSON.parse(row.attentionReasonsJson || "[]").includes("Sem prazo")).length,
    },
    candidates: rows,
  };
}

export async function GET() {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const db = await getDb();
    const rows = await db.select().from(asanaImportCandidates).where(and(
      eq(asanaImportCandidates.organizationId, context.organizationId),
      eq(asanaImportCandidates.sourceProjectId, VLP_ASANA_PROJECT.id),
    )).orderBy(desc(asanaImportCandidates.updatedAt)).limit(500);
    return Response.json(snapshot(rows), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAsanaImportContext(request);
    await ensureBaseTables();
    const body = await request.json() as Record<string, unknown>;
    const sourceProjectId = text(body.sourceProjectId, 40);
    if (sourceProjectId !== VLP_ASANA_PROJECT.id) {
      return Response.json({ error: "Somente o projeto VLP EXPORTAÇÃO está autorizado para esta migração." }, { status: 400 });
    }
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 250) as Array<Record<string, unknown>> : [];
    if (!candidates.length) return Response.json({ error: "Nenhuma tarefa foi recebida para revisão." }, { status: 400 });
    const db = await getDb();
    const now = new Date().toISOString();
    let accepted = 0;
    for (const candidate of candidates) {
      const taskGid = text(candidate.taskGid, 40);
      const name = text(candidate.name, 300);
      if (!taskGid || !name) continue;
      const sectionName = text(candidate.sectionName, 120);
      const parentTaskGid = text(candidate.parentTaskGid, 40);
      const assigneeName = text(candidate.assigneeName, 160);
      const dueDate = text(candidate.dueDate, 20);
      const completed = Boolean(candidate.completed);
      const sourceStatus = text(candidate.sourceStatus, 100);
      const classification = classifyAsanaCandidate({ name, sectionName, sourceStatus, parentTaskGid, dueDate, assigneeName, completed });
      await db.insert(asanaImportCandidates).values({
        organizationId: context.organizationId,
        sourceProjectId,
        sourceProjectName: VLP_ASANA_PROJECT.name,
        taskGid,
        parentTaskGid,
        name,
        sectionName,
        assigneeName,
        assigneeEmail: text(candidate.assigneeEmail, 200).toLowerCase(),
        dueDate,
        completed,
        sourceStatus,
        notes: text(candidate.notes, 12000),
        sourceUrl: text(candidate.sourceUrl, 800),
        modifiedAt: text(candidate.modifiedAt, 40),
        proposedMilestoneCode: classification.proposedMilestoneCode,
        attentionReasonsJson: JSON.stringify(classification.attentionReasons),
        importStatus: classification.importStatus,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [asanaImportCandidates.organizationId, asanaImportCandidates.sourceProjectId, asanaImportCandidates.taskGid],
        set: {
          parentTaskGid,
          name,
          sectionName,
          assigneeName,
          assigneeEmail: text(candidate.assigneeEmail, 200).toLowerCase(),
          dueDate,
          completed,
          sourceStatus,
          notes: text(candidate.notes, 12000),
          sourceUrl: text(candidate.sourceUrl, 800),
          modifiedAt: text(candidate.modifiedAt, 40),
          proposedMilestoneCode: classification.proposedMilestoneCode,
          attentionReasonsJson: JSON.stringify(classification.attentionReasons),
          importStatus: classification.importStatus,
          updatedAt: now,
        },
      });
      accepted += 1;
    }
    let imported = 0;
    let linked = 0;
    const importOperations = body.importOperations === true;
    if (importOperations) {
      if (!["administrador", "analista", "cliente"].includes(context.role)) return Response.json({ error: "Seu perfil não pode importar operações." }, { status: 403 });
      const [stagedRows, existingOperations, supplierRows] = await Promise.all([
        db.select().from(asanaImportCandidates).where(and(eq(asanaImportCandidates.organizationId, context.organizationId), eq(asanaImportCandidates.sourceProjectId, sourceProjectId))).limit(500),
        db.select().from(operations).where(eq(operations.organizationId, context.organizationId)).limit(500),
        db.select().from(suppliers).where(eq(suppliers.organizationId, context.organizationId)).limit(500),
      ]);
      const operationByReference = new Map(existingOperations.map((operation) => [asanaReferenceKey(operation.reference), operation]));
      for (const row of stagedRows) {
        const currentCode = asanaMilestoneForSection(row.sectionName);
        if (row.completed || row.parentTaskGid || row.sourceStatus.toLocaleLowerCase("pt-BR") !== "ativo" || !currentCode || row.importStatus.startsWith("Ignorado") || row.importStatus.startsWith("Em espera")) continue;
        const parsed = parseAsanaOperation({
          taskGid: row.taskGid,
          name: row.name,
          notes: row.notes,
          sectionName: row.sectionName,
          assigneeName: row.assigneeName,
          assigneeEmail: row.assigneeEmail,
          dueDate: row.dueDate,
          sourceUrl: row.sourceUrl,
        });
        let operation = operationByReference.get(asanaReferenceKey(parsed.reference));
        let created = false;
        if (!operation) {
          const supplier = supplierRows.find((item) => asanaReferenceKey(item.legalName).includes(asanaReferenceKey(parsed.supplierName)) || asanaReferenceKey(parsed.supplierName).includes(asanaReferenceKey(item.legalName)));
          [operation] = await db.insert(operations).values({
            organizationId: context.organizationId,
            ...parsed,
            supplierId: supplier?.id ?? null,
            supplierName: supplier?.legalName ?? parsed.supplierName,
            exporterName: parsed.exporterName || supplier?.legalName || "A confirmar",
            exporterTaxId: supplier?.taxId ?? "",
            commercialValue: 0,
            grossWeightKg: 0,
            netWeightKg: 0,
            volumeM3: 0,
            propertyIds: "[]",
            portOfLoading: "",
            bookingNumber: "",
            containerNumbers: "",
            euOperatorEori: "",
            eudrReference: "",
          }).returning();
          operationByReference.set(asanaReferenceKey(operation.reference), operation);
          created = true;
        }
        const existingMilestones = await db.select({ code: exportMilestones.code }).from(exportMilestones).where(and(eq(exportMilestones.organizationId, context.organizationId), eq(exportMilestones.operationId, operation.id))).limit(100);
        const existingCodes = new Set(existingMilestones.map((milestone) => milestone.code));
        const currentSequence = EXPORT_ORDER_MILESTONES.find((milestone) => milestone.code === currentCode)?.sequence ?? 1;
        for (const milestone of EXPORT_ORDER_MILESTONES.filter((item) => !existingCodes.has(item.code))) {
          await db.insert(exportMilestones).values({
              organizationId: context.organizationId,
              operationId: operation.id,
              code: milestone.code,
              sequence: milestone.sequence,
              title: milestone.title,
              category: milestone.category,
              status: milestone.sequence === currentSequence ? "Em andamento" : milestone.sequence < currentSequence ? "Aguardando validação" : "Pendente",
              responsibleName: row.assigneeName,
              responsibleEmail: row.assigneeEmail,
              dueDate: milestone.sequence === currentSequence ? (row.dueDate || parsed.shipmentDate) : "",
              nextAction: milestone.description,
              note: milestone.sequence === currentSequence ? `Etapa importada do Asana: ${row.sourceUrl}` : "",
              shipmentApproval: milestone.code === "SHIPMENT_APPROVAL" ? "Pendente" : "Não aplicável",
            }).onConflictDoNothing();
        }
        if (created) imported += 1;
        else linked += 1;
        await db.update(asanaImportCandidates).set({ importStatus: "Importado", matchedOperationId: operation.id, reviewedAt: now, updatedAt: now }).where(and(eq(asanaImportCandidates.id, row.id), eq(asanaImportCandidates.organizationId, context.organizationId)));
      }
      await audit(context, "ASANA_OPERATIONS_IMPORTED", "asana_project", sourceProjectId, { imported, linked, projectName: VLP_ASANA_PROJECT.name });
    }
    await audit(context, "ASANA_IMPORT_STAGED", "asana_project", sourceProjectId, { accepted, projectName: VLP_ASANA_PROJECT.name });
    const rows = await db.select().from(asanaImportCandidates).where(and(
      eq(asanaImportCandidates.organizationId, context.organizationId),
      eq(asanaImportCandidates.sourceProjectId, sourceProjectId),
    )).orderBy(desc(asanaImportCandidates.updatedAt)).limit(500);
    return Response.json({ ...snapshot(rows), accepted, imported, linked });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

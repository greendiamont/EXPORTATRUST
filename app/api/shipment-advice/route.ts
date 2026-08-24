import { and, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { exportControlSettings, operationDocuments, operations, shipmentAdvices, suppliers } from "../../../db/schema";
import { buildShipmentAdvice } from "../../../lib/shipment-documents";
import { audit, requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

async function ensureSupplierBankDetails() {
  const { env } = await import("cloudflare:workers");
  const info = await env.DB.prepare("PRAGMA table_info(suppliers)").all<{ name: string }>();
  const names = new Set((info.results ?? []).map((column) => column.name));
  if (!names.has("bank_details")) await env.DB.prepare("ALTER TABLE suppliers ADD bank_details text DEFAULT '' NOT NULL").run();
}

async function snapshot(operationId: number, organizationId: number) {
  await ensureSupplierBankDetails();
  const db = await getDb();
  const [operation, documents, settings, advice] = await Promise.all([
    db.select().from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, organizationId))).limit(1),
    db.select().from(operationDocuments).where(and(eq(operationDocuments.operationId, operationId), eq(operationDocuments.organizationId, organizationId))).limit(1000),
    db.select().from(exportControlSettings).where(and(eq(exportControlSettings.operationId, operationId), eq(exportControlSettings.organizationId, organizationId))).limit(1),
    db.select().from(shipmentAdvices).where(and(eq(shipmentAdvices.operationId, operationId), eq(shipmentAdvices.organizationId, organizationId))).limit(1),
  ]);
  if (!operation[0]) throw new Error("Processo não encontrado.");
  const supplier = operation[0].supplierId ? (await db.select().from(suppliers).where(and(eq(suppliers.id, operation[0].supplierId), eq(suppliers.organizationId, organizationId))).limit(1))[0] : null;
  const generated = buildShipmentAdvice(
    { ...operation[0], supplierBankDetails: supplier?.bankDetails || "" },
    documents,
    { name: settings[0]?.customerName || operation[0].euImporter, email: settings[0]?.customerEmail || "" }
  );
  return { advice: advice[0] ?? null, documents, generated, complete: generated.checklist.filter((item) => item.required).every((item) => item.present) };
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const operationId = Number(new URL(request.url).searchParams.get("operationId"));
    if (!operationId) return Response.json({ error: "Processo inválido." }, { status: 400 });
    return Response.json(await snapshot(operationId, context.organizationId));
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    const body = await request.json() as { operationId?: number; action?: string };
    const operationId = Number(body.operationId);
    if (!operationId || body.action !== "regenerate") return Response.json({ error: "Ação inválida." }, { status: 400 });
    const current = await snapshot(operationId, context.organizationId);
    const db = await getDb();
    const values = {
      organizationId: context.organizationId,
      operationId,
      status: "Rascunho · revisão humana",
      recipient: current.generated.recipient,
      subject: current.generated.subject,
      body: current.generated.body,
      paymentRequest: "Solicitar pagamento do saldo e comprovante SWIFT / MT103.",
      documentIdsJson: JSON.stringify(current.generated.included.map((document) => document.id)),
      checklistJson: JSON.stringify(current.generated.checklist),
      humanApproved: false,
      approvedBy: "",
      approvedAt: null,
      sentAt: null,
      updatedAt: new Date().toISOString(),
    };
    await db.insert(shipmentAdvices).values(values).onConflictDoUpdate({ target: [shipmentAdvices.organizationId, shipmentAdvices.operationId], set: values });
    await audit(context, "SHIPMENT_ADVICE_DRAFT_REGENERATED", "operation", String(operationId), { documentCount: current.generated.included.length, complete: current.complete });
    return Response.json(await snapshot(operationId, context.organizationId));
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

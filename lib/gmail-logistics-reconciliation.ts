import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { agentEvents, operations } from "../db/schema";
import { audit, requireSecurityContext } from "./security";

type OperationRow = typeof operations.$inferSelect;
type OperationUpdates = Partial<typeof operations.$inferInsert>;

function toIsoDate(value: string) {
  const match = value.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function clean(value = "") {
  return value.replace(/\s+/g, " ").replace(/[.,;:]+$/g, "").trim();
}

function first(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return "";
}

function parseLogistics(text: string) {
  const normalized = text.replace(/\r/g, " ");
  const booking = first(normalized, [
    /\bbooking(?:\s+(?:confirmado|number|n[ºo.]?))?\s*[:#-]?\s*([A-Z0-9-]{7,})\b/i,
    /\b(SAOG\d{7,})\b/i,
  ]);
  const agentProcess = first(normalized, [/\b(BRZSE\d{6,})\b/i]);
  const vessel = first(normalized, [
    /\bnavio\s*[:=-]\s*([^\n|]{3,50}?)(?=\s+(?:previs[aã]o|draft|vgm|gate|deadline|$))/i,
    /\bvessel\s*[:=-]\s*([^\n|]{3,50}?)(?=\s+(?:voyage|etd|draft|vgm|gate|$))/i,
  ]);
  const voyage = first(normalized, [/\b(?:voyage|viagem)\s*[:=-]\s*([A-Z0-9-]{2,20})\b/i]);
  const carrier = first(normalized, [
    /\barmador\s+(?:informou\s+que\s+)?(?:da\s+)?(ONE)\b/i,
    /\barmador\s*[:=-]\s*(ONE)\b/i,
  ]).toUpperCase();
  const pol = first(normalized, [
    /\b(?:POL|porto(?:\/local)?\s+de\s+embarque)\s*[:=-]\s*([A-ZÀ-Ú][A-ZÀ-Ú\s]{2,35})/i,
    /\bRIO GRANDE\s*-\s*CHENNAI\b/i,
  ]);
  const pod = first(normalized, [
    /\b(?:POD|porto(?:\/local)?\s+de\s+destino)\s*[:=-]\s*([A-ZÀ-Ú][A-ZÀ-Ú\s]{2,35})/i,
  ]);
  const etdRaw = first(normalized, [
    /\bprevis[aã]o\s+de\s+sa[ií]da\s*[:=-]\s*(\d{2}\/\d{2}\/\d{4})/i,
    /\bETD\s*[:=-]\s*(\d{2}\/\d{2}\/\d{4})/i,
  ]);
  const draftDeadline = first(normalized, [/\bdraft\s+(?:HBL|BL)?\s*[:=-]\s*(\d{2}\/\d{2}\/\d{4}(?:\s+\d{1,2}:\d{2})?)/i]);
  const vgmDeadline = first(normalized, [/\bVGM\s*[:=-]\s*(\d{2}\/\d{2}\/\d{4}(?:\s+\d{1,2}:\d{2})?)/i]);
  const gateIn = first(normalized, [/\bgate\s*in\s*[:=-]\s*(\d{2}\/\d{2}\/\d{4}(?:\s+\d{1,2}:\d{2})?)/i]);
  const customsRelease = first(normalized, [/\blibera[cç][aã]o\s+aduaneira\s*[:=-]\s*(\d{2}\/\d{2}\/\d{4}(?:\s+\d{1,2}:\d{2})?)/i]);
  const carrierDraftDeadline = first(normalized, [/\bdeadline\s+(?:de\s+)?draft\s+(?:com\s+o\s+)?armador\s+One\s+(?:é|e)\s+dia\s+(\d{2}\/\d{2}(?:\/\d{4})?\s+\d{1,2}:\d{2})/i]);
  const equipmentPickupContract = first(normalized, [/\b(?:numero|n[uú]mero)\s+contrato\s*[:=-]\s*([A-Z0-9-]{5,30})\b/i]);
  const portalAvailable = /armador\s+informou\s+que\s+h[aá]\s+disponibilidade\s+no\s+portal/i.test(normalized);
  const emptyPickupBlocked = /booking\s+ainda\s+n[aã]o\s+est[aá]\s+liberado\s+para\s+levante/i.test(normalized);

  return {
    booking,
    agentProcess,
    vessel,
    voyage,
    carrier,
    pol: /RIO GRANDE\s*-\s*CHENNAI/i.test(normalized) ? "RIO GRANDE" : pol,
    pod: /RIO GRANDE\s*-\s*CHENNAI/i.test(normalized) ? "CHENNAI" : pod,
    etd: toIsoDate(etdRaw),
    draftDeadline,
    vgmDeadline,
    gateIn,
    customsRelease,
    carrierDraftDeadline,
    equipmentPickupContract,
    portalAvailable,
    emptyPickupBlocked,
  };
}

function buildOperationalNote(parsed: ReturnType<typeof parseLogistics>) {
  const facts = [
    parsed.agentProcess && `Processo agente: ${parsed.agentProcess}`,
    parsed.draftDeadline && `Draft HBL: ${parsed.draftDeadline}`,
    parsed.vgmDeadline && `VGM: ${parsed.vgmDeadline}`,
    parsed.carrierDraftDeadline && `Deadline armador: ${parsed.carrierDraftDeadline}`,
    parsed.gateIn && `Gate In: ${parsed.gateIn}`,
    parsed.customsRelease && `Liberação aduaneira: ${parsed.customsRelease}`,
    parsed.equipmentPickupContract && `Contrato retirada: ${parsed.equipmentPickupContract}`,
    parsed.portalAvailable && "Status equipamentos: disponibilidade informada no portal do armador",
    parsed.emptyPickupBlocked && "Status equipamentos: booking ainda não liberado para levante dos vazios",
  ].filter(Boolean);
  return facts.join(" | ");
}

function mergeAutoNote(existing: string, newNote: string) {
  if (!newNote) return existing;
  const marker = "[GMAIL LOGÍSTICA]";
  const withoutOld = existing
    .split("\n")
    .filter((line) => !line.trim().startsWith(marker))
    .join("\n")
    .trim();
  return [withoutOld, `${marker} ${newNote}`].filter(Boolean).join("\n");
}

function setIfChanged(updates: OperationUpdates, row: OperationRow, field: keyof OperationUpdates, value: string) {
  if (!value) return;
  if (String(row[field as keyof OperationRow] ?? "") === value) return;
  (updates as Record<string, unknown>)[field as string] = value;
  (row as unknown as Record<string, unknown>)[field as string] = value;
}

export async function reconcileGmailLogistics() {
  const context = await requireSecurityContext("write");
  const db = await getDb();
  const rows = await db
    .select()
    .from(agentEvents)
    .where(and(eq(agentEvents.organizationId, context.organizationId), eq(agentEvents.source, "gmail"), eq(agentEvents.matchConfidence, "HIGH")))
    .orderBy(desc(agentEvents.id))
    .limit(300);

  const operationRows = await db.select().from(operations).where(eq(operations.organizationId, context.organizationId)).limit(1000);
  const byId = new Map(operationRows.map((operation) => [operation.id, operation]));
  let updated = 0;

  for (const event of [...rows].reverse()) {
    if (!event.matchedOperationId) continue;
    const operation = byId.get(event.matchedOperationId);
    if (!operation) continue;
    const parsed = parseLogistics(`${event.subject}\n${event.summary}`);
    const updates: OperationUpdates = {};

    setIfChanged(updates, operation, "bookingNumber", parsed.booking);
    setIfChanged(updates, operation, "carrier", parsed.carrier);
    setIfChanged(updates, operation, "portOfLoading", parsed.pol);
    setIfChanged(updates, operation, "portOfDischarge", parsed.pod);
    setIfChanged(updates, operation, "shipmentDate", parsed.etd);
    if (parsed.vessel) setIfChanged(updates, operation, "vesselVoyage", parsed.voyage ? `${parsed.vessel} / ${parsed.voyage}` : parsed.vessel);

    const operationalNote = buildOperationalNote(parsed);
    if (operationalNote) {
      const nextNotes = mergeAutoNote(operation.supplyChainNotes, operationalNote);
      setIfChanged(updates, operation, "supplyChainNotes", nextNotes);
    }

    if (!Object.keys(updates).length) continue;
    await db.update(operations).set(updates).where(and(eq(operations.id, operation.id), eq(operations.organizationId, context.organizationId)));
    await audit(context, "GMAIL_STAGE07_LOGISTICS_RECONCILED", "operation", String(operation.id), {
      gmailEventId: event.eventId,
      reference: operation.reference,
      updates,
      rule: "Gate In e deadlines nunca alimentam shipmentDate; somente ETD/Previsão de Saída pode alterar a data prevista de embarque.",
    });
    updated += 1;
  }

  return { updated };
}

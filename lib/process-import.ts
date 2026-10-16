// Conversão dos processos do app antigo (backup "Portable Export" ou exportação integral)
// para o app novo. Funções puras: nada aqui grava no banco.
//
// O backup de 2026-09-29 não trazia as etapas (export_milestones). Elas são recriadas a
// partir do status que o processo tinha no app antigo: etapas anteriores ficam
// "Concluído", a etapa atual "Em andamento" e as seguintes "Pendente".

type Row = Record<string, unknown>;

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value)).trim();
const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const pick = (row: Row, key: string) => row[key] ?? row[snake(key)];
const str = (row: Row, key: string) => text(pick(row, key));
const num = (row: Row, key: string) => {
  const value = Number(pick(row, key));
  return Number.isFinite(value) ? value : 0;
};
const id = (row: Row, key: string) => {
  const value = Number(pick(row, key));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};

export const OPERATION_TEXT_FIELDS = [
  "reference", "product", "hsCode", "destinationCountry", "euImporter", "supplierName", "shipmentDate", "exporterName", "exporterTaxId",
  "internalResponsible", "responsibleEmail", "contractNumber", "incoterm", "currency", "quantityUnit", "lotCodes", "rawMaterial", "species",
  "forestOriginType", "productionUnit", "productionLocation", "transportMode", "portOfLoading", "portOfDischarge", "carrier", "bookingNumber",
  "billOfLadingNumber", "containerNumbers", "vesselVoyage", "euOperatorEori", "eudrReference", "supplyChainNotes", "status", "createdAt",
] as const;
export const OPERATION_NUMBER_FIELDS = ["commercialValue", "quantity", "grossWeightKg", "netWeightKg", "volumeM3", "readiness"] as const;

export type LegacyOperation = {
  sourceId: number | null;
  reference: string;
  sourceSupplierId: number | null;
  sourceClientId: number | null;
  sourceProductId: number | null;
  propertyIds: string[];
  values: Record<string, string | number>;
};

function list(payload: unknown, names: string[]): Row[] {
  const root = payload && typeof payload === "object" ? payload as Row : {};
  for (const holder of [root.data, root.tables, root]) {
    if (!holder || typeof holder !== "object") continue;
    for (const name of names) {
      const value = (holder as Row)[name];
      if (Array.isArray(value)) return value.filter((row): row is Row => !!row && typeof row === "object");
    }
  }
  return [];
}

export function extractProcessBundle(payload: unknown) {
  return {
    operations: list(payload, ["operations"]),
    properties: list(payload, ["properties", "rural_properties", "ruralProperties"]),
    partners: list(payload, ["partners", "operation_partners", "operationPartners"]),
    shipmentAdvices: list(payload, ["shipmentAdvices", "shipment_advices"]),
    industrialPlans: list(payload, ["industrialPlans", "industrial_plans"]),
  };
}

export function convertOperation(row: Row): LegacyOperation {
  const values: Record<string, string | number> = {};
  for (const key of OPERATION_TEXT_FIELDS) values[key] = str(row, key);
  for (const key of OPERATION_NUMBER_FIELDS) values[key] = num(row, key);
  if (!values.status) values.status = "Cadastro inicial";
  if (!values.createdAt) delete values.createdAt;
  let propertyIds: string[] = [];
  try {
    const parsed = JSON.parse(str(row, "propertyIds") || "[]");
    propertyIds = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch { /* lista inválida no app antigo: fica vazia */ }
  return {
    sourceId: id(row, "id"),
    reference: text(values.reference),
    sourceSupplierId: id(row, "supplierId"),
    sourceClientId: id(row, "importerClientId"),
    sourceProductId: id(row, "masterProductId"),
    propertyIds,
    values,
  };
}

/** Sequência da etapa em andamento conforme o status do app antigo; 15 = todas concluídas. */
export function currentMilestoneSequence(status: string) {
  const value = status.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/conclu|entregue|pos-venda|pos venda|finaliz/.test(value)) return 15;
  if (/chegada|destino/.test(value)) return 13;
  if (/transito/.test(value)) return 12;
  if (/embarcad/.test(value)) return 12;
  if (/despacho|porto/.test(value)) return 10;
  if (/documenta|set documental/.test(value)) return 9;
  if (/estufagem/.test(value)) return 8;
  if (/booking/.test(value)) return 7;
  if (/qualidade/.test(value)) return 5;
  if (/produc/.test(value)) return 4;
  if (/pedido confirmado|origem|eudr/.test(value)) return 2;
  return 1;
}

type MilestoneDefinition = { code: string; sequence: number; title: string; category: string; description: string };

export function milestonesFor(operation: { status: string; shipmentDate: string; internalResponsible: string; responsibleEmail: string }, now: string, definitions: readonly MilestoneDefinition[]) {
  const current = currentMilestoneSequence(operation.status);
  return definitions.map((milestone) => {
    const status = milestone.sequence < current ? "Concluído" : milestone.sequence === current ? "Em andamento" : "Pendente";
    return {
      code: milestone.code,
      sequence: milestone.sequence,
      title: milestone.title,
      category: milestone.category,
      status,
      responsibleName: operation.internalResponsible,
      responsibleEmail: operation.responsibleEmail,
      dueDate: milestone.code === "BOOKING" || milestone.code === "SHIPPED" ? operation.shipmentDate : "",
      nextAction: milestone.description,
      shipmentApproval: milestone.code === "SHIPMENT_APPROVAL" ? (status === "Concluído" ? "Aprovado" : "Pendente") : "Não aplicável",
      completedAt: status === "Concluído" ? now : null,
    };
  });
}

export function convertProperty(row: Row) {
  return {
    carCode: str(row, "carCode"),
    name: str(row, "name"),
    city: str(row, "city"),
    supplier: str(row, "supplier"),
    areaHa: num(row, "areaHa"),
    nativeAreaHa: num(row, "nativeAreaHa"),
    status: str(row, "status") || "Em análise",
    risk: str(row, "risk") || "atenção",
    geometryJson: str(row, "geometryJson") || "{}",
    sourceFile: str(row, "sourceFile"),
    ...(str(row, "createdAt") ? { createdAt: str(row, "createdAt") } : {}),
  };
}

export const sourceOperationId = (row: Row) => id(row, "operationId");
export { str as legacyText, num as legacyNumber };

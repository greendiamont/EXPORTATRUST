// Conversão de clientes e produtos do app antigo para o cadastro novo. Funções puras.
//
// Fontes aceitas, nesta ordem:
//  1. tabela completa (exportação integral `tables.importer_clients` / `tables.master_products`,
//     ou `data.importerClients` / `data.masterProducts`, ou uma lista simples);
//  2. sem tabela (backup "Portable Export v2", que não trazia esses cadastros): os dados são
//     reconstruídos a partir dos processos do próprio backup — nome, país, EORI, porto, incoterm,
//     moeda; produto, NCM, espécie, matéria-prima, unidade — e marcados "Pendente".
// Nada é descartado e nada aqui grava no banco.

export type RegistryKind = "clientes" | "produtos";
type Row = Record<string, unknown>;

export type RegistryRecord = {
  sourceId: number | null;
  name: string;
  taxId: string;
  values: Record<string, string | boolean | number[]>;
  /** ids de fornecedores do app antigo (produtos), convertidos depois pelo mapa da importação de fornecedores */
  sourceSupplierIds: number[];
  derived: boolean;
  adjustments: string[];
  warnings: string[];
};

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value)).trim();
const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const pick = (row: Row, key: string) => text(row[key] ?? row[snake(key)]);
const flag = (value: unknown) => value === true || value === 1 || value === "1" || value === "true";
const ids = (value: unknown): number[] => {
  if (Array.isArray(value)) return value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  try { return ids(JSON.parse(text(value) || "[]")); } catch { return []; }
};
const sourceIdOf = (row: Row) => {
  const id = Number(row.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export const CLIENT_FIELDS = ["aliases", "taxId", "taxIdType", "eori", "address", "city", "state", "postalCode", "country", "contactName", "email", "phone", "preferredPort", "paymentTerms", "documentRequirements", "bankDetails", "notifyParty", "preferredIncoterm", "preferredCurrency", "dataStatus"] as const;
export const PRODUCT_TEXT_FIELDS = ["rawMaterial", "species", "scientificName", "hsCode", "dimensionalSpecification", "grade", "moisture", "certifications", "originType", "salesUnit", "packaging", "dataStatus"] as const;

function container(payload: unknown): Row {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Row : {};
}

function tableRows(payload: unknown, kind: RegistryKind): Row[] | null {
  if (Array.isArray(payload)) return payload.filter((row): row is Row => !!row && typeof row === "object");
  const root = container(payload);
  const names = kind === "clientes" ? ["importer_clients", "importerClients", "clients"] : ["master_products", "masterProducts", "products"];
  for (const holder of [root.tables, root.data, root]) {
    const record = container(holder);
    for (const name of names) if (Array.isArray(record[name])) return (record[name] as unknown[]).filter((row): row is Row => !!row && typeof row === "object");
  }
  return null;
}

function cleanCountry(value: string) {
  return /revisar|definir|^-+$/i.test(value) ? "" : value.replace(/\s+[a-z]$/i, "").trim();
}

function mostCommon(values: string[]) {
  const counts = new Map<string, { value: string; count: number }>();
  for (const value of values.filter(Boolean)) {
    const key = value.toLowerCase();
    const entry = counts.get(key) ?? { value, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.value ?? "";
}

/** Último valor preenchido (processos mais recentes primeiro). */
const latest = (rows: Row[], key: string) => rows.map((row) => pick(row, key)).find(Boolean) ?? "";

function auditNames(payload: unknown, prefix: string) {
  const names = new Map<number, string>();
  const trail = container(container(payload).data).auditTrail;
  if (!Array.isArray(trail)) return names;
  for (const event of trail as Row[]) {
    if (!text(event.action).startsWith(prefix)) continue;
    const id = Number(event.entityId);
    let metadata: Row = {};
    try { metadata = JSON.parse(text(event.metadataJson) || "{}"); } catch { /* sem metadados */ }
    const name = text(metadata.legalName ?? metadata.name);
    if (id && name) names.set(id, name); // eventos em ordem: fica o nome mais recente
  }
  return names;
}

function operationsOf(payload: unknown): Row[] {
  const operations = container(container(payload).data).operations;
  return Array.isArray(operations) ? [...(operations as Row[])].sort((a, b) => Number(b.id) - Number(a.id)) : [];
}

function deriveClients(payload: unknown): RegistryRecord[] {
  const officialNames = auditNames(payload, "IMPORTER_CLIENT_");
  const partners = container(container(payload).data).partners;
  const groups = new Map<string, Row[]>();
  for (const operation of operationsOf(payload)) {
    const name = pick(operation, "euImporter");
    const key = Number(operation.importerClientId) ? `id:${Number(operation.importerClientId)}` : `name:${name.toLowerCase()}`;
    if (!name && key.startsWith("name:")) continue;
    groups.set(key, [...(groups.get(key) ?? []), operation]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const sourceId = key.startsWith("id:") ? Number(key.slice(3)) : null;
    const spellings = [...new Set(rows.map((row) => pick(row, "euImporter")).filter(Boolean))];
    const name = (sourceId && officialNames.get(sourceId)) || mostCommon(spellings);
    const aliases = spellings.filter((spelling) => spelling.toLowerCase() !== name.toLowerCase());
    const countries = rows.map((row) => cleanCountry(pick(row, "destinationCountry")));
    const operationIds = new Set(rows.map((row) => Number(row.id)));
    const importerPartner = Array.isArray(partners)
      ? (partners as Row[]).find((partner) => operationIds.has(Number(partner.operationId)) && /importador|importer|cliente/i.test(text(partner.role)))
      : undefined;
    const values: RegistryRecord["values"] = {
      aliases: aliases.join(", "),
      eori: latest(rows, "euOperatorEori").replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
      country: countries.find(Boolean) ?? "",
      preferredPort: latest(rows, "portOfDischarge"),
      preferredIncoterm: latest(rows, "incoterm").toUpperCase(),
      preferredCurrency: latest(rows, "currency").toUpperCase(),
      contactName: importerPartner ? text(importerPartner.contactName) : "",
      email: importerPartner ? text(importerPartner.email).toLowerCase() : "",
      dataStatus: "Pendente",
    };
    const warnings = ["Reconstruído a partir dos processos: endereço, ID fiscal, contato e dados bancários ficam para completar"];
    if (!values.country) warnings.push("País não informado nos processos");
    return { sourceId, name, taxId: "", values, sourceSupplierIds: [], derived: true, adjustments: aliases.length ? [`Outros nomes usados nos processos: ${aliases.join(", ")}`] : [], warnings };
  }).filter((record) => record.name);
}

function deriveProducts(payload: unknown): RegistryRecord[] {
  const groups = new Map<string, Row[]>();
  for (const operation of operationsOf(payload)) {
    const name = pick(operation, "product");
    const key = Number(operation.masterProductId) ? `id:${Number(operation.masterProductId)}` : `name:${name.toLowerCase()}`;
    if (!name && key.startsWith("name:")) continue;
    groups.set(key, [...(groups.get(key) ?? []), operation]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const sourceId = key.startsWith("id:") ? Number(key.slice(3)) : null;
    const name = mostCommon(rows.map((row) => pick(row, "product")));
    const values: RegistryRecord["values"] = {
      hsCode: mostCommon(rows.map((row) => pick(row, "hsCode"))),
      rawMaterial: latest(rows, "rawMaterial"),
      species: latest(rows, "species"),
      originType: latest(rows, "forestOriginType") || "Reflorestamento",
      salesUnit: mostCommon(rows.map((row) => pick(row, "quantityUnit"))),
      dataStatus: "Pendente",
    };
    const suppliers = [...new Set(rows.map((row) => Number(row.supplierId)).filter(Boolean))];
    const warnings = ["Reconstruído a partir dos processos: especificação, embalagem e certificações ficam para completar"];
    const hsCodes = [...new Set(rows.map((row) => pick(row, "hsCode")).filter(Boolean))];
    if (hsCodes.length > 1) warnings.push(`NCMs diferentes nos processos (${hsCodes.join(", ")}); conferir`);
    return { sourceId, name, taxId: "", values, sourceSupplierIds: suppliers, derived: true, adjustments: [], warnings };
  }).filter((record) => record.name);
}

function convertClient(row: Row): RegistryRecord {
  const values: RegistryRecord["values"] = {};
  for (const key of CLIENT_FIELDS) values[key] = pick(row, key);
  values.taxId = text(values.taxId).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  values.eori = text(values.eori).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  values.email = text(values.email).toLowerCase();
  if (!values.taxIdType) values.taxIdType = "VAT";
  if (!values.dataStatus) values.dataStatus = "Verificado";
  const name = pick(row, "legalName");
  return { sourceId: sourceIdOf(row), name, taxId: text(values.taxId), values, sourceSupplierIds: [], derived: false, adjustments: [], warnings: values.country ? [] : ["Sem país"] };
}

function convertProduct(row: Row): RegistryRecord {
  const values: RegistryRecord["values"] = {};
  for (const key of PRODUCT_TEXT_FIELDS) values[key] = pick(row, key);
  values.kd = flag(row.kd);
  values.ht = flag(row.ht);
  if (!values.originType) values.originType = "Reflorestamento";
  if (!values.dataStatus) values.dataStatus = "Verificado";
  return { sourceId: sourceIdOf(row), name: pick(row, "name"), taxId: "", values, sourceSupplierIds: ids(row.eligibleSupplierIds ?? row.eligible_supplier_ids), derived: false, adjustments: [], warnings: [] };
}

export function extractRegistryRecords(payload: unknown, kind: RegistryKind): RegistryRecord[] {
  const rows = tableRows(payload, kind);
  if (rows) return rows.map(kind === "clientes" ? convertClient : convertProduct);
  return kind === "clientes" ? deriveClients(payload) : deriveProducts(payload);
}

/** Campos vazios do cadastro existente que a importação pode completar (nunca sobrescreve). */
export function registryFieldsToComplete(existing: Row, record: RegistryRecord) {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record.values)) {
    if (key === "dataStatus") continue;
    if (typeof value === "boolean") {
      if (value && !existing[key]) changes[key] = true;
      continue;
    }
    if (Array.isArray(value)) continue;
    if (value && !text(existing[key])) changes[key] = value;
  }
  // Cadastro reconstruído vira "Verificado" quando chega a ficha completa do app antigo.
  if (!record.derived && text(existing.dataStatus) === "Pendente" && record.values.dataStatus && record.values.dataStatus !== "Pendente") changes.dataStatus = record.values.dataStatus;
  return changes;
}

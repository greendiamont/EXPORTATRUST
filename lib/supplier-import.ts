// Conversão dos fornecedores do app antigo (exportação "Portable Export", exportação
// integral ou lista simples) para o formato do cadastro novo. Funções puras: nada
// aqui grava no banco. Nenhuma informação é descartada — quando o endereço veio no
// campo "cidade", o texto original vai inteiro para "Endereço".

export type ImportedSupplier = {
  sourceId: number | null;
  legalName: string;
  tradeName: string;
  taxId: string;
  country: string;
  state: string;
  city: string;
  address: string;
  contactName: string;
  email: string;
  phone: string;
  certifications: string;
  aliases: string;
  products: string;
  productionUnits: string;
  bankDetails: string;
  status: string;
  createdAt: string;
};

export type SupplierConversion = {
  supplier: ImportedSupplier;
  adjustments: string[];
  warnings: string[];
};

const FIELDS: Array<[keyof ImportedSupplier, string]> = [
  ["legalName", "legal_name"], ["tradeName", "trade_name"], ["taxId", "tax_id"], ["country", "country"], ["state", "state"],
  ["city", "city"], ["address", "address"], ["contactName", "contact_name"], ["email", "email"], ["phone", "phone"],
  ["certifications", "certifications"], ["aliases", "aliases"], ["products", "products"], ["productionUnits", "production_units"],
  ["bankDetails", "bank_details"], ["status", "status"], ["createdAt", "created_at"],
];

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value)).trim();

/** Aceita a exportação do app antigo (data.suppliers ou tables.suppliers) ou uma lista de fornecedores. */
export function extractSupplierRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const container of [record.data, record.tables, record]) {
    if (container && typeof container === "object" && Array.isArray((container as Record<string, unknown>).suppliers)) {
      return extractSupplierRows((container as Record<string, unknown>).suppliers);
    }
  }
  return [];
}

function pick(row: Record<string, unknown>, camel: string, snake: string) {
  return text(row[camel] ?? row[snake]);
}

/** "RODOVIA BR116 KM 140 - DEP 83800-000 MANDIRITUBA PR'" → "MANDIRITUBA" (o texto inteiro vai para Endereço). */
function cityFromAddress(raw: string, state: string) {
  let city = raw.slice(raw.lastIndexOf(" - ") + 3);
  city = city.replace(/['"`]+/g, " ")
    .replace(/\b\d{5}-?\d{3}\b/g, " ")
    .replace(/\b(DEP|CEP|CP)\b\.?/gi, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (state && city.toUpperCase().endsWith(` ${state.toUpperCase()}`)) city = city.slice(0, -state.length).trim();
  return city;
}

export function convertLegacySupplier(row: Record<string, unknown>, isValidCnpj: (taxId: string) => boolean = () => true): SupplierConversion {
  const supplier = Object.fromEntries(FIELDS.map(([camel, snake]) => [camel, pick(row, camel, snake)])) as unknown as ImportedSupplier;
  const id = Number(row.id);
  supplier.sourceId = Number.isSafeInteger(id) && id > 0 ? id : null;
  const adjustments: string[] = [];
  const warnings: string[] = [];

  // Endereço digitado no campo cidade (tem número e separador " - "): preserva tudo em Endereço.
  if (!supplier.address && /\d/.test(supplier.city) && supplier.city.includes(" - ")) {
    const original = supplier.city;
    supplier.address = original;
    const city = cityFromAddress(original, supplier.state);
    if (city) supplier.city = city;
    adjustments.push(`Endereço separado da cidade: "${original}" → endereço completo; cidade "${supplier.city}"`);
  }

  // UF digitada junto com a cidade ("PIRATINI – RS").
  const stateMatch = supplier.state.match(/[–-]\s*([A-Za-z]{2})$/);
  if (stateMatch && supplier.state.length > 2) {
    const original = supplier.state;
    supplier.state = stateMatch[1].toUpperCase();
    adjustments.push(`UF "${original}" → "${supplier.state}"`);
  }

  if (supplier.email) supplier.email = supplier.email.toLowerCase();
  supplier.taxId = supplier.taxId.replace(/[^\dA-Za-z]/g, "").toUpperCase();
  if (!supplier.certifications) supplier.certifications = "Sem certificação";
  if (!supplier.status) supplier.status = "Homologado";

  if (!supplier.legalName) warnings.push("Sem razão social");
  if (!supplier.taxId) warnings.push("Sem CNPJ / ID fiscal");
  else if (/^brasil$/i.test(supplier.country) && !isValidCnpj(supplier.taxId)) warnings.push(`CNPJ ${supplier.taxId} não confere os dígitos verificadores (importado como está)`);
  if (!supplier.email) warnings.push("Sem e-mail");
  return { supplier, adjustments, warnings };
}

export function normalizedName(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
}

/** Campos do cadastro existente que estão vazios e podem ser completados (nunca sobrescreve). */
export function fieldsToComplete(existing: Record<string, unknown>, incoming: ImportedSupplier) {
  const completable: Array<keyof ImportedSupplier> = ["tradeName", "address", "contactName", "email", "phone", "aliases", "products", "productionUnits", "bankDetails", "state", "city", "country"];
  const changes: Record<string, string> = {};
  for (const key of completable) {
    const current = text(existing[key]);
    const value = text(incoming[key]);
    if (!current && value) changes[key] = value;
  }
  if ((!text(existing.certifications) || text(existing.certifications) === "Sem certificação") && incoming.certifications && incoming.certifications !== "Sem certificação") {
    changes.certifications = incoming.certifications;
  }
  return changes;
}

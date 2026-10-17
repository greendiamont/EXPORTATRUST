import { cleanPayer, type FinancePayer } from "./finance";

export type SupplierPayer = FinancePayer & { supplierId: number; aliases: string[] };
type Supplier = {
  id: number; legalName: string; tradeName: string; aliases: string; taxId: string;
  address: string; city: string; state: string; country: string;
  email: string; phone: string; contactName: string;
};
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Only invoice party fields: the supplier's bank account is NOT the commission beneficiary. */
export function supplierPayer(supplier: Supplier): SupplierPayer {
  const parts: string[] = [];
  for (const part of [supplier.address, supplier.city, supplier.state, supplier.country]) {
    if (part.trim() && !parts.some((existing) => normalized(existing) === normalized(part))) parts.push(part.trim());
  }
  return {
    ...cleanPayer({ name: supplier.legalName, address: parts.join(" · "), taxId: supplier.taxId,
      email: supplier.email, phone: supplier.phone, contactName: supplier.contactName }),
    supplierId: supplier.id,
    aliases: [supplier.tradeName, ...supplier.aliases.split(/[,;\n]/)].map((value) => value.trim()).filter(Boolean),
  };
}

/** Prefer the actual linked supplier. Names/aliases must match uniquely, never fuzzy-guess a company. */
export function findSupplierPayer(suppliers: SupplierPayer[], name: string, supplierId?: number | null): SupplierPayer | undefined {
  if (supplierId) return suppliers.find((item) => item.supplierId === supplierId);
  const key = normalized(name);
  if (!key) return undefined;
  const matches = suppliers.filter((item) => [item.name, ...item.aliases, item.taxId].some((value) => normalized(value) === key));
  return matches.length === 1 ? matches[0] : undefined;
}

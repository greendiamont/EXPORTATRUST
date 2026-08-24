import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { suppliers } from "../../../db/schema";
import { audit, requireSecurityContext } from "../../../lib/security";
import { isBrazil, isValidBrazilianCnpj, normalizeTaxId } from "../../../lib/supplier-validation";

function message(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

async function ensureSupplierStorage() {
  const { env } = await import("cloudflare:workers");
  const info = await env.DB.prepare("PRAGMA table_info(suppliers)").all<{ name: string }>();
  const names = new Set((info.results ?? []).map((column) => column.name));
  if (!names.has("bank_details")) await env.DB.prepare("ALTER TABLE suppliers ADD bank_details text DEFAULT '' NOT NULL").run();
}

export async function GET() {
  try {
    const context = await requireSecurityContext("read");
    await ensureSupplierStorage();
    const db = await getDb();
    return Response.json({ suppliers: await db.select().from(suppliers).where(eq(suppliers.organizationId, context.organizationId)).orderBy(desc(suppliers.id)).limit(250) });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write_supplier");
    const body = await request.json() as Record<string, unknown>;
    const required: Array<[string, string]> = [["legalName", "Razão social"], ["taxId", "CNPJ / ID fiscal"], ["country", "País"], ["state", "Estado/UF"], ["city", "Município"], ["contactName", "Responsável"], ["email", "E-mail"]];
    const missing = required.filter(([key]) => !String(body[key] ?? "").trim()).map(([, label]) => label);
    if (missing.length) {
      return Response.json({ error: `Preencha os campos obrigatórios: ${missing.join(", ")}.`, missing }, { status: 400 });
    }
    const email = String(body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
    }
    const taxId = normalizeTaxId(body.taxId);
    const country = String(body.country).trim();
    if (isBrazil(country) && !isValidBrazilianCnpj(taxId)) {
      return Response.json({ error: "Informe um CNPJ brasileiro válido com 14 dígitos." }, { status: 400 });
    }
    const db = await getDb();
    await ensureSupplierStorage();
    if ((await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.organizationId, context.organizationId), eq(suppliers.taxId, taxId))).limit(1)).length) {
      return Response.json({ error: "Já existe um fornecedor com este CNPJ/identificador fiscal." }, { status: 409 });
    }
    const [supplier] = await db.insert(suppliers).values({
      organizationId: context.organizationId,
      legalName: String(body.legalName).trim(),
      tradeName: String(body.tradeName ?? "").trim(),
      taxId,
      country,
      state: String(body.state).trim().toUpperCase(),
      city: String(body.city).trim(),
      contactName: String(body.contactName).trim(),
      email,
      phone: String(body.phone ?? "").trim(),
      certifications: String(body.certifications ?? "Sem certificação").trim(),
      aliases: String(body.aliases ?? "").trim(),
      products: String(body.products ?? "").trim(),
      productionUnits: String(body.productionUnits ?? "").trim(),
      bankDetails: String(body.bankDetails ?? "").trim(),
      status: "Homologado",
    }).returning();
    await audit(context, "SUPPLIER_CREATED", "supplier", String(supplier.id), { taxId, legalName: supplier.legalName });
    return Response.json({ supplier }, { status: 201 });
  } catch (error) {
    console.error("SUPPLIER_CREATE_FAILED", error);
    if (error instanceof Response) return error;
    if (/UNIQUE constraint failed: suppliers\.(?:organization_id|tax_id)/i.test(message(error))) {
      return Response.json({ error: "Este CNPJ/identificador fiscal já está cadastrado nesta empresa." }, { status: 409 });
    }
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const context = await requireSecurityContext("write_supplier");
    const body = await request.json() as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Fornecedor inválido." }, { status: 400 });
    const required: Array<[string, string]> = [["legalName", "Razão social"], ["taxId", "CNPJ / ID fiscal"], ["country", "País"], ["state", "Estado/UF"], ["city", "Município"], ["contactName", "Responsável"], ["email", "E-mail"]];
    const missing = required.filter(([key]) => !String(body[key] ?? "").trim()).map(([, label]) => label);
    if (missing.length) return Response.json({ error: `Preencha os campos obrigatórios: ${missing.join(", ")}.`, missing }, { status: 400 });
    const email = String(body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
    const taxId = normalizeTaxId(body.taxId);
    const country = String(body.country).trim();
    if (isBrazil(country) && !isValidBrazilianCnpj(taxId)) return Response.json({ error: "Informe um CNPJ brasileiro válido com 14 dígitos." }, { status: 400 });
    const db = await getDb();
    await ensureSupplierStorage();
    const [current] = await db.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.organizationId, context.organizationId))).limit(1);
    if (!current) return Response.json({ error: "Fornecedor não encontrado nesta empresa." }, { status: 404 });
    const duplicate = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.organizationId, context.organizationId), eq(suppliers.taxId, taxId))).limit(1);
    if (duplicate.length && duplicate[0].id !== id) return Response.json({ error: "Este CNPJ/identificador fiscal já está cadastrado nesta empresa." }, { status: 409 });
    const [supplier] = await db.update(suppliers).set({
      legalName: String(body.legalName).trim(), tradeName: String(body.tradeName ?? "").trim(), taxId, country,
      state: String(body.state).trim().toUpperCase(), city: String(body.city).trim(), contactName: String(body.contactName).trim(),
      email, phone: String(body.phone ?? "").trim(), certifications: String(body.certifications ?? "Sem certificação").trim(),
      aliases: String(body.aliases ?? "").trim(), products: String(body.products ?? "").trim(), productionUnits: String(body.productionUnits ?? "").trim(),
      bankDetails: String(body.bankDetails ?? "").trim(),
    }).where(and(eq(suppliers.id, id), eq(suppliers.organizationId, context.organizationId))).returning();
    await audit(context, "SUPPLIER_UPDATED", "supplier", String(id), { taxId, legalName: supplier.legalName });
    return Response.json({ supplier });
  } catch (error) {
    console.error("SUPPLIER_UPDATE_FAILED", error);
    if (error instanceof Response) return error;
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

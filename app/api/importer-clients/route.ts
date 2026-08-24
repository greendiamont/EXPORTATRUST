import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { importerClients } from "../../../db/schema";
import { normalizeMasterName } from "../../../lib/master-data";
import { audit, requireSecurityContext } from "../../../lib/security";

const normalizeTaxId = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const normalizeTaxIdType = (value: unknown) => {
  const type = String(value ?? "Tax ID").trim().toUpperCase().replace(/\s+/g, " ");
  return ["VAT", "GST", "EORI", "CNPJ", "TAX ID"].includes(type) ? (type === "TAX ID" ? "Tax ID" : type) : "Tax ID";
};

const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; cause?: unknown };
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (record.cause instanceof Error && record.cause.message) return record.cause.message;
    if (typeof record.cause === "string" && record.cause.trim()) return record.cause;
  }
  return fallback;
};

const clean = (body: Record<string, unknown>) => ({
  legalName: String(body.legalName ?? "").trim(), normalizedName: normalizeMasterName(body.legalName), aliases: String(body.aliases ?? "").trim(),
  taxId: normalizeTaxId(body.taxId), taxIdType: normalizeTaxIdType(body.taxIdType), eori: normalizeTaxId(body.eori),
  address: String(body.address ?? "").trim(), city: String(body.city ?? "").trim(), state: String(body.state ?? "").trim(), postalCode: String(body.postalCode ?? "").trim(),
  country: String(body.country ?? "").trim(), contactName: String(body.contactName ?? "").trim(), email: String(body.email ?? "").trim().toLowerCase(), phone: String(body.phone ?? "").trim(),
  preferredPort: String(body.preferredPort ?? "").trim(), paymentTerms: String(body.paymentTerms ?? "").trim(), documentRequirements: String(body.documentRequirements ?? "").trim(),
  dataStatus: String(body.dataStatus ?? "Verificado").trim(), updatedAt: new Date().toISOString(),
});

export async function GET() { const c = await requireSecurityContext("read"); const db = await getDb(); return Response.json({ clients: await db.select().from(importerClients).where(eq(importerClients.organizationId, c.organizationId)).orderBy(desc(importerClients.id)).limit(500) }); }
export async function POST(request: Request) {
  try { const c = await requireSecurityContext("write_supplier"); const body = await request.json() as Record<string, unknown>; const values = clean(body); if (!values.legalName || !values.country) return Response.json({ error: "Informe razão social e país." }, { status: 400 }); const db = await getDb();
    const [sameName] = await db.select().from(importerClients).where(and(eq(importerClients.organizationId, c.organizationId), eq(importerClients.normalizedName, values.normalizedName))).limit(1);
    if (sameName) {
      const sameTaxId = values.taxId ? await db.select({ id: importerClients.id }).from(importerClients).where(and(eq(importerClients.organizationId, c.organizationId), eq(importerClients.taxId, values.taxId))).limit(20) : [];
      if (sameTaxId.some((duplicate) => duplicate.id !== sameName.id)) return Response.json({ error: `Outro cliente já usa ${values.taxIdType} ${values.taxId}.` }, { status: 409 });
      const completed = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "string" && !value.trim() ? sameName[key as keyof typeof sameName] ?? value : value])) as typeof values;
      await db.update(importerClients).set(completed).where(and(eq(importerClients.id, sameName.id), eq(importerClients.organizationId, c.organizationId)));
      const [client] = await db.select().from(importerClients).where(and(eq(importerClients.id, sameName.id), eq(importerClients.organizationId, c.organizationId))).limit(1);
      if (!client) return Response.json({ error: "O cliente foi atualizado, mas não pôde ser relido para confirmação." }, { status: 500 });
      try { await audit(c, "IMPORTER_CLIENT_COMPLETED", "importer_client", String(client.id), { legalName: client.legalName }); } catch (auditError) { console.error("IMPORTER_CLIENT_AUDIT_FAILED", auditError); }
      return Response.json({ client, action: "updated_existing" });
    }
    if (values.taxId && (await db.select({ id: importerClients.id }).from(importerClients).where(and(eq(importerClients.organizationId, c.organizationId), eq(importerClients.taxId, values.taxId))).limit(1)).length) return Response.json({ error: `Já existe um cliente com ${values.taxIdType} ${values.taxId}. Abra esse cadastro na lista para editar.` }, { status: 409 });
    const [client] = await db.insert(importerClients).values({ ...values, organizationId: c.organizationId }).returning(); try { await audit(c, "IMPORTER_CLIENT_CREATED", "importer_client", String(client.id), { legalName: client.legalName }); } catch (auditError) { console.error("IMPORTER_CLIENT_AUDIT_FAILED", auditError); } return Response.json({ client }, { status: 201 });
  } catch (e) { console.error("IMPORTER_CLIENT_CREATE_FAILED", e); if (e instanceof Response) return e; return Response.json({ error: errorMessage(e, "Falha ao salvar cliente no banco de dados.") }, { status: 500 }); }
}
export async function PUT(request: Request) {
  try { const c = await requireSecurityContext("write_supplier"); const body = await request.json() as Record<string, unknown>; const id = Number(body.id); const values = clean(body); if (!id || !values.legalName || !values.country) return Response.json({ error: "Cliente, razão social e país são obrigatórios." }, { status: 400 }); const db = await getDb();
    const duplicate = await db.select({ id: importerClients.id }).from(importerClients).where(and(eq(importerClients.organizationId, c.organizationId), eq(importerClients.normalizedName, values.normalizedName))).limit(20);
    if (duplicate[0] && duplicate[0].id !== id) return Response.json({ error: "Outro cliente já usa este nome normalizado." }, { status: 409 });
    const sameTaxId = values.taxId ? await db.select({ id: importerClients.id }).from(importerClients).where(and(eq(importerClients.organizationId, c.organizationId), eq(importerClients.taxId, values.taxId))).limit(20) : [];
    if (sameTaxId.some((duplicate) => duplicate.id !== id)) return Response.json({ error: `Outro cliente já usa ${values.taxIdType} ${values.taxId}.` }, { status: 409 });
    const [existing] = await db.select({ id: importerClients.id }).from(importerClients).where(and(eq(importerClients.id, id), eq(importerClients.organizationId, c.organizationId))).limit(1);
    if (!existing) return Response.json({ error: "Cliente não encontrado." }, { status: 404 });
    await db.update(importerClients).set(values).where(and(eq(importerClients.id, id), eq(importerClients.organizationId, c.organizationId)));
    const [client] = await db.select().from(importerClients).where(and(eq(importerClients.id, id), eq(importerClients.organizationId, c.organizationId))).limit(1);
    if (!client) return Response.json({ error: "O cliente foi atualizado, mas não pôde ser relido para confirmação." }, { status: 500 });
    try { await audit(c, "IMPORTER_CLIENT_UPDATED", "importer_client", String(id), { legalName: client.legalName }); } catch (auditError) { console.error("IMPORTER_CLIENT_AUDIT_FAILED", auditError); } return Response.json({ client });
  } catch (e) { console.error("IMPORTER_CLIENT_UPDATE_FAILED", e); if (e instanceof Response) return e; return Response.json({ error: errorMessage(e, "Falha ao atualizar cliente no banco de dados.") }, { status: 500 }); }
}

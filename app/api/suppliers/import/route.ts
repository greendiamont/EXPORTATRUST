import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { suppliers } from "../../../../db/schema";
import { audit, requireSecurityContext } from "../../../../lib/security";
import { ensureRegistrationColumns } from "../../../../lib/registration-columns";
import { isValidBrazilianCnpj } from "../../../../lib/supplier-validation";
import { convertLegacySupplier, extractSupplierRows, fieldsToComplete, normalizedName } from "../../../../lib/supplier-import";

// Importa fornecedores do app antigo para a empresa ativa. Com "dryRun" só mostra o que
// aconteceria. Nunca apaga nem sobrescreve: fornecedor já cadastrado (mesmo CNPJ ou mesma
// razão social) só tem campos vazios completados.

type Outcome = {
  sourceId: number | null;
  legalName: string;
  taxId: string;
  action: "criar" | "completar" | "já existe" | "ignorado";
  targetId: number | null;
  completed: string[];
  adjustments: string[];
  warnings: string[];
};

const MAX_ROWS = 2000;

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write_supplier");
    await ensureRegistrationColumns();
    const body = await request.json() as { payload?: unknown; dryRun?: boolean };
    const rows = extractSupplierRows(body.payload);
    if (!rows.length) return Response.json({ error: "Nenhum fornecedor encontrado no arquivo. Use a exportação JSON do app antigo." }, { status: 400 });
    if (rows.length > MAX_ROWS) return Response.json({ error: `Arquivo com ${rows.length} fornecedores; o limite por importação é ${MAX_ROWS}.` }, { status: 400 });
    const dryRun = body.dryRun !== false;

    const db = await getDb();
    const existing = await db.select().from(suppliers).where(eq(suppliers.organizationId, context.organizationId));
    const byTaxId = new Map(existing.filter((row) => row.taxId).map((row) => [row.taxId.replace(/[^\dA-Za-z]/g, "").toUpperCase(), row]));
    const byName = new Map(existing.map((row) => [normalizedName(row.legalName), row]));
    const seenInFile = new Set<string>();
    const outcomes: Outcome[] = [];

    for (const row of rows) {
      const { supplier, adjustments, warnings } = convertLegacySupplier(row, isValidBrazilianCnpj);
      const base = { sourceId: supplier.sourceId, legalName: supplier.legalName, taxId: supplier.taxId, adjustments, warnings, completed: [] as string[], targetId: null as number | null };
      const fileKey = supplier.taxId || normalizedName(supplier.legalName);
      if (!supplier.legalName || seenInFile.has(fileKey)) {
        outcomes.push({ ...base, action: "ignorado", warnings: [...warnings, supplier.legalName ? "Repetido no arquivo" : "Sem razão social"] });
        continue;
      }
      seenInFile.add(fileKey);

      const match = (supplier.taxId && byTaxId.get(supplier.taxId)) || byName.get(normalizedName(supplier.legalName));
      if (match) {
        const changes = fieldsToComplete(match, supplier);
        const completed = Object.keys(changes);
        if (completed.length && !dryRun) {
          await db.update(suppliers).set(changes).where(and(eq(suppliers.id, match.id), eq(suppliers.organizationId, context.organizationId)));
          await audit(context, "SUPPLIER_IMPORT_COMPLETED", "supplier", String(match.id), { sourceId: supplier.sourceId, fields: completed });
        }
        outcomes.push({ ...base, action: completed.length ? "completar" : "já existe", targetId: match.id, completed });
        continue;
      }

      let targetId: number | null = null;
      if (!dryRun) {
        const { sourceId, createdAt, ...values } = supplier;
        const [created] = await db.insert(suppliers).values({ ...values, organizationId: context.organizationId, ...(createdAt ? { createdAt } : {}) }).returning();
        targetId = created.id;
        byTaxId.set(supplier.taxId, created);
        byName.set(normalizedName(supplier.legalName), created);
        await audit(context, "SUPPLIER_IMPORTED", "supplier", String(created.id), { sourceId, legalName: supplier.legalName, taxId: supplier.taxId, adjustments });
      }
      outcomes.push({ ...base, action: "criar", targetId });
    }

    const summary = {
      total: outcomes.length,
      criar: outcomes.filter((item) => item.action === "criar").length,
      completar: outcomes.filter((item) => item.action === "completar").length,
      existentes: outcomes.filter((item) => item.action === "já existe").length,
      ignorados: outcomes.filter((item) => item.action === "ignorado").length,
    };
    if (!dryRun) await audit(context, "SUPPLIERS_IMPORT_FINISHED", "supplier", "import", { ...summary, mapping: outcomes.filter((item) => item.targetId).map((item) => [item.sourceId, item.targetId]) });
    return Response.json({ dryRun, organization: context.organizationName, summary, outcomes });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("SUPPLIER_IMPORT_FAILED", error);
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao importar fornecedores." }, { status: 500 });
  }
}

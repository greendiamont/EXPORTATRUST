import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { productTraceabilityCatalog } from "../../../db/schema";
import { ensureProductCatalog } from "../../../lib/product-catalog";
import { requireSecurityContext } from "../../../lib/security";

function message(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

export async function GET() {
  try {
    const context = await requireSecurityContext("read");
    await ensureProductCatalog(context.organizationId);
    const db = await getDb();
    const catalog = await db.select().from(productTraceabilityCatalog).where(and(
      eq(productTraceabilityCatalog.organizationId, context.organizationId),
      eq(productTraceabilityCatalog.active, true),
    )).orderBy(asc(productTraceabilityCatalog.product), asc(productTraceabilityCatalog.entryType), asc(productTraceabilityCatalog.sortOrder));
    return Response.json({ catalog });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

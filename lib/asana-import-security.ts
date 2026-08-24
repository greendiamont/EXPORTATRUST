import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { appUsers, organizationMemberships, organizations } from "../db/schema";
import { requireSecurityContext, sha256Hex, type SecurityContext } from "./security";

export async function requireAsanaImportContext(request: Request): Promise<SecurityContext> {
  try {
    return await requireSecurityContext("write_supplier");
  } catch (authenticationError) {
    if (!(authenticationError instanceof Response) || authenticationError.status !== 401) throw authenticationError;
    const { env } = await import("cloudflare:workers");
    const runtime = env as unknown as Record<string, unknown>;
    const expected = String(runtime.ASANA_MIGRATION_TOKEN ?? "");
    const provided = request.headers.get("x-exportatrust-migration-token") ?? "";
    if (!expected || !provided || await sha256Hex(expected) !== await sha256Hex(provided)) throw authenticationError;
    const organizationId = Math.max(1, Number(runtime.ASANA_MIGRATION_ORGANIZATION_ID ?? 1));
    const db = await getDb();
    const [owner] = await db.select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      userId: appUsers.id,
      email: appUsers.email,
      fullName: appUsers.fullName,
    }).from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .innerJoin(appUsers, eq(appUsers.id, organizationMemberships.userId))
      .where(and(eq(organizations.id, organizationId), eq(organizationMemberships.status, "Ativo")))
      .limit(1);
    if (!owner) throw authenticationError;
    return { ...owner, role: "administrador", preview: false };
  }
}

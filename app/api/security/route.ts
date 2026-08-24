import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { appUsers, auditLogs, backupSnapshots, legalAcceptances, organizationMemberships, organizations, pdfIntegrityRecords, systemEvents } from "../../../db/schema";
import { createTenantBackup, ensureDailyBackup, runRestoreDrill, verifyLatestBackup } from "../../../lib/backup";
import { createTenantArchive } from "../../../lib/tenant-archive";
import { ACTIVE_ORGANIZATION_COOKIE, APP_ROLES, audit, ensureSecurityTables, requireSecurityContext, verifyAuditChain, type AppRole } from "../../../lib/security";
import { tenantExport } from "../../../lib/tenant-export";

function responseError(error: unknown) {
  if (error instanceof Response) return error;
  return Response.json({ error: error instanceof Error ? error.message : "Falha de segurança." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await ensureSecurityTables();
    const context = await requireSecurityContext("read");
    const backupAutomation = await ensureDailyBackup(context);
    const url = new URL(request.url);
    if (url.searchParams.get("export") === "1") {
      if (!["administrador", "auditor", "cliente", "analista"].includes(context.role)) return Response.json({ error: "Exportação não autorizada." }, { status: 403 });
      const payload = await tenantExport(context.organizationId);
      await audit(context, "DATA_EXPORT", "organization", String(context.organizationId));
      return new Response(JSON.stringify(payload, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="exportatrust-export-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "private, no-store" } });
    }
    if (url.searchParams.get("export") === "archive") {
      if (!['administrador', 'auditor', 'cliente', 'analista'].includes(context.role)) return Response.json({ error: "Exportação não autorizada." }, { status: 403 });
      const archive = await createTenantArchive(context);
      await audit(context, "FULL_ARCHIVE_EXPORT", "organization", String(context.organizationId), { documentCount: archive.documentCount });
      return new Response(archive.stream, { headers: { "content-type": "application/x-tar", "content-disposition": `attachment; filename="exportatrust-${context.organizationSlug}-${new Date().toISOString().slice(0, 10)}.tar"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    }
    const db = await getDb();
    const [members, accessibleOrganizations, logs, backups, integrity, monitoringEvents, chain, { env }] = await Promise.all([
      db.select({ id: organizationMemberships.id, role: organizationMemberships.role, status: organizationMemberships.status, email: appUsers.email, fullName: appUsers.fullName, lastLoginAt: appUsers.lastLoginAt }).from(organizationMemberships).innerJoin(appUsers, eq(organizationMemberships.userId, appUsers.id)).where(eq(organizationMemberships.organizationId, context.organizationId)).orderBy(desc(organizationMemberships.id)).limit(100),
      db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, taxId: organizations.taxId, status: organizations.status, role: organizationMemberships.role }).from(organizationMemberships).innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id)).where(and(eq(organizationMemberships.userId, context.userId), eq(organizationMemberships.status, "Ativo"))).orderBy(organizations.name).limit(100),
      db.select().from(auditLogs).where(eq(auditLogs.organizationId, context.organizationId)).orderBy(desc(auditLogs.id)).limit(100),
      db.select().from(backupSnapshots).where(eq(backupSnapshots.organizationId, context.organizationId)).orderBy(desc(backupSnapshots.id)).limit(20),
      db.select().from(pdfIntegrityRecords).where(eq(pdfIntegrityRecords.organizationId, context.organizationId)).orderBy(desc(pdfIntegrityRecords.id)).limit(50),
      db.select().from(systemEvents).where(eq(systemEvents.organizationId, context.organizationId)).orderBy(desc(systemEvents.id)).limit(50),
      verifyAuditChain(context.organizationId),
      import("cloudflare:workers"),
    ]);
    const [termsAccepted, privacyAccepted] = await Promise.all([
      db.select({ id: legalAcceptances.id }).from(legalAcceptances).where(and(eq(legalAcceptances.userId, context.userId), eq(legalAcceptances.documentType, "terms"), eq(legalAcceptances.version, "2026-08-13"))).limit(1),
      db.select({ id: legalAcceptances.id }).from(legalAcceptances).where(and(eq(legalAcceptances.userId, context.userId), eq(legalAcceptances.documentType, "privacy"), eq(legalAcceptances.version, "2026-08-13"))).limit(1),
    ]);
    const runtimeEnvironment = String((env as unknown as Record<string, unknown>).APP_ENV || (context.preview ? "test" : "production"));
    return Response.json({
      context,
      members,
      organizations: accessibleOrganizations,
      auditLogs: logs,
      backups,
      integrity,
      monitoring: { events: monitoringEvents, openCount: monitoringEvents.filter((event) => event.status === "Aberto").length },
      auditChain: chain,
      legal: { termsVersion: "2026-08-13", termsAccepted: !!termsAccepted.length, privacyAccepted: !!privacyAccepted.length },
      infrastructure: { database: Boolean(env.DB), objectStorage: Boolean(env.BUCKET), authentication: context.preview ? "preview" : "chatgpt-siwc", recovery: context.preview ? "simulation" : "identity-provider", environment: runtimeEnvironment, backupAutomation },
      controls: [
        { id: 1, name: "Login real", state: context.preview ? "testing" : "operational", detail: context.preview ? "Identidade simulada somente nesta prévia." : "Identidade real ativa; recuperação de acesso é processada pelo provedor seguro." },
        { id: 2, name: "Separação por empresa", state: "operational", detail: `Tenant ativo: ${context.organizationName}.` },
        { id: 3, name: "Perfis e permissões", state: "operational", detail: "Administrador, analista, fornecedor, auditor e cliente." },
        { id: 4, name: "Documentos protegidos", state: "operational", detail: "Acesso autenticado, armazenamento privado e links temporários." },
        { id: 5, name: "Backups", state: "operational", detail: `Backup diário automático ativo. Próximo ciclo: ${new Date(backupAutomation.nextRunAt).toLocaleString("pt-BR")}.` },
        { id: 6, name: "Auditoria imutável", state: chain.valid ? "operational" : "critical", detail: `${chain.checked} evento(s) verificado(s) em cadeia SHA-256.` },
        { id: 7, name: "Termos e LGPD", state: termsAccepted.length && privacyAccepted.length ? "operational" : "attention", detail: "Documentos versão 2026-08-13; revisão jurídica recomendada antes da abertura pública." },
        { id: 8, name: "Teste e produção", state: runtimeEnvironment === "production" ? "prepared" : "testing", detail: `Ambiente atual identificado como ${runtimeEnvironment}; infraestrutura isolada de homologação permanece como próximo provisionamento.` },
        { id: 9, name: "Monitoramento", state: "operational", detail: `Health check e captura interna ativos; ${monitoringEvents.filter((event) => event.status === "Aberto").length} alerta(s) aberto(s).` },
        { id: 10, name: "Exportação integral", state: "operational", detail: "Pacote TAR auditável com manifesto, dados e bytes originais de todos os documentos." },
        { id: 11, name: "Integridade dos PDFs", state: "operational", detail: `${integrity.length} PDF(s) selado(s) com SHA-256.` },
        { id: 12, name: "Teste de segurança", state: "testing", detail: "13 testes automatizados ativos; pentest independente permanece obrigatório antes do lançamento." },
      ],
    });
  } catch (error) { return responseError(error); }
}

export async function POST(request: Request) {
  try {
    await ensureBaseTables();
    await ensureSecurityTables();
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const context = await requireSecurityContext(["acceptLegal", "switchOrganization"].includes(action) ? "read" : ["backup", "verifyBackup", "restoreDrill"].includes(action) ? "backup" : "manage_users");
    const db = await getDb();
    if (action === "acceptLegal") {
      const documentType = String(body.documentType);
      if (!["terms", "privacy"].includes(documentType)) return Response.json({ error: "Documento jurídico inválido." }, { status: 400 });
      await db.insert(legalAcceptances).values({ organizationId: context.organizationId, userId: context.userId, documentType, version: "2026-08-13" }).onConflictDoNothing();
      await audit(context, "LEGAL_ACCEPTED", "legal_document", documentType, { version: "2026-08-13" });
      return Response.json({ ok: true });
    }
    if (action === "inviteUser") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const role = String(body.role ?? "cliente") as AppRole;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !APP_ROLES.includes(role)) return Response.json({ error: "E-mail ou perfil inválido." }, { status: 400 });
      let [user] = await db.select().from(appUsers).where(eq(appUsers.email, email)).limit(1);
      if (!user) [user] = await db.insert(appUsers).values({ email, fullName: String(body.fullName ?? "").trim(), identityProvider: "pending" }).returning();
      const [existing] = await db.select().from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, context.organizationId), eq(organizationMemberships.userId, user.id))).limit(1);
      if (existing) await db.update(organizationMemberships).set({ role, status: "Ativo" }).where(eq(organizationMemberships.id, existing.id));
      else await db.insert(organizationMemberships).values({ organizationId: context.organizationId, userId: user.id, role, invitedBy: context.email });
      await audit(context, "MEMBER_GRANTED", "user", String(user.id), { email, role });
      return Response.json({ ok: true });
    }
    if (action === "updateMember") {
      const membershipId = Number(body.membershipId);
      const role = String(body.role ?? "cliente") as AppRole;
      const status = String(body.status ?? "Ativo");
      if (!Number.isSafeInteger(membershipId) || !APP_ROLES.includes(role) || !["Ativo", "Inativo"].includes(status)) return Response.json({ error: "Perfil inválido." }, { status: 400 });
      const [membership] = await db.select().from(organizationMemberships).where(and(eq(organizationMemberships.id, membershipId), eq(organizationMemberships.organizationId, context.organizationId))).limit(1);
      if (!membership) return Response.json({ error: "Usuário não pertence à empresa ativa." }, { status: 404 });
      if (membership.userId === context.userId && (role !== "administrador" || status !== "Ativo")) return Response.json({ error: "O administrador não pode remover o próprio acesso." }, { status: 409 });
      await db.update(organizationMemberships).set({ role, status }).where(and(eq(organizationMemberships.id, membershipId), eq(organizationMemberships.organizationId, context.organizationId)));
      await audit(context, "MEMBER_UPDATED", "membership", String(membershipId), { role, status });
      return Response.json({ ok: true });
    }
    if (action === "switchOrganization") {
      const organizationId = Number(body.organizationId);
      const [membership] = await db.select().from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, context.userId), eq(organizationMemberships.status, "Ativo"))).limit(1);
      if (!membership) return Response.json({ error: "Empresa não autorizada para este usuário." }, { status: 403 });
      await audit(context, "ORGANIZATION_SWITCHED", "organization", String(organizationId));
      const secure = context.preview ? "" : "; Secure";
      return Response.json({ ok: true, organizationId }, { headers: { "set-cookie": `${ACTIVE_ORGANIZATION_COOKIE}=${organizationId}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}` } });
    }
    if (action === "createOrganization") {
      const name = String(body.name ?? "").trim();
      const taxId = String(body.taxId ?? "").trim();
      const baseSlug = String(body.slug ?? name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
      if (name.length < 2 || baseSlug.length < 2) return Response.json({ error: "Informe o nome da empresa." }, { status: 400 });
      const [slugExists] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, baseSlug)).limit(1);
      const slug = slugExists ? `${baseSlug}-${crypto.randomUUID().slice(0, 6)}` : baseSlug;
      const [organization] = await db.insert(organizations).values({ name, slug, taxId, status: "Ativa", dataRegion: "global" }).returning();
      await db.insert(organizationMemberships).values({ organizationId: organization.id, userId: context.userId, role: "administrador", invitedBy: context.email });
      await audit(context, "ORGANIZATION_CREATED", "organization", String(organization.id), { name, slug });
      const secure = context.preview ? "" : "; Secure";
      return Response.json({ ok: true, organizationId: organization.id }, { headers: { "set-cookie": `${ACTIVE_ORGANIZATION_COOKIE}=${organization.id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}` } });
    }
    if (action === "backup") {
      const created = await createTenantBackup(context);
      return Response.json({ ok: true, ...created });
    }
    if (action === "verifyBackup") return Response.json({ ok: true, ...(await verifyLatestBackup(context)) });
    if (action === "restoreDrill") return Response.json({ ok: true, ...(await runRestoreDrill(context)) });
    return Response.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (error) { return responseError(error); }
}

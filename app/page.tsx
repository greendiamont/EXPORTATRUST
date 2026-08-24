import { desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../db";
import { exceptionActions, operationDocuments, operationPartners, operations, ruralProperties, suppliers } from "../db/schema";
import { getSecurityContext } from "../lib/security";
import { ensureDailyBackup } from "../lib/backup";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "./chatgpt-auth";
import ClientApp, { type InitialAppData } from "./client-app";

export default async function Page() {
  const signedInUser = await getChatGPTUser();
  const security = await getSecurityContext();
  if (!security && signedInUser) return <main className="auth-gate"><section><span className="auth-gate-mark">ET</span><p className="eyebrow">ACESSO CONTROLADO</p><h1>Seu login foi confirmado, mas ainda não há uma empresa liberada.</h1><p>Peça ao administrador da ExportaTrust para cadastrar o e-mail <strong>{signedInUser.email}</strong> e definir seu perfil.</p><a href={chatGPTSignOutPath("/")}>Entrar com outra conta →</a><small>Nenhum processo ou documento foi exposto.</small></section></main>;
  if (!security) return <main className="auth-gate"><section><span className="auth-gate-mark">ET</span><p className="eyebrow">EXPORTATRUST SECURE ACCESS</p><h1>Entre para acessar o Due Diligence EUDR App</h1><p>Processos, documentos e dossiês são protegidos por identidade e autorização da empresa.</p><a href={chatGPTSignInPath("/")}>Entrar com segurança →</a><small>A recuperação de acesso é administrada pelo provedor de identidade.</small></section></main>;
  try { await ensureDailyBackup(security); } catch { /* O acesso nunca é bloqueado por indisponibilidade pontual do backup. */ }
  let initialData: InitialAppData = {
    suppliers: [],
    operations: [],
    partners: [],
    properties: [],
    actions: [],
    documents: [],
    security,
    loadFailed: true,
  };

  try {
    await ensureBaseTables();
    const db = await getDb();
    const [supplierRows, operationRows, partnerRows, propertyRows, actionRows, documentRows] = await Promise.all([
      db.select().from(suppliers).where(eq(suppliers.organizationId, security.organizationId)).orderBy(desc(suppliers.id)).limit(250),
      db.select().from(operations).where(eq(operations.organizationId, security.organizationId)).orderBy(desc(operations.id)).limit(250),
      db.select().from(operationPartners).where(eq(operationPartners.organizationId, security.organizationId)).orderBy(desc(operationPartners.id)).limit(500),
      db.select().from(ruralProperties).where(eq(ruralProperties.organizationId, security.organizationId)).orderBy(desc(ruralProperties.id)).limit(500),
      db.select().from(exceptionActions).where(eq(exceptionActions.organizationId, security.organizationId)).orderBy(desc(exceptionActions.id)).limit(300),
      db.select().from(operationDocuments).where(eq(operationDocuments.organizationId, security.organizationId)).orderBy(desc(operationDocuments.id)).limit(1000),
    ]);
    initialData = {
      suppliers: supplierRows,
      operations: operationRows,
      partners: partnerRows,
      properties: propertyRows,
      actions: actionRows,
      documents: documentRows,
      security,
      loadFailed: false,
    };
  } catch {
    // The client has an independent retry path if server-side loading is unavailable.
  }

  return <ClientApp initialData={initialData} />;
}

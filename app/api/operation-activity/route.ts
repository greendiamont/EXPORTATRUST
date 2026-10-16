import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "../../../db";
import { appUsers, auditLogs, organizationMemberships, operations } from "../../../db/schema";
import { assertOperationAccess, guestOperationIds, requireSecurityContext } from "../../../lib/security";

// Colaboração no pedido (estilo Asana): comentários com @menções, quem está vendo o
// pedido agora e o histórico de alterações da equipe. Tabelas aditivas (migração 0030),
// criadas também sob demanda para ambientes onde a migração ainda não rodou.

let ready: Promise<void> | null = null;
function ensureTables() {
  if (ready) return ready;
  ready = (async () => {
    const { env } = await import("cloudflare:workers");
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS operation_comments (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      organization_id integer NOT NULL,
      operation_id integer NOT NULL,
      author_email text NOT NULL,
      author_name text DEFAULT '' NOT NULL,
      body text NOT NULL,
      mentions_json text DEFAULT '[]' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS operation_presence (
      organization_id integer NOT NULL,
      operation_id integer NOT NULL,
      email text NOT NULL,
      name text DEFAULT '' NOT NULL,
      seen_at text NOT NULL,
      PRIMARY KEY (operation_id, email)
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS operation_followers (
      organization_id integer NOT NULL,
      operation_id integer NOT NULL,
      email text NOT NULL,
      name text DEFAULT '' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      PRIMARY KEY (operation_id, email)
    )`).run();
    // Colunas da migração 0031 (comentário por etapa/tarefa e documento em edição).
    for (const [table, column] of [["operation_comments", "target_key"], ["operation_presence", "editing"]]) {
      try {
        await env.DB.prepare(`SELECT ${column} FROM ${table} LIMIT 1`).all();
      } catch {
        await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} text DEFAULT '' NOT NULL`).run();
      }
    }
  })().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}

const LABELS: Record<string, string> = {
  EXPORT_MILESTONE_UPDATED: "atualizou a etapa",
  OPERATION_TASK_CREATED: "criou a tarefa",
  OPERATION_TASK_UPDATED: "editou uma tarefa",
  OPERATION_TASK_COMPLETION_TOGGLED: "marcou uma tarefa",
  OPERATION_TASK_DELETED: "excluiu a tarefa",
  OPERATION_UPDATED: "editou os dados do pedido",
  DOCUMENT_UPLOADED: "anexou um arquivo",
  DOCUMENT_DELETED: "excluiu um arquivo",
  OPERATION_COMMENTED: "comentou",
  ORDER_COMMERCIAL_DETAILS_UPDATED: "editou os documentos do pedido",
  OPERATION_FOLLOWED: "passou a seguir o pedido",
};

/** Convidado vê só a atividade operacional (nada de dados comerciais do pedido). */
const GUEST_ACTIONS = new Set(["EXPORT_MILESTONE_UPDATED", "OPERATION_TASK_CREATED", "OPERATION_TASK_UPDATED", "OPERATION_TASK_COMPLETION_TOGGLED", "OPERATION_TASK_DELETED", "DOCUMENT_UPLOADED", "DOCUMENT_DELETED", "OPERATION_FOLLOWED"]);

async function ownedOperation(operationId: number, organizationId: number) {
  const db = await getDb();
  const [operation] = await db.select({ id: operations.id }).from(operations).where(and(eq(operations.id, operationId), eq(operations.organizationId, organizationId))).limit(1);
  return operation;
}

export async function GET(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureTables();
    const operationId = Number(new URL(request.url).searchParams.get("operationId"));
    if (!operationId || !(await ownedOperation(operationId, context.organizationId))) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
    await assertOperationAccess(context, operationId);
    const { env } = await import("cloudflare:workers");
    const db = await getDb();
    const since = new Date(Date.now() - 60_000).toISOString();
    const [comments, presence, followers, events, members] = await Promise.all([
      env.DB.prepare("SELECT id, author_email AS authorEmail, author_name AS authorName, body, mentions_json AS mentionsJson, target_key AS targetKey, created_at AS createdAt FROM operation_comments WHERE organization_id = ? AND operation_id = ? ORDER BY id DESC LIMIT 300").bind(context.organizationId, operationId).all(),
      env.DB.prepare("SELECT email, name, editing, seen_at AS seenAt FROM operation_presence WHERE organization_id = ? AND operation_id = ? AND seen_at >= ?").bind(context.organizationId, operationId, since).all(),
      env.DB.prepare("SELECT email, name FROM operation_followers WHERE organization_id = ? AND operation_id = ? ORDER BY created_at").bind(context.organizationId, operationId).all(),
      db.select({ id: auditLogs.id, action: auditLogs.action, actorEmail: auditLogs.actorEmail, metadataJson: auditLogs.metadataJson, createdAt: auditLogs.createdAt }).from(auditLogs)
        .where(and(eq(auditLogs.organizationId, context.organizationId), eq(auditLogs.entityType, "operation"), eq(auditLogs.entityId, String(operationId)))).orderBy(desc(auditLogs.id)).limit(100),
      db.select({ email: appUsers.email, name: appUsers.fullName }).from(organizationMemberships).innerJoin(appUsers, eq(organizationMemberships.userId, appUsers.id))
        .where(and(eq(organizationMemberships.organizationId, context.organizationId), eq(organizationMemberships.status, "Ativo"),
          ...(await guestOperationIds(context) ? [ne(organizationMemberships.role, "convidado")] : []))),
    ]);
    const guest = Boolean(await guestOperationIds(context));
    const activity = events.filter((event) => event.action !== "OPERATION_COMMENTED" && (!guest || GUEST_ACTIONS.has(event.action))).map((event) => {
      let detail = "";
      try {
        const metadata = JSON.parse(event.metadataJson || "{}") as Record<string, unknown>;
        detail = String(metadata.description ?? metadata.code ?? metadata.fileName ?? (metadata.completed === true ? "concluída" : metadata.completed === false ? "reaberta" : ""));
        if (metadata.status) detail = [detail, String(metadata.status)].filter(Boolean).join(" → ");
      } catch { /* sem detalhe */ }
      return { id: event.id, who: event.actorEmail, what: LABELS[event.action] ?? event.action.toLowerCase().replaceAll("_", " "), detail, at: event.createdAt };
    });
    return Response.json({
      me: context.email,
      comments: comments.results ?? [],
      viewing: ((presence.results ?? []) as Array<{ email: string; name: string; editing: string }>).filter((row) => row.email !== context.email),
      followers: followers.results ?? [],
      activity,
      members: members.map((member) => ({ email: member.email, name: member.name || member.email.split("@")[0] })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao carregar a atividade." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    await ensureTables();
    const body = await request.json() as { operationId?: number; action?: string; text?: string; mentions?: string[]; target?: string; editing?: string; follow?: boolean };
    const operationId = Number(body.operationId);
    if (!operationId || !(await ownedOperation(operationId, context.organizationId))) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
    await assertOperationAccess(context, operationId);
    const { env } = await import("cloudflare:workers");
    const now = new Date().toISOString();

    if (body.action === "presence") {
      const editing = String(body.editing ?? "").slice(0, 60);
      await env.DB.prepare("INSERT INTO operation_presence (organization_id, operation_id, email, name, seen_at, editing) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (operation_id, email) DO UPDATE SET seen_at = excluded.seen_at, name = excluded.name, editing = excluded.editing")
        .bind(context.organizationId, operationId, context.email, context.fullName, now, editing).run();
      return Response.json({ ok: true });
    }

    if (body.action === "follow") {
      if (body.follow === false) {
        await env.DB.prepare("DELETE FROM operation_followers WHERE organization_id = ? AND operation_id = ? AND email = ?").bind(context.organizationId, operationId, context.email).run();
      } else {
        await env.DB.prepare("INSERT INTO operation_followers (organization_id, operation_id, email, name, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (operation_id, email) DO NOTHING")
          .bind(context.organizationId, operationId, context.email, context.fullName, now).run();
        const { audit } = await import("../../../lib/security");
        await audit(context, "OPERATION_FOLLOWED", "operation", String(operationId), {});
      }
      return Response.json({ ok: true });
    }

    if (body.action === "comment") {
      const text = String(body.text ?? "").trim();
      if (!text) return Response.json({ error: "Escreva o comentário." }, { status: 400 });
      if (text.length > 5000) return Response.json({ error: "Comentário muito longo (máx. 5000 caracteres)." }, { status: 400 });
      const writer = await requireSecurityContext("write").catch(() => null);
      if (!writer) return Response.json({ error: "Seu perfil não pode comentar." }, { status: 403 });
      const mentions = [...new Set((Array.isArray(body.mentions) ? body.mentions : []).map((email) => String(email).toLowerCase()).filter((email) => /^[^\s@]+@[^\s@]+$/.test(email)))].slice(0, 20);
      const target = String(body.target ?? "").slice(0, 60);
      await env.DB.prepare("INSERT INTO operation_comments (organization_id, operation_id, author_email, author_name, body, mentions_json, created_at, target_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(context.organizationId, operationId, context.email, context.fullName, text, JSON.stringify(mentions), now, target).run();
      const { audit } = await import("../../../lib/security");
      await audit(writer, "OPERATION_COMMENTED", "operation", String(operationId), { mentions, target });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao registrar." }, { status: 500 });
  }
}

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { systemEvents } from "../../../db/schema";
import { audit, requireSecurityContext, sha256Hex } from "../../../lib/security";

function responseError(error: unknown) {
  if (error instanceof Response) return error;
  return Response.json({ error: error instanceof Error ? error.message : "Falha no monitoramento." }, { status: 500 });
}

export async function GET() {
  try {
    const context = await requireSecurityContext("read");
    const db = await getDb();
    const events = await db.select().from(systemEvents).where(eq(systemEvents.organizationId, context.organizationId)).orderBy(desc(systemEvents.id)).limit(100);
    return Response.json({ events, openCount: events.filter((event) => event.status === "Aberto").length }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return responseError(error); }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("read");
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "report");
    const db = await getDb();
    if (action === "resolve") {
      if (!['administrador', 'analista'].includes(context.role)) return Response.json({ error: "Perfil sem autorização." }, { status: 403 });
      const id = Number(body.id);
      await db.update(systemEvents).set({ status: "Resolvido", resolvedAt: new Date().toISOString() }).where(and(eq(systemEvents.organizationId, context.organizationId), eq(systemEvents.id, id)));
      await audit(context, "SYSTEM_EVENT_RESOLVED", "system_event", String(id));
      return Response.json({ ok: true });
    }
    const source = String(body.source ?? "client").slice(0, 80);
    const message = String(body.message ?? "Erro não identificado").replace(/[\r\n]+/g, " ").slice(0, 500);
    const level = ["warning", "error", "critical"].includes(String(body.level)) ? String(body.level) : "error";
    const fingerprint = await sha256Hex(`${context.organizationId}:${source}:${message.toLowerCase()}`);
    const [recent] = await db.select().from(systemEvents).where(and(eq(systemEvents.organizationId, context.organizationId), eq(systemEvents.fingerprint, fingerprint), eq(systemEvents.status, "Aberto"))).orderBy(desc(systemEvents.id)).limit(1);
    if (!recent) await db.insert(systemEvents).values({ organizationId: context.organizationId, level, source, fingerprint, message, metadataJson: JSON.stringify({ userAgent: String(body.userAgent ?? "").slice(0, 180), path: String(body.path ?? "").slice(0, 160) }) });
    return Response.json({ ok: true }, { status: recent ? 200 : 201 });
  } catch (error) { return responseError(error); }
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const { env } = await import("cloudflare:workers");
    if (!env.DB || !env.BUCKET) throw new Error("Required bindings unavailable");
    await env.DB.prepare("SELECT 1 AS ok").first();
    return Response.json({ status: "ok", service: "ExportaTrust EUDR", database: "ok", objectStorage: "ok", checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch {
    return Response.json({ status: "degraded", service: "ExportaTrust EUDR", checkedAt: new Date().toISOString() }, { status: 503, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }
}

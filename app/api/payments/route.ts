import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { paymentTransactions } from "../../../db/schema";
import { getIntegrationStatuses } from "../../../lib/integrations";
import { audit, requireSecurityContext } from "../../../lib/security";

function runtimeEnv(value: unknown) { return String(value ?? "").trim(); }

export async function GET() {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    const db = await getDb();
    const integrations = (await getIntegrationStatuses()).filter((item) => item.category === "payments");
    const transactions = await db.select().from(paymentTransactions).where(eq(paymentTransactions.organizationId, context.organizationId)).orderBy(desc(paymentTransactions.id)).limit(100);
    return Response.json({ integrations, transactions }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Payment status unavailable." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    const body = await request.json() as { action?: string; catalogKey?: string; operationId?: number };
    if (body.action !== "stripe_checkout") return Response.json({ error: "Unsupported payment action." }, { status: 400 });
    const { env } = await import("cloudflare:workers");
    const runtime = env as unknown as Record<string, unknown>;
    const stripeKey = runtimeEnv(runtime.STRIPE_SECRET_KEY);
    if (!stripeKey) return Response.json({ error: "Stripe is installed but STRIPE_SECRET_KEY is not configured." }, { status: 503 });
    let catalog: Record<string, string> = {};
    try { catalog = JSON.parse(runtimeEnv(runtime.STRIPE_PRICE_IDS_JSON) || "{}") as Record<string, string>; } catch { /* fail closed below */ }
    const catalogKey = runtimeEnv(body.catalogKey);
    const priceId = runtimeEnv(catalog[catalogKey]);
    if (!catalogKey || !priceId) return Response.json({ error: "This commercial service is not present in the server-side Stripe price catalog." }, { status: 400 });
    const origin = new URL(request.url).origin;
    const form = new URLSearchParams({ mode: "payment", "line_items[0][price]": priceId, "line_items[0][quantity]": "1", success_url: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/?payment=cancelled`, "metadata[catalog_key]": catalogKey, "metadata[operation_id]": String(body.operationId ?? "") });
    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    const session = await stripeResponse.json() as { id?: string; url?: string; amount_total?: number; currency?: string; payment_status?: string; error?: { message?: string } };
    if (!stripeResponse.ok || !session.id || !session.url) return Response.json({ error: session.error?.message || `Stripe returned HTTP ${stripeResponse.status}.` }, { status: 502 });
    const db = await getDb();
    const paymentId = `PAY-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
    const [transaction] = await db.insert(paymentTransactions).values({ organizationId: context.organizationId, paymentId, operationId: body.operationId || null, provider: "Stripe", method: "Checkout · Card/Pix", direction: "REVENUE", catalogKey, amount: Number(session.amount_total ?? 0) / 100, currency: String(session.currency ?? "brl").toUpperCase(), status: session.payment_status || "unpaid", externalReference: session.id, checkoutUrl: session.url, simulated: false, metadataJson: JSON.stringify({ priceId }) }).returning();
    await audit(context, "PAYMENT_CHECKOUT_CREATED", "payment", paymentId, { catalogKey, amount: transaction.amount, currency: transaction.currency });
    return Response.json({ transaction, checkoutUrl: session.url }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Checkout creation failed." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    const body = await request.json() as { paymentId?: string; status?: string };
    if (!body.paymentId || !body.status) return Response.json({ error: "paymentId and status are required." }, { status: 400 });
    if (!["cancelled", "expired"].includes(body.status)) return Response.json({ error: "Only non-financial local terminal states can be updated here." }, { status: 403 });
    const db = await getDb();
    const [updated] = await db.update(paymentTransactions).set({ status: body.status }).where(and(eq(paymentTransactions.paymentId, body.paymentId), eq(paymentTransactions.organizationId, context.organizationId))).returning();
    if (updated) await audit(context, "PAYMENT_STATUS_UPDATED", "payment", updated.paymentId, { status: updated.status });
    return Response.json({ transaction: updated ?? null });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Payment update failed." }, { status: 500 }); }
}

import { eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../../db";
import { paymentTransactions } from "../../../../db/schema";

function hex(bytes: ArrayBuffer) { return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function safeEqual(left: string, right: string) { if (left.length !== right.length) return false; let diff = 0; for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i); return diff === 0; }

async function verifyStripeSignature(payload: string, header: string, secret: string) {
  const pairs = header.split(",").map((part) => part.split("=", 2));
  const timestamp = pairs.find(([key]) => key === "t")?.[1] ?? "";
  const signatures = pairs.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return signatures.some((signature) => safeEqual(signature, expected));
}

export async function POST(request: Request) {
  try {
    const payload = await request.text();
    const signature = request.headers.get("stripe-signature") ?? "";
    const { env } = await import("cloudflare:workers");
    const secret = String((env as unknown as Record<string, unknown>).STRIPE_WEBHOOK_SECRET ?? "").trim();
    if (!secret || !(await verifyStripeSignature(payload, signature, secret))) return Response.json({ error: "Invalid Stripe webhook signature." }, { status: 400 });
    const event = JSON.parse(payload) as { type?: string; data?: { object?: { id?: string; payment_status?: string } } };
    const sessionId = String(event.data?.object?.id ?? "");
    if (!sessionId) return Response.json({ received: true });
    await ensureBaseTables();
    const db = await getDb();
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") await db.update(paymentTransactions).set({ status: "paid", settledAt: new Date().toISOString() }).where(eq(paymentTransactions.externalReference, sessionId));
    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") await db.update(paymentTransactions).set({ status: event.type.endsWith("failed") ? "failed" : "expired" }).where(eq(paymentTransactions.externalReference, sessionId));
    return Response.json({ received: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Webhook processing failed." }, { status: 500 }); }
}


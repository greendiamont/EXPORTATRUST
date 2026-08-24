export async function createX402Fetch(perPaymentLimitAtomic: bigint, cumulativeLimitAtomic: bigint) {
  const { env } = await import("cloudflare:workers");
  const runtime = env as unknown as Record<string, unknown>;
  const apiKeyId = String(runtime.CDP_API_KEY_ID ?? "").trim();
  const apiKeySecret = String(runtime.CDP_API_KEY_SECRET ?? "").trim();
  const walletSecret = String(runtime.CDP_WALLET_SECRET ?? "").trim();
  if (!apiKeyId || !apiKeySecret || !walletSecret) throw new Error("x402 wallet credentials are not configured.");
  const live = String(runtime.X402_LIVE_ENABLED ?? "").toLowerCase() === "true";
  const { CdpX402Client } = await import("@coinbase/cdp-sdk/x402");
  const { wrapFetchWithPayment } = await import("@x402/fetch");
  const asset = live ? "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" : "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
  const client = new CdpX402Client({
    apiKeyId, apiKeySecret, walletSecret, environment: live ? "production" : "development", builderCode: "exportatrust_eudr",
    spendControls: {
      maxAmountPerPayment: { atomic: perPaymentLimitAtomic, asset },
      maxCumulativeSpend: { atomic: cumulativeLimitAtomic, asset },
      maxCumulativeSpendWindow: "24h",
      allowedNetworks: [live ? "eip155:8453" : "eip155:84532"],
    },
  });
  return { fetchWithPayment: wrapFetchWithPayment(globalThis.fetch, client), live };
}


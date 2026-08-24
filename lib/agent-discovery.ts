export type DiscoveredExternalService = {
  source: "mcp" | "a2a";
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  endpoint: string;
  price?: number;
  currency?: string;
};

function normalizeServices(source: "mcp" | "a2a", payload: unknown): DiscoveredExternalService[] {
  const object = payload as Record<string, unknown>;
  const raw = Array.isArray(payload) ? payload : Array.isArray(object.services) ? object.services : Array.isArray(object.agents) ? object.agents : object.agent ? [object.agent] : [];
  return raw.slice(0, 100).map((value, index) => {
    const row = value as Record<string, unknown>;
    const capabilitiesRaw = row.capabilities ?? row.skills ?? [];
    const capabilities = Array.isArray(capabilitiesRaw) ? capabilitiesRaw.map((capability) => typeof capability === "string" ? capability : String((capability as Record<string, unknown>).id ?? (capability as Record<string, unknown>).name ?? "")).filter(Boolean) : [];
    return {
      source,
      id: String(row.id ?? row.agent_id ?? `${source}-${index + 1}`),
      name: String(row.name ?? row.title ?? row.id ?? `${source.toUpperCase()} service`),
      description: String(row.description ?? ""),
      capabilities,
      endpoint: String(row.endpoint ?? row.url ?? row.baseUrl ?? ""),
      price: row.price === undefined ? undefined : Number(row.price),
      currency: row.currency === undefined ? undefined : String(row.currency),
    };
  });
}

export async function discoverConfiguredExternalServices() {
  const { env } = await import("cloudflare:workers");
  const runtime = env as unknown as Record<string, unknown>;
  const sources: Array<{ source: "mcp" | "a2a"; url: string }> = [
    { source: "mcp", url: String(runtime.MCP_DISCOVERY_URL ?? "").trim() },
    { source: "a2a", url: String(runtime.A2A_DISCOVERY_URL ?? "").trim() },
  ].filter((item) => item.url);
  const results = await Promise.all(sources.map(async ({ source, url }) => {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { source, url, ok: true, services: normalizeServices(source, await response.json()), error: "" };
    } catch (error) {
      return { source, url, ok: false, services: [] as DiscoveredExternalService[], error: error instanceof Error ? error.message : "Discovery failed" };
    }
  }));
  return { configured: sources.length, sources: results, services: results.flatMap((result) => result.services), checkedAt: new Date().toISOString() };
}


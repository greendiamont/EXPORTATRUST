// Hook de resolução de módulos: `cloudflare:workers` → shim para Node.
const SHIM_URL = new URL("./cloudflare-workers-shim.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: SHIM_URL, shortCircuit: true };
  return nextResolve(specifier, context);
}

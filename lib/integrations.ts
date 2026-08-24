export type IntegrationState = "operational" | "credential_required" | "sandbox" | "disabled";

export type IntegrationStatus = {
  id: string;
  name: string;
  category: "data" | "intelligence" | "agents" | "eudr" | "payments";
  state: IntegrationState;
  label: string;
  detail: string;
  provider: string;
  live: boolean;
};

async function workerEnv() {
  const { env } = await import("cloudflare:workers");
  return env as unknown as Record<string, unknown>;
}

function has(env: Record<string, unknown>, ...keys: string[]) {
  return keys.every((key) => String(env[key] ?? "").trim().length > 0);
}

export async function getIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const env = await workerEnv();
  const google = has(env, "GOOGLE_MAPS_API_KEY");
  const openai = has(env, "OPENAI_API_KEY");
  const copernicus = has(env, "COPERNICUS_CLIENT_ID", "COPERNICUS_CLIENT_SECRET");
  const mcp = has(env, "MCP_DISCOVERY_URL");
  const a2a = has(env, "A2A_DISCOVERY_URL");
  const eudr = has(env, "EUDR_M2M_BASE_URL", "EUDR_CLIENT_ID", "EUDR_CLIENT_SECRET");
  const stripe = has(env, "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_IDS_JSON");
  const x402 = has(env, "CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET");
  const x402Live = x402 && String(env.X402_LIVE_ENABLED ?? "").toLowerCase() === "true";

  return [
    { id: "sicar", name: "SICAR / CAR", category: "data", state: "operational", label: "REAL · OPERACIONAL", detail: "Consulta CAR, coordenadas e UTM na base geoespacial pública; geometria fica vinculada à floresta.", provider: "SICAR", live: true },
    { id: "ibama", name: "IBAMA / PAMGIA", category: "data", state: "operational", label: "REAL · OPERACIONAL", detail: "Screening geoespacial de embargos pela camada pública oficial. Certificados CTF/CR continuam sujeitos à validação oficial do titular.", provider: "IBAMA", live: true },
    { id: "satellite", name: "Satellite imagery", category: "data", state: copernicus ? "operational" : "operational", label: google ? "REAL · GOOGLE + ESRI" : "REAL · ESRI", detail: copernicus ? "Imagem de referência e credenciais Copernicus disponíveis para análise temporal." : "Imagem real de referência via Esri World Imagery. Google é usado quando há chave. Copernicus temporal aguarda credenciais.", provider: google ? "Google / Esri" : "Esri", live: true },
    { id: "ocr", name: "OCR & Document Intelligence", category: "intelligence", state: openai ? "operational" : "credential_required", label: openai ? "REAL · OPERACIONAL" : "AGUARDANDO CREDENCIAL", detail: openai ? "Leitura multimodal dos documentos originais pelo Responses API, sem alterar o arquivo-fonte." : "Adapter instalado. Configure OPENAI_API_KEY para analisar PDFs e documentos reais.", provider: "OpenAI", live: openai },
    { id: "mcp", name: "MCP Agent Discovery", category: "agents", state: mcp ? "operational" : "credential_required", label: mcp ? "CONECTOR CONFIGURADO" : "AGUARDANDO ENDPOINT", detail: "Registry desacoplado preparado para descobrir serviços MCP autorizados.", provider: "MCP", live: mcp },
    { id: "a2a", name: "A2A Agent Discovery", category: "agents", state: a2a ? "operational" : "credential_required", label: a2a ? "CONECTOR CONFIGURADO" : "AGUARDANDO ENDPOINT", detail: "Adapter A2A preparado para catálogo externo; nenhum fornecedor fictício é exibido.", provider: "A2A", live: a2a },
    { id: "eudr", name: "EUDR Information System M2M", category: "eudr", state: eudr ? "sandbox" : "credential_required", label: eudr ? "ACCEPTANCE · PRONTO PARA HOMOLOGAÇÃO" : "AGUARDANDO CREDENCIAL M2M", detail: eudr ? "Credenciais detectadas. Submissão LIVE continua bloqueada até revisão humana e autorização explícita." : "Payload e trilha pré-DDS estão prontos; transmissão oficial depende das credenciais M2M do operador/representante e da especificação vigente.", provider: "European Commission / TRACES", live: false },
    { id: "stripe", name: "Stripe Checkout · Cartão + Pix", category: "payments", state: stripe ? "operational" : "credential_required", label: stripe ? "INSTALADO · CREDENCIAIS OK" : "INSTALADO · AGUARDANDO CREDENCIAL", detail: stripe ? "Checkout hospedado e webhook podem registrar cobranças do catálogo autorizado." : "Rail instalado sem coleta de cartão no app. Configure chave, webhook e IDs de preço; habilite Pix na conta Stripe elegível.", provider: "Stripe", live: stripe },
    { id: "x402", name: "x402 Machine-to-Machine", category: "payments", state: !x402 ? "credential_required" : x402Live ? "operational" : "sandbox", label: !x402 ? "SDK INSTALADO · AGUARDANDO WALLET" : x402Live ? "MAINNET · AUTORIZAÇÃO OBRIGATÓRIA" : "BASE TESTNET · SANDBOX", detail: "Cliente x402 oficial instalado com CDP wallet e spend controls. Pagamentos de agentes respeitam aprovação, limite por transação e limite diário.", provider: "Coinbase CDP / x402", live: x402Live },
  ];
}


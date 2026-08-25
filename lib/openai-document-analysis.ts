export type DocumentAnalysis = {
  documentType: "commercial_invoice" | "packing_list" | "bill_of_lading" | "certificate_of_origin" | "phytosanitary_certificate" | "heat_treatment_certificate" | "other" | "unknown";
  summary: string;
  language: string;
  confidence: number;
  fields: {
    invoiceNumber: string | null;
    blNumber: string | null;
    exporter: string | null;
    importer: string | null;
    destinationCountry: string | null;
    destinationPort: string | null;
    currency: string | null;
    totalAmount: string | null;
    balanceDue: string | null;
    paymentTerms: string | null;
    issueDate: string | null;
    containers: number | null;
  };
  checks: Array<{
    name: string;
    status: "ok" | "warning" | "missing";
    details: string;
    evidence: string;
  }>;
  warnings: string[];
};

type OpenAIResponse = {
  error?: { message?: string };
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
};

const DOCUMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["documentType", "summary", "language", "confidence", "fields", "checks", "warnings"],
  properties: {
    documentType: {
      type: "string",
      enum: [
        "commercial_invoice",
        "packing_list",
        "bill_of_lading",
        "certificate_of_origin",
        "phytosanitary_certificate",
        "heat_treatment_certificate",
        "other",
        "unknown",
      ],
    },
    summary: { type: "string" },
    language: { type: "string" },
    confidence: { type: "number" },
    fields: {
      type: "object",
      additionalProperties: false,
      required: [
        "invoiceNumber",
        "blNumber",
        "exporter",
        "importer",
        "destinationCountry",
        "destinationPort",
        "currency",
        "totalAmount",
        "balanceDue",
        "paymentTerms",
        "issueDate",
        "containers",
      ],
      properties: {
        invoiceNumber: { type: ["string", "null"] },
        blNumber: { type: ["string", "null"] },
        exporter: { type: ["string", "null"] },
        importer: { type: ["string", "null"] },
        destinationCountry: { type: ["string", "null"] },
        destinationPort: { type: ["string", "null"] },
        currency: { type: ["string", "null"] },
        totalAmount: { type: ["string", "null"] },
        balanceDue: { type: ["string", "null"] },
        paymentTerms: { type: ["string", "null"] },
        issueDate: { type: ["string", "null"] },
        containers: { type: ["integer", "null"] },
      },
    },
    checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "status", "details", "evidence"],
        properties: {
          name: { type: "string" },
          status: { type: "string", enum: ["ok", "warning", "missing"] },
          details: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

const SUPPORTED_FILE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "application/json",
]);

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function dataUrl(bytes: Uint8Array, contentType: string) {
  return `data:${contentType};base64,${bytesToBase64(bytes)}`;
}

export function extractResponseText(response: OpenAIResponse) {
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" && content.refusal) {
        throw new Error(`A OpenAI recusou a análise: ${content.refusal}`);
      }
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("A OpenAI não retornou uma análise utilizável.");
}

export async function analyzeDocumentWithOpenAI(input: {
  apiKey: string;
  model?: string;
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
  operationContext?: string;
  fetchImpl?: typeof fetch;
}): Promise<DocumentAnalysis> {
  if (!input.apiKey.trim()) throw new Error("OPENAI_API_KEY não configurada.");
  if (input.bytes.byteLength === 0) throw new Error("O documento está vazio.");
  if (input.bytes.byteLength > 20 * 1024 * 1024) throw new Error("O documento excede o limite de 20 MB.");

  const normalizedType = input.contentType.split(";")[0].trim().toLowerCase();
  const isImage = SUPPORTED_IMAGE_TYPES.has(normalizedType);
  if (!isImage && !SUPPORTED_FILE_TYPES.has(normalizedType)) {
    throw new Error(`Formato não suportado para leitura por IA: ${normalizedType || "desconhecido"}.`);
  }

  const encoded = dataUrl(input.bytes, normalizedType);
  const attachment = isImage
    ? { type: "input_image", image_url: encoded, detail: "high" }
    : { type: "input_file", filename: input.fileName, file_data: encoded, detail: normalizedType === "application/pdf" ? "high" : undefined };

  const prompt = [
    "Você é o analista documental do ExportaTrust.",
    "Leia somente as informações comprovadas pelo documento anexado.",
    "Não invente valores. Quando um dado não estiver legível ou não existir, retorne null e registre uma advertência.",
    "Identifique o tipo documental e extraia dados úteis para Export Control e Shipment Advice.",
    "Confira coerência básica de partes, datas, números, valores, pagamento, destino e contêineres.",
    "O parecer é informativo e nunca substitui aprovação humana.",
    input.operationContext ? `Contexto cadastrado da operação para comparação: ${input.operationContext}` : "",
  ].filter(Boolean).join("\n");

  const requestBody = {
    model: input.model?.trim() || "gpt-5.6-terra",
    store: false,
    input: [{
      role: "user",
      content: [
        attachment,
        { type: "input_text", text: prompt },
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "exportatrust_document_analysis",
        strict: true,
        schema: DOCUMENT_SCHEMA,
      },
    },
  };

  const response = await (input.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const payload = await response.json() as OpenAIResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `Falha na OpenAI (HTTP ${response.status}).`);
  }

  const parsed = JSON.parse(extractResponseText(payload)) as DocumentAnalysis;
  return parsed;
}

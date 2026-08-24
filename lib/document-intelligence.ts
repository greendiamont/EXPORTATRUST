type DocumentSource = { objectKey: string; fileName: string; contentType: string };
type IntelligenceContext = { operationReference: string; stageCategory: string; capability: string };

export type DocumentIntelligenceResult = {
  summary: string;
  confidence: number;
  structured: Record<string, unknown>;
  model: string;
};

function outputText(payload: unknown) {
  const data = payload as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  if (data.output_text) return data.output_text;
  return (data.output ?? []).flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n").trim();
}

function parseJsonText(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch { return { summary: text, confidence: 75, fields: {}, alerts: ["Structured JSON parsing was not available for this response."] }; }
}

export async function analyzeImmutableDocument(source: DocumentSource, context: IntelligenceContext): Promise<DocumentIntelligenceResult | null> {
  const { env } = await import("cloudflare:workers");
  const runtime = env as unknown as Record<string, unknown> & { BUCKET?: R2Bucket };
  const apiKey = String(runtime.OPENAI_API_KEY ?? "").trim();
  if (!apiKey || !runtime.BUCKET) return null;
  const object = await runtime.BUCKET.get(source.objectKey);
  if (!object) throw new Error("The immutable source document is missing from storage.");
  if (object.size > 20 * 1024 * 1024) throw new Error("Document Intelligence accepts files up to 20 MB in this application.");

  const bytes = await object.arrayBuffer();
  const model = String(runtime.OPENAI_DOCUMENT_MODEL ?? "gpt-5.6").trim() || "gpt-5.6";
  const prompt = `You are the document-intelligence layer of an EUDR due-diligence system. Analyze this immutable source document for operation ${context.operationReference}, supply-chain stage ${context.stageCategory}, requested capability ${context.capability}. Return ONLY a JSON object in English with keys: summary (concise), document_type, issuer, parties, dates, identifiers, invoice_number, currency, total_invoice, amount_paid, balance_due, payment_terms, quantities, lot_or_traceability_references, legality_or_certificate_fields, inconsistencies (array), missing_expected_fields (array), eudr_relevance, confidence (0-100). Monetary fields must be JSON numbers without currency symbols or thousands separators. Never calculate or invent unreadable or absent values; use null and flag uncertainty.`;
  let fileId = "";
  try {
    let content: Record<string, unknown>[];
    if (source.contentType.startsWith("image/")) {
      const base64 = arrayBufferToBase64(bytes);
      content = [{ type: "input_image", image_url: `data:${source.contentType};base64,${base64}`, detail: "high" }, { type: "input_text", text: prompt }];
    } else {
      const form = new FormData();
      form.append("purpose", "user_data");
      form.append("file", new File([bytes], source.fileName, { type: source.contentType || "application/octet-stream" }));
      const uploaded = await fetch("https://api.openai.com/v1/files", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
      if (!uploaded.ok) throw new Error(`OpenAI file upload failed (${uploaded.status}).`);
      fileId = String(((await uploaded.json()) as { id?: string }).id ?? "");
      if (!fileId) throw new Error("OpenAI did not return a file identifier.");
      content = [{ type: "input_file", file_id: fileId, ...(source.contentType === "application/pdf" ? { detail: "high" } : {}) }, { type: "input_text", text: prompt }];
    }
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: [{ role: "user", content }], max_output_tokens: 1800 }),
    });
    if (!response.ok) throw new Error(`OpenAI document analysis failed (${response.status}).`);
    const structured = parseJsonText(outputText(await response.json()));
    const summary = String(structured.summary ?? "Document analyzed; review the structured findings.");
    const confidence = Math.max(0, Math.min(100, Number(structured.confidence ?? 75) || 75));
    return { summary, confidence, structured, model };
  } finally {
    if (fileId) fetch(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } }).catch(() => undefined);
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeDocumentWithOpenAI,
  extractResponseText,
} from "../lib/openai-document-analysis.ts";

const validAnalysis = {
  documentType: "commercial_invoice",
  summary: "Commercial invoice",
  language: "en",
  confidence: 0.98,
  fields: {
    invoiceNumber: "GBU003-26",
    blNumber: null,
    exporter: "VJ RAUBER E CIA LTDA",
    importer: "SPRUCE WOOD",
    destinationCountry: "India",
    destinationPort: "Nhava Sheva",
    currency: "USD",
    totalAmount: "10000.00",
    balanceDue: "2000.00",
    paymentTerms: "20% advance / 80% balance",
    issueDate: "2026-08-20",
    containers: 3,
  },
  checks: [{
    name: "Invoice number",
    status: "ok",
    details: "Located",
    evidence: "GBU003-26",
  }],
  warnings: [],
};

test("extractResponseText reads Responses API output", () => {
  const text = extractResponseText({
    output: [{ content: [{ type: "output_text", text: JSON.stringify(validAnalysis) }] }],
  });
  assert.equal(JSON.parse(text).fields.invoiceNumber, "GBU003-26");
});

test("analyzeDocumentWithOpenAI sends the file without exposing the API key in its body", async () => {
  let capturedRequest;
  const analysis = await analyzeDocumentWithOpenAI({
    apiKey: "secret-test-key",
    model: "gpt-5.6-terra",
    bytes: new TextEncoder().encode("invoice fixture"),
    contentType: "text/plain",
    fileName: "invoice.txt",
    operationContext: "Operation SA0600284400",
    fetchImpl: async (url, init) => {
      capturedRequest = { url, init };
      return new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(validAnalysis) }] }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(analysis.documentType, "commercial_invoice");
  assert.equal(capturedRequest.url, "https://api.openai.com/v1/responses");
  assert.equal(capturedRequest.init.headers.authorization, "Bearer secret-test-key");
  const body = capturedRequest.init.body;
  assert.equal(body.includes("secret-test-key"), false);
  assert.equal(JSON.parse(body).store, false);
  assert.equal(JSON.parse(body).text.format.strict, true);
});

test("analyzeDocumentWithOpenAI rejects unsupported formats before calling the API", async () => {
  await assert.rejects(
    analyzeDocumentWithOpenAI({
      apiKey: "secret-test-key",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/zip",
      fileName: "archive.zip",
      fetchImpl: async () => {
        throw new Error("fetch should not run");
      },
    }),
    /Formato não suportado/,
  );
});

test("extractResponseText surfaces model refusals", () => {
  assert.throws(
    () => extractResponseText({
      output: [{ content: [{ type: "refusal", refusal: "Unable to process" }] }],
    }),
    /recusou a análise/,
  );
});

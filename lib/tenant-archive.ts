import type { SecurityContext } from "./security";
import { tenantExport } from "./tenant-export";

const encoder = new TextEncoder();
const BLOCK_SIZE = 512;

function safePath(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._/-]+/g, "-").replace(/-+/g, "-").replace(/^[-/]+/, "").slice(-100) || "arquivo";
}

function writeText(target: Uint8Array, offset: number, width: number, value: string) {
  target.set(encoder.encode(value).slice(0, width), offset);
}

function writeOctal(target: Uint8Array, offset: number, width: number, value: number) {
  writeText(target, offset, width, Math.max(0, value).toString(8).padStart(width - 1, "0") + "\0");
}

function tarHeader(path: string, size: number, modifiedAt = Date.now()) {
  const header = new Uint8Array(BLOCK_SIZE);
  writeText(header, 0, 100, safePath(path));
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(modifiedAt / 1000));
  header.fill(32, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeText(header, 257, 6, "ustar\0");
  writeText(header, 263, 2, "00");
  writeText(header, 265, 32, "ExportaTrust");
  writeText(header, 297, 32, "ExportaTrust");
  const checksum = header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0");
  writeText(header, 148, 8, `${checksum}\0 `);
  return header;
}

async function* archiveChunks(manifestBytes: Uint8Array, documents: Array<{ path: string; objectKey: string }>, bucket: R2Bucket) {
  yield tarHeader("exportatrust-manifest.json", manifestBytes.byteLength);
  yield manifestBytes;
  const manifestPadding = (BLOCK_SIZE - (manifestBytes.byteLength % BLOCK_SIZE)) % BLOCK_SIZE;
  if (manifestPadding) yield new Uint8Array(manifestPadding);

  for (const document of documents) {
    const object = await bucket.get(document.objectKey);
    if (!object) {
      const missing = encoder.encode(`Arquivo não localizado no armazenamento: ${document.objectKey}\n`);
      yield tarHeader(`${document.path}.missing.txt`, missing.byteLength);
      yield missing;
      const padding = (BLOCK_SIZE - (missing.byteLength % BLOCK_SIZE)) % BLOCK_SIZE;
      if (padding) yield new Uint8Array(padding);
      continue;
    }
    yield tarHeader(document.path, object.size, object.uploaded?.getTime() ?? Date.now());
    const reader = object.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value?.byteLength) yield value;
    }
    const padding = (BLOCK_SIZE - (object.size % BLOCK_SIZE)) % BLOCK_SIZE;
    if (padding) yield new Uint8Array(padding);
  }
  yield new Uint8Array(BLOCK_SIZE * 2);
}

export async function createTenantArchive(context: SecurityContext) {
  const payload = await tenantExport(context.organizationId);
  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) throw new Error("Armazenamento privado indisponível.");
  const documents = [
    ...payload.data.operationDocuments.map((document) => ({ path: `processos/${document.operationId}/${document.id}-${safePath(document.fileName)}`, objectKey: document.objectKey })),
    ...payload.data.forestDocuments.map((document) => ({ path: `florestas/${safePath(document.propertyCarCode)}/${document.id}-${safePath(document.fileName)}`, objectKey: document.objectKey })),
  ];
  const manifest = { ...payload, archive: { format: "POSIX TAR", documentCount: documents.length, includesOriginalBytes: true } };
  const iterator = archiveChunks(encoder.encode(JSON.stringify(manifest, null, 2)), documents, env.BUCKET)[Symbol.asyncIterator]();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) { controller.error(error); }
    },
    async cancel() { await iterator.return?.(); },
  });
  return { stream, documentCount: documents.length };
}

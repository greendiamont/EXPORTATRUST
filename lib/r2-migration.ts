const encoder = new TextEncoder();
const BLOCK_SIZE = 512;

export type R2MigrationObject = {
  index: number;
  archivePath: string;
  key: string;
  size: number;
  etag: string;
  uploaded: string | null;
  httpMetadata: Record<string, unknown>;
  customMetadata: Record<string, string>;
};

export type R2MigrationManifest = {
  format: "ExportaTrust Full R2 Export v1";
  generatedAt: string;
  objectCount: number;
  totalBytes: number;
  objects: R2MigrationObject[];
};

function writeText(target: Uint8Array, offset: number, width: number, value: string) {
  target.set(encoder.encode(value).slice(0, width), offset);
}

function writeOctal(target: Uint8Array, offset: number, width: number, value: number) {
  writeText(target, offset, width, Math.max(0, value).toString(8).padStart(width - 1, "0") + "\0");
}

function tarHeader(path: string, size: number, modifiedAt = Date.now()) {
  const header = new Uint8Array(BLOCK_SIZE);
  writeText(header, 0, 100, path);
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

export async function buildR2Manifest(bucket: R2Bucket): Promise<R2MigrationManifest> {
  const objects: R2MigrationObject[] = [];
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({
      limit: 1000,
      cursor,
      include: ["httpMetadata", "customMetadata"],
    });
    for (const item of listed.objects) {
      const index = objects.length + 1;
      objects.push({
        index,
        archivePath: `objects/${String(index).padStart(6, "0")}.bin`,
        key: item.key,
        size: item.size,
        etag: item.etag,
        uploaded: item.uploaded ? item.uploaded.toISOString() : null,
        httpMetadata: (item.httpMetadata ?? {}) as Record<string, unknown>,
        customMetadata: (item.customMetadata ?? {}) as Record<string, string>,
      });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return {
    format: "ExportaTrust Full R2 Export v1",
    generatedAt: new Date().toISOString(),
    objectCount: objects.length,
    totalBytes: objects.reduce((sum, item) => sum + item.size, 0),
    objects,
  };
}

async function* archiveChunks(manifest: R2MigrationManifest, bucket: R2Bucket) {
  const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 2));
  yield tarHeader("exportatrust-r2-manifest.json", manifestBytes.byteLength);
  yield manifestBytes;
  const manifestPadding = (BLOCK_SIZE - (manifestBytes.byteLength % BLOCK_SIZE)) % BLOCK_SIZE;
  if (manifestPadding) yield new Uint8Array(manifestPadding);

  for (const item of manifest.objects) {
    const object = await bucket.get(item.key);
    if (!object) throw new Error(`Objeto R2 desapareceu durante a exportação: ${item.key}`);
    if (object.size !== item.size) throw new Error(`Tamanho alterado durante a exportação: ${item.key}`);
    yield tarHeader(item.archivePath, object.size, object.uploaded?.getTime() ?? Date.now());
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

export function createFullR2Archive(manifest: R2MigrationManifest, bucket: R2Bucket) {
  const iterator = archiveChunks(manifest, bucket)[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

// Adaptador com a API do Cloudflare R2 (get/head/put/delete/list) sobre qualquer
// storage compatível com S3 (bucket do Railway, o próprio R2 via endpoint S3, MinIO...).

import { AwsClient } from "aws4fetch";

function encodeKey(key) {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function xmlValues(xml, tag) {
  const values = [];
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  for (const match of xml.matchAll(pattern)) values.push(match[1]);
  return values;
}

function xmlDecode(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

const HTTP_METADATA_HEADERS = {
  contentType: "content-type",
  contentLanguage: "content-language",
  contentDisposition: "content-disposition",
  contentEncoding: "content-encoding",
  cacheControl: "cache-control",
};

function objectFromHeaders(key, headers) {
  const httpMetadata = {};
  for (const [field, header] of Object.entries(HTTP_METADATA_HEADERS)) {
    const value = headers.get(header);
    if (value) httpMetadata[field] = value;
  }
  const expires = headers.get("expires");
  if (expires) httpMetadata.cacheExpiry = new Date(expires);
  const customMetadata = {};
  headers.forEach((value, name) => {
    if (name.startsWith("x-amz-meta-")) customMetadata[name.slice("x-amz-meta-".length)] = decodeURIComponent(value);
  });
  const httpEtag = headers.get("etag") ?? "";
  const lastModified = headers.get("last-modified");
  return new R2Object({
    key,
    size: Number(headers.get("content-length") ?? 0),
    etag: httpEtag.replaceAll('"', ""),
    httpEtag,
    uploaded: lastModified ? new Date(lastModified) : new Date(),
    httpMetadata,
    customMetadata,
  });
}

class R2Object {
  constructor(fields) {
    Object.assign(this, { version: fields.etag, checksums: {}, storageClass: "Standard" }, fields);
  }

  writeHttpMetadata(headers) {
    for (const [field, header] of Object.entries(HTTP_METADATA_HEADERS)) {
      if (this.httpMetadata?.[field]) headers.set(header, this.httpMetadata[field]);
    }
  }
}

class R2ObjectBody extends R2Object {
  constructor(fields, response) {
    super(fields);
    this.response = response;
  }

  get body() {
    return this.response.body;
  }

  get bodyUsed() {
    return this.response.bodyUsed;
  }

  arrayBuffer() {
    return this.response.arrayBuffer();
  }

  text() {
    return this.response.text();
  }

  json() {
    return this.response.json();
  }

  blob() {
    return this.response.blob();
  }

  bytes() {
    return this.response.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
}

async function toBytes(value) {
  if (value === null || value === undefined) return new Uint8Array();
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof Blob !== "undefined" && value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  // ReadableStream: o S3 exige Content-Length, então o corpo é bufferizado.
  return new Uint8Array(await new Response(value).arrayBuffer());
}

export class R2S3Bucket {
  /**
   * @param {{ endpoint: string, bucket: string, accessKeyId: string, secretAccessKey: string, region?: string, virtualHosted?: boolean }} config
   */
  constructor(config) {
    this.config = config;
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region || "auto",
      service: "s3",
      retries: 2,
    });
    const endpoint = new URL(config.endpoint);
    this.base = config.virtualHosted
      ? `${endpoint.protocol}//${config.bucket}.${endpoint.host}`
      : `${endpoint.origin}/${encodeURIComponent(config.bucket)}`;
  }

  url(key = "", query) {
    const url = new URL(`${this.base}/${encodeKey(key)}`);
    if (query) for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, String(value));
    return url.toString();
  }

  async request(method, key, init = {}, query) {
    const response = await this.client.fetch(this.url(key, query), { method, ...init });
    if (!response.ok && response.status !== 404 && response.status !== 304 && response.status !== 412) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Storage S3 ${method} ${key || "/"} falhou: HTTP ${response.status} ${detail.slice(0, 300)}`);
    }
    return response;
  }

  async head(key) {
    const response = await this.request("HEAD", key);
    if (response.status === 404) return null;
    return objectFromHeaders(key, response.headers);
  }

  async get(key, options = {}) {
    const headers = {};
    const range = options.range;
    if (range) {
      if ("suffix" in range) headers.range = `bytes=-${range.suffix}`;
      else headers.range = `bytes=${range.offset ?? 0}-${range.length !== undefined ? (range.offset ?? 0) + range.length - 1 : ""}`;
    }
    const response = await this.request("GET", key, { headers });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    const object = objectFromHeaders(key, response.headers);
    return new R2ObjectBody({ ...object }, response);
  }

  async put(key, value, options = {}) {
    const bytes = await toBytes(value);
    const headers = { "content-length": String(bytes.byteLength) };
    const httpMetadata = options.httpMetadata instanceof Headers
      ? Object.fromEntries(Object.entries(HTTP_METADATA_HEADERS).map(([field, header]) => [field, options.httpMetadata.get(header)]).filter(([, v]) => v))
      : options.httpMetadata ?? {};
    for (const [field, header] of Object.entries(HTTP_METADATA_HEADERS)) {
      if (httpMetadata[field]) headers[header] = httpMetadata[field];
    }
    for (const [name, value] of Object.entries(options.customMetadata ?? {})) {
      headers[`x-amz-meta-${name.toLowerCase()}`] = encodeURIComponent(String(value));
    }
    const response = await this.request("PUT", key, { headers, body: bytes });
    const httpEtag = response.headers.get("etag") ?? "";
    return new R2Object({
      key,
      size: bytes.byteLength,
      etag: httpEtag.replaceAll('"', ""),
      httpEtag,
      uploaded: new Date(),
      httpMetadata,
      customMetadata: options.customMetadata ?? {},
    });
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) await this.request("DELETE", key);
  }

  async list(options = {}) {
    const response = await this.request("GET", "", {}, {
      "list-type": 2,
      prefix: options.prefix,
      delimiter: options.delimiter,
      "continuation-token": options.cursor,
      "start-after": options.startAfter,
      "max-keys": Math.min(options.limit ?? 1000, 1000),
    });
    const xml = await response.text();
    const objects = xmlValues(xml, "Contents").map((entry) => {
      const httpEtag = xmlDecode(xmlValues(entry, "ETag")[0] ?? "");
      return new R2Object({
        key: xmlDecode(xmlValues(entry, "Key")[0] ?? ""),
        size: Number(xmlValues(entry, "Size")[0] ?? 0),
        etag: httpEtag.replaceAll('"', ""),
        httpEtag,
        uploaded: new Date(xmlValues(entry, "LastModified")[0] ?? Date.now()),
        httpMetadata: {},
        customMetadata: {},
      });
    });
    // O ListObjects do S3 não traz metadados; quando pedidos, busca via HEAD.
    const include = options.include ?? [];
    if (include.includes("httpMetadata") || include.includes("customMetadata")) {
      for (const [index, object] of objects.entries()) {
        const detailed = await this.head(object.key);
        if (detailed) objects[index] = new R2Object({ ...object, httpMetadata: detailed.httpMetadata, customMetadata: detailed.customMetadata });
      }
    }
    const truncated = xmlValues(xml, "IsTruncated")[0] === "true";
    const cursor = truncated ? xmlDecode(xmlValues(xml, "NextContinuationToken")[0] ?? "") : undefined;
    const delimitedPrefixes = xmlValues(xml, "CommonPrefixes").map((entry) => xmlDecode(xmlValues(entry, "Prefix")[0] ?? ""));
    return truncated ? { objects, truncated, cursor, delimitedPrefixes } : { objects, truncated, delimitedPrefixes };
  }

  createMultipartUpload() {
    throw new Error("Upload multipart não é suportado no adaptador S3.");
  }
}

/** Bucket em memória para testes locais sem storage externo. */
export class MemoryBucket {
  constructor() {
    this.objects = new Map();
  }

  async head(key) {
    const stored = this.objects.get(key);
    return stored ? new R2Object(stored.meta) : null;
  }

  async get(key) {
    const stored = this.objects.get(key);
    return stored ? new R2ObjectBody(stored.meta, new Response(stored.bytes.slice())) : null;
  }

  async put(key, value, options = {}) {
    const bytes = await toBytes(value);
    const etag = `${bytes.byteLength.toString(16)}-${Date.now().toString(16)}`;
    const meta = { key, size: bytes.byteLength, etag, httpEtag: `"${etag}"`, uploaded: new Date(), httpMetadata: options.httpMetadata ?? {}, customMetadata: options.customMetadata ?? {} };
    this.objects.set(key, { bytes, meta });
    return new R2Object(meta);
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async list(options = {}) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(options.prefix ?? "")).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit ?? 1000;
    const page = keys.slice(start, start + limit);
    const truncated = start + limit < keys.length;
    const objects = page.map((key) => new R2Object(this.objects.get(key).meta));
    return truncated ? { objects, truncated, cursor: String(start + limit), delimitedPrefixes: [] } : { objects, truncated, delimitedPrefixes: [] };
  }
}

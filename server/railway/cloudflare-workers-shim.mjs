// Implementação de `cloudflare:workers` para Node (Railway).
// O código da aplicação faz `const { env } = await import("cloudflare:workers")`;
// o hook em hooks.mjs aponta esse import para cá.
//
// - env.DB     → PostgreSQL (DATABASE_URL) com API do D1
// - env.BUCKET → storage S3 (STORAGE_S3_*) com API do R2
// - demais chaves → process.env (OPENAI_API_KEY, GOOGLE_CLIENT_ID, ...)

import { D1PostgresDatabase } from "./d1-postgres.mjs";
import { MemoryBucket, R2S3Bucket } from "./r2-s3.mjs";

function createDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return undefined;
  return new D1PostgresDatabase({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

function createBucket() {
  if (process.env.STORAGE_DRIVER === "memory") {
    if (process.env.APP_ENV === "production") throw new Error("STORAGE_DRIVER=memory não é permitido em produção.");
    console.warn("[storage] usando bucket EM MEMÓRIA — arquivos são perdidos ao reiniciar (somente testes locais).");
    return new MemoryBucket();
  }
  const { STORAGE_S3_ENDPOINT, STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY } = process.env;
  if (!STORAGE_S3_ENDPOINT || !STORAGE_S3_BUCKET || !STORAGE_S3_ACCESS_KEY_ID || !STORAGE_S3_SECRET_ACCESS_KEY) return undefined;
  return new R2S3Bucket({
    endpoint: STORAGE_S3_ENDPOINT,
    bucket: STORAGE_S3_BUCKET,
    accessKeyId: STORAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: STORAGE_S3_SECRET_ACCESS_KEY,
    region: process.env.STORAGE_S3_REGION || "auto",
    virtualHosted: process.env.STORAGE_S3_URL_STYLE === "virtual",
  });
}

export const bindings = {
  DB: createDatabase(),
  BUCKET: createBucket(),
};

export const env = new Proxy(bindings, {
  get(target, property) {
    if (typeof property !== "string") return undefined;
    if (property in target) return target[property];
    return process.env[property];
  },
  has(target, property) {
    return property in target || (typeof property === "string" && property in process.env);
  },
});

export function waitUntil(promise) {
  Promise.resolve(promise).catch((error) => console.error("[waitUntil]", error));
}

import { gunzipSync } from "node:zlib";

// Importação de cadastros na inicialização (somente homologação).
//
// Quando EXPORTATRUST_REGISTRY_IMPORT_B64 (fornecedores, clientes e produtos, nesta ordem)
// ou EXPORTATRUST_SUPPLIER_IMPORT_B64 (só fornecedores) traz o JSON exportado do app antigo
// em base64, o servidor chama as mesmas rotas da tela (POST /api/suppliers/import e
// /api/registry-import) em nome do
// administrador da empresa de destino. Valem as mesmas regras: prévia antes, nada é
// apagado, fornecedor existente só tem campos vazios completados, auditoria completa.
//
// Destino: EXPORTATRUST_SUPPLIER_IMPORT_ORG_IDS (lista de ids) ou, se ausente, a única
// empresa criada pelo cadastro por CNPJ. Com mais de uma candidata nada é importado.
// Os dados ficam só na variável do serviço — nunca no repositório — e a variável deve
// ser removida depois da importação.

// Em produção a importação só roda com liberação explícita para a carga inicial, autorizada por
// Ivam em 2026-10-16 ("pode liberar a importação em produção"). A variável é removida junto
// com as de importação logo depois da carga.
function productionImportAllowed() {
  return process.env.EXPORTATRUST_IMPORT_IN_PRODUCTION === "1";
}

const STEPS = {
  fornecedores: { path: "/api/suppliers/import" },
  clientes: { path: "/api/registry-import", kind: "clientes" },
  produtos: { path: "/api/registry-import", kind: "produtos" },
  processos: { path: "/api/process-import" },
};

// Conteúdo da importação: variável única ou partes numeradas (…_B64_1, …_B64_2, …), para
// arquivos maiores que o limite de uma variável. Prefixo "gz:" indica JSON comprimido (gzip).
function readEncoded(name) {
  if (process.env[name]) return process.env[name];
  const parts = [];
  for (let index = 1; process.env[`${name}_${index}`]; index += 1) parts.push(process.env[`${name}_${index}`]);
  return parts.join("");
}

function decode(encoded) {
  const compressed = encoded.startsWith("gz:");
  const bytes = Buffer.from(compressed ? encoded.slice(3) : encoded, "base64");
  return JSON.parse((compressed ? gunzipSync(bytes) : bytes).toString("utf8"));
}

async function targetOrganizations(pool) {
  const explicit = String(process.env.EXPORTATRUST_SUPPLIER_IMPORT_ORG_IDS ?? "").split(",").map((value) => Number(value.trim())).filter((value) => Number.isSafeInteger(value) && value > 0);
  const params = [];
  let filter;
  if (explicit.length) {
    params.push(explicit);
    filter = "o.id = ANY($1::int[])";
  } else {
    filter = "o.id IN (SELECT organization_id FROM railway_company_registrations WHERE organization_id IS NOT NULL)";
  }
  const { rows } = await pool.query(`
    SELECT o.id, o.name,
      (SELECT u.email FROM organization_memberships m JOIN app_users u ON u.id = m.user_id
        WHERE m.organization_id = o.id AND m.role = 'administrador' AND m.status = 'Ativo' AND u.status = 'Ativo'
        ORDER BY m.id LIMIT 1) AS admin_email
    FROM organizations o WHERE ${filter} ORDER BY o.id`, params);
  return { rows, explicit: explicit.length > 0 };
}

async function callImport(worker, env, ctx, organizationId, email, payload, dryRun, step) {
  const request = new Request(`http://railway.invalid${step.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-exportatrust-authenticated-user-email": email,
      "x-exportatrust-authenticated-user-name": email,
      "x-exportatrust-auth-provider": "railway-startup-import",
      cookie: `exportatrust_org=${organizationId}`,
    },
    body: JSON.stringify({ kind: step.kind, payload, dryRun }),
  });
  const response = await worker.fetch(request, env, ctx);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error ?? "sem detalhe"}`);
  return body;
}

export async function runStartupSupplierImport({ pool, worker, env, ctx, appEnv }) {
  const processes = readEncoded("EXPORTATRUST_PROCESS_IMPORT_B64");
  const full = readEncoded("EXPORTATRUST_REGISTRY_IMPORT_B64");
  const encoded = processes || full || process.env.EXPORTATRUST_SUPPLIER_IMPORT_B64;
  if (!encoded) return;
  if (appEnv === "production" && !productionImportAllowed()) {
    console.warn("[importação] variável de importação ignorada em produção (carga inicial exige EXPORTATRUST_IMPORT_IN_PRODUCTION=1, autorizada por Ivam).");
    return;
  }
  const steps = processes ? ["fornecedores", "clientes", "produtos", "processos"] : full ? ["fornecedores", "clientes", "produtos"] : ["fornecedores"];
  let payload;
  try {
    payload = decode(encoded);
  } catch {
    console.error("[importação] a variável de importação não contém um JSON válido (base64 ou gz:base64).");
    return;
  }
  try {
    const { rows, explicit } = await targetOrganizations(pool);
    if (!rows.length) {
      console.warn("[importação] nenhuma empresa de destino encontrada; nada importado.");
      return;
    }
    if (rows.length > 1 && !explicit) {
      console.warn(`[importação] ${rows.length} empresas candidatas (${rows.map((row) => `#${row.id} ${row.name}`).join("; ")}). Defina EXPORTATRUST_SUPPLIER_IMPORT_ORG_IDS; nada importado.`);
      return;
    }
    for (const organization of rows) {
      if (!organization.admin_email) {
        console.warn(`[importação] empresa #${organization.id} ${organization.name} sem administrador ativo; ignorada.`);
        continue;
      }
      for (const name of steps) {
        const step = STEPS[name];
        try {
          const preview = await callImport(worker, env, ctx, organization.id, organization.admin_email, payload, true, step);
          const pending = preview.summary.criar + preview.summary.completar;
          if (!pending) {
            console.log(`[importação] ${name} → empresa #${organization.id} ${preview.organization}: ${preview.summary.total} já estavam cadastrados; nada a fazer.`);
            continue;
          }
          const result = await callImport(worker, env, ctx, organization.id, organization.admin_email, payload, false, step);
          const { total, criar, completar, existentes, ignorados } = result.summary;
          console.log(`[importação] ${name} → empresa #${organization.id} ${result.organization}: ${total} no arquivo → ${criar} criado(s), ${completar} completado(s), ${existentes} já existiam, ${ignorados} ignorado(s).`);
        } catch (error) {
          console.error(`[importação] ${name} falhou:`, error instanceof Error ? error.message : error);
        }
      }
    }
  } catch (error) {
    console.error("[importação] falhou:", error instanceof Error ? error.message : error);
  }
}

// Arquivos do app antigo (somente homologação): EXPORTATRUST_FILES_IMPORT_URL aponta para o
// pacote "ExportaTrust Full R2 Export v1" (.tar com manifesto + objetos). Cada arquivo vai
// para o storage com a mesma chave e metadados; arquivos já presentes com o mesmo tamanho são
// pulados. Depois, o backup mais recente do pacote é usado para ligar os documentos aos
// processos já importados (POST /api/document-import), na mesma empresa de destino.

function readTar(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const start = offset + 512;
    if (type === "0" || type === "\0") entries.set(prefix ? `${prefix}/${name}` : name, buffer.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export async function runStartupFileImport({ pool, worker, env, ctx, appEnv, bucket }) {
  const url = process.env.EXPORTATRUST_FILES_IMPORT_URL;
  if (!url) return;
  if (appEnv === "production" && !productionImportAllowed()) {
    console.warn("[arquivos] EXPORTATRUST_FILES_IMPORT_URL ignorada em produção (carga inicial exige EXPORTATRUST_IMPORT_IN_PRODUCTION=1, autorizada por Ivam).");
    return;
  }
  if (!bucket) {
    console.error("[arquivos] storage não configurado; nada importado.");
    return;
  }
  try {
    const { rows, explicit } = await targetOrganizations(pool);
    if (rows.length !== 1 && !explicit) {
      console.warn(`[arquivos] ${rows.length} empresas candidatas; defina EXPORTATRUST_SUPPLIER_IMPORT_ORG_IDS. Nada importado.`);
      return;
    }
    console.log("[arquivos] baixando pacote...");
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`download falhou: HTTP ${response.status}`);
    const entries = readTar(Buffer.from(await response.arrayBuffer()));
    const manifestBytes = entries.get("exportatrust-r2-manifest.json");
    if (!manifestBytes) throw new Error("pacote sem exportatrust-r2-manifest.json");
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (manifest.format !== "ExportaTrust Full R2 Export v1" || !Array.isArray(manifest.objects)) throw new Error("manifesto inválido");

    let stored = 0, skipped = 0, failed = 0, bytes = 0;
    for (const object of manifest.objects) {
      const data = entries.get(object.archivePath);
      if (!data || data.length !== object.size) {
        failed += 1;
        console.error(`[arquivos] ausente ou com tamanho divergente no pacote: ${object.key}`);
        continue;
      }
      const current = await bucket.head(object.key).catch(() => null);
      if (current && current.size === object.size) {
        skipped += 1;
        continue;
      }
      try {
        await bucket.put(object.key, new Uint8Array(data), { httpMetadata: object.httpMetadata ?? {}, customMetadata: object.customMetadata ?? {} });
        stored += 1;
        bytes += object.size;
      } catch (error) {
        failed += 1;
        console.error(`[arquivos] falha ao gravar ${object.key}:`, error instanceof Error ? error.message : error);
      }
    }
    console.log(`[arquivos] ${manifest.objects.length} no pacote → ${stored} gravado(s) (${bytes} bytes), ${skipped} já existiam, ${failed} falha(s).`);

    const backupKey = manifest.objects.map((object) => object.key).filter((key) => /^backups\/org-\d+\/.+\.json$/.test(key)).sort().pop();
    const backupEntry = backupKey && manifest.objects.find((object) => object.key === backupKey);
    if (!backupEntry) {
      console.warn("[arquivos] pacote sem backup do banco; documentos não ligados aos processos.");
      return;
    }
    const payload = JSON.parse(entries.get(backupEntry.archivePath).toString("utf8"));
    const availableKeys = manifest.objects.map((object) => object.key);
    for (const organization of rows) {
      if (!organization.admin_email) continue;
      const request = new Request("http://railway.invalid/api/document-import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-exportatrust-authenticated-user-email": organization.admin_email,
          "x-exportatrust-authenticated-user-name": organization.admin_email,
          "x-exportatrust-auth-provider": "railway-startup-import",
          cookie: `exportatrust_org=${organization.id}`,
        },
        body: JSON.stringify({ payload, availableKeys, dryRun: false }),
      });
      const result = await (await worker.fetch(request, env, ctx)).json().catch(() => ({}));
      if (result.error) console.error(`[arquivos] documentos → empresa #${organization.id}: ${result.error}`);
      else console.log(`[arquivos] documentos → empresa #${organization.id} ${result.organization}: ${JSON.stringify(result.summary)}${result.warnings?.length ? ` · avisos: ${result.warnings.join(" | ")}` : ""}`);
    }
  } catch (error) {
    console.error("[arquivos] falhou:", error instanceof Error ? error.message : error);
  }
}

// Limpeza única autorizada por Ivam (2026-10-16): "As imagens de e-mail você pode cancelar,
// pode eliminar". Remove só as imagens coladas nos e-mails do app antigo (image001.png,
// image.jpg, Outlook-xxx.png e "noname" do tipo imagem) da categoria genérica
// "STAGE 08 · Documentos comerciais". Cada remoção passa pela rota DELETE /api/documents
// (apaga o arquivo do storage, o registro e grava auditoria). Ligada por
// EXPORTATRUST_REMOVE_EMAIL_IMAGES=1; a variável é desligada depois da limpeza.
export async function runStartupEmailImageCleanup({ pool, worker, env, ctx }) {
  if (process.env.EXPORTATRUST_REMOVE_EMAIL_IMAGES !== "1") return;
  try {
    const { rows: organizations } = await targetOrganizations(pool);
    for (const organization of organizations) {
      if (!organization.admin_email) continue;
      const { rows } = await pool.query(`
        SELECT id, file_name FROM operation_documents
        WHERE organization_id = $1 AND category ILIKE 'STAGE 08%'
          AND (lower(file_name) ~ '^(image[0-9]*|outlook-[a-z0-9]+)\\.(png|jpe?g|gif|bmp)$'
            OR (lower(file_name) = 'noname' AND content_type ILIKE 'image/%'))
        ORDER BY id`, [organization.id]);
      let removed = 0, failed = 0;
      for (const row of rows) {
        const request = new Request(`http://railway.invalid/api/documents?id=${row.id}`, {
          method: "DELETE",
          headers: {
            "x-exportatrust-authenticated-user-email": organization.admin_email,
            "x-exportatrust-authenticated-user-name": organization.admin_email,
            "x-exportatrust-auth-provider": "railway-startup-cleanup",
            cookie: `exportatrust_org=${organization.id}`,
          },
        });
        const response = await worker.fetch(request, env, ctx);
        if (response.ok) removed += 1;
        else { failed += 1; console.error(`[limpeza] falha ao remover ${row.file_name} (#${row.id}): HTTP ${response.status}`); }
      }
      console.log(`[limpeza] imagens de e-mail → empresa #${organization.id} ${organization.name}: ${rows.length} encontradas, ${removed} removidas, ${failed} falha(s).`);
    }
  } catch (error) {
    console.error("[limpeza] falhou:", error instanceof Error ? error.message : error);
  }
}

// Importação de fornecedores na inicialização (somente homologação).
//
// Quando EXPORTATRUST_SUPPLIER_IMPORT_B64 traz o JSON exportado do app antigo (base64),
// o servidor chama a mesma rota da tela (POST /api/suppliers/import) em nome do
// administrador da empresa de destino. Valem as mesmas regras: prévia antes, nada é
// apagado, fornecedor existente só tem campos vazios completados, auditoria completa.
//
// Destino: EXPORTATRUST_SUPPLIER_IMPORT_ORG_IDS (lista de ids) ou, se ausente, a única
// empresa criada pelo cadastro por CNPJ. Com mais de uma candidata nada é importado.
// Os dados ficam só na variável do serviço — nunca no repositório — e a variável deve
// ser removida depois da importação.

const IMPORT_PATH = "/api/suppliers/import";

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

async function callImport(worker, env, ctx, organizationId, email, payload, dryRun) {
  const request = new Request(`http://railway.invalid${IMPORT_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-exportatrust-authenticated-user-email": email,
      "x-exportatrust-authenticated-user-name": email,
      "x-exportatrust-auth-provider": "railway-startup-import",
      cookie: `exportatrust_org=${organizationId}`,
    },
    body: JSON.stringify({ payload, dryRun }),
  });
  const response = await worker.fetch(request, env, ctx);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error ?? "sem detalhe"}`);
  return body;
}

export async function runStartupSupplierImport({ pool, worker, env, ctx, appEnv }) {
  const encoded = process.env.EXPORTATRUST_SUPPLIER_IMPORT_B64;
  if (!encoded) return;
  if (appEnv === "production") {
    console.warn("[importação] EXPORTATRUST_SUPPLIER_IMPORT_B64 ignorada em produção.");
    return;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    console.error("[importação] EXPORTATRUST_SUPPLIER_IMPORT_B64 não contém um JSON válido em base64.");
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
      const preview = await callImport(worker, env, ctx, organization.id, organization.admin_email, payload, true);
      const pending = preview.summary.criar + preview.summary.completar;
      if (!pending) {
        console.log(`[importação] empresa #${organization.id} ${preview.organization}: ${preview.summary.total} fornecedor(es) já estavam cadastrados; nada a fazer.`);
        continue;
      }
      const result = await callImport(worker, env, ctx, organization.id, organization.admin_email, payload, false);
      const { total, criar, completar, existentes, ignorados } = result.summary;
      console.log(`[importação] empresa #${organization.id} ${result.organization}: ${total} no arquivo → ${criar} criado(s), ${completar} completado(s), ${existentes} já existiam, ${ignorados} ignorado(s).`);
    }
  } catch (error) {
    console.error("[importação] falhou:", error instanceof Error ? error.message : error);
  }
}

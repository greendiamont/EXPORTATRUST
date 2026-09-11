export type DossierField = { label: string; value: unknown };

const displayValue = (value: unknown) => {
  if (value === null || value === undefined) return "Não informado";
  const text = String(value).trim();
  return text || "Não informado";
};

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const buildClientDossierFields = (client: Record<string, unknown>): DossierField[] => [
  { label: "Nome / Razão Social", value: client.legalName },
  { label: "Aliases", value: client.aliases },
  { label: String(client.taxIdType || "VAT / Tax ID"), value: client.taxId },
  { label: "EORI", value: client.eori },
  { label: "Endereço", value: client.address },
  { label: "Cidade", value: client.city },
  { label: "Estado / Região", value: client.state },
  { label: "CEP / Postal Code", value: client.postalCode },
  { label: "País", value: client.country },
  { label: "Contato", value: client.contactName },
  { label: "E-mail", value: client.email },
  { label: "Telefone", value: client.phone },
  { label: "Porto preferencial", value: client.preferredPort },
  { label: "Condições de pagamento", value: client.paymentTerms },
  { label: "Requisitos documentais", value: client.documentRequirements },
  { label: "Status dos dados", value: client.dataStatus },
  { label: "Criado em", value: client.createdAt },
  { label: "Atualizado em", value: client.updatedAt },
];

export const buildSupplierDossierFields = (supplier: Record<string, unknown>): DossierField[] => [
  { label: "Razão Social", value: supplier.legalName },
  { label: "Nome Fantasia", value: supplier.tradeName },
  { label: "CNPJ / Tax ID", value: supplier.taxId },
  { label: "País", value: supplier.country },
  { label: "Estado / Região", value: supplier.state },
  { label: "Cidade", value: supplier.city },
  { label: "Contato", value: supplier.contactName },
  { label: "E-mail", value: supplier.email },
  { label: "Telefone", value: supplier.phone },
  { label: "Certificações", value: supplier.certifications },
  { label: "Aliases", value: supplier.aliases },
  { label: "Produtos", value: supplier.products },
  { label: "Unidades produtivas", value: supplier.productionUnits },
  { label: "Dados bancários", value: supplier.bankDetails },
  { label: "Status", value: supplier.status },
  { label: "Criado em", value: supplier.createdAt },
];

export const dossierText = (title: string, fields: DossierField[]) => [
  title,
  "=".repeat(title.length),
  ...fields.map((field) => `${field.label}: ${displayValue(field.value)}`),
].join("\n");

function recordId(fields: DossierField[]) {
  const fiscal = fields.find((field) => /VAT|GST|Tax ID|CNPJ/i.test(field.label) && displayValue(field.value) !== "Não informado");
  return fiscal ? displayValue(fiscal.value) : "Cadastro ExportaTrust";
}

export const dossierHtml = (title: string, fields: DossierField[]) => {
  const text = dossierText(title, fields);
  const serializedText = JSON.stringify(text).replace(/</g, "\\u003c");
  const serializedTitle = JSON.stringify(title).replace(/</g, "\\u003c");
  const issuedAt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const id = recordId(fields);
  const dossierType = /fornecedor/i.test(title) ? "SUPPLIER DOSSIER" : "CLIENT DOSSIER";
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;margin:32px;color:#111;line-height:1.4;background:#fff}
  .brand{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:22px}
  .brand-left{display:flex;gap:12px;align-items:center}.mark{width:42px;height:42px;border:2px solid #111;border-radius:10px;display:grid;place-items:center;font-weight:800;letter-spacing:-1px}
  .brand b{font-size:20px}.brand small{display:block;color:#666;margin-top:2px}.doc-meta{text-align:right;font-size:12px;color:#555}.doc-meta strong{display:block;color:#111;font-size:13px}
  h1{font-size:24px;margin:0 0 8px}.subtitle{font-size:12px;color:#666;margin-bottom:24px}
  table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:9px 10px;text-align:left;vertical-align:top}
  th{width:32%;background:#f6f6f6;font-weight:600}.actions{margin-bottom:20px;display:flex;gap:8px;flex-wrap:wrap}
  button{padding:9px 13px;border:1px solid #bbb;border-radius:6px;background:white;cursor:pointer;font-weight:600}
  #shareStatus{font-size:12px;color:#555;align-self:center}
  @media print{.actions{display:none}body{margin:14mm}.brand{break-inside:avoid}th{background:#eee!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head><body>
<div class="actions"><button onclick="window.print()">Imprimir / Salvar PDF</button><button onclick="shareDossier()">Compartilhar</button><span id="shareStatus"></span></div>
<header class="brand"><div class="brand-left"><div class="mark">ET</div><div><b>ExportaTrust</b><small>Trade & Compliance Intelligence</small></div></div><div class="doc-meta"><strong>${dossierType}</strong><span>Emitido em ${escapeHtml(issuedAt)}</span><br><span>ID: ${escapeHtml(id)}</span></div></header>
<h1>${escapeHtml(title)}</h1><div class="subtitle">Dossiê cadastral gerado a partir dos dados oficiais disponíveis no cadastro mestre.</div>
<table>${fields.map((field) => `<tr><th>${escapeHtml(field.label)}</th><td>${escapeHtml(displayValue(field.value)).replace(/\n/g,"<br>")}</td></tr>`).join("")}</table>
<script>
const dossierTitle=${serializedTitle}; const dossierText=${serializedText};
async function shareDossier(){
  const status=document.getElementById('shareStatus');
  try{
    if(navigator.share){await navigator.share({title:dossierTitle,text:dossierText});status.textContent='Compartilhado.';return;}
    if(navigator.clipboard){await navigator.clipboard.writeText(dossierText);status.textContent='Dados copiados para compartilhar.';return;}
    status.textContent='Copie os dados manualmente.';
  }catch(error){if(error && error.name!=='AbortError')status.textContent='Não foi possível compartilhar.';}
}
</script>
</body></html>`;
};

export async function shareDossier(title: string, fields: DossierField[]) {
  const text = dossierText(title, fields);
  if (typeof navigator !== "undefined" && navigator.share) {
    try { await navigator.share({ title, text }); return "shared" as const; } catch (error) {
      if ((error as Error)?.name === "AbortError") return "cancelled" as const;
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return "copied" as const;
  }
  return "unsupported" as const;
}

export function openDossierPrint(title: string, fields: DossierField[]) {
  if (typeof window === "undefined") return;
  const preview = window.open("", "_blank", "noopener,noreferrer");
  if (!preview) return;
  preview.document.open();
  preview.document.write(dossierHtml(title, fields));
  preview.document.close();
}

export type DossierField = { label: string; value: unknown };

const displayValue = (value: unknown) => {
  if (value === null || value === undefined) return "Não informado";
  const text = String(value).trim();
  return text || "Não informado";
};

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

export const dossierHtml = (title: string, fields: DossierField[]) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;margin:32px;color:#111;line-height:1.4}
  h1{font-size:24px;margin:0 0 8px}.meta{font-size:12px;color:#666;margin-bottom:24px}
  table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:9px 10px;text-align:left;vertical-align:top}
  th{width:32%;background:#f6f6f6;font-weight:600}.actions{margin-bottom:20px;display:flex;gap:8px}
  button{padding:8px 12px;border:1px solid #bbb;border-radius:6px;background:white;cursor:pointer}
  @media print{.actions{display:none}body{margin:16mm}th{background:#eee!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head><body>
<div class="actions"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
<h1>${title}</h1><div class="meta">Gerado pelo ExportaTrust</div>
<table>${fields.map((field) => `<tr><th>${field.label}</th><td>${displayValue(field.value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>")}</td></tr>`).join("")}</table>
</body></html>`;

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

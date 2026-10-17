// Declaração EUDR do exportador (pacote para o importador registrar a DDS), no mesmo padrão visual dos
// documentos do pedido (Sales Order, Purchase Invoice, Packing List). Em inglês, para o importador.
// Não é a DDS oficial: a DDS é registrada pelo importador no sistema da UE.

import { FOREST_CHECKS, FOREST_DOCS, docDone, geometryKind, type DocDefinition, type DocRecord, type ForestSummary, type OrderEudr, type OrderOrigin } from "./eudr";

type Order = {
  reference: string; client: string; country: string; product: string; hsCode: string; etd: string; supplierName: string; exporterName: string;
  eori: string; eudrReference: string; netWeightKg: number; volumeM3: number; containers: string; portOfLoading: string; portOfDischarge: string;
  eudr: OrderEudr; exported: number; balance: { input: number; possible: number; exported: number; ok: boolean }; chainDocs: DocDefinition[];
};

// Nomes dos documentos em inglês para o importador (chaves de lib/eudr.ts).
const DOC_EN: Record<string, string> = {
  car: "Rural Environmental Registry (CAR) receipt", titulo: "Land title / lease agreement", corte: "Plantation harvest declaration / authorisation (state agency)",
  compra: "Log purchase contract or invoice", pmfs: "Approved Sustainable Forest Management Plan (PMFS)", autex: "Logging authorisation (AUTEX)",
  dof_origem: "DOF / Sinaflor transport document (logs)", nf_toras: "Raw-material purchase invoices by origin", romaneio: "Raw-material transport waybill",
  licenca: "Operating environmental licence (processing plant)", ctf: "IBAMA Federal Technical Registry (CTF)", cndt: "Labour debt clearance certificate (CNDT)",
  trabalho_escravo: "Check against the forced-labour register (MTE)", sinaflor_saldo: "Sinaflor credit balance vs. volume sold", dof_exportacao: "DOF for export (final product)",
  enplus: "ENplus / SURE certification", certificacao: "FSC / PEFC certification", nf_exportacao: "Export invoice (NF-e) and bill of lading",
};
const docName = (doc: DocDefinition) => DOC_EN[doc.key] ?? doc.label;
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const date = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value || "—";
const num = (value: number, digits = 3) => value.toLocaleString("en-US", { maximumFractionDigits: digits });

function docState(record: DocRecord | undefined, today: string) {
  if (record?.status === "nao_se_aplica") return "Not applicable";
  if (docDone(record, today)) return record?.validUntil ? `Available · valid until ${date(record.validUntil)}` : "Available";
  if (record?.status === "ok" && record.validUntil) return `Expired ${date(record.validUntil)}`;
  return "Pending";
}

export function eudrDeclarationHtml({ order, origins, today }: { order: Order; origins: Array<{ origin: OrderOrigin; forest: ForestSummary }>; today: string }) {
  const unit = order.eudr.productKind === "pellets" ? "t" : "m³";
  const species = [...new Set(origins.map(({ forest }) => forest.eudr.scientificName).filter(Boolean))].join("; ");
  const plotRows = origins.map(({ origin, forest }) => `<tr><td>${escape(forest.name)}<br><span class="muted mono">${escape(forest.carCode)}</span></td><td>${escape(forest.eudr.producer)}<br><span class="muted">${forest.eudr.relation === "terceiro" ? "third-party producer" : "supplier's own forest"}</span></td><td>${forest.eudr.originType === "Nativa" ? "Natural forest (managed)" : "Plantation"}<br><i>${escape(forest.eudr.scientificName)}</i></td><td>${geometryKind(forest.geometryJson) === "Polígono" ? "Polygon" : geometryKind(forest.geometryJson) ? "Point" : "Missing"} · ${num(forest.areaHa, 2)} ha</td><td>${date(origin.harvestFrom)}${origin.harvestTo ? ` – ${date(origin.harvestTo)}` : ""}</td><td class="num">${num(origin.inputQuantity)} ${unit}</td></tr>`).join("");
  const checkRows = origins.map(({ forest }) => `<tr><td>${escape(forest.name)}</td>${FOREST_CHECKS.map((check) => { const item = forest.eudr.checks[check.key]; return `<td>${item?.done ? `✓ ${escape(date(item.at.slice(0, 10)))}` : "Pending"}</td>`; }).join("")}</tr>`).join("");
  const forestDocRows = origins.flatMap(({ forest }) => FOREST_DOCS[forest.eudr.originType].map((doc) => `<tr><td>${escape(docName(doc))}</td><td>${escape(forest.name)}</td><td>${escape(docState(forest.eudr.docs[doc.key], today))}</td></tr>`)).join("");
  const chainRows = order.chainDocs.map((doc) => `<tr><td>${escape(docName(doc))}${doc.optional ? " <span class=\"muted\">(if applicable)</span>" : ""}</td><td>${escape(doc.who === "Exportador" ? "Exporter" : doc.who.startsWith("Fornecedor") ? "Supplier" : doc.who === "Transportador" ? "Carrier" : doc.who)}</td><td>${escape(docState(order.eudr.docs[doc.key], today))}</td></tr>`).join("");
  const meta = [
    ["Order reference", order.reference], ["Date", date(today)], ["Product", order.product], ["HS code", order.hsCode],
    ["Quantity", [order.netWeightKg ? `${num(order.netWeightKg, 0)} kg net` : "", order.volumeM3 ? `${num(order.volumeM3)} m³` : ""].filter(Boolean).join(" · ") || "—"],
    ["Species (scientific name)", species || "—"], ["Country of production", "Brazil (standard risk)"], ["Estimated shipment", date(order.etd)],
    ["Route", [order.portOfLoading, order.portOfDischarge].filter(Boolean).join(" → ") || "—"], ["Containers", order.containers || "—"],
    ["EU operator (importer)", [order.client, order.eori ? `EORI ${order.eori}` : ""].filter(Boolean).join(" · ") || "—"], ["DDS reference", order.eudrReference || "to be filed by the EU operator"],
  ];
  const metaRows = meta.map((row, index, source) => index % 2 ? "" : `<tr><th>${escape(row[0])}</th><td>${escape(row[1])}</td><th>${escape(source[index + 1]?.[0] ?? "")}</th><td>${escape(source[index + 1]?.[1] ?? "")}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EUDR package · ${escape(order.reference)}</title><style>
@page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;background:#f3f7f5;color:#20362d;font-size:11px}
.page{width:190mm;min-height:277mm;margin:0 auto;background:#fff;padding:8mm;border:1px solid #d8e5df}
.top{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #086c55;padding-bottom:10px}.brand{font-weight:800;letter-spacing:2px;color:#086c55;text-transform:uppercase}.top p{margin:6px 0 0}
.title{text-align:right}.title h1{margin:0;font-size:20px}.title b{display:block;margin-top:5px}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.box{border:1px solid #dfe9e4;padding:9px;line-height:1.45}.box h2{margin:0 0 6px;font-size:10px;color:#086c55;letter-spacing:.8px}
h2{font-size:12.5px;margin:14px 0 4px}table{width:100%;border-collapse:collapse;margin-top:6px;table-layout:fixed}
th,td{border:1px solid #dfe9e4;padding:5px 6px;text-align:left;vertical-align:top;line-height:1.3;word-break:break-word}th{background:#f1f7f4;color:#60756c;font-size:9px;text-transform:uppercase}
.meta th{width:17%}.meta td{width:33%}.num{text-align:right}.muted{color:#60756c}.mono{font-family:ui-monospace,monospace;font-size:9.5px}
.notes{margin-top:10px;border-left:3px solid #086c55;background:#f4faf7;padding:8px;font-size:10px;line-height:1.4}.ok{color:#047857;font-weight:700}.bad{color:#b91c1c;font-weight:700}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:34px}.line{border-top:1px solid #80958b;padding-top:6px;color:#60756c;text-align:center}.line b{display:block;color:#20362d}
.bar{width:190mm;max-width:100%;margin:12px auto 0;display:flex;justify-content:flex-end}button{min-height:34px;padding:0 14px;border:0;border-radius:6px;background:#086c55;color:#fff;font:inherit;font-size:12px;cursor:pointer}
@media print{body{background:#fff}.page{margin:0;border:0;width:auto;min-height:auto;padding:0}.bar{display:none}h2,table{page-break-inside:avoid}}
@media (max-width:760px){.page{width:auto;min-height:0;margin:8px}.parties,.sign{grid-template-columns:1fr}}
</style></head><body><div class="bar"><button onclick="window.print()">Print / save as PDF</button></div><main class="page">
<section class="top"><div><div class="brand">${escape(order.exporterName || "Exporter")}</div><p>EU Deforestation Regulation (EU) 2023/1115 · information package for the EU operator</p></div><div class="title"><h1>EUDR DUE DILIGENCE PACKAGE</h1><b>${escape(order.reference)}</b></div></section>
<section class="parties"><article class="box"><h2>EXPORTER / SUPPLIER</h2><strong>${escape(order.exporterName || "—")}</strong><br>Supplier (producer of the goods): ${escape(order.supplierName || "—")}</article><article class="box"><h2>EU OPERATOR / IMPORTER</h2><strong>${escape(order.client || "—")}</strong><br>${escape(order.country)}${order.eori ? `<br>EORI: ${escape(order.eori)}` : ""}</article></section>
<table class="meta">${metaRows}</table>
<h2>1. PLOTS OF LAND (GEOLOCATION)</h2>
<table><colgroup><col style="width:22%"><col style="width:20%"><col style="width:18%"><col style="width:15%"><col style="width:13%"><col style="width:12%"></colgroup><thead><tr><th>Plot / CAR</th><th>Producer</th><th>Origin · species</th><th>Geolocation</th><th>Harvest</th><th class="num">Input (${unit})</th></tr></thead><tbody>${plotRows || `<tr><td colspan="6">No plots linked.</td></tr>`}</tbody></table>
<div class="notes">Geolocation of all plots is provided in the attached GeoJSON file (WGS84, 6 decimal places): <b>EUDR-${escape(order.reference.replace(/[^\w.-]+/g, "_"))}.geojson</b>. Plots above 4 ha are described by polygons.</div>
<h2>2. DEFORESTATION-FREE AND RISK CHECKS (CUT-OFF 31/12/2020)</h2>
<table><thead><tr><th>Plot</th>${FOREST_CHECKS.map((check) => `<th>${escape(check.label)}</th>`).join("")}</tr></thead><tbody>${checkRows}</tbody></table>
<h2>3. LEGALITY EVIDENCE (BRAZILIAN LEGISLATION)</h2>
<table><colgroup><col style="width:52%"><col style="width:22%"><col style="width:26%"></colgroup><thead><tr><th>Document</th><th>Plot / party</th><th>Status</th></tr></thead><tbody>${forestDocRows}${chainRows}</tbody></table>
<h2>4. ${order.eudr.productKind === "pellets" ? "MASS BALANCE (PELLET PLANT)" : "VOLUME BALANCE (SAWMILL)"}</h2>
<table><thead><tr><th>Raw material from plots</th><th>Yield</th><th>Possible output</th><th>Exported in this order</th><th>Result</th></tr></thead><tbody><tr><td>${num(order.balance.input)} ${unit}</td><td>${num(order.eudr.yieldPercent, 1)}%</td><td>${num(order.balance.possible)} ${unit}</td><td>${num(order.balance.exported)} ${unit}</td><td class="${order.balance.ok ? "ok" : "bad"}">${order.balance.ok ? "Consistent" : "To be reviewed"}</td></tr></tbody></table>
<div class="notes"><b>Exporter statement.</b> To the best of our knowledge, based on the information and evidence listed above, the relevant commodities covered by this order were produced on the plots identified, on land that has not been subject to deforestation or forest degradation after 31 December 2020, and in accordance with the relevant legislation of the country of production. This package supports the EU operator's due diligence; the Due Diligence Statement is filed by the EU operator in the EU Information System.</div>
<section class="sign"><div class="line"><b>${escape(order.exporterName || "Exporter")}</b>Exporter / supplier signature</div><div class="line"><b>Date</b>${escape(date(today))}</div></section>
</main></body></html>`;
}

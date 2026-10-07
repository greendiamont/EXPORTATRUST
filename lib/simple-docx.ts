// ExportaTrust DOCX helper — Stage 01 document generation.
const encoder = new TextEncoder();

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function u16(value: number) {
  return Uint8Array.of(value & 255, (value >>> 8) & 255);
}

function u32(value: number) {
  return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ name: string; data: Uint8Array }>) {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(file.data.length), u32(file.data.length), u16(name.length), u16(0), name, file.data,
    ]);
    locals.push(local);

    const central = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(file.data.length), u32(file.data.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const centralBlock = concat(centrals);
  const localBlock = concat(locals);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralBlock.length), u32(localBlock.length), u16(0),
  ]);
  return concat([localBlock, centralBlock, end]);
}

export function docxParagraph(text: unknown, options: { bold?: boolean; size?: number; align?: "left" | "center" | "right"; spacingAfter?: number; color?: string } = {}) {
  const size = options.size ?? 18;
  const align = options.align ? `<w:jc w:val="${options.align}"/>` : "";
  const spacing = `<w:spacing w:after="${options.spacingAfter ?? 40}"/>`;
  const bold = options.bold ? "<w:b/>" : "";
  const color = options.color ? `<w:color w:val="${options.color}"/>` : "";
  return `<w:p><w:pPr>${align}${spacing}</w:pPr><w:r><w:rPr>${bold}<w:sz w:val="${size}"/>${color}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

export function docxCell(content: string, options: { width?: number; shaded?: boolean; align?: "left" | "center" | "right"; bold?: boolean; fontSize?: number; colspan?: number } = {}) {
  const width = options.width ? `<w:tcW w:w="${options.width}" w:type="dxa"/>` : "";
  const shade = options.shaded ? '<w:shd w:fill="E8E8E8"/>' : "";
  const gridSpan = options.colspan && options.colspan > 1 ? `<w:gridSpan w:val="${options.colspan}"/>` : "";
  const paragraph = docxParagraph(content, { bold: options.bold, size: options.fontSize ?? 16, align: options.align ?? "left", spacingAfter: 0 });
  return `<w:tc><w:tcPr>${width}${shade}${gridSpan}<w:vAlign w:val="center"/></w:tcPr>${paragraph}</w:tc>`;
}

export function docxTable(rows: string[][], widths: number[], options: { headerRows?: number; fontSize?: number } = {}) {
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const body = rows.map((row, rowIndex) => {
    const header = rowIndex < (options.headerRows ?? 0);
    return `<w:tr>${row.map((cell, index) => docxCell(cell, { width: widths[index], shaded: header, bold: header, fontSize: options.fontSize ?? 15, align: header ? "center" : "left" })).join("")}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="777777"/><w:left w:val="single" w:sz="4" w:color="777777"/><w:bottom w:val="single" w:sz="4" w:color="777777"/><w:right w:val="single" w:sz="4" w:color="777777"/><w:insideH w:val="single" w:sz="4" w:color="AAAAAA"/><w:insideV w:val="single" w:sz="4" w:color="AAAAAA"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

export function docxTwoColumnBlock(leftTitle: string, leftLines: string[], rightTitle: string, rightLines: string[]) {
  const widths = [4750, 4750];
  const left = [leftTitle, ...leftLines].filter(Boolean).join("\n");
  const right = [rightTitle, ...rightLines].filter(Boolean).join("\n");
  const cell = (text: string) => {
    const lines = text.split("\n");
    return `<w:tc><w:tcPr><w:tcW w:w="4750" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${lines.map((line, index) => docxParagraph(line, { bold: index === 0, size: index === 0 ? 16 : 15, spacingAfter: index === 0 ? 30 : 8 })).join("")}</w:tc>`;
  };
  return `<w:tbl><w:tblPr><w:tblW w:w="9500" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="888888"/><w:left w:val="single" w:sz="4" w:color="888888"/><w:bottom w:val="single" w:sz="4" w:color="888888"/><w:right w:val="single" w:sz="4" w:color="888888"/><w:insideV w:val="single" w:sz="4" w:color="AAAAAA"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="${widths[0]}"/><w:gridCol w:w="${widths[1]}"/></w:tblGrid><w:tr>${cell(left)}${cell(right)}</w:tr></w:tbl>`;
}

export function buildDocx(bodyXml: string, options: { landscape?: boolean; title?: string } = {}) {
  const landscape = Boolean(options.landscape);
  const width = landscape ? 16838 : 11906;
  const height = landscape ? 11906 : 16838;
  const orientation = landscape ? ' w:orient="landscape"' : "";
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="${width}" w:h="${height}"${orientation}/><w:pgMar w:top="500" w:right="500" w:bottom="500" w:left="500" w:header="280" w:footer="280" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(options.title || "ExportaTrust")}</dc:title><dc:creator>ExportaTrust</dc:creator><cp:lastModifiedBy>ExportaTrust</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`;
  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rels) },
    { name: "word/document.xml", data: encoder.encode(documentXml) },
    { name: "docProps/core.xml", data: encoder.encode(core) },
  ]);
}

export function safeDocxFileName(value: string) {
  return value.replaceAll(/[^A-Za-z0-9._-]+/g, "_").replaceAll(/_+/g, "_");
}

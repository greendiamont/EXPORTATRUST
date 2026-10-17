// PDF do Shipment Report (anexo do e-mail), no mesmo visual dos documentos do pedido: faixa verde,
// um bloco por pedido com a barra de fases, os dados e o próximo passo.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { PHASES_EN, englishDate, type ReportOrder } from "./shipment-report";

const A4: [number, number] = [595.28, 841.89];
const green = rgb(0.03, 0.42, 0.33);
const ink = rgb(0.13, 0.21, 0.18);
const muted = rgb(0.38, 0.46, 0.42);
const line = rgb(0.87, 0.91, 0.89);
const navy = rgb(0.06, 0.11, 0.18);
const mint = rgb(0.93, 0.99, 0.96);
const okText = rgb(0.02, 0.47, 0.34);
const grey = rgb(0.95, 0.96, 0.96);
const amberBg = rgb(1, 0.98, 0.92);
const amberText = rgb(0.57, 0.25, 0.05);

// Fontes padrão do PDF só têm WinAnsi: troca o que não cabe.
const safe = (text: string) => text.replace(/✓/g, "OK").replace(/→/g, "->").replace(/[^\x20-\x7E\xA0-\xFF·×³]/g, "");

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = safe(text).split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && current) { lines.push(current); current = word; } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

export async function shipmentReportPdf({ clientName, exporterName, orders, message, date }: { clientName: string; exporterName: string; orders: ReportOrder[]; message: string; date: string }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Shipment Report - ${clientName}`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 40;
  const width = A4[0] - margin * 2;
  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - margin;

  const header = () => {
    page.drawText(safe(exporterName).toUpperCase(), { x: margin, y: y - 10, size: 10, font: bold, color: green });
    page.drawText("Shipment report · your open orders", { x: margin, y: y - 24, size: 8.5, font: regular, color: muted });
    const title = "SHIPMENT REPORT";
    page.drawText(title, { x: margin + width - bold.widthOfTextAtSize(title, 15), y: y - 12, size: 15, font: bold, color: ink });
    const sub = `${englishDate(date)} · ${orders.length} order${orders.length === 1 ? "" : "s"} · ${safe(clientName)}`;
    page.drawText(sub, { x: margin + width - regular.widthOfTextAtSize(sub, 8.5), y: y - 26, size: 8.5, font: regular, color: muted });
    page.drawRectangle({ x: margin, y: y - 36, width, height: 2.5, color: green });
    y -= 50;
  };
  const ensure = (height: number) => {
    if (y - height < margin) { page = pdf.addPage(A4); y = A4[1] - margin; header(); }
  };

  header();
  for (const text of [`Dear ${clientName || "customer"}, please find below the current status of your orders.`, message].filter(Boolean)) {
    for (const row of wrap(text, regular, 9.5, width)) { ensure(14); page.drawText(row, { x: margin, y, size: 9.5, font: regular, color: ink }); y -= 13; }
    y -= 4;
  }

  for (const order of orders) {
    const factRows = order.facts.flatMap((fact) => wrap(fact.value, regular, 8.5, width - 150).map((value, index) => ({ label: index ? "" : fact.label, value })));
    const extra = [order.action, order.next].filter(Boolean).flatMap((text) => wrap(text, bold, 8.5, width - 20));
    const height = 26 + 22 + factRows.length * 12 + extra.length * 12 + 18;
    ensure(height);
    const top = y;
    page.drawRectangle({ x: margin, y: top - height, width, height, borderColor: line, borderWidth: 1 });
    const title = safe(`${order.reference} · ${order.product}${order.load ? ` · ${order.load}` : ""}`);
    page.drawText(title.length > 90 ? `${title.slice(0, 88)}…`.replace("…", "...") : title, { x: margin + 10, y: top - 18, size: 10, font: bold, color: ink });
    const badge = safe(order.badge);
    const badgeWidth = bold.widthOfTextAtSize(badge, 8) + 12;
    page.drawRectangle({ x: margin + width - badgeWidth - 10, y: top - 22, width: badgeWidth, height: 14, color: order.tone === "ok" ? mint : order.tone === "warn" ? amberBg : grey });
    page.drawText(badge, { x: margin + width - badgeWidth - 4, y: top - 18, size: 8, font: bold, color: order.tone === "ok" ? okText : order.tone === "warn" ? amberText : ink });
    let rowY = top - 44;
    const cell = (width - 20 - 5 * 3) / 6;
    PHASES_EN.forEach((name, index) => {
      const x = margin + 10 + index * (cell + 3);
      page.drawRectangle({ x, y: rowY, width: cell, height: 15, color: index < order.phase ? mint : index === order.phase ? navy : grey });
      page.drawText(name, { x: x + (cell - regular.widthOfTextAtSize(name, 7.5)) / 2, y: rowY + 4.5, size: 7.5, font: index === order.phase ? bold : regular, color: index < order.phase ? okText : index === order.phase ? rgb(1, 1, 1) : muted });
    });
    rowY -= 16;
    for (const row of factRows) {
      if (row.label) page.drawText(safe(row.label), { x: margin + 10, y: rowY, size: 8.5, font: regular, color: muted });
      page.drawText(row.value, { x: margin + 150, y: rowY, size: 8.5, font: regular, color: ink });
      rowY -= 12;
    }
    for (const row of extra) { page.drawText(row, { x: margin + 10, y: rowY, size: 8.5, font: bold, color: order.action && row && order.action.includes(row.split(" ")[0]) ? amberText : ink }); rowY -= 12; }
    y = top - height - 10;
  }
  ensure(20);
  page.drawText("Dates are estimates and may change with the carrier's schedule. Generated by ExportaTrust.", { x: margin, y, size: 7.5, font: regular, color: muted });
  return pdf.save();
}

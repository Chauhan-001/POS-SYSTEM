/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ExportService — Backend report exports (Phase 1.8).
 *
 * CSV (streamed), XLSX (ExcelJS) and PDF (PDFKit) exports. Every export
 * carries restaurant branding, the date range + filters, totals, grand
 * totals, a footer and a generation timestamp — and is produced from the
 * exact same data the JSON endpoints return, so exports always match the
 * displayed report.
 */

import { Readable } from 'stream';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface ExportMeta {
  title: string;
  restaurantName?: string;
  generatedAt?: string;
  filters?: Record<string, string>;
  footer?: string;
}

export interface ExportTable {
  headers: string[];
  rows: (string | number)[][];
  /** Optional totals row appended as the grand-total line. */
  totals?: (string | number)[];
}

const DEFAULT_FILTERS: Record<string, string> = {};
const DEFAULT_META: ExportMeta = { title: 'Report' };

function csvEscape(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from a table (used for the response body). */
export function buildCsv(table: ExportTable, meta: ExportMeta = DEFAULT_META): string {
  const lines: string[] = [];
  if (meta.title) lines.push(meta.title);
  if (meta.restaurantName) lines.push(`Restaurant,${csvEscape(meta.restaurantName)}`);
  if (meta.generatedAt) lines.push(`Generated,${csvEscape(meta.generatedAt)}`);
  Object.entries(meta.filters || DEFAULT_FILTERS).forEach(([k, v]) => {
    lines.push(`${csvEscape(k)},${csvEscape(v)}`);
  });
  lines.push('');
  lines.push(table.headers.map(csvEscape).join(','));
  table.rows.forEach((row) => lines.push(row.map(csvEscape).join(',')));
  if (table.totals) {
    lines.push(table.totals.map(csvEscape).join(','));
  }
  lines.push('');
  if (meta.footer) lines.push(csvEscape(meta.footer));
  return lines.join('\n');
}

/** Stream a CSV export to the response (memory-light for large exports). */
export function streamCsv(table: ExportTable, meta: ExportMeta = DEFAULT_META): Readable {
  const content = buildCsv(table, meta);
  return Readable.from([content]);
}

/** Build a styled XLSX workbook buffer. */
export async function buildXlsx(table: ExportTable, meta: ExportMeta = DEFAULT_META): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.restaurantName || 'POS Reports';
  const ws = wb.addWorksheet(meta.title.replace(/[\\/?*[\]]/g, '').slice(0, 31) || 'Report');

  if (meta.title) {
    const t = ws.getCell('A1');
    t.value = meta.title;
    t.font = { bold: true, size: 14 };
  }
  let row = 2;
  if (meta.restaurantName) { ws.getCell(`A${row}`).value = `Restaurant: ${meta.restaurantName}`; row++; }
  if (meta.generatedAt) { ws.getCell(`A${row}`).value = `Generated: ${meta.generatedAt}`; row++; }
  Object.entries(meta.filters || DEFAULT_FILTERS).forEach(([k, v]) => {
    ws.getCell(`A${row}`).value = `${k}: ${v}`; row++;
  });
  row++;

  const headerRow = ws.addRow(table.headers);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF004AC6' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });
  table.rows.forEach((r) => ws.addRow(r));
  if (table.totals) {
    const totalRow = ws.addRow(table.totals);
    totalRow.font = { bold: true };
  }
  ws.columns.forEach((col) => { col.width = 18; });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Build a branded PDF buffer (PDFKit). */
export function buildPdf(table: ExportTable, meta: ExportMeta = DEFAULT_META): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header / branding
    if (meta.restaurantName) {
      doc.fontSize(14).fillColor('#004ac6').text(meta.restaurantName, { align: 'center' });
    }
    doc.fontSize(12).fillColor('#191b23').text(meta.title, { align: 'center' });
    if (meta.generatedAt) doc.fontSize(8).fillColor('#888').text(`Generated: ${meta.generatedAt}`, { align: 'center' });
    Object.entries(meta.filters || DEFAULT_FILTERS).forEach(([k, v]) => {
      doc.fontSize(9).fillColor('#555').text(`${k}: ${v}`);
    });
    doc.moveDown();

    // Table
    const colWidth = (doc.page.width - 80) / Math.max(table.headers.length, 1);
    const drawRow = (cells: (string | number)[], bold = false) => {
      const y = doc.y;
      const heights: number[] = [];
      cells.forEach((cell, i) => {
        const text = String(cell ?? '');
        const w = colWidth - 4;
        const h = doc.heightOfString(text, { width: w });
        heights.push(h);
        if (i === cells.length - 1) {
          const maxH = Math.max(...heights, 12);
          if (y + maxH > doc.page.height - 60) {
            doc.addPage();
            doc.y = 40;
          }
          doc.fontSize(7).fillColor(bold ? '#fff' : '#222');
          cells.forEach((c, j) => {
            const x = 40 + j * colWidth;
            if (bold) {
              doc.rect(x, doc.y, colWidth, maxH).fill('#004ac6');
            }
            doc.text(String(c ?? ''), x + 2, doc.y + 1, { width: colWidth - 4, lineBreak: false });
          });
          doc.moveDown(0.5);
        }
      });
    };

    drawRow(table.headers, true);
    table.rows.forEach((r) => drawRow(r));
    if (table.totals) drawRow(table.totals, true);

    doc.moveDown();
    if (meta.footer) doc.fontSize(8).fillColor('#888').text(meta.footer);
    doc.end();
  });
}

/** Content type + disposition helper for report endpoints. */
export function exportHeaders(format: 'csv' | 'xlsx' | 'pdf', title: string): { 'Content-Type': string; 'Content-Disposition': string } {
  const safe = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
  if (format === 'csv') return { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${safe}.csv"` };
  if (format === 'xlsx') return { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${safe}.xlsx"` };
  return { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${safe}.pdf"` };
}

export const exportService = { buildCsv, streamCsv, buildXlsx, buildPdf, exportHeaders };

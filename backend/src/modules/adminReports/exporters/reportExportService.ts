/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reportExportService.ts — Background export generation for Admin Reports.
 *
 * Mirrors the audit export conventions: jobs persisted in `ReportExportJob`,
 * generated files under {uploads}/reports-exports, SHA-256 signed, optional
 * AES-256-GCM encryption, and an `report.exported` audit event.
 */

import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { config } from '../../../config';
import { ReportExportJob, ReportExportFormat } from '../models';
import { adminReportingService } from '../adminReportingService';
import { auditService } from '../../audit/auditService';

export const EXPORT_DIR = path.join(config.uploads.dir, 'reports-exports');

function exportDir(): string {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  return EXPORT_DIR;
}

export function buildCSV(rows: Record<string, unknown>[]): string {
  const flattened = flattenRows(rows);
  if (!flattened.length) return '';
  const headers: string[] = Object.keys(flattened[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const line = (vals: string[]) => vals.map(escape).join(',');
  const out = [line(headers)];
  for (const r of flattened) {
    out.push(line(headers.map((h): string => String(r[h] ?? ''))));
  }
  return out.join('\n');
}

/** Normalise an already-array-of-rows input to single-level row objects. */
export function flattenRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r ?? {})) {
      out[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
    }
    return out;
  });
}

/** Flatten a single report object into an array of single-level row objects. */
export function flatten(report: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const [k, v] of Object.entries(report)) {
    if (Array.isArray(v)) {
      for (const item of v.slice(0, 5000)) {
        out.push({ [k]: item });
      }
    } else {
      out.push({ [k]: v });
    }
  }
  return out;
}

export function buildJSON(report: Record<string, unknown>): string {
  return JSON.stringify(report, null, 2);
}

export async function buildXLSX(rows: Record<string, unknown>[]): Promise<Buffer> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');
  const data = flattenRows(rows);
  const headers = data.length ? Object.keys(data[0]) : ['key', 'value'];
  ws.columns = headers.map((h) => ({ header: h, key: h, width: 20 }));
  for (const r of data) ws.addRow(r);
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildPDF(report: Record<string, unknown>): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  doc.fontSize(16).text(`Report Export — ${new Date().toISOString()}`, { align: 'center' });
  doc.moveDown().fontSize(8);
  const body = JSON.stringify(report, null, 2);
  for (const l of body.split('\n').slice(0, 3000)) doc.text(l);
  const p = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  doc.end();
  return p;
}

export function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function encryptPayload(data: Buffer, password: string): { file: Buffer; meta: Record<string, unknown> } {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  const meta = {
    v: 1,
    alg: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
  const file = Buffer.concat([Buffer.from(JSON.stringify(meta) + '\n'), ciphertext]);
  return { file, meta };
}

// ─── Collecting rows per report key ─────────────────────────────────────────

async function collectRows(reportKey: string, query: any): Promise<Record<string, unknown>> {
  const opts = query ?? {};
  switch (reportKey) {
    case 'growth': return { growth: normalize((await adminReportingService.growth(opts)).series) };
    case 'revenue': return { revenue: normalize((await adminReportingService.revenue(opts)).series) };
    case 'subscriptions': return { subscriptions: normalize((await adminReportingService.subscriptions(opts)).planDistribution) };
    case 'ai-revenue': return { aiRevenue: normalize((await adminReportingService.aiRevenue(opts)).series) };
    case 'support': return { support: normalize((await adminReportingService.support(opts)).trend) };
    case 'devices': return { devices: normalize((await adminReportingService.devices(opts)).byOs) };
    case 'usage': return { usage: normalize((await adminReportingService.usage(opts)).series) };
    case 'owners': return { owners: normalize((await adminReportingService.owners(opts)).owners) };
    case 'inactive': { const r = await adminReportingService.inactive(opts); return { inactive: normalize(r.entries) }; }
    case 'features': { const r = await adminReportingService.features(opts); return { features: normalize(r.features) }; }
    default: return { report: {} };
  }
}

function normalize(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r: any) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r ?? {})) {
      out[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
    }
    return out;
  });
}

const MIME: Record<ReportExportFormat, string> = {
  csv: 'text/csv',
  json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export async function generateExport(jobId: string): Promise<void> {
  const job = await ReportExportJob.findById(jobId).exec();
  if (!job) return;
  try {
    job.status = 'processing';
    job.startedAt = new Date();
    await job.save();

    const format = job.format || 'csv';
    const query = (job.query ?? {}) as Record<string, any>;
    const report = await collectRows(job.reportKey, query);
    const rowsForSpreadsheet = flattenRows(Object.values(report).flatMap((v) => (Array.isArray(v) ? v : [v])) as Record<string, unknown>[]);

    let buffer: Buffer;
    let ext: string;
    switch (format) {
      case 'xlsx': buffer = await buildXLSX(rowsForSpreadsheet); ext = 'xlsx'; break;
      case 'pdf': buffer = await buildPDF(report); ext = 'pdf'; break;
      case 'json': buffer = Buffer.from(buildJSON(report), 'utf8'); ext = 'json'; break;
      default: buffer = Buffer.from(buildCSV(rowsForSpreadsheet), 'utf8'); ext = 'csv'; break;
    }

    const password = (query.password ?? undefined) as string | undefined;
    const encrypted = typeof password === 'string' && password.length > 0;
    let signed = buffer;
    if (encrypted) {
      signed = encryptPayload(buffer, password).file;
      ext = `${ext}.enc`;
    }

    const fileName = `report-${job.reportKey}-${Date.now()}.${ext}`;
    const outputPath = path.join(exportDir(), fileName);
    await fsp.writeFile(outputPath, signed);

    job.status = 'completed';
    job.fileName = fileName;
    job.storagePath = outputPath;
    job.recordCount = rowsForSpreadsheet.length;
    job.bytes = signed.length;
    job.checksum = sha256(signed);
    job.encrypted = encrypted;
    job.signed = true;
    job.completedAt = new Date();
    job.error = undefined;
    await job.save();

    await auditService
      .log({
        action: 'report.exported',
        entityType: 'ReportExportJob',
        entityId: String(job._id),
        details: { reportKey: job.reportKey, format, rows: job.recordCount, encrypted },
      })
      .catch(() => {});
  } catch (err: any) {
    job.status = 'failed';
    job.error = String(err?.message || err);
    await job.save().catch(() => {});
  }
}

export async function createExportJob(params: {
  reportKey: string;
  format: ReportExportFormat;
  query?: Record<string, any>;
  requestedBy: string;
  requestedById?: string;
}): Promise<any> {
  const job = await ReportExportJob.create({
    reportKey: params.reportKey,
    format: params.format || 'csv',
    status: 'pending',
    query: { ...params.query, password: undefined } as any,
    generatedBy: params.requestedBy,
    generatedById: params.requestedById,
  });
  setImmediate(() => {
    generateExport(String(job._id)).catch((e) => console.warn('[report-export] job error:', e?.message));
  });
  return job;
}

export async function getJobStatus(id: string): Promise<any | null> {
  const job = await ReportExportJob.findById(id).lean().exec();
  if (!job) return null;
  return {
    id: String(job._id),
    reportKey: job.reportKey,
    format: job.format,
    status: job.status,
    recordCount: job.recordCount ?? 0,
    bytes: job.bytes ?? null,
    checksum: job.checksum || null,
    encrypted: job.encrypted || false,
    signed: job.signed || false,
    fileName: job.fileName || null,
    error: job.error || null,
    generatedBy: job.generatedBy || null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() || null,
    completedAt: job.completedAt?.toISOString() || null,
  };
}

export function resolveJobFile(job: { storagePath?: string; fileName?: string }): { buffer: Buffer; fileName: string } {
  if (!job.storagePath) throw new Error('Export file has not been generated yet.');
  const buffer = fs.readFileSync(job.storagePath);
  return { buffer, fileName: job.fileName || 'report-export' };
}

export { MIME };
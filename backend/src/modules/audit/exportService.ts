/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * exportService.ts — Audit export generation (CSV / JSON / XLSX / PDF),
 * background job queue, signed artifacts and optional encryption.
 *
 * Jobs are persisted in AuditExportJob and processed in-process by
 * `createExportJob` (fire-and-forget). Generated files are written under
 * {uploads}/audit-exports and served by the download route. Every file is
 * SHA-256 signed; encrypted output uses AES-256-GCM.
 */

import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { config } from '../../config';
import { AuditExportJob } from './models';
import { queryAuditLogs, AuditQueryParams } from './queryService';
import { auditService } from './auditService';
export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'pdf';

export interface ExportPayload extends Omit<AuditQueryParams, 'format'> {
  format: ExportFormat;
  password?: string;
}

export const EXPORT_DIR = path.join(config.uploads.dir, 'audit-exports');

function exportDir(): string {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  return EXPORT_DIR;
}

async function collectRows(params: ExportPayload): Promise<any[]> {
  const rows: any[] = [];
  let cursor: string | undefined;
  let guard = 0;
  const cap = 250_000;
  do {
    const page = await queryAuditLogs({ ...params, cursor, limit: 500, includeStack: !!params.includeStack });
    for (const r of page.data) rows.push(r);
    cursor = page.nextCursor || undefined;
    guard++;
    if (rows.length >= cap || !page.nextCursor || guard > 2000) break;
  } while (cursor);
  return rows;
}

function safeString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function buildCSV(rows: any[]): string {
  const headers = [
    'id', 'createdAt', 'action', 'category', 'module', 'severity', 'result',
    'entityType', 'entityId', 'entityLabel', 'performedBy', 'performedById',
    'role', 'restaurantId', 'branchId', 'ipAddress', 'deviceId', 'deviceName',
    'browser', 'os', 'requestId', 'correlationId', 'route', 'method',
    'responseStatus', 'durationMs', 'executionTimeMs', 'error',
  ];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const line = (vals: string[]) => vals.map(escape).join(',');
  const out = [line(headers)];
  for (const r of rows) {
    out.push(
      line([
        safeString(r.id), safeString(r.createdAt), safeString(r.action),
        safeString(r.category), safeString(r.module), safeString(r.severity),
        safeString(r.result), safeString(r.entityType), safeString(r.entityId),
        safeString(r.entityLabel), safeString(r.performedBy), safeString(r.performedById),
        safeString(r.role), safeString(r.restaurantId), safeString(r.branchId),
        safeString(r.ipAddress), safeString(r.deviceId), safeString(r.deviceName),
        safeString(r.browser), safeString(r.os), safeString(r.requestId),
        safeString(r.correlationId), safeString(r.route), safeString(r.method),
        safeString(r.responseStatus), safeString(r.durationMs), safeString(r.executionTimeMs),
        safeString(r.error),
      ]),
    );
  }
  return out.join('\n');
}

export function buildJSON(rows: any[]): string {
  return JSON.stringify(rows, null, 2);
}

export async function buildXLSX(rows: any[]): Promise<Buffer> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('AuditLog');
  ws.columns = [
    { header: 'ID', key: 'id', width: 12 }, { header: 'Created', key: 'createdAt', width: 22 },
    { header: 'Action', key: 'action', width: 24 }, { header: 'Category', key: 'category', width: 14 },
    { header: 'Module', key: 'module', width: 14 }, { header: 'Severity', key: 'severity', width: 10 },
    { header: 'Result', key: 'result', width: 10 }, { header: 'Entity', key: 'entityType', width: 14 },
    { header: 'Entity ID', key: 'entityId', width: 22 }, { header: 'Actor', key: 'performedBy', width: 20 },
    { header: 'Role', key: 'role', width: 14 }, { header: 'IP', key: 'ipAddress', width: 16 },
    { header: 'Error', key: 'error', width: 40 },
  ];
  for (const r of rows) {
    ws.addRow({
      id: safeString(r.id), createdAt: safeString(r.createdAt), action: safeString(r.action),
      category: safeString(r.category), module: safeString(r.module), severity: safeString(r.severity),
      result: safeString(r.result), entityType: safeString(r.entityType), entityId: safeString(r.entityId),
      performedBy: safeString(r.performedBy), role: safeString(r.role), ipAddress: safeString(r.ipAddress),
      error: safeString(r.error),
    });
  }
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildPDF(rows: any[]): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  doc.fontSize(16).text('Audit Log Export', { align: 'center' });
  doc.moveDown().fontSize(8);
  for (const r of rows.slice(0, 2000)) {
    doc.text(
      [safeString(r.createdAt), safeString(r.action), safeString(r.severity), safeString(r.result), safeString(r.performedBy), safeString(r.entityType)].join('  |  '),
    );
    if (r.error) doc.text(`    error: ${safeString(r.error)}`);
    doc.moveDown(0.2);
  }

  const p = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  doc.end();
  return p;
}

export function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Decrypt an encryptPayload() envelope. Returns null on any failure. */
export function decryptOrNull(data: Buffer, password: string): Buffer | null {
  try {
    const nl = data.indexOf(10);
    if (nl < 0) return null;
    const meta = JSON.parse(data.slice(0, nl).toString('utf8'));
    if (meta.alg !== 'aes-256-gcm' || meta.kdf !== 'scrypt') return null;
    const key = crypto.scryptSync(password, Buffer.from(meta.salt, 'base64'), 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(meta.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(meta.tag, 'base64'));
    const ciphertext = data.slice(nl + 1);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
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

const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv',
  json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export async function generateExport(jobId: string): Promise<void> {
  const job = await AuditExportJob.findById(jobId).exec();
  if (!job) return;

  try {
    job.status = 'processing';
    job.startedAt = new Date();
    await job.save();

    const params = job.filters as Record<string, unknown>;
    const format = (params.format as ExportFormat) || 'csv';
    const rows = await collectRows(params as unknown as ExportPayload);

    let buffer: Buffer;
    let ext: string;
    switch (format) {
      case 'xlsx': buffer = await buildXLSX(rows); ext = 'xlsx'; break;
      case 'pdf': buffer = await buildPDF(rows); ext = 'pdf'; break;
      case 'json': buffer = Buffer.from(buildJSON(rows), 'utf8'); ext = 'json'; break;
      default: buffer = Buffer.from(buildCSV(rows), 'utf8'); ext = 'csv'; break;
    }

    const encrypted = typeof params.password === 'string' && params.password.length > 0;
    let signed = buffer;
    const safePassword = params.password;
    if (encrypted && typeof safePassword === 'string') {
      signed = encryptPayload(buffer, safePassword).file;
      ext = `${ext}.enc`;
    }

    const fileName = `audit-${job._id}-${Date.now()}.${ext}`;
    const outputPath = path.join(exportDir(), fileName);
    await fsp.writeFile(outputPath, signed);

    job.status = 'completed';
    job.fileName = fileName;
    job.outputPath = outputPath;
    job.rowCount = rows.length;
    job.fileSizeBytes = signed.length;
    job.signedHash = sha256(signed);
    job.encrypted = encrypted;
    job.completedAt = new Date();
    job.error = undefined;
    await job.save();

    await auditService
      .log({
        action: 'audit.exported',
        entityType: 'AuditExportJob',
        entityId: String(job._id),
        details: { format, rows: rows.length, encrypted },
      })
      .catch(() => {});
  } catch (err: any) {
    job.status = 'failed';
    job.error = String(err?.message || err);
    await job.save().catch(() => {});
  }
}

export async function createExportJob(params: ExportPayload, requestedBy: string, requestedById?: string): Promise<any> {
  const job = await AuditExportJob.create({
    format: params.format || 'csv',
    status: 'queued',
    filters: { ...params, includeStack: false } as any,
    requestedBy,
    requestedById,
    rowCount: 0,
  });
  setImmediate(() => {
    generateExport(String(job._id)).catch((e) => console.warn('[audit-export] job error:', e?.message));
  });
  return job;
}

export async function getJobStatus(id: string): Promise<any | null> {
  const job = await AuditExportJob.findById(id).lean().exec();
  if (!job) return null;
  return {
    id: String(job._id),
    format: job.format,
    filters: job.filters,
    status: job.status,
    rowCount: job.rowCount ?? 0,
    fileSizeBytes: job.fileSizeBytes ?? null,
    signature: job.signedHash || null,
    encrypted: job.encrypted || false,
    fileName: job.fileName || null,
    error: job.error || null,
    requestedBy: job.requestedBy || null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() || null,
    completedAt: job.completedAt?.toISOString() || null,
  };
}

export function resolveJobFile(job: { outputPath?: string; fileName?: string }): { buffer: Buffer; fileName: string } {
  if (!job.outputPath) throw new Error('Export file has not been generated yet.');
  const buffer = fs.readFileSync(job.outputPath);
  return { buffer, fileName: job.fileName || 'audit-export' };
}

export { MIME };
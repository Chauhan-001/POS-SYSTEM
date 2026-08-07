/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * integrityService.ts — Hash-chain verification + tamper detection.
 *
 * The chain head is tracked in AuditChainMeta (seq + lastHash). Verification
 * walks chainIndex 1..seq, resolving each row from the active AuditLog OR the
 * AuditLogArchive (so archiving does not produce false breaks), and recomputes
 * the canonical hash. Any mismatch, gap, or broken prevHash link is reported.
 */

import crypto from 'crypto';
import AuditLog from '../../models/AuditLog';
import { AuditChainMeta, AuditLogArchive, AUDIT_META_ID } from './models';
import { recomputeDocHash } from './auditService';

const GENESIS = 'genesis';

export interface IntegrityRow {
  chainIndex: number;
  source: 'active' | 'archive';
  id: string;
  createdAt: Date;
  storedHash: string;
  storedPrev: string;
  expectedHash: string;
  ok: boolean;
}

export interface IntegrityReport {
  verified: boolean;
  message: string;
  totalRows: number;
  chainedRows: number;
  verifiedRows: number;
  metaSeq: number;
  expectedLastHash: string | null;
  storedLastHash: string | null;
  brokenAt: IntegrityRow | null;
  missing: number[];
  tampered: string[];
}

export async function getChainMeta() {
  return AuditChainMeta.findById(AUDIT_META_ID).lean().exec();
}

async function loadRowsInRange(seqFrom: number, seqTo: number): Promise<Map<number, any>> {
  const map = new Map<number, any>();

  const active = await AuditLog.find({ chainIndex: { $gte: seqFrom, $lte: seqTo } }).lean().exec();
  for (const d of active) if (d.chainIndex !== undefined) map.set(d.chainIndex, { ...d, _source: 'active' });

  const archived = await AuditLogArchive.find({ chainIndex: { $gte: seqFrom, $lte: seqTo } }).lean().exec();
  for (const d of archived) if (d.chainIndex !== undefined) map.set(d.chainIndex, { ...d, _source: 'archive' });

  return map;
}

export async function verifyIntegrity(): Promise<IntegrityReport> {
  const meta = await getChainMeta();
  const metaSeq = meta?.seq || 0;
  const storedLastHash = meta?.lastHash || null;

  const report: IntegrityReport = {
    verified: false,
    message: '',
    totalRows: 0,
    chainedRows: metaSeq,
    verifiedRows: 0,
    metaSeq,
    expectedLastHash: null,
    storedLastHash,
    brokenAt: null,
    missing: [],
    tampered: [],
  };

  if (metaSeq === 0) {
    report.verified = true;
    report.message = 'Empty chain — nothing to verify.';
    return report;
  }

  const rows = await loadRowsInRange(1, metaSeq);
  report.totalRows = rows.size;

  let prevHash = GENESIS;
  for (let seq = 1; seq <= metaSeq; seq++) {
    const row = rows.get(seq);
    if (!row) {
      report.missing.push(seq);
      continue;
    }

    const expectedHash = recomputeDocHash(row, prevHash);
    const ok = row.hash === expectedHash && row.prevHash === prevHash;
    if (!ok) {
      report.tampered.push(String(row._id || seq));
      report.brokenAt = {
        chainIndex: seq,
        source: row._source,
        id: String(row._id || seq),
        createdAt: row.createdAt,
        storedHash: row.hash,
        storedPrev: row.prevHash,
        expectedHash,
        ok: false,
      };
      break; // stop at first break for clarity
    }
    prevHash = row.hash;
    report.verifiedRows++;
  }

  report.expectedLastHash = prevHash;
  const chainHeadConsistent = !storedLastHash || storedLastHash === prevHash;
  report.verified = report.missing.length === 0 && report.tampered.length === 0 && chainHeadConsistent;

  if (report.verified) {
    report.message = `Integrity verified: ${report.verifiedRows}/${metaSeq} rows (missing: 0, tampered: 0).`;
  } else {
    report.message = `Integrity broken: missing=${report.missing.length}, tampered=${report.tampered.length}${report.brokenAt ? `, break at #${report.brokenAt.chainIndex}` : ''}.`;
  }

  return report;
}

/** Deterministic checksum over every stored row (for quick change detection). */
export async function checksumIntegrity(): Promise<{ checksum: string; count: number; algorithm: string }> {
  const hash = crypto.createHash('sha256');
  let count = 0;

  const active = await AuditLog.find({}).sort({ chainIndex: 1 }).select('hash chainIndex _id').lean().exec();
  const archived = await AuditLogArchive.find({}).sort({ chainIndex: 1 }).select('hash chainIndex _id').lean().exec();

  const all = [
    ...active.map((d) => ({ seq: d.chainIndex, id: String(d._id), hash: d.hash })),
    ...archived.map((d) => ({ seq: d.chainIndex, id: String(d._id), hash: d.hash })),
  ].sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));

  for (const row of all) {
    hash.update(String(row.seq)).update('|').update(row.id).update('|').update(row.hash || '').update('\n');
    count++;
  }

  return { checksum: hash.digest('hex'), count, algorithm: 'sha256' };
}
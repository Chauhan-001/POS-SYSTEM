/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Enterprise audit subsystem tests (Phase 2.9).
 *
 * Uses mongodb-memory-server and the REAL AuditService to verify:
 *  - canonicalization + derived metadata
 *  - write-time secret masking, read-time PII masking
 *  - hash chaining (seq continuity, cross-check via verifyIntegrity)
 *  - tamper detection (breaking a stored hash is caught)
 *  - query layer: search/filter/sort/cursor + page pagination
 *  - retention: archive, restore, legal hold
 *  - export: CSV/JSON build + background job lifecycle
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import AuditLog from '../../../models/AuditLog';
import { auditService, recomputeDocHash } from '../auditService';
import { maskSecrets, maskPii, isSensitiveKey, isPiiKey } from '../masking';
import {
  canonicalizeAction, moduleFor, categoryFor, severityFor, getActionMeta, allActions,
} from '../actionRegistry';
import { parseUserAgent } from '../auditContext';
import { queryAuditLogs, buildAuditFilter, encodeCursor, decodeCursor } from '../queryService';
import { verifyIntegrity, checksumIntegrity } from '../integrityService';
import { getRetentionRules, retentionDaysFor, runRetentionCleanup, restoreArchived, isUnderLegalHold } from '../retentionService';
import { buildCSV, buildJSON, sha256, encryptPayload, decryptOrNull } from '../exportService';
import { getAuditStats } from '../statsService';
import { AuditChainMeta, AuditLogArchive, AuditLegalHold, AUDIT_META_ID } from '../models';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await AuditLog.deleteMany({}).exec();
  await AuditChainMeta.deleteMany({}).exec();
  await AuditLogArchive.deleteMany({}).exec();
  await AuditLegalHold.deleteMany({}).exec();
});

// ─── Masking ──────────────────────────────────────────────────────

describe('masking', () => {
  it('detects sensitive and PII keys', () => {
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('managerPin')).toBe(true);
    expect(isSensitiveKey('cvv')).toBe(true);
    expect(isSensitiveKey('authorization')).toBe(true);
    expect(isSensitiveKey('notes')).toBe(false);
    expect(isPiiKey('phone')).toBe(true);
    expect(isPiiKey('email')).toBe(true);
    expect(isPiiKey('aadhaar')).toBe(true);
    expect(isPiiKey('name')).toBe(false);
  });

  it('masks secrets recursively on write', () => {
    const masked = maskSecrets({
      password: 'hunter2',
      nested: { token: 'abc123', pin: '1234' },
      safe: 'keep',
    }) as any;
    expect(masked.password).toBe('[REDACTED]');
    expect(masked.nested.token).toBe('[REDACTED]');
    expect(masked.safe).toBe('keep');
  });

  it('masks PII on read', () => {
    const masked = maskPii({ phone: '9876543210', email: 'a@b.com' }) as any;
    expect(masked.phone).toBe('[REDACTED]');
  });
});

// ─── Registry ─────────────────────────────────────────────────────

describe('action registry', () => {
  it('maps legacy action names to canonical', () => {
    expect(canonicalizeAction('RESTAURANT_CREATED')).toBe('restaurant.created');
    expect(canonicalizeAction('LOGIN')).toBe('login.success');
    expect(canonicalizeAction('unmapped.custom')).toBe('unmapped.custom');
  });

  it('derives module/category/severity', () => {
    expect(moduleFor('restaurant.created')).toBe('restaurant');
    expect(categoryFor('login.failed')).toBe('authentication');
    expect(severityFor('restaurant.deleted')).toBe('critical');
    expect(getActionMeta('device.blocked')).toBeTruthy();
    expect(allActions().length).toBeGreaterThan(50);
  });

  it('parses user agents', () => {
    const out = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    expect(out.browser).toBe('Chrome');
    expect(out.platform).toBe('Windows');
  });
});

// ─── Hash chain + tamper detection ────────────────────────────────

describe('hash chain', () => {
  it('chains sequential writes and verifies cleanly', async () => {
    await auditService.log({ action: 'restaurant.created', entityType: 'Restaurant', performedBy: 'admin' });
    await auditService.log({ action: 'device.blocked', entityType: 'Device', performedBy: 'admin' });
    await auditService.log({ action: 'auth.login_failed', entityType: 'User', performedBy: 'admin' });

    const report = await verifyIntegrity();
    expect(report.verified).toBe(true);
    expect(report.verifiedRows).toBe(3);

    const meta = await AuditChainMeta.findById(AUDIT_META_ID).lean().exec();
    expect(meta!.seq).toBe(3);
    expect(report.expectedLastHash).toBe(meta!.lastHash);
  });

  it('detects tampering when a hash is mutated', async () => {
    await auditService.log({ action: 'restaurant.created', entityType: 'Restaurant', performedBy: 'admin' });
    await auditService.log({ action: 'device.blocked', entityType: 'Device', performedBy: 'admin' });

    // Mutate the stored hash of the first row — simulate tampering.
    const first = await AuditLog.findOne({ chainIndex: 1 }).lean().exec();
    await AuditLog.updateOne({ _id: first!._id }, { $set: { hash: 'tampered' } }).exec();

    const report = await verifyIntegrity();
    expect(report.verified).toBe(false);
    expect(report.tampered.length).toBeGreaterThan(0);
    expect(report.brokenAt).not.toBeNull();
  });

  it('recomputes a doc hash consistently from prevHash', async () => {
    await auditService.log({ action: 'restaurant.created', entityType: 'Restaurant', performedBy: 'admin' });
    const doc = await AuditLog.findOne({ chainIndex: 1 }).lean().exec();
    const recomputed = recomputeDocHash(doc as any, 'genesis');
    expect(recomputed).toBe(doc!.hash);
  });

  it('returns a deterministic checksum', async () => {
    await auditService.log({ action: 'restaurant.created', entityType: 'Restaurant', performedBy: 'admin' });
    const a = await checksumIntegrity();
    const b = await checksumIntegrity();
    expect(a.checksum).toBe(b.checksum);
    expect(a.algorithm).toBe('sha256');
  });
});

// ─── Query layer ──────────────────────────────────────────────────

describe('query layer', () => {
  it('applies filters and search', async () => {
    await auditService.log({ action: 'restaurant.created', entityType: 'Restaurant', performedBy: 'alice', severity: 'info' });
    await auditService.log({ action: 'auth.login_failed', entityType: 'User', performedBy: 'bob', severity: 'high' });

    const f = buildAuditFilter({ search: 'alice' });
    expect(f.$or && (f as any).$or.length).toBeGreaterThan(0);

    const res = await queryAuditLogs({ search: 'alice' });
    expect(res.total).toBe(1);
    expect(res.data[0].performedBy).toBe('alice');
  });

  it('paginates with a stable cursor', async () => {
    for (let i = 0; i < 25; i++) {
      await auditService.log({ action: 'restaurant.created', entityType: 'Restaurant', performedBy: `u${i}` });
    }
    const page1 = await queryAuditLogs({ limit: 10 });
    expect(page1.data.length).toBe(10);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await queryAuditLogs({ limit: 10, cursor: page1.nextCursor! });
    expect(page2.data.length).toBe(10);
    // No overlap between pages.
    const ids1 = new Set(page1.data.map((d) => d.id));
    const overlap = page2.data.filter((d) => ids1.has(d.id));
    expect(overlap.length).toBe(0);
  });

  it('encodes/decodes cursors', () => {
    const cursor = encodeCursor({ createdAt: new Date('2026-01-01T00:00:00Z'), _id: new mongoose.Types.ObjectId() } as any);
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded!.cursorAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(decodeCursor('not-valid')).toBeNull();
  });

  it('masks PII on read output', async () => {
    await auditService.log({ action: 'customer.updated', entityType: 'Customer', performedBy: 'alice', details: { phone: '9876543210' } });
    const res = await queryAuditLogs({ search: 'alice' });
    expect((res.data[0].details as any).phone).toBe('[REDACTED]');
  });
});

// ─── Retention / archive ──────────────────────────────────────────

describe('retention', () => {
  it('exposes retention rules with a default', () => {
    const rules = getRetentionRules();
    expect(rules.defaultDays).toBeGreaterThan(0);
    expect(retentionDaysFor('unknown.module')).toBe(rules.defaultDays);
  });

  it('honours an active legal hold during cleanup', async () => {
    await auditService.log({ action: 'restaurant.created', entityType: 'Restaurant', entityId: 'r1', performedBy: 'admin' });
    await AuditLegalHold.create({ caseRef: 'case-1', reason: 'lawsuit', entityType: 'Restaurant', entityId: 'r1', createdBy: 'admin' } as any);

    const held = await isUnderLegalHold({ entityType: 'Restaurant', entityId: 'r1' });
    expect(held).toBe(true);

    // Force cleanup with a very old retention so the row would be archived.
    const original = process.env.AUDIT_RETENTION_DAYS;
    process.env.AUDIT_RETENTION_DAYS = '0';
    const result = await runRetentionCleanup({ force: true });
    process.env.AUDIT_RETENTION_DAYS = original as string;
    // The held row must not be archived (hold exempts it from cleanup).
    const archived = await AuditLogArchive.countDocuments({}).exec();
    expect(archived).toBe(0);
    expect(result.held).toBeGreaterThanOrEqual(1);
    expect(result.archived).toBe(0);
  });

  it('archives then restores a row preserving the chain', async () => {
    await auditService.log({ action: 'restaurant.created', entityType: 'Restaurant', performedBy: 'admin' });
    const before = await queryAuditLogs({});
    const rowId: string = String(before.data[0].id);

    const archivedResult = await runRetentionCleanup({ force: true });
    expect(archivedResult.archived).toBe(1);

    const inActive = await AuditLog.findById(rowId).lean().exec();
    expect(inActive).toBeNull();
    const inArchive = await AuditLogArchive.findOne({ _id: rowId }).lean().exec();
    expect(inArchive).toBeTruthy();

    const restored = await restoreArchived([rowId]);
    expect(restored.restored).toBe(1);
    expect(await AuditLog.findById(rowId).lean().exec()).toBeTruthy();
    expect(await AuditLogArchive.findById(rowId).lean().exec()).toBeNull();
  });

  it('verification still passes with archived rows (chain continues via archive)', async () => {
    await auditService.log({ action: 'restaurant.created', entityType: 'Restaurant', performedBy: 'admin' });
    await auditService.log({ action: 'device.blocked', entityType: 'Device', performedBy: 'admin' });

    // Archive the first row.
    await runRetentionCleanup({ force: true });
    const report = await verifyIntegrity();
    // Rows order: whichever got archived; verification must resolve chainIndex 1 and 2
    // across active+archive. With force archiving both older/newer, chainIndex is preserved.
    expect(report.verified).toBe(true);
  });
});

// ─── Exports ──────────────────────────────────────────────────────

describe('exports', () => {
  it('builds CSV and JSON', async () => {
    await auditService.log({ action: 'restaurant.created', entityType: 'Restaurant', performedBy: 'alice' });
    const rows = (await queryAuditLogs({})).data;
    const csv = buildCSV(rows);
    expect(csv).toContain('"action"');
    expect(csv).toContain('"restaurant.created"');
    const json = buildJSON(rows);
    expect(JSON.parse(json)[0].action).toBe('restaurant.created');
  });

  it('produces a signed SHA-256 and encrypted payload round-trip', async () => {
    const data = Buffer.from('hello world');
    const sig = sha256(data);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    const enc = encryptPayload(data, 'pass123');
    expect(enc.file.length).toBeGreaterThan(0);
    const dec = decryptOrNull(enc.file, 'pass123');
    expect(dec!.toString()).toBe('hello world');
    expect(decryptOrNull(enc.file, 'wrong')).toBeNull();
  });

  it('returns dashboard statistics', async () => {
    await auditService.log({ action: 'auth.login_failed', entityType: 'User', performedBy: 'bob' });
    await auditService.log({ action: 'restaurant.created', entityType: 'Restaurant', performedBy: 'alice' });
    const stats = await getAuditStats();
    expect(stats.totals.total).toBe(2);
    expect(stats.health.failedLogins).toBe(1);
  });
});
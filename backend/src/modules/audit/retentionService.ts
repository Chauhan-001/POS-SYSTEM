/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * retentionService.ts — Retention policy, archiving, restore and cleanup.
 *
 * Per-module retention rules with a global default. Rows older than their
 * module's retention window are moved to AuditLogArchive (cold storage) unless
 * they fall under an active legal hold. Archived rows keep their hash-chain
 * attributes so integrity verification continues to pass across the archive.
 *
 * The scheduler is opt-in (started from server.ts) and never runs in tests.
 */

import AuditLog from '../../models/AuditLog';
import { AuditLogArchive, AuditLegalHold, AUDIT_META_ID } from './models';
import { AuditChainMeta } from './models';
import { auditService } from './auditService';

export interface RetentionRule {
  module: string;
  days: number;
}

const DEFAULT_RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS || '365', 10);
const GLOBAL_TTL_DAYS = parseInt(process.env.AUDIT_GLOBAL_TTL_DAYS || '0', 10);
const RETENTION_BATCH = 500;

/** Per-module retention (days). Anything not listed uses the default. */
const MODULE_RETENTION: Record<string, number> = (() => {
  const raw = process.env.AUDIT_RETENTION_MODULES || '';
  const rules: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [module, days] = part.split(':');
    if (module && days) rules[module.trim()] = parseInt(days, 10);
  }
  return rules;
})();

export function getRetentionRules(): { defaultDays: number; rules: RetentionRule[] } {
  return {
    defaultDays: DEFAULT_RETENTION_DAYS,
    rules: Object.entries(MODULE_RETENTION).map(([module, days]) => ({ module, days })),
  };
}

export function retentionDaysFor(module?: string): number {
  if (module && MODULE_RETENTION[module] !== undefined) return MODULE_RETENTION[module];
  return DEFAULT_RETENTION_DAYS;
}

/**
 * A row is under legal hold when an active hold matches its module OR its
 * entityType+entityId (and no global hold supersedes expiry).
 */
export async function isUnderLegalHold(row: {
  module?: string;
  entityType?: string;
  entityId?: string;
}): Promise<boolean> {
  const now = new Date();
  const or: Record<string, unknown>[] = [];
  if (row.module) or.push({ module: row.module });
  if (row.entityType) or.push({ entityType: row.entityType });
  if (row.entityType && row.entityId) or.push({ entityType: row.entityType, entityId: row.entityId });

  const hold = await AuditLegalHold.findOne({
    $and: [{ active: true }, { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }, { $or: or }],
  }).exec();
  return !!hold;
}

/**
 * Archive + delete expired rows (batch, legal-hold aware).
 * Returns counts so the UI can report what happened.
 */
export async function runRetentionCleanup(options: { force?: boolean } = {}): Promise<{
  scanned: number;
  archived: number;
  held: number;
  deleted: number;
}> {
  const cutoff = new Date(Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const meta = await AuditChainMeta.findById(AUDIT_META_ID).lean().exec();
  const maxSeq = meta?.seq || 0;

  let scanned = 0;
  let archived = 0;
  let held = 0;

  for (let from = 1; from <= maxSeq; from += RETENTION_BATCH) {
    const to = Math.min(maxSeq, from + RETENTION_BATCH - 1);
    const rows = await AuditLog.find({ chainIndex: { $gte: from, $lte: to } })
      .lean()
      .exec();

    for (const row of rows) {
      scanned++;
      const created = row.createdAt || new Date(0);
      if (!options.force && created > cutoff) continue;
      const module = row.module || 'system';
      if (!options.force && retentionDaysFor(module) === 0) continue;

      const legalHold = await isUnderLegalHold({
        module: row.module,
        entityType: row.entityType,
        entityId: row.entityId,
      });
      if (legalHold) {
        held++;
        continue;
      }

      await AuditLogArchive.create({
        ...(row as any),
        _id: row._id,
        archivedAt: new Date(),
        originalCreatedAt: created,
      } as any);
      await AuditLog.deleteOne({ _id: row._id }).exec();
      archived++;
    }
  }

  return { scanned, archived, held, deleted: archived };
}

/**
 * Restore archived rows (by ids) back to the active collection. Original
 * _id / chainIndex / hash are preserved so the chain is not perturbed.
 */
export async function restoreArchived(ids: string[]): Promise<{ restored: number; notFound: number }> {
  let restored = 0;
  let notFound = 0;
  for (const id of ids) {
    const archived = await AuditLogArchive.findById(id).lean().exec();
    if (!archived) {
      notFound++;
      continue;
    }
    const { archivedAt, ...row } = archived as any;
    await AuditLog.create({ ...row, _id: archived._id } as any);
    await AuditLogArchive.deleteOne({ _id: archived._id }).exec();
    restored++;
  }
  return { restored, notFound };
}

export async function listArchived(params: { page?: number; limit?: number; module?: string; from?: string; to?: string } = {}) {
  const filter: Record<string, unknown> = {};
  if (params.module) filter.module = params.module;
  if (params.from || params.to) {
    const d: Record<string, unknown> = {};
    if (params.from) d.$gte = new Date(params.from);
    if (params.to) d.$lte = new Date(params.to);
    if (Object.keys(d).length) filter.originalCreatedAt = d;
  }
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const skip = (page - 1) * limit;

  const [docs, total] = await Promise.all([
    AuditLogArchive.find(filter).sort({ originalCreatedAt: -1 }).skip(skip).limit(limit).lean().exec(),
    AuditLogArchive.countDocuments(filter).exec(),
  ]);

  return {
    data: docs.map((d) => ({
      id: String(d._id),
      action: d.action,
      module: d.module || null,
      severity: d.severity || null,
      entityType: d.entityType,
      entityId: d.entityId || null,
      performedBy: d.performedBy,
      restaurantId: d.restaurantId ? String(d.restaurantId) : null,
      archivedAt: d.archivedAt.toISOString(),
      originalCreatedAt: d.originalCreatedAt.toISOString(),
      chainIndex: d.chainIndex ?? null,
      hash: d.hash || null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/** Optional global TTL index (enabled when AUDIT_GLOBAL_TTL_DAYS > 0). */
export async function ensureGlobalTtlIndex(): Promise<boolean> {
  if (GLOBAL_TTL_DAYS <= 0) return false;
  await AuditLog.collection.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: GLOBAL_TTL_DAYS * 24 * 60 * 60 },
  );
  return true;
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startRetentionScheduler(intervalMs = 6 * 60 * 60 * 1000): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    runRetentionCleanup()
      .then((res) => {
        if (res.archived > 0) {
          auditService.log({
            action: 'retention.archived',
            entityType: 'AuditLog',
            details: { archived: res.archived, held: res.held },
          }).catch(() => {});
        }
      })
      .catch((err) => console.warn('[retention] cleanup failed:', err?.message));
  }, intervalMs);
  if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) cleanupTimer.unref();
}

export function stopRetentionScheduler(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
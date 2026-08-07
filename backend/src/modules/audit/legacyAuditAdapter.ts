/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * legacyAuditAdapter.ts — Routes legacy `auditLogRepo.create(...)` writes
 * through the enterprise AuditService so every existing mutation benefits from
 * canonicalization, write-side secret masking and hash-chained insertion —
 * without touching the 86 legacy call sites.
 *
 * The adapter keeps the BaseRepository surface (create / findAll / …) so
 * existing services continue to compile and behave identically.
 */

import { BaseRepository } from '../../repositories/baseRepository';
import AuditLog, { IAuditLog } from '../../models/AuditLog';
import { auditService } from './auditService';

export class LegacyAuditAdapter extends BaseRepository<IAuditLog> {
  constructor(model: typeof AuditLog) {
    super(model);
  }

  /** Route every legacy create through the enterprise service (never throws). */
  override async create(data: Partial<IAuditLog>): Promise<IAuditLog> {
    const entry = data as any;
    await auditService.log({
      action: entry.action || 'system.unknown',
      preserveAction: true,
      entityType: entry.entityType || 'system',
      entityId: entry.entityId,
      entityLabel: entry.entityLabel,
      performedBy: entry.performedBy,
      performedById: entry.performedById,
      restaurantId: entry.restaurantId ? String(entry.restaurantId) : undefined,
      branchId: entry.branchId ? String(entry.branchId) : undefined,
      ipAddress: entry.ipAddress,
      role: entry.role,
      details: entry.details || {},
      metadata: entry.metadata,
      oldValues: entry.oldValues,
      newValues: entry.newValues,
      changedFields: entry.changedFields,
      severity: entry.severity,
      result: entry.result,
      reason: entry.reason,
    });
    // Legacy call sites only await; return a minimal document-shaped value.
    return { _id: undefined as any, createdAt: new Date() } as IAuditLog;
  }
}

/** Singleton matching the previous `auditLogRepo` import site. */
export const auditLogRepo = new LegacyAuditAdapter(AuditLog);
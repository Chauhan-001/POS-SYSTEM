/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * auditService.ts — The single writer for the enterprise audit trail.
 *
 * Every module calls auditService.log({ action, entityType, entityId, ... }).
 * Everything else (actor, tenant, device, IP, browser, OS, route, method,
 * request/correlation ids) is collected automatically from the request context.
 *
 * Guarantees:
 *  - Canonical action names (see actionRegistry)
 *  - Write-time masking of secrets before persistence
 *  - Immutable hash chain (prevHash/hash) with conflict-safe insertion
 *  - Never throws into the caller's request path
 *  - Raises in-app alerts for security-relevant events
 */

import crypto from 'crypto';
import AuditLog, { IAuditLog, AuditSeverity, AuditResult } from '../../models/AuditLog';
import { getAuditStore, parseUserAgent, requestIp, requestDeviceId } from './auditContext';
import { maskSecrets } from './masking';
import {
  canonicalizeAction,
  categoryFor,
  severityFor,
  moduleFor,
  isSecurityAction,
} from './actionRegistry';
import { AuditChainMeta, AuditAlert, AUDIT_META_ID } from './models';

export interface AuditLogInput {
  action: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  category?: string;
  module?: string;
  severity?: AuditSeverity;
  result?: AuditResult;
  success?: boolean;
  status?: 'success' | 'failure';
  performedBy?: string;
  performedById?: string;
  role?: string;
  restaurantId?: string;
  restaurantName?: string;
  branchId?: string;
  branchName?: string;
  ipAddress?: string;
  deviceId?: string;
  deviceName?: string;
  sessionId?: string;
  requestId?: string;
  correlationId?: string;
  route?: string;
  method?: string;
  responseStatus?: number;
  durationMs?: number;
  executionTimeMs?: number;
  error?: string;
  stackTrace?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changedFields?: string[];
  reason?: string;
  comments?: string;
  location?: string;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /** Store the raw action string verbatim (legacy compat), while still deriving
   *  canonical category/module/severity metadata from the canonicalized form. */
  preserveAction?: boolean;
}

export interface AuditWriteResult {
  id?: string;
  hash?: string;
  chainIndex?: number;
  written: boolean;
}

/**
 * Recompute the canonical hash for an existing row. Used by the integrity
 * verifier to validate stored hashes without re-running the writer.
 */
export function recomputeDocHash(
  doc: {
    chainIndex?: number;
    action?: string;
    category?: string;
    module?: string;
    severity?: string;
    result?: string;
    entityType?: string;
    entityId?: string;
    performedBy?: string;
    performedById?: string;
    role?: string;
    restaurantId?: unknown;
    branchId?: unknown;
    ipAddress?: string;
    deviceId?: string;
    sessionId?: string;
    requestId?: string;
    correlationId?: string;
    route?: string;
    method?: string;
    details?: unknown;
  },
  prevHash: string,
): string {
  const canonical = stableStringify({
    seq: doc.chainIndex,
    action: doc.action,
    category: doc.category,
    module: doc.module,
    severity: doc.severity,
    result: doc.result,
    entityType: doc.entityType,
    entityId: doc.entityId,
    performedBy: doc.performedBy,
    performedById: doc.performedById,
    role: doc.role,
    restaurantId: doc.restaurantId ? String(doc.restaurantId) : null,
    branchId: doc.branchId ? String(doc.branchId) : null,
    ipAddress: doc.ipAddress,
    deviceId: doc.deviceId,
    sessionId: doc.sessionId,
    requestId: doc.requestId,
    correlationId: doc.correlationId,
    route: doc.route,
    method: doc.method,
    details: doc.details,
  });
  return computeHash(canonical, prevHash);
}

/** Stable stringification for deterministic hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function computeHash(canonical: string, prevHash: string): string {
  return crypto.createHash('sha256').update(canonical).update(prevHash).digest('hex');
}

function derivedResult(input: AuditLogInput, action: string): AuditResult {
  if (input.result) return input.result;
  if (input.success !== undefined) return input.success ? 'success' : 'failure';
  if (input.status === 'failure') return 'failure';
  if (/\.failed$/.test(action) || /failure/i.test(action)) return 'failure';
  return 'success';
}

class AuditService {
  /**
   * Write a single audit entry. Best-effort: never throws, never breaks the
   * request path. Returns the row identifiers when the write succeeded.
   */
  async log(input: AuditLogInput): Promise<AuditWriteResult> {
    try {
      const entry = await this.buildEntry(input);
      const result = await this.insertChained(entry);
      this.maybeAlert(entry, result).catch(() => { /* best-effort */ });
      return result;
    } catch (err: any) {
      console.warn('[auditService] write failed:', err?.message);
      return { written: false };
    }
  }

  /** Fire-and-forget variant for hot paths (never awaited). */
  logAsync(input: AuditLogInput): void {
    this.log(input).catch(() => { /* non-blocking */ });
  }

  private async buildEntry(input: AuditLogInput): Promise<Partial<IAuditLog>> {
    const store = getAuditStore();
    const req = store?.req;
    const auth = (req as any)?.user;
    const ua = parseUserAgent(store?.userAgent ?? req?.headers?.['user-agent'] as string);

    const canonical = canonicalizeAction(input.action);
    const storedAction = input.preserveAction ? input.action : canonical;
    const action = storedAction;
    const category = input.category || categoryFor(canonical);
    const module = input.module || moduleFor(canonical, input.entityType);
    const severity = severityFor(canonical, input.severity);
    const result = derivedResult(input, canonical);
    const success = result === 'success';
    const status = result === 'success' || result === 'failure' ? result : undefined;

    const details = maskSecrets(input.details || {}) as Record<string, unknown>;
    const metadata = maskSecrets(input.metadata || {}) as Record<string, unknown>;

    const entry: Partial<IAuditLog> = {
      action,
      category,
      module,
      severity,
      result,
      success,
      status,
      entityType: input.entityType || 'system',
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      performedBy: input.performedBy || auth?.name || auth?.userId || store?.requestId || 'System',
      performedById: input.performedById || auth?.userId || auth?.employeeId || undefined,
      role: input.role || auth?.role || undefined,
      restaurantId: input.restaurantId || auth?.restaurantId || (store?.req as any)?.body?.restaurantId || undefined,
      restaurantName: input.restaurantName || undefined,
      branchId: input.branchId || auth?.branchId || undefined,
      branchName: input.branchName || undefined,
      ipAddress: input.ipAddress || requestIp(req as any) || store?.ip,
      deviceId: input.deviceId || requestDeviceId(req as any) || undefined,
      deviceName: input.deviceName || undefined,
      userAgent: store?.userAgent || undefined,
      browser: ua.browser,
      platform: ua.platform,
      os: ua.os,
      sessionId: input.sessionId || undefined,
      requestId: input.requestId || store?.requestId,
      correlationId: input.correlationId || store?.correlationId,
      route: input.route || (req ? `${req.baseUrl}${req.path}` : store?.path),
      method: input.method || store?.method || req?.method,
      responseStatus: input.responseStatus,
      durationMs: input.durationMs,
      executionTimeMs: input.executionTimeMs,
      error: input.error,
      stackTrace: input.stackTrace,
      oldValues: input.oldValues,
      newValues: input.newValues,
      changedFields: input.changedFields,
      reason: input.reason,
      comments: input.comments,
      location: input.location,
      details,
      metadata,
    };
    return entry;
  }

  /**
   * Insert the row with hash-chaining. Uses an optimistic CAS on the chain-meta
   * doc so concurrent writers do not silently branch the chain.
   */
  private async insertChained(entry: Partial<IAuditLog>): Promise<AuditWriteResult> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const meta = await AuditChainMeta.findById(AUDIT_META_ID).lean().exec();
      const prevHash = meta?.lastHash || 'genesis';
      const seq = (meta?.seq ?? 0) + 1;

      const canonical = stableStringify({
        seq,
        action: entry.action,
        category: entry.category,
        module: entry.module,
        severity: entry.severity,
        result: entry.result,
        entityType: entry.entityType,
        entityId: entry.entityId,
        performedBy: entry.performedBy,
        performedById: entry.performedById,
        role: entry.role,
        restaurantId: entry.restaurantId ? String(entry.restaurantId) : null,
        branchId: entry.branchId ? String(entry.branchId) : null,
        ipAddress: entry.ipAddress,
        deviceId: entry.deviceId,
        sessionId: entry.sessionId,
        requestId: entry.requestId,
        correlationId: entry.correlationId,
        route: entry.route,
        method: entry.method,
        details: entry.details,
      });
      const hash = computeHash(canonical, prevHash);

      const claimed = await AuditChainMeta.updateOne(
        { _id: AUDIT_META_ID, lastHash: prevHash },
        { $set: { lastHash: hash }, $inc: { seq: 1 } },
        { upsert: true },
      ).exec();

      const won = claimed.upsertedCount === 1 || claimed.modifiedCount === 1;
      if (!won) continue; // lost the race — retry with the fresh head

      try {
        const doc = await AuditLog.create({
          ...entry,
          chainIndex: seq,
          prevHash,
          hash,
        } as any);
        return { id: String(doc._id), hash, chainIndex: seq, written: true };
      } catch (err) {
        // Revert our claim so the chain head stays consistent.
        await AuditChainMeta.updateOne(
          { _id: AUDIT_META_ID, lastHash: hash },
          { $set: { lastHash: prevHash }, $inc: { seq: -1 } },
        ).exec().catch(() => { /* best-effort revert */ });
        throw err;
      }
    }
    // Could not claim a slot after retries — write without chaining (degraded).
    const doc = await AuditLog.create(entry as any);
    return { id: String(doc._id), written: true };
  }

  /**
   * In-app alerting for security-relevant events. Deduplicated so repeated
   * identical signals do not flood the feed.
   */
  private async maybeAlert(entry: Partial<IAuditLog>, result: AuditWriteResult): Promise<void> {
    const action = entry.action || '';
    const now = new Date();

    const create = (type: string, severity: 'critical' | 'high' | 'medium' | 'low', message: string) =>
      AuditAlert.create({
        type,
        message,
        severity,
        category: entry.category || 'security',
        module: entry.module || 'audit',
        restaurantId: entry.restaurantId ? String(entry.restaurantId) : undefined,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: { chainIndex: result.chainIndex, hash: result.hash, action },
      } as any).catch(() => { /* best-effort */ });

    if (action === 'audit.tamper_detected' || action === 'audit.verified') {
      await create(action, 'critical', `Audit integrity event: ${action}`);
      return;
    }

    if (isSecurityAction(action) && severityFor(action) === 'critical') {
      const recent = await AuditAlert.findOne({ type: action, createdAt: { $gte: new Date(now.getTime() - 15 * 60 * 1000) } }).exec();
      if (!recent) {
        await create(action, 'critical', `${action} detected (severity: critical)`);
      }
      return;
    }

    if (action === 'login.failed') {
      // Repeated-login-failure detection (5+ in 10 minutes for the same account).
      const entityId = entry.entityId;
      const window = new Date(now.getTime() - 10 * 60 * 1000);
      const filter: Record<string, any> = { action: 'login.failed', createdAt: { $gte: window } };
      if (entityId) filter.entityId = entityId;
      const recentFailures = await AuditLog.countDocuments(filter).exec();
      if (recentFailures >= 5) {
        const existing = await AuditAlert.findOne({
          type: 'repeated_login_failures',
          resolved: false,
          createdAt: { $gte: window },
        }).exec();
        if (!existing) {
          await create('repeated_login_failures', 'high', `Repeated login failures (${recentFailures} in 10m)`);
        }
      }
    }
  }
}

export const auditService = new AuditService();
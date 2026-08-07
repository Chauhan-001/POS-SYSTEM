/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * queryService.ts — Enterprise audit query layer.
 *
 * Single entry point for listing, searching, filtering, sorting and paginating
 * audit entries, with read-side PII/secret masking applied to every payload.
 * Also drives exports and the dashboard.
 */

import AuditLog, { IAuditLog } from '../../models/AuditLog';
import { maskPii } from './masking';

export interface AuditQueryParams {
  page?: number;
  limit?: number;
  cursor?: string;
  search?: string;
  action?: string;
  actionContains?: string;
  module?: string;
  category?: string;
  severity?: string;
  result?: string;
  success?: boolean;
  performedBy?: string;
  performedById?: string;
  role?: string;
  restaurantId?: string;
  branchId?: string;
  restaurantName?: string;
  entityType?: string;
  entityId?: string;
  sessionId?: string;
  requestId?: string;
  correlationId?: string;
  deviceId?: string;
  ipAddress?: string;
  browser?: string;
  platform?: string;
  os?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  includeStack?: boolean;
}

const SORT_WHITELIST = new Set([
  'createdAt',
  'action',
  'severity',
  'module',
  'category',
  'result',
  'performedBy',
  'performedById',
  'restaurantId',
  'branchId',
  'role',
  'durationMs',
  'executionTimeMs',
]);

export function buildAuditFilter(params: AuditQueryParams): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  if (params.search) {
    const rx = { $regex: params.search, $options: 'i' };
    filter.$or = [
      { action: rx },
      { entityType: rx },
      { entityId: rx },
      { performedBy: rx },
      { role: rx },
      { route: rx },
      { error: rx },
      { reason: rx },
      { 'details.plan': rx },
      { 'details.message': rx },
    ];
  }

  const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

  const exactOrList = (field: string, values: string[]): void => {
    if (values.length === 1) {
      filter[field] = values[0];
    } else if (values.length > 1) {
      filter[field] = { $in: values };
    }
  };

  exactOrList('action', list(params.action));
  if (params.actionContains) filter.action = { $regex: params.actionContains, $options: 'i' };

  exactOrList('module', list(params.module));
  exactOrList('category', list(params.category));
  exactOrList('severity', list(params.severity));
  exactOrList('result', list(params.result));

  if (params.success !== undefined) filter.success = params.success;

  if (params.performedBy) filter.performedBy = { $regex: params.performedBy, $options: 'i' };
  if (params.performedById) filter.performedById = params.performedById;
  exactOrList('role', list(params.role));
  if (params.restaurantId) filter.restaurantId = params.restaurantId as any;
  if (params.branchId) filter.branchId = params.branchId as any;
  if (params.restaurantName) filter.restaurantName = { $regex: params.restaurantName, $options: 'i' };
  exactOrList('entityType', list(params.entityType));
  if (params.entityId) filter.entityId = params.entityId;
  if (params.sessionId) filter.sessionId = params.sessionId;
  if (params.requestId) filter.requestId = params.requestId;
  if (params.correlationId) filter.correlationId = params.correlationId;
  if (params.deviceId) filter.deviceId = params.deviceId;
  if (params.ipAddress) filter.ipAddress = { $regex: params.ipAddress, $options: 'i' };
  if (params.browser) filter.browser = { $regex: params.browser, $options: 'i' };
  if (params.platform) filter.platform = { $regex: params.platform, $options: 'i' };
  if (params.os) filter.os = { $regex: params.os, $options: 'i' };

  if (params.from || params.to) {
    const dateFilter: Record<string, unknown> = {};
    if (params.from) {
      const d = new Date(params.from);
      if (!isNaN(d.getTime())) dateFilter.$gte = d;
    }
    if (params.to) {
      const d = new Date(params.to);
      if (!isNaN(d.getTime())) dateFilter.$lte = d;
    }
    if (Object.keys(dateFilter).length) filter.createdAt = dateFilter;
  }

  return filter;
}

export function buildAuditSort(params: AuditQueryParams): Record<string, 1 | -1> {
  const field = SORT_WHITELIST.has(params.sortBy || '') ? params.sortBy! : 'createdAt';
  const dir = params.sortOrder === 'asc' ? 1 : -1;
  if (field === 'createdAt') return { createdAt: dir, _id: dir };
  return { [field]: dir, createdAt: -1 };
}

/** Encode a cursor from a doc's (createdAt, _id). */
export function encodeCursor(doc: { createdAt?: Date; _id: unknown }): string {
  const payload = { c: doc.createdAt ? doc.createdAt.toISOString() : '', i: String(doc._id) };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/** Decode a cursor into a (createdAt, _id) filter. Returns null when invalid. */
export function decodeCursor(cursor: string): { cursorAt: Date; cursorId: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const d = new Date(parsed.c);
    if (isNaN(d.getTime()) || typeof parsed.i !== 'string') return null;
    return { cursorAt: d, cursorId: parsed.i };
  } catch {
    return null;
  }
}

/** Convert the validated soft rows. */
export function toReadSafe(doc: IAuditLog, includeStack = false): Record<string, unknown> {
  return {
    id: String(doc._id),
    action: doc.action,
    category: doc.category || null,
    module: doc.module || null,
    severity: doc.severity || 'info',
    result: doc.result || null,
    success: doc.success ?? null,
    entityType: doc.entityType,
    entityId: doc.entityId || null,
    entityLabel: doc.entityLabel || null,
    performedBy: doc.performedBy,
    performedById: doc.performedById || null,
    role: doc.role || null,
    restaurantId: doc.restaurantId ? String(doc.restaurantId) : null,
    restaurantName: doc.restaurantName || null,
    branchId: doc.branchId ? String(doc.branchId) : null,
    branchName: doc.branchName || null,
    ipAddress: doc.ipAddress || null,
    deviceId: doc.deviceId || null,
    deviceName: doc.deviceName || null,
    browser: doc.browser || null,
    platform: doc.platform || null,
    os: doc.os || null,
    sessionId: doc.sessionId || null,
    requestId: doc.requestId || null,
    correlationId: doc.correlationId || null,
    route: doc.route || null,
    method: doc.method || null,
    responseStatus: doc.responseStatus ?? null,
    durationMs: doc.durationMs ?? null,
    executionTimeMs: doc.executionTimeMs ?? null,
    error: doc.error || null,
    stackTrace: includeStack ? doc.stackTrace || null : null,
    oldValues: doc.oldValues ? maskPii(doc.oldValues) : null,
    newValues: doc.newValues ? maskPii(doc.newValues) : null,
    changedFields: doc.changedFields || null,
    reason: doc.reason || null,
    comments: doc.comments || null,
    location: doc.location || null,
    details: doc.details ? maskPii(doc.details) : null,
    metadata: doc.metadata ? maskPii(doc.metadata) : null,
    chainIndex: doc.chainIndex ?? null,
    prevHash: doc.prevHash || null,
    hash: doc.hash || null,
    createdAt: doc.createdAt.toISOString(),
  };
}

export interface AuditQueryResult {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export async function queryAuditLogs(params: AuditQueryParams): Promise<AuditQueryResult> {
  const filter = buildAuditFilter(params);
  const sort = buildAuditSort(params);
  const limit = Math.min(200, Math.max(1, params.limit || 20));

  // Cursor pagination (deep pagination for large datasets).
  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    if (decoded) {
      const dir = sort.createdAt === 1 ? 1 : -1;
      if (dir === -1) {
        filter.$and = filter.$and || [];
        (filter.$and as Record<string, unknown>[]).push({
          $or: [
            { createdAt: { $lt: decoded.cursorAt } },
            { createdAt: decoded.cursorAt, _id: { $lt: decoded.cursorId } },
          ],
        });
      } else {
        filter.$and = filter.$and || [];
        (filter.$and as Record<string, unknown>[]).push({
          $or: [
            { createdAt: { $gt: decoded.cursorAt } },
            { createdAt: decoded.cursorAt, _id: { $gt: decoded.cursorId } },
          ],
        });
      }
    }
  }

  const page = Math.max(1, params.page || 1);
  const skip = params.cursor ? 0 : (page - 1) * limit;

  const [docs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit + 1)
      .lean()
      .exec(),
    AuditLog.countDocuments(filter).exec(),
  ]);

  const hasMore = docs.length > limit;
  const rows = docs.slice(0, limit);
  const last = rows[rows.length - 1];

  return {
    data: rows.map((d) => toReadSafe(d, params.includeStack)),
    total,
    page: params.cursor ? (skip > 0 ? Math.ceil(skip / limit) + 1 : 1) : page,
    limit,
    totalPages: Math.ceil(total / limit),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    hasMore,
  };
}

export async function getAuditById(id: string, includeStack = false): Promise<Record<string, unknown> | null> {
  const doc = await AuditLog.findById(id).lean().exec();
  if (!doc) return null;
  return toReadSafe(doc, includeStack);
}
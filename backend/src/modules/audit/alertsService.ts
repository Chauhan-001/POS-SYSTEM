/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * alertsService.ts — Audit alert feed + persisted saved searches.
 *
 * Alerts are surfaced from the AuditAlert collection (written by the write-side
 * `maybeAlert` path) and resolved here. Saved searches let operators persist
 * filter sets for one-click reuse.
 */

import { AuditAlert, AuditSavedSearch, AuditLegalHold } from './models';

export async function listAlerts(params: { page?: number; limit?: number; severity?: string; resolved?: boolean } = {}) {
  const filter: Record<string, unknown> = {};
  if (params.severity) filter.severity = params.severity;
  if (params.resolved !== undefined) filter.resolved = params.resolved;

  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const skip = (page - 1) * limit;

  const [docs, total] = await Promise.all([
    AuditAlert.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
    AuditAlert.countDocuments(filter).exec(),
  ]);

  return {
    data: docs.map((d) => ({
      id: String(d._id),
      type: d.type,
      message: d.message,
      severity: d.severity,
      category: d.category || null,
      module: d.module || null,
      restaurantId: d.restaurantId || null,
      entityType: d.entityType || null,
      entityId: d.entityId || null,
      metadata: d.metadata || null,
      resolved: d.resolved,
      resolvedBy: d.resolvedBy || null,
      resolvedAt: d.resolvedAt?.toISOString() || null,
      createdAt: d.createdAt.toISOString(),
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function alertSummary() {
  const [unresolved, openCritical, total] = await Promise.all([
    AuditAlert.countDocuments({ resolved: false }).exec(),
    AuditAlert.countDocuments({ resolved: false, severity: { $in: ['critical', 'high'] } }).exec(),
    AuditAlert.countDocuments().exec(),
  ]);
  return { unresolved, openHigh: openCritical, total };
}

export async function resolveAlert(id: string, resolvedBy?: string): Promise<boolean> {
  const res = await AuditAlert.updateOne(
    { _id: id, resolved: false },
    { $set: { resolved: true, resolvedBy: resolvedBy || 'admin', resolvedAt: new Date() } },
  ).exec();
  return res.modifiedCount > 0;
}

export async function deleteAlert(id: string): Promise<boolean> {
  const res = await AuditAlert.deleteOne({ _id: id }).exec();
  return res.deletedCount > 0;
}

// ─── Saved searches ────────────────────────────────────────────────

export async function listSavedSearches(ownerId?: string) {
  const filter: Record<string, unknown> = {};
  if (ownerId) filter.$or = [{ createdById: ownerId }, { isGlobal: true }];
  const docs = await AuditSavedSearch.find(filter).sort({ createdAt: -1 }).limit(100).lean().exec();
  return docs.map((d) => ({
    id: String(d._id),
    name: d.name,
    filters: d.filters || {},
    isGlobal: d.isGlobal,
    createdBy: d.createdBy,
    createdById: d.createdById || null,
    createdAt: d.createdAt.toISOString(),
  }));
}

export async function saveSearch(input: { name: string; filters?: Record<string, unknown>; isGlobal?: boolean; createdBy: string; createdById?: string }) {
  const doc = await AuditSavedSearch.create({
    name: input.name,
    filters: input.filters || {},
    isGlobal: input.isGlobal || false,
    createdBy: input.createdBy,
    createdById: input.createdById,
  });
  return String(doc._id);
}

export async function deleteSavedSearch(id: string): Promise<boolean> {
  const res = await AuditSavedSearch.deleteOne({ _id: id }).exec();
  return res.deletedCount > 0;
}

// ─── Legal holds ───────────────────────────────────────────────────

export async function listLegalHolds(params: { active?: boolean } = {}) {
  const filter: Record<string, unknown> = {};
  if (params.active !== undefined) filter.active = params.active;
  const docs = await AuditLegalHold.find(filter).sort({ createdAt: -1 }).limit(200).lean().exec();
  return docs.map((d) => ({
    id: String(d._id),
    module: d.module || null,
    entityType: d.entityType || null,
    entityId: d.entityId || null,
    caseRef: d.caseRef,
    reason: d.reason,
    createdBy: d.createdBy,
    createdById: d.createdById || null,
    expiresAt: d.expiresAt?.toISOString() || null,
    active: d.active,
    createdAt: d.createdAt.toISOString(),
  }));
}

export async function createLegalHold(input: {
  module?: string;
  entityType?: string;
  entityId?: string;
  caseRef: string;
  reason: string;
  expiresAt?: string;
  createdBy: string;
}): Promise<string> {
  const doc = await AuditLegalHold.create({
    module: input.module,
    entityType: input.entityType,
    entityId: input.entityId,
    caseRef: input.caseRef,
    reason: input.reason,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    createdBy: input.createdBy,
    active: true,
  });
  return String(doc._id);
}

export async function releaseLegalHold(id: string): Promise<boolean> {
  const res = await AuditLegalHold.updateOne({ _id: id, active: true }, { $set: { active: false } }).exec();
  return res.modifiedCount > 0;
}
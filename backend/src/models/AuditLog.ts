/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuditLog Model — Enterprise immutable audit trail.
 * Backward compatible superset of the legacy AuditLog (all prior fields kept).
 * Adds enterprise context (module/category/severity/actor/device/session/request/
 * correlation), hash-chaining for tamper detection, and bounded-growth indexes.
 *
 * Append-only by contract — there are NO update/delete paths exposed anywhere.
 * See modules/audit/auditService.ts for the only writer.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AuditResult = 'success' | 'failure' | 'pending';

export const AUDIT_SEVERITIES: AuditSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
export const AUDIT_RESULTS: AuditResult[] = ['success', 'failure', 'pending'];

export interface IAuditLog extends Document {
  action: string;
  category?: string;
  module?: string;
  severity?: AuditSeverity;
  result?: AuditResult;
  success?: boolean;
  status?: 'success' | 'failure';
  entityType: string;
  entityId?: string;
  entityLabel?: string;
  performedBy: string;
  performedById?: string;
  role?: string;
  restaurantId?: mongoose.Types.ObjectId;
  restaurantName?: string;
  branchId?: mongoose.Types.ObjectId;
  branchName?: string;
  ipAddress?: string;
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
  browser?: string;
  platform?: string;
  os?: string;
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
  metadata?: Record<string, unknown>;
  details?: Record<string, unknown>;
  chainIndex?: number;
  prevHash?: string;
  hash?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true, trim: true, index: true },
    category: { type: String, trim: true, index: true },
    module: { type: String, trim: true, index: true },
    severity: { type: String, enum: AUDIT_SEVERITIES, default: 'info', index: true },
    result: { type: String, enum: AUDIT_RESULTS, index: true },
    success: { type: Boolean },
    status: { type: String, enum: ['success', 'failure'] },
    entityType: { type: String, required: true, trim: true, index: true },
    entityId: { type: String, trim: true },
    entityLabel: { type: String, trim: true },
    performedBy: { type: String, required: true, trim: true },
    performedById: { type: String, trim: true, index: true },
    role: { type: String, trim: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    restaurantName: { type: String, trim: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    branchName: { type: String, trim: true },
    ipAddress: { type: String, trim: true },
    deviceId: { type: String, trim: true },
    deviceName: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    browser: { type: String, trim: true },
    platform: { type: String, trim: true },
    os: { type: String, trim: true },
    sessionId: { type: String, trim: true },
    requestId: { type: String, trim: true, index: true },
    correlationId: { type: String, trim: true, index: true },
    route: { type: String, trim: true },
    method: { type: String, trim: true },
    responseStatus: { type: Number },
    durationMs: { type: Number },
    executionTimeMs: { type: Number },
    error: { type: String, trim: true },
    stackTrace: { type: String, trim: true },
    oldValues: { type: Schema.Types.Mixed },
    newValues: { type: Schema.Types.Mixed },
    changedFields: [{ type: String, trim: true }],
    reason: { type: String, trim: true },
    comments: { type: String, trim: true },
    location: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
    details: { type: Schema.Types.Mixed },
    chainIndex: { type: Number, unique: true, sparse: true },
    prevHash: { type: String, trim: true },
    hash: { type: String, trim: true, unique: true, sparse: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

// ─── Backward-compatible legacy indexes ───────────────────────────
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ performedById: 1, createdAt: -1 });
AuditLogSchema.index({ restaurantId: 1, entityType: 1, createdAt: -1 });

// ─── Enterprise query indexes ─────────────────────────────────────
AuditLogSchema.index({ module: 1, createdAt: -1 });
AuditLogSchema.index({ category: 1, createdAt: -1 });
AuditLogSchema.index({ severity: 1, createdAt: -1 });
AuditLogSchema.index({ result: 1, createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ sessionId: 1, createdAt: -1 });
AuditLogSchema.index({ correlationId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, category: 1, severity: 1, createdAt: -1 });
AuditLogSchema.index({ performedBy: 1, createdAt: -1 });
AuditLogSchema.index({ deviceId: 1, createdAt: -1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
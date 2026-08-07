/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * models.ts — Supporting collections for the enterprise audit subsystem:
 *  - AuditChainMeta  : single-doc hash-chain head (lastHash, seq)
 *  - AuditLogArchive : cold-storage copy of retired audit rows
 *  - AuditExportJob  : background export queue
 *  - AuditAlert      : notification/incident feed
 *  - AuditLegalHold  : compliance hold that exempts rows from retention
 *  - AuditSavedSearch: persisted filter sets for the UI
 */

import mongoose, { Schema, Document } from 'mongoose';

export const AUDIT_META_ID = 'audit-chain';

// ─── Hash chain head ───────────────────────────────────────────────
export interface IAuditChainMeta extends Document {
  lastHash: string;
  seq: number;
  updatedAt: Date;
}

const AuditChainMetaSchema = new Schema<IAuditChainMeta>(
  {
    _id: { type: String, default: AUDIT_META_ID } as any,
    lastHash: { type: String, required: true, default: 'genesis' },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true }, versionKey: false }
);

export const AuditChainMeta =
  mongoose.models.AuditChainMeta ||
  mongoose.model<IAuditChainMeta>('AuditChainMeta', AuditChainMetaSchema);

// ─── Archive (cold storage) ────────────────────────────────────────
export interface IAuditLogArchive extends Document {
  action: string;
  category?: string;
  module?: string;
  severity?: string;
  result?: string;
  entityType: string;
  entityId?: string;
  performedBy: string;
  performedById?: string;
  role?: string;
  restaurantId?: mongoose.Types.ObjectId;
  restaurantName?: string;
  branchId?: mongoose.Types.ObjectId;
  branchName?: string;
  ipAddress?: string;
  deviceId?: string;
  sessionId?: string;
  requestId?: string;
  correlationId?: string;
  route?: string;
  method?: string;
  error?: string;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changedFields?: string[];
  chainIndex?: number;
  prevHash?: string;
  hash?: string;
  archivedAt: Date;
  originalCreatedAt: Date;
  createdAt: Date;
}

const AuditLogArchiveSchema = new Schema<IAuditLogArchive>(
  {
    action: { type: String, required: true, trim: true, index: true },
    category: { type: String, trim: true },
    module: { type: String, trim: true, index: true },
    severity: { type: String, trim: true },
    result: { type: String, trim: true },
    entityType: { type: String, required: true, trim: true },
    entityId: { type: String, trim: true },
    performedBy: { type: String, required: true, trim: true },
    performedById: { type: String, trim: true },
    role: { type: String, trim: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null },
    restaurantName: { type: String, trim: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    branchName: { type: String, trim: true },
    ipAddress: { type: String, trim: true },
    deviceId: { type: String, trim: true },
    sessionId: { type: String, trim: true },
    requestId: { type: String, trim: true },
    correlationId: { type: String, trim: true },
    route: { type: String, trim: true },
    method: { type: String, trim: true },
    error: { type: String, trim: true },
    details: { type: Schema.Types.Mixed },
    metadata: { type: Schema.Types.Mixed },
    oldValues: { type: Schema.Types.Mixed },
    newValues: { type: Schema.Types.Mixed },
    changedFields: [{ type: String, trim: true }],
    chainIndex: { type: Number },
    prevHash: { type: String, trim: true },
    hash: { type: String, trim: true },
    archivedAt: { type: Date, required: true, default: () => new Date(), index: true },
    originalCreatedAt: { type: Date, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

AuditLogArchiveSchema.index({ module: 1, originalCreatedAt: -1 });
AuditLogArchiveSchema.index({ restaurantId: 1, originalCreatedAt: -1 });
AuditLogArchiveSchema.index({ action: 1, originalCreatedAt: -1 });
AuditLogArchiveSchema.index({ originalCreatedAt: -1 });

export const AuditLogArchive =
  mongoose.models.AuditLogArchive ||
  mongoose.model<IAuditLogArchive>('AuditLogArchive', AuditLogArchiveSchema);

// ─── Export jobs ───────────────────────────────────────────────────
export type AuditExportStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type AuditExportFormat = 'csv' | 'json' | 'xlsx' | 'pdf';

export interface IAuditExportJob extends Document {
  format: AuditExportFormat;
  status: AuditExportStatus;
  filters: Record<string, unknown>;
  requestedBy: string;
  requestedById?: string;
  restaurantId?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  outputPath?: string;
  fileName?: string;
  rowCount: number;
  fileSizeBytes?: number;
  signedHash?: string;
  encrypted?: boolean;
  error?: string;
  expiresAt?: Date;
}

const AuditExportJobSchema = new Schema<IAuditExportJob>(
  {
    format: { type: String, enum: ['csv', 'json', 'xlsx', 'pdf'], required: true, index: true },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    filters: { type: Schema.Types.Mixed, default: {} },
    requestedBy: { type: String, required: true, trim: true },
    requestedById: { type: String, trim: true, index: true },
    restaurantId: { type: String, trim: true, index: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
    outputPath: { type: String, trim: true },
    fileName: { type: String, trim: true },
    rowCount: { type: Number, default: 0 },
    fileSizeBytes: { type: Number },
    signedHash: { type: String, trim: true },
    encrypted: { type: Boolean, default: false },
    error: { type: String, trim: true },
    expiresAt: { type: Date, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditExportJobSchema.index({ createdAt: -1 });

export const AuditExportJob =
  mongoose.models.AuditExportJob ||
  mongoose.model<IAuditExportJob>('AuditExportJob', AuditExportJobSchema);

// ─── Alerts / notifications ────────────────────────────────────────
export type AuditAlertSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface IAuditAlert extends Document {
  type: string;
  message: string;
  severity: AuditAlertSeverity;
  category: string;
  module: string;
  restaurantId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

const AuditAlertSchema = new Schema<IAuditAlert>(
  {
    type: { type: String, required: true, trim: true, index: true },
    message: { type: String, required: true, trim: true },
    severity: { type: String, enum: ['critical', 'high', 'medium', 'low'], default: 'high', index: true },
    category: { type: String, trim: true },
    module: { type: String, trim: true },
    restaurantId: { type: String, trim: true, index: true },
    entityType: { type: String, trim: true },
    entityId: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    resolved: { type: Boolean, default: false, index: true },
    resolvedBy: { type: String, trim: true },
    resolvedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditAlertSchema.index({ severity: 1, resolved: 1, createdAt: -1 });

export const AuditAlert =
  mongoose.models.AuditAlert || mongoose.model<IAuditAlert>('AuditAlert', AuditAlertSchema);

// ─── Legal holds ───────────────────────────────────────────────────
export interface IAuditLegalHold extends Document {
  module?: string;
  entityType?: string;
  entityId?: string;
  caseRef: string;
  reason: string;
  createdBy: string;
  createdById?: string;
  expiresAt?: Date;
  active: boolean;
  createdAt: Date;
}

const AuditLegalHoldSchema = new Schema<IAuditLegalHold>(
  {
    module: { type: String, trim: true },
    entityType: { type: String, trim: true },
    entityId: { type: String, trim: true },
    caseRef: { type: String, required: true, trim: true },
    reason: { type: String, required: true, trim: true },
    createdBy: { type: String, required: true, trim: true },
    createdById: { type: String, trim: true },
    expiresAt: { type: Date },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLegalHoldSchema.index({ module: 1, active: 1 });
AuditLegalHoldSchema.index({ entityType: 1, entityId: 1, active: 1 });

export const AuditLegalHold =
  mongoose.models.AuditLegalHold ||
  mongoose.model<IAuditLegalHold>('AuditLegalHold', AuditLegalHoldSchema);

// ─── Saved searches ────────────────────────────────────────────────
export interface IAuditSavedSearch extends Document {
  name: string;
  filters: Record<string, unknown>;
  createdBy: string;
  createdById?: string;
  isGlobal: boolean;
  createdAt: Date;
}

const AuditSavedSearchSchema = new Schema<IAuditSavedSearch>(
  {
    name: { type: String, required: true, trim: true },
    filters: { type: Schema.Types.Mixed, default: {} },
    createdBy: { type: String, required: true, trim: true },
    createdById: { type: String, trim: true },
    isGlobal: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditSavedSearchSchema.index({ createdById: 1, isGlobal: 1 });

export const AuditSavedSearch =
  mongoose.models.AuditSavedSearch ||
  mongoose.model<IAuditSavedSearch>('AuditSavedSearch', AuditSavedSearchSchema);
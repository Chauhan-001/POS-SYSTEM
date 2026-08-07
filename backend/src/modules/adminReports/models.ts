/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * models.ts — Supporting collections for the platform-wide Admin Reports
 * subsystem (Phase 2.10):
 *
 *   - RevenueEvent          : append-only monetisation ledger (subscription/ai/addon/refund)
 *   - Refund                : refund requests applied against payments
 *   - SubscriptionHistory   : immutable subscription life-cycle events
 *   - AIBillingRecord       : per-request AI monetisation (cost vs customerCharge)
 *   - PlatformEvent         : lightweight usage/activity event stream
 *   - InactiveRestaurantSnapshot : daily snapshot of inactive restaurants
 *   - ReportSnapshot        : nightly snapshot bucket for trend/forecast reports
 *   - ReportExportJob       : background export queue (mirrors audit export job)
 *
 * Every collection follows the `mongoose.models.X || mongoose.model(...)` guard
 * so it may be re-imported safely during tests and hot reloads.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ─── RevenueEvent ────────────────────────────────────────────────────────────
export type RevenueEventType = 'subscription' | 'ai' | 'addon' | 'refund';
export type RevenueEventSource = 'recurring' | 'one-time' | 'refund' | 'adjustment';
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly' | 'one-time';

export interface IRevenueEvent extends Document {
  type: RevenueEventType;
  source: RevenueEventSource;
  amount: number;
  currency: string;
  restaurantId?: mongoose.Types.ObjectId;
  restaurantName?: string;
  ownerId?: mongoose.Types.ObjectId;
  ownerName?: string;
  subscriptionId?: mongoose.Types.ObjectId;
  paymentId?: string;
  planId?: string;
  planName?: string;
  billingCycle?: BillingCycle;
  description?: string;
  meta?: Record<string, unknown>;
  occurredAt: Date;
  createdAt: Date;
}

const RevenueEventSchema = new Schema<IRevenueEvent>(
  {
    type: { type: String, enum: ['subscription', 'ai', 'addon', 'refund'], required: true, index: true },
    source: { type: String, enum: ['recurring', 'one-time', 'refund', 'adjustment'], default: 'one-time' },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', index: true },
    restaurantName: { type: String, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    ownerName: { type: String, trim: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', index: true },
    paymentId: { type: String, trim: true },
    planId: { type: String, trim: true },
    planName: { type: String, trim: true },
    billingCycle: { type: String, enum: ['monthly', 'quarterly', 'yearly', 'one-time'] },
    description: { type: String, trim: true },
    meta: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

RevenueEventSchema.index({ occurredAt: -1, type: 1 });

export const RevenueEvent =
  mongoose.models.RevenueEvent || mongoose.model<IRevenueEvent>('RevenueEvent', RevenueEventSchema);

// ─── Refund ─────────────────────────────────────────────────────────────────
export type RefundStatus = 'pending' | 'approved' | 'rejected' | 'processed';
export type RefundMethod = 'razorpay' | 'bank_transfer' | 'manual' | 'wallet' | 'offline';

export interface IRefund extends Document {
  refundId: string;
  amount: number;
  currency: string;
  reason: string;
  status: RefundStatus;
  method: RefundMethod;
  paymentId?: string;
  invoiceId?: string;
  restaurantId?: mongoose.Types.ObjectId;
  ownerId?: mongoose.Types.ObjectId;
  requestedBy?: string;
  reviewedBy?: string;
  reviewNote?: string;
  processedAt?: Date;
  createdAt: Date;
}

const RefundSchema = new Schema<IRefund>(
  {
    refundId: { type: String, required: true, unique: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'processed'], default: 'pending', index: true },
    method: { type: String, enum: ['razorpay', 'bank_transfer', 'manual', 'wallet', 'offline'], default: 'manual' },
    paymentId: { type: String, trim: true, index: true },
    invoiceId: { type: String, trim: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    requestedBy: { type: String, trim: true },
    reviewedBy: { type: String, trim: true },
    reviewNote: { type: String, trim: true },
    processedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: true }, versionKey: false },
);

export const Refund =
  mongoose.models.Refund || mongoose.model<IRefund>('Refund', RefundSchema);

// ─── SubscriptionHistory ────────────────────────────────────────────────────
export type SubscriptionHistoryAction = 'created' | 'renewed' | 'upgraded' | 'downgraded' | 'cancelled' | 'paused' | 'resumed' | 'expired' | 'grace' | 'suspended' | 'defrauded' | 'plan_changed';
export type SubscriptionHistoryReason = 'manual' | 'payment' | 'expiry' | 'admin_action' | 'trial' | 'webhook' | 'system';

export interface ISubscriptionHistory extends Document {
  restaurantId: mongoose.Types.ObjectId;
  subscriptionId?: mongoose.Types.ObjectId;
  action: SubscriptionHistoryAction;
  fromStatus?: string;
  toStatus?: string;
  fromPlanId?: string;
  toPlanId?: string;
  fromPlanName?: string;
  toPlanName?: string;
  amount?: number;
  currency?: string;
  reason: SubscriptionHistoryReason;
  performedBy?: string;
  performedById?: string;
  details?: Record<string, unknown>;
  occurredAt: Date;
}

const SubscriptionHistorySchema = new Schema<ISubscriptionHistory>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', index: true },
    action: {
      type: String,
      enum: ['created', 'renewed', 'upgraded', 'downgraded', 'cancelled', 'paused', 'resumed', 'expired', 'grace', 'suspended', 'defrauded', 'plan_changed'],
      required: true,
      index: true,
    },
    fromStatus: { type: String, trim: true },
    toStatus: { type: String, trim: true },
    fromPlanId: { type: String, trim: true },
    toPlanId: { type: String, trim: true },
    fromPlanName: { type: String, trim: true },
    toPlanName: { type: String, trim: true },
    amount: { type: Number },
    currency: { type: String, default: 'INR' },
    reason: { type: String, enum: ['manual', 'payment', 'expiry', 'admin_action', 'trial', 'webhook', 'system'], default: 'manual' },
    performedBy: { type: String, trim: true },
    performedById: { type: String, trim: true },
    details: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

SubscriptionHistorySchema.index({ happenedAt: 1 });

export const SubscriptionHistory =
  mongoose.models.SubscriptionHistory ||
  mongoose.model<ISubscriptionHistory>('SubscriptionHistory', SubscriptionHistorySchema);

// ─── AIBillingRecord ────────────────────────────────────────────────────────
export interface IAIBillingRecord extends Document {
  aiUsageLogId?: mongoose.Types.ObjectId;
  restaurantId?: mongoose.Types.ObjectId;
  ownerId?: mongoose.Types.ObjectId;
  feature: string;
  aiModel?: string;
  usageCost: number;
  customerCharge: number;
  profit: number;
  currency?: string;
  billingMode?: string;
  createdAt: Date;
}

const AIBillingRecordSchema = new Schema<IAIBillingRecord>(
  {
    aiUsageLogId: { type: Schema.Types.ObjectId, ref: 'AIUsageLog', index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    feature: { type: String, required: true, index: true },
    aiModel: { type: String, trim: true },
    usageCost: { type: Number, required: true, min: 0, default: 0 },
    customerCharge: { type: Number, required: true, min: 0, default: 0 },
    profit: { type: Number, required: true, default: 0 },
    currency: { type: String, default: 'INR' },
    billingMode: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const AIBillingRecord =
  mongoose.models.AIBillingRecord ||
  mongoose.model<IAIBillingRecord>('AIBillingRecord', AIBillingRecordSchema);

// ─── PlatformEvent ──────────────────────────────────────────────────────────
export type PlatformEventCategory = 'auth' | 'api' | 'feature' | 'device' | 'subscription' | 'pos' | 'report' | 'support' | 'mobile' | 'system';
export type PlatformEventOutcome = 'success' | 'failure' | 'blocked';

export interface IPlatformEvent extends Document {
  category: PlatformEventCategory;
  event: string;
  restaurantId?: mongoose.Types.ObjectId;
  ownerId?: mongoose.Types.ObjectId;
  userId?: string;
  deviceId?: string;
  platform?: string;
  appVersion?: string;
  ipAddress?: string;
  outcome: PlatformEventOutcome;
  durationMs?: number;
  meta?: Record<string, unknown>;
  occurredAt: Date;
}

const PlatformEventSchema = new Schema<IPlatformEvent>(
  {
    category: { type: String, enum: ['auth', 'api', 'feature', 'device', 'subscription', 'pos', 'report', 'support', 'mobile', 'system'], required: true, index: true },
    event: { type: String, required: true, trim: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userId: { type: String, trim: true, index: true },
    deviceId: { type: String, trim: true, index: true },
    platform: { type: String, trim: true },
    appVersion: { type: String, trim: true },
    ipAddress: { type: String, trim: true },
    outcome: { type: String, enum: ['success', 'failure', 'blocked'], default: 'success' },
    durationMs: { type: Number },
    meta: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

PlatformEventSchema.index({ category: 1, occurredAt: -1 });

export const PlatformEvent =
  mongoose.models.PlatformEvent || mongoose.model<IPlatformEvent>('PlatformEvent', PlatformEventSchema);

// ─── InactiveRestaurantSnapshot ─────────────────────────────────────────────
export interface IInactiveRestaurantSnapshot extends Document {
  snapshotDate: Date;
  totalInactive: number;
  newInactive: number;
  reactivated: number;
  longestInactiveDays: number;
  avgInactiveDays: number;
  entries: Array<{
    restaurantId: mongoose.Types.ObjectId;
    restaurantName: string;
    ownerId?: mongoose.Types.ObjectId;
    ownerName?: string;
    inactiveSince: Date;
    lastActivityAt?: Date;
    inactiveDays: number;
    hasSubscription: boolean;
    planName?: string;
    aiEnabled: boolean;
    loyaltyEnabled: boolean;
  }>;
  createdAt: Date;
}

const InactiveRestaurantSnapshotSchema = new Schema<IInactiveRestaurantSnapshot>(
  {
    snapshotDate: { type: Date, required: true, unique: true, index: true },
    totalInactive: { type: Number, default: 0 },
    newInactive: { type: Number, default: 0 },
    reactivated: { type: Number, default: 0 },
    longestInactiveDays: { type: Number, default: 0 },
    avgInactiveDays: { type: Number, default: 0 },
    entries: {
      type: [
        new Schema({
          restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
          restaurantName: { type: String, trim: true },
          ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
          ownerName: { type: String, trim: true },
          inactiveSince: { type: Date },
          lastActivityAt: { type: Date },
          inactiveDays: { type: Number, default: 0 },
          hasSubscription: { type: Boolean, default: false },
          planName: { type: String },
          aiEnabled: { type: Boolean, default: false },
          loyaltyEnabled: { type: Boolean, default: false },
        }),
      ],
      default: [],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const InactiveRestaurantSnapshot =
  mongoose.models.InactiveRestaurantSnapshot ||
  mongoose.model<IInactiveRestaurantSnapshot>('InactiveRestaurantSnapshot', InactiveRestaurantSnapshotSchema);

// ─── ReportSnapshot ─────────────────────────────────────────────────────────
export type ReportSnapshotKind = 'growth' | 'revenue' | 'usage' | 'feature' | 'subscription' | 'ai_revenue';

export interface IReportSnapshot extends Document {
  kind: ReportSnapshotKind;
  snapshotDate: Date;
  period: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

const ReportSnapshotSchema = new Schema<IReportSnapshot>(
  {
    kind: { type: String, enum: ['growth', 'revenue', 'usage', 'feature', 'subscription', 'ai_revenue'], required: true, index: true },
    snapshotDate: { type: Date, required: true, index: true },
    period: { type: String, trim: true, index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

ReportSnapshotSchema.index({ kind: 1, snapshotDate: -1 });

export const ReportSnapshot =
  mongoose.models.ReportSnapshot || mongoose.model<IReportSnapshot>('ReportSnapshot', ReportSnapshotSchema);

// ─── ReportExportJob ────────────────────────────────────────────────────────
export type ReportExportStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ReportExportFormat = 'csv' | 'json' | 'xlsx' | 'pdf';

export interface IReportExportJob extends Document {
  reportKey: string;
  format: ReportExportFormat;
  status: ReportExportStatus;
  query: Record<string, unknown>;
  fileName?: string;
  storagePath?: string;
  recordCount?: number;
  bytes?: number;
  checksum?: string;
  encrypted?: boolean;
  signed?: boolean;
  generatedBy?: string;
  generatedById?: string;
  error?: string;
  completedAt?: Date;
  startedAt?: Date;
  createdAt: Date;
}

const ReportExportJobSchema = new Schema<IReportExportJob>(
  {
    reportKey: { type: String, required: true, trim: true, index: true },
    format: { type: String, enum: ['csv', 'json', 'xlsx', 'pdf'], required: true },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending', index: true },
    query: { type: Schema.Types.Mixed, default: {} },
    fileName: { type: String, trim: true },
    storagePath: { type: String, trim: true },
    recordCount: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    checksum: { type: String, trim: true },
    encrypted: { type: Boolean, default: false },
    signed: { type: Boolean, default: false },
    generatedBy: { type: String, trim: true },
    generatedById: { type: String, trim: true },
    error: { type: String, trim: true },
    completedAt: { type: Date },
    startedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: true }, versionKey: false },
);

export const ReportExportJob =
  mongoose.models.ReportExportJob || mongoose.model<IReportExportJob>('ReportExportJob', ReportExportJobSchema);
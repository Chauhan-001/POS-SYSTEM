/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VoiceAuditLog Model — Dedicated audit trail for voice inventory actions.
 * Append-only. Logs are never modified or deleted.
 *
 * Records:
 *   - Who performed the action (employeeId + name)
 *   - What action was taken (intent + parsed JSON)
 *   - Original transcript
 *   - Confidence score
 *   - Whether it was confirmed or rejected
 *   - Source: 'voice' | 'manual' | 'ai_suggested'
 *   - Restaurant + timestamp
 *
 * This log is queryable for:
 *   - Voice usage analytics
 *   - Accuracy tracking (compare intent vs confirmed action)
 *   - Security audits
 *   - Training data collection (with consent)
 */

import mongoose, { Schema, Document } from 'mongoose';

export type VoiceIntent =
  | 'inventory_add'
  | 'inventory_remove'
  | 'inventory_adjust'
  | 'inventory_waste'
  | 'purchase_reminder'
  | 'supplier_update'
  | 'unknown';

export type VoiceSource = 'voice' | 'manual' | 'ai_suggested';
export type VoiceConfirmation = 'pending' | 'confirmed' | 'rejected' | 'clarified';

export interface IVoiceAuditLog extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  employeeId?: string;
  employeeName: string;
  intent: VoiceIntent;
  transcript: string;
  parsedJson?: Record<string, unknown>;
  confidence: number;
  source: VoiceSource;
  confirmationStatus: VoiceConfirmation;
  items?: Array<{
    name: string;
    quantity: number;
    unit?: string;
    canonicalName?: string;
  }>;
  /** Enhanced: which pipeline stage produced the final match */
  matchingMethod?: string;
  /** Enhanced: all candidates considered during pipeline resolution */
  pipelineCandidates?: Array<{
    productId: string;
    productName: string;
    stage: string;
    confidence: number;
  }>;
  error?: string;
  latencyMs: number;
  ipAddress?: string;
  createdAt: Date;
}

const VoiceAuditLogSchema = new Schema<IVoiceAuditLog>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    employeeId: {
      type: String,
      trim: true,
      default: null,
    },
    employeeName: {
      type: String,
      required: true,
      trim: true,
      default: 'Unknown',
    },
    intent: {
      type: String,
      required: true,
      enum: [
        'inventory_add',
        'inventory_remove',
        'inventory_adjust',
        'inventory_waste',
        'purchase_reminder',
        'supplier_update',
        'unknown',
      ],
      index: true,
    },
    transcript: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    parsedJson: {
      type: Schema.Types.Mixed,
      default: null,
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0,
    },
    source: {
      type: String,
      required: true,
      enum: ['voice', 'manual', 'ai_suggested'],
      default: 'voice',
    },
    confirmationStatus: {
      type: String,
      required: true,
      enum: ['pending', 'confirmed', 'rejected', 'clarified'],
      default: 'pending',
    },
    items: [
      {
        name: { type: String, required: true },
        quantity: { type: Number, required: true, min: 0 },
        unit: { type: String, trim: true },
        canonicalName: { type: String, trim: true },
      },
    ],
    /** Enhanced: pipeline stage that produced the match */
    matchingMethod: {
      type: String,
      trim: true,
      default: null,
    },
    /** Enhanced: all candidates considered during pipeline resolution */
    pipelineCandidates: [
      {
        productId: { type: String, trim: true },
        productName: { type: String, trim: true },
        stage: { type: String, trim: true },
        confidence: { type: Number, min: 0, max: 1 },
      },
    ],
    error: {
      type: String,
      trim: true,
      default: null,
    },
    latencyMs: {
      type: Number,
      default: 0,
    },
    ipAddress: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Compound indexes for efficient querying
VoiceAuditLogSchema.index({ restaurantId: 1, createdAt: -1 });
VoiceAuditLogSchema.index({ restaurantId: 1, intent: 1, createdAt: -1 });
VoiceAuditLogSchema.index({ employeeId: 1, createdAt: -1 });
VoiceAuditLogSchema.index({ confirmationStatus: 1, createdAt: -1 });
VoiceAuditLogSchema.index({ matchingMethod: 1 });
// For accuracy analytics
VoiceAuditLogSchema.index({
  restaurantId: 1,
  source: 1,
  confirmationStatus: 1,
  createdAt: -1,
});

export default mongoose.model<IVoiceAuditLog>(
  'VoiceAuditLog',
  VoiceAuditLogSchema
);

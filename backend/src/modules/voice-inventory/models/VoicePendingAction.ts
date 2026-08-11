/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VoicePendingAction — Server-side pending inventory action awaiting confirmation.
 *
 * SECURITY MODEL (mandatory backend-side confirmation):
 *   - EVERY voice action that would mutate inventory first creates a pending
 *     action bound to (restaurantId, employeeId, items).
 *   - The frontend receives `pendingActionId` + a random `confirmationToken`.
 *   - The /confirm endpoint REQUIRES both values. The token is stored as a
 *     SHA-256 hash (never plaintext), is single-use (atomic status flip), and
 *     expires after `ttlMs` (default 5 minutes).
 *   - Only an authenticated user of the SAME restaurant can confirm.
 *   - Confirm/cancel are idempotent at the storage level: after the first
 *     successful flip, further attempts return 410 Gone.
 *
 * SECURITY: no raw audio, transcripts beyond a preview, or secrets are stored.
 */

import crypto from 'crypto';
import mongoose, { Schema, Document } from 'mongoose';

export type PendingActionStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';

export interface PendingActionItem {
  name: string;
  quantity: number;
  unit: string;
  productId?: string;
  /** Spoken purchase rate (₹/unit) carried through to confirmation. */
  rate?: number;
}

export interface IVoicePendingAction extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  employeeId: string;
  employeeName: string;
  auditLogId: mongoose.Types.ObjectId;
  intent: string;
  items: PendingActionItem[];
  /** Transcript preview (≤ 300 chars) for context in the confirm UI. */
  transcriptPreview: string;
  /** SHA-256 hash of the confirmation token. Never the raw token. */
  tokenHash: string;
  status: PendingActionStatus;
  /** TTL from creation (ms). Default 5 minutes. */
  ttlMs: number;
  createdAt: Date;
  expiresAt: Date;
  consumedAt?: Date;
}

const VoicePendingActionSchema = new Schema<IVoicePendingAction>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    employeeId: { type: String, required: true, trim: true, index: true },
    employeeName: { type: String, required: true, trim: true, default: 'Unknown' },
    auditLogId: { type: Schema.Types.ObjectId, ref: 'VoiceAuditLog', required: true },
    intent: { type: String, required: true },
    items: [
      {
        _id: false,
        name: { type: String, required: true, trim: true },
        quantity: { type: Number, required: true, min: 0 },
        unit: { type: String, default: 'pcs', trim: true },
        productId: { type: String, trim: true },
        rate: { type: Number, min: 0, default: null },
      },
    ],
    transcriptPreview: { type: String, trim: true, maxlength: 300, default: '' },
    tokenHash: { type: String, required: true, trim: true },
    status: { type: String, enum: ['pending', 'confirmed', 'rejected', 'expired'], default: 'pending', index: true },
    ttlMs: { type: Number, default: 5 * 60 * 1000 },
    expiresAt: { type: Date, required: true, index: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

VoicePendingActionSchema.index({ restaurantId: 1, status: 1, expiresAt: 1 });
VoicePendingActionSchema.index({ auditLogId: 1 });

// ─── Token helpers ────────────────────────────────────────────────

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateConfirmationToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export default mongoose.model<IVoicePendingAction>(
  'VoicePendingAction',
  VoicePendingActionSchema
);
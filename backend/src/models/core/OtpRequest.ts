/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OtpRequest Model — Server-generated one-time passwords (Phase 1.6).
 * Replaces the fake client-side OTP. Codes are hashed (sha256), expire after
 * OTP_TTL_MS, allow a bounded number of attempts, and are rate-limited per
 * phone+purpose (max requests per rolling hour). Large reward redemption
 * requires a verified OTP before points are deducted.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type OtpPurpose = 'reward_redemption' | 'referral' | 'login' | 'general';

export interface IOtpRequest extends Document {
  restaurantId: mongoose.Types.ObjectId;
  phone: string;
  purpose: OtpPurpose;
  /** sha256 hex of the plaintext code — never store plaintext */
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  consumed: boolean;
  createdAt: Date;
}

const OtpRequestSchema = new Schema<IOtpRequest>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    phone: { type: String, required: true, trim: true },
    purpose: { type: String, enum: ['reward_redemption', 'referral', 'login', 'general'], default: 'general' },
    codeHash: { type: String, required: true, trim: true },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 5, min: 1 },
    expiresAt: { type: Date, required: true, index: true },
    consumed: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

OtpRequestSchema.index({ restaurantId: 1, phone: 1, purpose: 1, createdAt: -1 });

export default mongoose.model<IOtpRequest>('OtpRequest', OtpRequestSchema);

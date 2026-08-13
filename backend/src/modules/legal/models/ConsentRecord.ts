/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ConsentRecord — separate, independently-managed privacy/communications
 * consent, distinct from contractual acceptance (LegalAcceptance).
 *
 * Consent types are OPTIONAL by default and never pre-checked:
 *  - marketing_consent   — promotional offers/messages
 *  - communications_consent — service/order communications
 *
 * Withdrawal is recorded (withdrawnAt) rather than deleting the record, so the
 * consent trail remains auditable. No unnecessary PII is stored here — the
 * record only references the user.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type ConsentType = 'marketing_consent' | 'communications_consent';

export const CONSENT_TYPES: ConsentType[] = ['marketing_consent', 'communications_consent'];

export interface IConsentRecord extends Document {
  userId: string;
  restaurantId?: mongoose.Types.ObjectId;
  consentType: ConsentType;
  granted: boolean;
  grantedAt: Date | null;
  withdrawnAt: Date | null;
  context: string;
  platform: string;
  createdAt: Date;
  updatedAt: Date;
}

const ConsentRecordSchema = new Schema<IConsentRecord>(
  {
    userId: { type: String, required: true, trim: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    consentType: { type: String, required: true, enum: CONSENT_TYPES, index: true },
    granted: { type: Boolean, required: true, default: false },
    grantedAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
    context: { type: String, required: true, default: 'settings', trim: true },
    platform: { type: String, required: true, default: 'pos', trim: true },
  },
  { timestamps: true }
);

// One live consent row per (user, restaurant, type) — updated in place, with
// grantedAt/withdrawnAt preserving the timeline.
ConsentRecordSchema.index({ userId: 1, restaurantId: 1, consentType: 1 }, { unique: true });

export default mongoose.model<IConsentRecord>('ConsentRecord', ConsentRecordSchema);

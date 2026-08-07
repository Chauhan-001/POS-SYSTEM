/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Referral Model — Referral program tracking (Phase 1.6).
 * Records every referral: referrer (by code), referee (by phone/name),
 * reward entitlements and fulfilment status. Fraud detection rules:
 *  - A phone cannot refer itself.
 *  - A referee can only be claimed by ONE referrer (unique restaurantId+refereePhone).
 *  - Referrer must exist and own the code (server resolves the code → referrer).
 */

import mongoose, { Schema, Document } from 'mongoose';

export type ReferralStatus = 'pending' | 'completed' | 'rewarded' | 'voided';

export interface IReferral extends Document {
  restaurantId: mongoose.Types.ObjectId;
  code: string;
  referrerCustomerId?: mongoose.Types.ObjectId;
  referrerPhone: string;
  refereeCustomerId?: mongoose.Types.ObjectId;
  refereePhone: string;
  refereeName?: string;
  status: ReferralStatus;
  referrerRewardPoints: number;
  refereeRewardPoints: number;
  referrerRewarded: boolean;
  refereeRewarded: boolean;
  orderId?: string;
  billId?: string;
  completedAt?: Date;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReferralSchema = new Schema<IReferral>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, index: true },
    referrerCustomerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    referrerPhone: { type: String, required: true, trim: true },
    refereeCustomerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    refereePhone: { type: String, required: true, trim: true },
    refereeName: { type: String, trim: true },
    status: { type: String, enum: ['pending', 'completed', 'rewarded', 'voided'], default: 'pending' },
    referrerRewardPoints: { type: Number, default: 0, min: 0 },
    refereeRewardPoints: { type: Number, default: 0, min: 0 },
    referrerRewarded: { type: Boolean, default: false },
    refereeRewarded: { type: Boolean, default: false },
    orderId: { type: String, trim: true },
    billId: { type: String, trim: true },
    completedAt: { type: Date, default: null },
    createdBy: { type: String, trim: true },
  },
  { timestamps: true }
);

ReferralSchema.index({ restaurantId: 1, refereePhone: 1 }, { unique: true });
ReferralSchema.index({ restaurantId: 1, referrerPhone: 1, createdAt: -1 });
ReferralSchema.index({ restaurantId: 1, code: 1, status: 1 });

export default mongoose.model<IReferral>('Referral', ReferralSchema);

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CouponRedemption Model — Per-customer offer/coupon usage ledger (Phase 1.6).
 * Every applied offer/coupon/promo-code is recorded here so the OfferEngine
 * can enforce per-customer limits, per-restaurant/per-branch limits and
 * stacking rules server-side. Prevents duplicate or forged redemptions.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ICouponRedemption extends Document {
  restaurantId: mongoose.Types.ObjectId;
  offerId: mongoose.Types.ObjectId;
  code?: string;               // coupon/promo code used (if any)
  customerId?: mongoose.Types.ObjectId;
  customerPhone?: string;
  billId?: string;
  branchId?: mongoose.Types.ObjectId;
  discountAmount: number;
  status: 'applied' | 'voided';
  redeemedBy?: string;
  createdAt: Date;
}

const CouponRedemptionSchema = new Schema<ICouponRedemption>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    offerId: { type: Schema.Types.ObjectId, ref: 'Offer', required: true, index: true },
    code: { type: String, trim: true, uppercase: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    customerPhone: { type: String, trim: true },
    billId: { type: String, trim: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    discountAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['applied', 'voided'], default: 'applied' },
    redeemedBy: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

CouponRedemptionSchema.index({ restaurantId: 1, offerId: 1, customerId: 1, createdAt: -1 });
CouponRedemptionSchema.index({ restaurantId: 1, code: 1, createdAt: -1 });
CouponRedemptionSchema.index({ restaurantId: 1, createdAt: -1 });

export default mongoose.model<ICouponRedemption>('CouponRedemption', CouponRedemptionSchema);

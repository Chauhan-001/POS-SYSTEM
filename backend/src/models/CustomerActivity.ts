/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CustomerActivity Model — Customer timeline / activity feed (Phase 1.6).
 * Append-only record of every notable event on a customer profile:
 * created, updated, note, block/unblock, points events, reward redemption,
 * offer/coupon applied, tier change, referral, merge, restore, import/export.
 * Powers the Customer Profile screen timeline and the CRM activity feed.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type CustomerActivityType =
  | 'created'
  | 'updated'
  | 'note_added'
  | 'block'
  | 'unblock'
  | 'deleted'
  | 'restored'
  | 'merged'
  | 'imported'
  | 'exported'
  | 'points_earned'
  | 'points_redeemed'
  | 'points_expired'
  | 'reward_redeemed'
  | 'offer_applied'
  | 'coupon_applied'
  | 'tier_changed'
  | 'status_changed'
  | 'visit_recorded'
  | 'referral_registered'
  | 'referred_by'
  | 'wallet_credited'
  | 'wallet_debited';

export interface ICustomerActivity extends Document {
  restaurantId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  customerPhone?: string;
  type: CustomerActivityType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  performedBy?: string;
  createdAt: Date;
}

const CustomerActivitySchema = new Schema<ICustomerActivity>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    customerPhone: { type: String, trim: true },
    type: { type: String, enum: [
      'created', 'updated', 'note_added', 'block', 'unblock', 'deleted', 'restored',
      'merged', 'imported', 'exported', 'points_earned', 'points_redeemed',
      'points_expired', 'reward_redeemed', 'offer_applied', 'coupon_applied',
      'tier_changed', 'status_changed', 'visit_recorded', 'referral_registered',
      'referred_by', 'wallet_credited', 'wallet_debited',
    ], required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
    performedBy: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

CustomerActivitySchema.index({ restaurantId: 1, customerId: 1, createdAt: -1 });
CustomerActivitySchema.index({ restaurantId: 1, type: 1, createdAt: -1 });
CustomerActivitySchema.index({ restaurantId: 1, createdAt: -1 });

export default mongoose.model<ICustomerActivity>('CustomerActivity', CustomerActivitySchema);

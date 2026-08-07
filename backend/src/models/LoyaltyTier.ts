/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LoyaltyTier Model — Configurable loyalty tiers (Phase 1.6).
 * Bronze → Silver → Gold → Platinum → Diamond. Each tier defines the
 * lifetime-spend threshold, points multiplier, reward percentage, point
 * expiry policy, benefits and birthday/anniversary bonus points.
 * Tier assignment is server-authoritative (computed by the LoyaltyEngine
 * from totalSpend, never trusted from the client).
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ILoyaltyTier extends Document {
  restaurantId: mongoose.Types.ObjectId;
  name: string;
  minLifetimeSpend: number;
  pointsMultiplier: number;
  rewardPercent: number;
  /** Months before earned points expire (0 = never for this tier) */
  expiryMonths: number;
  benefits: string[];
  priority: number;
  birthdayRewardPoints: number;
  anniversaryRewardPoints: number;
  isActive: boolean;
  isDefault: boolean;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LoyaltyTierSchema = new Schema<ILoyaltyTier>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    minLifetimeSpend: { type: Number, default: 0, min: 0 },
    pointsMultiplier: { type: Number, default: 1, min: 0 },
    rewardPercent: { type: Number, default: 0, min: 0, max: 100 },
    expiryMonths: { type: Number, default: 12, min: 0 },
    benefits: [{ type: String, trim: true }],
    priority: { type: Number, default: 0, min: 0 },
    birthdayRewardPoints: { type: Number, default: 0, min: 0 },
    anniversaryRewardPoints: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

LoyaltyTierSchema.index({ restaurantId: 1, priority: 1 });
LoyaltyTierSchema.index({ restaurantId: 1, isActive: 1 });

export default mongoose.model<ILoyaltyTier>('LoyaltyTier', LoyaltyTierSchema);

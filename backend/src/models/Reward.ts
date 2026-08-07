/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reward Model — Loyalty rewards catalog.
 * Rewards can be flat discount (₹), percentage off, or free item.
 * Large rewards (high value) require OTP verification before redemption.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IReward extends Document {
  /** Tenant scoping — legacy catalog rewards may omit this (kept visible for backward compat) */
  restaurantId?: mongoose.Types.ObjectId;
  title: string;
  pointsRequired: number;
  type: 'percentage' | 'flat' | 'item';
  value: number;
  minBillAmount: number;
  isLargeReward: boolean;
  rewardItemId?: string;
  rewardItemName?: string;
  /** Available stock — null/undefined = unlimited */
  stock?: number;
  /** Times this reward has been redeemed (usage tracking) */
  redeemedCount: number;
  isActive: boolean;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RewardSchema = new Schema<IReward>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    title: { type: String, required: true, trim: true },
    pointsRequired: { type: Number, required: true, min: 0, index: true },
    type: { type: String, required: true, enum: ['percentage', 'flat', 'item'] },
    value: { type: Number, required: true, min: 0 },
    minBillAmount: { type: Number, default: 0, min: 0 },
    isLargeReward: { type: Boolean, default: false },
    rewardItemId: { type: String, trim: true },
    rewardItemName: { type: String, trim: true },
    stock: { type: Number, min: 0 },
    redeemedCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

RewardSchema.index({ restaurantId: 1, isActive: 1, pointsRequired: 1 });
RewardSchema.index({ isActive: 1, pointsRequired: 1 });

export default mongoose.model<IReward>('Reward', RewardSchema);

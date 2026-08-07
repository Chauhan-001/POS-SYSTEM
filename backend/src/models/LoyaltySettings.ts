/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LoyaltySettings Model — Per-restaurant loyalty configuration (Phase 1.6).
 * Single document per restaurant (upserted on first use). Controls point
 * earning rate, redemption limits, expiry policy, welcome/birthday bonuses,
 * referral rewards and wallet behaviour. These values are the ONLY source of
 * truth for the LoyaltyEngine — client-supplied numbers are never trusted.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type PointExpiryMode = 'none' | 'rolling' | 'fixed' | 'annual';

export interface ILoyaltySettings extends Document {
  restaurantId: mongoose.Types.ObjectId;
  /** Points earned per unit of currency spent (e.g. 1 pt per ₹10) */
  pointsPerCurrency: number;
  /** Number of points equal to one unit of currency (e.g. 10 pts = ₹1) */
  pointsValueInCurrency: number;
  roundOffPoints: boolean;
  // ── Redemption limits ─────────────────────────────────────
  minRedemption: number;
  maxRedemptionPerTransaction: number;
  dailyRedemptionLimit: number;
  monthlyRedemptionLimit: number;
  // ── Expiry ────────────────────────────────────────────────
  pointExpiryMode: PointExpiryMode;
  rollingExpiryMonths: number;
  fixedExpiryDate?: string;      // YYYY-MM-DD when mode === 'fixed'
  expiryReminderDays: number[];  // notify N days before expiry
  // ── Bonuses ────────────────────────────────────────────────
  welcomePoints: number;
  birthdayBonusPoints: number;
  anniversaryBonusPoints: number;
  // ── Referral ───────────────────────────────────────────────
  referralEnabled: boolean;
  referralReferrerPoints: number;
  referralRefereePoints: number;
  // ── Feature toggles ────────────────────────────────────────
  enableWallet: boolean;
  enableTiers: boolean;
  otpEnabled: boolean;
  largeRewardThreshold: number;   // reward value at/above which OTP is required
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LoyaltySettingsSchema = new Schema<ILoyaltySettings>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, unique: true, index: true },
    pointsPerCurrency: { type: Number, default: 1, min: 0 },
    pointsValueInCurrency: { type: Number, default: 10, min: 1 },
    roundOffPoints: { type: Boolean, default: true },
    minRedemption: { type: Number, default: 0, min: 0 },
    maxRedemptionPerTransaction: { type: Number, default: 500, min: 0 },
    dailyRedemptionLimit: { type: Number, default: 1000, min: 0 },
    monthlyRedemptionLimit: { type: Number, default: 5000, min: 0 },
    pointExpiryMode: { type: String, enum: ['none', 'rolling', 'fixed', 'annual'], default: 'none' },
    rollingExpiryMonths: { type: Number, default: 12, min: 1 },
    fixedExpiryDate: { type: String, trim: true },
    expiryReminderDays: [{ type: Number, min: 1 }],
    welcomePoints: { type: Number, default: 50, min: 0 },
    birthdayBonusPoints: { type: Number, default: 100, min: 0 },
    anniversaryBonusPoints: { type: Number, default: 100, min: 0 },
    referralEnabled: { type: Boolean, default: true },
    referralReferrerPoints: { type: Number, default: 100, min: 0 },
    referralRefereePoints: { type: Number, default: 50, min: 0 },
    enableWallet: { type: Boolean, default: true },
    enableTiers: { type: Boolean, default: true },
    otpEnabled: { type: Boolean, default: true },
    largeRewardThreshold: { type: Number, default: 500, min: 0 },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model<ILoyaltySettings>('LoyaltySettings', LoyaltySettingsSchema);

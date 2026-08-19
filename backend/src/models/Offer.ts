/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Model — Promotional offers and campaigns.
 * Supports % discount, flat discount, BOGO, free item, combo, cashback,
 * reward points, coupon, festival, referral, and loyalty bonus types.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type OfferType =
  | 'percentage'
  | 'flat'
  | 'bogo'
  | 'free_item'
  | 'combo'
  | 'cashback'
  | 'reward_points'
  | 'coupon'
  | 'festival'
  | 'referral'
  | 'loyalty_bonus';

export type OfferStatus = 'draft' | 'active' | 'scheduled' | 'paused' | 'expired' | 'cancelled';

export type OfferRecommendationSource =
  | 'weather'
  | 'festival'
  | 'inventory_clearance'
  | 'inventory_low_stock_protection'
  | 'high_margin_promotion'
  | 'combo_upsell'
  | 'time_based'
  | 'weekend'
  | 'slow_day'
  | 'weak_category'
  | 'top_category'
  | 'repeat_customer'
  | 'lost_customer'
  | 'win_back'
  | 'vip_reward'
  | 'first_visit'
  | 'second_visit'
  | 'new_menu'
  | 'seasonal_menu'
  | 'birthday'
  | 'anniversary'
  | 'referral'
  | 'analytics_proven'
  | 'margin_protection'
  | 'cost_increase_warning'
  | 'margin_deterioration'
  | 'wastage_alert'
  | 'manual';

export interface IOffer extends Document {
  restaurantId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  shortDescription?: string;
  type: OfferType;
  /** Discount value: percentage (e.g. 15), flat amount (e.g. 100), or points */
  value: number;
  /** Minimum order value to qualify */
  minOrderValue?: number;
  /** Maximum discount amount (for percentage type) */
  maxDiscount?: number;
  /** Maximum number of uses across all customers */
  maxUses?: number;
  /** Times used so far */
  currentUses: number;
  /** Per-customer usage limit */
  maxPerCustomer?: number;
  /** Categories this offer applies to (empty = all) */
  applicableCategories: string[];
  /** Specific product IDs (empty = all) */
  applicableProductIds: string[];
  /** Customer segment IDs this offer targets (empty = all) */
  targetSegmentIds: string[];
  /** Customer segment names (denormalized for quick display) */
  targetSegmentNames: string[];
  /** Start date (ISO) */
  startDate?: string;
  /** End date (ISO) */
  endDate?: string;
  /** Scheduled publish date */
  scheduledDate?: string;
  /** Time-specific: days of week (0=Sun, 1=Mon, ...) */
  daysOfWeek?: number[];
  /** Time-specific: start hour (0-23) */
  startHour?: number;
  /** Time-specific: end hour (0-23) */
  endHour?: number;
  /** For BOGO: product ID for the free item */
  freeItemId?: string;
  /** For BOGO: product name */
  freeItemName?: string;
  /** For BOGO: quantity of free item */
  freeItemQty?: number;
  /** For combo: array of product IDs included */
  comboProductIds?: string[];
  /** For combo: combined price */
  comboPrice?: number;
  /** For combo: per-branch combo price overrides (branchId → price). */
  comboBranchPrices?: Record<string, number>;
  /** When this combo offer was auto-created from a Meal Combo product, the owning Product id. */
  linkedProductId?: string;
  /** Cashback: amount or percentage */
  cashbackValue?: number;
  /** Referral: reward for referrer */
  referrerReward?: string;
  /** Referral: reward for referee */
  refereeReward?: string;
  /** Coupon/promo code customers can redeem at the counter (per-restaurant unique) */
  couponCode?: string;
  /** Restrict to specific loyalty tiers (empty = all tiers) */
  targetTier?: string[];
  /** Whether this offer can stack with other offers (default true) */
  stackingAllowed?: boolean;
  /** Group name for mutually-exclusive offers — only one per group may apply */
  mutuallyExclusiveGroup?: string;
  /** Source of recommendation (for AI-recommended offers) */
  recommendationSource?: OfferRecommendationSource;
  /** Explanation of why this offer was recommended */
  recommendationReason?: string;
  /** Estimated audience reach */
  estimatedReach?: number;
  /** Expected impact description */
  expectedImpact?: string;
  /** Whether this was AI-generated */
  isAiGenerated: boolean;
  /** Whether this offer should auto-activate based on conditions */
  isAutoActivate: boolean;
  /** Status of the offer */
  status: OfferStatus;
  /** WhatsApp message template */
  whatsappMessage?: string;
  /** SMS template */
  smsMessage?: string;
  /** App notification template */
  appNotification?: string;
  /** Email template */
  emailSubject?: string;
  emailBody?: string;
  /** Who created this */
  createdBy?: string;
  /** Branch scope (empty = all branches) */
  branchIds: string[];
  /** Offer image/icon URL */
  imageUrl?: string;
  /** Display sort order */
  sortOrder: number;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OfferSchema = new Schema<IOffer>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    shortDescription: { type: String, trim: true },
    type: { type: String, enum: [
      'percentage', 'flat', 'bogo', 'free_item', 'combo', 'cashback',
      'reward_points', 'coupon', 'festival', 'referral', 'loyalty_bonus'
    ], required: true },
    value: { type: Number, required: true, min: 0 },
    minOrderValue: { type: Number, min: 0 },
    maxDiscount: { type: Number, min: 0 },
    maxUses: { type: Number, min: 0 },
    currentUses: { type: Number, default: 0, min: 0 },
    maxPerCustomer: { type: Number, min: 0 },
    applicableCategories: [{ type: String, trim: true }],
    applicableProductIds: [{ type: String, trim: true }],
    targetSegmentIds: [{ type: String, trim: true }],
    targetSegmentNames: [{ type: String, trim: true }],
    startDate: { type: String, trim: true },
    endDate: { type: String, trim: true },
    scheduledDate: { type: String, trim: true },
    daysOfWeek: [{ type: Number, min: 0, max: 6 }],
    startHour: { type: Number, min: 0, max: 23 },
    endHour: { type: Number, min: 0, max: 23 },
    freeItemId: { type: String, trim: true },
    freeItemName: { type: String, trim: true },
    freeItemQty: { type: Number, min: 1 },
    comboProductIds: [{ type: String, trim: true }],
    comboPrice: { type: Number, min: 0 },
    comboBranchPrices: { type: Map, of: Number, default: {} },
    linkedProductId: { type: String, trim: true, index: true },
    cashbackValue: { type: Number, min: 0 },
    referrerReward: { type: String, trim: true },
    refereeReward: { type: String, trim: true },
    couponCode: { type: String, trim: true, uppercase: true },
    targetTier: [{ type: String, trim: true }],
    stackingAllowed: { type: Boolean, default: true },
    mutuallyExclusiveGroup: { type: String, trim: true },
    recommendationSource: { type: String, enum: [
      'weather', 'festival', 'inventory_clearance', 'inventory_low_stock_protection',
      'high_margin_promotion', 'combo_upsell', 'time_based', 'weekend',
      'slow_day', 'weak_category', 'repeat_customer', 'lost_customer',
      'vip_reward', 'first_visit', 'second_visit', 'new_menu',
      'seasonal_menu', 'birthday', 'anniversary', 'referral', 'analytics_proven', 'manual'
    ]},
    recommendationReason: { type: String, trim: true },
    estimatedReach: { type: Number, min: 0 },
    expectedImpact: { type: String, trim: true },
    isAiGenerated: { type: Boolean, default: false },
    isAutoActivate: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'active', 'scheduled', 'paused', 'expired', 'cancelled'], default: 'draft' },
    whatsappMessage: { type: String, trim: true },
    smsMessage: { type: String, trim: true },
    appNotification: { type: String, trim: true },
    emailSubject: { type: String, trim: true },
    emailBody: { type: String, trim: true },
    createdBy: { type: String, trim: true },
    branchIds: [{ type: String, trim: true }],
    imageUrl: { type: String, trim: true },
    sortOrder: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Phase 26 — delivery/query indexes. Every index is restaurant-prefixed so the
// scheduler's tenant-wide scans (scheduled → active, active → expired) and the
// per-restaurant list/segment queries stay index-backed.
OfferSchema.index({ restaurantId: 1, status: 1 });
OfferSchema.index({ restaurantId: 1, startDate: 1, endDate: 1 });
OfferSchema.index({ restaurantId: 1, scheduledDate: 1, status: 1 });
OfferSchema.index({ restaurantId: 1, type: 1 });
// Coupon codes are unique per restaurant — but only when a code actually
// exists. A sparse index still indexes `null`, so the FIRST coupon-less offer
// would block every later one; a partial filter indexes only real strings,
// letting any number of offers run without a coupon.
OfferSchema.index(
  { restaurantId: 1, couponCode: 1 },
  { unique: true, partialFilterExpression: { couponCode: { $type: 'string' } } },
);
OfferSchema.index({ restaurantId: 1, targetSegmentIds: 1 });
OfferSchema.index({ title: 'text', description: 'text' });

export default mongoose.model<IOffer>('Offer', OfferSchema);

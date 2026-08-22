/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PromotionCandidate — Persisted recommendation with full lifecycle tracking.
 * Supports: NEW → VIEWED → ACCEPTED/REJECTED/SNOOZED → IMPLEMENTED → CONVERTED → COOLDOWN
 */

import mongoose from 'mongoose';

export type PromotionType =
  | 'CREATE_COMBO'
  | 'CREATE_ADDON'
  | 'CREATE_PROMOTION'
  | 'RUN_REACTIVATION'
  | 'REVIEW_PRICE'
  | 'REVIEW_RECIPE_COST'
  | 'PROMOTE_SLOW_ITEM'
  | 'PROTECT_HIGH_DEMAND_STOCK'
  | 'REDUCE_WASTAGE';

export type RecommendationStatus =
  | 'NEW'
  | 'VIEWED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'SNOOZED'
  | 'IMPLEMENTED'
  | 'EXPIRED'
  | 'CONVERTED'
  | 'COOLDOWN';

export interface FinancialModel {
  currentPrice: number;
  proposedPrice: number;
  recipeCost: number;
  discountPercent: number;
  discountAmount: number;
  currentContribution: number;
  projectedContribution: number;
  projectedContributionMargin: number;
  incrementalUnits: number;
  incrementalRevenue: number;
  incrementalContribution: number;
  breakEvenIncrementalUnits: number;
  paybackPeriodDays: number;
  minMarginConstraint: number;
  maxDiscountConstraint: number;
}

export interface CannibalizationEstimate {
  estimatedCannibalizationRate: number;
  incrementalVsCannibalized: number;
  confidence: number;
  evidence: ISignalEvidence[];
}

export interface BusinessConstraints {
  minMarginPercent: number;
  maxDiscountPercent: number;
  minSellingPrice: number;
  restrictedCategories: string[];
  excludedProductIds: string[];
}

export interface ITarget {
  productIds: string[];
  productNames: string[];
  categoryIds: string[];
  segmentIds: string[];
}

export interface ISignalEvidence {
  description: string;
  value: number;
  baseline?: number;
  percentageChange?: number;
  sampleSize?: number;
  confidence?: number;
  metadata?: Record<string, any>;
}

export interface IPromotionCandidate extends mongoose.Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  type: PromotionType;
  priority: 'high' | 'medium' | 'low';
  score: number;
  confidence: number;
  title: string;
  description: string;
  target: ITarget;
  evidence: ISignalEvidence[];
  financialModel: FinancialModel;
  cannibalization: CannibalizationEstimate;
  risks: string[];
  prerequisites: string[];
  constraints: BusinessConstraints;
  status: RecommendationStatus;
  recommendedAction: 'create_offer' | 'create_combo' | 'create_campaign' | 'review_pricing' | 'review_recipe' | 'reduce_purchases';
  sourceSignals: string[];
  fingerprint: string;
  instanceCount: number;
  offerId?: mongoose.Types.ObjectId;
  campaignId?: mongoose.Types.ObjectId;
  viewedAt?: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  snoozedAt?: Date;
  snoozedUntil?: Date;
  implementedAt?: Date;
  expiredAt?: Date;
  convertedAt?: Date;
  cooldownUntil?: Date;
  actionTaken?: string;
  outcome?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

const financialModelSchema = new mongoose.Schema<FinancialModel>({
  currentPrice: { type: Number, required: true },
  proposedPrice: { type: Number, required: true },
  recipeCost: { type: Number, required: true },
  discountPercent: { type: Number, required: true },
  discountAmount: { type: Number, required: true },
  currentContribution: { type: Number, required: true },
  projectedContribution: { type: Number, required: true },
  projectedContributionMargin: { type: Number, required: true },
  incrementalUnits: { type: Number, required: true },
  incrementalRevenue: { type: Number, required: true },
  incrementalContribution: { type: Number, required: true },
  breakEvenIncrementalUnits: { type: Number, required: true },
  paybackPeriodDays: { type: Number, required: true },
  minMarginConstraint: { type: Number, required: true },
  maxDiscountConstraint: { type: Number, required: true },
}, { _id: false });

const cannibalizationSchema = new mongoose.Schema<CannibalizationEstimate>({
  estimatedCannibalizationRate: { type: Number, required: true },
  incrementalVsCannibalized: { type: Number, required: true },
  confidence: { type: Number, required: true },
  evidence: [{ type: mongoose.Schema.Types.Mixed }],
}, { _id: false });

const constraintsSchema = new mongoose.Schema<BusinessConstraints>({
  minMarginPercent: { type: Number, default: 15 },
  maxDiscountPercent: { type: Number, default: 30 },
  minSellingPrice: { type: Number, default: 50 },
  restrictedCategories: { type: [String], default: [] },
  excludedProductIds: { type: [String], default: [] },
}, { _id: false });

const targetSchema = new mongoose.Schema<ITarget>({
  productIds: { type: [String], default: [] },
  productNames: { type: [String], default: [] },
  categoryIds: { type: [String], default: [] },
  segmentIds: { type: [String], default: [] },
}, { _id: false });

const evidenceSchema = new mongoose.Schema<ISignalEvidence>({
  description: { type: String, required: true },
  value: { type: Number, required: true },
  baseline: { type: Number },
  percentageChange: { type: Number },
  sampleSize: { type: Number },
  confidence: { type: Number },
  metadata: { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const promotionCandidateSchema = new mongoose.Schema<IPromotionCandidate>({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
  type: {
    type: String,
    enum: [
      'CREATE_COMBO',
      'CREATE_ADDON',
      'CREATE_PROMOTION',
      'RUN_REACTIVATION',
      'REVIEW_PRICE',
      'REVIEW_RECIPE_COST',
      'PROMOTE_SLOW_ITEM',
      'PROTECT_HIGH_DEMAND_STOCK',
      'REDUCE_WASTAGE',
    ],
    required: true,
    index: true,
  },
  priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium', index: true },
  score: { type: Number, required: true, min: 0, max: 100, index: true },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  title: { type: String, required: true },
  description: { type: String, required: true },
  target: { type: targetSchema, required: true },
  evidence: { type: [evidenceSchema], default: [] },
  financialModel: { type: financialModelSchema, required: true },
  cannibalization: { type: cannibalizationSchema, required: true },
  risks: { type: [String], default: [] },
  prerequisites: { type: [String], default: [] },
  constraints: { type: constraintsSchema, required: true },
  status: {
    type: String,
    enum: ['NEW', 'VIEWED', 'ACCEPTED', 'REJECTED', 'SNOOZED', 'IMPLEMENTED', 'EXPIRED', 'CONVERTED', 'COOLDOWN'],
    default: 'NEW',
    index: true,
  },
  recommendedAction: {
    type: String,
    enum: ['create_offer', 'create_combo', 'create_campaign', 'review_pricing', 'review_recipe', 'reduce_purchases'],
    required: true,
  },
  sourceSignals: { type: [String], default: [] },
  fingerprint: { type: String, trim: true, index: true },
  instanceCount: { type: Number, default: 1, min: 1 },
  offerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', default: null },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
  viewedAt: { type: Date },
  acceptedAt: { type: Date },
  rejectedAt: { type: Date },
  snoozedAt: { type: Date },
  snoozedUntil: { type: Date },
  implementedAt: { type: Date },
  expiredAt: { type: Date },
  convertedAt: { type: Date },
  cooldownUntil: { type: Date },
  actionTaken: { type: String },
  outcome: { type: String },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true });

// Compound indexes
promotionCandidateSchema.index({ restaurantId: 1, status: 1, score: -1 });
promotionCandidateSchema.index({ restaurantId: 1, fingerprint: 1, status: 1 });
promotionCandidateSchema.index({ restaurantId: 1, type: 1, createdAt: -1 });
promotionCandidateSchema.index({ expiresAt: 1, status: 1 }); // For expiry cleanup
promotionCandidateSchema.index({ cooldownUntil: 1, status: 1 }); // For cooldown re-evaluation

export default mongoose.models.PromotionCandidate || mongoose.model<IPromotionCandidate>('PromotionCandidate', promotionCandidateSchema);
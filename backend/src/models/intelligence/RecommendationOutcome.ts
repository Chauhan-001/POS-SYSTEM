/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecommendationOutcome — Models the outcome of a promotion/ recommendation
 * that was implemented. This is the core learning record that closes the loop.
 *
 * Every recommendation that has a measurable outcome should store expected vs actual
 * performance, allowing the system to learn and improve future recommendations.
 *
 * Auditability: Historical outcomes are never overwritten. New entries append.
 * Tenant isolation: All outcomes are scoped to restaurantId.
 */

import mongoose, { Document, model, Schema } from 'mongoose';

export type OutcomeStatus = 'pending' | 'measured' | 'completed' | 'archived';

export type AttributionMethod = 'pre_post' | 'control_vs_test' | 'time_series' | 'cohort';

export type PromotionType = 'percentage' | 'fixed_amount' | 'free_item' | 'combo' | 'bundle' | 'limited_time';

export interface OutcomeMetrics {
  orders?: number;
  revenue?: number;
  aov?: number;
  contribution?: number;
  discountCost?: number;
  incrementalContribution?: number;
  newCustomers?: number;
  returningCustomers?: number;
  repeatPurchases?: number;
  redemptionRate?: number;
  inventoryConsumed?: number;
  wastage?: number;
  marginImpact?: number;
  customerSegmentResponse?: Record<string, number>;
}

export interface OutcomeBaseline {
  method: AttributionMethod;
  comparisonPeriodStart: Date;
  comparisonPeriodEnd: Date;
  baselineValue: number; // e.g., baseline revenue, baseline orders
  documentedAssumptions: string[];
}

export interface OutcomeExpected {
  expectedOrderUpliftPercent?: number;
  expectedContribution?: number;
  expectedNewCustomers?: number;
  expectedRepeatPurchases?: number;
  expectedAOVImpact?: number;
  documentedAssumptions: string[];
}

export interface OutcomeActual {
  actualOrderUpliftPercent?: number;
  actualContribution?: number;
  actualNewCustomers?: number;
  actualRepeatPurchases?: number;
  actualAOVImpact?: number;
}

export interface OutcomeVariance {
  orderUpliftPercentDiff: number;
  contributionDiff: number;
  newCustomerDiff: number;
  repeatPurchaseDiff: number;
  aovDiff: number;
}

export interface OutcomeRecommendation {
  recommendationId: string;
  restaurantId: string;
  promotedAt: Date;
  measurementWindowDays: number;
  implemented: boolean;
  status: OutcomeStatus;
  metrics: OutcomeMetrics;
  baseline: OutcomeBaseline;
  expected: OutcomeExpected;
  actual: OutcomeActual;
  variance: OutcomeVariance;
  attributionMethod: AttributionMethod;
  promotionType: PromotionType;
  constraintsViolated?: string[];
  learningSignals: LearningSignal[];
  ownerFeedback?: OwnerFeedback;
  createdAt: Date;
  updatedAt: Date;
}

export type LearningSignal =
  | 'promotion_accepted'
  | 'promotion_rejected'
  | 'promotion_implemented'
  | 'promotion_redeemed'
  | 'incremental_sales'
  | 'incremental_contribution'
  | 'customer_response'
  | 'aov_change'
  | 'inventory_impact'
  | 'wastage_impact'
  | 'repeat_purchase_impact';

export interface OwnerFeedback {
  rating: 'positive' | 'neutral' | 'negative';
  comment?: string;
  categories?: ('too_expensive' | 'already_tried' | 'not_useful' | 'good_idea' | 'other')[];
  would_accept_again: boolean;
}

const recommendationOutcomeSchema = new Schema({
  recommendationId: { type: String, required: true },
  restaurantId: { type: Schema.Types.ObjectId, required: true, index: true },
  promotedAt: { type: Date, required: true },
  measurementWindowDays: { type: Number, required: true, default: 30 },

  implemented: { type: Boolean, default: true },
  status: { type: String, enum: ['pending', 'measured', 'completed', 'archived'], default: 'pending' },

  metrics: {
    type: Map,
    of: Number,
    default: {},
  },

  baseline: {
    method: { type: String, enum: ['pre_post', 'control_vs_test', 'time_series', 'cohort'], required: true },
    comparisonPeriodStart: { type: Date, required: true },
    comparisonPeriodEnd: { type: Date, required: true },
    baselineValue: { type: Number, required: true },
    documentedAssumptions: { type: [String], default: [] },
  },

  expected: {
    expectedOrderUpliftPercent: { type: Number },
    expectedContribution: { type: Number },
    expectedNewCustomers: { type: Number },
    expectedRepeatPurchases: { type: Number },
    expectedAOVImpact: { type: Number },
    documentedAssumptions: { type: [String], default: [] },
  },

  actual: {
    actualOrderUpliftPercent: { type: Number },
    actualContribution: { type: Number },
    actualNewCustomers: { type: Number },
    actualRepeatPurchases: { type: Number },
    actualAOVImpact: { type: Number },
  },

  variance: {
    orderUpliftPercentDiff: { type: Number, default: 0 },
    contributionDiff: { type: Number, default: 0 },
    newCustomerDiff: { type: Number, default: 0 },
    repeatPurchaseDiff: { type: Number, default: 0 },
    aovDiff: { type: Number, default: 0 },
  },

  attributionMethod: { type: String, enum: ['pre_post', 'control_vs_test', 'time_series', 'cohort'], required: true },

  promotionType: { type: String, enum: ['percentage', 'fixed_amount', 'free_item', 'combo', 'bundle', 'limited_time'], required: true },

  constraintsViolated: { type: [String], default: [] },

  learningSignals: { type: [String], default: [] },

  ownerFeedback: {
    rating: { type: String, enum: ['positive', 'neutral', 'negative'], default: 'neutral' },
    comment: { type: String },
    categories: { type: [String], default: [] },
    would_accept_again: { type: Boolean, default: true },
  },

}, { timestamps: true });

// Index for tenant isolation and fast lookups by recommendation ID
recommendationOutcomeSchema.index({ restaurantId: 1, status: 1 });
recommendationOutcomeSchema.index({ recommendationId: 1 });
recommendationOutcomeSchema.index({ promotedAt: -1 });

export interface IRecommendationOutcome extends Document {
  recommendationId: string;
  restaurantId: string;
  promotedAt: Date;
  status: OutcomeStatus;
  metrics: OutcomeMetrics;
  baseline: OutcomeBaseline;
  expected: OutcomeExpected;
  actual: OutcomeActual;
  variance: OutcomeVariance;
  attributionMethod: AttributionMethod;
  promotionType: PromotionType;
  learningSignals: LearningSignal[];
  ownerFeedback?: OwnerFeedback;
  createdAt: Date;
  updatedAt: Date;
}

export default model<IRecommendationOutcome>('RecommendationOutcome', recommendationOutcomeSchema);
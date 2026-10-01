/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PromotionScenario — Deterministic scenario comparison for promotion optimization.
 */

import mongoose from 'mongoose';

export type ScenarioType = 'current' | 'promo_a' | 'promo_b' | 'combo' | 'no_promo';

export type OptimizationObjective =
  | 'maximize_contribution'
  | 'maximize_revenue'
  | 'maximize_aov'
  | 'maximize_transactions'
  | 'reduce_inventory'
  | 'maximize_retention'
  | 'maximize_slow_hour_utilization';

export interface IOfferConfig {
  type: 'percentage' | 'flat' | 'buy_x_get_y' | 'combo' | 'add_on';
  value: number;
  minOrderValue?: number;
  maxDiscount?: number;
  applicableProductIds: string[];
  applicableCategoryIds: string[];
  applicableSegmentIds: string[];
  startDate: Date;
  endDate: Date;
  maxRedemptions?: number;
  maxPerCustomer?: number;
}

export interface IPromotionScenario extends mongoose.Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  scenarioId: string;
  name: string;
  type: ScenarioType;
  targetEntity: {
    type: 'product' | 'category' | 'restaurant';
    id: string;
    name: string;
  };
  offerConfig: IOfferConfig;
  forecastDemand: {
    baseline: number;
    expected: number;
    incremental: number;
  };
  economics: {
    currentPrice: number;
    proposedPrice: number;
    recipeCost: number;
    discountPercent: number;
    discountAmount: number;
    expectedRevenue: number;
    expectedContribution: number;
    incrementalRevenue: number;
    incrementalContribution: number;
    contributionMarginPercent: number;
    breakEvenVolumeIncrease: number;
  };
  inventoryImpact: {
    requiredStock: number;
    availableStock: number;
    stockoutRisk: string;
    blockingIngredients: Array<{
      ingredientId: string;
      ingredientName: string;
      needed: number;
      available: number;
    }>;
  };
  cannibalization: {
    estimatedCannibalizationRate: number;
    incrementalVsCannibalized: number;
    confidence: number;
  };
  objective: OptimizationObjective;
  constraints: {
    minMarginPercent: number;
    maxDiscountPercent: number;
    minSellingPrice: number;
    requireInventoryAvailability: boolean;
    restrictedCategories: string[];
    excludedProductIds: string[];
  };
  valid: boolean;
  violations: string[];
  score: number;
  modelVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

const offerConfigSchema = new mongoose.Schema({
  type: { type: String, enum: ['percentage', 'flat', 'buy_x_get_y', 'combo', 'add_on'], required: true },
  value: { type: Number, required: true },
  minOrderValue: { type: Number, default: 0 },
  maxDiscount: { type: Number, default: 0 },
  applicableProductIds: { type: [String], default: [] },
  applicableCategoryIds: { type: [String], default: [] },
  applicableSegmentIds: { type: [String], default: [] },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  maxRedemptions: { type: Number, default: null },
  maxPerCustomer: { type: Number, default: null },
}, { _id: false });

const forecastDemandSchema = new mongoose.Schema({
  baseline: { type: Number, required: true },
  expected: { type: Number, required: true },
  incremental: { type: Number, required: true },
}, { _id: false });

const economicsSchema = new mongoose.Schema({
  currentPrice: { type: Number, required: true },
  proposedPrice: { type: Number, required: true },
  recipeCost: { type: Number, required: true },
  discountPercent: { type: Number, required: true },
  discountAmount: { type: Number, required: true },
  expectedRevenue: { type: Number, required: true },
  expectedContribution: { type: Number, required: true },
  incrementalRevenue: { type: Number, required: true },
  incrementalContribution: { type: Number, required: true },
  contributionMarginPercent: { type: Number, required: true },
  breakEvenVolumeIncrease: { type: Number, required: true },
}, { _id: false });

const inventoryImpactSchema = new mongoose.Schema({
  requiredStock: { type: Number, required: true },
  availableStock: { type: Number, required: true },
  stockoutRisk: { type: String, required: true },
  blockingIngredients: [{
    ingredientId: { type: String, required: true },
    ingredientName: { type: String, required: true },
    needed: { type: Number, required: true },
    available: { type: Number, required: true },
  }],
}, { _id: false });

const cannibalizationSchema = new mongoose.Schema({
  estimatedCannibalizationRate: { type: Number, required: true },
  incrementalVsCannibalized: { type: Number, required: true },
  confidence: { type: Number, required: true, min: 0, max: 1 },
}, { _id: false });

const constraintsSchema = new mongoose.Schema({
  minMarginPercent: { type: Number, required: true },
  maxDiscountPercent: { type: Number, required: true },
  minSellingPrice: { type: Number, required: true },
  requireInventoryAvailability: { type: Boolean, required: true },
  restrictedCategories: { type: [String], default: [] },
  excludedProductIds: { type: [String], default: [] },
}, { _id: false });

const targetEntitySchema = new mongoose.Schema({
  type: { type: String, enum: ['product', 'category', 'restaurant'], required: true },
  id: { type: String, required: true },
  name: { type: String, required: true },
}, { _id: false });

const promotionScenarioSchema = new mongoose.Schema<IPromotionScenario>({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
  scenarioId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  type: {
    type: String,
    enum: ['current', 'promo_a', 'promo_b', 'combo', 'no_promo'],
    required: true,
    index: true,
  },
  targetEntity: { type: targetEntitySchema, required: true },
  offerConfig: { type: offerConfigSchema, required: true },
  forecastDemand: { type: forecastDemandSchema, required: true },
  economics: { type: economicsSchema, required: true },
  inventoryImpact: { type: inventoryImpactSchema, required: true },
  cannibalization: { type: cannibalizationSchema, required: true },
  objective: {
    type: String,
    enum: [
      'maximize_contribution',
      'maximize_revenue',
      'maximize_aov',
      'maximize_transactions',
      'reduce_inventory',
      'maximize_retention',
      'maximize_slow_hour_utilization',
    ],
    required: true,
    index: true,
  },
  constraints: { type: constraintsSchema, required: true },
  valid: { type: Boolean, required: true, default: true },
  violations: { type: [String], default: [] },
  score: { type: Number, required: true },
  modelVersion: { type: String, required: true, default: 'deterministic-v1' },
}, { timestamps: true });

promotionScenarioSchema.index({ restaurantId: 1, branchId: 1, targetEntity: 1, objective: 1 });
promotionScenarioSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export default mongoose.models.PromotionScenario || mongoose.model<IPromotionScenario>('PromotionScenario', promotionScenarioSchema);
export type { IPromotionScenario, IOfferConfig };
export { ScenarioType, OptimizationObjective };
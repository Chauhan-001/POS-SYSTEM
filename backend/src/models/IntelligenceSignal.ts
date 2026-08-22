/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IntelligenceSignal — Raw measurable facts derived from restaurant data.
 * These are the atomic building blocks for opportunity detection.
 * Signals are NEVER recommendations — they are evidence.
 */

import mongoose from 'mongoose';

export type SignalType =
  // Sales / Demand
  | 'SALES_DAILY_REVENUE'
  | 'SALES_WEEKLY_REVENUE'
  | 'SALES_MONTHLY_REVENUE'
  | 'SALES_DAILY_ORDERS'
  | 'SALES_WEEKLY_ORDERS'
  | 'SALES_MONTHLY_ORDERS'
  | 'SALES_AOV'
  | 'SALES_HOURLY_REVENUE'
  | 'SALES_WEEKDAY_REVENUE'
  | 'SALES_CATEGORY_REVENUE'
  | 'SALES_PRODUCT_REVENUE'
  | 'SALES_PRODUCT_UNITS'
  | 'SALES_CATEGORY_TREND_UP'
  | 'SALES_CATEGORY_TREND_DOWN'
  | 'SALES_PRODUCT_TREND_UP'
  | 'SALES_PRODUCT_TREND_DOWN'
  | 'SALES_TIME_SLOT_UNDERPERFORMING'
  | 'SALES_TIME_SLOT_OVERPERFORMING'
  // Basket / Affinity
  | 'BASKET_SUPPORT_HIGH'
  | 'BASKET_CONFIDENCE_HIGH'
  | 'BASKET_LIFT_HIGH'
  // Combo / Add-on
  | 'COMBO_AFFINITY_STRONG'
  | 'COMBO_MARGIN_HEALTHY'
  | 'ADDON_ATTACH_RATE_HIGH'
  // Menu Engineering
  | 'MENU_STAR'
  | 'MENU_PLOWHORSE'
  | 'MENU_PUZZLE'
  | 'MENU_DOG'
  | 'MENU_HIGH_POPULARITY'
  | 'MENU_HIGH_CONTRIBUTION'
  // Margin
  | 'MARGIN_HIGH_SELLING_LOW_MARGIN'
  | 'MARGIN_LOW_SELLING_HIGH_MARGIN'
  | 'MARGIN_HIGH_SELLING_HIGH_MARGIN'
  | 'MARGIN_DETERIORATING'
  | 'MARGIN_COST_RISER'
  // Inventory
  | 'INVENTORY_OVERSTOCK'
  | 'INVENTORY_SLOW_MOVING'
  | 'INVENTORY_STOCKOUT_RISK'
  | 'INVENTORY_EXPIRY_RISK'
  | 'INVENTORY_HIGH_WASTAGE'
  | 'INVENTORY_INGREDIENT_OVERSTOCK'
  // Customer
  | 'CUSTOMER_NEW_HIGH'
  | 'CUSTOMER_RETURNING_HIGH'
  | 'CUSTOMER_INACTIVE_HIGH'
  | 'CUSTOMER_HIGH_VALUE_HIGH'
  | 'CUSTOMER_FREQUENT_HIGH'
  // External
  | 'WEATHER_DEMAND_SHIFT'
  | 'FESTIVAL_DEMAND_LIFT';

export type SignalEntityType =
  | 'restaurant'
  | 'category'
  | 'product'
  | 'ingredient'
  | 'time_slot'
  | 'customer_segment'
  | 'combo_candidate'
  | 'addon_candidate';

export interface ISignalEvidence {
  /** Human-readable description of the evidence */
  description: string;
  /** Raw numeric value */
  value: number;
  /** Baseline or expected value for comparison */
  baseline?: number;
  /** Percentage change from baseline */
  percentageChange?: number;
  /** Sample size / observation count */
  sampleSize?: number;
  /** Statistical confidence (0-1) */
  confidence?: number;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

export interface ISignal extends mongoose.Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  type: SignalType;
  entityType: SignalEntityType;
  entityId?: string;
  entityName?: string;
  /** The measured value (e.g., revenue amount, lift ratio, margin %) */
  value: number;
  /** Expected/baseline value for comparison */
  baseline?: number;
  /** Percentage change from baseline */
  percentageChange?: number;
  /** Statistical confidence in this signal (0-1) */
  confidence: number;
  /** Minimum sample size required for this signal type */
  minSampleSize: number;
  /** Actual sample size observed */
  sampleSize: number;
  /** Human-readable evidence for debugging/UI */
  evidence: ISignalEvidence[];
  /** When this signal was detected */
  detectedAt: Date;
  /** When this signal expires (signals are time-bounded) */
  expiresAt: Date;
  /** Whether this signal has been consumed by opportunity generation */
  consumed: boolean;
  /** Tags for filtering/grouping */
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const signalEvidenceSchema = new mongoose.Schema<ISignalEvidence>({
  description: { type: String, required: true },
  value: { type: Number, required: true },
  baseline: { type: Number },
  percentageChange: { type: Number },
  sampleSize: { type: Number },
  confidence: { type: Number },
  metadata: { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const signalSchema = new mongoose.Schema<ISignal>({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
  type: { type: String, required: true, index: true },
  entityType: { type: String, required: true, index: true },
  entityId: { type: String, index: true },
  entityName: { type: String },
  value: { type: Number, required: true },
  baseline: { type: Number },
  percentageChange: { type: Number },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  minSampleSize: { type: Number, required: true, default: 1 },
  sampleSize: { type: Number, required: true, default: 1 },
  evidence: { type: [signalEvidenceSchema], default: [] },
  detectedAt: { type: Date, required: true, default: Date.now, index: true },
  expiresAt: { type: Date, required: true, index: true },
  consumed: { type: Boolean, default: false, index: true },
  tags: { type: [String], default: [], index: true },
}, { timestamps: true });

// Compound indexes for common query patterns
signalSchema.index({ restaurantId: 1, type: 1, detectedAt: -1 });
signalSchema.index({ restaurantId: 1, entityType: 1, entityId: 1 });
signalSchema.index({ restaurantId: 1, consumed: 1, expiresAt: 1 });
signalSchema.index({ restaurantId: 1, tags: 1 });

export default mongoose.models.IntelligenceSignal || mongoose.model<ISignal>('IntelligenceSignal', signalSchema);
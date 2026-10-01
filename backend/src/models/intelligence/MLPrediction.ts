/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MLPrediction — Versioned store for ML predictions (audit Section 11 design).
 *
 * One collection serves all three models ('demand' | 'combo' | 'uplift').
 * Idempotent upserts on the natural key, TTL expiry for day-scoped
 * predictions, and mandatory model/feature versioning so consumers can always
 * tell WHERE a number came from.
 *
 *   { restaurantId, branchId?, modelName, modelVersion, predictionType,
 *     entityId, predictionFor, generatedAt, horizonDays?, prediction,
 *     confidence?, featuresVersion, source, expiresAt? }
 */

import mongoose, { Schema, Document } from 'mongoose';

export type MLPredictionModelName = 'demand' | 'combo' | 'uplift' | 'segment';
export type MLPredictionType = 'product_demand' | 'combo_ranking' | 'customer_uplift' | 'customer_segment';
export type MLPredictionSource = 'demand_model' | 'combo_model' | 'uplift_model' | 'segment_model' | 'internal_statistical';

export interface IMLPrediction extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId | null;
  modelName: MLPredictionModelName;
  modelVersion: string;
  predictionType: MLPredictionType;
  /**
   * Entity the prediction is about: productId for product_demand,
   * 'productIdA|productIdB' for combo_ranking, customerId for customer_uplift.
   * '-' when the prediction is restaurant-wide.
   */
  entityId: string;
  /** Date (YYYY-MM-DD), date for demand days, or generation date for others. */
  predictionFor: string;
  generatedAt: Date;
  horizonDays?: number;
  /** Value or ranked array — shape depends on predictionType. */
  prediction: unknown;
  confidence?: {
    level?: 'INSUFFICIENT_DATA' | 'LOW_CONFIDENCE' | 'MODERATE_CONFIDENCE' | 'HIGH_CONFIDENCE';
    score?: number;
    dataMode?: string;
  };
  featuresVersion?: string;
  source: MLPredictionSource;
  /** Day-scoped predictions expire; null = keep until replaced. */
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const MLPredictionSchema = new Schema<IMLPrediction>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    modelName: {
      type: String,
      required: true,
      enum: ['demand', 'combo', 'uplift', 'segment'],
      index: true,
    },
    modelVersion: { type: String, required: true },
    predictionType: {
      type: String,
      required: true,
      enum: ['product_demand', 'combo_ranking', 'customer_uplift', 'customer_segment'],
      index: true,
    },
    entityId: { type: String, required: true, default: '-' },
    predictionFor: { type: String, required: true },
    generatedAt: { type: Date, required: true },
    horizonDays: { type: Number },
    prediction: { type: Schema.Types.Mixed, required: true },
    confidence: {
      type: new Schema(
        {
          level: {
            type: String,
            enum: ['INSUFFICIENT_DATA', 'LOW_CONFIDENCE', 'MODERATE_CONFIDENCE', 'HIGH_CONFIDENCE'],
          },
          score: { type: Number },
          dataMode: { type: String },
        },
        { _id: false }
      ),
      default: undefined,
    },
    featuresVersion: { type: String, default: 'v1' },
    source: {
      type: String,
      required: true,
      enum: ['demand_model', 'combo_model', 'uplift_model', 'segment_model', 'internal_statistical'],
    },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Natural key — upsert target. One current prediction per
// (tenant, model, type, entity, for-date). E.g. the same product forecasted
// for the same day replaces itself instead of accumulating duplicates.
MLPredictionSchema.index(
  { restaurantId: 1, modelName: 1, predictionType: 1, entityId: 1, predictionFor: 1 },
  { unique: true }
);

// TTL sweeper for day-scoped predictions (Mongo deletes expired docs ~60s later).
MLPredictionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });

// Common query: latest forecasts for a tenant within a date range.
MLPredictionSchema.index({ restaurantId: 1, modelName: 1, predictionFor: -1 });

export default mongoose.models.MLPrediction || mongoose.model<IMLPrediction>('MLPrediction', MLPredictionSchema);

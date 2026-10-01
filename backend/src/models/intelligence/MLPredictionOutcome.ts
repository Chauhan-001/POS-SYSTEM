/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MLPredictionOutcome — durable production-evaluation history (audit Phase 8).
 *
 * Why this exists: `ml_predictions` is day-scoped with a 3-day TTL — perfect
 * for serving current forecasts, useless for long-horizon model monitoring.
 * Once Mongo TTL-deletes a prediction doc, its realized error is gone and the
 * retraining trigger engine can never see production performance.
 *
 * This collection keeps the SMALL durable record — one row per
 * (tenant, product, prediction date, model version):
 *
 *   prediction → actual (matched from real Bills/BillItems)
 *   → absoluteError / errorPct (divide-by-zero guarded)
 *   → evaluatedAt
 *
 * It deliberately does NOT retain raw predictions or full feature snapshots
 * (ml_predictions already expires those); only evaluation history survives.
 * Aggregates over this collection feed the Demand model's retraining trigger
 * engine via predictionFeedbackService.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IMLPredictionOutcome extends Document {
  restaurantId: mongoose.Types.ObjectId;
  /** Product the prediction was about ('-' for restaurant-wide rows). */
  productId: string;
  /** The predicted date (YYYY-MM-DD) — matches ml_predictions.predictionFor. */
  predictionFor: string;
  /** Provenance of the prediction that was evaluated. */
  modelName: string;
  modelVersion: string;
  predictionType: string;
  predictedValue: number;
  actualValue: number | null; // null = not yet observed (honest missing actual)
  absoluteError: number | null;
  /** (actual - predicted) sign convention: negative = model over-predicted. */
  signedError: number | null;
  /** absoluteError / actualValue — null when actual is 0 (never divide by zero). */
  errorPct: number | null;
  evaluatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MLPredictionOutcomeSchema = new Schema<IMLPredictionOutcome>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    productId: { type: String, required: true, default: '-' },
    predictionFor: { type: String, required: true },
    modelName: { type: String, required: true },
    modelVersion: { type: String, required: true },
    predictionType: { type: String, required: true },
    predictedValue: { type: Number, required: true },
    actualValue: { type: Number, default: null },
    absoluteError: { type: Number, default: null },
    signedError: { type: Number, default: null },
    errorPct: { type: Number, default: null },
    evaluatedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// One evaluation per (tenant, model, product, predicted date). Re-running the
// evaluation job replaces the row instead of accumulating duplicates.
MLPredictionOutcomeSchema.index(
  { restaurantId: 1, modelName: 1, predictionType: 1, productId: 1, predictionFor: 1 },
  { unique: true }
);
// Common monitoring query: recent outcomes for a tenant's demand model.
MLPredictionOutcomeSchema.index({ restaurantId: 1, modelName: 1, predictionFor: -1 });

export default mongoose.models.MLPredictionOutcome ||
  mongoose.model<IMLPredictionOutcome>('MLPredictionOutcome', MLPredictionOutcomeSchema);

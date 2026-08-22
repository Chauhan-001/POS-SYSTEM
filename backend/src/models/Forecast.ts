/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Forecast — Persisted demand forecast with confidence and explainability.
 */

import mongoose from 'mongoose';

export type ForecastEntityType = 'restaurant' | 'category' | 'product' | 'variant' | 'time_slot';

export type ForecastConfidenceLevel =
  | 'INSUFFICIENT_DATA'
  | 'LOW_CONFIDENCE'
  | 'MODERATE_CONFIDENCE'
  | 'HIGH_CONFIDENCE';

export interface IForecast extends mongoose.Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  entityType: ForecastEntityType;
  entityId: string;
  entityName: string;
  timeSlotStart: Date;
  timeSlotEnd: Date;
  horizonDays: number;
  predictedDemand: {
    units: { min: number; expected: number; max: number };
    revenue: { min: number; expected: number; max: number };
  };
  baseline: {
    units: number;
    revenue: number;
  };
  trend: {
    direction: 'increasing' | 'decreasing' | 'stable';
    percentage: number;
    confidence: number;
  };
  seasonality?: {
    detected: boolean;
    pattern: string;
    strength: number;
  };
  festivalEffect?: {
    festival: string;
    expectedLift: number;
    confidence: number;
  };
  confidence: ForecastConfidenceLevel;
  confidenceScore: number;
  dataSufficiency: {
    daysOfHistory: number;
    totalObservations: number;
    comparablePeriods: number;
  };
  factors: string[];
  explainability: {
    primaryDriver: string;
    supportingFactors: string[];
    caveats: string[];
  };
  modelVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

const predictedDemandSchema = new mongoose.Schema({
  units: {
    min: { type: Number, required: true },
    expected: { type: Number, required: true },
    max: { type: Number, required: true },
  },
  revenue: {
    min: { type: Number, required: true },
    expected: { type: Number, required: true },
    max: { type: Number, required: true },
  },
}, { _id: false });

const baselineSchema = new mongoose.Schema({
  units: { type: Number, required: true },
  revenue: { type: Number, required: true },
}, { _id: false });

const trendSchema = new mongoose.Schema({
  direction: { type: String, enum: ['increasing', 'decreasing', 'stable'], required: true },
  percentage: { type: Number, required: true },
  confidence: { type: Number, required: true, min: 0, max: 100 },
}, { _id: false });

const seasonalitySchema = new mongoose.Schema({
  detected: { type: Boolean, required: true },
  pattern: { type: String, required: true },
  strength: { type: Number, required: true, min: 0, max: 100 },
}, { _id: false });

const festivalEffectSchema = new mongoose.Schema({
  festival: { type: String, required: true },
  expectedLift: { type: Number, required: true },
  confidence: { type: Number, required: true, min: 0, max: 1 },
}, { _id: false });

const dataSufficiencySchema = new mongoose.Schema({
  daysOfHistory: { type: Number, required: true },
  totalObservations: { type: Number, required: true },
  comparablePeriods: { type: Number, required: true },
}, { _id: false });

const explainabilitySchema = new mongoose.Schema({
  primaryDriver: { type: String, required: true },
  supportingFactors: { type: [String], default: [] },
  caveats: { type: [String], default: [] },
}, { _id: false });

const forecastSchema = new mongoose.Schema<IForecast>({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
  entityType: {
    type: String,
    enum: ['restaurant', 'category', 'product', 'variant', 'time_slot'],
    required: true,
    index: true,
  },
  entityId: { type: String, required: true, index: true },
  entityName: { type: String, required: true },
  timeSlotStart: { type: Date, required: true, index: true },
  timeSlotEnd: { type: Date, required: true },
  horizonDays: { type: Number, required: true, default: 1 },
  predictedDemand: { type: predictedDemandSchema, required: true },
  baseline: { type: baselineSchema, required: true },
  trend: { type: trendSchema, required: true },
  seasonality: { type: seasonalitySchema, default: null },
  festivalEffect: { type: festivalEffectSchema, default: null },
  confidence: {
    type: String,
    enum: ['INSUFFICIENT_DATA', 'LOW_CONFIDENCE', 'MODERATE_CONFIDENCE', 'HIGH_CONFIDENCE'],
    required: true,
    index: true,
  },
  confidenceScore: { type: Number, required: true, min: 0, max: 100 },
  dataSufficiency: { type: dataSufficiencySchema, required: true },
  factors: { type: [String], default: [] },
  explainability: { type: explainabilitySchema, required: true },
  modelVersion: { type: String, required: true, default: 'statistical-v1' },
}, { timestamps: true });

forecastSchema.index({ restaurantId: 1, branchId: 1, entityType: 1, entityId: 1, timeSlotStart: 1 });
forecastSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.models.Forecast || mongoose.model<IForecast>('Forecast', forecastSchema);
export type { IForecast };
export { ForecastConfidenceLevel, ForecastEntityType };
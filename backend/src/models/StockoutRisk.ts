/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StockoutRisk — Predicted ingredient stockout risk from demand forecasts.
 */

import mongoose from 'mongoose';

export type StockoutRiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface IStockoutRisk extends mongoose.Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  ingredientId: mongoose.Types.ObjectId;
  ingredientName: string;
  unit: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  forecastPeriodDays: number;
  predictedConsumption: number;
  dailyConsumptionRate: number;
  safetyStock: number;
  riskLevel: StockoutRiskLevel;
  timeToStockoutHours: number | null;
  daysOfStock: number;
  contributingForecasts: Array<{
    forecastId: mongoose.Types.ObjectId;
    entityType: string;
    entityId: string;
    entityName: string;
    predictedUnits: number;
    recipeQuantity: number;
    consumption: number;
  }>;
  recommendedActions: string[];
  expiryDate?: Date;
  expiryRisk?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  modelVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

const contributingForecastSchema = new mongoose.Schema({
  forecastId: { type: mongoose.Schema.Types.ObjectId, ref: 'Forecast', required: true },
  entityType: { type: String, required: true },
  entityId: { type: String, required: true },
  entityName: { type: String, required: true },
  predictedUnits: { type: Number, required: true },
  recipeQuantity: { type: Number, required: true },
  consumption: { type: Number, required: true },
}, { _id: false });

const stockoutRiskSchema = new mongoose.Schema<IStockoutRisk>({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
  ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  ingredientName: { type: String, required: true },
  unit: { type: String, required: true },
  currentStock: { type: Number, required: true, min: 0 },
  minStock: { type: Number, required: true, default: 0, min: 0 },
  maxStock: { type: Number, required: true, default: 0, min: 0 },
  forecastPeriodDays: { type: Number, required: true, default: 7 },
  predictedConsumption: { type: Number, required: true, min: 0 },
  dailyConsumptionRate: { type: Number, required: true, min: 0 },
  safetyStock: { type: Number, required: true, min: 0 },
  riskLevel: {
    type: String,
    enum: ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    required: true,
    index: true,
  },
  timeToStockoutHours: { type: Number, default: null },
  daysOfStock: { type: Number, default: 0 },
  contributingForecasts: { type: [contributingForecastSchema], default: [] },
  recommendedActions: { type: [String], default: [] },
  expiryDate: { type: Date, default: null },
  expiryRisk: {
    type: String,
    enum: ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'NONE',
  },
  modelVersion: { type: String, required: true, default: 'statistical-v1' },
}, { timestamps: true });

stockoutRiskSchema.index({ restaurantId: 1, branchId: 1, ingredientId: 1, createdAt: -1 });
stockoutRiskSchema.index({ riskLevel: 1, timeToStockoutHours: 1 });
stockoutRiskSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export default mongoose.models.StockoutRisk || mongoose.model<IStockoutRisk>('StockoutRisk', stockoutRiskSchema);
export type { IStockoutRisk };
export { StockoutRiskLevel };
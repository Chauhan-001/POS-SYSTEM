/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PromotionElasticity — Learned price elasticity from historical promotion data.
 */

import mongoose from 'mongoose';

export interface IElasticityPoint {
  discountPercent: number;
  demandDeltaPercent: number;
  sampleSize: number;
  confidence: number;
}

export interface IPromotionElasticity extends mongoose.Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  productName: string;
  category: string;
  elasticityPoints: IElasticityPoint[];
  estimatedElasticity: number;
  diminishingReturns: boolean;
  diminishingReturnsAt?: number;
  modelFit: {
    rSquared: number;
    method: 'linear' | 'logarithmic' | 'piecewise';
  };
  dataQuality: {
    totalPromotionsAnalyzed: number;
    dateRange: { start: Date; end: Date };
    minSampleSize: number;
  };
  modelVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

const elasticityPointSchema = new mongoose.Schema({
  discountPercent: { type: Number, required: true },
  demandDeltaPercent: { type: Number, required: true },
  sampleSize: { type: Number, required: true },
  confidence: { type: Number, required: true, min: 0, max: 1 },
}, { _id: false });

const modelFitSchema = new mongoose.Schema({
  rSquared: { type: Number, required: true, min: 0, max: 1 },
  method: { type: String, enum: ['linear', 'logarithmic', 'piecewise'], required: true },
}, { _id: false });

const dataQualitySchema = new mongoose.Schema({
  totalPromotionsAnalyzed: { type: Number, required: true },
  dateRange: {
    start: { type: Date, required: true },
    end: { type: Date, required: true },
  },
  minSampleSize: { type: Number, required: true },
}, { _id: false });

const promotionElasticitySchema = new mongoose.Schema<IPromotionElasticity>({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  productName: { type: String, required: true },
  category: { type: String, required: true },
  elasticityPoints: { type: [elasticityPointSchema], default: [] },
  estimatedElasticity: { type: Number, required: true },
  diminishingReturns: { type: Boolean, required: true, default: false },
  diminishingReturnsAt: { type: Number, default: null },
  modelFit: { type: modelFitSchema, required: true },
  dataQuality: { type: dataQualitySchema, required: true },
  modelVersion: { type: String, required: true, default: 'elasticity-v1' },
}, { timestamps: true });

promotionElasticitySchema.index({ restaurantId: 1, branchId: 1, productId: 1 }, { unique: true });
promotionElasticitySchema.index({ restaurantId: 1, category: 1 });

export default mongoose.models.PromotionElasticity || mongoose.model<IPromotionElasticity>('PromotionElasticity', promotionElasticitySchema);
export type { IPromotionElasticity, IElasticityPoint };
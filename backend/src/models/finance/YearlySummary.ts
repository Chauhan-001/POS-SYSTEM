/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * YearlySummary Model — Materialized yearly sales snapshot (Phase 1.8).
 *
 * Built from MonthlySummary rows (or aggregated bills on rebuild). One
 * document per restaurant × branch × year (YYYY). Powers yearly P&L and
 * YoY comparisons without scanning bills.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IYearlySummary extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  /** Year key "YYYY". */
  year: string;
  totalRevenue: number;
  totalOrders: number;
  totalItemsSold: number;
  totalDiscount: number;
  totalGst: number;
  averageOrderValue: number;
  cashSales: number;
  nonCashSales: number;
  pointsEarned: number;
  pointsRedeemed: number;
  months: Array<{ month: string; revenue: number; orders: number }>;
  createdAt: Date;
  updatedAt: Date;
}

const YearlySummarySchema = new Schema<IYearlySummary>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    year: { type: String, required: true, trim: true, index: true },
    totalRevenue: { type: Number, default: 0, min: 0 },
    totalOrders: { type: Number, default: 0, min: 0 },
    totalItemsSold: { type: Number, default: 0, min: 0 },
    totalDiscount: { type: Number, default: 0, min: 0 },
    totalGst: { type: Number, default: 0, min: 0 },
    averageOrderValue: { type: Number, default: 0, min: 0 },
    cashSales: { type: Number, default: 0, min: 0 },
    nonCashSales: { type: Number, default: 0, min: 0 },
    pointsEarned: { type: Number, default: 0, min: 0 },
    pointsRedeemed: { type: Number, default: 0, min: 0 },
    months: [{
      month: { type: String, required: true },
      revenue: { type: Number, default: 0 },
      orders: { type: Number, default: 0 },
    }],
  },
  { timestamps: true }
);

YearlySummarySchema.index({ restaurantId: 1, year: -1, branchId: 1 }, { unique: true });

export default mongoose.model<IYearlySummary>('YearlySummary', YearlySummarySchema);

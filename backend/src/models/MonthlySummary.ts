/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MonthlySummary Model — Materialized monthly sales snapshot (Phase 1.8).
 *
 * Built from DailySummary rows (or aggregated bills on rebuild) to provide
 * fast month-over-month reporting without scanning the bill collection.
 * One document per restaurant × branch × month (YYYY-MM).
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IMonthlySummary extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  /** Month key "YYYY-MM" — same convention as DailySummary.date slices. */
  month: string;
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
  categoryBreakdown: Array<{ category: string; qty: number; revenue: number }>;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
  createdAt: Date;
  updatedAt: Date;
}

const MonthlySummarySchema = new Schema<IMonthlySummary>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    month: { type: String, required: true, trim: true, index: true },
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
    categoryBreakdown: [{
      category: { type: String, required: true },
      qty: { type: Number, default: 0 },
      revenue: { type: Number, default: 0 },
    }],
    topItems: [{
      name: { type: String, required: true },
      qty: { type: Number, default: 0 },
      revenue: { type: Number, default: 0 },
    }],
  },
  { timestamps: true }
);

MonthlySummarySchema.index({ restaurantId: 1, month: -1, branchId: 1 }, { unique: true });

export default mongoose.model<IMonthlySummary>('MonthlySummary', MonthlySummarySchema);

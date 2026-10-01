/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DailySummary Model — Daily sales snapshot for analytics and dashboards.
 * Computed at end of day (or on demand) to provide fast KPI access
 * without aggregating bills every time. Also serves as input data
 * for future AI/ML modules (trend prediction, demand forecasting).
 *
 * This collection is written once per day per branch and is append-only.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IDailySummary extends Document {
  date: string;
  /** Owning restaurant (Phase 1.8) — enables tenant-scoped reads of the previously write-only snapshot. */
  restaurantId?: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  totalRevenue: number;
  totalOrders: number;
  totalItemsSold: number;
  totalDiscount: number;
  totalGst: number;
  averageOrderValue: number;
  paymentBreakdown: Array<{ method: string; amount: number; count: number }>;
  categoryBreakdown: Array<{ category: string; qty: number; revenue: number }>;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
  cashierPerformance: Array<{ name: string; orders: number; revenue: number }>;
  createdAt: Date;
  updatedAt: Date;
}

const DailySummarySchema = new Schema<IDailySummary>(
  {
    date: { type: String, required: true, trim: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    totalRevenue: { type: Number, default: 0, min: 0 },
    totalOrders: { type: Number, default: 0, min: 0 },
    totalItemsSold: { type: Number, default: 0, min: 0 },
    totalDiscount: { type: Number, default: 0, min: 0 },
    totalGst: { type: Number, default: 0, min: 0 },
    averageOrderValue: { type: Number, default: 0, min: 0 },
    paymentBreakdown: [{
      method: { type: String, required: true },
      amount: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    }],
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
    cashierPerformance: [{
      name: { type: String, required: true },
      orders: { type: Number, default: 0 },
      revenue: { type: Number, default: 0 },
    }],
  },
  { timestamps: true }
);

// Restaurant-scoped unique index: one summary row per restaurant per date per
// branch. The restaurantId scope is required because branchless restaurants
// write branchId: null — without it, a second restaurant on the same date would
// collide with the first (E11000) and silently lose its daily summary.
DailySummarySchema.index({ restaurantId: 1, date: -1, branchId: 1 }, { unique: true });

export default mongoose.model<IDailySummary>('DailySummary', DailySummarySchema);

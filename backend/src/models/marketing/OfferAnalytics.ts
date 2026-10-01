/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer Analytics Model — Tracks per-offer performance metrics.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IOfferAnalytics extends Document {
  offerId: mongoose.Types.ObjectId;
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  customersTargeted: number;
  customersReached: number;
  opened: number;
  /** Number of successful redemptions (applied → billed). */
  redeemed: number;
  /** Sales subtotal (before discount) on bills where the offer applied. */
  revenueGenerated: number;
  /** Total discount granted across those redemptions. */
  discountGiven: number;
  /** Distinct customers who redeemed. */
  uniqueCustomers: number;
  /** Distinct repeat customers (redeemed more than once in the window). */
  repeatCustomers: number;
  /** Average order value of redemption bills. */
  averageOrderValue: number;
  repeatVisits: number;
  averageBillIncrease: number;
  roi: number;
  campaignCost: number;
  snapshotDate: string;
  /** Idempotency ledger — bill identifiers already counted in this snapshot. */
  billIds?: string[];
  /** Best-effort distinct-customer keys ("cust:<id>" / "ph:<phone>"). */
  customerKeys?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const OfferAnalyticsSchema = new Schema<IOfferAnalytics>(
  {
    offerId: { type: Schema.Types.ObjectId, ref: 'Offer', required: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    customersTargeted: { type: Number, default: 0, min: 0 },
    customersReached: { type: Number, default: 0, min: 0 },
    opened: { type: Number, default: 0, min: 0 },
    redeemed: { type: Number, default: 0, min: 0 },
    revenueGenerated: { type: Number, default: 0, min: 0 },
    discountGiven: { type: Number, default: 0, min: 0 },
    uniqueCustomers: { type: Number, default: 0, min: 0 },
    repeatCustomers: { type: Number, default: 0, min: 0 },
    averageOrderValue: { type: Number, default: 0, min: 0 },
    repeatVisits: { type: Number, default: 0, min: 0 },
    averageBillIncrease: { type: Number, default: 0 },
    roi: { type: Number, default: 0 },
    campaignCost: { type: Number, default: 0, min: 0 },
    snapshotDate: { type: String, required: true, trim: true },
    billIds: { type: [String], default: [] },
    customerKeys: { type: [String], default: [] },
  },
  { timestamps: true }
);

OfferAnalyticsSchema.index({ offerId: 1, snapshotDate: -1 });
OfferAnalyticsSchema.index({ restaurantId: 1, snapshotDate: -1 });
OfferAnalyticsSchema.index({ restaurantId: 1, offerId: 1, snapshotDate: -1 });
OfferAnalyticsSchema.index({ restaurantId: 1, branchId: 1, snapshotDate: -1 });
OfferAnalyticsSchema.index({ restaurantId: 1, offerId: 1, branchId: 1, snapshotDate: -1 });

export default mongoose.model<IOfferAnalytics>('OfferAnalytics', OfferAnalyticsSchema);

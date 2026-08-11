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
  customersTargeted: number;
  customersReached: number;
  opened: number;
  redeemed: number;
  revenueGenerated: number;
  repeatVisits: number;
  averageBillIncrease: number;
  roi: number;
  campaignCost: number;
  snapshotDate: string;
  createdAt: Date;
  updatedAt: Date;
}

const OfferAnalyticsSchema = new Schema<IOfferAnalytics>(
  {
    offerId: { type: Schema.Types.ObjectId, ref: 'Offer', required: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    customersTargeted: { type: Number, default: 0, min: 0 },
    customersReached: { type: Number, default: 0, min: 0 },
    opened: { type: Number, default: 0, min: 0 },
    redeemed: { type: Number, default: 0, min: 0 },
    revenueGenerated: { type: Number, default: 0, min: 0 },
    repeatVisits: { type: Number, default: 0, min: 0 },
    averageBillIncrease: { type: Number, default: 0 },
    roi: { type: Number, default: 0 },
    campaignCost: { type: Number, default: 0, min: 0 },
    snapshotDate: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

OfferAnalyticsSchema.index({ offerId: 1, snapshotDate: -1 });
OfferAnalyticsSchema.index({ restaurantId: 1, snapshotDate: -1 });
OfferAnalyticsSchema.index({ restaurantId: 1, offerId: 1, snapshotDate: -1 });

export default mongoose.model<IOfferAnalytics>('OfferAnalytics', OfferAnalyticsSchema);

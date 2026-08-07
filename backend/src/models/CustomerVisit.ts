/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CustomerVisit Model — Records each customer visit for loyalty analytics.
 * Separate from Bill so visit tracking is independent of payment status.
 * Used for visit-based milestone rewards and customer engagement reports.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomerVisit extends Document {
  restaurantId?: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  visitDate: string;
  billAmount: number;
  pointsEarned: number;
  pointsRedeemed: number;
  redeemedRewardTitle?: string;
  createdAt: Date;
}

const CustomerVisitSchema = new Schema<ICustomerVisit>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    visitDate: { type: String, required: true, trim: true, index: true },
    billAmount: { type: Number, default: 0, min: 0 },
    pointsEarned: { type: Number, default: 0, min: 0 },
    pointsRedeemed: { type: Number, default: 0, min: 0 },
    redeemedRewardTitle: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

CustomerVisitSchema.index({ customerId: 1, visitDate: -1 });

export default mongoose.model<ICustomerVisit>('CustomerVisit', CustomerVisitSchema);

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TimelineEvent Model — Individual events in an order's lifecycle.
 * Provides a full audit trail of every action taken on an order.
 * Used by the Order Timeline modal for operational visibility.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ITimelineEvent extends Document {
  orderId: mongoose.Types.ObjectId;
  type: string;
  description: string;
  actor?: string;
  createdAt: Date;
}

const TimelineEventSchema = new Schema<ITimelineEvent>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    type: { type: String, required: true, trim: true, index: true },
    description: { type: String, required: true, trim: true },
    actor: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

TimelineEventSchema.index({ orderId: 1, createdAt: -1 });

export default mongoose.model<ITimelineEvent>('TimelineEvent', TimelineEventSchema);

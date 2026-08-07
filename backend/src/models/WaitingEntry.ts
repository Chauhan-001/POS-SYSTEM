/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WaitingEntry Model — Walk-in customer waitlist management.
 * Tracks estimated wait times and party size for queue management.
 * When a table becomes available, waiting customers are seated in order.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IWaitingEntry extends Document {
  customerName: string;
  customerPhone: string;
  guestCount: number;
  estimatedWaitMinutes: number;
  status: 'Waiting' | 'Seated' | 'Cancelled';
  branchId?: mongoose.Types.ObjectId;
  notes?: string;
  partyType?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WaitingEntrySchema = new Schema<IWaitingEntry>(
  {
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, required: true, trim: true },
    guestCount: { type: Number, required: true, min: 1 },
    estimatedWaitMinutes: { type: Number, default: 15, min: 0 },
    status: { type: String, default: 'Waiting', enum: ['Waiting', 'Seated', 'Cancelled'] },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    notes: { type: String, trim: true },
    partyType: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

WaitingEntrySchema.index({ status: 1, createdAt: 1 });

export default mongoose.model<IWaitingEntry>('WaitingEntry', WaitingEntrySchema);

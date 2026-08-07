/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TakeawayOrder Model — Quick takeaway order management.
 * Tracks takeaway orders separately from dine-in orders for dedicated UI.
 * Uses a simple status flow: Preparing → Ready → Collected → Completed.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ITakeawayOrder extends Document {
  orderNumber: number;
  customerName: string;
  customerPhone?: string;
  status: 'Preparing' | 'Ready' | 'Collected' | 'Completed';
  amount: number;
  paymentStatus: 'Pending' | 'Paid';
  branchId?: mongoose.Types.ObjectId;
  items: Array<{
    itemName: string;
    quantity: number;
    price: number;
    variantName?: string;
  }>;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TakeawayOrderSchema = new Schema<ITakeawayOrder>(
  {
    orderNumber: { type: Number, required: true, index: true },
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, trim: true },
    status: { type: String, default: 'Preparing', enum: ['Preparing', 'Ready', 'Collected', 'Completed'], index: true },
    amount: { type: Number, required: true, min: 0 },
    paymentStatus: { type: String, default: 'Pending', enum: ['Pending', 'Paid'] },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    items: [{
      itemName: { type: String, required: true },
      quantity: { type: Number, required: true, min: 1 },
      price: { type: Number, required: true, min: 0 },
      variantName: { type: String, trim: true },
    }],
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

TakeawayOrderSchema.index({ branchId: 1, status: 1 });

export default mongoose.model<ITakeawayOrder>('TakeawayOrder', TakeawayOrderSchema);

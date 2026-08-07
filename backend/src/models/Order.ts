/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Order Model — Manages the full order lifecycle from creation to completion.
 * Supports dine-in, takeaway, delivery, and online platform orders.
 * Related records (items, KOTs, timeline) are in separate collections.
 * Order status flows: New → Accepted → Preparing → Ready → Served → Paid → Closed
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IOrder extends Document {
  orderNumber: number;
  type: string;
  status: string;
  tableId?: string;
  tableNumber?: number;
  platform?: string;
  branchId?: mongoose.Types.ObjectId;
  customerPhone?: string;
  customerName?: string;
  waiterId?: string;
  waiterName?: string;
  guestCount?: number;
  specialInstructions?: string;
  deliveryAddress?: string;
  deliveryEta?: string;
  subtotal: number;
  discount: number;
  gst: number;
  grandTotal: number;
  paymentMethod?: string;
  paidAt?: Date;
  closedAt?: Date;
  appliedRewardTitle?: string;
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: Number, required: true, index: true },
    type: { type: String, required: true, trim: true, index: true },
    status: { type: String, required: true, default: 'New', index: true },
    tableId: { type: String, trim: true },
    tableNumber: { type: Number },
    platform: { type: String, trim: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    customerPhone: { type: String, trim: true },
    customerName: { type: String, trim: true },
    waiterId: { type: String, trim: true },
    waiterName: { type: String, trim: true },
    guestCount: { type: Number, min: 1 },
    specialInstructions: { type: String, trim: true },
    deliveryAddress: { type: String, trim: true },
    deliveryEta: { type: String, trim: true },
    subtotal: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    gst: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, default: 0, min: 0 },
    paymentMethod: { type: String, trim: true },
    paidAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    appliedRewardTitle: { type: String, trim: true },
    loyaltyPointsEarned: { type: Number, default: 0, min: 0 },
    loyaltyPointsRedeemed: { type: Number, default: 0, min: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ branchId: 1, createdAt: -1 });
OrderSchema.index({ branchId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ tableId: 1, status: 1 });
OrderSchema.index({ type: 1, status: 1 });

export default mongoose.model<IOrder>('Order', OrderSchema);

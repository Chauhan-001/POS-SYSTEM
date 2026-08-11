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
  /** QR ordering context: TABLE / CAR / PICKUP (customer site). */
  mode?: 'TABLE' | 'CAR' | 'PICKUP' | 'DELIVERY' | 'TAKEAWAY' | null;
  /** Drive-in parking slot / car plate captured at the customer site. */
  parkingSlot?: string | null;
  carPlate?: string | null;
  /** Optional gratuity included in grandTotal (customer site). */
  tip?: number;
  /** Tenant stamp (public/online orders). Null for legacy POS orders. */
  restaurantId?: mongoose.Types.ObjectId | null;
  /** Public-order idempotency key (online ordering) — unique per restaurant. */
  clientRef?: string;
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
  // ── Adjustment financial snapshots (online ordering) ───────────
  /** Total at creation (never overwritten by adjustments). */
  originalGrandTotal?: number;
  /** Current total after adjustments (remove/replace/cancel). */
  adjustedGrandTotal?: number;
  /** Cumulative refunds already applied to this order. */
  amountRefunded?: number;
  /** Outstanding additional payment required (costlier replacement). */
  amountDueAdditional?: number;
  adjustmentStatus?: 'NONE' | 'ADJUSTED' | 'CANCELLED';
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
  mode: { type: String, enum: ['TABLE', 'CAR', 'PICKUP', 'DELIVERY', 'TAKEAWAY'], default: null },
  parkingSlot: { type: String, trim: true, default: null },
  carPlate: { type: String, trim: true, default: null },
  tip: { type: Number, default: 0, min: 0 },
  restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
  clientRef: { type: String, trim: true, maxlength: 80 },
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
    originalGrandTotal: { type: Number, min: 0 },
    adjustedGrandTotal: { type: Number, min: 0 },
    amountRefunded: { type: Number, default: 0, min: 0 },
    amountDueAdditional: { type: Number, default: 0, min: 0 },
    adjustmentStatus: { type: String, enum: ['NONE', 'ADJUSTED', 'CANCELLED'], default: 'NONE' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ branchId: 1, createdAt: -1 });
// Public-order replay idempotency (mirrors Bill.clientRef partial unique index).
OrderSchema.index(
  { restaurantId: 1, clientRef: 1 },
  { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } }
);
OrderSchema.index({ restaurantId: 1, createdAt: -1 });
OrderSchema.index({ branchId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ tableId: 1, status: 1 });
OrderSchema.index({ type: 1, status: 1 });

export default mongoose.model<IOrder>('Order', OrderSchema);

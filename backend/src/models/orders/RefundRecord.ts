/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RefundRecord Model — append-only ledger of every refund derived from an
 * order adjustment. Drives the refund state machine:
 *
 *   PENDING → PROCESSING → SUCCEEDED  (provider/cashier confirmed)
 *                         → FAILED     (never silently retried/claimed)
 *
 * Rules:
 *   - A refund is NEVER reported as SUCCEEDED unless the payment system
 *     (gateway response, or BillService.refundBill for the cash ledger)
 *     actually confirms it.
 *   - `refundId` is a unique idempotency key so duplicate requests can never
 *     double-refund (same pattern as Bill.clientRef).
 *   - `gateway: 'ledger'` = POS cash-ledger refund through BillService.
 *     `gateway: 'razorpay'` = provider-mediated refund (future online payments).
 */

import mongoose, { Schema, Document } from 'mongoose';

export type RefundStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
export type RefundGateway = 'ledger' | 'razorpay' | 'manual';

export interface IRefundRecord extends Document {
  /** Unique idempotency key (client-generated, e.g. rfd_<uuid>). */
  refundId: string;
  orderId: mongoose.Types.ObjectId;
  /** Bill refunded through BillService.refundBill (cash ledger), if any. */
  billId?: mongoose.Types.ObjectId | null;
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId | null;
  amount: number;
  status: RefundStatus;
  gateway: RefundGateway;
  /** Provider payment id the refund was issued against (Razorpay payment_id). */
  paymentRef?: string;
  /** Provider-confirmed refund id (Razorpay refund_id). */
  providerRefundId?: string;
  reason: string;
  performedBy: string;
  performedById?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RefundRecordSchema = new Schema<IRefundRecord>(
  {
    refundId: { type: String, required: true, unique: true, trim: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', default: null, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    gateway: { type: String, enum: ['ledger', 'razorpay', 'manual'], default: 'ledger' },
    paymentRef: { type: String, trim: true },
    providerRefundId: { type: String, trim: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    performedBy: { type: String, required: true, trim: true },
    performedById: { type: String, trim: true },
    error: { type: String, trim: true },
  },
  { timestamps: true }
);

RefundRecordSchema.index({ orderId: 1, createdAt: -1 });
RefundRecordSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });

export default mongoose.model<IRefundRecord>('RefundRecord', RefundRecordSchema);

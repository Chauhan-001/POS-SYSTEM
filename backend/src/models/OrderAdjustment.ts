/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OrderAdjustment Model — append-only record of every unavailable-item
 * adjustment applied to an order (REMOVE / REPLACE / CANCEL).
 *
 * Purpose:
 *   - Preserve financial history: the original order total is NEVER
 *     overwritten. `originalTotal` / `newTotal` / `delta` / `refundRequired`
 *     / `additionalDue` are all derived server-side from the actual line
 *     snapshots (price × quantity at sale time).
 *   - Idempotency: `adjustmentId` is a unique key supplied by the caller so a
 *     replayed/duplicate request can never apply the same adjustment twice.
 *
 * Items are snapshots (productName + price) so history survives later menu
 * edits — mirroring the BillItem historical-snapshot convention.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type OrderAdjustmentAction = 'REMOVE' | 'REPLACE' | 'CANCEL';

export interface AdjustmentLine {
  orderItemId?: string;
  productId?: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface IOrderAdjustment extends Document {
  /** Unique idempotency key (client-generated, e.g. adj_<uuid>). */
  adjustmentId: string;
  orderId: mongoose.Types.ObjectId;
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId | null;
  action: OrderAdjustmentAction;
  /** Full snapshot of the order lines before the adjustment. */
  itemsBefore: AdjustmentLine[];
  /** Snapshot of the order lines after the adjustment. */
  itemsAfter: AdjustmentLine[];
  originalTotal: number;
  newTotal: number;
  /** newTotal − originalTotal (positive = additional due, negative = refund). */
  delta: number;
  refundRequired: number;
  additionalDue: number;
  reason: string;
  /** When true, the affected product is also marked UNAVAILABLE for new online orders. */
  markUnavailable: boolean;
  performedBy: string;
  performedById?: string;
  createdAt: Date;
}

const AdjustmentLineSchema = new Schema<AdjustmentLine>(
  {
    orderItemId: { type: String, trim: true },
    productId: { type: String, trim: true },
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const OrderAdjustmentSchema = new Schema<IOrderAdjustment>(
  {
    adjustmentId: { type: String, required: true, unique: true, trim: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    action: { type: String, enum: ['REMOVE', 'REPLACE', 'CANCEL'], required: true },
    itemsBefore: { type: [AdjustmentLineSchema], default: [] },
    itemsAfter: { type: [AdjustmentLineSchema], default: [] },
    originalTotal: { type: Number, required: true, min: 0 },
    newTotal: { type: Number, required: true, min: 0 },
    delta: { type: Number, default: 0 },
    refundRequired: { type: Number, default: 0, min: 0 },
    additionalDue: { type: Number, default: 0, min: 0 },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    markUnavailable: { type: Boolean, default: false },
    performedBy: { type: String, required: true, trim: true },
    performedById: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

OrderAdjustmentSchema.index({ orderId: 1, createdAt: -1 });
OrderAdjustmentSchema.index({ restaurantId: 1, createdAt: -1 });

export default mongoose.model<IOrderAdjustment>('OrderAdjustment', OrderAdjustmentSchema);

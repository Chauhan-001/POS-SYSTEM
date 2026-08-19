/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OrderItem Model — Line items belonging to an active order.
 * Separate from Order to support clean SQL migration.
 * Contains product snapshot data (name, price) at the time of ordering.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderItem extends Document {
  orderId: mongoose.Types.ObjectId;
  productId?: string;
  productName: string;
  variantName?: string;
  quantity: number;
  price: number;
  notes?: string;
  isFree: boolean;
  kotPrinted: boolean;
  /** Phase 4 — configured selections snapshot (variants/modifiers/add-ons).
   *  The order never depends on today's menu: what the customer picked is
   *  preserved exactly as validated at order time. */
  configurationSnapshot?: { selections: Array<{ groupId: string; optionIds: string[]; quantities?: Record<string, number> }> };
  /** Human-readable configured line ("Large • Cheese Burst") for KOT/display. */
  configSummary?: string;
  /** Immutable price evidence (base + deltas + versions), same as BillItem. */
  pricingSnapshot?: Record<string, unknown>;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    productId: { type: String, trim: true },
    productName: { type: String, required: true, trim: true },
    variantName: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true },
    isFree: { type: Boolean, default: false },
    kotPrinted: { type: Boolean, default: false },
    configurationSnapshot: {
      type: {
        selections: [
          {
            groupId: { type: String, trim: true },
            optionIds: [{ type: String, trim: true }],
            quantities: { type: Map, of: Number },
          },
        ],
      },
      default: undefined,
    },
    configSummary: { type: String, trim: true, maxlength: 500 },
    pricingSnapshot: { type: Schema.Types.Mixed, default: undefined },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

OrderItemSchema.index({ orderId: 1 });

export default mongoose.model<IOrderItem>('OrderItem', OrderItemSchema);

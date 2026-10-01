/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BillItem Model — Line items belonging to a bill.
 * Stores historical snapshots (itemName, priceAtSale, gstRateAtSale, discountAtSale)
 * so that bills remain accurate even if the menu changes later.
 * Never depend on current Product values for historical bills.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IBillItem extends Document {
  billId: mongoose.Types.ObjectId;
  menuItemId?: string;
  itemName: string;
  priceAtSale: number;
  quantity: number;
  gstRateAtSale: number;
  discountAtSale: number;
  notes?: string;
  variantName?: string;
  isFree: boolean;
  /** Phase 3 — configured-product selection (groupId → option ids + qty). */
  configurationSnapshot?: {
    selections: Array<{
      groupId: string;
      optionIds: string[];
      quantities?: Record<string, number>;
    }>;
  };
  /** Phase 3 — immutable pricing snapshot used at the time of sale. */
  pricingSnapshot?: {
    basePrice: number;
    variantDelta: number;
    modifierDelta: number;
    addonDelta: number;
    grossItemPrice: number;
    lineTotal: number;
    configVersion: number;
    pricingVersion: number;
    origin: 'online' | 'offline';
  };
  /** Human-readable selection summary for receipts ("Large • Cheese Burst"). */
  configSummary?: string;
  createdAt: Date;
}

const BillItemSchema = new Schema<IBillItem>(
  {
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', required: true },
    menuItemId: { type: String, trim: true },
    itemName: { type: String, required: true, trim: true },
    priceAtSale: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    gstRateAtSale: { type: Number, default: 5, min: 0, max: 100 },
    discountAtSale: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true },
    variantName: { type: String, trim: true },
    isFree: { type: Boolean, default: false },
    configurationSnapshot: {
      type: new Schema({
        selections: {
          type: [new Schema({
            groupId: { type: String, trim: true },
            optionIds: [{ type: String, trim: true }],
            quantities: { type: Map, of: Number, default: undefined },
          }, { _id: false })],
          default: undefined,
        },
      }, { _id: false }),
      default: undefined,
    },
    pricingSnapshot: {
      type: new Schema({
        basePrice: { type: Number, default: 0, min: 0 },
        variantDelta: { type: Number, default: 0, min: 0 },
        modifierDelta: { type: Number, default: 0, min: 0 },
        addonDelta: { type: Number, default: 0, min: 0 },
        grossItemPrice: { type: Number, default: 0, min: 0 },
        lineTotal: { type: Number, default: 0, min: 0 },
        configVersion: { type: Number, default: 0, min: 0 },
        pricingVersion: { type: Number, default: 0, min: 0 },
        origin: { type: String, enum: ['online', 'offline'], default: 'online' },
      }, { _id: false }),
      default: undefined,
    },
    configSummary: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

BillItemSchema.index({ billId: 1 });

export default mongoose.model<IBillItem>('BillItem', BillItemSchema);

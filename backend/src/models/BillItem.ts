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
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

BillItemSchema.index({ billId: 1 });

export default mongoose.model<IBillItem>('BillItem', BillItemSchema);

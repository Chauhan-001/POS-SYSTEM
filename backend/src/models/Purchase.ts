/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Purchase Model — Inventory purchase history (supplier stock-in records).
 * Each purchase records a stock-in event for an ingredient/item from a
 * supplier, with cost + quantity so the Inventory module can show real
 * purchase history and stock movement instead of only live stock levels.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IPurchase extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  supplier: string;
  item: string;
  category?: string;
  quantity: number;
  unit: string;
  price: number;      // per-unit cost
  total: number;      // quantity * price
  date: string;       // local date string (YYYY-MM-DD) for filtering/reports
  status: 'completed' | 'pending' | 'cancelled';
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PurchaseSchema = new Schema<IPurchase>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    supplier: { type: String, required: true, trim: true },
    item: { type: String, required: true, trim: true },
    category: { type: String, default: '', trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, default: 'kg', trim: true },
    price: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    date: { type: String, required: true, trim: true, index: true },
    status: { type: String, enum: ['completed', 'pending', 'cancelled'], default: 'completed' },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

PurchaseSchema.index({ restaurantId: 1, date: -1 });
PurchaseSchema.index({ restaurantId: 1, supplier: 1 });

export default mongoose.model<IPurchase>('Purchase', PurchaseSchema);

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OrderCounter Model — Atomic sequence counter for order numbers.
 * Uses MongoDB's findOneAndUpdate with $inc for thread-safe increments.
 * This prevents duplicate order numbers across multiple POS terminals.
 *
 * Mirrors the InvoiceCounter pattern. On first access the counter is seeded
 * from the highest existing order number so new orders never collide with
 * already-created orders.
 *
 * NOTE: numbering is deliberately ONE shared restaurant-wide series (dine-in,
 * takeaway and website orders draw from the same counter) so order numbers
 * never repeat across terminals or branches. The `branchId` field is legacy
 * and unused — do NOT reintroduce per-branch counters: a per-branch counter
 * seeded from the global max collides with the base series (duplicate order
 * numbers). The branch is stored on the Order itself for routing/filtering.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderCounter extends Document {
  name: string;       // e.g. 'order' or 'order_branch_xxx'
  sequence: number;   // current counter value
  branchId?: string;  // optional per-branch sequence
  createdAt: Date;
  updatedAt: Date;
}

const OrderCounterSchema = new Schema<IOrderCounter>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    sequence: { type: Number, required: true, default: 1000 },
    branchId: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model<IOrderCounter>('OrderCounter', OrderCounterSchema);

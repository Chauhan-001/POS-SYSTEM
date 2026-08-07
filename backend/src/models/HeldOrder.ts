/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HeldOrder Model — Suspended bill snapshots.
 * When a cashier holds a cart, the POS pushes the cart snapshot here so it can
 * be resumed on any terminal. The snapshot is opaque (mixed items + customer),
 * so the schema intentionally does not validate the nested cart structure.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IHeldOrder extends Document {
  clientId: string;
  orderId?: string;
  customer?: any;
  items: any[];
  type: string;
  timestamp?: string;
  branchId?: mongoose.Types.ObjectId;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const HeldOrderSchema = new Schema<IHeldOrder>(
  {
    clientId: { type: String, required: true, unique: true, index: true },
    orderId: { type: String, default: null },
    customer: { type: Schema.Types.Mixed, default: null },
    items: { type: Schema.Types.Mixed, default: [] },
    type: { type: String, default: 'Takeaway', trim: true },
    timestamp: { type: String, default: '', trim: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model<IHeldOrder>('HeldOrder', HeldOrderSchema);

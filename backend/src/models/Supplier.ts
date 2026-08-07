/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Supplier Model — vendor management for inventory.
 * Each supplier belongs to a restaurant (multi-tenant isolation).
 * `items` lists the product names they supply (matches Product.name).
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ISupplier extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  gstin?: string;
  items: string[];
  status: 'active' | 'inactive';
  notes?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SupplierSchema = new Schema<ISupplier>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    name: { type: String, required: true, trim: true, index: true },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    address: { type: String, trim: true, default: '' },
    gstin: { type: String, trim: true, uppercase: true, default: '' },
    items: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    notes: { type: String, trim: true, default: '' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SupplierSchema.index({ restaurantId: 1, name: 1 });
SupplierSchema.index({ restaurantId: 1, status: 1 });

export default mongoose.model<ISupplier>('Supplier', SupplierSchema);

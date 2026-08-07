/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vendor Model — Finance module vendor integration (Phase 1.7).
 * Expenses reference a Vendor instead of only free-text. Tracks GSTIN, contact
 * details and payment terms. Outstanding / total paid are computed from the
 * Expense ledger (see vendorService.summary) — never stored, so they can't
 * drift.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IVendor extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  name: string;
  gstin?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  paymentTermsDays?: number;
  defaultPaymentMethod?: string;
  status: 'active' | 'inactive';
  notes?: string;
  createdBy?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const VendorSchema = new Schema<IVendor>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    name: { type: String, required: true, trim: true, maxlength: 150, index: true },
    gstin: { type: String, trim: true, uppercase: true, maxlength: 20 },
    phone: { type: String, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    address: { type: String, trim: true, maxlength: 500 },
    city: { type: String, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100 },
    pincode: { type: String, trim: true, maxlength: 10 },
    paymentTermsDays: { type: Number, default: 0, min: 0, max: 365 },
    defaultPaymentMethod: { type: String, default: 'Bank Transfer', trim: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    notes: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

VendorSchema.index({ restaurantId: 1, name: 1 });
VendorSchema.index({ restaurantId: 1, gstin: 1 });
VendorSchema.index({ restaurantId: 1, status: 1 });

export default mongoose.model<IVendor>('Vendor', VendorSchema);

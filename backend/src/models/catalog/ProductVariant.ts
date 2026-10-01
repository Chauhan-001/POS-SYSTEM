/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProductVariant Model — Variant options for products (size, type, etc.).
 * Stored as a separate collection instead of embedded in Product
 * for easier future PostgreSQL migration.
 * Each variant has a base price, and branches can override variant prices.
 *
 * Example: "Margherita Pizza" has variants "Regular 10\" (₹349)" and "Large 14\" (₹549)".
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IProductVariant extends Document {
  productId: mongoose.Types.ObjectId;
  name: string;
  price: number;
  branchPrice?: Map<string, number>; // branchId → price override
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ProductVariantSchema = new Schema<IProductVariant>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    branchPrice: { type: Map, of: Number, default: {} },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ProductVariantSchema.index({ productId: 1, name: 1 }, { unique: true });

export default mongoose.model<IProductVariant>('ProductVariant', ProductVariantSchema);

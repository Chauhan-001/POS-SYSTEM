/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Product Model — Menu items/catalog products.
 * Each product belongs to a category and has a base price.
 * Variants (size, toppings) are stored in a separate ProductVariant collection
 * so that future PostgreSQL migration maps cleanly.
 *
 * Branch-specific pricing: Different branches can override a product's price
 * via the branchPrice field. If null, the base price is used.
 *
 * Voice Inventory Support (commercial SaaS):
 *   - voiceAliases    : Multilingual aliases used for VOICE recognition
 *                       (e.g. "coke", "कोक", "cold drink")
 *   - searchAliases   : Aliases used for TEXT search (e.g. "coke", "cola")
 *   - learnedAliases  : Aliases learned automatically from merchant behavior
 *                       (per-restaurant, self-improving over time)
 *   - lastUsedAlias   : The alias most recently used to match this product
 *   - aliasUsageCount : Total number of times this product was resolved via alias
 *
 * These fields power the 7-stage Product Resolution Engine. They are additive
 * and optional — existing products continue to work without them.
 */

import mongoose, { Schema, Document } from 'mongoose';

/** A single learned alias entry, tracked for self-improvement analytics. */
export interface ILearnedAlias {
  alias: string;
  source: 'transcript' | 'correction' | 'ai_generated';
  usageCount: number;
  lastUsed: Date;
  restaurantId?: mongoose.Types.ObjectId;
}

export interface IProduct extends Document {
  name: string;
  code: string;
  price: number;
  category: string;
  image?: string;
  gstPercent: number;
  availability: boolean;
  favorite?: boolean;
  /**
   * Owning restaurant (ObjectId). Optional for backward compatibility — older
   * products were global with no owner. When set, listProducts returns the
   * caller's own products PLUS the global (unscoped) ones, so every restaurant
   * still sees the shared menu.
   */
  restaurantId?: mongoose.Types.ObjectId;
  branchPrice?: Map<string, number>; // branchId → price override
  /** Current stock level (used for inventory tracking) */
  currentStock: number;
  /** Unit of measurement (kg, L, pcs, etc.) */
  unit: string;
  /** Minimum stock level before reorder */
  minStock: number;
  /** Maximum stock level */
  maxStock: number;
  /** Reorder level — when currentStock drops to this, a reorder is recommended */
  reorderLevel: number;
  /** Weighted average cost per unit (updated on every purchase) */
  averageCost: number;
  /** Default supplier name */
  supplier?: string;
  /** Storage location (e.g. 'Fridge B', 'Shelf 3') */
  storageLocation?: string;
  /** Optional merchant notes */
  notes?: string;
  /** Barcode (EAN/UPC/QR content) — unique per restaurant; used for scanner lookup */
  barcode?: string;
  /** Expiry date (YYYY-MM-DD) for perishable items */
  expiryDate?: string;
  /** Batch number for FIFO/expiry tracking */
  batchNumber?: string;
  /** Voice recognition aliases (multilingual, merchant-editable) */
  voiceAliases: string[];
  /** Text search aliases */
  searchAliases: string[];
  /** Automatically learned aliases per restaurant */
  learnedAliases: ILearnedAlias[];
  /** Most recently used alias for this product */
  lastUsedAlias?: string;
  /** Total alias resolution count */
  aliasUsageCount: number;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LearnedAliasSchema = new Schema<ILearnedAlias>(
  {
    alias: { type: String, required: true, trim: true, maxlength: 200 },
    source: {
      type: String,
      required: true,
      enum: ['transcript', 'correction', 'ai_generated'],
      default: 'transcript',
    },
    usageCount: { type: Number, default: 0, min: 0 },
    lastUsed: { type: Date, default: Date.now },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null },
  },
  { _id: false }
);

const ProductSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true, index: true },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, required: true, trim: true, index: true },
    image: { type: String, trim: true },
    gstPercent: { type: Number, default: 5, min: 0, max: 100 },
    availability: { type: Boolean, default: true },
    favorite: { type: Boolean, default: false },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    branchPrice: { type: Map, of: Number, default: {} },
    currentStock: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: 'pcs', trim: true },
    minStock: { type: Number, default: 0, min: 0 },
    maxStock: { type: Number, default: 1000, min: 0 },
    reorderLevel: { type: Number, default: 0, min: 0 },
    averageCost: { type: Number, default: 0, min: 0 },
    supplier: { type: String, trim: true, default: '' },
    storageLocation: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    barcode: { type: String, trim: true, uppercase: true, default: '' },
    expiryDate: { type: String, trim: true, default: '' },
    batchNumber: { type: String, trim: true, default: '' },
    // ─── Voice Inventory Resolution Fields ──────────────────────────
    voiceAliases: { type: [String], default: [], validate: { validator: (v: string[]) => v.length <= 200, message: 'Max 200 voice aliases' } },
    searchAliases: { type: [String], default: [], validate: { validator: (v: string[]) => v.length <= 200, message: 'Max 200 search aliases' } },
    learnedAliases: { type: [LearnedAliasSchema], default: [] },
    lastUsedAlias: { type: String, trim: true, default: null },
    aliasUsageCount: { type: Number, default: 0, min: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ProductSchema.index({ category: 1, availability: 1 });
ProductSchema.index({ code: 1, isDeleted: 1 });
// ─── Performance indexes for the Product Resolution Engine ──────────
// Avoid full collection scans when matching 10,000+ products. Each alias
// array gets its own multikey index so lookup is an indexed $elemMatch.
ProductSchema.index({ voiceAliases: 1, isDeleted: 1, restaurantId: 1 });
ProductSchema.index({ searchAliases: 1, isDeleted: 1, restaurantId: 1 });
ProductSchema.index({ 'learnedAliases.alias': 1, isDeleted: 1, restaurantId: 1 });
// Text index over name + aliases for fast combined search (used by the
// fuzzy matcher to pre-filter candidate sets before expensive distance math).
ProductSchema.index({
  name: 'text',
  voiceAliases: 'text',
  searchAliases: 'text',
  'learnedAliases.alias': 'text',
});

export default mongoose.model<IProduct>('Product', ProductSchema);

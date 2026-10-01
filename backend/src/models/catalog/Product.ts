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

/** A single stock batch for FIFO/expiry tracking. */
export interface IStockBatch {
  batchNumber?: string;
  /** YYYY-MM-DD; '' means the batch has no expiry (consumed LAST under FIFO). */
  expiryDate?: string;
  /** Remaining quantity in this batch (same unit as the product). */
  quantity: number;
  /** YYYY-MM-DD the batch was received (tie-break for same expiry). */
  receivedDate?: string;
  /** Per-unit purchase cost of this batch. */
  cost?: number;
}

/** A single learned alias entry, tracked for self-improvement analytics. */
export interface ILearnedAlias {
  alias: string;
  source: 'transcript' | 'correction' | 'ai_generated';
  usageCount: number;
  lastUsed: Date;
  restaurantId?: mongoose.Types.ObjectId;
}

// ─── Reusable Menu Configuration references (Phase 1 foundation) ───────────
// Products reference reusable ConfigurationTemplates instead of copying their
// data. Modes: 'shared' (as-is), 'override' (inherit + item-specific
// overrides), 'copy' (independent copy — sourceTemplateId records provenance).
// Existing simple products are untouched: menuConfig defaults to empty arrays,
// so a Coke with no configuration resolves to no variants/modifiers/add-ons.

export type ProductConfigMode = 'shared' | 'override' | 'copy';

export interface IProductConfigOptionOverride {
  optionId: string;
  /** null semantics: keep the template value; presence means override. */
  priceDelta?: number;
  name?: string;
  active?: boolean;
  sortOrder?: number;
  /** true removes the option for this product only. */
  removed?: boolean;
}

export interface IProductConfigRef {
  templateId: mongoose.Types.ObjectId;
  mode: ProductConfigMode;
  /** Provenance for 'copy' refs (the template this copy was taken from). */
  sourceTemplateId?: mongoose.Types.ObjectId;
  /** Item-specific overrides — only the deltas are stored, never a full copy. */
  overrides?: {
    group?: {
      required?: boolean;
      minSelections?: number;
      maxSelections?: number;
      selectionMode?: 'SINGLE' | 'MULTIPLE';
    };
    options?: IProductConfigOptionOverride[];
  };
}

export interface IMenuConfig {
  variantConfigurations: IProductConfigRef[];
  modifierConfigurations: IProductConfigRef[];
  addOnConfigurations: IProductConfigRef[];
}

export type ProductType = 'menu' | 'inventory';

export interface IProduct extends Document {
  name: string;
  code: string;
  price: number;
  category: string;
  image?: string;
  gstPercent: number;
  /**
   * Authoritative product type discriminator.
   *  - 'menu'     → sellable menu item (displayed in billing, catalog, customer site)
   *  - 'inventory' → raw material / ingredient (managed by the Inventory module)
   * Defaults to 'menu' for backward compatibility with legacy documents.
   */
  type: ProductType;
  /**
   * Owner-facing product classification used to AUTO-RECOMMEND the tax
   * treatment at registration (classification → configured restaurant tax
   * rule). It is an input to tax determination — never the tax rate itself.
   * One of: prepared_food | beverage | packaged | other ('' for legacy items).
   */
  taxClassification?: string;
  /** How gstPercent was assigned: 'automatic' (recommended from config) or 'manual' (owner override). */
  taxSource?: 'automatic' | 'manual';
  /** Availability for menu items (sold-out toggle). For inventory items this
   *  is always false. The `type` field is the authoritative discriminator. */
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
  comboBranchPrice?: Map<string, number>; // branchId → combo price override
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
  /** Last purchase prices (per unit, max 10) — averageCost = their rolling
   *  average, so the value reflects recent purchase prices instead of an
   *  all-time weighted average that can never shake off old prices. */
  lastPurchasePrices?: number[];
  /** Default supplier name */
  supplier?: string;
  /** Storage location (e.g. 'Fridge B', 'Shelf 3') */
  storageLocation?: string;
  /** Optional merchant notes */
  notes?: string;
  /** Barcode (EAN/UPC/QR content) — unique per restaurant; used for scanner lookup */
  barcode?: string;
  /** Expiry date (YYYY-MM-DD) for perishable items — reflects the OLDEST
   *  remaining batch so expiry warnings fire as soon as any batch is due. */
  expiryDate?: string;
  /** Batch number for FIFO/expiry tracking */
  batchNumber?: string;
  /** Per-batch stock for FIFO expiry tracking. currentStock = sum(quantity).
   *  Deductions consume the oldest-expiry batch first ('' = no expiry → last). */
  batches?: IStockBatch[];
  /** Meal combo: this product is a bundle of other products sold at comboPrice. */
  isCombo?: boolean;
  /** Meal combo: component product ids. */
  comboComponentIds?: string[];
  /** Meal combo: bundle price. */
  comboPrice?: number;
  /** Meal combo: the auto-synced backing Offer (type 'combo') for billing/analytics. */
  linkedComboOfferId?: string;
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
  /** Reusable configuration references (Phase 1). Empty for simple products. */
  menuConfig?: IMenuConfig;
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

const ProductConfigOptionOverrideSchema = new Schema<IProductConfigOptionOverride>(
  {
    optionId: { type: String, required: true, trim: true },
    priceDelta: { type: Number, min: 0 },
    name: { type: String, trim: true, maxlength: 200 },
    active: { type: Boolean },
    sortOrder: { type: Number },
    removed: { type: Boolean, default: false },
  },
  { _id: false }
);

const ProductConfigRefSchema = new Schema<IProductConfigRef>(
  {
    templateId: { type: Schema.Types.ObjectId, ref: 'ConfigurationTemplate', required: true },
    mode: { type: String, enum: ['shared', 'override', 'copy'], default: 'shared' },
    sourceTemplateId: { type: Schema.Types.ObjectId, ref: 'ConfigurationTemplate', default: null },
    overrides: {
      type: new Schema(
        {
          group: {
            type: new Schema(
              {
                required: { type: Boolean },
                minSelections: { type: Number, min: 0 },
                maxSelections: { type: Number, min: 0 },
                selectionMode: { type: String, enum: ['SINGLE', 'MULTIPLE'] },
              },
              { _id: false }
            ),
            default: null,
          },
          options: { type: [ProductConfigOptionOverrideSchema], default: [] },
        },
        { _id: false }
      ),
      default: null,
    },
  },
  { _id: true }
);

const MenuConfigSchema = new Schema<IMenuConfig>(
  {
    variantConfigurations: { type: [ProductConfigRefSchema], default: [] },
    modifierConfigurations: { type: [ProductConfigRefSchema], default: [] },
    addOnConfigurations: { type: [ProductConfigRefSchema], default: [] },
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
    taxClassification: { type: String, default: '', trim: true },
    taxSource: { type: String, default: 'automatic', enum: ['automatic', 'manual'] },
    type: { type: String, enum: ['menu', 'inventory'], default: 'menu', index: true },
    availability: { type: Boolean, default: true },
    favorite: { type: Boolean, default: false },
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    branchPrice: { type: Map, of: Number, default: {} },
    // Per-branch combo price overrides (branchId → combo price) for meal
    // combos — mirrors branchPrice so the same bundle can be priced
    // differently at each branch. Resolved at billing by the backing offer.
    comboBranchPrice: { type: Map, of: Number, default: {} },
    currentStock: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: 'pcs', trim: true },
    minStock: { type: Number, default: 0, min: 0 },
    maxStock: { type: Number, default: 1000, min: 0 },
    reorderLevel: { type: Number, default: 0, min: 0 },
    averageCost: { type: Number, default: 0, min: 0 },
    lastPurchasePrices: { type: [Number], default: [] },
    supplier: { type: String, trim: true, default: '' },
    storageLocation: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    barcode: { type: String, trim: true, uppercase: true, default: '' },
    expiryDate: { type: String, trim: true, default: '' },
    batchNumber: { type: String, trim: true, default: '' },
    // Per-batch FIFO/expiry tracking. currentStock is the sum of batch
    // quantities; deductions consume the oldest-expiry batch first.
    batches: {
      type: [new Schema<IStockBatch>(
        {
          batchNumber: { type: String, trim: true, default: '' },
          expiryDate: { type: String, trim: true, default: '' },
          quantity: { type: Number, default: 0, min: 0 },
          receivedDate: { type: String, trim: true, default: '' },
          cost: { type: Number, default: 0, min: 0 },
        },
        { _id: false }
      )],
      default: [],
    },
    // ─── Meal Combo fields (product-level bundle, synced to a backing Offer) ───
    isCombo: { type: Boolean, default: false },
    comboComponentIds: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    comboPrice: { type: Number, min: 0, default: 0 },
    linkedComboOfferId: { type: Schema.Types.ObjectId, ref: 'Offer', default: null },
    // ─── Voice Inventory Resolution Fields ──────────────────────────
    voiceAliases: { type: [String], default: [], validate: { validator: (v: string[]) => v.length <= 200, message: 'Max 200 voice aliases' } },
    searchAliases: { type: [String], default: [], validate: { validator: (v: string[]) => v.length <= 200, message: 'Max 200 search aliases' } },
    learnedAliases: { type: [LearnedAliasSchema], default: [] },
    lastUsedAlias: { type: String, trim: true, default: null },
    aliasUsageCount: { type: Number, default: 0, min: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    // Reusable menu configuration references (Phase 1). Defaults to empty
    // arrays — existing simple products are unaffected.
    menuConfig: {
      type: MenuConfigSchema,
      default: () => ({
        variantConfigurations: [],
        modifierConfigurations: [],
        addOnConfigurations: [],
      }),
    },
  },
  { timestamps: true }
);

ProductSchema.index({ category: 1, availability: 1 });
ProductSchema.index({ code: 1, isDeleted: 1 });
// Core tenant-scoped queries filter by restaurantId + isDeleted — add compound
// index to avoid full collection scans on every product list / availability call.
ProductSchema.index({ restaurantId: 1, isDeleted: 1 });
// Product type discriminator — the primary filter for separating menu items
// from inventory items. Compound with restaurantId + isDeleted for the
// most common query pattern: `type + restaurantId + isDeleted`.
ProductSchema.index({ type: 1, restaurantId: 1, isDeleted: 1 });
// Inventory summary query: type + tenant + sort. The compound index
// serves the equality filter (restaurantId + type) and the sort (name)
// in a single index scan — no in-memory sort, no fetch-phase filter.
ProductSchema.index({ restaurantId: 1, type: 1, name: 1 });
// Reusable menu-config: "which products use template X" is a tenant-scoped
// query over each ref array — one compound index per array keeps it indexed.
ProductSchema.index({ restaurantId: 1, 'menuConfig.variantConfigurations.templateId': 1 });
ProductSchema.index({ restaurantId: 1, 'menuConfig.modifierConfigurations.templateId': 1 });
ProductSchema.index({ restaurantId: 1, 'menuConfig.addOnConfigurations.templateId': 1 });
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

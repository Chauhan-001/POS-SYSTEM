/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ConfigurationTemplate — a REUSABLE menu configuration owned by exactly one
 * restaurant (tenant). Templates are versioned and referenced by products
 * through the Product.menuConfig relation (shared / override / copy).
 *
 * One model serves all three types (VARIANT_GROUP, MODIFIER_GROUP,
 * ADD_ON_GROUP); the type discriminates the semantics of `data.options`.
 *
 * Phase-1 scope note: recipeMappingId / kitchenInstruction / availability are
 * configuration metadata placeholders only — no inventory/recipe consumption
 * happens here.
 */

import mongoose, { Schema, Document } from 'mongoose';
import { ConfigType, ConfigStatus, SelectionMode } from '../constants';

export interface IConfigOption {
  /** Stable id within the template (generated on create, immutable). */
  id: string;
  name: string;
  /** Variant/modifier option price delta (₹) — optional, defaults to 0. Add-ons use `price`. */
  priceDelta?: number;
  /** Absolute price for ADD_ON_GROUP options. */
  price?: number;
  /** Optional reference to an existing product (reusable add-ons). */
  productId?: mongoose.Types.ObjectId;
  sku?: string;
  barcode?: string;
  /** Optional — mongoose defaults to true. */
  active?: boolean;
  /** Optional — mongoose defaults to 0. */
  sortOrder?: number;
  /** Add-on quantity constraints. */
  minQuantity?: number;
  maxQuantity?: number;
  /** Phase-4 placeholder — recipe/inventory mapping reference. */
  recipeMappingId?: string;
  /** KOT metadata — kitchen instruction for this option. */
  kitchenInstruction?: string;
}

export interface ITemplateData {
  selectionMode?: SelectionMode;
  required?: boolean;
  minSelections?: number;
  maxSelections?: number;
  /** Options beyond this count are chargeable (pricing phase consumes this). */
  freeSelectionCount?: number;
  options: IConfigOption[];
}

export interface IConfigurationTemplate extends Document {
  restaurantId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  type: ConfigType;
  status: ConfigStatus;
  /** Monotonically meaningful revision — bumped on every update. */
  version: number;
  versionNote?: string;
  /** Provenance for independent copies. */
  sourceTemplateId?: mongoose.Types.ObjectId;
  createdBy?: string;
  updatedBy?: string;
  data: ITemplateData;
  createdAt: Date;
  updatedAt: Date;
}

const ConfigOptionSchema = new Schema<IConfigOption>(
  {
    id: { type: String, required: true, trim: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    priceDelta: { type: Number, default: 0, min: 0 },
    price: { type: Number, min: 0 },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    sku: { type: String, trim: true, default: '' },
    barcode: { type: String, trim: true, uppercase: true, default: '' },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    minQuantity: { type: Number, min: 0 },
    maxQuantity: { type: Number, min: 0 },
    recipeMappingId: { type: String, trim: true, default: '' },
    kitchenInstruction: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { _id: false }
);

const TemplateDataSchema = new Schema<ITemplateData>(
  {
    selectionMode: { type: String, enum: ['SINGLE', 'MULTIPLE'] },
    required: { type: Boolean },
    minSelections: { type: Number, min: 0 },
    maxSelections: { type: Number, min: 0 },
    freeSelectionCount: { type: Number, min: 0 },
    options: { type: [ConfigOptionSchema], default: [] },
  },
  { _id: false }
);

const ConfigurationTemplateSchema = new Schema<IConfigurationTemplate>(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    type: { type: String, required: true, enum: ['VARIANT_GROUP', 'MODIFIER_GROUP', 'ADD_ON_GROUP'] },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'active' },
    version: { type: Number, default: 1, min: 1 },
    versionNote: { type: String, trim: true, maxlength: 300, default: '' },
    sourceTemplateId: { type: Schema.Types.ObjectId, ref: 'ConfigurationTemplate', default: null },
    createdBy: { type: String, trim: true, default: '' },
    updatedBy: { type: String, trim: true, default: '' },
    data: { type: TemplateDataSchema, default: () => ({ options: [] }) },
  },
  { timestamps: true }
);

// Tenant-isolated query patterns:
//   list by tenant+type+status, list by tenant+status, tenant-scoped get.
ConfigurationTemplateSchema.index({ restaurantId: 1, type: 1, status: 1 });
ConfigurationTemplateSchema.index({ restaurantId: 1, status: 1 });
// "Which products use this template" is answered from Product.menuConfig —
// see the Product model indexes.

export default mongoose.model<IConfigurationTemplate>('ConfigurationTemplate', ConfigurationTemplateSchema);

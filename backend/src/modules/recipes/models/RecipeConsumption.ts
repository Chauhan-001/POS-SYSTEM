/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipeConsumption Model — THEORETICAL ingredient consumption records.
 *
 * Generated when a bill is finalized: every line item whose product has an
 * ACTIVE recipe resolves the recipe (at the version effective on the sale
 * date) into per-ingredient quantities × frozen costs, and (a) records the
 * theoretical consumption here and (b) applies it to inventory via
 * StockMovementService (type 'sale').
 *
 * Idempotency: a unique index on { restaurantId, billId } guarantees a bill is
 * consumed exactly once — API retries, offline queue replays and webhook
 * retries can never double-deduct. (The POS bill flow already dedupes on
 * clientRef before creating the bill; this index is the second, independent
 * guard on the consumption side.)
 *
 * Reversal: voided/refunded bills flip status to 'voided'/'refunded' and apply
 * 'return' movements for the same ingredients (unless the merchant's policy
 * says otherwise).
 *
 * items[] doubles as the SNAPSHOT COST ledger: each row freezes the inventory
 * item's weighted-average cost at consumption time, so historical reports
 * never recalculate yesterday's sale at today's prices.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IRecipeConsumptionLine {
  productId: string;
  productName: string;
  variantName?: string;
  quantity: number;
  /** Recipe version the line resolved against (0 = no recipe / legacy). */
  recipeVersion: number;
  recipeName?: string;
  /** 'recipe' = base product recipe; 'option' = variant/modifier recipe delta;
   *  'addon' = a selected add-on's own product recipe (Phase 4 layers). */
  source?: 'recipe' | 'option' | 'addon';
  /** Human-readable option name for option/addon lines (e.g. "Extra Cheese"). */
  optionName?: string;
}

export interface IRecipeConsumptionItem {
  inventoryItemId?: mongoose.Types.ObjectId;
  itemName: string;
  unit: string;
  quantity: number;
  /** Frozen per-unit cost (weighted avg) at consumption time. */
  costPerUnit: number;
  cost: number;
  /** 'recipe' = from a recipe component; 'legacy' = direct menu-product deduction. */
  source: 'recipe' | 'legacy';
}

export type ConsumptionStatus = 'recorded' | 'voided' | 'refunded';

export interface IRecipeConsumption extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  billId: mongoose.Types.ObjectId;
  orderId?: mongoose.Types.ObjectId;
  /** Bill's offline-replay key (traceability; dedupe is on billId). */
  clientRef?: string;
  invoiceNumber: string;
  /** YYYY-MM-DD of the sale. */
  date: string;
  lines: IRecipeConsumptionLine[];
  items: IRecipeConsumptionItem[];
  totalCost: number;
  status: ConsumptionStatus;
  reversedAt?: Date;
  reversedBy?: string;
  reversedReason?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ConsumptionLineSchema = new Schema<IRecipeConsumptionLine>(
  {
    productId: { type: String, trim: true },
    productName: { type: String, required: true, trim: true },
    variantName: { type: String, trim: true, default: null },
    quantity: { type: Number, required: true, min: 0 },
    recipeVersion: { type: Number, default: 0, min: 0 },
    recipeName: { type: String, trim: true, default: '' },
    source: { type: String, enum: ['recipe', 'option', 'addon'], default: 'recipe' },
    optionName: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const ConsumptionItemSchema = new Schema<IRecipeConsumptionItem>(
  {
    inventoryItemId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    itemName: { type: String, required: true, trim: true },
    unit: { type: String, required: true, trim: true, maxlength: 20 },
    quantity: { type: Number, required: true, min: 0 },
    costPerUnit: { type: Number, default: 0, min: 0 },
    cost: { type: Number, default: 0, min: 0 },
    source: { type: String, enum: ['recipe', 'legacy'], default: 'recipe' },
  },
  { _id: false }
);

const RecipeConsumptionSchema = new Schema<IRecipeConsumption>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    clientRef: { type: String, trim: true, maxlength: 80 },
    invoiceNumber: { type: String, required: true, trim: true },
    date: { type: String, required: true, trim: true, index: true },
    lines: { type: [ConsumptionLineSchema], default: [] },
    items: { type: [ConsumptionItemSchema], default: [] },
    totalCost: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['recorded', 'voided', 'refunded'], default: 'recorded' },
    reversedAt: { type: Date, default: null },
    reversedBy: { type: String, trim: true, default: '' },
    reversedReason: { type: String, trim: true, default: '' },
    createdBy: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

// THE idempotency guard: one consumption record per bill per restaurant.
RecipeConsumptionSchema.index(
  { restaurantId: 1, billId: 1 },
  { unique: true }
);
RecipeConsumptionSchema.index({ restaurantId: 1, date: -1 });
RecipeConsumptionSchema.index({ restaurantId: 1, inventoryItemId: 1, date: -1 });
RecipeConsumptionSchema.index({ restaurantId: 1, status: 1, date: -1 });

export default mongoose.model<IRecipeConsumption>('RecipeConsumption', RecipeConsumptionSchema);

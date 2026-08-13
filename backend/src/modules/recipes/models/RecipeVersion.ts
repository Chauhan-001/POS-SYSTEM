/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipeVersion Model — Immutable historical snapshots of a recipe.
 *
 * Every edit of an ACTIVE recipe snapshots the previous component set + cost
 * here BEFORE the recipe document changes. A sale is always resolved against
 * the RecipeVersion active on the sale date, so historical profitability stays
 * explainable even when a recipe changes later (e.g. Paneer 200g in January →
 * 180g in March: a January sale continues to cost against the 200g version).
 *
 * Never modified after creation (append-only, like Bill).
 */

import mongoose, { Schema, Document } from 'mongoose';

/** A component with its cost frozen at snapshot time. */
export interface IRecipeVersionComponent {
  inventoryItemId?: mongoose.Types.ObjectId;
  itemName: string;
  unit: string;
  quantity: number;
  normalizedQuantity: number;
  normalizedUnit: string;
  componentType: 'ingredient' | 'sub_recipe';
  subRecipeId?: mongoose.Types.ObjectId;
  wastagePercent: number;
  optional: boolean;
  notes?: string;
  sequence: number;
  /** Frozen per-unit cost (weighted avg) at snapshot time. */
  costPerUnit: number;
  /** Frozen line cost = normalized(quantity × (1 + wastage)) × costPerUnit. */
  lineCost: number;
}

export interface IRecipeVersion extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  /** The live recipe this version belongs to. */
  recipeId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  productName: string;
  variantName?: string;
  version: number;
  name: string;
  description?: string;
  /** YYYY-MM-DD range during which this version was the active recipe. */
  effectiveFrom: string;
  effectiveTo?: string;
  yieldQuantity: number;
  yieldUnit: string;
  servingSize?: number;
  preparationNotes?: string;
  /** Raw component definitions (what the merchant entered). */
  components: IRecipeVersionComponent[];
  /** Flattened, frozen per-ingredient cost lines (sub-recipes expanded) —
   *  each line carries the weighted-average cost and line cost at snapshot
   *  time, so historical sales are explainable ingredient by ingredient. */
  lines: IRecipeVersionComponent[];
  costSnapshot: {
    recipeCost: number;
    foodCostPercent: number;
    contribution: number;
    contributionMarginPercent: number;
    perServingCost: number;
    sellingPrice: number;
    /** Layered model frozen at snapshot time. */
    directIngredients: number;
    minorAllowance: number;
    cookingAllowance: number;
    wastageAllowance: number;
    packagingCost: number;
    estimatedVariableCost: number;
    conservativeCost: number;
    capturedAt: Date;
  };
  createdBy?: string;
  createdAt: Date;
}

const VersionComponentSchema = new Schema<IRecipeVersionComponent>(
  {
    inventoryItemId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    itemName: { type: String, required: true, trim: true },
    unit: { type: String, required: true, trim: true, maxlength: 20 },
    quantity: { type: Number, required: true, min: 0 },
    normalizedQuantity: { type: Number, default: 0, min: 0 },
    normalizedUnit: { type: String, default: '', trim: true, maxlength: 20 },
    componentType: { type: String, enum: ['ingredient', 'sub_recipe'], default: 'ingredient' },
    subRecipeId: { type: Schema.Types.ObjectId, ref: 'Recipe', default: null },
    wastagePercent: { type: Number, default: 0, min: 0, max: 100 },
    optional: { type: Boolean, default: false },
    notes: { type: String, trim: true, default: '' },
    sequence: { type: Number, default: 0 },
    costPerUnit: { type: Number, default: 0, min: 0 },
    lineCost: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const RecipeVersionSchema = new Schema<IRecipeVersion>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    recipeId: { type: Schema.Types.ObjectId, ref: 'Recipe', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    productName: { type: String, required: true, trim: true },
    variantName: { type: String, trim: true, default: null },
    version: { type: Number, required: true, min: 1 },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    effectiveFrom: { type: String, required: true, trim: true },
    effectiveTo: { type: String, trim: true, default: null },
    yieldQuantity: { type: Number, required: true, min: 0 },
    yieldUnit: { type: String, required: true, trim: true, maxlength: 20 },
    servingSize: { type: Number, min: 1 },
    preparationNotes: { type: String, trim: true, default: '' },
    components: { type: [VersionComponentSchema], default: [] },
    lines: { type: [VersionComponentSchema], default: [] },
    costSnapshot: {
      type: new Schema(
        {
          recipeCost: { type: Number, default: 0, min: 0 },
          foodCostPercent: { type: Number, default: 0, min: 0 },
          // Contribution may be negative (recipe cost above selling price).
          contribution: { type: Number, default: 0 },
          contributionMarginPercent: { type: Number, default: 0 },
          perServingCost: { type: Number, default: 0, min: 0 },
          sellingPrice: { type: Number, default: 0, min: 0 },
          directIngredients: { type: Number, default: 0, min: 0 },
          minorAllowance: { type: Number, default: 0, min: 0 },
          cookingAllowance: { type: Number, default: 0, min: 0 },
          wastageAllowance: { type: Number, default: 0, min: 0 },
          packagingCost: { type: Number, default: 0, min: 0 },
          estimatedVariableCost: { type: Number, default: 0, min: 0 },
          conservativeCost: { type: Number, default: 0, min: 0 },
          capturedAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
      default: () => ({
        recipeCost: 0,
        foodCostPercent: 0,
        contribution: 0,
        contributionMarginPercent: 0,
        perServingCost: 0,
        sellingPrice: 0,
        directIngredients: 0,
        minorAllowance: 0,
        cookingAllowance: 0,
        wastageAllowance: 0,
        packagingCost: 0,
        estimatedVariableCost: 0,
        conservativeCost: 0,
        capturedAt: new Date(),
      }),
    },
    createdBy: { type: String, trim: true, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

RecipeVersionSchema.index({ restaurantId: 1, recipeId: 1, version: -1 });
RecipeVersionSchema.index({ restaurantId: 1, productId: 1, effectiveFrom: 1, effectiveTo: 1 });

export default mongoose.model<IRecipeVersion>('RecipeVersion', RecipeVersionSchema);

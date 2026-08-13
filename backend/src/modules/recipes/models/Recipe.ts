/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Recipe Model — The Recipe Manager core.
 *
 * A recipe links a MENU PRODUCT (Product._id, availability:true) to its
 * ingredient components. Ingredients are INVENTORY ITEMS — the very same
 * Product documents the Inventory module tracks (availability:false). There is
 * deliberately NO second ingredient database: every component references an
 * existing inventory product id, so the recipe cost engine can read the
 * house-wide weighted-average cost (Product.averageCost) directly.
 *
 * Components can be plain ingredients OR sub-recipes (componentType
 * 'sub_recipe' + subRecipeId → another Recipe). Sub-recipes are reusable:
 * the same gravy recipe can back several dishes without duplicating its
 * ingredient definitions. Circular references are rejected at save time by
 * RecipeService.validateGraph.
 *
 * Versioning: editing an ACTIVE recipe never mutates history in place — the
 * current component set is snapshotted into RecipeVersion before the change,
 * and the recipe's own version counter increments. Historical sales resolve
 * against the version active on their sale date.
 *
 * costSummary is a CACHE of the last computed cost (RecipeCostEngine), kept on
 * the document so list views and the POS never recompute per row. It is
 * invalidated/recomputed dependency-aware when an ingredient cost changes.
 */

import mongoose, { Schema, Document } from 'mongoose';

/** A single recipe component: an inventory item or a sub-recipe. */
export interface IRecipeComponent {
  /** Reference to an inventory product (Product._id). Required for
   *  ingredient components; also present (as the sub-recipe's product) for
   *  sub-recipe components so cost display is uniform. */
  inventoryItemId?: mongoose.Types.ObjectId;
  /** Denormalized display name snapshot. */
  itemName: string;
  /** Unit in which the quantity is expressed (may differ from the inventory
   *  item's own unit — converted at cost/consumption time). */
  unit: string;
  /** Quantity of this component per recipe yield. */
  quantity: number;
  /** Quantity normalized to the inventory item's base unit. */
  normalizedQuantity: number;
  /** The inventory item's base unit (normalizedQuantity's unit). */
  normalizedUnit: string;
  /** 'ingredient' → direct inventory item; 'sub_recipe' → another Recipe. */
  componentType: 'ingredient' | 'sub_recipe';
  /** Required for sub_recipe components. */
  subRecipeId?: mongoose.Types.ObjectId;
  /** Standard preparation wastage (%) — extra quantity needed beyond the
   *  theoretical amount to cover trimming/cooking loss. 0 = none. */
  wastagePercent: number;
  /** Optional components are excluded from default costing/consumption unless
   *  the merchant explicitly includes them. */
  optional: boolean;
  notes?: string;
  /** Display/consumption order. */
  sequence: number;
}

export type RecipeStatus = 'draft' | 'active' | 'archived';

export interface IRecipe extends Document {
  restaurantId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId;
  /** Menu product this recipe produces (Product._id). */
  productId: mongoose.Types.ObjectId;
  /** Denormalized product name snapshot. */
  productName: string;
  /** Optional variant name — a product can have one recipe per variant. */
  variantName?: string;
  name: string;
  description?: string;
  status: RecipeStatus;
  /** Monotonic version counter (increments on every edit of an active recipe). */
  version: number;
  /** YYYY-MM-DD from which this recipe is in effect. */
  effectiveFrom: string;
  /** YYYY-MM-DD — set when superseded/archived. */
  effectiveTo?: string;
  /** How much finished product this recipe yields. */
  yieldQuantity: number;
  yieldUnit: string;
  /** Portions/servings the yield represents (for per-serving costing). */
  servingSize?: number;
  preparationNotes?: string;
  components: IRecipeComponent[];
  /** Cached cost engine output (see RecipeCostEngine). */
  costSummary: {
    /** Direct ingredient cost (sum of lines). */
    recipeCost: number;
    foodCostPercent: number;
    contribution: number;
    contributionMarginPercent: number;
    perServingCost: number;
    /** Layered cost model — see RecipeCostLayers in the cost engine. */
    directIngredients: number;
    minorAllowance: number;
    cookingAllowance: number;
    wastageAllowance: number;
    packagingCost: number;
    estimatedVariableCost: number;
    conservativeCost: number;
    directFoodCostPercent: number;
    calculatedAt: Date;
  };
  createdBy?: string;
  updatedBy?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RecipeComponentSchema = new Schema<IRecipeComponent>(
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
  },
  { _id: false }
);

const RecipeSchema = new Schema<IRecipe>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    productName: { type: String, required: true, trim: true },
    variantName: { type: String, trim: true, default: null },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
    version: { type: Number, default: 1, min: 1 },
    effectiveFrom: { type: String, required: true, trim: true },
    effectiveTo: { type: String, trim: true, default: null },
    yieldQuantity: { type: Number, required: true, min: 0 },
    yieldUnit: { type: String, required: true, trim: true, maxlength: 20 },
    servingSize: { type: Number, min: 1 },
    preparationNotes: { type: String, trim: true, default: '' },
    components: { type: [RecipeComponentSchema], default: [] },
    costSummary: {
      type: new Schema(
        {
          recipeCost: { type: Number, default: 0, min: 0 },
          foodCostPercent: { type: Number, default: 0, min: 0 },
          // Contribution may be negative (recipe cost above selling price).
          contribution: { type: Number, default: 0 },
          contributionMarginPercent: { type: Number, default: 0 },
          perServingCost: { type: Number, default: 0, min: 0 },
          directIngredients: { type: Number, default: 0, min: 0 },
          minorAllowance: { type: Number, default: 0, min: 0 },
          cookingAllowance: { type: Number, default: 0, min: 0 },
          wastageAllowance: { type: Number, default: 0, min: 0 },
          packagingCost: { type: Number, default: 0, min: 0 },
          estimatedVariableCost: { type: Number, default: 0, min: 0 },
          conservativeCost: { type: Number, default: 0, min: 0 },
          directFoodCostPercent: { type: Number, default: 0, min: 0 },
          calculatedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: () => ({
        recipeCost: 0,
        foodCostPercent: 0,
        contribution: 0,
        contributionMarginPercent: 0,
        perServingCost: 0,
        directIngredients: 0,
        minorAllowance: 0,
        cookingAllowance: 0,
        wastageAllowance: 0,
        packagingCost: 0,
        estimatedVariableCost: 0,
        conservativeCost: 0,
        directFoodCostPercent: 0,
        calculatedAt: null,
      }),
    } as any,
    createdBy: { type: String, trim: true, default: '' },
    updatedBy: { type: String, trim: true, default: '' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One active recipe per (restaurant, product, variant) — enforced in the
// service (partial index; Mongo cannot express it directly).
RecipeSchema.index({ restaurantId: 1, productId: 1, variantName: 1, status: 1 });
RecipeSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
RecipeSchema.index({ restaurantId: 1, productId: 1, version: 1 });
RecipeSchema.index({ restaurantId: 1, isDeleted: 1, createdAt: -1 });

export default mongoose.model<IRecipe>('Recipe', RecipeSchema);

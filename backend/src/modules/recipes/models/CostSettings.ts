/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CostSettings Model — restaurant-level assumptions for the layered cost model.
 *
 * The cost model is intentionally an ESTIMATE, not a precise fixed number:
 *
 *   Direct ingredient cost   (Product.averageCost × quantity, deterministic)
 *   + Minor ingredient allowance   (₹/item — salt, tiny masala, etc.)
 *   + Cooking/operational allowance (₹/item — gas, electricity, water)
 *   + Wastage allowance      (% of direct+minor+cooking)
 *   + Packaging (per channel — dine-in ₹0, takeaway/delivery configured)
 *   = Estimated Variable Cost
 *
 * Fixed overhead (rent, salaries, subscriptions) is deliberately NOT part of
 * recipe variable cost — it is modeled separately at restaurant level.
 *
 * The engine reads these settings at cost time; RecipeVersion snapshots freeze
 * the values used so historical sales stay explainable. A settings change
 * triggers a restaurant-wide dependency-aware recalculation of active recipes
 * (cheap — one query per restaurant, no historical mutation).
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ICostSettings extends Document {
  restaurantId: mongoose.Types.ObjectId;
  /** Minor ingredients (salt, small masala, garnish…) — ₹ per serving/item. */
  minorIngredientAllowance: number;
  /** Cooking / operational (gas, electricity, water…) — ₹ per serving/item. */
  cookingAllowance: number;
  /** Standard wastage % applied to (direct + minor + cooking). 0 disables. */
  wastagePercent: number;
  /** Conservative estimate markup % used for offer safety (default 10%). */
  conservativeMarkupPercent: number;
  /** Packaging ₹ per order by channel. Dine-in defaults to 0. */
  packaging: {
    dineIn: number;
    takeaway: number;
    delivery: number;
  };
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CostSettingsSchema = new Schema<ICostSettings>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, unique: true, index: true },
    minorIngredientAllowance: { type: Number, default: 0, min: 0 },
    cookingAllowance: { type: Number, default: 0, min: 0 },
    wastagePercent: { type: Number, default: 0, min: 0, max: 100 },
    conservativeMarkupPercent: { type: Number, default: 10, min: 0, max: 100 },
    packaging: {
      type: new Schema(
        {
          dineIn: { type: Number, default: 0, min: 0 },
          takeaway: { type: Number, default: 0, min: 0 },
          delivery: { type: Number, default: 0, min: 0 },
        },
        { _id: false }
      ),
      default: () => ({ dineIn: 0, takeaway: 0, delivery: 0 }),
    },
    updatedBy: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model<ICostSettings>('CostSettings', CostSettingsSchema);

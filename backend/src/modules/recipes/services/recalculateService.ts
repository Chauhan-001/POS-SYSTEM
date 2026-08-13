/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecalculateService — dependency-aware cost recalculation (Phases 21–22).
 *
 * When an ingredient's weighted-average cost changes (a purchase lands, a
 * purchase is edited/deleted, a manual stock adjustment with purchasePrice),
 * ONLY the recipes whose component graph includes that ingredient are
 * recomputed — never the whole restaurant. The dependency closure walks
 * parents of sub-recipe references transitively:
 *
 *   ingredient X changed
 *     → recipes directly referencing X
 *     → recipes referencing those recipes as sub-recipes
 *     → ... until closure
 *
 * Each affected recipe's costSummary is refreshed from the cost engine (the
 * same engine bills display/consumption) and persisted in one batched write.
 * Historical RecipeVersion snapshots are NEVER touched.
 */

import mongoose from 'mongoose';
import { Recipe } from '../../../models';
import { recipeCostEngine } from './recipeCostEngine';

export class RecalculateService {
  /**
   * Recompute cost summaries for every recipe whose dependency graph contains
   * the given inventory product. Returns the ids that were recalculated.
   * Best-effort — callers (purchase flow) must not fail on recalc errors.
   */
  async recalcForIngredient(restaurantId: string, inventoryItemId: string): Promise<string[]> {
    if (!mongoose.Types.ObjectId.isValid(restaurantId) || !mongoose.Types.ObjectId.isValid(inventoryItemId)) {
      return [];
    }
    const affected = await this.dependencyClosure(restaurantId, inventoryItemId);
    if (affected.length === 0) return [];

    const updates: any[] = [];
    for (const recipe of affected) {
      try {
        const cost = await recipeCostEngine.costRecipe(recipe, {
          restaurantId,
          branchId: recipe.branchId ? String(recipe.branchId) : undefined,
        });
        updates.push({
          updateOne: {
            filter: { _id: recipe._id, restaurantId },
            update: {
              $set: {
                'costSummary.recipeCost': cost.recipeCost,
                'costSummary.foodCostPercent': cost.foodCostPercent,
                'costSummary.contribution': cost.contribution,
                'costSummary.contributionMarginPercent': cost.contributionMarginPercent,
                'costSummary.perServingCost': cost.perServingCost,
                'costSummary.directIngredients': cost.directIngredients,
                'costSummary.minorAllowance': cost.minorAllowance,
                'costSummary.cookingAllowance': cost.cookingAllowance,
                'costSummary.wastageAllowance': cost.wastageAllowance,
                'costSummary.packagingCost': cost.packagingCost,
                'costSummary.estimatedVariableCost': cost.estimatedVariableCost,
                'costSummary.conservativeCost': cost.conservativeCost,
                'costSummary.directFoodCostPercent': cost.directFoodCostPercent,
                'costSummary.calculatedAt': cost.calculatedAt,
                updatedAt: new Date(),
              },
            },
          },
        });
      } catch (err: any) {
        console.warn('[RecalculateService] recipe recalc failed:', recipe.name, err.message);
      }
    }
    if (updates.length > 0) {
      await Recipe.bulkWrite(updates, { ordered: false });
    }
    return affected.map((r: any) => String(r._id));
  }

  /**
   * Recompute cost summaries for EVERY non-archived recipe in the restaurant.
   * Used when restaurant-level cost settings change (minor/cooking/wastage/
   * packaging allowances affect every recipe). Historical RecipeVersion
   * snapshots are never touched. Returns the number of recipes updated.
   */
  async recalcAll(restaurantId: string, operator?: string): Promise<number> {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) return 0;
    const recipes = await Recipe.find({
      restaurantId,
      isDeleted: { $ne: true },
      status: { $ne: 'archived' },
    }).lean().exec();
    if (recipes.length === 0) return 0;

    const updates: any[] = [];
    for (const recipe of recipes) {
      try {
        const cost = await recipeCostEngine.costRecipe(recipe, {
          restaurantId,
          branchId: recipe.branchId ? String(recipe.branchId) : undefined,
        });
        updates.push({
          updateOne: {
            filter: { _id: recipe._id, restaurantId },
            update: {
              $set: {
                'costSummary.recipeCost': cost.recipeCost,
                'costSummary.foodCostPercent': cost.foodCostPercent,
                'costSummary.contribution': cost.contribution,
                'costSummary.contributionMarginPercent': cost.contributionMarginPercent,
                'costSummary.perServingCost': cost.perServingCost,
                'costSummary.directIngredients': cost.directIngredients,
                'costSummary.minorAllowance': cost.minorAllowance,
                'costSummary.cookingAllowance': cost.cookingAllowance,
                'costSummary.wastageAllowance': cost.wastageAllowance,
                'costSummary.packagingCost': cost.packagingCost,
                'costSummary.estimatedVariableCost': cost.estimatedVariableCost,
                'costSummary.conservativeCost': cost.conservativeCost,
                'costSummary.directFoodCostPercent': cost.directFoodCostPercent,
                'costSummary.calculatedAt': cost.calculatedAt,
                updatedAt: new Date(),
              },
            },
          },
        });
      } catch (err: any) {
        console.warn('[RecalculateService] recipe recalc failed:', recipe.name, err.message);
      }
    }
    if (updates.length > 0) {
      await Recipe.bulkWrite(updates, { ordered: false });
    }
    return updates.length;
  }

  /**
   * Compute the full dependency closure: every non-archived recipe that
   * references the ingredient directly or through sub-recipe chains.
   */
  private async dependencyClosure(restaurantId: string, inventoryItemId: string): Promise<any[]> {
    const oid = new mongoose.Types.ObjectId(inventoryItemId);
    const direct = await Recipe.find({
      restaurantId,
      isDeleted: { $ne: true },
      status: { $ne: 'archived' },
      components: { $elemMatch: { inventoryItemId: oid, componentType: 'ingredient' } },
    }).lean().exec();

    const affected: any[] = [];
    const visited = new Set<string>();
    const queue: any[] = [...direct];
    while (queue.length > 0) {
      const recipe = queue.shift()!;
      const key = String(recipe._id);
      if (visited.has(key)) continue;
      visited.add(key);
      affected.push(recipe);
      // Parents referencing this recipe as a sub-recipe.
      const parents = await Recipe.find({
        restaurantId,
        isDeleted: { $ne: true },
        status: { $ne: 'archived' },
        'components.subRecipeId': recipe._id,
      }).lean().exec();
      for (const p of parents) queue.push(p);
    }
    return affected;
  }
}

export const recalculateService = new RecalculateService();

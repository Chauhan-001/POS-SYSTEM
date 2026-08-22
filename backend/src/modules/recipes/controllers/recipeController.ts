/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipeController — HTTP surface for the Recipe Manager.
 * Tenant is ALWAYS derived from the authenticated user (req.user.restaurantId)
 * — never from the request body/query.
 */

import { NextFunction, Request, Response } from 'express';
import { recipeService } from '../services/recipeService';
import { recalculateService } from '../services/recalculateService';
import { recipeResolutionService } from '../services/recipeResolutionService';
import { recipeCostEngine } from '../services/recipeCostEngine';

/**
 * Forward async handler errors to the global errorHandler (which maps
 * AppError.statusCode to the right HTTP response). Without this, a thrown
 * AppError becomes an unhandled rejection and crashes the whole process.
 */
function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function userOf(req: Request): { restaurantId: string; name?: string; branchId?: string } {
  const u = (req as any).user as { restaurantId?: string; name?: string; branchId?: string } | undefined;
  return (u || {}) as { restaurantId: string; name?: string; branchId?: string };
}

function ok(res: Response, data: unknown): void {
  res.json({ data });
}

// ─── Recipes ─────────────────────────────────────────────────────

export const listRecipes = wrap(async (req, res) => {
  const { restaurantId, branchId } = userOf(req);
  const q = req.query as Record<string, string | undefined>;
  ok(res, await recipeService.list(restaurantId, {
    status: q.status,
    productId: q.productId,
    branchId: q.branchId || branchId,
    search: q.search,
  }));
});

export const getRecipe = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await recipeService.getById(restaurantId, req.params.id));
});

export const getRecipeVersions = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await recipeService.versions(restaurantId, req.params.id));
});

export const createRecipe = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  const recipe = await recipeService.create(restaurantId, req.body, { operator: name, branchId: req.body.branchId });
  res.status(201).json({ data: recipe });
});

export const updateRecipe = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  ok(res, await recipeService.update(restaurantId, req.params.id, req.body, { operator: name }));
});

export const activateRecipe = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  ok(res, await recipeService.activate(restaurantId, req.params.id, { operator: name }));
});

export const archiveRecipe = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  ok(res, await recipeService.archive(restaurantId, req.params.id, { operator: name }));
});

export const duplicateRecipe = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  ok(res, await recipeService.duplicate(restaurantId, req.params.id, { operator: name }));
});

export const deleteRecipe = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  ok(res, await recipeService.softDelete(restaurantId, req.params.id, { operator: name }));
});

export const calculateCost = wrap(async (req, res) => {
  const { restaurantId, branchId } = userOf(req);
  const q = req.query as Record<string, string | undefined>;
  ok(res, await recipeService.calculateCost(restaurantId, req.params.id, q.branchId || branchId));
});

// ─── Variant recipes (base/override resolution) ──────────────────

export const listRecipeStatus = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  const q = req.query as Record<string, string | undefined>;
  ok(res, await recipeResolutionService.listProductRecipeStatus(restaurantId, {
    limit: q.limit ? Number(q.limit) : undefined,
  }));
});

export const listProductVariants = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await recipeResolutionService.getVariantsForProduct(restaurantId, req.params.productId));
});

export const getEffectiveRecipe = wrap(async (req, res) => {
  const { restaurantId, branchId } = userOf(req);
  const q = req.query as Record<string, string | undefined>;
  const result = await recipeResolutionService.resolveEffectiveRecipe(
    restaurantId,
    String(q.productId),
    q.variantName,
    {}
  );
  if (!result.recipe) {
    ok(res, {
      recipe: null,
      version: result.version,
      resolution: result.resolution,
    });
    return;
  }
  const cost = await recipeCostEngine.costRecipe(result.recipe, { restaurantId, branchId });
  ok(res, {
    recipe: result.recipe,
    version: result.version,
    recipeName: result.recipeName,
    resolution: result.resolution,
    cost,
  });
});

export const copyRecipeToVariant = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  const recipe = await recipeResolutionService.copyVariantRecipe(
    restaurantId,
    req.params.id,
    req.body.variantName,
    { operator: name, status: req.body.status }
  );
  res.status(201).json({ data: recipe });
});

export const resetRecipeToBase = wrap(async (req, res) => {
  const { restaurantId, name } = userOf(req);
  ok(res, await recipeResolutionService.resetVariantToBase(restaurantId, req.params.id, { operator: name }));
});

export const recipeSweep = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  ok(res, await recipeResolutionService.sweep(restaurantId));
});

// ─── Recalculation (dependency-aware) ────────────────────────────

export const recalculateForIngredient = wrap(async (req, res) => {
  const { restaurantId } = userOf(req);
  const updatedIds = await recalculateService.recalcForIngredient(restaurantId, req.body.inventoryItemId);
  ok(res, { recalculated: updatedIds.length, recipeIds: updatedIds });
});

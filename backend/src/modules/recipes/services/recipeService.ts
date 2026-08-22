/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipeService — CRUD + lifecycle for recipes (Phase 2–5, 23–26).
 *
 * Tenant isolation: every operation takes restaurantId derived from the
 * authenticated user; product, inventory-item and sub-recipe references are
 * re-validated against that restaurant on every save (never trust the client).
 *
 * Versioning strategy: editing an ACTIVE recipe snapshots the current state
 * (components + flattened frozen-cost lines + totals) into RecipeVersion and
 * increments version BEFORE applying the change. Historical sales resolve
 * against the version active on their date, so they never silently re-cost at
 * today's ingredients. Drafts/archived recipes are edited in place (they are
 * not consumed by sales).
 *
 * One ACTIVE recipe per (restaurant, product, variant) is enforced at
 * activation time — activating a new recipe auto-archives the previous active
 * one for the same product/variant.
 */

import mongoose from 'mongoose';
import { Recipe, RecipeVersion, Product } from '../../../models';
import { AppError } from '../../../utils/AppError';
import { recipeCostEngine, RecipeCostResult } from './recipeCostEngine';
import { normalizeUnit, familyOf, convertQuantity } from './unitConversion';
import { auditLogRepo } from '../../../repositories';

export interface RecipeComponentInput {
  inventoryItemId?: string;
  itemName: string;
  unit: string;
  quantity: number;
  componentType?: 'ingredient' | 'sub_recipe';
  subRecipeId?: string;
  wastagePercent?: number;
  optional?: boolean;
  notes?: string;
  sequence?: number;
}

export interface RecipeInput {
  productId: string;
  /** Every recipe belongs to exactly one variant. Products without variants use the virtual 'Default' variant. */
  variantName: string;
  /** Recipe role is always 'override' (base recipes no longer exist). */
  recipeMode?: 'override';
  /** Kept for data compatibility — always null for new recipes (no base to link). */
  sourceRecipeId?: string;
  name?: string;
  description?: string;
  status?: 'draft' | 'active';
  effectiveFrom?: string;
  yieldQuantity: number;
  yieldUnit: string;
  servingSize?: number;
  preparationNotes?: string;
  components: RecipeComponentInput[];
}

const MAX_DEPTH = 10;
const today = () => new Date().toISOString().slice(0, 10);

export class RecipeService {
  // ─── List / read ────────────────────────────────────────────────
  async list(restaurantId: string, opts: { status?: string; productId?: string; branchId?: string; search?: string } = {}) {
    const query: any = { restaurantId, isDeleted: { $ne: true } };
    if (opts.status) query.status = opts.status;
    if (opts.productId && mongoose.Types.ObjectId.isValid(opts.productId)) query.productId = opts.productId;
    if (opts.branchId && mongoose.Types.ObjectId.isValid(opts.branchId)) query.branchId = opts.branchId;
    if (opts.search) {
      query.$or = [
        { name: new RegExp(opts.search, 'i') },
        { productName: new RegExp(opts.search, 'i') },
      ];
    }
    const recipes = await Recipe.find(query).sort({ updatedAt: -1 }).limit(200).lean().exec();
    return recipes;
  }

  async getById(restaurantId: string, id: string) {
    this.assertId(id);
    const recipe = await Recipe.findOne({ _id: id, restaurantId, isDeleted: { $ne: true } }).lean().exec();
    if (!recipe) throw new AppError(404, 'Recipe not found in your restaurant');
    return recipe;
  }

  async versions(restaurantId: string, recipeId: string) {
    this.assertId(recipeId);
    const recipe = await Recipe.findOne({ _id: recipeId, restaurantId, isDeleted: { $ne: true } }).lean().exec();
    if (!recipe) throw new AppError(404, 'Recipe not found in your restaurant');
    const versions = await RecipeVersion.find({ restaurantId, recipeId })
      .sort({ version: -1 }).limit(100).lean().exec();
    return versions;
  }

  // ─── Create ─────────────────────────────────────────────────────
  async create(restaurantId: string, data: RecipeInput, ctx: { operator?: string; branchId?: string } = {}) {
    const product = await this.assertProduct(restaurantId, data.productId);
    await this.validateGraph(restaurantId, data.components || []);
    const components = await this.normalizeComponents(restaurantId, data.components || []);

    // ── Variant-only model ───────────────────────────────────────
    // Every recipe belongs to exactly ONE variant. There is no base recipe and
    // no inheritance. Products without variants use the virtual 'Default'
    // variant. recipeMode is always 'override'.
    const variantName = String(data.variantName || '').trim();
    if (!variantName) {
      throw new AppError(400, 'A recipe must belong to a variant — create recipes per variant.');
    }
    if (String(data.recipeMode || '') === 'base') {
      throw new AppError(400, 'Base recipes no longer exist — every recipe belongs to a variant.');
    }
    const recipeMode = 'override';

    const name = data.name || `${product.name} (${variantName}) Recipe`;
    const draft: any = {
      restaurantId,
      branchId: ctx.branchId || null,
      productId: product._id,
      productName: product.name,
      variantName,
      recipeMode,
      sourceRecipeId: null,
      name,
      description: data.description || '',
      status: data.status === 'active' ? 'active' : 'draft',
      version: 1,
      effectiveFrom: data.effectiveFrom || today(),
      yieldQuantity: Number(data.yieldQuantity) || 0,
      yieldUnit: data.yieldUnit || 'unit',
      servingSize: data.servingSize,
      preparationNotes: data.preparationNotes || '',
      components,
      createdBy: ctx.operator,
      updatedBy: ctx.operator,
    };

    // Cost the recipe now so the list/UI never recompute per row.
    const cost = await recipeCostEngine.costRecipe(draft, { restaurantId, branchId: ctx.branchId });
    draft.costSummary = this.toCostSummary(cost);

    const recipe = await Recipe.create(draft);

    if (draft.status === 'active') {
      await this.archiveSiblings(restaurantId, recipe._id.toString(), product._id.toString(), variantName, ctx);
    }

    await this.audit(restaurantId, recipe._id.toString(), 'RECIPE_CREATED', ctx.operator, {
      name, status: draft.status, version: 1, recipeMode,
    });
    return this.getById(restaurantId, recipe._id.toString());
  }

  // ─── Update ─────────────────────────────────────────────────────
  async update(restaurantId: string, id: string, data: Partial<RecipeInput>, ctx: { operator?: string } = {}) {
    this.assertId(id);
    const recipe = await Recipe.findOne({ _id: id, restaurantId, isDeleted: { $ne: true } }).exec();
    if (!recipe) throw new AppError(404, 'Recipe not found in your restaurant');

    if (data.components !== undefined) {
      await this.validateGraph(restaurantId, data.components, id);
    }

    // Identity is immutable on update: a recipe's (productId, variantName,
    // recipeMode) is fixed at creation. Reparenting a recipe here is the exact
    // mechanism that let the old UI mutate one variant's recipe into another's
    // (Half→Full sharing ingredients). The editor creates a NEW recipe when a
    // variant has none — it never moves an existing one.
    const currentVariant = recipe.variantName ? String(recipe.variantName).trim() : '';
    if (data.variantName !== undefined && String(data.variantName || '').trim() !== currentVariant) {
      throw new AppError(
        400,
        'A recipe cannot be moved to another variant — create a recipe for that variant instead.'
      );
    }
    if (data.productId !== undefined && String(data.productId) !== String(recipe.productId)) {
      throw new AppError(400, 'A recipe cannot be moved to another product — create a new recipe instead.');
    }
    if (data.recipeMode !== undefined && data.recipeMode !== recipe.recipeMode) {
      throw new AppError(
        400,
        `A recipe's role (${recipe.recipeMode}) cannot be changed in place — create a new recipe with the desired role instead.`
      );
    }

    const materialChanged =
      data.components !== undefined ||
      data.yieldQuantity !== undefined ||
      data.yieldUnit !== undefined ||
      data.servingSize !== undefined;

    // Versioning: editing an ACTIVE recipe's material content snapshots the
    // current state first — history is never destroyed.
    if (recipe.status === 'active' && materialChanged) {
      await this.snapshotVersion(recipe, restaurantId, ctx.operator);
    }

    if (data.name !== undefined) recipe.name = data.name;
    if (data.description !== undefined) recipe.description = data.description;
    if (data.effectiveFrom !== undefined) recipe.effectiveFrom = data.effectiveFrom;
    if (data.yieldQuantity !== undefined) recipe.yieldQuantity = Number(data.yieldQuantity);
    if (data.yieldUnit !== undefined) recipe.yieldUnit = data.yieldUnit;
    if (data.servingSize !== undefined) recipe.servingSize = data.servingSize;
    if (data.preparationNotes !== undefined) recipe.preparationNotes = data.preparationNotes;
    if (data.components !== undefined) recipe.components = await this.normalizeComponents(restaurantId, data.components);

    if (materialChanged) {
      recipe.version = (recipe.version || 1) + 1;
      const cost = await recipeCostEngine.costRecipe(recipe, { restaurantId, branchId: recipe.branchId ? String(recipe.branchId) : undefined });
      recipe.costSummary = this.toCostSummary(cost);
    }
    recipe.updatedBy = ctx.operator;

    await recipe.save();
    await this.audit(restaurantId, id, materialChanged ? 'RECIPE_UPDATED' : 'RECIPE_META_UPDATED', ctx.operator, {
      name: recipe.name, version: recipe.version,
    });
    return this.getById(restaurantId, id);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────
  async activate(restaurantId: string, id: string, ctx: { operator?: string } = {}) {
    this.assertId(id);
    const recipe = await Recipe.findOne({ _id: id, restaurantId, isDeleted: { $ne: true } }).exec();
    if (!recipe) throw new AppError(404, 'Recipe not found in your restaurant');
    if (recipe.components.length === 0) {
      throw new AppError(400, 'Cannot activate a recipe with no ingredients');
    }
    // Re-validate the graph before going live (an ingredient may have been
    // deleted or a sub-recipe archived since last save).
    await this.validateGraph(restaurantId, recipe.components as any, id);

    recipe.status = 'active';
    recipe.effectiveFrom = recipe.effectiveFrom || today();
    recipe.effectiveTo = undefined;
    recipe.updatedBy = ctx.operator;
    await recipe.save();

    await this.archiveSiblings(restaurantId, id, String(recipe.productId), recipe.variantName || undefined, ctx);
    await this.audit(restaurantId, id, 'RECIPE_ACTIVATED', ctx.operator, {
      name: recipe.name, version: recipe.version,
    });
    return this.getById(restaurantId, id);
  }

  async archive(restaurantId: string, id: string, ctx: { operator?: string } = {}) {
    this.assertId(id);
    const recipe = await Recipe.findOne({ _id: id, restaurantId, isDeleted: { $ne: true } }).exec();
    if (!recipe) throw new AppError(404, 'Recipe not found in your restaurant');
    if (recipe.status === 'active') {
      await this.snapshotVersion(recipe, restaurantId, ctx.operator);
      recipe.version = (recipe.version || 1) + 1;
    }
    recipe.status = 'archived';
    recipe.effectiveTo = recipe.effectiveTo || today();
    recipe.updatedBy = ctx.operator;
    await recipe.save();
    await this.audit(restaurantId, id, 'RECIPE_ARCHIVED', ctx.operator, {
      name: recipe.name, version: recipe.version,
    });
    return this.getById(restaurantId, id);
  }

  async duplicate(restaurantId: string, id: string, ctx: { operator?: string } = {}) {
    this.assertId(id);
    const recipe = await Recipe.findOne({ _id: id, restaurantId, isDeleted: { $ne: true } }).lean().exec();
    if (!recipe) throw new AppError(404, 'Recipe not found in your restaurant');
    const copy: any = {
      ...recipe,
      _id: new mongoose.Types.ObjectId(),
      name: `${recipe.name} (copy)`,
      status: 'draft',
      version: 1,
      effectiveFrom: today(),
      effectiveTo: null,
      recipeMode: recipe.recipeMode || 'base',
      variantName: recipe.variantName || null,
      sourceRecipeId: recipe.recipeMode === 'override' ? (recipe.sourceRecipeId || null) : null,
      createdBy: ctx.operator,
      updatedBy: ctx.operator,
      isDeleted: false,
      deletedAt: null,
      createdAt: undefined,
      updatedAt: undefined,
      costSummary: { ...recipe.costSummary, calculatedAt: new Date() },
    };
    delete copy.__v;
    const created = await Recipe.create(copy);
    await this.audit(restaurantId, created._id.toString(), 'RECIPE_DUPLICATED', ctx.operator, {
      name: created.name, from: id,
    });
    return this.getById(restaurantId, created._id.toString());
  }

  async softDelete(restaurantId: string, id: string, ctx: { operator?: string } = {}) {
    this.assertId(id);
    const recipe = await Recipe.findOne({ _id: id, restaurantId, isDeleted: { $ne: true } }).exec();
    if (!recipe) throw new AppError(404, 'Recipe not found in your restaurant');
    if (recipe.status === 'active') {
      throw new AppError(400, 'Archived first — an active recipe cannot be deleted (history must be preserved)');
    }
    recipe.isDeleted = true;
    recipe.deletedAt = new Date();
    recipe.updatedBy = ctx.operator;
    await recipe.save();
    await this.audit(restaurantId, id, 'RECIPE_DELETED', ctx.operator, { name: recipe.name });
    return { success: true };
  }

  // ─── Costing surface ────────────────────────────────────────────
  async calculateCost(restaurantId: string, id: string, branchId?: string): Promise<RecipeCostResult> {
    const recipe = await this.getById(restaurantId, id);
    return recipeCostEngine.costRecipe(recipe, { restaurantId, branchId });
  }

  /** Dependency-aware: find every recipe (by id) whose components reference
   *  the given inventory product — used to recalc only affected recipes when
   *  an ingredient's cost changes. */
  async findRecipesUsingIngredient(restaurantId: string, inventoryItemId: string): Promise<any[]> {
    if (!mongoose.Types.ObjectId.isValid(inventoryItemId)) return [];
    return Recipe.find({
      restaurantId,
      isDeleted: { $ne: true },
      status: { $ne: 'archived' },
      components: { $elemMatch: { inventoryItemId: new mongoose.Types.ObjectId(inventoryItemId) } },
    }).lean().exec();
  }

  async findRecipesUsingSubRecipe(restaurantId: string, subRecipeId: string): Promise<any[]> {
    if (!mongoose.Types.ObjectId.isValid(subRecipeId)) return [];
    return Recipe.find({
      restaurantId,
      isDeleted: { $ne: true },
      'components.subRecipeId': new mongoose.Types.ObjectId(subRecipeId),
    }).lean().exec();
  }

  // ─── Internal helpers ───────────────────────────────────────────

  /** Snapshot the CURRENT state of an active recipe into RecipeVersion. */
  private async snapshotVersion(recipe: any, restaurantId: string, operator?: string) {
    const cost = await recipeCostEngine.costRecipe(recipe, { restaurantId, branchId: recipe.branchId || undefined });
    // Frozen flattened leaf lines (sub-recipes expanded), each with its cost.
    const lines = cost.lines.map((l) => ({
      inventoryItemId: l.inventoryItemId ? new mongoose.Types.ObjectId(l.inventoryItemId) : undefined,
      itemName: l.itemName,
      unit: l.unit,
      quantity: l.quantity,
      normalizedQuantity: l.quantity,
      normalizedUnit: l.unit,
      componentType: l.componentType,
      subRecipeId: l.subRecipeId ? new mongoose.Types.ObjectId(l.subRecipeId) : undefined,
      wastagePercent: 0,
      optional: false,
      sequence: 0,
      costPerUnit: l.costPerUnit,
      lineCost: l.lineCost,
    }));

    const sellingPrice = cost.sellingPrice;
    const version = (recipe.version || 1);
    const existing = await RecipeVersion.findOne({
      restaurantId,
      recipeId: recipe._id,
      version,
    }).lean().exec();
    if (existing) return; // already snapshotted — never overwrite history

    await RecipeVersion.create({
      restaurantId,
      branchId: recipe.branchId || undefined,
      recipeId: recipe._id,
      productId: recipe.productId,
      productName: recipe.productName,
      variantName: recipe.variantName || undefined,
      version,
      name: recipe.name,
      description: recipe.description,
      effectiveFrom: recipe.effectiveFrom,
      effectiveTo: recipe.effectiveTo || undefined,
      yieldQuantity: recipe.yieldQuantity,
      yieldUnit: recipe.yieldUnit,
      servingSize: recipe.servingSize,
      preparationNotes: recipe.preparationNotes,
      components: recipe.components.map((c: any) => ({
        inventoryItemId: c.inventoryItemId || undefined,
        itemName: c.itemName,
        unit: c.unit,
        quantity: c.quantity,
        normalizedQuantity: c.normalizedQuantity,
        normalizedUnit: c.normalizedUnit,
        componentType: c.componentType,
        subRecipeId: c.subRecipeId || undefined,
        wastagePercent: c.wastagePercent || 0,
        optional: c.optional || false,
        notes: c.notes || '',
        sequence: c.sequence || 0,
        costPerUnit: 0,
        lineCost: 0,
      })),
      lines,
      costSnapshot: {
        recipeCost: cost.recipeCost,
        foodCostPercent: cost.foodCostPercent,
        contribution: cost.contribution,
        contributionMarginPercent: cost.contributionMarginPercent,
        perServingCost: cost.perServingCost,
        sellingPrice,
        // Layered model frozen at snapshot time — historical sales stay
        // explainable even when allowances change later.
        directIngredients: cost.directIngredients,
        minorAllowance: cost.minorAllowance,
        cookingAllowance: cost.cookingAllowance,
        wastageAllowance: cost.wastageAllowance,
        packagingCost: cost.packagingCost,
        estimatedVariableCost: cost.estimatedVariableCost,
        conservativeCost: cost.conservativeCost,
        capturedAt: new Date(),
      },
      createdBy: operator,
    });
  }

  /** Archive any other ACTIVE recipe for the same product+variant. */
  private async archiveSiblings(
    restaurantId: string,
    exceptId: string,
    productId: string,
    variantName: string | undefined,
    ctx: { operator?: string }
  ) {
    const match: any = {
      restaurantId,
      productId,
      status: 'active',
      isDeleted: { $ne: true },
      _id: { $ne: exceptId },
    };
    if (variantName) match.variantName = variantName;
    else match.variantName = { $in: [null, ''] };

    const siblings = await Recipe.find(match).exec();
    for (const sib of siblings) {
      await this.snapshotVersion(sib, restaurantId, ctx.operator);
      sib.status = 'archived';
      sib.effectiveTo = today();
      sib.version = (sib.version || 1) + 1;
      sib.updatedBy = ctx.operator;
      await sib.save();
    }
  }

  /** Validate the dependency graph: tenant-scoped refs, no cycles, sane depth. */
  async validateGraph(restaurantId: string, components: RecipeComponentInput[], validatedRecipeId?: string) {
    if (!Array.isArray(components)) return;
    const oid = new mongoose.Types.ObjectId(restaurantId);
    for (const comp of components) {
      if (comp.componentType === 'sub_recipe') {
        if (!comp.subRecipeId || !mongoose.Types.ObjectId.isValid(comp.subRecipeId)) {
          throw new AppError(400, `Sub-recipe component "${comp.itemName}" has an invalid sub-recipe id`);
        }
        const sub = await Recipe.findOne({
          _id: comp.subRecipeId,
          restaurantId: oid,
          isDeleted: { $ne: true },
        }).lean().exec();
        if (!sub) {
          throw new AppError(400, `Sub-recipe "${comp.itemName}" not found in your restaurant`);
        }
        // Sub-recipe components must be expressed in the sub-recipe's YIELD
        // unit family (e.g. ml for a gravy that yields in L).
        const subYieldUnit = normalizeUnit(sub.yieldUnit);
        const compUnit = normalizeUnit(comp.unit);
        if (compUnit && subYieldUnit) {
          const a = familyOf(compUnit);
          const b = familyOf(subYieldUnit);
          if (a && b && a !== b) {
            throw new AppError(
              400,
              `${comp.itemName}: cannot use ${comp.unit} for a sub-recipe that yields in ${sub.yieldUnit} (${a} vs ${b})`
            );
          }
        }
      } else {
        if (!comp.inventoryItemId || !mongoose.Types.ObjectId.isValid(comp.inventoryItemId)) {
          throw new AppError(400, `Ingredient "${comp.itemName}" has an invalid inventory item id`);
        }
        const item = await Product.findOne({
          _id: comp.inventoryItemId,
          restaurantId: oid,
          isDeleted: { $ne: true },
        }).lean().exec();
        if (!item) {
          throw new AppError(400, `Ingredient "${comp.itemName}" not found in your inventory`);
        }
        // Unit compatibility: the recipe unit's family must match the item's.
        const itemUnit = normalizeUnit((item as any).unit);
        const compUnit = normalizeUnit(comp.unit);
        if (compUnit && itemUnit) {
          const a = familyOf(compUnit);
          const b = familyOf(itemUnit);
          if (a && b && a !== b) {
            throw new AppError(
              400,
              `${comp.itemName}: cannot use ${comp.unit} for an item tracked in ${(item as any).unit} (${a} vs ${b})`
            );
          }
        }
      }
    }
    // ── Cycle detection ────────────────────────────────────────────
    // The recipe under validation gains new edges V → {new sub-recipe refs}.
    // A cycle exists iff following STORED sub-recipe edges from any new
    // reference reaches V (or V references itself). This catches the
    // A → B → A case when editing A to reference B, without needing V's id in
    // the stored edge set.
    const newRefs = components
      .filter((c) => c.componentType === 'sub_recipe' && c.subRecipeId)
      .map((c) => String(c.subRecipeId));
    if (validatedRecipeId && newRefs.includes(String(validatedRecipeId))) {
      throw new AppError(400, 'Circular sub-recipe reference detected (a recipe cannot contain itself)');
    }
    const inMemory = new Map<string, RecipeComponentInput[]>();
    const visited = new Set<string>();
    const queue = [...newRefs];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      if (validatedRecipeId && id === String(validatedRecipeId)) {
        throw new AppError(400, 'Circular sub-recipe reference detected');
      }
      const children = await this.collectSubRecipeChildren(restaurantId, id, inMemory);
      for (const child of children) queue.push(child);
    }
    // Depth sanity: any chain from a new reference must stay under MAX_DEPTH.
    for (const ref of newRefs) {
      const depth = await this.maxDepth(restaurantId, ref, inMemory, new Set());
      if (depth > MAX_DEPTH) {
        throw new AppError(400, `Sub-recipe nesting too deep (max ${MAX_DEPTH} levels)`);
      }
    }
  }

  private async collectSubRecipeChildren(
    restaurantId: string,
    recipeId: string,
    cache: Map<string, RecipeComponentInput[]>
  ): Promise<string[]> {
    let comps: any[] | undefined = cache.get(recipeId);
    if (!comps) {
      const sub = await Recipe.findOne({ _id: recipeId, restaurantId, isDeleted: { $ne: true } }).lean().exec();
      comps = sub ? sub.components : [];
      cache.set(recipeId, comps);
    }
    return comps
      .filter((c: any) => c.componentType === 'sub_recipe' && c.subRecipeId)
      .map((c: any) => String(c.subRecipeId));
  }

  private async maxDepth(
    restaurantId: string,
    recipeId: string,
    cache: Map<string, RecipeComponentInput[]>,
    seen: Set<string>
  ): Promise<number> {
    if (seen.has(recipeId)) return 0; // cycle already rejected above
    seen.add(recipeId);
    const children = await this.collectSubRecipeChildren(restaurantId, recipeId, cache);
    if (!children.length) return 1;
    let deepest = 0;
    for (const child of children) {
      deepest = Math.max(deepest, await this.maxDepth(restaurantId, child, cache, seen));
    }
    return 1 + deepest;
  }

  /** Re-validate + normalize component records (normalize unit quantities). */
  private async normalizeComponents(restaurantId: string, components: RecipeComponentInput[]) {
    const normalized: any[] = [];
    for (let i = 0; i < components.length; i++) {
      const comp = components[i];
      if (!comp || !comp.itemName) continue;
      if (comp.componentType === 'sub_recipe' && comp.subRecipeId) {
        const sub = await Recipe.findOne({
          _id: comp.subRecipeId,
          restaurantId,
          isDeleted: { $ne: true },
        }).lean().exec();
        const yieldUnit = sub ? sub.yieldUnit : 'unit';
        normalized.push({
          inventoryItemId: sub ? sub.productId : null,
          itemName: comp.itemName,
          unit: comp.unit || yieldUnit,
          quantity: Number(comp.quantity) || 0,
          normalizedQuantity: Number(comp.quantity) || 0,
          normalizedUnit: comp.unit || yieldUnit,
          componentType: 'sub_recipe',
          subRecipeId: comp.subRecipeId ? new mongoose.Types.ObjectId(comp.subRecipeId) : undefined,
          wastagePercent: Math.min(100, Math.max(0, Number(comp.wastagePercent) || 0)),
          optional: !!comp.optional,
          notes: comp.notes || '',
          sequence: comp.sequence ?? i,
        });
      } else {
        const item = await Product.findOne({
          _id: comp.inventoryItemId,
          restaurantId,
          isDeleted: { $ne: true },
        }).lean().exec();
        const itemUnit = normalizeUnit((item as any)?.unit) || 'pcs';
        const compUnit = normalizeUnit(comp.unit) || itemUnit;
        normalized.push({
          inventoryItemId: comp.inventoryItemId,
          itemName: (item as any)?.name || comp.itemName,
          unit: compUnit,
          quantity: Number(comp.quantity) || 0,
          // Normalized to the item's own unit (conversion happens here once).
          normalizedQuantity: compUnit === itemUnit
            ? Number(comp.quantity) || 0
            : Math.round((Number(comp.quantity) || 0) * this.factor(compUnit, itemUnit) * 10000) / 10000,
          normalizedUnit: itemUnit,
          componentType: 'ingredient',
          subRecipeId: null,
          wastagePercent: Math.min(100, Math.max(0, Number(comp.wastagePercent) || 0)),
          optional: !!comp.optional,
          notes: comp.notes || '',
          sequence: comp.sequence ?? i,
        });
      }
    }
    return normalized;
  }

  private factor(fromUnit: string, toUnit: string): number {
    // Only same-family, power-of-ten conversions reach here (validateGraph
    // rejects incompatible families). Reuse the converter for the exact value.
    try {
      return convertQuantity(1, fromUnit, toUnit);
    } catch {
      return 1;
    }
  }

  private async assertProduct(restaurantId: string, productId: string) {
    if (!mongoose.Types.ObjectId.isValid(productId)) throw new AppError(400, 'Invalid product id');
    const product = await Product.findOne({
      _id: productId,
      restaurantId,
      isDeleted: { $ne: true },
    }).lean().exec();
    if (!product) throw new AppError(404, 'Product not found in your restaurant');
    return product;
  }

  private toCostSummary(cost: RecipeCostResult) {
    return {
      recipeCost: cost.recipeCost,
      foodCostPercent: cost.foodCostPercent,
      contribution: cost.contribution,
      contributionMarginPercent: cost.contributionMarginPercent,
      perServingCost: cost.perServingCost,
      directIngredients: cost.directIngredients,
      minorAllowance: cost.minorAllowance,
      cookingAllowance: cost.cookingAllowance,
      wastageAllowance: cost.wastageAllowance,
      packagingCost: cost.packagingCost,
      estimatedVariableCost: cost.estimatedVariableCost,
      conservativeCost: cost.conservativeCost,
      directFoodCostPercent: cost.directFoodCostPercent,
      calculatedAt: cost.calculatedAt,
    };
  }

  private assertId(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(400, 'Invalid recipe id');
  }

  private async audit(restaurantId: string, entityId: string, action: string, operator: string | undefined, details: any) {
    try {
      await auditLogRepo.create({
        action,
        entityType: 'recipe',
        entityId,
        performedBy: operator || 'System',
        restaurantId,
        details,
      } as any);
    } catch (err: any) {
      console.warn('[RecipeService] audit failed (non-fatal):', err.message);
    }
  }
}

export const recipeService = new RecipeService();

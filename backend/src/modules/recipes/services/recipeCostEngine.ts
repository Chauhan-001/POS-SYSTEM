/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipeCostEngine — computes a recipe's ingredient cost from INVENTORY costs.
 *
 * Cost source: Product.averageCost (the house-wide weighted-average cost,
 * maintained by StockMovementService on every purchase). Nothing is hardcoded
 * into recipes — a recipe holds quantities/units; the engine derives money.
 *
 *   Inventory purchase → Product.averageCost → engine → recipe cost → margin
 *
 * Rules implemented here:
 *   - Ingredient components: quantity (in recipe unit) is converted into the
 *     inventory item's own unit (unitConversion), scaled by (1 + wastage%),
 *     and multiplied by the item's weighted-average cost.
 *   - Sub-recipe components: the component's quantity is expressed in the
 *     sub-recipe's YIELD unit; the portion = quantity / sub-recipe yield, and
 *     the sub-recipe's own cost scales by that portion (its internal wastage
 *     and its own sub-recipes apply inside the recursion).
 *   - Cycles: recursion tracks the in-progress recipe ids; a cycle or depth
 *     > 10 is a hard error.
 *   - Tenant isolation: every product and sub-recipe lookup is scoped to the
 *     caller's restaurantId. A recipe can never pull another tenant's costs.
 *   - Missing cost (item never purchased → averageCost 0) is NOT an error —
 *     it is reported per-line (missingCost) and counted, so the UI can warn
 *     without blocking the merchant.
 */

import mongoose from 'mongoose';
import { Recipe, CostSettings, ProductVariant } from '../../../models';
import { productRepo } from '../../../repositories';
import { AppError } from '../../../utils/AppError';
import { convertQuantity, round4, round2, normalizeUnit, familyOf } from './unitConversion';
import { resolveProductConfiguration } from '../../menu-config/services/configurationResolver';

export interface CostLine {
  inventoryItemId?: string;
  itemName: string;
  /** The inventory item's unit (all money math happens in this unit). */
  unit: string;
  /** Effective quantity in the item's unit, including component wastage. */
  quantity: number;
  /** Quantity without wastage (pure theoretical). */
  theoreticalQuantity: number;
  costPerUnit: number;
  lineCost: number;
  componentType: 'ingredient' | 'sub_recipe';
  subRecipeId?: string;
  subRecipeName?: string;
  /** Expansion chain for sub-recipes: parent component names root→leaf. */
  path: string[];
  missingCost: boolean;
}

/** Layered cost model — all values in ₹ (round2). See CostSettings model. */
export interface RecipeCostLayers {
  /** Sum of direct ingredient line costs (deterministic, from Product.averageCost). */
  directIngredients: number;
  /** ₹ per serving × servings — salt, tiny masala, garnish, etc. */
  minorAllowance: number;
  /** ₹ per serving × servings — gas, electricity, water, small consumables. */
  cookingAllowance: number;
  /** (direct + minor + cooking) × wastagePercent / 100. */
  wastageAllowance: number;
  /** Packaging for the requested channel (dine-in defaults to 0). */
  packagingCost: number;
  /** direct + minor + cooking + wastage + packaging. */
  estimatedVariableCost: number;
  /** estimatedVariableCost × (1 + conservativeMarkupPercent / 100) — offer safety. */
  conservativeCost: number;
  /** directIngredients / sellingPrice × 100 (pure food cost). */
  directFoodCostPercent: number;
}

export type CostChannel = 'dineIn' | 'takeaway' | 'delivery';

export interface RecipeCostResult extends RecipeCostLayers {
  recipeId?: string;
  version?: number;
  recipeName: string;
  /** Direct ingredient cost (kept for backward compatibility + "recipe cost" semantics). */
  recipeCost: number;
  perServingCost: number;
  /** estimatedVariableCost / sellingPrice × 100. */
  foodCostPercent: number;
  /** sellingPrice − estimatedVariableCost. May be negative. */
  contribution: number;
  contributionMarginPercent: number;
  sellingPrice: number;
  yieldQuantity: number;
  yieldUnit: string;
  /** Flattened ingredient-level lines (sub-recipes expanded to their leaves). */
  lines: CostLine[];
  missingCostCount: number;
  calculatedAt: Date;
}

interface Ctx {
  restaurantId: string;
  branchId?: string;
  /** recipeId → hydrated Recipe doc cache within one call graph. */
  recipeCache: Map<string, any>;
  /** Recursion stack for cycle detection. */
  stack: string[];
  /** Price override source for margin math. */
  priceOverrides?: Map<string, number>;
  /**
   * Inventory-item cost overrides (inventoryItemId → ₹ per unit), used for
   * deterministic historical costing — e.g. "what would this recipe have
   * cost at last period's purchase prices?". Applied in place of
   * Product.averageCost; sub-recipes inherit the same overrides via the
   * shared ctx. Never persisted — purely a read-side what-if.
   */
  costOverrides?: Map<string, number>;
  /** Restaurant cost settings (layered model), loaded once per call graph. */
  costSettings?: {
    minorIngredientAllowance: number;
    cookingAllowance: number;
    wastagePercent: number;
    conservativeMarkupPercent: number;
    packaging: { dineIn: number; takeaway: number; delivery: number };
  };
}

const MAX_RECIPE_DEPTH = 10;

/** Round money to 2dp and quantities to 4dp at the boundary. */
const money = (n: number) => round2(n);
const qty = (n: number) => round4(n);

export class RecipeCostEngine {
  /**
   * Cost a recipe document (must already be tenant-validated) with a fresh
   * cache. `doc` may be a hydrated Recipe or a plain object with components.
   */
  async costRecipe(
    doc: any,
    opts: {
      restaurantId: string;
      branchId?: string;
      priceOverrides?: Map<string, number>;
      costOverrides?: Map<string, number>;
      channel?: CostChannel;
    } = { restaurantId: '' }
  ): Promise<RecipeCostResult> {
    const restaurantId = opts.restaurantId;
    const ctx: Ctx = {
      restaurantId,
      branchId: opts.branchId,
      recipeCache: new Map(),
      stack: [],
      priceOverrides: opts.priceOverrides,
      costOverrides: opts.costOverrides,
    };
    if (doc?._id) ctx.recipeCache.set(String(doc._id), doc);

    const { cost, lines } = await this.expandComponents(doc, ctx, []);
    const recipeCost = money(cost);

    // ── Layered cost model ────────────────────────────────────────
    const settings = await this.loadCostSettings(ctx);
    const servings = Number(doc.servingSize) || (Number(doc.yieldQuantity) || 1);
    const minorAllowance = money((Number(settings.minorIngredientAllowance) || 0) * servings);
    const cookingAllowance = money((Number(settings.cookingAllowance) || 0) * servings);
    const wastageAllowance = money(
      (recipeCost + minorAllowance + cookingAllowance) * ((Number(settings.wastagePercent) || 0) / 100)
    );
    const channel: CostChannel = opts.channel || 'dineIn';
    const packagingCost = money(Number(settings.packaging?.[channel]) || 0);
    const estimatedVariableCost = money(
      recipeCost + minorAllowance + cookingAllowance + wastageAllowance + packagingCost
    );
    const conservativeCost = money(
      estimatedVariableCost * (1 + (Number(settings.conservativeMarkupPercent) || 0) / 100)
    );

    // Selling price: product base price, or branch override when provided.
    // For a variant override recipe the VARIANT's price is used — the product's
    // base price would misstate food-cost % / margin when variants are priced
    // differently (Half ₹120 vs Full ₹179.98).
    let sellingPrice = 0;
    if (doc.productId) {
      sellingPrice = await this.sellingPrice(doc, restaurantId, opts.branchId, ctx);
    }

    const yieldQuantity = Number(doc.yieldQuantity) || 0;
    const yieldUnit = doc.yieldUnit || 'unit';
    const servingSize = Number(doc.servingSize) || 0;
    // Per-serving cost: prefer explicit serving count; else for count-based
    // yields treat the yield quantity as servings; else cost per unit of yield.
    const perServingCost = servingSize > 0
      ? money(recipeCost / servingSize)
      : yieldQuantity > 0
        ? money(recipeCost / yieldQuantity)
        : recipeCost;

    const foodCostPercent = sellingPrice > 0 ? round2((estimatedVariableCost / sellingPrice) * 100) : 0;
    const directFoodCostPercent = sellingPrice > 0 ? round2((recipeCost / sellingPrice) * 100) : 0;
    const contribution = money(sellingPrice - estimatedVariableCost);
    const contributionMarginPercent = sellingPrice > 0 ? round2((contribution / sellingPrice) * 100) : 0;
    const missingCostCount = lines.filter((l) => l.missingCost).length;

    return {
      recipeId: doc._id ? String(doc._id) : undefined,
      version: doc.version,
      recipeName: doc.name || doc.productName || 'Recipe',
      recipeCost,
      perServingCost,
      foodCostPercent,
      directFoodCostPercent,
      contribution,
      contributionMarginPercent,
      sellingPrice,
      yieldQuantity,
      yieldUnit,
      lines,
      missingCostCount,
      calculatedAt: new Date(),
      directIngredients: recipeCost,
      minorAllowance,
      cookingAllowance,
      wastageAllowance,
      packagingCost,
      estimatedVariableCost,
      conservativeCost,
    };
  }

  /** Restaurant cost settings — read once per call graph, defaults when absent. */
  private async loadCostSettings(ctx: Ctx): Promise<NonNullable<Ctx['costSettings']>> {
    if (ctx.costSettings) return ctx.costSettings;
    const defaults = {
      minorIngredientAllowance: 0,
      cookingAllowance: 0,
      wastagePercent: 0,
      conservativeMarkupPercent: 10,
      packaging: { dineIn: 0, takeaway: 0, delivery: 0 },
    };
    if (!ctx.restaurantId || !mongoose.Types.ObjectId.isValid(ctx.restaurantId)) {
      ctx.costSettings = defaults;
      return defaults;
    }
    const doc = await CostSettings.findOne({ restaurantId: ctx.restaurantId }).lean().exec().catch(() => null);
    if (!doc) {
      ctx.costSettings = defaults;
      return defaults;
    }
    ctx.costSettings = {
      minorIngredientAllowance: Number(doc.minorIngredientAllowance) || 0,
      cookingAllowance: Number(doc.cookingAllowance) || 0,
      wastagePercent: Number(doc.wastagePercent) || 0,
      conservativeMarkupPercent: Number(doc.conservativeMarkupPercent) ?? 10,
      packaging: {
        dineIn: Number(doc.packaging?.dineIn) || 0,
        takeaway: Number(doc.packaging?.takeaway) || 0,
        delivery: Number(doc.packaging?.delivery) || 0,
      },
    };
    return ctx.costSettings;
  }

  /** Cost a recipe by id (tenant-scoped). */
  async costRecipeById(
    recipeId: string,
    restaurantId: string,
    branchId?: string,
    channel?: CostChannel
  ): Promise<RecipeCostResult> {
    if (!mongoose.Types.ObjectId.isValid(recipeId)) throw new AppError(400, 'Invalid recipe id');
    const recipe = await Recipe.findOne({ _id: recipeId, restaurantId, isDeleted: { $ne: true } }).lean().exec();
    if (!recipe) throw new AppError(404, 'Recipe not found in your restaurant');
    return this.costRecipe(recipe, { restaurantId, branchId, channel });
  }

  /**
   * Expand a recipe's components into leaf ingredient lines + total cost.
   * Returns lines already scaled by any sub-recipe portion.
   */
  private async expandComponents(
    doc: any,
    ctx: Ctx,
    path: string[]
  ): Promise<{ cost: number; lines: CostLine[] }> {
    const components = Array.isArray(doc.components) ? doc.components : [];
    let cost = 0;
    const lines: CostLine[] = [];

    for (const comp of components) {
      if (comp.optional) continue; // optional components excluded from default costing
      const sequencePath = [...path, comp.itemName || comp.sequence || ''];

      if (comp.componentType === 'sub_recipe' && comp.subRecipeId) {
        const sub = await this.loadRecipe(comp.subRecipeId, ctx);
        if (!sub) {
          throw new AppError(400, `Sub-recipe "${comp.itemName}" no longer exists`);
        }
        // The component quantity is in the sub-recipe's YIELD unit.
        const amount = this.amountInUnit(comp.quantity, comp.unit, sub.yieldUnit, comp.itemName);
        const effectiveAmount = amount * (1 + (Number(comp.wastagePercent) || 0) / 100);
        const portion = sub.yieldQuantity > 0 ? effectiveAmount / sub.yieldQuantity : effectiveAmount;
        const subResult = await this.expandComponents(sub, ctx, sequencePath);
        const subCost = money(subResult.cost * portion);
        cost += subCost;
        for (const leaf of subResult.lines) {
          lines.push({
            ...leaf,
            quantity: qty(leaf.quantity * portion),
            theoreticalQuantity: qty(leaf.theoreticalQuantity * portion),
            lineCost: money(leaf.lineCost * portion),
            componentType: 'sub_recipe',
            subRecipeId: String(sub._id),
            subRecipeName: sub.name || sub.productName,
          });
        }
        continue;
      }

      // ── Ingredient component ─────────────────────────────────────
      if (!comp.inventoryItemId) {
        throw new AppError(400, `Component "${comp.itemName}" has no inventory item`);
      }
      const item = await this.loadProduct(comp.inventoryItemId, ctx);
      if (!item) {
        throw new AppError(400, `Ingredient "${comp.itemName}" not found in your inventory`);
      }
      const itemUnit = normalizeUnit(item.unit) || 'pcs';
      const compUnit = normalizeUnit(comp.unit) || itemUnit;

      // Convert the recipe quantity into the inventory item's unit.
      let quantityInItemUnit: number;
      try {
        quantityInItemUnit = convertQuantity(comp.quantity, compUnit, itemUnit);
      } catch (err: any) {
        throw new AppError(
          400,
          `${comp.itemName}: ${err.message || 'unit conversion failed'} (item is tracked in ${itemUnit})`
        );
      }
      const theoretical = quantityInItemUnit;
      const effective = theoretical * (1 + (Number(comp.wastagePercent) || 0) / 100);
      const costPerUnit = ctx.costOverrides?.has(String(item._id))
        ? Number(ctx.costOverrides.get(String(item._id))) || 0
        : Number(item.averageCost) || 0;
      const lineCost = money(effective * costPerUnit);
      cost += lineCost;
      lines.push({
        inventoryItemId: String(item._id),
        itemName: item.name || comp.itemName,
        unit: itemUnit,
        quantity: qty(effective),
        theoreticalQuantity: qty(theoretical),
        costPerUnit: money(costPerUnit),
        lineCost,
        componentType: 'ingredient',
        path: sequencePath,
        missingCost: costPerUnit <= 0,
      });
    }

    return { cost, lines };
  }

  private amountInUnit(quantity: number, fromUnit: string, toUnit: string, label: string): number {
    try {
      return convertQuantity(quantity, fromUnit, toUnit);
    } catch (err: any) {
      throw new AppError(
        400,
        `${label}: ${err.message || 'unit conversion failed'} (sub-recipe yields in ${toUnit})`
      );
    }
  }

  private async loadRecipe(id: mongoose.Types.ObjectId | string, ctx: Ctx): Promise<any> {
    const key = String(id);
    // Cycle protection FIRST — a cached recipe is only safe when it is not on
    // the current recursion path (a diamond dependency is fine; a loop is not).
    if (ctx.stack.includes(key)) {
      throw new AppError(400, 'Circular sub-recipe reference detected');
    }
    if (ctx.stack.length >= MAX_RECIPE_DEPTH) {
      throw new AppError(400, 'Sub-recipe nesting too deep (max 10 levels)');
    }
    if (ctx.recipeCache.has(key)) return ctx.recipeCache.get(key);
    if (!mongoose.Types.ObjectId.isValid(key)) throw new AppError(400, 'Invalid sub-recipe id');
    const sub = await Recipe.findOne({
      _id: key,
      restaurantId: ctx.restaurantId,
      isDeleted: { $ne: true },
    }).lean().exec();
    if (!sub) throw new AppError(404, 'Sub-recipe not found in your restaurant');
    ctx.stack.push(key);
    try {
      ctx.recipeCache.set(key, sub);
      return sub;
    } finally {
      ctx.stack.pop();
    }
  }

  private async loadProduct(id: mongoose.Types.ObjectId | string, ctx: Ctx): Promise<any> {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError(400, 'Invalid inventory item id');
    const product = await productRepo.findOne({
      _id: id,
      restaurantId: ctx.restaurantId,
      isDeleted: { $ne: true },
    } as any);
    if (!product) return null;
    return product;
  }

  private async sellingPrice(doc: any, restaurantId: string, branchId: string | undefined, ctx: Ctx): Promise<number> {
    const productId = String(doc.productId);
    if (ctx.priceOverrides?.has(productId)) return Number(ctx.priceOverrides.get(productId)) || 0;
    if (!mongoose.Types.ObjectId.isValid(productId)) return 0;

    // Variant override recipe → the variant's own price (branch override wins).
    const variantName = doc.variantName ? String(doc.variantName).trim() : '';
    if (variantName) {
      // 1. Legacy ProductVariant collection (product-manager-created variants).
      try {
        const variant = await ProductVariant.findOne({
          productId,
          name: variantName,
          isDeleted: { $ne: true },
        }).lean().exec();
        if (variant) {
          let price = Number(variant.price) || 0;
          if (branchId && variant.branchPrice?.get) {
            const override = variant.branchPrice.get(String(branchId));
            if (typeof override === 'number') price = override;
          }
          return price;
        }
      } catch { /* no variant row → try menuConfig options below */ }

      // 2. menuConfig variant template options (the ProductRegistrationWizard
      // writes these, not ProductVariant rows). Price = base + option delta.
      const mcPrice = await this.menuConfigVariantPrice(productId, variantName, restaurantId);
      if (mcPrice !== null) return mcPrice;
    }

    const product = await productRepo.findOne({
      _id: productId,
      restaurantId,
      isDeleted: { $ne: true },
    } as any);
    if (!product) return 0;
    let price = Number(product.price) || 0;
    if (branchId && product.branchPrice?.get) {
      const override = product.branchPrice.get(String(branchId));
      if (typeof override === 'number') price = override;
    }
    return price;
  }

  /** Resolve a variant option's price from the product's menuConfig variant
   *  templates. Returns null when the product has no variant config (or the
   *  variant name is unknown) so the caller falls back to the base price. */
  private async menuConfigVariantPrice(productId: string, variantName: string, restaurantId: string): Promise<number | null> {
    try {
      const resolved = await resolveProductConfiguration(restaurantId, productId);
      if (!resolved?.variantGroups?.length) return null;
      const needle = variantName.trim().toLowerCase();
      for (const group of resolved.variantGroups) {
        const opt = (group.options || []).find(
          (o) => o.active !== false && String(o.name).trim().toLowerCase() === needle
        );
        if (opt) {
          return round2((Number(resolved.product.baseProductPrice) || 0) + (Number(opt.priceDelta) || 0));
        }
      }
      return null;
    } catch {
      // Resolution failure (archived/missing template) — fall back to base price.
      return null;
    }
  }
}

export const recipeCostEngine = new RecipeCostEngine();

export { familyOf };

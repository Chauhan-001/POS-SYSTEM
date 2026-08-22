/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecipeResolutionService — the single source of truth for "which recipe
 * effectively produces product X for variant V today?"
 *
 * Model: a product has ONE base recipe (recipeMode 'base', variantName empty)
 * and OPTIONAL per-variant override recipes (recipeMode 'override', variantName
 * = the option name). A variant with NO override recipe INHERITS the base
 * recipe at resolve time — it never silently results in zero consumption.
 * Only a variant whose product has NO base recipe AND NO override recipe ends
 * up with zero consumption, surfaced as a HIGH-severity coverage gap in the
 * Recipe Manager status list.
 *
 * Consumers (consumption, bill economics, editor previews, AI quick-create)
 * all go through resolveEffectiveRecipe so behaviour is consistent everywhere.
 */

import mongoose from 'mongoose';
import { Recipe, Product, ProductVariant } from '../../../models';
import { AppError } from '../../../utils/AppError';
import { recipeCostEngine } from './recipeCostEngine';

/** How a variant resolved. 'exact' = its own override recipe;
 *  'inherit' = fell back to the base recipe; 'none' = no recipe available. */
export type ResolutionMode = 'exact' | 'inherit' | 'none';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CoverageWarning {
  severity: Severity;
  code: string;
  message: string;
}

export interface RecipeResolution {
  mode: ResolutionMode;
  variantName?: string;
  /** recipe id used (override, or the base recipe id when inheriting). */
  sourceRecipeId?: string;
  /** true when the effective recipe is a resolved-in-memory copy (never stored). */
  inherited?: boolean;
  warning?: CoverageWarning;
}

export interface EffectiveRecipeResult {
  recipe: any | null;
  version: number;
  recipeName: string;
  resolution: RecipeResolution;
}

export interface VariantCoverage {
  name: string;
  status: 'configured' | 'draft' | 'missing';
  overrideRecipeId?: string;
  warning?: CoverageWarning;
}

export interface ProductRecipeStatus {
  productId: string;
  productName: string;
  variants: VariantCoverage[];
  configuredVariantCount: number;
  missingVariantCount: number;
  warnings: CoverageWarning[];
}

export class RecipeResolutionService {
  /**
   * Resolve the effective ACTIVE recipe for a product+variant. Never throws
   * for misses — it returns { recipe: null, resolution.mode: 'none' } so the
   * caller can decide severity.
   *
   * Variant-only model: every recipe belongs to exactly one variant, there is
   * no base recipe and no inheritance. A variant with no active recipe resolves
   * 'none'. A PLAIN sale (no variantName) only resolves when the product has no
   * variants — via its virtual 'Default' recipe. Products WITH variants require
   * a variant at billing time (plain sales consume nothing).
   */
  async resolveEffectiveRecipe(
    restaurantId: string,
    productId: string,
    variantName?: string,
    _opts: { date?: string } = {}
  ): Promise<EffectiveRecipeResult> {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(productId)) {
      return { recipe: null, version: 0, recipeName: '', resolution: { mode: 'none' } };
    }
    const recipes: any[] = await Recipe.find({
      restaurantId,
      productId,
      status: 'active',
      isDeleted: { $ne: true },
    }).lean().exec();

    let v = (variantName || '').trim();
    if (!v) {
      if (await this.productHasVariants(restaurantId, productId)) {
        return {
          recipe: null,
          version: 0,
          recipeName: '',
          resolution: {
            mode: 'none',
            warning: {
              severity: 'HIGH',
              code: 'variant_required',
              message: 'This product has variants — a variant must be selected; plain sales consume nothing.',
            },
          },
        };
      }
      v = 'Default';
    }

    // Backward-compat: a legacy base recipe (empty variantName) still resolves
    // as the 'Default' recipe until the migration archives it.
    const effective = recipes.find((r: any) =>
      (r.variantName && String(r.variantName).trim() === v) || (v === 'Default' && !r.variantName)
    );
    if (effective) {
      return {
        recipe: effective,
        version: Number(effective.version) || 1,
        recipeName: effective.name || effective.productName || 'Recipe',
        resolution: { mode: 'exact', variantName: v },
      };
    }
    return {
      recipe: null,
      version: 0,
      recipeName: '',
      resolution: {
        mode: 'none',
        variantName: v,
        warning: {
          severity: 'HIGH',
          code: 'variant_no_recipe',
          message: `"${v}" has no active recipe — sold units consume nothing.`,
        },
      },
    };
  }

  /**
   * Recipe Manager status list — per menu product: per-variant coverage
   * (configured/draft/missing). Variant sources: ProductVariant records (POS
   * pricing) plus any variantName already observed on this product's recipes.
   * Products without variants expose the virtual 'Default' variant.
   */
  async listProductRecipeStatus(restaurantId: string, opts: { limit?: number } = {}): Promise<{
    products: ProductRecipeStatus[];
    summary: {
      products: number;
      configuredVariants: number;
      missingVariants: number;
      coveragePercent: number;
      high: number;
      medium: number;
      low: number;
    };
  }> {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) throw new AppError(400, 'Invalid restaurantId');
    const oid = new mongoose.Types.ObjectId(restaurantId);
    const limit = Math.min(Number(opts.limit) || 200, 500);

    const recipes: any[] = await Recipe.find({ restaurantId: oid, isDeleted: { $ne: true } })
      .select('productId productName variantName recipeMode sourceRecipeId status name')
      .lean().exec();

    const recipeProductIds = [...new Set(recipes.map((r: any) => String(r.productId)))];

    // Candidate products: any that have a recipe, PLUS menu products in the
    // restaurant (limited) so products that only DEFINE variants but have no
    // recipe are still surfaced as exposed coverage gaps.
    const menuProducts: any[] = await Product.find({
      restaurantId: oid,
      type: 'menu',
      isDeleted: { $ne: true },
    }).select('name').limit(500).lean().exec();
    let allProductIds = [...new Set([
      ...recipeProductIds,
      ...menuProducts.map((p: any) => String(p._id)),
    ])];
    if (allProductIds.length > 500) allProductIds = allProductIds.slice(0, 500);
    if (allProductIds.length === 0) return { products: [], summary: this.emptySummary() };

    const productById = new Map<string, string>();
    for (const p of menuProducts) productById.set(String(p._id), p.name);
    const namedRecipeProducts: any[] = await Product.find({
      _id: { $in: recipeProductIds.map((id) => new mongoose.Types.ObjectId(id)) },
      restaurantId: oid,
      isDeleted: { $ne: true },
    }).select('name').lean().exec();
    for (const p of namedRecipeProducts) {
      if (!productById.has(String(p._id))) productById.set(String(p._id), p.name);
    }

    const allVariantDocs: any[] = await ProductVariant.find({
      isDeleted: { $ne: true },
      productId: { $in: allProductIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).select('productId name').lean().exec();
    const productVariants = new Map<string, Set<string>>();
    for (const pv of allVariantDocs) {
      const set = productVariants.get(String(pv.productId)) || new Set<string>();
      set.add(pv.name);
      productVariants.set(String(pv.productId), set);
    }

    const rows: ProductRecipeStatus[] = [];
    let configuredVariants = 0;
    let missingVariants = 0;
    let high = 0;

    for (const productId of allProductIds) {
      const pr: any[] = recipes.filter((r: any) => String(r.productId) === productId);
      const active = pr.filter((r: any) => r.status === 'active');
      const overrideRecipes = pr.filter((r: any) => r.variantName);

      const observed = new Set<string>();
      for (const r of overrideRecipes) if (r.variantName) observed.add(r.variantName);
      const seen = new Set<string>();
      const variantNames: string[] = [];
      for (const name of [...(productVariants.get(productId)?.values() || []), ...observed]) {
        if (!name || seen.has(name)) continue;
        seen.add(name);
        variantNames.push(name);
      }
      // Products with no variants expose the virtual 'Default' variant.
      if (variantNames.length === 0) variantNames.push('Default');

      const variants: VariantCoverage[] = variantNames.map((name) => {
        const override = overrideRecipes.find((r: any) => r.variantName === name && r.status === 'active');
        const overrideDraft = overrideRecipes.find((r: any) => r.variantName === name && r.status !== 'active');
        if (override) {
          configuredVariants++;
          return { name, status: 'configured', overrideRecipeId: String(override._id) };
        }
        if (overrideDraft) {
          return { name, status: 'draft', overrideRecipeId: String(overrideDraft._id) };
        }
        missingVariants++;
        return {
          name,
          status: 'missing',
          warning: {
            severity: 'HIGH',
            code: 'variant_missing',
            message: `"${name}" has no recipe — sold units consume nothing.`,
          },
        };
      });

      const warnings: CoverageWarning[] = [];
      for (const v of variants) if (v.warning) warnings.push(v.warning);

      rows.push({
        productId,
        productName: productById.get(productId) || 'Unknown product',
        variants,
        configuredVariantCount: variants.filter((v) => v.status === 'configured').length,
        missingVariantCount: variants.filter((v) => v.status === 'missing').length,
        warnings,
      });
    }

    const poles = rows.reduce((s, r) => s + r.variants.length, 0);
    const costedPoles = rows.reduce((s, r) => s + r.configuredVariantCount, 0);

    rows.sort((a, b) => {
      const gap = (x: ProductRecipeStatus) =>
        x.missingVariantCount * 2 - x.configuredVariantCount;
      return gap(b) - gap(a);
    });

    return {
      products: rows.slice(0, limit),
      summary: {
        products: rows.length,
        configuredVariants,
        missingVariants,
        coveragePercent: poles > 0 ? Math.round((costedPoles / poles) * 100) : 0,
        high: rows.reduce((s, r) => s + r.warnings.filter((w) => w.severity === 'HIGH').length, 0),
        medium: rows.reduce((s, r) => s + r.warnings.filter((w) => w.severity === 'MEDIUM').length, 0),
        low: rows.reduce((s, r) => s + r.warnings.filter((w) => w.severity === 'LOW').length, 0),
      },
    };
  }

  /** Variant names for the Recipe Editor / EasyRecipeMaker variant picker.
   *  Products WITHOUT variants expose the virtual 'Default' variant. */
  async getVariantsForProduct(restaurantId: string, productId: string): Promise<string[]> {
    if (!mongoose.Types.ObjectId.isValid(restaurantId) || !mongoose.Types.ObjectId.isValid(productId)) {
      throw new AppError(400, 'Invalid ids');
    }
    const names: string[] = [];
    const seen = new Set<string>();
    const pvs: any[] = await ProductVariant.find({ productId, isDeleted: { $ne: true } })
      .select('name').lean().exec();
    for (const pv of pvs) {
      if (!seen.has(pv.name)) { seen.add(pv.name); names.push(pv.name); }
    }
    const recipes: any[] = await Recipe.find({
      restaurantId,
      productId,
      variantName: { $exists: true, $ne: null },
    }).select('variantName').lean().exec();
    for (const r of recipes) {
      if (r.variantName && !seen.has(r.variantName)) { seen.add(r.variantName); names.push(r.variantName); }
    }
    if (names.length === 0) names.push('Default');
    return names;
  }

  /** True when the product has REAL variants (ProductVariant rows or menuConfig
   *  variant groups). Variant-less products only have the virtual 'Default'. */
  private async productHasVariants(restaurantId: string, productId: string): Promise<boolean> {
    if (await ProductVariant.exists({ productId, isDeleted: { $ne: true } }).lean().exec()) return true;
    const product = await Product.findOne({ _id: productId, restaurantId, isDeleted: { $ne: true } })
      .select('menuConfig').lean().exec();
    return !!(product?.menuConfig?.variantConfigurations?.length);
  }

  /**
   * Copy a recipe's ingredients onto a variant as an independent recipe.
   *
   * The source is any non-archived recipe of the same product (e.g. another
   * variant). The target is created/replaced as a DRAFT by default (copying
   * never silently activates). Every component is DEEP-CLONED into a fresh
   * array — the target and source can never share mutable data.
   *
   * Target semantics:
   *   - no target recipe            → create a new recipe (draft unless
   *                                   ctx.status is explicitly 'active').
   *   - target DRAFT recipe         → replace its components in place, keep
   *                                   draft (or activate if ctx.status='active').
   *   - target ACTIVE recipe        → leave the active recipe untouched and
   *                                   create a NEW draft recipe alongside it
   *                                   (the merchant reviews the draft, then
   *                                   activates it to supersede the old one).
   */
  async copyVariantRecipe(
    restaurantId: string,
    sourceRecipeId: string,
    targetVariantName: string,
    ctx: { operator?: string; status?: 'draft' | 'active' } = {},
    components?: any[]
  ): Promise<any> {
    const targetVariant = (targetVariantName || '').trim();
    if (!targetVariant) throw new AppError(400, 'variantName is required');
    if (!mongoose.Types.ObjectId.isValid(sourceRecipeId)) throw new AppError(400, 'Invalid source recipe id');

    const source: any = await Recipe.findOne({
      _id: sourceRecipeId,
      restaurantId,
      isDeleted: { $ne: true },
      status: { $ne: 'archived' },
    }).lean().exec();
    if (!source) throw new AppError(404, 'Source recipe not found in your restaurant');

    // The target variant must belong to the SAME product as the source. A
    // variant can never be copied from a recipe of a different product.
    // `getVariantsForProduct` includes the virtual 'Default' for variant-less
    // products, so the 'Default' variant is always a valid copy target.
    const knownVariants = await this.getVariantsForProduct(restaurantId, String(source.productId));
    if (!knownVariants.includes(targetVariant)) {
      throw new AppError(
        400,
        `"${targetVariant}" is not a variant of "${source.productName}" — recipes can only be copied within the same product.`
      );
    }

    const srcComponents = (components && Array.isArray(components) && components.length > 0
      ? components
      : source.components || [])
      .map((c: any) => ({
        inventoryItemId: c.inventoryItemId || null,
        itemName: c.itemName,
        unit: c.unit,
        quantity: c.quantity,
        normalizedQuantity: c.normalizedQuantity ?? c.quantity,
        normalizedUnit: c.normalizedUnit ?? c.unit,
        componentType: c.componentType || 'ingredient',
        subRecipeId: c.subRecipeId || null,
        wastagePercent: c.wastagePercent || 0,
        optional: c.optional || false,
        notes: c.notes || '',
        sequence: c.sequence ?? 0,
        componentSource: 'copy' as const,
      }));

    const existing = await Recipe.findOne({
      restaurantId,
      productId: source.productId,
      variantName: targetVariant,
      isDeleted: { $ne: true },
      recipeMode: 'override',
    }).lean().exec();

    const requestedActive = ctx.status === 'active';
    const finalStatus: 'draft' | 'active' = requestedActive ? 'active' : 'draft';

    // Target already has a DRAFT override → replace its components in place.
    if (existing && existing.status !== 'active') {
      const doc: any = await Recipe.findOne({ _id: existing._id, restaurantId, isDeleted: { $ne: true } }).exec();
      doc.components = srcComponents;
      doc.sourceRecipeId = null;
      doc.status = finalStatus;
      doc.name = `${source.productName} (${targetVariant}) Recipe`;
      doc.updatedBy = ctx.operator;
      const cost = await recipeCostEngine.costRecipe(doc, { restaurantId });
      doc.costSummary = this.toCostSummary(cost);
      await doc.save();
      if (requestedActive) {
        await this.archiveStaleSiblings(restaurantId, String(doc._id), String(source.productId), targetVariant, ctx.operator);
      }
      return Recipe.findOne({ _id: existing._id, restaurantId, isDeleted: { $ne: true } }).lean().exec();
    }

    // Target has an ACTIVE override → create a fresh DRAFT alongside (the
    // active recipe is preserved until the draft is explicitly activated).
    const override: any = {
      restaurantId,
      branchId: source.branchId || null,
      productId: source.productId,
      productName: source.productName,
      variantName: targetVariant,
      recipeMode: 'override',
      sourceRecipeId: null,
      name: `${source.productName} (${targetVariant}) Recipe`,
      description: source.description || '',
      status: finalStatus,
      version: 1,
      effectiveFrom: source.effectiveFrom || new Date().toISOString().slice(0, 10),
      yieldQuantity: source.yieldQuantity,
      yieldUnit: source.yieldUnit,
      servingSize: source.servingSize,
      preparationNotes: source.preparationNotes,
      components: srcComponents,
      createdBy: ctx.operator,
      updatedBy: ctx.operator,
    };

    const cost = await recipeCostEngine.costRecipe(override, { restaurantId });
    override.costSummary = this.toCostSummary(cost);

    const created = await Recipe.create(override);
    if (requestedActive) {
      await this.archiveStaleSiblings(restaurantId, String(created._id), String(source.productId), targetVariant, ctx.operator);
    }
    return Recipe.findOne({ _id: created._id, restaurantId, isDeleted: { $ne: true } }).lean().exec();
  }

  /**
   * One-time migration to the variant-only model: every recipe with an empty
   * variantName (the old "base" recipe) becomes variant-scoped.
   *   - product with NO variants → rename the recipe to the 'Default' variant.
   *   - product WITH variants    → clone the base's components onto every
   *     variant lacking a recipe (same status, so consumption continues), then
   *     archive the base.
   * `opts.dry` plans without writing. Returns counts.
   */
  async migrateRemoveBaseRecipes(opts: { restaurantId?: string; dry?: boolean } = {}): Promise<{
    processed: number; renamed: number; copied: number; archived: number; skipped: number; errors: number;
  }> {
    const query: any = { variantName: { $in: [null, ''] }, isDeleted: { $ne: true } };
    if (opts.restaurantId) query.restaurantId = opts.restaurantId;
    const bases: any[] = await Recipe.find(query).lean().exec();
    const out = { processed: bases.length, renamed: 0, copied: 0, archived: 0, skipped: 0, errors: 0 };

    for (const base of bases) {
      const rid = base.restaurantId ? String(base.restaurantId) : '';
      if (!rid) { out.skipped++; continue; }
      const product: any = await Product.findOne({ _id: base.productId, isDeleted: { $ne: true } }).lean().exec();
      if (!product) { out.skipped++; continue; }

      const variantRows: any[] = await ProductVariant.find({ productId: base.productId, isDeleted: { $ne: true } }).lean().exec();
      const menuConfigVariants = (product.menuConfig?.variantConfigurations || [])
        .flatMap((g: any) => (g.options || []).map((o: any) => o.name).filter(Boolean));
      const variantNames = [...new Set([...variantRows.map((v) => v.name), ...menuConfigVariants])];

      if (variantNames.length === 0) {
        if (!opts.dry) {
          await Recipe.updateOne(
            { _id: base._id },
            { $set: { variantName: 'Default', recipeMode: 'override', sourceRecipeId: null, name: `${base.productName || product.name} (Default) Recipe`, updatedBy: 'migration' } }
          );
        }
        out.renamed++;
        continue;
      }

      for (const vn of variantNames) {
        const existing: any = await Recipe.findOne({ productId: base.productId, variantName: vn, isDeleted: { $ne: true } }).lean().exec();
        if (existing) { out.skipped++; continue; }
        try {
          if (!opts.dry) {
            const draft: any = {
              restaurantId: base.restaurantId,
              branchId: base.branchId || null,
              productId: base.productId,
              productName: base.productName,
              variantName: vn,
              recipeMode: 'override',
              sourceRecipeId: null,
              name: `${base.productName} (${vn}) Recipe`,
              description: base.description || '',
              status: base.status,
              version: 1,
              effectiveFrom: base.effectiveFrom || new Date().toISOString().slice(0, 10),
              yieldQuantity: base.yieldQuantity,
              yieldUnit: base.yieldUnit,
              servingSize: base.servingSize,
              preparationNotes: base.preparationNotes,
              components: (base.components || []).map((c: any) => ({ ...c, componentSource: 'copy' })),
              createdBy: 'migration',
              updatedBy: 'migration',
            };
            const cost = await recipeCostEngine.costRecipe(draft, { restaurantId: rid });
            draft.costSummary = this.toCostSummary(cost);
            await Recipe.create(draft);
          }
          out.copied++;
        } catch { out.errors++; }
      }

      if (!opts.dry) {
        await Recipe.updateOne(
          { _id: base._id },
          { $set: { status: 'archived', effectiveTo: new Date().toISOString().slice(0, 10), updatedBy: 'migration' } }
        );
      }
      out.archived++;
    }
    return out;
  }

  /**
   * Reset a variant's recipe back to "no recipe": archives the variant's
   * recipe (history preserved). There is no base recipe to fall back to — the
   * variant becomes a 'missing' coverage gap until a new recipe is saved.
   * Kept for API compatibility; the editor no longer offers this action.
   */
  async resetVariantToBase(
    restaurantId: string,
    overrideRecipeId: string,
    ctx: { operator?: string } = {}
  ): Promise<{ success: boolean; archivedRecipe: string; variantName?: string; nowInheritsBase: boolean }> {
    if (!mongoose.Types.ObjectId.isValid(overrideRecipeId)) throw new AppError(400, 'Invalid recipe id');
    const recipe: any = await Recipe.findOne({ _id: overrideRecipeId, restaurantId, isDeleted: { $ne: true } }).exec();
    if (!recipe) throw new AppError(404, 'Recipe not found in your restaurant');
    if (!recipe.variantName) {
      throw new AppError(400, 'Only a variant recipe can be reset');
    }

    recipe.status = 'archived';
    recipe.effectiveTo = recipe.effectiveTo || new Date().toISOString().slice(0, 10);
    recipe.updatedBy = ctx.operator;
    await recipe.save();
    return {
      success: true,
      archivedRecipe: String(recipe._id),
      variantName: recipe.variantName,
      nowInheritsBase: false,
    };
  }

  /**
   * Data-hygiene sweep — surfaces inconsistencies so the Recipe Manager can
   * offer repair, and tests can assert invariants. Read-only.
   */
  async sweep(restaurantId: string): Promise<{
    problems: Array<{ kind: string; severity: Severity; message: string; recipeId?: string; productId?: string }>;
  }> {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) throw new AppError(400, 'Invalid restaurantId');
    const recipes: any[] = await Recipe.find({ restaurantId, isDeleted: { $ne: true } }).lean().exec();
    const problems: Array<{ kind: string; severity: Severity; message: string; recipeId?: string; productId?: string }> = [];

    for (const r of recipes) {
      // Legacy leftovers: a recipe without a variant (pre-migration base recipe).
      if (!r.variantName || !String(r.variantName).trim()) {
        problems.push({
          kind: 'recipe_without_variant',
          severity: 'MEDIUM',
          message: `Recipe "${r.name}" has no variantName — every recipe must belong to a variant. Run the base-recipe migration.`,
          recipeId: String(r._id),
          productId: String(r.productId),
        });
      }
    }
    return { problems };
  }

  private emptySummary() {
    return {
      products: 0,
      configuredVariants: 0,
      missingVariants: 0,
      coveragePercent: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
  }

  private toCostSummary(cost: any) {
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

  private async archiveStaleSiblings(
    restaurantId: string,
    exceptId: string,
    productId: string,
    variantName: string,
    operator?: string
  ) {
    const siblings: any[] = await Recipe.find({
      restaurantId,
      productId,
      variantName,
      status: 'active',
      isDeleted: { $ne: true },
      _id: { $ne: exceptId },
    }).exec();
    for (const sib of siblings) {
      sib.status = 'archived';
      sib.effectiveTo = new Date().toISOString().slice(0, 10);
      sib.updatedBy = operator;
      await sib.save();
    }
  }
}

export const recipeResolutionService = new RecipeResolutionService();
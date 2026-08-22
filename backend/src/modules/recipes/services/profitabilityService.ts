/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProfitabilityService — PRODUCT and OFFER profitability (Phases 15–16, 17).
 *
 * Product profitability comes from the house cost source (Product.averageCost
 * through the RecipeCostEngine — nothing hardcoded) and the actual selling
 * price (base or branch override). Tax is NEVER mixed into cost: all margin
 * math is on pre-GST prices, consistent with the billing system where GST is
 * collected on top of the menu price.
 *
 * Offer profitability: for a draft or active offer, each applicable product
 * gets its normal contribution and its discounted contribution. Warnings are
 * advisory only — the system never auto-blocks an offer.
 */

import mongoose from 'mongoose';
import { Recipe, Product, BillItem, ProductVariant } from '../../../models';
import Offer from '../../../models/Offer';
import { AppError } from '../../../utils/AppError';
import { recipeCostEngine, RecipeCostResult } from './recipeCostEngine';
import { round2 } from './unitConversion';

const money = (n: number) => round2(n);

export class ProfitabilityService {
  /**
   * Product profitability over a date range: recipe cost vs selling price vs
   * actual units sold. Server-side aggregation — no bulk data to the client.
   */
  async productProfitability(restaurantId: string, opts: { startDate?: string; endDate?: string; branchId?: string } = {}) {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) throw new AppError(400, 'Invalid restaurantId');
    const oid = new mongoose.Types.ObjectId(restaurantId);
    const start = opts.startDate || '2000-01-01';
    const end = opts.endDate || '2999-12-31';

    // Menu products that have an active recipe.
    const recipes = await Recipe.find({
      restaurantId: oid,
      status: 'active',
      isDeleted: { $ne: true },
    }).lean().exec();
    if (recipes.length === 0) {
      return { rows: [], summary: this.emptySummary() };
    }

    const productIds = recipes.map((r: any) => r.productId);
    const products: any[] = await Product.find({
      _id: { $in: productIds },
      restaurantId: oid,
      isDeleted: { $ne: true },
    }).lean().exec();
    const productById = new Map(products.map((p: any) => [String(p._id), p]));

    // Products that have REAL variants (ProductVariant rows or menuConfig
    // variant groups) NEVER have a Default/base recipe. Any recipe stored with
    // variantName 'Default'/empty on such a product is legacy — it must be
    // excluded so it can't appear as a ₹0-priced phantom row.
    const variantProductIds = await this.productsWithVariants(restaurantId, products);

    // Actual units sold per menu item (server-side aggregation over BillItem).
    const sold: any[] = await BillItem.aggregate([
      {
        $match: {
          menuItemId: { $in: productIds.map((id) => String(id)) },
          createdAt: { $gte: new Date(start + 'T00:00:00.000Z'), $lte: new Date(end + 'T23:59:59.999Z') },
        },
      },
      { $group: { _id: '$menuItemId', unitsSold: { $sum: '$quantity' }, revenue: { $sum: { $multiply: ['$quantity', '$priceAtSale'] } } } },
    ]).exec();
    const soldById = new Map(sold.map((s) => [String(s._id), s]));

    const rows: any[] = [];
    for (const recipe of recipes) {
      const product = productById.get(String(recipe.productId));
      if (!product) continue;
      const variantName = String(recipe.variantName || '').trim();
      if (variantProductIds.has(String(product._id)) && (variantName === '' || variantName === 'Default')) continue;
      // Cost + selling price are resolved by the engine — it handles branch
      // overrides AND variant prices (ProductVariant rows + menuConfig variant
      // template options). Never pass a base-price override here, or variant
      // products (whose base price is 0) would report ₹0 selling prices.
      const cost: RecipeCostResult = await recipeCostEngine.costRecipe(recipe, {
        restaurantId,
        branchId: opts.branchId,
      });
      const sellingPrice = money(cost.sellingPrice);
      const unitsSold = Number(soldById.get(String(product._id))?.unitsSold) || 0;
      const revenue = money(Number(soldById.get(String(product._id))?.revenue) || 0);
      const contribution = money(sellingPrice - cost.recipeCost);
      rows.push({
        productId: String(product._id),
        productName: product.name,
        variantName: recipe.variantName || undefined,
        recipeId: String(recipe._id),
        sellingPrice,
        recipeCost: cost.recipeCost,
        foodCostPercent: cost.foodCostPercent,
        contribution,
        contributionMarginPercent: cost.contributionMarginPercent,
        unitsSold,
        revenue,
        totalContribution: money(contribution * unitsSold),
      });
    }

    rows.sort((a, b) => b.unitsSold - a.unitsSold);
    const totalRevenue = money(rows.reduce((s, r) => s + r.revenue, 0));
    const totalCost = money(rows.reduce((s, r) => s + r.recipeCost * r.unitsSold, 0));
    const totalContribution = money(rows.reduce((s, r) => s + r.totalContribution, 0));
    return {
      rows,
      summary: {
        products: rows.length,
        unitsSold: rows.reduce((s, r) => s + r.unitsSold, 0),
        totalRevenue,
        totalCost,
        totalContribution,
        overallFoodCostPercent: totalRevenue > 0 ? round2((totalCost / totalRevenue) * 100) : 0,
      },
    };
  }

  /**
   * Offer profitability — normal vs discounted contribution per applicable
   * product, with advisory warnings. Never blocks the offer.
   */
  async offerProfitability(restaurantId: string, offerId: string) {
    if (!mongoose.Types.ObjectId.isValid(offerId)) throw new AppError(400, 'Invalid offer id');
    const offer = await Offer.findOne({ _id: offerId, restaurantId, isDeleted: { $ne: true } }).lean().exec();
    if (!offer) throw new AppError(404, 'Offer not found in your restaurant');
    return this.offerEconomics(restaurantId, offer);
  }

  /**
   * Economics for an offer-shaped config (draft or persisted) — used by the
   * offer creator preview and the AI offer assistant. Deterministic and
   * tenant-scoped; advisory warnings only, never auto-blocks.
   */
  async offerEconomics(restaurantId: string, offer: any) {

    // Applicable products: explicit product ids, or category match.
    const query: any = { restaurantId, isDeleted: { $ne: true }, type: 'menu' };
    const explicitIds = (offer.applicableProductIds || []).filter((id: any) => mongoose.Types.ObjectId.isValid(id));
    if (explicitIds.length > 0) {
      query._id = { $in: explicitIds };
    } else if ((offer.applicableCategories || []).length > 0) {
      query.category = { $in: offer.applicableCategories };
    }
    const products: any[] = await Product.find(query).limit(200).lean().exec();
    if (products.length === 0) {
      return { rows: [], warnings: [], offer: { title: offer.title, type: offer.type, value: offer.value } };
    }

    // Recipe costs for the applicable products (active recipes only). Products
    // with REAL variants never use a Default/base recipe — drop legacy ones.
    const recipes: any[] = await Recipe.find({
      restaurantId,
      status: 'active',
      isDeleted: { $ne: true },
      productId: { $in: products.map((p: any) => p._id) },
    }).lean().exec();
    const variantProductIds = await this.productsWithVariants(restaurantId, products);
    const recipeByProduct = new Map();
    for (const r of recipes) {
      const vName = String(r.variantName || '').trim();
      if (variantProductIds.has(String(r.productId)) && (vName === '' || vName === 'Default')) continue;
      recipeByProduct.set(String(r.productId), r);
    }

    const rows: any[] = [];
    const warnings: string[] = [];
    for (const product of products) {
      const price = this.effectivePrice(product);
      const recipe = recipeByProduct.get(String(product._id));
      const recipeCost = recipe
        ? (await recipeCostEngine.costRecipe(recipe, { restaurantId })).recipeCost
        : 0;
      const normalContribution = money(price - recipeCost);
      const discountedPrice = this.discountedPrice(offer, price);
      const discountedContribution = money(discountedPrice - recipeCost);
      const contributionDropPercent = normalContribution > 0
        ? round2(((normalContribution - discountedContribution) / normalContribution) * 100)
        : 0;

      if (recipe && discountedContribution <= 0) {
        warnings.push(
          `${product.name}: discounted price ${money(discountedPrice)} is at/below recipe cost ${recipeCost} — this offer loses money per unit.`
        );
      } else if (recipe && contributionDropPercent >= 50) {
        warnings.push(
          `${product.name}: discount cuts contribution by ${contributionDropPercent}% (${money(normalContribution)} → ${money(discountedContribution)}).`
        );
      }

      rows.push({
        productId: String(product._id),
        productName: product.name,
        sellingPrice: price,
        recipeCost,
        hasRecipe: !!recipe,
        normalContribution,
        discountedPrice,
        discountedContribution,
        contributionDropPercent,
        contributionMarginPercent: price > 0 ? round2((normalContribution / price) * 100) : 0,
      });
    }

    rows.sort((a, b) => a.contributionDropPercent - b.contributionDropPercent);

    // ─── Combo economics (bundle-level, not per-product rows) ────────────
    if (offer.type === 'combo' && products.length > 1) {
      const individualValue = money(products.reduce((s, p: any) => s + this.effectivePrice(p), 0));
      const comboPrice = money(Number(offer.value) || 0);
      const recipeCosts: number[] = [];
      for (const product of products) {
        const recipe = recipeByProduct.get(String(product._id));
        if (!recipe) continue;
        const r = await recipeCostEngine.costRecipe(recipe, { restaurantId });
        recipeCosts.push(r.recipeCost);
      }
      const estVariableCost = money(recipeCosts.reduce((s, c) => s + c, 0));
      const customerSavings = money(individualValue - comboPrice);
      const contribution = money(comboPrice - estVariableCost);
      const marginPercent = comboPrice > 0 ? round2((contribution / comboPrice) * 100) : 0;
      const status = contribution <= 0 ? 'negative' : marginPercent < 20 ? 'tight' : 'healthy';
      if (contribution <= 0) {
        warnings.push(
          `Combo price ${money(comboPrice)} is at/below total variable cost ${money(estVariableCost)} — this combo loses money per unit.`
        );
      } else if (marginPercent < 20) {
        warnings.push(
          `Combo margin is tight at ${marginPercent}% (${money(comboPrice)} price vs ${money(estVariableCost)} variable cost). Consider ${money(comboPrice + Math.ceil((estVariableCost * 1.25 - comboPrice) / 5) * 5)} or higher.`
        );
      }
      return {
        rows: [],
        warnings,
        offer: { title: offer.title, type: offer.type, value: offer.value },
        combo: {
          individualValue,
          comboPrice,
          customerSavings: Math.max(0, customerSavings),
          estVariableCost,
          contribution,
          contributionMarginPercent: marginPercent,
          status,
          withRecipes: recipeCosts.length,
          products: products.length,
        },
        summary: { products: products.length, withRecipes: recipeCosts.length, avgContributionDrop: 0 },
      };
    }

    return {
      rows,
      warnings,
      offer: {
        title: offer.title,
        type: offer.type,
        value: offer.value,
        comboPrice: offer.comboPrice,
        freeItemId: offer.freeItemId,
      },
      summary: {
        products: rows.length,
        withRecipes: rows.filter((r) => r.hasRecipe).length,
        avgContributionDrop: rows.length > 0
          ? round2(rows.reduce((s, r) => s + r.contributionDropPercent, 0) / rows.length)
          : 0,
      },
    };
  }

  /**
   * Bill-level economics for the ORDER SCREEN — shown when a cashier applies
   * an offer or has a combo on the bill. Read-only, tenant-scoped, fully
   * deterministic: the cost side (recipeCostEngine) is authoritative server
   * math; the revenue side uses the subtotal the bill actually charges and
   * the discount already validated by /offers/validate. Never blocks the
   * sale — it is a plain-language display aid for staff.
   */
  async billEconomics(restaurantId: string, input: any = {}) {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) throw new AppError(400, 'Invalid restaurantId');
    const oid = new mongoose.Types.ObjectId(restaurantId);

    // Guard against a malformed body (items must be an array).
    const rawItems: any[] = Array.isArray(input.items) ? input.items : [];
    const validItems = rawItems.slice(0, 200).filter(
      (i) => i && typeof i === 'object' && mongoose.Types.ObjectId.isValid(i.productId)
    );
    if (validItems.length === 0) {
      return { rows: [], subtotal: 0, discount: 0, revenueAfterDiscount: 0, estVariableCost: 0, contribution: 0, contributionMarginPercent: 0, verdict: 'no-cost-data', costedItems: 0, totalItems: 0 };
    }

    const productIds = [...new Set(validItems.map((i) => String(i.productId)))];
    const products: any[] = await Product.find({
      _id: { $in: productIds },
      restaurantId: oid,
      isDeleted: { $ne: true },
    }).lean().exec();
    const productById = new Map(products.map((p: any) => [String(p._id), p]));

    // Active recipes for the products on the bill (variant-aware, same match
    // semantics as consumptionService.resolveRecipeVersion).
    const recipes: any[] = await Recipe.find({
      restaurantId: oid,
      status: 'active',
      isDeleted: { $ne: true },
      productId: { $in: products.map((p: any) => p._id) },
    }).lean().exec();
    const recipeByKey = new Map<string, any>();
    for (const r of recipes) {
      recipeByKey.set(`${String(r.productId)}::${r.variantName || ''}`, r);
    }

    let subtotal = 0;
    let estVariableCost = 0;
    let costedItems = 0;
    const rows: any[] = [];
    for (const item of validItems) {
      const product = productById.get(String(item.productId));
      if (!product) continue;
      const qty = Math.max(0, Number(item.quantity) || 1);
      // The bill's real line price (variant/base/branch) wins when provided;
      // it is display-only — the COST side is always authoritative server math.
      const providedPrice = Number(item.price);
      const price = Number.isFinite(providedPrice) && providedPrice > 0
        ? money(providedPrice)
        : this.effectivePrice(product, input.branchId);
      const lineSubtotal = money(price * qty);
      subtotal = money(subtotal + lineSubtotal);

      // Variant resolution mirrors consumptionService (variant-only model, no
      // inheritance). A variant line matches its own recipe; a plain line
      // matches the product's 'Default' recipe (products with variants have no
      // Default, so plain lines get no cost). Legacy base recipes still resolve
      // as Default until the migration archives them.
      const variant = item.variantName || item.variant || (item.selectedVariant?.name);
      const recipe = variant
        ? (recipeByKey.get(`${String(product._id)}::${variant}`) || null)
        : (recipeByKey.get(`${String(product._id)}::Default`) || recipeByKey.get(`${String(product._id)}::`) || null);
      const resolvedMode = recipe ? 'exact' : undefined;
      let recipeCost = 0;
      if (recipe) {
        const cost = await recipeCostEngine.costRecipe(recipe, { restaurantId });
        recipeCost = money(cost.recipeCost);
        estVariableCost = money(estVariableCost + recipeCost * qty);
        costedItems++;
      }
      rows.push({
        productId: String(product._id),
        productName: product.name,
        variantName: variant || undefined,
        quantity: qty,
        sellingPrice: price,
        recipeCost,
        resolvedMode,
        hasRecipe: !!recipe,
        lineCost: money(recipeCost * qty),
      });
    }

    // Revenue side: the discount is the server-validated amount from
    // /offers/validate (already applies to this bill).
    const discount = money(Math.max(0, Number(input.discount) || 0));
    const revenueAfterDiscount = money(Math.max(0, subtotal - discount));
    const contribution = money(revenueAfterDiscount - estVariableCost);
    const contributionMarginPercent = revenueAfterDiscount > 0
      ? round2((contribution / revenueAfterDiscount) * 100)
      : 0;

    let verdict: 'healthy' | 'tight' | 'negative' | 'no-cost-data' = 'healthy';
    if (estVariableCost <= 0 || costedItems === 0) {
      verdict = 'no-cost-data';
    } else if (contribution <= 0) {
      verdict = 'negative';
    } else if (contributionMarginPercent < 20) {
      verdict = 'tight';
    }

    return {
      rows,
      subtotal: money(subtotal),
      discount,
      revenueAfterDiscount,
      estVariableCost: money(estVariableCost),
      contribution,
      contributionMarginPercent,
      verdict,
      costedItems,
      totalItems: rows.length,
    };
  }

  /** Single-product margin (used by the recipe editor for live feedback). */
  async productMargin(restaurantId: string, productId: string, recipeCost: number, branchId?: string) {
    if (!mongoose.Types.ObjectId.isValid(productId)) throw new AppError(400, 'Invalid product id');
    const product = await Product.findOne({ _id: productId, restaurantId, isDeleted: { $ne: true } }).lean().exec();
    if (!product) throw new AppError(404, 'Product not found in your restaurant');
    const price = this.effectivePrice(product, branchId);
    const cost = money(recipeCost);
    return {
      productId,
      productName: product.name,
      sellingPrice: price,
      recipeCost: cost,
      foodCostPercent: price > 0 ? round2((cost / price) * 100) : 0,
      contribution: money(price - cost),
      contributionMarginPercent: price > 0 ? round2(((price - cost) / price) * 100) : 0,
    };
  }

  private effectivePrice(product: any, branchId?: string): number {
    let price = Number(product.price) || 0;
    if (branchId && product.branchPrice?.get) {
      const override = product.branchPrice.get(String(branchId));
      if (typeof override === 'number') price = override;
    }
    return money(price);
  }

  /** Set of product ids that have REAL variants (ProductVariant rows or
   *  menuConfig variant template refs). Variant-less products only use the
   *  virtual 'Default' recipe. */
  private async productsWithVariants(restaurantId: string, products: any[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (products.length === 0) return out;
    const ids = products.map((p: any) => p._id);
    const rows = await ProductVariant.find({
      productId: { $in: ids },
      isDeleted: { $ne: true },
    }).select('productId').lean().exec();
    for (const v of rows) out.add(String(v.productId));
    for (const p of products) {
      if (out.has(String(p._id))) continue;
      if ((p.menuConfig as any)?.variantConfigurations?.length) out.add(String(p._id));
    }
    return out;
  }

  private discountedPrice(offer: any, price: number): number {
    const value = Number(offer.value) || 0;
    switch (offer.type) {
      case 'percentage':
        return money(price * (1 - Math.min(100, value) / 100));
      case 'flat':
        return money(Math.max(0, price - value));
      case 'bogo':
        // BOGO halves the effective unit price for the free unit.
        return money(price / 2);
      default:
        return money(price);
    }
  }

  private emptySummary() {
    return {
      products: 0,
      unitsSold: 0,
      totalRevenue: 0,
      totalCost: 0,
      totalContribution: 0,
      overallFoodCostPercent: 0,
    };
  }
}

export const profitabilityService = new ProfitabilityService();

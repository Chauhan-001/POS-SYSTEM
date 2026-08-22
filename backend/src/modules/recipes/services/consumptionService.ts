/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ConsumptionService — SALES → RECIPE → INVENTORY integration (Phases 10–12, 14).
 *
 * When a bill is finalized, every line item whose product has an ACTIVE recipe
 * resolves the recipe (at the version effective on the sale date) into
 * per-ingredient theoretical quantities with frozen weighted-average costs.
 * Those movements go through the SAME StockMovementService the whole POS uses
 * (type 'sale', clamped so billing never fails), and a RecipeConsumption
 * record is persisted as the snapshot-cost ledger + idempotency anchor.
 *
 * Idempotency: a unique { restaurantId, billId } index guarantees a bill is
 * consumed exactly once — API retries, offline queue replays and webhook
 * retries can never double-deduct inventory.
 *
 * Reversal: voided bills restore every consumed ingredient ('return'); refunds
 * restore the refunded portion. RecipeConsumption status flips so reports can
 * separate genuine consumption from reversals.
 *
 * Reconciliation (Phase 14): theoretical consumption (Σ consumption records)
 * vs ACTUAL stock movement (Σ InventoryEvent 'sold') per ingredient — the
 * variance surface for wastage/portion/shrinkage analysis. Never accuses
 * staff — it's an operational variance signal.
 */

import mongoose from 'mongoose';
import { Recipe, RecipeVersion, RecipeConsumption, Product, ProductVariant } from '../../../models';
import ConfigurationTemplate from '../../menu-config/models/ConfigurationTemplate';
import { inventoryEventRepo } from '../../../repositories';
import { AppError } from '../../../utils/AppError';
import { recipeCostEngine } from './recipeCostEngine';
import { recipeResolutionService } from './recipeResolutionService';
import { stockMovementService } from '../../../services/stockMovementService';
import { round2, round4 } from './unitConversion';

export interface ConsumptionCtx {
  restaurantId: string;
  branchId?: string;
  operator?: string;
}

/** The ACTIVE recipe for a product+variant, resolved to a version.
 *
 *  Resolution semantics (single source of truth: recipeResolutionService —
 *  VARIANT-ONLY model, no base recipe, no inheritance):
 *   - variant line with its own recipe   → consume the variant's recipe.
 *   - variant line with NO recipe        → null (zero consumption; the
 *     recipe-status list flags it HIGH).
 *   - plain line (no variant)            → the product's 'Default' recipe
 *     (products WITH variants have no Default — plain lines consume nothing).
 */
async function resolveRecipeVersion(restaurantId: string, productId: string, variantName: string | undefined, saleDate: string): Promise<{
  recipe: any;
  version: number;
  recipeName: string;
  resolution: any;
  costLines: Awaited<ReturnType<typeof recipeCostEngine.costRecipe>>['lines'];
} | null> {
  const resolved = await recipeResolutionService.resolveEffectiveRecipe(restaurantId, productId, variantName, { date: saleDate });
  if (!resolved.recipe) return null;

  const cost = await recipeCostEngine.costRecipe(resolved.recipe, { restaurantId });
  return {
    recipe: resolved.recipe,
    version: resolved.version,
    recipeName: resolved.recipeName,
    resolution: resolved.resolution,
    costLines: cost.lines,
  };
}

export class ConsumptionService {
  /**
   * Phase 4 — resolve the configuration-driven recipe layers for one bill line.
   *
   * A configured sale can consume MORE than its base recipe:
   *   BASE recipe          → the product's own active recipe (resolved per
   *                          variant via `variantName` by the caller)
   *   VARIANT/MODIFIER Δ   → each selected option whose `recipeMappingId`
   *                          points at a delta Recipe (e.g. "Cheese Burst" =
   *                          a tiny recipe that yields +80g cheese)
   *   ADD-ON               → each selected add-on whose `productId` references
   *                          another menu product → that product's own recipe
   *
   * Everything is tenant-scoped: templates AND delta recipes are looked up with
   * the bill's restaurantId, so one restaurant can never consume another's
   * configuration. Option quantity × line quantity are both applied. Returns
   * the same flattened cost-line shape as the base recipe so the caller can
   * aggregate deltas and base through one code path.
   */
  private async optionRecipeLines(
    restaurantId: string,
    item: any,
    saleDate: string,
    cache: Map<string, any>
  ): Promise<Array<{ productId: string; productName: string; variantName?: string; quantity: number; recipeVersion: number; recipeName: string; source: 'option' | 'addon'; optionName: string; costLines: Array<{ inventoryItemId?: string; itemName: string; unit: string; quantity: number; costPerUnit: number; lineCost: number }> }>> {
    const selections = item?.configuration?.selections || item?.configurationSnapshot?.selections || [];
    if (!Array.isArray(selections) || selections.length === 0) return [];

    const productId = item?.menuItemId || item?.product?.id;
    const productName = item?.itemName || item?.product?.name || 'Item';
    const lineQty = Math.max(0, Number(item?.quantity) || 0);
    if (!productId || lineQty <= 0) return [];

    const out: Array<{ productId: string; productName: string; variantName?: string; quantity: number; recipeVersion: number; recipeName: string; source: 'option' | 'addon'; optionName: string; costLines: Array<{ inventoryItemId?: string; itemName: string; unit: string; quantity: number; costPerUnit: number; lineCost: number }> }> = [];

    const loadTemplates = async (groupIds: string[]): Promise<void> => {
      const missing = groupIds.filter((id) => !cache.has(`tpl:${id}`));
      if (missing.length === 0) return;
      try {
        const found = await ConfigurationTemplate.find({
          _id: { $in: missing.map((id) => new mongoose.Types.ObjectId(id)) },
          restaurantId,
          status: { $ne: 'archived' },
        }).lean().exec();
        for (const t of found) cache.set(`tpl:${String(t._id)}`, t);
      } catch { /* malformed group ids → treated as missing below */ }
      for (const id of missing) if (!cache.has(`tpl:${id}`)) cache.set(`tpl:${id}`, null);
    };

    const resolveDeltaRecipe = async (recipeId?: string | null, productRefId?: string | null): Promise<{ version: number; name: string; lines: Array<{ inventoryItemId?: string; itemName: string; unit: string; quantity: number; costPerUnit: number; lineCost: number }> } | null> => {
      const recipeKey = recipeId ? `rcp:${recipeId}` : productRefId ? `rcp:prod:${productRefId}` : null;
      if (!recipeKey) return null;
      if (cache.has(recipeKey)) return cache.get(recipeKey) || null;

      let result: { version: number; name: string; lines: Array<{ inventoryItemId?: string; itemName: string; unit: string; quantity: number; costPerUnit: number; lineCost: number }> } | null = null;
      if (recipeId && mongoose.Types.ObjectId.isValid(recipeId)) {
        try {
          const recipe = await Recipe.findOne({
            _id: new mongoose.Types.ObjectId(recipeId),
            restaurantId,
            status: 'active',
            isDeleted: { $ne: true },
          }).lean().exec();
          if (recipe) {
            const cost = await recipeCostEngine.costRecipe(recipe, { restaurantId });
            result = {
              version: recipe.version ?? 1,
              name: recipe.name || recipe.productName || 'Recipe',
              lines: cost.lines as Array<{ inventoryItemId?: string; itemName: string; unit: string; quantity: number; costPerUnit: number; lineCost: number }>,
            };
          }
        } catch { result = null; }
      } else if (productRefId && mongoose.Types.ObjectId.isValid(productRefId)) {
        // Add-on → the referenced product's OWN recipe (already version-resolved
        // with flattened cost lines — never re-cost the wrapper).
        const resolved = await resolveRecipeVersion(restaurantId, productRefId, undefined, saleDate);
        if (resolved) {
          result = { version: resolved.version, name: resolved.recipeName, lines: resolved.costLines };
        }
      }
      if (!result) {
        cache.set(recipeKey, null);
        return null;
      }
      cache.set(recipeKey, result);
      return result;
    };

    await loadTemplates(selections.map((s: any) => s?.groupId).filter(Boolean));

    for (const entry of selections) {
      const template = cache.get(`tpl:${entry?.groupId}`);
      if (!template) continue; // archived / missing / other tenant — ignored
      const options = template?.data?.options || [];
      const isAddOn = template?.type === 'ADD_ON_GROUP';
      for (const optionId of entry?.optionIds || []) {
        const option = options.find((o: any) => o?.id === optionId);
        if (!option || option.active === false) continue;
        // Option quantity applies to ANY group (add-on ×N, modifier ×2 cheese…)
        // — Phase 4 §8 requires modifier quantity to multiply the delta too.
        const optionQty = Math.max(1, Number(entry?.quantities?.[optionId]) || 1);
        const delta = isAddOn
          ? await resolveDeltaRecipe(null, option?.productId ? String(option.productId) : null)
          : await resolveDeltaRecipe(option?.recipeMappingId || null, null);
        if (!delta || delta.lines.length === 0) continue;
        out.push({
          productId,
          productName,
          quantity: lineQty, // agg loop multiplies costLines by this — keep optionQty folded in, line qty applied below
          recipeVersion: delta.version,
          recipeName: delta.name,
          source: isAddOn ? 'addon' : 'option',
          optionName: option.name,
          costLines: delta.lines.map((l) => ({ ...l, quantity: round4(l.quantity * optionQty), lineCost: round2(l.lineCost * optionQty) })),
        });
      }
    }
    return out;
  }

  /**
   * Billing guard — batch-resolve which of the bill's products have an ACTIVE
   * recipe (keyed `productId::variantName`). billService uses this to skip the
   * legacy per-menu-product stock deduction for prepared items: a product with
   * an active recipe is consumed through its ingredients, never through the
   * legacy `deductBillStock` path. Returns an empty set on any error so the
   * legacy path remains the safe fallback.
   */
  async activeRecipeKeys(restaurantId: string, items: any[]): Promise<Set<string>> {
    const keys = new Set<string>();
    if (!restaurantId) return keys;
    const productIds = Array.from(new Set(
      (items || [])
        .map((i: any) => i?.menuItemId || i?.product?.id)
        .filter(Boolean)
    ));
    if (productIds.length === 0) return keys;
    try {
      // Only valid ObjectIds are queried — a malformed/temp line id must not
      // abort the whole batch and silently fall back to legacy deduction.
      const oids = productIds
        .filter((id: any) => mongoose.Types.ObjectId.isValid(id))
        .map((id: any) => new mongoose.Types.ObjectId(id));
      if (oids.length === 0) return keys;

      // Active recipes → `productId::variantName` for each variant. Legacy base
      // recipes (empty variantName) map to the plain key `productId::`.
      const activeRecipes = await Recipe.find({
        restaurantId,
        productId: { $in: oids },
        status: 'active',
        isDeleted: { $ne: true },
      })
        .select('productId variantName')
        .lean()
        .exec();
      const productsWithActive = new Set<string>();
      for (const r of activeRecipes) {
        const name = r.variantName ? String(r.variantName).trim() : '';
        productsWithActive.add(String(r.productId));
        if (name) keys.add(`${String(r.productId)}::${name}`);
        else keys.add(`${String(r.productId)}::`);
      }

      // Variant-LESS products with an active recipe resolve PLAIN sales too
      // (via the virtual 'Default' variant) — add the `productId::` key so the
      // legacy menu-product deduction is skipped and only ingredients are
      // consumed. Products WITH variants never get the plain key.
      if (productsWithActive.size > 0) {
        const pids = [...productsWithActive].map((id) => new mongoose.Types.ObjectId(id));
        const variantDocs = await ProductVariant.find({
          productId: { $in: pids },
          isDeleted: { $ne: true },
        })
          .select('productId')
          .lean()
          .exec();
        const withVariantRow = new Set(variantDocs.map((pv: any) => String(pv.productId)));
        const products = await Product.find({ _id: { $in: pids }, isDeleted: { $ne: true } })
          .select('menuConfig')
          .lean()
          .exec();
        const withMenuConfigVariants = new Set(
          products
            .filter((p: any) => p.menuConfig?.variantConfigurations?.length)
            .map((p: any) => String(p._id))
        );
        for (const pid of productsWithActive) {
          if (!withVariantRow.has(pid) && !withMenuConfigVariants.has(pid)) {
            keys.add(`${pid}::`);
            keys.add(`${pid}::Default`);
          }
        }
      }
    } catch (err: any) {
      console.warn('[ConsumptionService] activeRecipeKeys failed (legacy fallback):', err.message);
    }
    return keys;
  }

  /**
   * Generate theoretical consumption for a finalized bill. Idempotent on
   * { restaurantId, billId }. Never throws — a consumption failure must never
   * fail billing (movements are best-effort, record is created regardless).
   */
  async generateForBill(
    bill: any,
    billItems: any[],
    ctx: ConsumptionCtx
  ): Promise<any> {
    const { restaurantId } = ctx;
    const billId = String(bill._id);
    if (!restaurantId || !billId) return null;

    // ── Idempotency guard ─────────────────────────────────────────
    try {
      const existing = await RecipeConsumption.findOne({ restaurantId, billId }).lean().exec();
      if (existing) return existing;
    } catch { /* non-fatal — unique index still protects the race */ }

    const saleDate = String(bill.date || new Date().toISOString().slice(0, 10));

    // ── Resolve recipes for the bill's lines ──────────────────────
    const lines: any[] = [];
    const recipeIds = new Set<string>();
    const resolvedByProduct = new Map<string, any>();
    const deltaCache = new Map<string, any>();

    for (const item of (billItems || [])) {
      const productId = item?.menuItemId || item?.product?.id;
      const qty = Number(item?.quantity) || 0;
      if (!productId || qty <= 0) continue;
      const key = `${productId}::${item?.variantName || ''}`;
      let resolved = resolvedByProduct.get(key);
      if (resolved === undefined) {
        resolved = await resolveRecipeVersion(restaurantId, productId, item?.variantName, saleDate);
        resolvedByProduct.set(key, resolved);
      }
      if (resolved) {
        const { recipe, version, recipeName, costLines } = resolved;
        if (recipe?._id) recipeIds.add(String(recipe._id));
        lines.push({
          productId,
          productName: item?.itemName || item?.product?.name || 'Item',
          variantName: item?.variantName || undefined,
          quantity: qty,
          recipeVersion: version,
          recipeName,
          resolvedMode: resolved.resolution?.mode || 'exact',
          sourceRecipeId: resolved.resolution?.sourceRecipeId || (recipe?._id ? String(recipe._id) : undefined),
          costLines,
        });
      } else {
        // DIAGNOSTIC — a missing/draft recipe is the #1 reason a sale consumes
        // no ingredients. Log it so the operator can see exactly which sold
        // item has no ACTIVE recipe (draft recipes are never consumed).
        const probe = await recipeResolutionService.resolveEffectiveRecipe(restaurantId, productId, item?.variantName, { date: saleDate });
        const reason = probe?.resolution?.warning?.code || probe?.resolution?.mode || 'no_recipe';
        console.warn(
          `[ConsumptionService] NO consumption for "${item?.itemName || item?.product?.name || productId}" (variant: "${item?.variantName || ''}") — ${reason}. ` +
          `Recipe missing or not ACTIVE (a DRAFT recipe is never consumed; activate it in the Recipe Manager).`
        );
      }
      // Phase 4 — configuration layers: selected variant/modifier options
      // (recipeMappingId → delta recipe) and add-ons (productId → own recipe)
      // consume IN ADDITION to the base recipe. Base + deltas flow through the
      // same ingredient aggregation, so no stock is double-counted per layer.
      const optionLines = await this.optionRecipeLines(restaurantId, item, saleDate, deltaCache);
      for (const ol of optionLines) {
        lines.push(ol);
        if (ol.recipeName) recipeIds.add(`delta:${ol.recipeName}`);
      }
    }

    if (lines.length === 0) return null; // nothing recipe-linked on this bill

    // ── Aggregate ingredient consumption across all lines ─────────
    const agg = new Map<string, { inventoryItemId: string; itemName: string; unit: string; quantity: number; costPerUnit: number }>();
    for (const line of lines) {
      for (const cl of line.costLines) {
        const key = String(cl.inventoryItemId);
        const cur = agg.get(key);
        const addQty = round4(cl.quantity * line.quantity);
        const addCost = round2(cl.lineCost * line.quantity);
        if (cur) {
          cur.quantity = round4(cur.quantity + addQty);
          // Cost per unit = blended: total money / total qty.
          const totalMoney = round2(cur.quantity * cur.costPerUnit) + addCost;
          cur.costPerUnit = cur.quantity > 0 ? round2(totalMoney / cur.quantity) : 0;
        } else {
          agg.set(key, {
            inventoryItemId: cl.inventoryItemId!,
            itemName: cl.itemName,
            unit: cl.unit,
            quantity: addQty,
            costPerUnit: cl.costPerUnit,
          });
        }
      }
    }

    // ── Apply stock movements (best-effort, clamped, never fails) ─
    for (const entry of agg.values()) {
      try {
        await stockMovementService.applyMovement({
          restaurantId,
          branchId: ctx.branchId,
          productId: entry.inventoryItemId,
          delta: -entry.quantity,
          type: 'sale',
          unit: entry.unit,
          operator: ctx.operator || 'System',
          details: `Recipe consumption (bill ${bill.invoiceNumber || billId})`,
          allowNegative: true,
        });
      } catch (err: any) {
        console.warn('[ConsumptionService] ingredient deduction skipped:', entry.itemName, err.message);
      }
    }

    // ── Persist the record (snapshot ledger + idempotency anchor) ─
    const items = Array.from(agg.values()).map((e) => ({
      inventoryItemId: new mongoose.Types.ObjectId(e.inventoryItemId),
      itemName: e.itemName,
      unit: e.unit,
      quantity: e.quantity,
      costPerUnit: e.costPerUnit,
      cost: round2(e.quantity * e.costPerUnit),
      source: 'recipe' as const,
    }));
    const totalCost = round2(items.reduce((s, i) => s + i.cost, 0));

    try {
      const record = await RecipeConsumption.create({
        restaurantId,
        branchId: ctx.branchId || undefined,
        billId,
        orderId: bill.orderId || undefined,
        clientRef: bill.clientRef || undefined,
        invoiceNumber: bill.invoiceNumber || String(billId).slice(-6),
        date: saleDate,
        lines,
        items,
        totalCost,
        status: 'recorded',
        createdBy: ctx.operator,
      });
      return record;
    } catch (err: any) {
      // Duplicate key → a concurrent replay already recorded this bill.
      if (err?.code === 11000) {
        return RecipeConsumption.findOne({ restaurantId, billId }).lean().exec();
      }
      console.warn('[ConsumptionService] record persist failed:', err.message);
      return null;
    }
  }

  /**
   * Reverse consumption for a voided bill: restore every recorded ingredient
   * and flip the record to 'voided'. Idempotent.
   */
  async reverseForBill(billId: string, ctx: ConsumptionCtx, reason = 'Bill voided'): Promise<any> {
    const { restaurantId } = ctx;
    if (!restaurantId) return null;
    const record = await RecipeConsumption.findOne({ restaurantId, billId }).exec();
    if (!record || record.status !== 'recorded') return null;

    for (const item of record.items) {
      try {
        await stockMovementService.applyMovement({
          restaurantId,
          branchId: record.branchId ? String(record.branchId) : ctx.branchId,
          productId: item.inventoryItemId?.toString() || undefined,
          itemName: item.inventoryItemId ? undefined : item.itemName,
          delta: item.quantity,
          type: 'return',
          unit: item.unit,
          operator: ctx.operator || 'System',
          details: `Recipe consumption reversed (${reason})`,
        });
      } catch (err: any) {
        console.warn('[ConsumptionService] reversal skipped:', item.itemName, err.message);
      }
    }
    record.status = 'voided';
    record.reversedAt = new Date();
    record.reversedBy = ctx.operator || 'System';
    record.reversedReason = reason;
    await record.save();
    return record;
  }

  /**
   * Reverse a portion of a bill's consumption (partial refund). Refund lines
   * carry { menuItemId, quantity }. Returns the updated record.
   */
  async reversePartial(billId: string, refundLines: Array<{ menuItemId?: string; quantity: number }>, ctx: ConsumptionCtx, reason = 'Partial refund'): Promise<any> {
    const { restaurantId } = ctx;
    if (!restaurantId) return null;
    const record = await RecipeConsumption.findOne({ restaurantId, billId }).exec();
    if (!record || record.status !== 'recorded') return null;

    // Map refunded product quantities onto the record's lines, then scale the
    // ingredient quantities proportionally.
    const totalQtyByProduct = new Map<string, number>();
    for (const line of record.lines) {
      totalQtyByProduct.set(line.productId, (totalQtyByProduct.get(line.productId) || 0) + line.quantity);
    }
    const reversalByIngredient = new Map<string, { inventoryItemId?: string; itemName: string; unit: string; quantity: number }>();
    for (const rf of refundLines) {
      if (!rf.menuItemId || rf.quantity <= 0) continue;
      const soldQty = totalQtyByProduct.get(rf.menuItemId) || 0;
      if (soldQty <= 0) continue;
      const fraction = Math.min(1, rf.quantity / soldQty);
      for (const line of record.lines) {
        if (line.productId !== rf.menuItemId) continue;
        for (const item of record.items) {
          const key = String(item.inventoryItemId || item.itemName);
          const cur = reversalByIngredient.get(key);
          // Distribute proportionally per line share of the ingredient.
          const lineShare = line.quantity / soldQty;
          const qty = round4(item.quantity * lineShare * fraction);
          if (cur) cur.quantity = round4(cur.quantity + qty);
          else reversalByIngredient.set(key, { inventoryItemId: item.inventoryItemId ? String(item.inventoryItemId) : undefined, itemName: item.itemName, unit: item.unit, quantity: qty });
        }
      }
    }

    for (const entry of reversalByIngredient.values()) {
      if (entry.quantity <= 0) continue;
      try {
        await stockMovementService.applyMovement({
          restaurantId,
          branchId: record.branchId ? String(record.branchId) : ctx.branchId,
          productId: entry.inventoryItemId?.toString() || undefined,
          itemName: entry.inventoryItemId ? undefined : entry.itemName,
          delta: entry.quantity,
          type: 'return',
          unit: entry.unit,
          operator: ctx.operator || 'System',
          details: `Recipe consumption reversed (${reason})`,
        });
      } catch (err: any) {
        console.warn('[ConsumptionService] partial reversal skipped:', entry.itemName, err.message);
      }
    }

    record.status = 'refunded';
    record.reversedAt = new Date();
    record.reversedBy = ctx.operator || 'System';
    record.reversedReason = reason;
    await record.save();
    return record;
  }

  // ─── Read surfaces ──────────────────────────────────────────────
  async list(restaurantId: string, opts: { date?: string; branchId?: string; productId?: string; limit?: number } = {}) {
    const query: any = { restaurantId };
    if (opts.date) query.date = opts.date;
    if (opts.branchId) query.branchId = opts.branchId;
    if (opts.productId) query['lines.productId'] = opts.productId;
    const limit = Math.min(Number(opts.limit) || 100, 500);
    return RecipeConsumption.find(query).sort({ createdAt: -1 }).limit(limit).lean().exec();
  }

  async getByBill(restaurantId: string, billId: string) {
    if (!mongoose.Types.ObjectId.isValid(billId)) throw new AppError(400, 'Invalid bill id');
    const record = await RecipeConsumption.findOne({ restaurantId, billId }).lean().exec();
    return record || null;
  }

  /**
   * Phase 14 — Reconciliation: THEORETICAL vs ACTUAL consumption per
   * ingredient over a date range. Theoretical = Σ consumption record items;
   * actual = Σ InventoryEvent 'sold' movements (the stock engine records one
   * per ingredient per bill). Variance is reported as an anomaly surface, not
   * an accusation.
   */
  async reconcile(restaurantId: string, opts: { startDate?: string; endDate?: string; branchId?: string; limit?: number } = {}) {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) throw new AppError(400, 'Invalid restaurantId');
    const oid = new mongoose.Types.ObjectId(restaurantId);
    const start = opts.startDate || '2000-01-01';
    const end = opts.endDate || '2999-12-31';
    const branchMatch: any = {};
    if (opts.branchId) branchMatch.branchId = new mongoose.Types.ObjectId(opts.branchId);

    // Theoretical consumption (active = not reversed).
    const theoretical = await RecipeConsumption.aggregate([
      {
        $match: {
          restaurantId: oid,
          date: { $gte: start, $lte: end },
          status: 'recorded',
          ...branchMatch,
        },
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: { id: '$items.inventoryItemId', name: '$items.itemName', unit: '$items.unit' },
          theoreticalQty: { $sum: '$items.quantity' },
          theoreticalCost: { $sum: '$items.cost' },
        },
      },
    ]).exec();

    // Actual movements (sold events from the stock engine).
    const actual = await inventoryEventRepo.aggregate([
      {
        $match: {
          restaurantId: oid,
          eventDate: { $gte: start, $lte: end },
          type: 'sold',
          ...branchMatch,
        },
      },
      {
        $group: {
          _id: { name: '$item', unit: '$unit' },
          actualQty: { $sum: { $abs: '$quantity' } },
        },
      },
    ]);

    const theoreticalMap = new Map<string, any>();
    for (const t of theoretical) {
      theoreticalMap.set(String(t._id.id), {
        name: t._id.name,
        unit: t._id.unit,
        theoreticalQty: round4(t.theoreticalQty),
        theoreticalCost: round2(t.theoreticalCost),
      });
    }
    const actualMap = new Map<string, any>();
    for (const a of actual) {
      const key = String(a._id.name).toLowerCase();
      actualMap.set(key, { name: a._id.name, unit: a._id.unit, actualQty: round4(a.actualQty) });
    }

    // Union of ingredient names (theoretical by id, actual by name).
    const rows: any[] = [];
    const seen = new Set<string>();
    for (const t of theoreticalMap.values()) {
      const key = t.name.toLowerCase();
      seen.add(key);
      const act = actualMap.get(key);
      const actualQty = act?.actualQty || 0;
      rows.push(this.row(t, actualQty, act?.unit || t.unit));
    }
    for (const a of actualMap.values()) {
      if (seen.has(a.name.toLowerCase())) continue;
      rows.push(this.row({ name: a.name, unit: a.unit, theoreticalQty: 0, theoreticalCost: 0 }, a.actualQty, a.unit));
    }

    rows.sort((x, y) => Math.abs(y.varianceQty) - Math.abs(x.varianceQty));
    return {
      startDate: start,
      endDate: end,
      rows: rows.slice(0, Math.min(Number(opts.limit) || 100, 500)),
    };
  }

  private row(t: any, actualQty: number, actualUnit: string) {
    const varianceQty = round4(actualQty - t.theoreticalQty);
    const variancePercent = t.theoreticalQty > 0 ? round2((varianceQty / t.theoreticalQty) * 100) : actualQty > 0 ? 100 : 0;
    return {
      name: t.name,
      unit: actualUnit || t.unit || 'pcs',
      theoreticalQty: t.theoreticalQty,
      actualQty,
      varianceQty,
      variancePercent,
      varianceCost: round2(t.theoreticalQty > 0 && t.theoreticalCost > 0
        ? varianceQty * (t.theoreticalCost / t.theoreticalQty)
        : 0),
    };
  }
}

export const consumptionService = new ConsumptionService();

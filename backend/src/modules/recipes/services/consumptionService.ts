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
import { Recipe, RecipeVersion, RecipeConsumption, Product } from '../../../models';
import { recipeRepo, inventoryEventRepo } from '../../../repositories';
import { AppError } from '../../../utils/AppError';
import { recipeCostEngine } from './recipeCostEngine';
import { stockMovementService } from '../../../services/stockMovementService';
import { round2, round4 } from './unitConversion';

export interface ConsumptionCtx {
  restaurantId: string;
  branchId?: string;
  operator?: string;
}

/** The ACTIVE recipe for a product+variant, resolved to a version. */
async function resolveRecipeVersion(restaurantId: string, productId: string, variantName: string | undefined, saleDate: string): Promise<{
  recipe: any;
  version: number;
  recipeName: string;
  costLines: Awaited<ReturnType<typeof recipeCostEngine.costRecipe>>['lines'];
} | null> {
  const match: any = {
    restaurantId,
    productId,
    status: 'active',
    isDeleted: { $ne: true },
  };
  if (variantName) match.variantName = variantName;
  else match.variantName = { $in: [null, ''] };

  const recipe = await Recipe.findOne(match).lean().exec();
  if (!recipe) return null;

  const cost = await recipeCostEngine.costRecipe(recipe, { restaurantId });
  return { recipe, version: recipe.version, recipeName: recipe.name, costLines: cost.lines };
}

export class ConsumptionService {
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
      if (!resolved) continue; // no active recipe → legacy per-product deduction
      const { recipe, version, recipeName, costLines } = resolved;
      if (recipe?._id) recipeIds.add(String(recipe._id));
      lines.push({
        productId,
        productName: item?.itemName || item?.product?.name || 'Item',
        variantName: item?.variantName || undefined,
        quantity: qty,
        recipeVersion: version,
        recipeName,
        costLines,
      });
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

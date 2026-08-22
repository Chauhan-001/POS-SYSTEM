/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StockMovementService — THE single centralized stock movement engine.
 *
 * Every stock change in the POS (purchase, sale, waste, manual adjustment,
 * opening/closing, correction, return) MUST flow through applyMovement().
 * It guarantees:
 *   1. Stock validation (never goes negative)
 *   2. Atomic Product.currentStock update
 *   3. InventoryEvent creation (activity feed)
 *   4. AuditLog creation (who/what/when/old/new)
 *
 * This removes the previous split-brain stock systems — Product.currentStock
 * is the ONE source of truth; nothing else stores live stock levels.
 */

import mongoose from 'mongoose';
import { productRepo, inventoryEventRepo, auditLogRepo } from '../repositories';
import { AppError } from '../utils/AppError';
import { round4 } from '../modules/recipes/services/unitConversion';
import type { IStockBatch } from '../models/Product';
import Product from '../models/Product';

/** Every supported stock movement type. */
export type StockMovementType =
  | 'purchase'
  | 'sale'
  | 'waste'
  | 'adjustment'
  | 'opening'
  | 'closing'
  | 'correction'
  | 'return';

/** Maps a movement type to the public InventoryEvent feed type. */
const EVENT_TYPE_MAP: Record<StockMovementType, string> = {
  purchase: 'purchase',
  sale: 'sold',
  waste: 'waste',
  adjustment: 'adjusted',
  opening: 'closing',
  closing: 'closing',
  correction: 'adjusted',
  return: 'return',
};

/** Escape a name for safe RegExp construction (exact-name lookup). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Consume `outQty` from batches FIRST-IN-FIRST-OUT: the batch with the
 * earliest expiryDate is consumed first, batches with no expiryDate ('')
 * are treated as "longest shelf life" and consumed last, and receivedDate
 * breaks ties. Fully-consumed batches are dropped; the rest are returned.
 */
function consumeFifoTillEmpty(batches: IStockBatch[], outQty: number): IStockBatch[] {
  let remaining = Math.max(0, outQty);
  const sorted = [...batches].sort((a, b) => {
    const ea = a.expiryDate || '9999-12-31';
    const eb = b.expiryDate || '9999-12-31';
    if (ea !== eb) return ea < eb ? -1 : 1;
    const ra = a.receivedDate || '0000-01-01';
    const rb = b.receivedDate || '0000-01-01';
    if (ra !== rb) return ra < rb ? -1 : 1;
    return 0;
  });
  const next: IStockBatch[] = [];
  for (const b of sorted) {
    const qty = Number(b.quantity) || 0;
    if (qty <= 0) continue;
    if (remaining <= 0) { next.push(b); continue; }
    if (qty <= remaining) {
      remaining -= qty; // fully consumed → dropped
    } else {
      next.push({ ...b, quantity: round4(qty - remaining) });
      remaining = 0;
    }
  }
  return next;
}

/** Earliest expiry date across remaining batches ('' when none has one). */
function earliestBatchExpiry(batches: IStockBatch[]): string {
  const expiries = batches
    .filter((b) => b.expiryDate && Number(b.quantity) > 0)
    .map((b) => String(b.expiryDate))
    .sort();
  return expiries.length > 0 ? expiries[0] : '';
}

export interface StockMovementInput {
  restaurantId: string;
  branchId?: string;
  /** Preferred: the Product _id. If omitted, falls back to itemName lookup. */
  productId?: string;
  /** Exact item name used to resolve the product when productId is absent. */
  itemName?: string;
  /** Signed quantity change (+ in, − out). */
  delta: number;
  type: StockMovementType;
  reason?: string;
  details?: string;
  operator?: string;
  performedById?: string;
  unit?: string;
  /** When type === 'purchase', recomputes the weighted average cost. */
  purchasePrice?: number;
  /**
   * When true, a movement that would push stock below zero is CLAMPED to zero
   * instead of rejected (used by best-effort billing deductions). When false
   * (default) an oversell throws a 400 AppError.
   */
  allowNegative?: boolean;
  /**
   * When true and the item cannot be resolved to an existing product, a hidden
   * inventory-only product is auto-created (availability: false so it never
   * appears in the billing menu) and the movement is applied to it. Used by the
   * purchase flow so "stock-in" always lands on a real product.
   */
  autoCreateProduct?: boolean;
  /** Optional expiry date for the incoming batch (stock-in) or the batch that
   *  was consumed (stock-out, informational). For stock-in this drives FIFO
   *  batch tracking; the quantity is merged into or added as a new batch. */
  expiryDate?: string;
  /** Optional batch number for tracking. Paired with expiryDate. */
  batchNumber?: string;
}

export class StockMovementService {
  /** Per-product async mutex so concurrent movements on the same product
   *  never race on the FIFO batch array. Key = `${restaurantId}:${productId}`. */
  private locks = new Map<string, Promise<unknown>>();

  private async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.locks.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const chained = tail.then(() => gate);
    this.locks.set(key, chained);
    await tail.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  /**
   * Apply a single stock movement. Returns the updated product + before/after.
   */
  async applyMovement(input: StockMovementInput): Promise<{
    product: any;
    before: number;
    after: number;
    effectiveDelta: number;
  }> {
    if (!input.restaurantId) throw new AppError(400, 'restaurantId is required');
    if (!Number.isFinite(input.delta) || input.delta === 0) {
      throw new AppError(400, 'delta must be a non-zero number');
    }

    // ── Resolve the product (by id, or exact-name fallback) ──────────
    let product: any = null;
    if (input.productId) {
      product = await productRepo.findById(input.productId);
    } else if (input.itemName) {
      const found = await productRepo.findAll(
        {
          name: new RegExp(`^${escapeRegExp(input.itemName.trim())}$`, 'i'),
          $or: [
            { restaurantId: new mongoose.Types.ObjectId(input.restaurantId) },
            { restaurantId: null },
          ],
        },
        { limit: 1 }
      );
      product = found.data[0] ?? null;
    }
    if (!product && input.autoCreateProduct && input.itemName) {
      try {
        product = await productRepo.create({
          name: input.itemName.trim(),
          code: `INV-${Date.now().toString(36).toUpperCase()}`,
          price: 0,
          category: 'Inventory',
          image: '',
          gstPercent: 0,
          type: 'inventory',
          availability: false,
          restaurantId: new mongoose.Types.ObjectId(input.restaurantId),
          branchPrice: {},
          currentStock: 0,
          unit: input.unit || 'pcs',
          minStock: 0,
          maxStock: 1000,
          reorderLevel: 0,
          averageCost: 0,
          supplier: '',
          storageLocation: '',
          notes: 'Auto-created from purchase',
          barcode: '',
          expiryDate: '',
          batchNumber: '',
          voiceAliases: [],
          searchAliases: [],
          learnedAliases: [],
          lastUsedAlias: null,
          aliasUsageCount: 0,
          isDeleted: false,
          deletedAt: null,
          batches: [],
        } as any);
        console.warn(`[StockMovement] Auto-created hidden inventory product "${input.itemName}"`);
      } catch (autoErr: any) {
        console.warn('[StockMovement] Auto-create failed:', autoErr.message);
      }
    }
    if (!product) throw new AppError(404, 'Product not found for stock movement');

    // ── Tenant isolation: never move another restaurant's stock ─────
    const ownerId = product.restaurantId;
    if (ownerId && String(ownerId) !== String(input.restaurantId)) {
      throw new AppError(403, 'Product not found in your restaurant');
    }

    // ── Serialize per-product so FIFO batches never race ────────────
    const productKey = `${input.restaurantId}:${String(product._id)}`;
    return this.runExclusive(productKey, async () => {
      // Re-fetch inside the lock so we always have the latest batches. Use
      // .lean() so batches is a PLAIN array of plain objects — a Mongoose
      // DocumentArray with subdocuments breaks `Array.isArray`/`{...b}` and
      // the FIFO math would silently start from an empty batch set.
      const fresh = await Product.findById(product._id.toString()).lean().exec() as any;
      if (!fresh) throw new AppError(404, 'Product not found for stock movement');
      product = fresh;

      const before = Number(product.currentStock) || 0;
      let effectiveDelta = input.delta;
      let after = before + effectiveDelta;

      // ── Negative-stock guard ──────────────────────────────────────
      if (after < 0) {
        if (input.allowNegative) {
          effectiveDelta = -before; // clamp to zero
          after = 0;
        } else {
          throw new AppError(
            400,
            `Insufficient stock for "${product.name}" (have ${before} ${product.unit || ''}, need ${Math.abs(input.delta)})`
          );
        }
      }

      // ── FIFO batch management ─────────────────────────────────────
      let batches: IStockBatch[] = Array.isArray(product.batches)
        ? product.batches.map((b: any) => ({ ...b }))
        : [];
      const today = new Date().toISOString().slice(0, 10);

      if (effectiveDelta > 0) {
        // Stock-in: merge into a matching batch (same expiry + batchNumber)
        // or create a new one.
        const expiry = input.expiryDate || '';
        const batchNo = input.batchNumber || '';
        const existing = batches.find(
          (b) => (b.expiryDate || '') === expiry && (b.batchNumber || '') === batchNo
        );
        if (existing) {
          existing.quantity = (existing.quantity || 0) + effectiveDelta;
          if (input.purchasePrice != null) existing.cost = input.purchasePrice;
        } else {
          batches.push({
            batchNumber: batchNo,
            expiryDate: expiry,
            quantity: effectiveDelta,
            receivedDate: today,
            cost: input.purchasePrice ?? undefined,
          });
        }
      } else if (effectiveDelta < 0) {
        // Stock-out: consume FIFO — earliest expiry first ('' last).
        batches = consumeFifoTillEmpty(batches, -effectiveDelta);
      }

      // Derived expiry = earliest remaining batch expiry (drives warnings).
      // Legacy products without batches keep their stored expiryDate while
      // they still hold stock; a fully-depleted item clears it.
      const expiryDate = batches.length > 0
        ? earliestBatchExpiry(batches)
        : (after > 0 ? (product.expiryDate || '') : '');
      // currentStock = sum of batches (consistency). If no batches, currentStock
      // is the delta-computed value (backward compat for legacy products).
      if (batches.length > 0) {
        after = round4(batches.reduce((s, b) => s + (Number(b.quantity) || 0), 0));
      }

      // ── Atomic stock update ───────────────────────────────────────
      const updated = await productRepo.findOneAndUpdate(
        {
          _id: product._id,
          currentStock: { $gte: -effectiveDelta },
        } as any,
        {
          $inc: { currentStock: effectiveDelta } as any,
          $set: { batches, expiryDate } as any,
        },
        { upsert: false }
      );
      if (!updated) {
        throw new AppError(409, 'Stock changed concurrently — please retry');
      }

    // ── Rolling purchase-price average (last 10 purchases) ───────────
    // The old all-time weighted average could never shake off a single old
    // price and made stock value swing with every purchase. Now the item's
    // averageCost is the mean of its LAST 10 purchase prices (per unit), so it
    // tracks recent market prices without distorting the stock value.
    if (input.type === 'purchase' && input.purchasePrice != null && effectiveDelta > 0) {
      const prev = Array.isArray((product as any).lastPurchasePrices)
        ? (product as any).lastPurchasePrices.map((n: any) => Number(n) || 0).filter((n: number) => n > 0)
        : [];
      const next = [...prev, Number(input.purchasePrice) || 0].slice(-10);
      const avg = next.length > 0 ? Math.round((next.reduce((s: number, n: number) => s + n, 0) / next.length) * 100) / 100 : 0;
      await productRepo.update(product._id.toString(), {
        averageCost: avg,
        lastPurchasePrices: next,
      } as any);
    }

    // ── InventoryEvent (activity feed) ───────────────────────────────
    // Skip when nothing actually moved (e.g. a clamped sale of an out-of-stock
    // item with allowNegative — effectiveDelta is 0). A "sold 0 pcs" row in
    // the activity feed is garbage; only record real stock changes.
    if (effectiveDelta !== 0) {
      try {
        await inventoryEventRepo.create({
          restaurantId: new mongoose.Types.ObjectId(input.restaurantId),
          branchId: input.branchId ? new mongoose.Types.ObjectId(input.branchId) : undefined,
          type: EVENT_TYPE_MAP[input.type],
          item: product.name,
          quantity: effectiveDelta,
          unit: input.unit || product.unit || 'pcs',
          operator: input.operator || 'System',
          details: input.details || `${input.type}: ${Math.abs(effectiveDelta)} ${product.unit || 'pcs'} ${product.name}`,
          eventDate: new Date().toISOString().slice(0, 10),
        } as any);
      } catch (err: any) {
        console.warn('[StockMovement] inventory event failed (non-fatal):', err.message);
      }
    }

    // ── AuditLog ─────────────────────────────────────────────────────
    try {
      await auditLogRepo.create({
        action: `INVENTORY_${input.type.toUpperCase()}`,
        entityType: 'product',
        entityId: product._id.toString(),
        performedBy: input.operator || 'System',
        performedById: input.performedById,
        branchId: input.branchId ? new mongoose.Types.ObjectId(input.branchId) : undefined,
        details: {
          movementType: input.type,
          delta: effectiveDelta,
          before,
          after,
          reason: input.reason || undefined,
          unit: input.unit || product.unit || 'pcs',
        },
      } as any);
    } catch (err: any) {
      console.warn('[StockMovement] audit log failed (non-fatal):', err.message);
    }

    return { product: updated, before, after, effectiveDelta };
    });
  }
}

export const stockMovementService = new StockMovementService();

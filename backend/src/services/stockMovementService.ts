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
}

export class StockMovementService {
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

    const before = Number(product.currentStock) || 0;
    let effectiveDelta = input.delta;
    let after = before + effectiveDelta;

    // ── Negative-stock guard ────────────────────────────────────────
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

    // ── Atomic stock update ──────────────────────────────────────────
    const updated = await productRepo.findOneAndUpdate(
      {
        _id: product._id,
        currentStock: { $gte: -effectiveDelta },
      } as any,
      { $inc: { currentStock: effectiveDelta } } as any,
      { upsert: false }
    );
    if (!updated) {
      throw new AppError(409, 'Stock changed concurrently — please retry');
    }

    // ── Weighted average cost on purchase ────────────────────────────
    if (input.type === 'purchase' && input.purchasePrice != null && effectiveDelta > 0) {
      const oldCost = Number(product.averageCost) || 0;
      const newAvg = (oldCost * before + input.purchasePrice * effectiveDelta) / after;
      await productRepo.update(product._id.toString(), {
        averageCost: Math.round(newAvg * 100) / 100,
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
  }
}

export const stockMovementService = new StockMovementService();

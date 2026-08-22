/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Purchase Service — Business logic for inventory purchase history.
 * All queries are scoped to the caller's restaurant for multi-tenant isolation.
 * Supports optional branch/supplier/date filtering and supplier grouping.
 */

import mongoose from 'mongoose';
import { purchaseRepo } from '../repositories';
import { AppError } from '../utils/AppError';
import { stockMovementService } from './stockMovementService';

/**
 * Best-effort stock engine hook for a purchase item: increases stock + updates
 * average cost when the item resolves to a product (or is auto-created as a
 * hidden inventory product). NEVER throws — a purchase record must always save
 * even if stock tracking is unavailable.
 */
async function applyPurchaseStock(opts: {
  restaurantId: string;
  branchId?: string;
  item: string;
  quantity: number;
  unit: string;
  price: number;
  operator?: string;
  expiryDate?: string;
  batchNumber?: string;
}) {
  try {
    await stockMovementService.applyMovement({
      restaurantId: opts.restaurantId,
      branchId: opts.branchId,
      itemName: opts.item,
      delta: opts.quantity,
      type: 'purchase',
      unit: opts.unit,
      purchasePrice: opts.price,
      operator: opts.operator,
      expiryDate: opts.expiryDate || undefined,
      batchNumber: opts.batchNumber || undefined,
      autoCreateProduct: true, // purchased item not in catalog → hidden inventory product
    });
  } catch (err: any) {
    console.warn('[PurchaseService] stock movement skipped (purchase still saved):', err.message);
  }
}

/**
 * Best-effort reverse of a purchase (correction on edit / delete).
 */
async function reversePurchaseStock(opts: {
  restaurantId: string;
  branchId?: string;
  item: string;
  quantity: number;
  unit: string;
  operator?: string;
}) {
  try {
    await stockMovementService.applyMovement({
      restaurantId: opts.restaurantId,
      branchId: opts.branchId,
      itemName: opts.item,
      delta: -opts.quantity,
      type: 'correction',
      unit: opts.unit,
      operator: opts.operator,
    });
  } catch (err: any) {
    console.warn('[PurchaseService] stock correction skipped:', err.message);
  }
}

export class PurchaseService {
  /**
   * List purchases for a restaurant with optional filtering.
   * restaurantId is ALWAYS required — never list across tenants.
   */
  async list(params: {
    restaurantId?: string;
    branchId?: string;
    supplier?: string;
    item?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
  } = {}) {
    if (!params.restaurantId) {
      throw new AppError(400, 'restaurantId is required');
    }
    const query: any = { restaurantId: params.restaurantId };
    if (params.branchId) query.branchId = params.branchId;
    if (params.supplier) query.supplier = new RegExp(params.supplier, 'i');
    if (params.item) query.item = new RegExp(params.item, 'i');
    if (params.startDate || params.endDate) {
      query.date = {};
      if (params.startDate) query.date.$gte = params.startDate;
      if (params.endDate) query.date.$lte = params.endDate;
    }
    const limit = params.limit && params.limit > 0 ? params.limit : 100;
    // Projection: only the fields the Inventory UI/history/forecast consume —
    // the full purchase docs were transferred for every list call before.
    return purchaseRepo.findAll(
      query,
      { limit, sort: { date: -1, createdAt: -1 } },
      undefined,
      { _id: 1, supplier: 1, brand: 1, expiryDate: 1, item: 1, category: 1, quantity: 1, unit: 1, price: 1, total: 1, date: 1, status: 1, notes: 1, branchId: 1 },
    );
  }

  /**
   * Create a new purchase. The restaurant is stamped server-side from the
   * authenticated user — never trust a client-supplied restaurantId.
   */
  async create(data: any, restaurantId: string, ctx: { operator?: string; branchId?: string } = {}) {
    if (!data.item || !data.quantity || !data.price) {
      throw new AppError(400, 'Item, quantity and price are required');
    }
    const quantity = Number(data.quantity);
    const price = Number(data.price);
    if (Number.isNaN(quantity) || quantity <= 0 || Number.isNaN(price) || price < 0) {
      throw new AppError(400, 'Invalid quantity or price');
    }
    const purchase = await purchaseRepo.create({
      ...data,
      restaurantId,
      quantity,
      price,
      total: Math.round(quantity * price * 100) / 100,
      date: data.date || new Date().toISOString().slice(0, 10),
      status: data.status || 'completed',
      unit: data.unit || 'kg',
    });

    // Stock engine: increase stock + weighted avg cost + event + audit (with
    // FIFO batch tracking when an expiry date was supplied).
    await applyPurchaseStock({
      restaurantId,
      branchId: ctx.branchId || data.branchId,
      item: data.item,
      quantity,
      unit: data.unit || 'kg',
      price,
      operator: ctx.operator,
      expiryDate: data.expiryDate,
      batchNumber: data.batchNumber,
    });

    return purchase;
  }

  /**
   * Partially update a purchase (e.g. correct a mistaken quantity/price),
   * scoped to the caller's restaurant. The total is recomputed whenever the
   * quantity or price changes so stored totals never drift.
   */
  async update(id: string, restaurantId: string, data: any, ctx: { operator?: string } = {}) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(400, 'Invalid purchase id');
    }
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      throw new AppError(400, 'Invalid restaurantId');
    }
    const existing = await purchaseRepo.findById(id);
    if (!existing) return null;
    if (String((existing as any).restaurantId) !== restaurantId) {
      throw new AppError(403, 'You can only update purchases from your restaurant');
    }

    // Apply only the fields the client actually sent (PATCH semantics — never
    // reset untouched fields to defaults).
    const updates: any = {};
    for (const key of ['branchId', 'supplier', 'item', 'category', 'quantity', 'unit', 'price', 'date', 'status', 'notes']) {
      if (data[key] !== undefined) updates[key] = data[key];
    }

    // Recompute total from the effective quantity/price (either the new value
    // or the stored one if that field wasn't part of this update).
    const quantity = updates.quantity !== undefined ? Number(updates.quantity) : Number((existing as any).quantity);
    const price = updates.price !== undefined ? Number(updates.price) : Number((existing as any).price);
    if (Number.isNaN(quantity) || quantity <= 0 || Number.isNaN(price) || price < 0) {
      throw new AppError(400, 'Invalid quantity or price');
    }
    updates.total = Math.round(quantity * price * 100) / 100;

    // Stock engine: correct stock by the quantity delta (new − old). Only when
    // the item name is unchanged — changing the item name is treated as a full
    // reversal + re-add so stock never drifts.
    const oldQty = Number((existing as any).quantity);
    const oldItem = String((existing as any).item);
    const newItem = updates.item !== undefined ? String(updates.item) : oldItem;
    if (newItem === oldItem) {
      const qtyDelta = quantity - oldQty;
      if (qtyDelta !== 0) {
        await applyPurchaseStock({
          restaurantId,
          branchId: (existing as any).branchId || updates.branchId,
          item: oldItem,
          quantity: Math.abs(qtyDelta),
          unit: updates.unit || (existing as any).unit || 'kg',
          price: qtyDelta > 0 ? price : 0,
          operator: ctx.operator,
        }).catch(() => {});
        if (qtyDelta < 0) {
          // qtyDelta < 0 is a reduction → reverse stock directly.
          await reversePurchaseStock({
            restaurantId,
            branchId: (existing as any).branchId || updates.branchId,
            item: oldItem,
            quantity: Math.abs(qtyDelta),
            unit: updates.unit || (existing as any).unit || 'kg',
            operator: ctx.operator,
          });
        }
      }
    } else {
      // Item renamed: reverse old, re-add new.
      await reversePurchaseStock({
        restaurantId,
        branchId: (existing as any).branchId || updates.branchId,
        item: oldItem,
        quantity: oldQty,
        unit: (existing as any).unit || 'kg',
        operator: ctx.operator,
      });
      await applyPurchaseStock({
        restaurantId,
        branchId: updates.branchId || (existing as any).branchId,
        item: newItem,
        quantity,
        unit: updates.unit || 'kg',
        price,
        operator: ctx.operator,
      });
    }

    return purchaseRepo.update(id, updates);
  }

  /**
   * Permanently delete a purchase, scoped to the caller's restaurant so one
   * tenant can never remove another tenant's records.
   */
  async delete(id: string, restaurantId: string, ctx: { operator?: string } = {}) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(400, 'Invalid purchase id');
    }
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      throw new AppError(400, 'Invalid restaurantId');
    }
    const existing = await purchaseRepo.findById(id);
    if (!existing) return null;
    if (String((existing as any).restaurantId) !== restaurantId) {
      throw new AppError(403, 'You can only delete purchases from your restaurant');
    }
    // Stock engine: reverse the stock-in from this purchase (correction).
    await reversePurchaseStock({
      restaurantId,
      branchId: (existing as any).branchId,
      item: String((existing as any).item),
      quantity: Number((existing as any).quantity),
      unit: (existing as any).unit || 'kg',
      operator: ctx.operator,
    });
    return purchaseRepo.hardDelete(id);
  }

  /**
   * Supplier spend summary for the Inventory reports page.
   */
  async supplierSummary(restaurantId: string) {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      throw new AppError(400, 'Invalid restaurantId');
    }
    const pipeline = [
      { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
      { $group: {
          _id: '$supplier',
          totalSpend: { $sum: '$total' },
          purchaseCount: { $sum: 1 },
        } },
      { $sort: { totalSpend: -1 } },
      { $limit: 50 },
    ];
    return purchaseRepo.aggregate(pipeline);
  }
}

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
import Expense from '../models/Expense';
import { cashLedgerService } from './index';
import { SYSTEM_CATEGORIES } from './expenseCategoryService';

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
 * Auto-create the system expense for a purchase (the "what we bought and what
 * we paid" record in the expense register). Idempotent via sourceRef
 * `purchase:<id>` — retries, edits and partial updates never duplicate.
 * Best-effort: a ledger/category failure must never fail the purchase.
 */
async function upsertPurchaseExpense(opts: {
  purchaseId: string;
  restaurantId: string;
  branchId?: string;
  date?: string;
  supplier?: string;
  item: string;
  quantity: number;
  unit: string;
  total: number;
  paymentMethod?: string;
  operator?: string;
}) {
  const sourceRef = `purchase:${opts.purchaseId}`;
  try {
    const existing = await Expense.findOne({ sourceRef }).lean().exec();
    if (existing) {
      // Purchase already has its expense — keep it in sync with corrections.
      if (Math.round((Number(existing.amount) || 0) * 100) !== Math.round(opts.total * 100)) {
        await Expense.updateOne({ _id: existing._id }, { $set: { amount: opts.total, updatedBy: opts.operator || 'System' } }).exec();
      }
      return existing._id.toString();
    }
    const cogsCategory = SYSTEM_CATEGORIES.find((c) => c.isCogs);
    const expense = await Expense.create({
      restaurantId: new mongoose.Types.ObjectId(opts.restaurantId),
      branchId: opts.branchId ? new mongoose.Types.ObjectId(opts.branchId) : undefined,
      date: opts.date || new Date().toISOString().slice(0, 10),
      category: cogsCategory?.name || 'Ingredients & Raw Materials',
      description: `Purchase: ${opts.item} (${opts.quantity} ${opts.unit})${opts.supplier ? ` — ${opts.supplier}` : ''}`,
      amount: opts.total,
      paymentMethod: opts.paymentMethod || 'Cash',
      vendor: opts.supplier || undefined,
      isCogs: true,
      isSystemGenerated: true,
      sourceRef,
      createdBy: opts.operator || 'System',
    } as any);
    // Cash ledger hook — only for cash-paid purchases, same as manual expenses.
    if ((expense.paymentMethod || 'Cash') === 'Cash') {
      await cashLedgerService.recordExpense(opts.restaurantId, {
        expenseId: (expense as any)._id.toString(),
        amount: opts.total,
        date: expense.date,
        branchId: opts.branchId,
        note: expense.description,
        performedBy: opts.operator,
      }).catch((err: any) => console.warn('[PurchaseService] ledger hook skipped:', err.message));
    }
    return (expense as any)._id.toString();
  } catch (err: any) {
    console.warn('[PurchaseService] system expense skipped (purchase still saved):', err.message);
    return null;
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

    // System expense: the purchase lands in the expense register at what was
    // actually paid (idempotent via sourceRef — never duplicated).
    await upsertPurchaseExpense({
      purchaseId: (purchase as any)._id.toString(),
      restaurantId,
      branchId: ctx.branchId || data.branchId,
      date: (purchase as any).date,
      supplier: (purchase as any).supplier,
      item: data.item,
      quantity,
      unit: data.unit || 'kg',
      total: (purchase as any).total,
      paymentMethod: data.paymentMethod,
      operator: ctx.operator,
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

    // Keep the purchase's system expense in sync with the corrected total
    // (idempotent — updates the existing record, never creates a duplicate).
    await upsertPurchaseExpense({
      purchaseId: id,
      restaurantId,
      branchId: (existing as any).branchId || updates.branchId,
      date: updates.date || (existing as any).date,
      supplier: updates.supplier || (existing as any).supplier,
      item: newItem,
      quantity,
      unit: updates.unit || (existing as any).unit || 'kg',
      total: updates.total,
      operator: ctx.operator,
    });

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
    // Void the purchase's system expense (soft-delete — visible in the register
    // as deleted, restorable, and excluded from all finance aggregations).
    try {
      const sourceRef = `purchase:${id}`;
      const linked = await Expense.findOne({ sourceRef }).lean().exec();
      if (linked) {
        await Expense.updateOne(
          { _id: linked._id },
          { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: ctx.operator || 'System' } }
        ).exec();
        if ((linked as any).paymentMethod === 'Cash') {
          await cashLedgerService.recordReversal(restaurantId, {
            expenseId: (linked as any)._id.toString(),
            amount: (linked as any).amount,
            date: (linked as any).date,
            branchId: (linked as any).branchId?.toString(),
            note: `Purchase deleted — ${(linked as any).description}`,
            performedBy: ctx.operator,
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      console.warn('[PurchaseService] expense reversal skipped:', err.message);
    }
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

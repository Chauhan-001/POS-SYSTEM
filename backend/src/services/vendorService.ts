/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vendor Service — Finance vendor management (Phase 1.7).
 * CRUD for vendor records (GSTIN, contacts, terms) + a computed summary
 * (total billed, total paid, outstanding) derived from the Expense ledger.
 * Outstanding/paid are NEVER stored — they're aggregated on demand so they
 * can't drift from the ledger.
 */

import mongoose from 'mongoose';
import { vendorRepo, auditLogRepo } from '../repositories';
import Expense from '../models/Expense';
import Purchase from '../models/Purchase';
import { AppError } from '../utils/AppError';

export class VendorService {
  async list(
    restaurantId: string,
    params: { search?: string; status?: string; includeDeleted?: string; page?: number; limit?: number } = {}
  ) {
    const query: any = {};
    if (params.search) {
      const rx = new RegExp(params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: rx }, { phone: rx }, { gstin: rx }, { email: rx }];
    }
    if (params.status) query.status = params.status;

    const repo = vendorRepo.forTenant(restaurantId);
    const result = params.includeDeleted === 'true'
      ? await repo.findAllRaw(query, { page: params.page || 1, limit: params.limit || 50, sort: { name: 1 } })
      : await repo.findAll(query, { page: params.page || 1, limit: params.limit || 50, sort: { name: 1 } });

    return {
      data: result.data.map((d: any) => d.toObject()),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      nextPage: result.page < result.totalPages ? result.page + 1 : null,
      previousPage: result.page > 1 ? result.page - 1 : null,
    };
  }

  async get(restaurantId: string, id: string) {
    const vendor = await vendorRepo.forTenant(restaurantId).findOne({ _id: id as any } as any);
    if (!vendor) throw new AppError(404, 'Vendor not found');
    return vendor.toObject();
  }

  async create(restaurantId: string, data: any, ctx: { operator?: string } = {}) {
    const vendor = await vendorRepo.forTenant(restaurantId).create({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      ...data,
      createdBy: ctx.operator,
    } as any);
    await auditLogRepo.create({
      action: 'VENDOR_CREATED',
      entityType: 'vendor',
      entityId: (vendor as any)._id.toString(),
      performedBy: ctx.operator || 'System',
      details: { name: data.name },
    } as any);
    return vendor.toObject();
  }

  async update(restaurantId: string, id: string, data: any, ctx: { operator?: string } = {}) {
    const vendor = await vendorRepo.forTenant(restaurantId).update(id, { ...data, updatedBy: ctx.operator } as any);
    if (!vendor) throw new AppError(404, 'Vendor not found');
    await auditLogRepo.create({
      action: 'VENDOR_UPDATED',
      entityType: 'vendor',
      entityId: id,
      performedBy: ctx.operator || 'System',
      details: data,
    } as any);
    return vendor.toObject();
  }

  async softDelete(restaurantId: string, id: string, ctx: { operator?: string } = {}) {
    const vendor = await vendorRepo.forTenant(restaurantId).softDelete(id);
    if (!vendor) throw new AppError(404, 'Vendor not found');
    await auditLogRepo.create({
      action: 'VENDOR_DELETED',
      entityType: 'vendor',
      entityId: id,
      performedBy: ctx.operator || 'System',
    } as any);
    return true;
  }

  /**
   * Vendor summary — total expense billed, total purchases, paid (expenses
   * with non-cash payment are considered "paid" at record time; outstanding is
   * the ledger-derived difference), plus recent expense history.
   */
  async summary(restaurantId: string, id: string, params: { startDate?: string; endDate?: string } = {}) {
    const vendor = await vendorRepo.forTenant(restaurantId).findOne({ _id: id as any } as any);
    if (!vendor) throw new AppError(404, 'Vendor not found');

    const match: any = { restaurantId: new mongoose.Types.ObjectId(restaurantId), vendorId: new mongoose.Types.ObjectId(id), isDeleted: { $ne: true } };
    if (params.startDate || params.endDate) {
      match.date = {};
      if (params.startDate) match.date.$gte = params.startDate;
      if (params.endDate) match.date.$lte = params.endDate;
    }

    const [agg, purchaseAgg, recent] = await Promise.all([
      Expense.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalBilled: { $sum: '$amount' },
            count: { $sum: 1 },
            // Paid = settled immediately (cash/UPI/card/wallet). Bank Transfer /
            // Other are credit terms → outstanding.
            paid: {
              $sum: {
                $cond: [{ $in: ['$paymentMethod', ['Cash', 'UPI', 'Card', 'Wallet']] }, '$amount', 0],
              },
            },
            inputGst: { $sum: { $ifNull: ['$gst.cgst', 0] } },
          },
        },
      ]).exec(),
      Purchase.aggregate([
        { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId), supplier: { $regex: new RegExp(`^${(vendor as any).name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, status: 'completed' } },
        { $group: { _id: null, totalPurchases: { $sum: '$total' }, count: { $sum: 1 } } },
      ]).exec(),
      Expense.find(match).sort({ date: -1 }).limit(10).lean().exec(),
    ]);

    const totals = agg[0] || { totalBilled: 0, count: 0, paid: 0, inputGst: 0 };
    const purchases = purchaseAgg[0] || { totalPurchases: 0, count: 0 };

    return {
      vendor: vendor.toObject(),
      summary: {
        totalBilled: Math.round(totals.totalBilled * 100) / 100,
        expenseCount: totals.count,
        totalPaid: Math.round(totals.paid * 100) / 100,
        outstanding: Math.round((totals.totalBilled - totals.paid) * 100) / 100,
        inputGst: Math.round(totals.inputGst * 100) / 100,
        totalPurchases: Math.round(purchases.totalPurchases * 100) / 100,
        purchaseCount: purchases.count,
      },
      recentExpenses: recent.map((e: any) => ({
        id: e._id.toString(),
        date: e.date,
        category: e.category,
        description: e.description,
        amount: e.amount,
        paymentMethod: e.paymentMethod,
      })),
    };
  }
}

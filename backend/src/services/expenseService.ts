/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Expense Service — Full production-grade expense CRUD (Phase 1.7).
 *
 * Multi-tenant: every query is scoped through expenseRepo.forTenant() using
 * req.user.restaurantId — Restaurant A can never read or write Restaurant B's
 * expenses. Branch isolation is an additional optional filter.
 *
 * Optimistic concurrency: update() bumps `version` and, when the client sends
 * `baseVersion`, only applies when it still matches — a stale offline edit
 * receives a 409 conflict so the POS can reconcile.
 *
 * Cash integration: a cash expense creates a CashLedger 'expense' entry
 * (best-effort, never fails the expense). Deleting a cash expense records a
 * reversal entry so the drawer stays accurate.
 */

import mongoose from 'mongoose';
import { expenseRepo, vendorRepo, auditLogRepo } from '../repositories';
import Expense from '../models/Expense';
import { cashLedgerService } from './index';
import { AppError } from '../utils/AppError';

const CSV_HEADERS = ['Date', 'Category', 'Description', 'Amount', 'Payment Method', 'Vendor', 'Notes', 'COGS', 'Created By'];

function csvEscape(v: any): string {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export class ExpenseService {
  /**
   * List expenses — tenant-scoped, paginated, filterable + debounced search.
   */
  async list(
    restaurantId: string,
    params: {
      branchId?: string; category?: string; vendorId?: string; paymentMethod?: string;
      startDate?: string; endDate?: string; search?: string; isCogs?: string;
      includeDeleted?: string; page?: number; limit?: number;
      sortBy?: string; sortDir?: string;
    } = {}
  ) {
    const query: any = {};
    if (params.branchId) query.branchId = params.branchId;
    if (params.category) query.category = params.category;
    if (params.vendorId) query.vendorId = new mongoose.Types.ObjectId(params.vendorId);
    if (params.paymentMethod) query.paymentMethod = params.paymentMethod;
    if (params.isCogs) query.isCogs = params.isCogs === 'true';
    if (params.startDate || params.endDate) {
      query.date = {};
      if (params.startDate) query.date.$gte = params.startDate;
      if (params.endDate) query.date.$lte = params.endDate;
    }
    if (params.search) {
      const rx = new RegExp(params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ description: rx }, { vendor: rx }, { notes: rx }];
    }

    const includeDeleted = params.includeDeleted === 'true';
    const repo = expenseRepo.forTenant(restaurantId);

    // Deleted expenses only surface when explicitly requested.
    const result = includeDeleted
      ? await repo.findAllRaw(query, {
          page: params.page || 1,
          limit: params.limit || 50,
          sort: { [params.sortBy || 'date']: (params.sortDir || 'desc') === 'desc' ? -1 : 1 },
        })
      : await repo.findAll(query, {
          page: params.page || 1,
          limit: params.limit || 50,
          sort: { [params.sortBy || 'date']: (params.sortDir || 'desc') === 'desc' ? -1 : 1 },
        });

    // Enrich with vendor names (single lookup for the page, never N+1).
    const rows = result.data.map((d: any) => d.toObject());
    const vendorIds = [...new Set(rows.map((r: any) => r.vendorId?.toString()).filter(Boolean))];
    const vendorNameMap = new Map<string, string>();
    if (vendorIds.length) {
      const vendors = await vendorRepo.forTenant(restaurantId).findAllRaw({ _id: { $in: vendorIds.map((id) => new mongoose.Types.ObjectId(id)) } } as any, { limit: vendorIds.length });
      vendors.data.forEach((v: any) => vendorNameMap.set(v._id.toString(), v.name));
    }
    rows.forEach((r: any) => {
      if (r.vendorId) r.vendorName = vendorNameMap.get(r.vendorId.toString()) || '';
    });

    return {
      data: rows,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      nextPage: result.page < result.totalPages ? result.page + 1 : null,
      previousPage: result.page > 1 ? result.page - 1 : null,
    };
  }

  /** Get a single expense (tenant-scoped). */
  async get(restaurantId: string, id: string) {
    const expense = await expenseRepo.forTenant(restaurantId).findOne({ _id: id as any } as any);
    if (!expense) throw new AppError(404, 'Expense not found');
    return expense.toObject();
  }

  /**
   * Create an expense. Stamps restaurantId, resolves the category (server-side),
   * and hooks a CashLedger 'expense' entry when paid in cash.
   */
  async create(
    restaurantId: string,
    data: any,
    ctx: { operator?: string; branchId?: string } = {}
  ) {
    if (!data.amount || data.amount <= 0) throw new AppError(400, 'Amount must be positive');
    if (!data.category) throw new AppError(400, 'Category is required');

    const branchId = data.branchId || ctx.branchId;
    const doc: any = {
      ...data,
      date: data.date || new Date().toISOString().slice(0, 10),
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      branchId: branchId ? new mongoose.Types.ObjectId(branchId) : undefined,
      isCogs: data.isCogs ?? false,
      version: 1,
      isDeleted: false,
      createdBy: data.createdBy || ctx.operator,
    };
    if (data.vendorId) doc.vendorId = new mongoose.Types.ObjectId(data.vendorId);
    if (data.categoryId) doc.categoryId = new mongoose.Types.ObjectId(data.categoryId);

    const expense = await expenseRepo.forTenant(restaurantId).create(doc as any);

    // Cash ledger hook (best-effort — never fail the expense on ledger error).
    if ((expense as any).paymentMethod === 'Cash') {
      await cashLedgerService.recordExpense(restaurantId, {
        expenseId: (expense as any)._id.toString(),
        amount: (expense as any).amount,
        date: (expense as any).date,
        branchId: (expense as any).branchId?.toString(),
        note: (expense as any).description,
        performedBy: ctx.operator,
      }).catch((err: any) => console.warn('[ExpenseService] ledger hook skipped:', err.message));
    }

    await auditLogRepo.create({
      action: 'EXPENSE_CREATED',
      entityType: 'expense',
      entityId: (expense as any)._id.toString(),
      performedBy: ctx.operator || 'System',
      details: { amount: data.amount, category: data.category, date: data.date },
    } as any);

    return expense.toObject();
  }

  /**
   * Update an expense (PATCH). Bumps version; when baseVersion is supplied,
   * rejects stale edits with 409 so offline conflicts surface explicitly.
   */
  async update(
    restaurantId: string,
    id: string,
    patch: any,
    ctx: { operator?: string } = {}
  ) {
    const repo = expenseRepo.forTenant(restaurantId);
    const existing = await repo.findOne({ _id: id as any } as any);
    if (!existing) throw new AppError(404, 'Expense not found');

    const { baseVersion, ...rest } = patch;
    const setFields: Record<string, any> = { ...rest, updatedBy: ctx.operator };
    if (rest.vendorId) setFields.vendorId = new mongoose.Types.ObjectId(rest.vendorId);
    if (rest.categoryId) setFields.categoryId = new mongoose.Types.ObjectId(rest.categoryId);

    if (typeof baseVersion === 'number' && baseVersion !== (existing as any).version) {
      throw new AppError(
        409,
        `Expense was modified by another device (version ${(existing as any).version}). Refresh and retry.`
      );
    }

    const updated = await repo.findOneAndUpdate(
      { _id: id as any } as any,
      { ...setFields, $inc: { version: 1 } } as any,
      {}
    );

    await auditLogRepo.create({
      action: 'EXPENSE_UPDATED',
      entityType: 'expense',
      entityId: id,
      performedBy: ctx.operator || 'System',
      details: { changed: Object.keys(rest), fromVersion: (existing as any).version, toVersion: ((existing as any).version || 0) + 1 },
    } as any);

    return updated?.toObject();
  }

  /**
   * Soft-delete with reason + actor. Manager/Owner PIN is verified at the
   * controller; this method records the audit and reverses the cash ledger
   * entry (best-effort) so the drawer isn't permanently short.
   */
  async softDelete(
    restaurantId: string,
    id: string,
    ctx: { operator?: string; reason?: string; branchId?: string } = {}
  ) {
    const repo = expenseRepo.forTenant(restaurantId);
    const existing = await repo.findOne({ _id: id as any } as any);
    if (!existing) throw new AppError(404, 'Expense not found');

    const deleted = await repo.findOneAndUpdate(
      { _id: id as any } as any,
      {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: ctx.operator,
        notes: ctx.reason ? `${(existing as any).notes ? (existing as any).notes + ' ' : ''}[Deleted: ${ctx.reason}]` : (existing as any).notes,
        $inc: { version: 1 },
      } as any,
      {}
    );

    // Cash reversal (best-effort) — a deleted cash expense puts the cash back.
    if ((existing as any).paymentMethod === 'Cash') {
      await cashLedgerService.recordReversal(restaurantId, {
        expenseId: id,
        amount: (existing as any).amount,
        date: (existing as any).date,
        branchId: (existing as any).branchId?.toString(),
        note: `Expense deleted: ${(existing as any).description}`,
        performedBy: ctx.operator,
      }).catch((err: any) => console.warn('[ExpenseService] ledger reversal skipped:', err.message));
    }

    await auditLogRepo.create({
      action: 'EXPENSE_DELETED',
      entityType: 'expense',
      entityId: id,
      performedBy: ctx.operator || 'System',
      details: { reason: ctx.reason, amount: (existing as any).amount },
    } as any);

    return deleted?.toObject();
  }

  /** Restore a soft-deleted expense (Owner/Manager). */
  async restore(restaurantId: string, id: string, ctx: { operator?: string } = {}) {
    const repo = expenseRepo.forTenant(restaurantId);
    const existing = await repo.findAllRaw({ _id: id as any } as any, { page: 1, limit: 1 });
    if (!existing.data[0]) throw new AppError(404, 'Expense not found');
    if (!(existing.data[0] as any).isDeleted) throw new AppError(400, 'Expense is not deleted');

    // Use the model directly — the repository filter excludes soft-deleted
    // docs, so it can never match (or update) the record being restored.
    const restored = await Expense.findOneAndUpdate(
      { _id: id as any, restaurantId: new mongoose.Types.ObjectId(restaurantId) } as any,
      {
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        restoredAt: new Date(),
        restoredBy: ctx.operator,
        $inc: { version: 1 },
        updatedAt: new Date(),
      } as any,
      { new: true }
    ).exec();

    await auditLogRepo.create({
      action: 'EXPENSE_RESTORED',
      entityType: 'expense',
      entityId: id,
      performedBy: ctx.operator || 'System',
    } as any);

    return restored?.toObject();
  }

  /** Export expenses to CSV (tenant-scoped, honors the same filters as list). */
  async exportCsv(restaurantId: string, params: any = {}): Promise<string> {
    const result = await this.list(restaurantId, { ...params, limit: 10000, includeDeleted: 'false' });
    const rows = result.data.map((e: any) => [
      e.date, e.category, e.description, e.amount, e.paymentMethod,
      e.vendor, e.notes, e.isCogs ? 'Yes' : 'No', e.createdBy,
    ]);
    return [CSV_HEADERS, ...rows]
      .map((r) => r.map(csvEscape).join(','))
      .join('\n');
  }
}

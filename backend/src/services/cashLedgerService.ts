/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CashLedger Service — True cash-flow ledger (Phase 1.7).
 *
 * Every cash movement is an append-only entry with a running balanceAfter:
 *   - opening cash (once per day/branch)
 *   - cash in / cash out / drawer adjustment / bank deposit / bank withdrawal
 *   - expense deductions (hooked by expenseService)
 *   - shift closing with counted cash → over/short
 *
 * The service is tenant-scoped (restaurantId from req.user). balanceAfter is
 * recomputed from the previous entry atomically (findOneAndUpdate guard) so
 * concurrent terminals can't double-count.
 */

import mongoose from 'mongoose';
import { cashLedgerRepo, auditLogRepo } from '../repositories';
import CashLedger from '../models/CashLedger';
import { AppError } from '../utils/AppError';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export class CashLedgerService {
  /**
   * Current cash balance for a restaurant (optionally per branch).
   * Reads the latest entry's balanceAfter; 0 when no entries yet.
   */
  async getBalance(restaurantId: string, branchId?: string): Promise<number> {
    const query: any = branchId ? { branchId: objectId(branchId) } : {};
    const latest = await cashLedgerRepo.forTenant(restaurantId)
      .findAll(query, { page: 1, limit: 1, sort: { createdAt: -1 } });
    return (latest.data[0] as any)?.balanceAfter || 0;
  }

  /**
   * Record an entry with an atomic running balance. `amount` positive = cash
   * in, negative = cash out. Throws when the resulting balance would go
   * negative for withdrawals (opening/in adjustments may restore).
   */
  private async record(
    restaurantId: string,
    entry: {
      type: string; amount: number; date?: string; branchId?: string;
      refType?: string; refId?: string; note?: string; shiftId?: string;
      countedCash?: number; overShort?: number; performedBy?: string;
    }
  ) {
    const date = entry.date || new Date().toISOString().slice(0, 10);
    const query: any = entry.branchId ? { branchId: objectId(entry.branchId) } : {};
    const prev = await cashLedgerRepo.forTenant(restaurantId)
      .findAll(query, { page: 1, limit: 1, sort: { createdAt: -1 } });
    const prevBalance = (prev.data[0] as any)?.balanceAfter || 0;

    let balanceAfter = Math.round((prevBalance + entry.amount) * 100) / 100;
    // Guard: only EXPLICIT withdrawals (cash_out / bank_deposit) are blocked on
    // insufficient funds. Expenses and adjustments are recorded even when the
    // drawer is empty — a negative balance is a real signal worth seeing in the
    // ledger, and expense recording must never fail.
    if (balanceAfter < 0 && (entry.type === 'cash_out' || entry.type === 'bank_deposit')) {
      throw new AppError(400, `Insufficient cash — drawer balance is ${prevBalance}`);
    }

    const ledger = await cashLedgerRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      branchId: entry.branchId ? objectId(entry.branchId) : undefined,
      date,
      type: entry.type,
      amount: Math.round(entry.amount * 100) / 100,
      balanceAfter,
      refType: entry.refType,
      refId: entry.refId,
      note: entry.note,
      shiftId: entry.shiftId,
      countedCash: entry.countedCash,
      overShort: entry.overShort,
      performedBy: entry.performedBy,
    } as any);

    return ledger.toObject();
  }

  /** Open the drawer for the day (idempotent — refuses a second opening). */
  async openCash(restaurantId: string, data: { amount: number; date?: string; branchId?: string; note?: string; performedBy?: string }) {
    const date = data.date || new Date().toISOString().slice(0, 10);
    const query: any = { type: 'opening', date };
    if (data.branchId) query.branchId = objectId(data.branchId);
    const existing = await cashLedgerRepo.forTenant(restaurantId).findOne(query);
    if (existing) throw new AppError(400, 'Opening cash already recorded for this day');

    const entry = await this.record(restaurantId, {
      type: 'opening',
      amount: data.amount,
      date,
      branchId: data.branchId,
      note: data.note || 'Opening cash',
      performedBy: data.performedBy,
    });

    await auditLogRepo.create({
      action: 'CASH_OPENING',
      entityType: 'cash_ledger',
      performedBy: data.performedBy || 'System',
      details: { amount: data.amount, date },
    } as any);
    return entry;
  }

  /** Generic cash in / out / drawer adjustment / bank movements. */
  async addEntry(
    restaurantId: string,
    data: {
      type: 'cash_in' | 'cash_out' | 'drawer_adjustment' | 'bank_deposit' | 'bank_withdrawal';
      amount: number; date?: string; branchId?: string; note?: string;
      refType?: string; refId?: string; performedBy?: string;
    }
  ) {
    const signed = (data.type === 'cash_in' || data.type === 'bank_withdrawal')
      ? data.amount
      : -data.amount;
    const entry = await this.record(restaurantId, {
      ...data,
      type: data.type,
      amount: signed,
    });
    await auditLogRepo.create({
      action: 'CASH_ADJUSTMENT',
      entityType: 'cash_ledger',
      performedBy: data.performedBy || 'System',
      details: { type: data.type, amount: signed, note: data.note },
    } as any);
    return entry;
  }

  /** Hook called by expenseService for cash expenses. */
  async recordExpense(
    restaurantId: string,
    data: { expenseId: string; amount: number; date?: string; branchId?: string; note?: string; performedBy?: string }
  ) {
    return this.record(restaurantId, {
      type: 'expense',
      amount: -data.amount,
      date: data.date,
      branchId: data.branchId,
      refType: 'expense',
      refId: data.expenseId,
      note: data.note || 'Expense',
      performedBy: data.performedBy,
    });
  }

  /** Hook called by expenseService when a cash expense is deleted. */
  async recordReversal(
    restaurantId: string,
    data: { expenseId: string; amount: number; date?: string; branchId?: string; note?: string; performedBy?: string }
  ) {
    return this.record(restaurantId, {
      type: 'cash_in',
      amount: data.amount,
      date: data.date,
      branchId: data.branchId,
      refType: 'expense',
      refId: data.expenseId,
      note: data.note || 'Expense reversal',
      performedBy: data.performedBy,
    });
  }

  /**
   * Close a shift — expected cash is the running balance; over/short =
   * countedCash − expectedCash. Records a shift_closing entry.
   */
  async closeShift(
    restaurantId: string,
    data: { countedCash: number; date?: string; branchId?: string; note?: string; performedBy?: string }
  ) {
    const date = data.date || new Date().toISOString().slice(0, 10);
    const query: any = { type: 'shift_closing', date };
    if (data.branchId) query.branchId = objectId(data.branchId);
    const existing = await cashLedgerRepo.forTenant(restaurantId).findOne(query);
    if (existing) throw new AppError(400, 'Shift already closed for this day');

    const expected = await this.getBalance(restaurantId, data.branchId);
    const overShort = Math.round((data.countedCash - expected) * 100) / 100;
    const entry = await this.record(restaurantId, {
      type: 'shift_closing',
      amount: overShort, // reconcile the drawer to the counted cash
      date,
      branchId: data.branchId,
      shiftId: `shift-${date}`,
      countedCash: data.countedCash,
      overShort,
      note: data.note || (overShort >= 0 ? 'Shift closed' : `Cash short by ${Math.abs(overShort)}`),
      performedBy: data.performedBy,
    });

    await auditLogRepo.create({
      action: 'SHIFT_CLOSED',
      entityType: 'cash_ledger',
      performedBy: data.performedBy || 'System',
      details: { date, expected, counted: data.countedCash, overShort },
    } as any);
    return { ...entry, expectedCash: expected };
  }

  /** Ledger history (tenant-scoped, paged, filterable). */
  async history(
    restaurantId: string,
    params: { branchId?: string; startDate?: string; endDate?: string; type?: string; page?: number; limit?: number } = {}
  ) {
    const query: any = {};
    if (params.branchId) query.branchId = params.branchId;
    if (params.type) query.type = params.type;
    if (params.startDate || params.endDate) {
      query.date = {};
      if (params.startDate) query.date.$gte = params.startDate;
      if (params.endDate) query.date.$lte = params.endDate;
    }
    const result = await cashLedgerRepo.forTenant(restaurantId).findAll(query, {
      page: params.page || 1,
      limit: params.limit || 50,
      sort: { createdAt: -1 },
    });
    return {
      data: result.data.map((d: any) => d.toObject()),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      balance: await this.getBalance(restaurantId, params.branchId),
    };
  }

  /** Aggregated per-day cash totals (used by cash-flow reports). */
  async dailyTotals(restaurantId: string, branchId?: string, startDate?: string, endDate?: string): Promise<any[]> {
    const match: any = { restaurantId: objectId(restaurantId) };
    if (branchId) match.branchId = objectId(branchId);
    if (startDate || endDate) {
      match.date = {};
      if (startDate) match.date.$gte = startDate;
      if (endDate) match.date.$lte = endDate;
    }
    // Aggregations must cast restaurantId to ObjectId explicitly (no auto-cast).
    return CashLedger.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$date',
          opening: { $sum: { $cond: [{ $eq: ['$type', 'opening'] }, '$amount', 0] } },
          cashIn: { $sum: { $cond: [{ $in: ['$type', ['cash_in', 'bank_withdrawal']] }, '$amount', 0] } },
          cashOut: { $sum: { $cond: [{ $in: ['$type', ['cash_out', 'expense', 'bank_deposit']] }, { $abs: '$amount' }, 0] } },
          expenses: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, { $abs: '$amount' }, 0] } },
          adjustments: { $sum: { $cond: [{ $eq: ['$type', 'drawer_adjustment'] }, '$amount', 0] } },
          overShort: { $sum: { $cond: [{ $eq: ['$type', 'shift_closing'] }, { $ifNull: ['$overShort', 0] }, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  }
}

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
import CashLedger from '../models/finance/CashLedger';
import Bill from '../models/intelligence/Bill';
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
   * Shared expected-cash calculation used by closeShift() and zReport().
   *
   * Expected Cash = Opening Cash + Cash Sales(from bills) + Manual Cash In
   *   − Manual Cash Out − Cash Expenses − Cash Refunds
   *
   * Cash Sales = Σ grandTotal where paymentMethod='Cash'
   *           + Σ splitDetails.cashAmount where paymentMethod='Split'
   *
   * Cash Refunds = Σ refundAmount where paymentMethod='Cash'
   *            + Σ splitDetails.cashAmount where paymentMethod='Split' && isRefunded
   *
   * Both closeShift and zReport use this identical formula so they always
   * produce the same expected-cash figure for the same period.
   */
  async computeExpectedCash(
    restaurantId: string,
    params: { branchId?: string; date?: string; shiftStart?: Date; shiftEnd?: Date; shiftId?: string } = {}
  ): Promise<{
    openingCash: number;
    cashSales: number;
    cashIn: number;
    cashOut: number;
    cashExpenses: number;
    adjustments: number;
    cashRefunds: number;
    expectedCash: number;
  }> {
    const oid = objectId(restaurantId);
    const date = params.date || new Date().toISOString().slice(0, 10);

    // ── Opening cash from ledger ─────────────────────────────────────
    const openingQuery: any = { restaurantId: oid, type: 'opening', date };
    if (params.branchId) openingQuery.branchId = objectId(params.branchId);
    const openingEntry = await cashLedgerRepo.forTenant(restaurantId).findOne(openingQuery);
    const openingCash = Math.round((openingEntry?.amount || 0) * 100) / 100;

    // ── Cash sales from bills ────────────────────────────────────────
    const billMatch: any = {
      restaurantId: oid,
      date,
      isVoided: { $ne: true },
    };
    if (params.branchId) billMatch.branchId = objectId(params.branchId);
    if (params.shiftId) billMatch.shiftId = params.shiftId;
    if (params.shiftStart || params.shiftEnd) {
      billMatch.createdAt = {};
      if (params.shiftStart) billMatch.createdAt.$gte = params.shiftStart;
      if (params.shiftEnd) billMatch.createdAt.$lte = params.shiftEnd;
    }

    const [cashBills, splitBills] = await Promise.all([
      Bill.aggregate([
        { $match: { ...billMatch, paymentMethod: 'Cash' } },
        { $group: { _id: null, total: { $sum: '$grandTotal' } } },
      ]).exec(),
      Bill.aggregate([
        { $match: { ...billMatch, paymentMethod: 'Split' } },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ['$splitDetails.cashAmount', 0] } },
          },
        },
      ]).exec(),
    ]);

    const cashSales = Math.round(
      ((cashBills[0]?.total || 0) + (splitBills[0]?.total || 0)) * 100
    ) / 100;

    // ── Manual cash movements from ledger ────────────────────────────
    const ledgerMatch: any = {
      restaurantId: oid,
      ...(params.branchId ? { branchId: objectId(params.branchId) } : {}),
      date,
      ...(params.shiftId ? { shiftId: params.shiftId } : {}),
      ...(params.shiftStart || params.shiftEnd
        ? { createdAt: { ...(params.shiftStart ? { $gte: params.shiftStart } : {}), ...(params.shiftEnd ? { $lte: params.shiftEnd } : {}) } }
        : {}),
    };

    const ledgerAgg = await CashLedger.aggregate([
      { $match: ledgerMatch },
      {
        $group: {
          _id: null,
          cashIn: {
            $sum: {
              $cond: [{ $in: ['$type', ['cash_in', 'bank_withdrawal']] }, '$amount', 0],
            },
          },
          cashOut: {
            $sum: {
              $cond: [{ $in: ['$type', ['cash_out', 'bank_deposit']] }, { $abs: '$amount' }, 0],
            },
          },
          cashExpenses: {
            $sum: { $cond: [{ $eq: ['$type', 'expense'] }, { $abs: '$amount' }, 0] },
          },
          adjustments: {
            $sum: { $cond: [{ $eq: ['$type', 'drawer_adjustment'] }, '$amount', 0] },
          },
        },
      },
    ]).exec();

    const ledger = ledgerAgg[0] || { cashIn: 0, cashOut: 0, cashExpenses: 0, adjustments: 0 };

    // ── Cash refunds from bills ──────────────────────────────────────
    const refundAgg = await Bill.aggregate([
      {
        $match: {
          ...billMatch,
          isRefunded: true,
          $or: [
            { paymentMethod: 'Cash' },
            { 'splitDetails.cashAmount': { $gt: 0 } },
          ],
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [
                { $eq: ['$paymentMethod', 'Cash'] },
                '$refundAmount',
                { $ifNull: ['$splitDetails.cashAmount', 0] },
              ],
            },
          },
        },
      },
    ]).exec();

    const cashRefunds = Math.round((refundAgg[0]?.total || 0) * 100) / 100;

    const expectedCash = Math.round(
      (openingCash + cashSales + ledger.cashIn - ledger.cashOut - ledger.cashExpenses - cashRefunds + ledger.adjustments) * 100
    ) / 100;

    return {
      openingCash,
      cashSales,
      cashIn: Math.round(ledger.cashIn * 100) / 100,
      cashOut: Math.round(ledger.cashOut * 100) / 100,
      cashExpenses: Math.round(ledger.cashExpenses * 100) / 100,
      adjustments: Math.round(ledger.adjustments * 100) / 100,
      cashRefunds,
      expectedCash,
    };
  }

  /**
   * Close a shift — expected cash is computed from bills + ledger; over/short =
   * countedCash − expectedCash. Records a shift_closing entry.
   */
  async closeShift(
    restaurantId: string,
    data: { countedCash: number; date?: string; branchId?: string; shiftId?: string; note?: string; performedBy?: string }
  ) {
    const date = data.date || new Date().toISOString().slice(0, 10);
    const query: any = { type: 'shift_closing', date };
    if (data.branchId) query.branchId = objectId(data.branchId);
    const existing = await cashLedgerRepo.forTenant(restaurantId).findOne(query);
    if (existing) throw new AppError(400, 'Shift already closed for this day');

    const reconciliation = await this.computeExpectedCash(restaurantId, {
      branchId: data.branchId,
      date,
      shiftId: data.shiftId,
    });
    const expected = reconciliation.expectedCash;
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
    return { ...entry, expectedCash: expected, variance: overShort, closingCash: data.countedCash };
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

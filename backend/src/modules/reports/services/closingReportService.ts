/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ClosingReportService — Daily closing X/Z reports (Phase 1.8).
 *
 * X report  — mid-shift snapshot (sales, cash in drawer, payment split).
 * Z report  — end-of-day closing (full sales + cash reconciliation against
 *             the CashLedger: opening, in/out, expected vs actual, over/short).
 *
 * Cash reconciliation uses the real CashLedger (Phase 1.7) so the report is
 * always consistent with the ledger — never a client-side estimate.
 */

import mongoose from 'mongoose';
import Bill from '../../../models/Bill';
import { cashLedgerService } from '../../../services';
import { dateRange, ReportScope } from './salesReportService';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export class ClosingReportService {
  /** Shared daily sales aggregation (single day required). */
  private async dailySales(scope: ReportScope, date: string) {
    const match: Record<string, any> = {
      restaurantId: objectId(scope.restaurantId),
      date,
      isVoided: { $ne: true },
    };
    if (scope.branchId) match.branchId = objectId(scope.branchId);
    const rows = await Bill.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$grandTotal' },
          netRevenue: { $sum: { $subtract: ['$grandTotal', { $cond: [{ $eq: ['$isRefunded', true] }, { $ifNull: ['$refundAmount', 0] }, 0] }] } },
          orders: { $sum: 1 },
          discount: { $sum: { $ifNull: ['$discount', 0] } },
          gst: { $sum: { $ifNull: ['$gst', 0] } },
          cash: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'Cash'] }, '$grandTotal', 0] } },
        },
      },
    ]).exec();

    const payments = await Bill.aggregate([
      { $match: match },
      { $group: { _id: '$paymentMethod', amount: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
    ]).exec();

    return {
      date,
      ...(rows[0] || { revenue: 0, netRevenue: 0, orders: 0, discount: 0, gst: 0, cash: 0 }),
      payments: payments.map((p: any) => ({
        method: p._id,
        amount: Math.round(p.amount * 100) / 100,
        count: p.count,
      })),
    };
  }

  /** GET /api/reports/closing/x — mid-shift snapshot. */
  async xReport(scope: ReportScope, date?: string) {
    const day = date || new Date().toISOString().slice(0, 10);
    const sales = await this.dailySales(scope, day);
    const cashFlow = await cashLedgerService.dailyTotals(scope.restaurantId, scope.branchId, day, day);
    const balance = await cashLedgerService.getBalance(scope.restaurantId, scope.branchId);

    return {
      reportType: 'X',
      generatedAt: new Date().toISOString(),
      sales: {
        date: day,
        grossRevenue: Math.round(sales.revenue * 100) / 100,
        netRevenue: Math.round(sales.netRevenue * 100) / 100,
        orders: sales.orders,
        averageOrderValue: sales.orders > 0 ? Math.round((sales.netRevenue / sales.orders) * 100) / 100 : 0,
        discounts: Math.round(sales.discount * 100) / 100,
        taxes: Math.round(sales.gst * 100) / 100,
        payments: sales.payments,
      },
      cash: {
        cashSales: Math.round(sales.cash * 100) / 100,
        cashIn: Math.round((cashFlow as any[]).reduce((s, d) => s + (d.cashIn || 0), 0) * 100) / 100,
        cashOut: Math.round((cashFlow as any[]).reduce((s, d) => s + (d.cashOut || 0), 0) * 100) / 100,
        overShort: Math.round((cashFlow as any[]).reduce((s, d) => s + (d.overShort || 0), 0) * 100) / 100,
        drawerBalance: balance,
      },
    };
  }

  /** GET /api/reports/closing/z — end-of-day closing with reconciliation. */
  async zReport(scope: ReportScope, date?: string) {
    const day = date || new Date().toISOString().slice(0, 10);
    const sales = await this.dailySales(scope, day);
    const ledger = await cashLedgerService.history(scope.restaurantId, { branchId: scope.branchId, startDate: day, endDate: day, limit: 5000 } as any);
    const entries = (ledger as any).data || [];
    const balance = await cashLedgerService.getBalance(scope.restaurantId, scope.branchId);

    const opening = entries.find((e: any) => e.type === 'opening')?.amount || 0;
    const cashIn = entries.filter((e: any) => ['cash_in', 'shift_open', 'deposit'].includes(e.type)).reduce((s: number, e: any) => s + e.amount, 0);
    const cashOut = entries.filter((e: any) => ['cash_out', 'withdrawal', 'bank_deposit'].includes(e.type)).reduce((s: number, e: any) => s + Math.abs(e.amount), 0);
    const expenses = entries.filter((e: any) => e.type === 'expense').reduce((s: number, e: any) => s + Math.abs(e.amount), 0);
    const adjustments = entries.filter((e: any) => e.type === 'adjustment').reduce((s: number, e: any) => s + e.amount, 0);
    const expectedCash = opening + sales.cash + cashIn - cashOut - expenses + adjustments;
    const overShort = Math.round((balance - expectedCash) * 100) / 100;

    return {
      reportType: 'Z',
      generatedAt: new Date().toISOString(),
      sales: {
        date: day,
        grossRevenue: Math.round(sales.revenue * 100) / 100,
        netRevenue: Math.round(sales.netRevenue * 100) / 100,
        orders: sales.orders,
        averageOrderValue: sales.orders > 0 ? Math.round((sales.netRevenue / sales.orders) * 100) / 100 : 0,
        discounts: Math.round(sales.discount * 100) / 100,
        taxes: Math.round(sales.gst * 100) / 100,
        payments: sales.payments,
      },
      cash: {
        openingCash: Math.round(opening * 100) / 100,
        cashSales: Math.round(sales.cash * 100) / 100,
        cashIn: Math.round(cashIn * 100) / 100,
        cashOut: Math.round(cashOut * 100) / 100,
        expenses: Math.round(expenses * 100) / 100,
        adjustments: Math.round(adjustments * 100) / 100,
        expectedCash: Math.round(expectedCash * 100) / 100,
        actualCash: balance,
        overShort,
      },
      requiresManagerApproval: Math.abs(overShort) > 0.5,
    };
  }
}

export const closingReportService = new ClosingReportService();

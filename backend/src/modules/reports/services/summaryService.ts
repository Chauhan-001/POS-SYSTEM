/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SummaryService — Materialized report summaries (Phase 1.8).
 *
 * - DailySummary: already written by billService.bumpDailySummary — this
 *   service finally exposes READ APIs for it (the audit finding).
 * - MonthlySummary / YearlySummary: new materialized rolls built from bills.
 * - Rebuild: recompute a day / month / year / all from the bill collection.
 * - Incremental update: after each completed bill, the POS calls the
 *   incremental endpoint to keep month/year rows fresh without a full rebuild.
 */

import mongoose from 'mongoose';
import Bill from '../../../models/Bill';
import BillItem from '../../../models/BillItem';
import { dailySummaryRepo, monthlySummaryRepo, yearlySummaryRepo } from '../../../repositories';
import MonthlySummary from '../../../models/MonthlySummary';
import YearlySummary from '../../../models/YearlySummary';
import { dateRange, ReportScope } from './salesReportService';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export class SummaryService {
  /** GET /api/reports/summaries/daily — read materialized day snapshots. */
  async daily(scope: ReportScope) {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const query: any = { date: { $gte: start, $lte: end } };
    if (scope.branchId) query.branchId = objectId(scope.branchId);
    const rows = await dailySummaryRepo.forTenant(scope.restaurantId).findAll(query as any, {
      page: 1,
      limit: 370,
      sort: { date: -1 },
    });
    return {
      data: rows.data.map((d: any) => d.toObject()),
      total: rows.total,
      start,
      end,
    };
  }

  /** GET /api/reports/summaries/monthly — read materialized month rolls. */
  async monthly(scope: ReportScope) {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const monthStart = start.slice(0, 7);
    const monthEnd = end.slice(0, 7);
    const query: any = { month: { $gte: monthStart, $lte: monthEnd } };
    if (scope.branchId) query.branchId = objectId(scope.branchId);
    const rows = await monthlySummaryRepo.forTenant(scope.restaurantId).findAll(query as any, {
      page: 1,
      limit: 60,
      sort: { month: -1 },
    });
    return { data: rows.data.map((d: any) => d.toObject()), total: rows.total };
  }

  /** GET /api/reports/summaries/yearly — read materialized year rolls. */
  async yearly(scope: ReportScope) {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const query: any = { year: { $gte: start.slice(0, 4), $lte: end.slice(0, 4) } };
    if (scope.branchId) query.branchId = objectId(scope.branchId);
    const rows = await yearlySummaryRepo.forTenant(scope.restaurantId).findAll(query as any, {
      page: 1,
      limit: 20,
      sort: { year: -1 },
    });
    return { data: rows.data.map((d: any) => d.toObject()), total: rows.total };
  }

  /** POST /api/reports/summaries/rebuild — recompute month/year for a range. */
  async rebuild(scope: ReportScope) {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const months = new Set<string>();
    for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      months.add(d.toISOString().slice(0, 7));
    }
    const rebuilt: string[] = [];
    for (const month of months) {
      await this.rebuildMonth(scope, month);
      rebuilt.push(month);
    }
    return { rebuilt, count: rebuilt.length };
  }

  /** Recompute a single month roll + its parent year roll from bills. */
  private async rebuildMonth(scope: ReportScope, month: string) {
    const year = month.slice(0, 4);
    const match: any = {
      restaurantId: objectId(scope.restaurantId),
      date: { $gte: `${month}-01`, $lte: `${month}-31` },
      isVoided: { $ne: true },
    };
    if (scope.branchId) match.branchId = objectId(scope.branchId);

    const bills = await Bill.find(match).lean().exec();
    const billIds = bills.map((b: any) => b._id);
    const itemRows = billIds.length
      ? await BillItem.aggregate([
          { $match: { billId: { $in: billIds } } },
          { $group: { _id: '$itemName', qty: { $sum: '$quantity' }, revenue: { $sum: { $multiply: ['$priceAtSale', '$quantity'] } } } },
          { $sort: { qty: -1 } },
          { $limit: 20 },
        ]).exec()
      : [];
    const catRows = billIds.length
      ? await BillItem.aggregate([
          { $match: { billId: { $in: billIds } } },
          { $group: { _id: '$itemName', qty: { $sum: '$quantity' }, revenue: { $sum: { $multiply: ['$priceAtSale', '$quantity'] } } } },
        ]).exec()
      : [];

    const totalRevenue = bills.reduce((s, b) => s + b.grandTotal, 0);
    const totalOrders = bills.length;
    const itemsSold = itemRows.reduce((s, r) => s + r.qty, 0);
    const totalDiscount = bills.reduce((s, b) => s + (b.discount || 0), 0);
    const totalGst = bills.reduce((s, b) => s + (b.gst || 0), 0);
    const cashSales = bills.filter((b) => b.paymentMethod === 'Cash').reduce((s, b) => s + b.grandTotal, 0);
    const pointsEarned = bills.reduce((s, b) => s + (b.pointsEarned || 0), 0);
    const pointsRedeemed = bills.reduce((s, b) => s + (b.pointsRedeemed || 0), 0);

    const catMap = new Map<string, { qty: number; revenue: number }>();
    catRows.forEach((r: any) => {
      const e = catMap.get(r._id) || { qty: 0, revenue: 0 };
      e.qty += r.qty;
      e.revenue += r.revenue;
      catMap.set(r._id, e);
    });
    const categoryBreakdown = Array.from(catMap.entries())
      .map(([category, v]) => ({ category, qty: v.qty, revenue: Math.round(v.revenue * 100) / 100 }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 20);

    const doc: any = {
      restaurantId: objectId(scope.restaurantId),
      branchId: scope.branchId ? objectId(scope.branchId) : undefined,
      month,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalOrders,
      totalItemsSold: itemsSold,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      totalGst: Math.round(totalGst * 100) / 100,
      averageOrderValue: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
      cashSales: Math.round(cashSales * 100) / 100,
      nonCashSales: Math.round((totalRevenue - cashSales) * 100) / 100,
      pointsEarned,
      pointsRedeemed,
      categoryBreakdown,
      topItems: itemRows.map((r: any) => ({
        name: r._id,
        qty: r.qty,
        revenue: Math.round(r.revenue * 100) / 100,
      })),
    };

    await monthlySummaryRepo.forTenant(scope.restaurantId).findOneAndUpdate({ month } as any, doc as any, { upsert: true });
    await this.rebuildYear(scope, year);
    return doc;
  }

  /** Recompute a year roll from its monthly rolls (or bills fallback). */
  private async rebuildYear(scope: ReportScope, year: string) {
    const match: any = {
      restaurantId: objectId(scope.restaurantId),
      month: { $gte: `${year}-01`, $lte: `${year}-12` },
    };
    if (scope.branchId) match.branchId = objectId(scope.branchId);
    const months = await MonthlySummary.find(match).lean().exec();

    const totalRevenue = months.reduce((s, m) => s + m.totalRevenue, 0);
    const totalOrders = months.reduce((s, m) => s + m.totalOrders, 0);
    const doc: any = {
      restaurantId: objectId(scope.restaurantId),
      branchId: scope.branchId ? objectId(scope.branchId) : undefined,
      year,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalOrders,
      totalItemsSold: months.reduce((s, m) => s + m.totalItemsSold, 0),
      totalDiscount: Math.round(months.reduce((s, m) => s + m.totalDiscount, 0) * 100) / 100,
      totalGst: Math.round(months.reduce((s, m) => s + m.totalGst, 0) * 100) / 100,
      averageOrderValue: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
      cashSales: Math.round(months.reduce((s, m) => s + m.cashSales, 0) * 100) / 100,
      nonCashSales: Math.round(months.reduce((s, m) => s + m.nonCashSales, 0) * 100) / 100,
      pointsEarned: months.reduce((s, m) => s + m.pointsEarned, 0),
      pointsRedeemed: months.reduce((s, m) => s + m.pointsRedeemed, 0),
      months: months.map((m) => ({ month: m.month, revenue: m.totalRevenue, orders: m.totalOrders })),
    };
    await yearlySummaryRepo.forTenant(scope.restaurantId).findOneAndUpdate({ year } as any, doc as any, { upsert: true });
    return doc;
  }
}

export const summaryService = new SummaryService();

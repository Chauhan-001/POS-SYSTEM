/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SalesReportService — Backend sales reporting engine (Phase 1.8).
 *
 * Every metric is computed with MongoDB aggregation pipelines, tenant-scoped
 * by restaurantId, branch-aware, and excludes voided/refunded/deleted bills
 * (voided and refunded bills are surfaced only through the dedicated
 * status reports). The frontend never calculates these figures.
 */

import mongoose from 'mongoose';
import Bill from '../../../models/Bill';
import BillItem from '../../../models/BillItem';
import DailySummary from '../../../models/DailySummary';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/** Inclusive date range, defaulting to today (LOCAL calendar date). */
export function dateRange(startDate?: string, endDate?: string): { start: string; end: string } {
  // Offset-adjusted local date, NOT the UTC date: bills are stamped with the
  // store's local date/time, so in timezones east of UTC (e.g. India, +5:30)
  // a UTC "today" is yesterday's date before 5:30 AM local and every report
  // would silently cover the wrong day.
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return { start: startDate || today, end: endDate || today };
}

/** Shift a date backwards by N days (YYYY-MM-DD). */
function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ReportScope {
  restaurantId: string;
  branchId?: string;
  startDate?: string;
  endDate?: string;
  /** Business-day opening time (HH:mm, 24h). When present, the range is treated
   *  as a business window: bills before opening on the START date belong to the
   *  previous business day and are excluded, while bills before opening on the
   *  day AFTER the end date (overnight late-close) belong to this window. */
  openingTime?: string;
}

/**
 * Date predicate for report queries. Without `openingTime` this is the plain
 * inclusive date-range filter. With it, a single-day "today" report covers
 * [start 08:00 → start+1 08:00) and a multi-day range excludes pre-opening
 * bills on the start date while including post-midnight bills after the end
 * date — exactly the frontend business-day semantics.
 */
export function dateClause(scope: ReportScope): Record<string, any> {
  const { start, end } = dateRange(scope.startDate, scope.endDate);
  const op = scope.openingTime ? scope.openingTime.slice(0, 5) : undefined;
  if (!op) return { date: { $gte: start, $lte: end } };
  if (start === end) {
    return {
      $and: [{
        $or: [
          { date: start, time: { $gte: op } },
          { date: shiftDays(start, 1), time: { $lt: op } },
        ],
      }],
    };
  }
  return {
    $and: [{
      $or: [
        { date: { $gte: start, $lte: end }, time: { $gte: op } },
        { date: shiftDays(end, 1), time: { $lt: op } },
      ],
    }],
  };
}

export class SalesReportService {
  /**
   * Build the shared base $match for valid (non-voided, non-refunded) bills.
   * Refunded bills are included in revenue only up to their refunded amount;
   * the pipeline below subtracts refundAmount for a true net figure.
   */
  private baseMatch(scope: ReportScope): Record<string, any> {
    const match: Record<string, any> = {
      restaurantId: objectId(scope.restaurantId),
      isVoided: { $ne: true },
      ...dateClause(scope),
    };
    if (scope.branchId) match.branchId = objectId(scope.branchId);
    return match;
  }

  /** Net revenue expression — refunded portion subtracted. */
  private netRevenueExpr(): Record<string, any> {
    return {
      $subtract: [
        '$grandTotal',
        { $cond: [{ $eq: ['$isRefunded', true] }, { $ifNull: ['$refundAmount', 0] }, 0] },
      ],
    };
  }

  /**
   * GET /api/reports/sales/summary
   * Period KPIs with previous-period comparison and growth.
   */
  async summary(scope: ReportScope) {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const rangeMs = Math.max(new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime(), 0);
    const prevEnd = shiftDays(start, -1);
    const prevStart = shiftDays(prevEnd, -Math.round(rangeMs / 86400000));

    const [current, previous, status] = await Promise.all([
      this.kpiAggregation({ ...scope, startDate: start, endDate: end }),
      this.kpiAggregation({ ...scope, startDate: prevStart, endDate: prevEnd }),
      this.statusBreakdown(scope),
    ]);

    const prev = previous[0] || { revenue: 0, netRevenue: 0, orders: 0, items: 0, discount: 0, gst: 0, cashSales: 0, pointsEarned: 0, pointsRedeemed: 0 };
    const cur = current[0] || { revenue: 0, netRevenue: 0, orders: 0, items: 0, discount: 0, gst: 0, cashSales: 0, pointsEarned: 0, pointsRedeemed: 0 };

    const pct = (c: number, p: number): number => (p === 0 ? (c > 0 ? 100 : 0) : Math.round(((c - p) / p) * 1000) / 10);

    return {
      period: { start, end, previousStart: prevStart, previousEnd: prevEnd },
      summary: {
        grossSales: Math.round(cur.revenue * 100) / 100,
        netSales: Math.round(cur.netRevenue * 100) / 100,
        orders: cur.orders,
        averageOrderValue: cur.orders > 0 ? Math.round((cur.netRevenue / cur.orders) * 100) / 100 : 0,
        averageItemsPerOrder: cur.orders > 0 ? Math.round((cur.items / cur.orders) * 100) / 100 : 0,
        itemsSold: cur.items,
        discounts: Math.round(cur.discount * 100) / 100,
        taxes: Math.round(cur.gst * 100) / 100,
        cashSales: Math.round(cur.cashSales * 100) / 100,
        nonCashSales: Math.round((cur.netRevenue - cur.cashSales) * 100) / 100,
        pointsEarned: cur.pointsEarned || 0,
        pointsRedeemed: cur.pointsRedeemed || 0,
      },      comparison: {
        previousRevenue: Math.round(prev.revenue * 100) / 100,
        previousNetRevenue: Math.round(prev.netRevenue * 100) / 100,
        previousOrders: prev.orders,
        previousItems: prev.items || 0,
        previousDiscount: Math.round((prev.discount || 0) * 100) / 100,
        revenueGrowthPct: pct(cur.netRevenue, prev.netRevenue),
        orderGrowthPct: pct(cur.orders, prev.orders),
        aovGrowthPct: pct(
          cur.orders > 0 ? cur.netRevenue / cur.orders : 0,
          prev.orders > 0 ? prev.netRevenue / prev.orders : 0
        ),
      },
      status: {
        completed: status.completed,
        voided: status.voided,
        refunded: status.refunded,
        refundAmount: Math.round(status.refundAmount * 100) / 100,
        cancelled: status.cancelled,
      },
    };
  }

  /** Internal KPI aggregation returning a single-row group. */
  private async kpiAggregation(scope: ReportScope) {
    return Bill.aggregate([
      { $match: this.baseMatch(scope) },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$grandTotal' },
          netRevenue: { $sum: this.netRevenueExpr() },
          orders: { $sum: 1 },
          discount: { $sum: { $ifNull: ['$discount', 0] } },
          gst: { $sum: { $ifNull: ['$gst', 0] } },
          pointsEarned: { $sum: { $ifNull: ['$pointsEarned', 0] } },
          pointsRedeemed: { $sum: { $ifNull: ['$pointsRedeemed', 0] } },
          cashSales: {
            $sum: { $cond: [{ $eq: ['$paymentMethod', 'Cash'] }, this.netRevenueExpr(), 0] },
          },
        },
      },
    ]).then(async (rows) => {
      if (!rows.length) return [{ revenue: 0, netRevenue: 0, orders: 0, items: 0, discount: 0, gst: 0, cashSales: 0, pointsEarned: 0, pointsRedeemed: 0 }];
      // Item count via BillItem (single aggregation, not per-bill N+1).
      // First try the normal aggregation; if it returns 0 despite revenue,
      // fall back to per-bill BillItem lookup (handles billId stored as string
      // vs ObjectId mismatch that silently drops matches in $in).
      const ids = await this.billIdsInScope(scope);
      if (ids.length) {
        const itemAgg = await BillItem.aggregate([
          { $match: { billId: { $in: ids } } },
          { $group: { _id: null, items: { $sum: '$quantity' } } },
        ]).exec();
        let itemCount = itemAgg[0]?.items || 0;
        // Fallback: if aggregation returned 0 items but revenue > 0, the billId
        // type mismatch may be silently dropping matches. Try a string-based lookup.
        if (itemCount === 0 && rows[0].revenue > 0 && ids.length > 0) {
          const stringIds = ids.map((id: any) => String(id));
          const fallbackAgg = await BillItem.aggregate([
            { $match: { billId: { $in: stringIds } } },
            { $group: { _id: null, items: { $sum: '$quantity' } } },
          ]).exec();
          itemCount = fallbackAgg[0]?.items || 0;
        }
        // Last-resort fallback: read the incrementally-upserted DailySummary.
        // The DailySummary.totalItemsSold is bumped atomically by billService on
        // every bill creation, so it is the authoritative items count even when
        // the BillItem collection is unreachable or the billId type mismatch
        // silently drops all matches.
        if (itemCount === 0 && rows[0].revenue > 0) {
          const { start, end } = dateRange(scope.startDate, scope.endDate);
          const dsMatch: Record<string, any> = { date: { $gte: start, $lte: end } };
          if (scope.restaurantId) dsMatch.restaurantId = new mongoose.Types.ObjectId(scope.restaurantId);
          if (scope.branchId) dsMatch.branchId = new mongoose.Types.ObjectId(scope.branchId);
          try {
            const dsAgg = await DailySummary.aggregate([
              { $match: dsMatch },
              { $group: { _id: null, items: { $sum: '$totalItemsSold' } } },
            ]).exec();
            itemCount = dsAgg[0]?.items || 0;
          } catch { /* non-fatal — keep 0 */ }
        }
        rows[0].items = itemCount;
      } else {
        rows[0].items = 0;
      }
      return rows;
    });
  }

  /** All valid bill _ids in scope (used for item-level aggregations). */
  private async billIdsInScope(scope: ReportScope): Promise<mongoose.Types.ObjectId[]> {
    const bills = await Bill.find(this.baseMatch(scope)).select('_id').lean().exec();
    return bills.map((b: any) => b._id);
  }

  /** Completed / voided / refunded / cancelled bill counts. */
  private async statusBreakdown(scope: ReportScope): Promise<any> {
    const match: Record<string, any> = {
      restaurantId: objectId(scope.restaurantId),
      ...dateClause(scope),
    };
    if (scope.branchId) match.branchId = objectId(scope.branchId);
    const rows = await Bill.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          voided: { $sum: { $cond: [{ $eq: ['$isVoided', true] }, 1, 0] } },
          refunded: { $sum: { $cond: [{ $eq: ['$isRefunded', true] }, 1, 0] } },
          refundAmount: { $sum: { $ifNull: ['$refundAmount', 0] } },
        },
      },
    ]).exec();
    const r = rows[0] || { total: 0, voided: 0, refunded: 0, refundAmount: 0 };
    return {
      completed: r.total - r.voided,
      voided: r.voided,
      refunded: r.refunded,
      refundAmount: r.refundAmount,
      cancelled: 0, // cancellations are represented as voided bills in this model
    };
  }

  /**
   * GET /api/reports/sales/trend
   * Daily (multi-day range) or hourly (single day) sales trend.
   */
  async trend(scope: ReportScope) {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const isSingleDay = start === end;

    if (isSingleDay) return this.hourlyTrend(scope, start);

    const rows = await Bill.aggregate([
      { $match: this.baseMatch(scope) },
      {
        $group: {
          _id: '$date',
          revenue: { $sum: this.netRevenueExpr() },
          orders: { $sum: 1 },
          items: { $sum: 0 },
        },
      },
      { $sort: { _id: 1 } },
    ]).exec();

    // Item counts for each day (batched via BillItem).
    const dateItems = await this.itemsByDate(scope, start, end);

    return rows.map((r: any) => ({
      date: r._id,
      revenue: Math.round(r.revenue * 100) / 100,
      orders: r.orders,
      items: dateItems.get(r._id) || 0,
    }));
  }

  private async itemsByDate(scope: ReportScope, start: string, end: string): Promise<Map<string, number>> {
    const match: Record<string, any> = {
      restaurantId: objectId(scope.restaurantId),
      date: { $gte: start, $lte: end },
      isVoided: { $ne: true },
    };
    if (scope.branchId) match.branchId = objectId(scope.branchId);
    const bills = await Bill.find(match).select('_id date').lean().exec();
    const billDate = new Map<string, string>();
    bills.forEach((b: any) => billDate.set(b._id.toString(), b.date));
    const ids = bills.map((b: any) => b._id);
    const map = new Map<string, number>();
    if (!ids.length) return map;
    const itemRows = await BillItem.aggregate([
      { $match: { billId: { $in: ids } } },
      { $group: { _id: '$billId', items: { $sum: '$quantity' } } },
    ]).exec();
    itemRows.forEach((r: any) => {
      const date = billDate.get(r._id.toString());
      if (date) map.set(date, (map.get(date) || 0) + r.items);
    });
    return map;
  }

  /** Hourly trend for a single day (10 AM → 10 PM slots mirror the POS view). */
  private async hourlyTrend(scope: ReportScope, date: string) {
    const match = { ...this.baseMatch(scope), date };
    const rows = await Bill.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $hour: { $dateFromString: { dateString: { $concat: ['$date', 'T', '$time', ':00'] } } } },
          revenue: { $sum: this.netRevenueExpr() },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).exec();

    const byHour = new Map<number, { revenue: number; orders: number }>();
    rows.forEach((r: any) => byHour.set(r._id, { revenue: r.revenue, orders: r.orders }));

    const slots = ['10 AM', '12 PM', '02 PM', '04 PM', '06 PM', '08 PM', '10 PM'];
    const bounds: Array<[number, number]> = [[0, 11], [12, 13], [14, 15], [16, 17], [18, 19], [20, 21], [22, 23]];
    return slots.map((name, i) => {
      let revenue = 0, orders = 0;
      for (let h = bounds[i][0]; h <= bounds[i][1]; h++) {
        const v = byHour.get(h);
        if (v) { revenue += v.revenue; orders += v.orders; }
      }
      return { name, revenue: Math.round(revenue * 100) / 100, orders };
    });
  }

  /**
   * GET /api/reports/sales/hourly — raw per-hour distribution (peak hours).
   */
  async hourly(scope: ReportScope) {
    // The bill 'time' field is in local HH:MM format. We need to extract the
    // local hour, not the UTC hour. Since $hour returns UTC, we parse the time
    // string directly to get the local hour — more reliable than timezone math.
    const rows = await Bill.aggregate([
      { $match: this.baseMatch(scope) },
      {
        $addFields: {
          _localHour: {
            $let: {
              vars: {
                // Extract hour from time string like "14:30" → 14
                h: {
                  $toInt: {
                    $arrayElemAt: [{ $split: ['$time', ':'] }, 0],
                  },
                },
              },
              in: {
                $cond: [{ $gte: ['$$h', 0] }, '$$h', 0],
              },
            },
          },
        },
      },
      {
        $group: {
          _id: '$_localHour',
          orders: { $sum: 1 },
          revenue: { $sum: this.netRevenueExpr() },
        },
      },
      { $sort: { _id: 1 } },
    ]).exec();

    const result: Array<{ hour: string; orders: number; revenue: number }> = [];
    for (let h = 6; h <= 23; h++) {
      const r = rows.find((x: any) => x._id === h);
      result.push({
        hour: `${String(h).padStart(2, '0')}:00`,
        orders: r?.orders || 0,
        revenue: Math.round((r?.revenue || 0) * 100) / 100,
      });
    }
    return result;
  }

  /** GET /api/reports/sales/payments — payment method distribution. */
  async payments(scope: ReportScope) {
    const rows = await Bill.aggregate([
      { $match: this.baseMatch(scope) },
      {
        $group: {
          _id: '$paymentMethod',
          amount: { $sum: this.netRevenueExpr() },
          count: { $sum: 1 },
        },
      },
      { $sort: { amount: -1 } },
    ]).exec();
    return rows.map((r: any) => ({ method: r._id, amount: Math.round(r.amount * 100) / 100, count: r.count }));
  }

  /** GET /api/reports/sales/order-types — order type distribution. */
  async orderTypes(scope: ReportScope) {
    const rows = await Bill.aggregate([
      { $match: this.baseMatch(scope) },
      { $group: { _id: '$orderType', count: { $sum: 1 }, revenue: { $sum: this.netRevenueExpr() } } },
      { $sort: { count: -1 } },
    ]).exec();
    return rows.map((r: any) => ({ type: r._id, count: r.count, revenue: Math.round(r.revenue * 100) / 100 }));
  }

  /** GET /api/reports/sales/cashiers — cashier performance ranking. */
  async cashiers(scope: ReportScope) {
    const match = this.baseMatch(scope);
    const billRows = await Bill.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$cashierName',
          orders: { $sum: 1 },
          revenue: { $sum: this.netRevenueExpr() },
          discount: { $sum: { $ifNull: ['$discount', 0] } },
          voided: { $sum: { $cond: [{ $eq: ['$isVoided', true] }, 1, 0] } },
          refunded: { $sum: { $cond: [{ $eq: ['$isRefunded', true] }, 1, 0] } },
        },
      },
      { $sort: { revenue: -1 } },
    ]).exec();

    // Items per cashier via BillItem.
    const ids = (await Bill.find(match).select('_id cashierName').lean().exec()) as Array<{ _id: any; cashierName: string }>;
    const cashierMap = new Map<string, { items: number; cashierName: string }>();
    ids.forEach((b) => {
      if (!cashierMap.has(b.cashierName)) cashierMap.set(b.cashierName, { items: 0, cashierName: b.cashierName });
    });
    const billCashier = new Map<string, string>();
    ids.forEach((b) => billCashier.set(b._id.toString(), b.cashierName));
    const itemRows = await BillItem.aggregate([
      { $match: { billId: { $in: ids.map((b) => b._id) } } },
      { $group: { _id: '$billId', items: { $sum: '$quantity' } } },
    ]).exec();
    itemRows.forEach((r: any) => {
      const name = billCashier.get(r._id.toString());
      const entry = name ? cashierMap.get(name) : undefined;
      if (entry) entry.items += r.items;
    });

    return billRows.map((r: any) => {
      const items = cashierMap.get(r._id)?.items || 0;
      return {
        cashier: r._id,
        orders: r.orders,
        revenue: Math.round(r.revenue * 100) / 100,
        averageBill: r.orders > 0 ? Math.round((r.revenue / r.orders) * 100) / 100 : 0,
        itemsSold: items,
        discount: Math.round(r.discount * 100) / 100,
        voidedBills: r.voided,
        refundedBills: r.refunded,
      };
    });
  }

  /** GET /api/reports/sales/periods — explicit previous-period comparison. */
  async periods(scope: ReportScope) {
    return this.summary(scope);
  }

  /** GET /api/reports/sales/top-days — highest revenue days in range. */
  async topDays(scope: ReportScope, limit = 10) {
    const rows = await Bill.aggregate([
      { $match: this.baseMatch(scope) },
      { $group: { _id: '$date', revenue: { $sum: this.netRevenueExpr() }, orders: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ]).exec();
    return rows.map((r: any) => ({ date: r._id, revenue: Math.round(r.revenue * 100) / 100, orders: r.orders }));
  }

  /** GET /api/reports/sales/top-hours — highest revenue hours in range. */
  async topHours(scope: ReportScope, limit = 10) {
    const rows = await Bill.aggregate([
      { $match: this.baseMatch(scope) },
      {
        $group: {
          _id: { $hour: { $dateFromString: { dateString: { $concat: ['$date', 'T', '$time', ':00'] } } } },
          revenue: { $sum: this.netRevenueExpr() },
          orders: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ]).exec();
    return rows.map((r: any) => ({
      hour: `${String(r._id).padStart(2, '0')}:00`,
      revenue: Math.round(r.revenue * 100) / 100,
      orders: r.orders,
    }));
  }
}

export const salesReportService = new SalesReportService();

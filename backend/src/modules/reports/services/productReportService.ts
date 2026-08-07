/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ProductReportService — Product-level sales reporting (Phase 1.8).
 *
 * Aggregates BillItem line items (historical snapshots, never current menu
 * values) joined against the valid-bill set. Excludes voided bills; refunded
 * bills are excluded from revenue for net accuracy. Tenant + branch scoped.
 */

import mongoose from 'mongoose';
import Bill from '../../../models/Bill';
import BillItem from '../../../models/BillItem';
import Product from '../../../models/Product';
import { dateRange, ReportScope } from './salesReportService';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export class ProductReportService {
  private validBillMatch(scope: ReportScope): Record<string, any> {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const match: Record<string, any> = {
      restaurantId: objectId(scope.restaurantId),
      date: { $gte: start, $lte: end },
      isVoided: { $ne: true },
      isRefunded: { $ne: true },
    };
    if (scope.branchId) match.branchId = objectId(scope.branchId);
    return match;
  }

  /** Product-level aggregation over BillItem for the valid bill set. */
  private async productAggregation(scope: ReportScope, sortKey: 'qty' | 'revenue', limit: number) {
    const bills = await Bill.find(this.validBillMatch(scope)).select('_id').lean().exec();
    const billIds = bills.map((b: any) => b._id);
    if (!billIds.length) return [];
    const pipeline: any[] = [
      { $match: { billId: { $in: billIds } } },
      {
        $group: {
          _id: { name: '$itemName', menuItemId: { $ifNull: ['$menuItemId', null] } },
          qty: { $sum: '$quantity' },
          revenue: { $sum: { $multiply: ['$priceAtSale', '$quantity'] } },
          discount: { $sum: { $multiply: ['$discountAtSale', '$quantity'] } },
          orders: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          name: '$_id.name',
          menuItemId: '$_id.menuItemId',
          qty: 1,
          revenue: 1,
          discount: 1,
          orders: 1,
          averagePrice: { $cond: [{ $gt: ['$qty', 0] }, { $divide: ['$revenue', '$qty'] }, 0] },
        },
      },
      { $sort: { [sortKey]: -1 } },
      { $limit: limit },
    ];
    const rows = await BillItem.aggregate(pipeline).exec();
    return rows.map((r: any) => ({
      ...r,
      revenue: Math.round(r.revenue * 100) / 100,
      discount: Math.round(r.discount * 100) / 100,
      averagePrice: Math.round(r.averagePrice * 100) / 100,
    }));
  }

  /** GET /api/reports/products/top — top selling products by qty. */
  async top(scope: ReportScope, limit = 10) {
    return this.productAggregation(scope, 'qty', limit);
  }

  /** GET /api/reports/products/least — least selling products by qty. */
  async least(scope: ReportScope, limit = 10) {
    const rows = await this.productAggregation(scope, 'qty', 1000);
    return rows.slice(-limit).reverse();
  }

  /** GET /api/reports/products/revenue — revenue by product. */
  async revenue(scope: ReportScope, limit = 10) {
    return this.productAggregation(scope, 'revenue', limit);
  }

  /** GET /api/reports/products/categories — category ranking. */
  async categories(scope: ReportScope) {
    const bills = await Bill.find(this.validBillMatch(scope)).select('_id').lean().exec();
    const billIds = bills.map((b: any) => b._id);
    if (!billIds.length) return [];
    const rows = await BillItem.aggregate([
      { $match: { billId: { $in: billIds } } },
      {
        $group: {
          _id: '$itemName',
          qty: { $sum: '$quantity' },
          revenue: { $sum: { $multiply: ['$priceAtSale', '$quantity'] } },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 500 },
    ]).exec();

    // Map item names to their current product category (single lookup).
    const names = rows.map((r: any) => r._id);
    const products = await Product.find({ name: { $in: names }, isDeleted: { $ne: true } })
      .select('name category')
      .lean()
      .exec();
    const catMap = new Map<string, string>();
    products.forEach((p: any) => catMap.set(p.name, p.category || 'Uncategorized'));

    const catAgg = new Map<string, { qty: number; revenue: number }>();
    rows.forEach((r: any) => {
      const cat = catMap.get(r._id) || 'Uncategorized';
      const e = catAgg.get(cat) || { qty: 0, revenue: 0 };
      e.qty += r.qty;
      e.revenue += r.revenue;
      catAgg.set(cat, e);
    });
    return Array.from(catAgg.entries())
      .map(([category, v]) => ({ category, qty: v.qty, revenue: Math.round(v.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  /** GET /api/reports/products/menu-engineering — popularity × profitability. */
  async menuEngineering(scope: ReportScope) {
    const bills = await Bill.find(this.validBillMatch(scope)).select('_id').lean().exec();
    const billIds = bills.map((b: any) => b._id);
    if (!billIds.length) return [];
    const rows = await BillItem.aggregate([
      { $match: { billId: { $in: billIds } } },
      {
        $group: {
          _id: '$itemName',
          qty: { $sum: '$quantity' },
          revenue: { $sum: { $multiply: ['$priceAtSale', '$quantity'] } },
        },
      },
    ]).exec();

    const totalQty = rows.reduce((s, r) => s + r.qty, 0) || 1;
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0) || 1;
    const qtyThreshold = totalQty / rows.length || 0;
    const revenueThreshold = totalRevenue / rows.length || 0;

    return rows
      .map((r: any) => {
        const popularityPct = (r.qty / totalQty) * 100;
        const revenuePct = (r.revenue / totalRevenue) * 100;
        const isStar = r.qty >= qtyThreshold && r.revenue >= revenueThreshold;
        const isPuzzle = r.qty >= qtyThreshold && r.revenue < revenueThreshold;
        const isPlowHorse = r.qty < qtyThreshold && r.revenue >= revenueThreshold;
        const isDog = r.qty < qtyThreshold && r.revenue < revenueThreshold;
        return {
          name: r._id,
          qty: r.qty,
          revenue: Math.round(r.revenue * 100) / 100,
          popularityPct: Math.round(popularityPct * 10) / 10,
          revenuePct: Math.round(revenuePct * 10) / 10,
          quadrant: isStar ? 'Star' : isPuzzle ? 'Puzzle' : isPlowHorse ? 'Plow Horse' : 'Dog',
        };
      })
      .sort((a: any, b: any) => b.revenue - a.revenue);
  }

  /** GET /api/reports/products/abc — ABC analysis (A/B/C by revenue share). */
  async abc(scope: ReportScope) {
    const bills = await Bill.find(this.validBillMatch(scope)).select('_id').lean().exec();
    const billIds = bills.map((b: any) => b._id);
    if (!billIds.length) return [];
    const rows = await BillItem.aggregate([
      { $match: { billId: { $in: billIds } } },
      {
        $group: {
          _id: '$itemName',
          qty: { $sum: '$quantity' },
          revenue: { $sum: { $multiply: ['$priceAtSale', '$quantity'] } },
        },
      },
      { $sort: { revenue: -1 } },
    ]).exec();

    const total = rows.reduce((s, r) => s + r.revenue, 0) || 1;
    let cumulative = 0;
    return rows.map((r: any) => {
      cumulative += r.revenue;
      const share = (r.revenue / total) * 100;
      const cumShare = (cumulative / total) * 100;
      const cls = cumShare <= 80 ? 'A' : cumShare <= 95 ? 'B' : 'C';
      return {
        name: r._id,
        qty: r.qty,
        revenue: Math.round(r.revenue * 100) / 100,
        sharePct: Math.round(share * 10) / 10,
        cumulativePct: Math.round(cumShare * 10) / 10,
        class: cls,
      };
    });
  }

  /** GET /api/reports/products/inactive — menu items with no sales in range. */
  async inactive(scope: ReportScope) {
    const bills = await Bill.find(this.validBillMatch(scope)).select('_id').lean().exec();
    const billIds = bills.map((b: any) => b._id);
    const sold = new Set<string>();
    if (billIds.length) {
      const rows = await BillItem.aggregate([
        { $match: { billId: { $in: billIds } } },
        { $group: { _id: '$menuItemId' } },
      ]).exec();
      rows.forEach((r: any) => r._id && sold.add(String(r._id)));
    }
    const products = await Product.find({
      restaurantId: { $in: [objectId(scope.restaurantId), null] },
      isDeleted: { $ne: true },
      availability: true,
    })
      .select('name category currentStock')
      .lean()
      .exec();
    return products
      .filter((p: any) => !sold.has(String(p._id)))
      .map((p: any) => ({ name: p.name, category: p.category, currentStock: p.currentStock }));
  }

  /** GET /api/reports/products/deleted — deleted menu items in range. */
  async deleted(scope: ReportScope) {
    const products = await Product.find({
      restaurantId: { $in: [objectId(scope.restaurantId), null] },
      isDeleted: true,
    })
      .select('name category deletedAt')
      .lean()
      .exec();
    return products.map((p: any) => ({
      name: p.name,
      category: p.category,
      deletedAt: p.deletedAt,
    }));
  }
}

export const productReportService = new ProductReportService();

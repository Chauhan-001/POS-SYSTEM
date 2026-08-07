/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InventoryReportService — Inventory reporting (Phase 1.8).
 *
 * Stock levels, valuation (weighted average cost), movement, aging, fast/slow/
 * dead movers, expiry, reorder suggestions and supplier purchase summaries.
 * Tenant-scoped; optionally branch-scoped. All computations server-side.
 */

import mongoose from 'mongoose';
import Product from '../../../models/Product';
import Purchase from '../../../models/Purchase';
import InventoryEvent from '../../../models/InventoryEvent';
import Bill from '../../../models/Bill';
import BillItem from '../../../models/BillItem';
import { dateRange, ReportScope } from './salesReportService';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export class InventoryReportService {
  private productMatch(scope: ReportScope): Record<string, any> {
    return {
      restaurantId: { $in: [objectId(scope.restaurantId), null] },
      isDeleted: { $ne: true },
    };
  }

  /** GET /api/reports/inventory/stock — live stock levels with value. */
  async stock(scope: ReportScope) {
    const products = await Product.find(this.productMatch(scope))
      .select('name category currentStock minStock maxStock reorderLevel averageCost unit availability')
      .lean()
      .exec();
    return products
      .map((p: any) => ({
        name: p.name,
        category: p.category,
        currentStock: p.currentStock,
        unit: p.unit,
        minStock: p.minStock,
        reorderLevel: p.reorderLevel,
        averageCost: p.averageCost,
        stockValue: Math.round((p.currentStock * (p.averageCost || 0)) * 100) / 100,
        availability: p.availability,
        status: p.currentStock <= 0 ? 'Out of Stock' : p.currentStock <= (p.reorderLevel || 0) ? 'Low Stock' : 'In Stock',
      }))
      .sort((a: any, b: any) => a.currentStock - b.currentStock);
  }

  /** GET /api/reports/inventory/low-stock — items at or below reorder level. */
  async lowStock(scope: ReportScope) {
    const rows = await this.stock(scope);
    return rows.filter((r: any) => r.status !== 'In Stock');
  }

  /** GET /api/reports/inventory/valuation — total stock value by category. */
  async valuation(scope: ReportScope) {
    const products = await Product.find(this.productMatch(scope))
      .select('name category currentStock averageCost')
      .lean()
      .exec();
    const byCat = new Map<string, { value: number; units: number }>();
    products.forEach((p: any) => {
      const cat = p.category || 'Uncategorized';
      const e = byCat.get(cat) || { value: 0, units: 0 };
      e.value += (p.currentStock || 0) * (p.averageCost || 0);
      e.units += p.currentStock || 0;
      byCat.set(cat, e);
    });
    const total = products.reduce((s, p) => s + (p.currentStock || 0) * (p.averageCost || 0), 0);
    return {
      totalValue: Math.round(total * 100) / 100,
      itemCount: products.length,
      categories: Array.from(byCat.entries()).map(([category, v]) => ({
        category,
        value: Math.round(v.value * 100) / 100,
        units: v.units,
      })),
    };
  }

  /** GET /api/reports/inventory/movement — purchase + consumption per item. */
  async movement(scope: ReportScope) {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const purchases = await Purchase.aggregate([
      {
        $match: {
          restaurantId: objectId(scope.restaurantId),
          date: { $gte: start, $lte: end },
          status: { $ne: 'cancelled' },
        },
      },
      { $group: { _id: '$item', qty: { $sum: '$quantity' }, cost: { $sum: '$total' } } },
    ]).exec();

    // Consumption from sales (products linked to sold bill items by name).
    const bills = await Bill.find({
      restaurantId: objectId(scope.restaurantId),
      date: { $gte: start, $lte: end },
      isVoided: { $ne: true },
      isRefunded: { $ne: true },
    }).select('_id').lean().exec();
    const billIds = bills.map((b: any) => b._id);
    const consumed: Array<{ _id: string; qty: number }> = billIds.length
      ? await BillItem.aggregate([
          { $match: { billId: { $in: billIds } } },
          { $group: { _id: '$itemName', qty: { $sum: '$quantity' } } },
        ]).exec()
      : [];

    const consumptionMap = new Map(consumed.map((c: any) => [c._id, c.qty]));
    return purchases.map((p: any) => ({
      item: p._id,
      purchasedQty: p.qty,
      purchaseCost: Math.round(p.cost * 100) / 100,
      consumedQty: consumptionMap.get(p._id) || 0,
      netMovement: p.qty - (consumptionMap.get(p._id) || 0),
    }));
  }

  /** GET /api/reports/inventory/aging — days since last purchase. */
  async aging(scope: ReportScope) {
    const products = await Product.find(this.productMatch(scope))
      .select('name category currentStock averageCost expiryDate batchNumber updatedAt')
      .lean()
      .exec();
    const now = Date.now();
    return products
      .map((p: any) => {
        const lastUpdated = new Date(p.updatedAt).getTime();
        return {
          name: p.name,
          category: p.category,
          currentStock: p.currentStock,
          averageCost: p.averageCost,
          stockValue: Math.round((p.currentStock * (p.averageCost || 0)) * 100) / 100,
          daysSinceUpdate: Math.floor((now - lastUpdated) / 86400000),
          expiryDate: p.expiryDate || null,
          batchNumber: p.batchNumber || null,
        };
      })
      .sort((a: any, b: any) => b.daysSinceUpdate - a.daysSinceUpdate);
  }

  /** GET /api/reports/inventory/reorder — suggested reorder quantities. */
  async reorder(scope: ReportScope) {
    const products = await Product.find(this.productMatch(scope))
      .select('name category currentStock maxStock reorderLevel unit supplier')
      .lean()
      .exec();
    return products
      .filter((p: any) => p.currentStock <= (p.reorderLevel || 0))
      .map((p: any) => ({
        name: p.name,
        category: p.category,
        currentStock: p.currentStock,
        reorderLevel: p.reorderLevel,
        maxStock: p.maxStock,
        suggestedQty: Math.max(0, (p.maxStock || 0) - p.currentStock),
        unit: p.unit,
        supplier: p.supplier || null,
      }));
  }

  /** GET /api/reports/inventory/fast-slow — fast / slow / dead movers. */
  async fastSlow(scope: ReportScope) {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const bills = await Bill.find({
      restaurantId: objectId(scope.restaurantId),
      date: { $gte: start, $lte: end },
      isVoided: { $ne: true },
    }).select('_id').lean().exec();
    const billIds = bills.map((b: any) => b._id);
    if (!billIds.length) return { fast: [], slow: [], dead: [] };
    const rows = await BillItem.aggregate([
      { $match: { billId: { $in: billIds } } },
      { $group: { _id: '$itemName', qty: { $sum: '$quantity' } } },
      { $sort: { qty: -1 } },
    ]).exec();

    const products = await Product.find(this.productMatch(scope)).select('name currentStock').lean().exec();
    const productNames = new Set(products.map((p: any) => p.name));

    const sorted = rows.map((r: any) => ({ name: r._id, qty: r.qty }));
    const threshold = sorted.length > 0 ? Math.max(1, Math.ceil(sorted.length * 0.2)) : 0;
    const fast = sorted.slice(0, threshold);
    const slow = sorted.slice(-Math.min(threshold, sorted.length));
    const dead = products.filter((p: any) => !sorted.some((r: any) => r._id === p.name));
    return {
      fast: fast.map((f: any) => ({ name: f.name, qty: f.qty })),
      slow: slow.map((s: any) => ({ name: s.name, qty: s.qty })),
      dead: dead.map((d: any) => ({ name: d.name, currentStock: d.currentStock })),
    };
  }

  /** GET /api/reports/inventory/waste — waste/shrinkage events in range. */
  async waste(scope: ReportScope) {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const rows = await InventoryEvent.aggregate([
      {
        $match: {
          restaurantId: objectId(scope.restaurantId),
          type: 'waste',
          eventDate: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: '$item', quantity: { $sum: '$quantity' }, events: { $sum: 1 } } },
      { $sort: { quantity: -1 } },
    ]).exec();
    return rows.map((r: any) => ({ item: r._id, quantity: r.quantity, events: r.events }));
  }

  /** GET /api/reports/inventory/expiry — items expiring soon or expired. */
  async expiry(scope: ReportScope, days = 30) {
    const products = await Product.find(this.productMatch(scope))
      .select('name category currentStock expiryDate batchNumber')
      .lean()
      .exec();
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();
    const horizon = days * 86400000;
    return products
      .filter((p: any) => p.expiryDate)
      .map((p: any) => {
        const t = new Date(`${p.expiryDate}T00:00:00Z`).getTime();
        return {
          name: p.name,
          category: p.category,
          currentStock: p.currentStock,
          expiryDate: p.expiryDate,
          batchNumber: p.batchNumber || null,
          daysLeft: Math.floor((t - today) / 86400000),
          status: t < today ? 'Expired' : t - today <= horizon ? 'Expiring Soon' : 'OK',
        };
      })
      .filter((r: any) => r.status !== 'OK')
      .sort((a: any, b: any) => a.daysLeft - b.daysLeft);
  }

  /** GET /api/reports/inventory/suppliers — purchase summary per supplier. */
  async suppliers(scope: ReportScope) {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const rows = await Purchase.aggregate([
      {
        $match: {
          restaurantId: objectId(scope.restaurantId),
          date: { $gte: start, $lte: end },
          status: { $ne: 'cancelled' },
        },
      },
      {
        $group: {
          _id: '$supplier',
          total: { $sum: '$total' },
          quantity: { $sum: '$quantity' },
          purchases: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]).exec();
    return rows.map((r: any) => ({
      supplier: r._id,
      total: Math.round(r.total * 100) / 100,
      quantity: r.quantity,
      purchases: r.purchases,
    }));
  }
}

export const inventoryReportService = new InventoryReportService();

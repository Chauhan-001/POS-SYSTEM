/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SalesBaselineService — Computes historical baselines for revenue, orders, AOV
 * at multiple granularities with proper time-aware comparisons.
 *
 * Key principle: Tuesday 4 PM compares against historical Tuesday 4 PM periods,
 * not against Monday 4 PM or daily averages.
 */

import mongoose from 'mongoose';
import BillModel from '../models/Bill';
import BillItemModel from '../models/BillItem';
import ProductModel from '../models/Product';

export interface TimeGranularity {
  daily: boolean;
  weekly: boolean;
  monthly: boolean;
  hourly: boolean;
  weekday: boolean;
}

export interface SalesBaseline {
  restaurantId: string;
  branchId?: string;
  period: 'daily' | 'weekly' | 'monthly' | 'hourly' | 'weekday';
  metric: 'revenue' | 'orders' | 'aov';
  value: number;
  sampleSize: number;
  confidence: number;
  computedAt: Date;
  validFrom: Date;
  validTo: Date;
}

export interface CategoryBaseline {
  restaurantId: string;
  branchId?: string;
  category: string;
  period: 'daily' | 'weekly' | 'monthly';
  metric: 'revenue' | 'units';
  value: number;
  sampleSize: number;
  confidence: number;
  computedAt: Date;
  validFrom: Date;
  validTo: Date;
}

export interface ProductBaseline {
  restaurantId: string;
  branchId?: string;
  productId: string;
  productName: string;
  category: string;
  period: 'daily' | 'weekly' | 'monthly';
  metric: 'revenue' | 'units';
  value: number;
  sampleSize: number;
  confidence: number;
  computedAt: Date;
  validFrom: Date;
  validTo: Date;
}

export interface TimeSlotBaseline {
  restaurantId: string;
  branchId?: string;
  hour: number; // 0-23
  dayOfWeek: number; // 0-6 (Sun-Sat)
  metric: 'revenue' | 'orders' | 'aov';
  value: number;
  sampleSize: number;
  confidence: number;
  computedAt: Date;
  validFrom: Date;
  validTo: Date;
}

interface BaselineOptions {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number;
  minSampleSize?: number;
}

const DEFAULT_LOOKBACK_DAYS = 90;
const MIN_SAMPLE_SIZE = 3;

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function getDateRange(days: number): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function computeConfidence(sampleSize: number, minSampleSize: number): number {
  if (sampleSize >= minSampleSize * 10) return 0.95;
  if (sampleSize >= minSampleSize * 5) return 0.8;
  if (sampleSize >= minSampleSize * 2) return 0.6;
  if (sampleSize >= minSampleSize) return 0.4;
  return 0.2;
}

/**
 * Build bill filter with tenant and optional branch scope
 */
function buildBillFilter(restaurantId: string, branchId?: string, start?: Date, end?: Date) {
  const filter: any = {
    restaurantId: objectId(restaurantId),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
  };
  if (branchId) filter.branchId = objectId(branchId);
  if (start || end) {
    filter.createdAt = {};
    if (start) filter.createdAt.$gte = start;
    if (end) filter.createdAt.$lte = end;
  }
  return filter;
}

/**
 * Compute daily revenue baseline (median of last N days)
 */
export async function computeDailyRevenueBaseline(opts: BaselineOptions): Promise<SalesBaseline> {
  const { restaurantId, branchId, lookbackDays = DEFAULT_LOOKBACK_DAYS, minSampleSize = MIN_SAMPLE_SIZE } = opts;
  const { start, end } = getDateRange(lookbackDays);

  const bills = await BillModel.find(buildBillFilter(restaurantId, branchId, start, end))
    .select('grandTotal createdAt')
    .lean()
    .exec();

  if (bills.length === 0) {
    return createEmptyBaseline(restaurantId, branchId, 'daily', 'revenue', lookbackDays);
  }

  // Group by day
  const dailyRevenue = new Map<string, number>();
  for (const bill of bills) {
    const dayKey = bill.createdAt.toISOString().split('T')[0];
    dailyRevenue.set(dayKey, (dailyRevenue.get(dayKey) || 0) + (bill.grandTotal || 0));
  }

  const values = Array.from(dailyRevenue.values()).sort((a, b) => a - b);
  const median = values.length % 2 === 0
    ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
    : values[Math.floor(values.length / 2)];

  return {
    restaurantId,
    branchId,
    period: 'daily',
    metric: 'revenue',
    value: Math.round(median),
    sampleSize: values.length,
    confidence: computeConfidence(values.length, minSampleSize),
    computedAt: new Date(),
    validFrom: start,
    validTo: end,
  };
}

/**
 * Compute weekly revenue baseline
 */
export async function computeWeeklyRevenueBaseline(opts: BaselineOptions): Promise<SalesBaseline> {
  const { restaurantId, branchId, lookbackDays = DEFAULT_LOOKBACK_DAYS, minSampleSize = MIN_SAMPLE_SIZE } = opts;
  const { start, end } = getDateRange(lookbackDays);

  const bills = await BillModel.find(buildBillFilter(restaurantId, branchId, start, end))
    .select('grandTotal createdAt')
    .lean()
    .exec();

  if (bills.length === 0) {
    return createEmptyBaseline(restaurantId, branchId, 'weekly', 'revenue', lookbackDays);
  }

  // Group by week (ISO week)
  const weeklyRevenue = new Map<string, number>();
  for (const bill of bills) {
    const date = new Date(bill.createdAt);
    const year = date.getFullYear();
    const week = getISOWeek(date);
    const weekKey = `${year}-W${week.toString().padStart(2, '0')}`;
    weeklyRevenue.set(weekKey, (weeklyRevenue.get(weekKey) || 0) + (bill.grandTotal || 0));
  }

  const values = Array.from(weeklyRevenue.values()).sort((a, b) => a - b);
  const median = values.length % 2 === 0
    ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
    : values[Math.floor(values.length / 2)];

  return {
    restaurantId,
    branchId,
    period: 'weekly',
    metric: 'revenue',
    value: Math.round(median),
    sampleSize: values.length,
    confidence: computeConfidence(values.length, minSampleSize),
    computedAt: new Date(),
    validFrom: start,
    validTo: end,
  };
}

/**
 * Compute monthly revenue baseline
 */
export async function computeMonthlyRevenueBaseline(opts: BaselineOptions): Promise<SalesBaseline> {
  const { restaurantId, branchId, lookbackDays = DEFAULT_LOOKBACK_DAYS, minSampleSize = MIN_SAMPLE_SIZE } = opts;
  const { start, end } = getDateRange(lookbackDays);

  const bills = await BillModel.find(buildBillFilter(restaurantId, branchId, start, end))
    .select('grandTotal createdAt')
    .lean()
    .exec();

  if (bills.length === 0) {
    return createEmptyBaseline(restaurantId, branchId, 'monthly', 'revenue', lookbackDays);
  }

  // Group by month
  const monthlyRevenue = new Map<string, number>();
  for (const bill of bills) {
    const monthKey = bill.createdAt.toISOString().substring(0, 7); // YYYY-MM
    monthlyRevenue.set(monthKey, (monthlyRevenue.get(monthKey) || 0) + (bill.grandTotal || 0));
  }

  const values = Array.from(monthlyRevenue.values()).sort((a, b) => a - b);
  const median = values.length % 2 === 0
    ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
    : values[Math.floor(values.length / 2)];

  return {
    restaurantId,
    branchId,
    period: 'monthly',
    metric: 'revenue',
    value: Math.round(median),
    sampleSize: values.length,
    confidence: computeConfidence(values.length, minSampleSize),
    computedAt: new Date(),
    validFrom: start,
    validTo: end,
  };
}

/**
 * Compute daily orders baseline
 */
export async function computeDailyOrdersBaseline(opts: BaselineOptions): Promise<SalesBaseline> {
  const { restaurantId, branchId, lookbackDays = DEFAULT_LOOKBACK_DAYS, minSampleSize = MIN_SAMPLE_SIZE } = opts;
  const { start, end } = getDateRange(lookbackDays);

  const bills = await BillModel.find(buildBillFilter(restaurantId, branchId, start, end))
    .select('_id createdAt')
    .lean()
    .exec();

  if (bills.length === 0) {
    return createEmptyBaseline(restaurantId, branchId, 'daily', 'orders', lookbackDays);
  }

  const dailyOrders = new Map<string, number>();
  for (const bill of bills) {
    const dayKey = bill.createdAt.toISOString().split('T')[0];
    dailyOrders.set(dayKey, (dailyOrders.get(dayKey) || 0) + 1);
  }

  const values = Array.from(dailyOrders.values()).sort((a, b) => a - b);
  const median = values.length % 2 === 0
    ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
    : values[Math.floor(values.length / 2)];

  return {
    restaurantId,
    branchId,
    period: 'daily',
    metric: 'orders',
    value: Math.round(median),
    sampleSize: values.length,
    confidence: computeConfidence(values.length, minSampleSize),
    computedAt: new Date(),
    validFrom: start,
    validTo: end,
  };
}

/**
 * Compute AOV baseline
 */
export async function computeAOVBaseline(opts: BaselineOptions): Promise<SalesBaseline> {
  const { restaurantId, branchId, lookbackDays = DEFAULT_LOOKBACK_DAYS, minSampleSize = MIN_SAMPLE_SIZE } = opts;
  const { start, end } = getDateRange(lookbackDays);

  const bills = await BillModel.find(buildBillFilter(restaurantId, branchId, start, end))
    .select('grandTotal')
    .lean()
    .exec();

  if (bills.length === 0) {
    return createEmptyBaseline(restaurantId, branchId, 'daily', 'aov', lookbackDays);
  }

  const totalRevenue = bills.reduce((sum, b) => sum + (b.grandTotal || 0), 0);
  const aov = totalRevenue / bills.length;

  return {
    restaurantId,
    branchId,
    period: 'daily',
    metric: 'aov',
    value: Math.round(aov),
    sampleSize: bills.length,
    confidence: computeConfidence(bills.length, minSampleSize),
    computedAt: new Date(),
    validFrom: start,
    validTo: end,
  };
}

/**
 * Compute weekday revenue baseline (compares same day of week)
 */
export async function computeWeekdayRevenueBaseline(opts: BaselineOptions): Promise<TimeSlotBaseline[]> {
  const { restaurantId, branchId, lookbackDays = DEFAULT_LOOKBACK_DAYS, minSampleSize = MIN_SAMPLE_SIZE } = opts;
  const { start, end } = getDateRange(lookbackDays);

  const bills = await BillModel.find(buildBillFilter(restaurantId, branchId, start, end))
    .select('grandTotal createdAt')
    .lean()
    .exec();

  if (bills.length === 0) {
    return Array.from({ length: 7 }, (_, dayOfWeek) => createEmptyTimeSlotBaseline(restaurantId, branchId, dayOfWeek, 0, 'revenue', lookbackDays));
  }

  // Group by day of week
  const weekdayRevenue = new Map<number, number[]>();
  for (const bill of bills) {
    const dayOfWeek = new Date(bill.createdAt).getDay();
    const arr = weekdayRevenue.get(dayOfWeek) || [];
    arr.push(bill.grandTotal || 0);
    weekdayRevenue.set(dayOfWeek, arr);
  }

  const results: TimeSlotBaseline[] = [];
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    const values = weekdayRevenue.get(dayOfWeek) || [];
    values.sort((a, b) => a - b);
    const median = values.length > 0
      ? (values.length % 2 === 0
        ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
        : values[Math.floor(values.length / 2)])
      : 0;

    results.push({
      restaurantId,
      branchId,
      hour: 0,
      dayOfWeek,
      metric: 'revenue',
      value: Math.round(median),
      sampleSize: values.length,
      confidence: computeConfidence(values.length, minSampleSize),
      computedAt: new Date(),
      validFrom: start,
      validTo: end,
    });
  }

  return results;
}

/**
 * Compute hourly revenue baseline for a specific day of week
 */
export async function computeHourlyRevenueBaseline(opts: BaselineOptions & { dayOfWeek?: number }): Promise<TimeSlotBaseline[]> {
  const { restaurantId, branchId, dayOfWeek, lookbackDays = DEFAULT_LOOKBACK_DAYS, minSampleSize = MIN_SAMPLE_SIZE } = opts;
  const { start, end } = getDateRange(lookbackDays);

  const billFilter = buildBillFilter(restaurantId, branchId, start, end);
  if (dayOfWeek !== undefined) {
    // We'll filter by day of week in memory since MongoDB doesn't have easy day-of-week query
  }

  const bills = await BillModel.find(billFilter)
    .select('grandTotal createdAt')
    .lean()
    .exec();

  if (bills.length === 0) {
    return Array.from({ length: 24 }, (_, hour) => createEmptyTimeSlotBaseline(restaurantId, branchId, dayOfWeek ?? 0, hour, 'revenue', lookbackDays));
  }

  // Filter by day of week if specified
  const filteredBills = dayOfWeek !== undefined
    ? bills.filter(b => new Date(b.createdAt).getDay() === dayOfWeek)
    : bills;

  // Group by hour
  const hourlyRevenue = new Map<number, number[]>();
  for (const bill of filteredBills) {
    const hour = new Date(bill.createdAt).getHours();
    const arr = hourlyRevenue.get(hour) || [];
    arr.push(bill.grandTotal || 0);
    hourlyRevenue.set(hour, arr);
  }

  const results: TimeSlotBaseline[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const values = hourlyRevenue.get(hour) || [];
    values.sort((a, b) => a - b);
    const median = values.length > 0
      ? (values.length % 2 === 0
        ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
        : values[Math.floor(values.length / 2)])
      : 0;

    results.push({
      restaurantId,
      branchId,
      hour,
      dayOfWeek: dayOfWeek ?? 0,
      metric: 'revenue',
      value: Math.round(median),
      sampleSize: values.length,
      confidence: computeConfidence(values.length, minSampleSize),
      computedAt: new Date(),
      validFrom: start,
      validTo: end,
    });
  }

  return results;
}

/**
 * Compute category revenue baseline
 */
export async function computeCategoryBaselines(opts: BaselineOptions): Promise<CategoryBaseline[]> {
  const { restaurantId, branchId, lookbackDays = DEFAULT_LOOKBACK_DAYS, minSampleSize = MIN_SAMPLE_SIZE } = opts;
  const { start, end } = getDateRange(lookbackDays);

  const products = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
  })
    .select('_id name category')
    .lean()
    .exec();

  const productMap = new Map(products.map(p => [String(p._id), { name: p.name, category: p.category || 'Other' }]));

  const billFilter = buildBillFilter(restaurantId, branchId, start, end);
  const bills = await BillModel.find(billFilter)
    .select('_id createdAt')
    .lean()
    .exec();

  if (bills.length === 0) return [];

  const billIds = bills.map(b => b._id);
  const items = await BillItemModel.find({ billId: { $in: billIds } })
    .select('itemId itemName quantity priceAtSale')
    .lean()
    .exec();

  // Group by category
  const categoryStats = new Map<string, { revenue: number[]; units: number[] }>();

  for (const item of items) {
    const productInfo = productMap.get(String(item.itemId)) || { category: 'Other' };
    const cat = productInfo.category;
    const revenue = (item.priceAtSale || 0) * (item.quantity || 0);
    const units = item.quantity || 0;

    const stats = categoryStats.get(cat) || { revenue: [], units: [] };
    stats.revenue.push(revenue);
    stats.units.push(units);
    categoryStats.set(cat, stats);
  }

  // Compute medians per category
  const results: CategoryBaseline[] = [];
  for (const [category, stats] of categoryStats.entries()) {
    for (const metric of ['revenue', 'units'] as const) {
      const values = stats[metric].sort((a, b) => a - b);
      if (values.length === 0) continue;
      const median = values.length % 2 === 0
        ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
        : values[Math.floor(values.length / 2)];

      results.push({
        restaurantId,
        branchId,
        category,
        period: 'daily',
        metric,
        value: Math.round(median),
        sampleSize: values.length,
        confidence: computeConfidence(values.length, minSampleSize),
        computedAt: new Date(),
        validFrom: start,
        validTo: end,
      });
    }
  }

  return results;
}

/**
 * Compute product-level baselines
 */
export async function computeProductBaselines(opts: BaselineOptions): Promise<ProductBaseline[]> {
  const { restaurantId, branchId, lookbackDays = DEFAULT_LOOKBACK_DAYS, minSampleSize = MIN_SAMPLE_SIZE } = opts;
  const { start, end } = getDateRange(lookbackDays);

  const billFilter = buildBillFilter(restaurantId, branchId, start, end);
  const bills = await BillModel.find(billFilter)
    .select('_id')
    .lean()
    .exec();

  if (bills.length === 0) return [];

  const billIds = bills.map(b => b._id);
  const items = await BillItemModel.find({ billId: { $in: billIds } })
    .select('itemId itemName quantity priceAtSale')
    .lean()
    .exec();

  // Group by product
  const productStats = new Map<string, { name: string; category: string; revenue: number[]; units: number[] }>();

  for (const item of items) {
    const pid = String(item.itemId);
    const stats = productStats.get(pid) || { name: item.itemName || 'Item', category: 'Other', revenue: [], units: [] };
    stats.revenue.push((item.priceAtSale || 0) * (item.quantity || 0));
    stats.units.push(item.quantity || 0);
    productStats.set(pid, stats);
  }

  const results: ProductBaseline[] = [];
  for (const [productId, stats] of productStats.entries()) {
    for (const metric of ['revenue', 'units'] as const) {
      const values = stats[metric].sort((a, b) => a - b);
      if (values.length === 0) continue;
      const median = values.length % 2 === 0
        ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
        : values[Math.floor(values.length / 2)];

      results.push({
        restaurantId,
        branchId,
        productId,
        productName: stats.name,
        category: stats.category,
        period: 'daily',
        metric,
        value: Math.round(median),
        sampleSize: values.length,
        confidence: computeConfidence(values.length, minSampleSize),
        computedAt: new Date(),
        validFrom: start,
        validTo: end,
      });
    }
  }

  return results;
}

/**
 * Compute all baselines in one call
 */
export async function computeAllBaselines(opts: BaselineOptions): Promise<{
  dailyRevenue: SalesBaseline;
  weeklyRevenue: SalesBaseline;
  monthlyRevenue: SalesBaseline;
  dailyOrders: SalesBaseline;
  aov: SalesBaseline;
  weekdays: TimeSlotBaseline[];
  categories: CategoryBaseline[];
  products: ProductBaseline[];
}> {
  const [
    dailyRevenue,
    weeklyRevenue,
    monthlyRevenue,
    dailyOrders,
    aov,
    weekdays,
    categories,
    products,
  ] = await Promise.all([
    computeDailyRevenueBaseline(opts),
    computeWeeklyRevenueBaseline(opts),
    computeMonthlyRevenueBaseline(opts),
    computeDailyOrdersBaseline(opts),
    computeAOVBaseline(opts),
    computeWeekdayRevenueBaseline(opts),
    computeCategoryBaselines(opts),
    computeProductBaselines(opts),
  ]);

  return { dailyRevenue, weeklyRevenue, monthlyRevenue, dailyOrders, aov, weekdays, categories, products };
}

function createEmptyBaseline(
  restaurantId: string,
  branchId: string | undefined,
  period: SalesBaseline['period'],
  metric: SalesBaseline['metric'],
  lookbackDays: number
): SalesBaseline {
  const { start, end } = getDateRange(lookbackDays);
  return {
    restaurantId,
    branchId,
    period,
    metric,
    value: 0,
    sampleSize: 0,
    confidence: 0,
    computedAt: new Date(),
    validFrom: start,
    validTo: end,
  };
}

function createEmptyTimeSlotBaseline(
  restaurantId: string,
  branchId: string | undefined,
  dayOfWeek: number,
  hour: number,
  metric: TimeSlotBaseline['metric'],
  lookbackDays: number
): TimeSlotBaseline {
  const { start, end } = getDateRange(lookbackDays);
  return {
    restaurantId,
    branchId,
    hour,
    dayOfWeek,
    metric,
    value: 0,
    sampleSize: 0,
    confidence: 0,
    computedAt: new Date(),
    validFrom: start,
    validTo: end,
  };
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
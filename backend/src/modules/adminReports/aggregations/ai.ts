/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ai.ts — AI revenue & profitability intelligence (Phase 2.10, reports/ai-revenue).
 *
 * AI is monetised at a margin above raw inference cost. `AIBillingRecord`
 * stores the per-request customer charge and profit; when the billing ledger is
 * empty we derive estimated revenue from `AIUsageLog.cost` using a configured
 * markup (default 2.0x → 50% gross margin).
 *
 * Outputs cost, revenue, profit, margin, per-feature/model/restaurant pivots and
 * a daily profitability series.
 */

import { AIUsageLog, Restaurant } from '../../../models';
import { AIBillingRecord } from '../models';
import { buildWindow, DateWindow, pctChange, safeStep } from '../reportQueryBuilder';

const DEFAULT_MARKUP = 2.0;

export interface AiRevenueReport {
  summary: {
    totalCost: number;
    totalRevenue: number;
    totalProfit: number;
    profitMargin: number;
    requests: number;
    markup: number;
    costGrowthPct: number;
    revenueGrowthPct: number;
  };
  series: Array<{ key: string; cost: number; revenue: number; profit: number }>;
  byFeature: Array<{ feature: string; requests: number; cost: number; revenue: number; profit: number; margin: number }>;
  byModel: Array<{ model: string; requests: number; cost: number; revenue: number; profit: number }>;
  topRestaurants: Array<{ restaurantId?: string; name?: string; cost: number; revenue: number; profit: number }>;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

async function seriesByDay(model: any, window: DateWindow, costField: string, revenueField: string | null) {
  const rows = await model.aggregate([
    { $match: { createdAt: { $gte: window.from, $lte: window.to } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        cost: { $sum: `$${costField}` },
        revenue: revenueField ? { $sum: `$${revenueField}` } : { $sum: 0 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows;
}

export async function getAiRevenueReport(
  options: { period?: string | null; from?: string | null; to?: string | null; markup?: number } = {},
): Promise<AiRevenueReport> {
  const window: DateWindow = buildWindow({ period: options.period, from: options.from, to: options.to });
  const prev = previousWindowFrom(window);
  const markup = Number.isFinite(options.markup) && (options.markup as number) > 0
    ? (options.markup as number)
    : DEFAULT_MARKUP;

  const hasBilling = await AIBillingRecord.countDocuments({});

  if (hasBilling > 0) {
    return buildFromBilling(window, prev, markup);
  }
  return buildFromUsageLog(window, prev, markup);
}

function previousWindowFrom(window: DateWindow): DateWindow {
  const span = window.to.getTime() - window.from.getTime();
  return { from: new Date(window.from.getTime() - span), to: new Date(window.from.getTime()), period: `prev_${window.period}` };
}

async function buildFromBilling(window: DateWindow, prev: DateWindow, markup: number): Promise<AiRevenueReport> {
  const [cur, prevSum, series, byFeature, byModel, top] = await Promise.all([
    AIBillingRecord.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: null, cost: { $sum: '$usageCost' }, revenue: { $sum: '$customerCharge' }, profit: { $sum: '$profit' }, count: { $sum: 1 } } },
    ]),
    AIBillingRecord.aggregate([
      { $match: { createdAt: { $gte: prev.from, $lte: prev.to } } },
      { $group: { _id: null, cost: { $sum: '$usageCost' }, revenue: { $sum: '$customerCharge' } } },
    ]),
    seriesByDay(AIBillingRecord, window, 'usageCost', 'customerCharge'),
    AIBillingRecord.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: '$feature', requests: { $sum: 1 }, cost: { $sum: '$usageCost' }, revenue: { $sum: '$customerCharge' }, profit: { $sum: '$profit' } } },
      { $sort: { revenue: -1 } },
      { $limit: 20 },
    ]),
    AIBillingRecord.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to }, aiModel: { $ne: null } } },
      { $group: { _id: '$aiModel', requests: { $sum: 1 }, cost: { $sum: '$usageCost' }, revenue: { $sum: '$customerCharge' }, profit: { $sum: '$profit' } } },
      { $sort: { revenue: -1 } },
      { $limit: 20 },
    ]),
    AIBillingRecord.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to }, restaurantId: { $ne: null } } },
      { $group: { _id: '$restaurantId', cost: { $sum: '$usageCost' }, revenue: { $sum: '$customerCharge' }, profit: { $sum: '$profit' } } },
      { $sort: { profit: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const cost = cur[0]?.cost ?? 0;
  const revenue = cur[0]?.revenue ?? 0;
  const profit = cur[0]?.profit ?? 0;
  const requests = cur[0]?.count ?? 0;
  const prevCost = prevSum[0]?.cost ?? 0;
  const prevRevenue = prevSum[0]?.revenue ?? 0;

  return {
    summary: {
      totalCost: round2(cost),
      totalRevenue: round2(revenue),
      totalProfit: round2(profit),
      profitMargin: revenue ? Number(((profit / revenue) * 100).toFixed(2)) : 0,
      requests,
      markup,
      costGrowthPct: pctChange(cost, prevCost),
      revenueGrowthPct: pctChange(revenue, prevRevenue),
    },
    series: series.map((r: any) => ({
      key: String(r._id),
      cost: round2(r.cost),
      revenue: round2(r.revenue),
      profit: round2(r.revenue - r.cost),
    })),
    byFeature: byFeature.map((r: any) => ({
      feature: String(r._id),
      requests: r.requests,
      cost: round2(r.cost),
      revenue: round2(r.revenue),
      profit: round2(r.profit),
      margin: r.revenue ? Number(((r.profit / r.revenue) * 100).toFixed(2)) : 0,
    })),
    byModel: byModel.map((r: any) => ({
      model: String(r._id),
      requests: r.requests,
      cost: round2(r.cost),
      revenue: round2(r.revenue),
      profit: round2(r.profit),
    })),
    topRestaurants: await attachRestaurantNames(top),
  };
}

async function buildFromUsageLog(window: DateWindow, prev: DateWindow, markup: number): Promise<AiRevenueReport> {
  const [cur, prevSum, series, byFeature, byModel, top] = await Promise.all([
    AIUsageLog.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to }, success: true } },
      { $group: { _id: null, cost: { $sum: '$cost' }, count: { $sum: 1 } } },
    ]),
    AIUsageLog.aggregate([
      { $match: { createdAt: { $gte: prev.from, $lte: prev.to }, success: true } },
      { $group: { _id: null, cost: { $sum: '$cost' } } },
    ]),
    seriesByDay(AIUsageLog, window, 'cost', null),
    AIUsageLog.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to }, success: true } },
      { $group: { _id: '$feature', requests: { $sum: 1 }, cost: { $sum: '$cost' } } },
      { $sort: { cost: -1 } },
      { $limit: 20 },
    ]),
    AIUsageLog.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to }, success: true, model: { $ne: null } } },
      { $group: { _id: '$model', requests: { $sum: 1 }, cost: { $sum: '$cost' } } },
      { $sort: { cost: -1 } },
      { $limit: 20 },
    ]),
    AIUsageLog.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to }, success: true, restaurantId: { $ne: null } } },
      { $group: { _id: '$restaurantId', cost: { $sum: '$cost' }, requests: { $sum: 1 } } },
      { $sort: { cost: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const cost = cur[0]?.cost ?? 0;
  const requests = cur[0]?.count ?? 0;
  const revenue = cost * markup;
  const profit = revenue - cost;
  const prevCost = prevSum[0]?.cost ?? 0;
  const prevRevenue = prevCost * markup;

  return {
    summary: {
      totalCost: round2(cost),
      totalRevenue: round2(revenue),
      totalProfit: round2(profit),
      profitMargin: revenue ? Number(((profit / revenue) * 100).toFixed(2)) : 0,
      requests,
      markup,
      costGrowthPct: pctChange(cost, prevCost),
      revenueGrowthPct: pctChange(revenue, prevRevenue),
    },
    series: series.map((r: any) => ({
      key: String(r._id),
      cost: round2(r.cost),
      revenue: round2(r.cost * markup),
      profit: round2(r.cost * (markup - 1)),
    })),
    byFeature: byFeature.map((r: any) => ({
      feature: String(r._id),
      requests: r.requests,
      cost: round2(r.cost),
      revenue: round2(r.cost * markup),
      profit: round2(r.cost * (markup - 1)),
      margin: Number((((markup - 1) / markup) * 100).toFixed(2)),
    })),
    byModel: byModel.map((r: any) => ({
      model: String(r._id),
      requests: r.requests,
      cost: round2(r.cost),
      revenue: round2(r.cost * markup),
      profit: round2(r.cost * (markup - 1)),
    })),
    topRestaurants: await attachRestaurantNames(top),
  };
}

async function attachRestaurantNames(rows: Array<{ _id: any; cost: number; revenue?: number; profit?: number; requests?: number }>): Promise<Array<{ restaurantId?: string; name?: string; cost: number; revenue: number; profit: number }>> {
  const out: Array<{ restaurantId?: string; name?: string; cost: number; revenue: number; profit: number }> = [];
  for (const r of rows) {
    let name: string | undefined;
    try {
      const doc = await Restaurant.findById(r._id).select('name').lean();
      name = (doc as any)?.name;
    } catch {
      name = undefined;
    }
    out.push({
      restaurantId: r._id ? String(r._id) : undefined,
      name,
      cost: round2(r.cost),
      revenue: round2(r.revenue ?? 0),
      profit: round2(r.profit ?? 0),
    });
  }
  return out;
}
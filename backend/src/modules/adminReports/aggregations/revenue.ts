/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * revenue.ts — Revenue intelligence (Phase 2.10, reports/revenue).
 *
 * Provides MRR / ARR, monthly revenue series, refunds, and a revenue forecast
 * built on top of the append-only `RevenueEvent` ledger. When the ledger is
 * empty (fresh install), revenue falls back to `Payment` (status success).
 *
 * Everything is read-only except the recording helpers (`recordRevenueEvent`)
 * which the subscription / AI hooks use to keep the ledger current.
 */

import mongoose from 'mongoose';
import Payment from '../../../models/Payment';
import { Restaurant } from '../../../models';
import { RevenueEvent, IRevenueEvent, RevenueEventType } from '../models';
import {
  buildWindow,
  previousWindow,
  buildForecastBuckets,
  safeStep,
  simpleMovingAverage,
  pctChange,
  DateWindow,
} from '../reportQueryBuilder';

export interface RevenueSeriesPoint {
  key: string;
  value: number;
}

export interface RevenueReport {
  summary: {
    mrr: number;
    arr: number;
    mrrGrowthPct: number;
    prevMrr: number;
    totalCollected: number;
    prevCollected: number;
    collectedGrowthPct: number;
    pendingRefunds: number;
    refunded: number;
    avgMonthlyRevenue: number;
    refundRate: number;
  };
  series: RevenueSeriesPoint[];
  prevSeries: RevenueSeriesPoint[];
  breakdown: Array<{ type: RevenueEventType; amount: number; count: number }>;
  forecast: Array<{ key: string; value: number | null; sma: number | null }>;
  recent: Array<Record<string, any>>;
}

export interface RevenueRecordInput {
  type: RevenueEventType;
  amount: number;
  currency?: string;
  restaurantId?: string | mongoose.Types.ObjectId;
  restaurantName?: string;
  ownerId?: string | mongoose.Types.ObjectId;
  ownerName?: string;
  subscriptionId?: string | mongoose.Types.ObjectId;
  paymentId?: string;
  planId?: string;
  planName?: string;
  billingCycle?: 'monthly' | 'quarterly' | 'yearly' | 'one-time';
  description?: string;
  source?: 'recurring' | 'one-time' | 'refund' | 'adjustment';
  occurredAt?: Date;
  meta?: Record<string, unknown>;
}

/** Append an event to the revenue ledger (used by hooks). Never throws. */
export async function recordRevenueEvent(input: RevenueRecordInput): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount < 0) return;
  try {
    await RevenueEvent.create({
      type: input.type,
      source: input.source ?? (input.type === 'refund' ? 'refund' : 'recurring'),
      amount: input.type === 'refund' ? input.amount : input.amount,
      currency: input.currency ?? 'INR',
      restaurantId: input.restaurantId ? new mongoose.Types.ObjectId(String(input.restaurantId)) : undefined,
      restaurantName: input.restaurantName,
      ownerId: input.ownerId ? new mongoose.Types.ObjectId(String(input.ownerId)) : undefined,
      ownerName: input.ownerName,
      subscriptionId: input.subscriptionId ? new mongoose.Types.ObjectId(String(input.subscriptionId)) : undefined,
      paymentId: input.paymentId,
      planId: input.planId,
      planName: input.planName,
      billingCycle: input.billingCycle,
      description: input.description,
      meta: input.meta,
      occurredAt: input.occurredAt ?? new Date(),
    } as Partial<IRevenueEvent>);
  } catch {
    // Non-blocking best-effort ledger write.
  }
}

interface LedgerRow {
  key: string;
  value: number;
}

async function seriesFromLedger(model: any, window: DateWindow, groupId: any, match: Record<string, any>): Promise<LedgerRow[]> {
  const rows = await model.aggregate([
    { $match: { ...match, occurredAt: { $gte: window.from, $lte: window.to } } },
    { $group: { _id: groupId, value: { $sum: '$amount' } } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r: any) => ({ key: String(r._id), value: r.value }));
}

/**
 * Revenue report. `source` field on RevenueEvent distinguishes refunds (negative
 * impact) from collections; refunds are reported separately and never netted
 * out of MRR — MRR is subscription collections only.
 */
export async function getRevenueReport(
  options: {
    period?: string | null;
    from?: string | null;
    to?: string | null;
    forecastSteps?: number;
  } = {},
): Promise<RevenueReport> {
  const window: DateWindow = buildWindow({ period: options.period, from: options.from, to: options.to });
  const prev = previousWindow(window);

  const hasLedger = await RevenueEvent.countDocuments({});
  if (hasLedger > 0) {
    return buildFromLedger(window, prev, options.forecastSteps);
  }
  return buildFromPayments(window, prev, options.forecastSteps);
}

async function buildFromLedger(window: DateWindow, prev: DateWindow, forecastSteps?: number): Promise<RevenueReport> {
  const [summary, prevSummary, series, prevSeries, breakdown, recent] = await Promise.all([
    RevenueEvent.aggregate([
      { $match: { occurredAt: { $gte: window.from, $lte: window.to }, type: { $ne: 'refund' } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    RevenueEvent.aggregate([
      { $match: { occurredAt: { $gte: prev.from, $lte: prev.to }, type: { $ne: 'refund' } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    seriesFromLedger(RevenueEvent, window, {
      $dateToString: { format: '%Y-%m', date: '$occurredAt', timezone: 'UTC' },
    }, { type: { $ne: 'refund' } }),
    seriesFromLedger(RevenueEvent, prev, {
      $dateToString: { format: '%Y-%m', date: '$occurredAt', timezone: 'UTC' },
    }, { type: { $ne: 'refund' } }),
    RevenueEvent.aggregate([
      { $match: { occurredAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    RevenueEvent.find({ occurredAt: { $gte: window.from, $lte: window.to } })
      .sort({ occurredAt: -1 })
      .limit(25)
      .lean(),
  ]);

  const collected = summary[0]?.total ?? 0;
  const prevCollected = prevSummary[0]?.total ?? 0;

  const refundRows = breakdown.filter((b) => b._id === 'refund');
  const refunded = refundRows.reduce((s, r) => s + r.amount, 0);
  const pendingRefunds = await RefundCount();

  const months = series.length || 1;
  const mrr = collected / months;
  const prevMrr = prevSeries.length ? prevCollected / prevSeries.length : 0;

  const forecast = buildForecast(
    series.map((p) => ({ key: p.key, value: p.value })),
    window,
    forecastSteps,
    mrr,
  );

  return {
    summary: {
      mrr: round2(mrr),
      arr: round2(mrr * 12),
      mrrGrowthPct: pctChange(mrr, prevMrr),
      prevMrr: round2(prevMrr),
      totalCollected: round2(collected),
      prevCollected: round2(prevCollected),
      collectedGrowthPct: pctChange(collected, prevCollected),
      pendingRefunds,
      refunded: round2(refunded),
      avgMonthlyRevenue: round2(collected / months),
      refundRate: collected ? Number(((refunded / collected) * 100).toFixed(2)) : 0,
    },
    series,
    prevSeries,
    breakdown: breakdown.map((b) => ({ type: b._id, amount: round2(b.amount), count: b.count })),
    forecast,
    recent,
  };
}

async function buildFromPayments(window: DateWindow, prev: DateWindow, forecastSteps?: number): Promise<RevenueReport> {
  const [summary, prevSummary, series, prevSeries, recent] = await Promise.all([
    Payment.aggregate([
      { $match: { status: 'success', createdAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: { status: 'success', createdAt: { $gte: prev.from, $lte: prev.to } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    seriesFromLedger(Payment, window, {
      $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'UTC' },
    }, { status: 'success' }),
    seriesFromLedger(Payment, prev, {
      $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'UTC' },
    }, { status: 'success' }),
    Payment.find({ status: 'success', createdAt: { $gte: window.from, $lte: window.to } })
      .sort({ createdAt: -1 })
      .limit(25)
      .lean(),
  ]);

  const collected = summary[0]?.total ?? 0;
  const prevCollected = prevSummary[0]?.total ?? 0;
  const months = series.length || 1;
  const mrr = collected / months;
  const prevMrr = prevSeries.length ? prevCollected / prevSeries.length : 0;
  const forecast = buildForecast(
    series.map((p) => ({ key: p.key, value: p.value })),
    window,
    forecastSteps,
    mrr,
  );

  return {
    summary: {
      mrr: round2(mrr),
      arr: round2(mrr * 12),
      mrrGrowthPct: pctChange(mrr, prevMrr),
      prevMrr: round2(prevMrr),
      totalCollected: round2(collected),
      prevCollected: round2(prevCollected),
      collectedGrowthPct: pctChange(collected, prevCollected),
      pendingRefunds: await RefundCount(),
      refunded: 0,
      avgMonthlyRevenue: round2(collected / months),
      refundRate: 0,
    },
    series,
    prevSeries,
    breakdown: [],
    forecast,
    recent,
  };
}

async function RefundCount(): Promise<number> {
  try {
    const { Refund } = await import('../models');
    return await Refund.countDocuments({ status: 'pending' });
  } catch {
    return 0;
  }
}

function buildForecast(
  series: RevenueSeriesPoint[],
  window: DateWindow,
  forecastSteps?: number,
  mrr = 0,
): Array<{ key: string; value: number | null; sma: number | null }> {
  const buckets = buildForecastBuckets(window, safeStep(forecastSteps, 3));
  const last = series.length ? series[series.length - 1].value : mrr;
  const sma = simpleMovingAverage(series, 3);

  return buckets.map((b, i) => {
    const trend = Math.min(i, 3) * 0.02;
    const value = Number((last * (1 + trend)).toFixed(2));
    return { key: b.period, value, sma: sma[i]?.sma ?? null };
  });
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

// Re-export for tree-shaking friendliness in tests.
export type { IRevenueEvent };
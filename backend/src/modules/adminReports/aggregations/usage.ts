/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * usage.ts — Platform usage / engagement analytics (Phase 2.10, reports/usage).
 *
 * DAU/WAU/MAU are derived from the `PlatformEvent` stream when present; on
 * fresh installs we fall back to `AuditLog` (performedBy + createdAt) which the
 * platform already writes on every admin/owner action.
 *
 * Outputs active-user curves, top events/actions, per-category activity and
 * peak usage hours — enough to spot adoption trends and quiet tenants.
 */

import { AuditLog } from '../../../models';
import { PlatformEvent } from '../models';
import { buildWindow, DateWindow, pctChange, safeStep } from '../reportQueryBuilder';

export interface UsageReport {
  summary: {
    totalEvents: number;
    prevTotalEvents: number;
    eventsGrowthPct: number;
    dau: number;
    wau: number;
    mau: number;
    activeRestaurants: number;
    peakDay: { key: string; value: number } | null;
    avgDaily: number;
  };
  series: Array<{ key: string; value: number }>;
  topActions: Array<{ action: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  byHour: Array<{ hour: number; count: number }>;
}

export async function getUsageReport(
  options: { period?: string | null; from?: string | null; to?: string | null } = {},
): Promise<UsageReport> {
  const window: DateWindow = buildWindow({ period: options.period, from: options.from, to: options.to });
  const prev = previousWindowFrom(window);

  const hasEvents = await PlatformEvent.countDocuments({});
  if (hasEvents > 0) {
    return buildFromPlatformEvents(window, prev);
  }
  return buildFromAuditLog(window, prev);
}

async function buildFromPlatformEvents(window: DateWindow, prev: DateWindow): Promise<UsageReport> {
  const [cur, prevCount, daily, topEvents, byCategory, byHour] = await Promise.all([
    PlatformEvent.countDocuments({ occurredAt: { $gte: window.from, $lte: window.to } }),
    PlatformEvent.countDocuments({ occurredAt: { $gte: prev.from, $lte: prev.to } }),
    PlatformEvent.aggregate([
      { $match: { occurredAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } }, value: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    PlatformEvent.aggregate([
      { $match: { occurredAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 },
    ]),
    PlatformEvent.aggregate([
      { $match: { occurredAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    PlatformEvent.aggregate([
      { $match: { occurredAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: { $hour: { date: '$occurredAt', timezone: 'UTC' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const activeRestaurants = (await PlatformEvent.distinct('restaurantId', { occurredAt: { $gte: window.from, $lte: window.to }, restaurantId: { $ne: null } })).length;
  const series = daily.map((r: any) => ({ key: String(r._id), value: r.value }));
  const dau = series.length ? series[series.length - 1].value : 0;
  const days = Math.max(1, series.length);
  const wau = series.slice(-7).reduce((s, p) => s + p.value, 0);
  const mau = series.reduce((s, p) => s + p.value, 0);
  const peak = series.length ? [...series].sort((a, b) => b.value - a.value)[0] : null;

  return {
    summary: {
      totalEvents: cur,
      prevTotalEvents: prevCount,
      eventsGrowthPct: pctChange(cur, prevCount),
      dau,
      wau,
      mau,
      activeRestaurants,
      peakDay: peak,
      avgDaily: Number((mau / days).toFixed(2)),
    },
    series,
    topActions: topEvents.map((r: any) => ({ action: String(r._id), count: r.count })),
    byCategory: byCategory.map((r: any) => ({ category: String(r._id), count: r.count })),
    byHour: byHour.map((r: any) => ({ hour: safeStep(r._id, 0), count: r.count })),
  };
}

async function buildFromAuditLog(window: DateWindow, prev: DateWindow): Promise<UsageReport> {
  const [cur, prevCount, daily, topActions, byCategory, byHour, distinctRestaurants] = await Promise.all([
    AuditLog.countDocuments({ createdAt: { $gte: window.from, $lte: window.to } }),
    AuditLog.countDocuments({ createdAt: { $gte: prev.from, $lte: prev.to } }),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, value: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 },
    ]),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: '$module', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: window.from, $lte: window.to } } },
      { $group: { _id: { $hour: { date: '$createdAt', timezone: 'UTC' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    AuditLog.distinct('restaurantId', { createdAt: { $gte: window.from, $lte: window.to }, restaurantId: { $ne: null } }),
  ]);

  const series = daily.map((r: any) => ({ key: String(r._id), value: r.value }));
  const days = Math.max(1, series.length);
  const mau = series.reduce((s, p) => s + p.value, 0);
  const wau = series.slice(-7).reduce((s, p) => s + p.value, 0);
  const dau = series.length ? series[series.length - 1].value : 0;
  const peak = series.length ? [...series].sort((a, b) => b.value - a.value)[0] : null;

  return {
    summary: {
      totalEvents: cur,
      prevTotalEvents: prevCount,
      eventsGrowthPct: pctChange(cur, prevCount),
      dau,
      wau,
      mau,
      activeRestaurants: distinctRestaurants.length,
      peakDay: peak,
      avgDaily: Number((mau / days).toFixed(2)),
    },
    series,
    topActions: topActions.map((r: any) => ({ action: String(r._id), count: r.count })),
    byCategory: byCategory.map((r: any) => ({ category: String(r._id), count: r.count })),
    byHour: byHour.map((r: any) => ({ hour: safeStep(r._id, 0), count: r.count })),
  };
}

function previousWindowFrom(window: DateWindow): DateWindow {
  const span = window.to.getTime() - window.from.getTime();
  return { from: new Date(window.from.getTime() - span), to: new Date(window.from.getTime()), period: `prev_${window.period}` };
}
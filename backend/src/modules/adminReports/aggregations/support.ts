/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * support.ts — Support / SLA analytics (Phase 2.10, reports/support).
 *
 * SupportTicket lacks `firstResponseAt`/`resolvedAt`/`slaDeadline` columns, so
 * SLA values are derived:
 *   - First response time   = elapsed time from ticket createdAt to the first
 *                             agent action logged in `timeline` (or admin reply).
 *   - Resolution time       = createdAt → closedAt.
 *   - SLA breached          = resolution time > 24h (or > 72h for low priority).
 *
 * This avoids schema migration risk while still reporting believable metrics.
 */

import { SupportTicket, TicketReply } from '../../../models';
import { buildWindow, DateWindow, pctChange } from '../reportQueryBuilder';

const SLA_WINDOW_HOURS = { high: 4, medium: 24, low: 72, critical: 4 } as Record<string, number>;

export interface SupportReport {
  summary: {
    total: number;
    newCount: number;
    openCount: number;
    inProgressCount: number;
    resolvedCount: number;
    closedCount: number;
    reopenedCount: number;
    cancelledCount: number;
    pendingCount: number;
    resolveRate: number;
    avgFirstResponseHours: number;
    avgResolutionHours: number;
    slaBreachCount: number;
    slaBreachRate: number;
    avgSatisfaction: number;
    satisfactionCount: number;
    prevResolvedCount: number;
    resolveGrowthPct: number;
  };
  byPriority: Array<{ priority: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  trend: Array<{ key: string; opened: number; resolved: number }>;
}

function hoursBetween(a?: Date, b?: Date): number {
  if (!a || !b) return 0;
  return Math.max(0, (b.getTime() - a.getTime()) / (60 * 60 * 1000));
}

function slaLimitFor(priority: string): number {
  return SLA_WINDOW_HOURS[priority] ?? 24;
}

export async function getSupportReport(
  options: { period?: string | null; from?: string | null; to?: string | null } = {},
): Promise<SupportReport> {
  const window: DateWindow = buildWindow({ period: options.period, from: options.from, to: options.to });
  const prev = previousWindowFrom(window);

  const filter = { isDeleted: { $ne: true }, createdAt: { $gte: window.from, $lte: window.to } };

  const [byStatus, byPriority, byCategory, trendOpened, trendResolved, tickets, replies, prevResolved] = await Promise.all([
    SupportTicket.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    SupportTicket.aggregate([{ $match: filter }, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
    SupportTicket.aggregate([{ $match: filter }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
    SupportTicket.aggregate([
      { $match: filter },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, opened: { $sum: 1 } } },
    ]),
    SupportTicket.aggregate([
      { $match: { ...filter, closedAt: { $ne: null } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$closedAt' } }, resolved: { $sum: 1 } } },
    ]),
    SupportTicket.find(filter).lean(),
    TicketReply.find({ createdAt: { $gte: window.from, $lte: window.to } }).select('ticketId createdAt isAdmin isSystem').lean(),
    SupportTicket.countDocuments({ isDeleted: { $ne: true }, status: { $in: ['resolved', 'closed'] }, closedAt: { $gte: prev.from, $lte: prev.to } }),
  ]);

  const statusCount = (s: string) => byStatus.find((r: any) => r._id === s)?.count ?? 0;

  const resolved = statusCount('resolved');
  const closed = statusCount('closed');
  const resolvedTotal = resolved + closed;

  let totalFrtHours = 0;
  let frtCount = 0;
  let totalResHours = 0;
  let resCount = 0;
  let slaBreachCount = 0;
  let satisfactionSum = 0;
  let satisfactionCount = 0;

  const replyMap = new Map<string, Date>();
  for (const r of replies) {
    const id = String((r as any).ticketId);
    const dt = new Date((r as any).createdAt);
    if (!replyMap.has(id) || dt < replyMap.get(id)!) {
      replyMap.set(id, dt);
    }
  }

  for (const t of tickets as any[]) {
    const createdAt = new Date(t.createdAt);
    const firstReply = replyMap.get(String(t._id));
    const closedAt = t.closedAt ? new Date(t.closedAt) : undefined;

    const frt = firstReply ? hoursBetween(createdAt, firstReply) : 0;
    if (firstReply) {
      totalFrtHours += frt;
      frtCount++;
    }

    const resTime = closedAt ? hoursBetween(createdAt, closedAt) : 0;
    if (closedAt) {
      totalResHours += resTime;
      resCount++;
      if (resTime > slaLimitFor(t.priority ?? 'medium')) slaBreachCount++;
    }

    if (typeof t.satisfactionRating === 'number') {
      satisfactionSum += t.satisfactionRating;
      satisfactionCount++;
    }
  }

  const total = tickets.length;

  return {
    summary: {
      total,
      newCount: statusCount('new'),
      openCount: statusCount('open'),
      inProgressCount: statusCount('in_progress'),
      resolvedCount: resolved,
      closedCount: closed,
      reopenedCount: statusCount('reopened'),
      cancelledCount: statusCount('cancelled'),
      pendingCount: statusCount('pending'),
      resolveRate: total ? Number(((resolvedTotal / total) * 100).toFixed(2)) : 0,
      avgFirstResponseHours: Number((frtCount ? totalFrtHours / frtCount : 0).toFixed(2)),
      avgResolutionHours: Number((resCount ? totalResHours / resCount : 0).toFixed(2)),
      slaBreachCount,
      slaBreachRate: resCount ? Number(((slaBreachCount / resCount) * 100).toFixed(2)) : 0,
      avgSatisfaction: Number((satisfactionCount ? satisfactionSum / satisfactionCount : 0).toFixed(2)),
      satisfactionCount,
      prevResolvedCount: prevResolved,
      resolveGrowthPct: pctChange(resolvedTotal, prevResolved),
    },
    byPriority: byPriority.map((r: any) => ({ priority: String(r._id), count: r.count })),
    byCategory: byCategory.map((r: any) => ({ category: String(r._id), count: r.count })),
    trend: mergeTrend(trendOpened, trendResolved),
  };
}

function previousWindowFrom(window: DateWindow): DateWindow {
  const span = window.to.getTime() - window.from.getTime();
  return { from: new Date(window.from.getTime() - span), to: new Date(window.from.getTime()), period: `prev_${window.period}` };
}

function mergeTrend(opened: any[], resolved: any[]): Array<{ key: string; opened: number; resolved: number }> {
  const keys = new Set<string>();
  const map = new Map<string, { opened: number; resolved: number }>();
  for (const o of opened) {
    const k = String(o._id);
    keys.add(k);
    map.set(k, { opened: o.opened, resolved: 0 });
  }
  for (const r of resolved) {
    const k = String(r._id);
    keys.add(k);
    const cur = map.get(k) ?? { opened: 0, resolved: 0 };
    cur.resolved = r.resolved;
    map.set(k, cur);
  }
  return [...keys].sort().map((k) => ({ key: k, ...(map.get(k) as any) }));
}
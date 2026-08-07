/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * inactive.ts — Inactive / dormant restaurant analytics (Phase 2.10, reports/inactive).
 *
 * Identifies restaurants that have stopped producing activity and quantifies the
 * dormant base. Inactivity is measured as:
 *   - last audit-log action OR last device heartbeat OR last login is older
 *     than the inactivity threshold (default 30 days), AND
 *   - the restaurant is not producing new bills/orders in the window.
 *
 * The daily job snapshots these findings into `InactiveRestaurantSnapshot` so
 * trends are stable across days; this service computes a live view and can read
 * the most recent snapshot.
 */

import { AuditLog, Device, Restaurant, Bill } from '../../../models';
import { InactiveRestaurantSnapshot } from '../models';
import { buildWindow, DateWindow } from '../reportQueryBuilder';

export interface InactiveReport {
  summary: {
    totalInactive: number;
    newInactive: number;
    reactivated: number;
    longestInactiveDays: number;
    avgInactiveDays: number;
    inactivePct: number;
    thresholdDays: number;
    snapshotDate?: string;
  };
  entries: Array<{
    restaurantId: string;
    restaurantName: string;
    ownerId?: string;
    ownerName?: string;
    inactiveSince: Date;
    lastActivityAt?: Date;
    inactiveDays: number;
    hasSubscription: boolean;
    planName?: string;
    aiEnabled: boolean;
    loyaltyEnabled: boolean;
  }>;
  byRegion: Array<{ city: string; count: number }>;
}

const DEFAULT_THRESHOLD_DAYS = 30;

/** Last activity date for a restaurant across known surfaces. */
export async function lastActivityForRestaurant(restaurantId: string): Promise<Date | null> {
  const [audit, device, bill] = await Promise.all([
    AuditLog.findOne({ restaurantId })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean(),
    Device.findOne({ restaurantId })
      .sort({ lastActivityAt: -1 })
      .select('lastActivityAt')
      .lean(),
    Bill.findOne({ restaurantId })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean(),
  ]);
  const candidates = [
    (audit as any)?.createdAt,
    (device as any)?.lastActivityAt,
    (bill as any)?.createdAt,
  ].filter((d) => d instanceof Date);
  return candidates.length ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : null;
}

export async function getInactiveReport(
  options: {
    period?: string | null;
    from?: string | null;
    to?: string | null;
    thresholdDays?: number;
    limit?: number;
    useSnapshot?: boolean;
  } = {},
): Promise<InactiveReport> {
  const thresholdDays = Math.max(1, options.thresholdDays ?? DEFAULT_THRESHOLD_DAYS);

  if (options.useSnapshot) {
    const snap = await InactiveRestaurantSnapshot.findOne({})
      .sort({ snapshotDate: -1 })
      .lean();
    if (snap) return snapshotToReport(snap as any, thresholdDays);
  }

  const window: DateWindow = buildWindow({ period: options.period, from: options.from, to: options.to });
  const now = new Date();
  const cutoff = new Date(now.getTime() - thresholdDays * 24 * 60 * 60 * 1000);

  const all = await Restaurant.find({ isDeleted: { $ne: true } })
    .select('_id name ownerUserId ownerName aiEnabled loyaltyEnabled isActive createdAt city')
    .lean();

  const entries: Array<{
    restaurantId: string;
    restaurantName: string;
    ownerId?: string;
    ownerName?: string;
    inactiveSince: Date;
    lastActivityAt?: Date;
    inactiveDays: number;
    hasSubscription: boolean;
    planName?: string;
    aiEnabled: boolean;
    loyaltyEnabled: boolean;
  }> = [];

  for (const r of all as any[]) {
    const last = await lastActivityForRestaurant(String(r._id));
    const created = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
    if (last && last.getTime() > cutoff.getTime()) continue; // still active

    const reference = last ?? created;
    const inactiveDays = Math.max(1, Math.floor((now.getTime() - reference.getTime()) / (24 * 60 * 60 * 1000)));
    if (inactiveDays < thresholdDays) continue;

    let sub: any = null;
    try {
      const { default: Subscription } = await import('../../../models/Subscription');
      sub = await Subscription.findOne({ restaurantId: r._id }).lean();
    } catch {
      sub = null;
    }

    entries.push({
      restaurantId: String(r._id),
      restaurantName: r.name,
      ownerId: r.ownerUserId,
      ownerName: r.ownerName,
      inactiveSince: reference,
      lastActivityAt: last ?? undefined,
      inactiveDays,
      hasSubscription: Boolean(sub),
      planName: (sub as any)?.plan,
      aiEnabled: Boolean(r.aiEnabled),
      loyaltyEnabled: Boolean(r.loyaltyEnabled),
    });
  }

  entries.sort((a, b) => b.inactiveDays - a.inactiveDays);
  const limited = entries.slice(0, Math.max(1, options.limit ?? 100));

  const byRegionAgg = await Restaurant.aggregate([
    { $match: { _id: { $in: limited.map((e) => e.restaurantId as any) }, city: { $ne: null } } },
    { $group: { _id: '$city', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 8 },
  ]);

  const totalInactive = entries.length;
  const longest = limited.length ? limited[0].inactiveDays : 0;
  const avg = limited.length ? Number((limited.reduce((s, e) => s + e.inactiveDays, 0) / limited.length).toFixed(2)) : 0;
  const totalRestaurants = await Restaurant.countDocuments({ isDeleted: { $ne: true } });

  return {
    summary: {
      totalInactive,
      newInactive: 0,
      reactivated: 0,
      longestInactiveDays: longest,
      avgInactiveDays: avg,
      inactivePct: totalRestaurants ? Number(((totalInactive / totalRestaurants) * 100).toFixed(2)) : 0,
      thresholdDays,
    },
    entries: limited,
    byRegion: byRegionAgg.map((r: any) => ({ city: String(r._id), count: r.count })),
  };
}

function snapshotToReport(snap: any, thresholdDays: number): InactiveReport {
  return {
    summary: {
      totalInactive: snap.totalInactive ?? 0,
      newInactive: snap.newInactive ?? 0,
      reactivated: snap.reactivated ?? 0,
      longestInactiveDays: snap.longestInactiveDays ?? 0,
      avgInactiveDays: snap.avgInactiveDays ?? 0,
      inactivePct: 0,
      thresholdDays,
      snapshotDate: snap.snapshotDate?.toISOString?.() ?? undefined,
    },
    entries: (snap.entries ?? []).map((e: any) => ({
      restaurantId: String(e.restaurantId),
      restaurantName: e.restaurantName,
      ownerId: e.ownerId,
      ownerName: e.ownerName,
      inactiveSince: e.inactiveSince,
      lastActivityAt: e.lastActivityAt,
      inactiveDays: e.inactiveDays,
      hasSubscription: e.hasSubscription,
      planName: e.planName,
      aiEnabled: e.aiEnabled,
      loyaltyEnabled: e.loyaltyEnabled,
    })),
    byRegion: [],
  };
}

/** Compute the snapshot payload used by the nightly inactive job. */
export async function computeInactiveSnapshot(thresholdDays = DEFAULT_THRESHOLD_DAYS): Promise<any> {
  const report = await getInactiveReport({ thresholdDays, limit: 5000, useSnapshot: false });
  const previous = await InactiveRestaurantSnapshot.findOne({}).sort({ snapshotDate: -1 }).lean();

  const prevIds = new Set((previous as any)?.entries?.map((e: any) => String(e.restaurantId)) ?? []);
  const newInactive = report.entries.filter((e) => !prevIds.has(e.restaurantId)).length;
  const reactivated = (previous as any)?.entries?.filter((e: any) => !report.entries.some((cur) => String(cur.restaurantId) === String(e.restaurantId))).length ?? 0;

  return {
    snapshotDate: new Date(),
    totalInactive: report.summary.totalInactive,
    newInactive,
    reactivated,
    longestInactiveDays: report.summary.longestInactiveDays,
    avgInactiveDays: report.summary.avgInactiveDays,
    entries: report.entries,
  };
}
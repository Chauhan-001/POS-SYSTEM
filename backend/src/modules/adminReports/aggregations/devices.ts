/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * devices.ts — Device estate analytics (Phase 2.10, reports/devices).
 *
 * Aggregates the POS device fleet: online/offline posture, OS / platform /
 * app-version spread, sync health, blocked devices and per-restaurant device
 * density. Read-only over the `Device` collection.
 */

import { Device } from '../../../models';
import { buildWindow, DateWindow, pctChange } from '../reportQueryBuilder';

export interface DeviceReport {
  summary: {
    total: number;
    active: number;
    inactive: number;
    blocked: number;
    pending: number;
    rejected: number;
    online: number;
    offline: number;
    onlineRate: number;
    unapprovedRate: number;
    avgFailedSync: number;
    devicesWithSyncFailures: number;
    prevActive: number;
    activeGrowthPct: number;
  };
  byPlatform: Array<{ platform: string; count: number }>;
  byOs: Array<{ os: string; count: number }>;
  byAppVersion: Array<{ version: string; count: number }>;
  byType: Array<{ type: string; count: number }>;
  topRestaurants: Array<{ restaurantId?: string; count: number }>;
}

export async function getDeviceReport(
  options: { period?: string | null; from?: string | null; to?: string | null } = {},
): Promise<DeviceReport> {
  const window: DateWindow = buildWindow({ period: options.period, from: options.from, to: options.to });
  const prev = previousWindowFrom(window);

  const filter = { isDeleted: { $ne: true } };

  const [
    total, active, inactive, blocked, pending, rejected,
    online, prevActive,
    byPlatform, byOs, byAppVersion, byType, topRestaurants, syncStats,
  ] = await Promise.all([
    Device.countDocuments(filter),
    Device.countDocuments({ ...filter, status: 'active' }),
    Device.countDocuments({ ...filter, status: 'inactive' }),
    Device.countDocuments({ ...filter, status: 'blocked' }),
    Device.countDocuments({ ...filter, status: 'pending' }),
    Device.countDocuments({ ...filter, status: 'rejected' }),
    Device.countDocuments({ ...filter, isOnline: true }),
    Device.countDocuments({ ...filter, createdAt: { $gte: prev.from, $lte: prev.to } }),
    Device.aggregate([
      { $match: { ...filter, platform: { $nin: [null, ''] } } },
      { $group: { _id: '$platform', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Device.aggregate([
      { $match: { ...filter, os: { $nin: [null, ''] } } },
      { $group: { _id: '$os', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Device.aggregate([
      { $match: { ...filter, appVersion: { $nin: [null, ''] } } },
      { $group: { _id: '$appVersion', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 },
    ]),
    Device.aggregate([
      { $match: { ...filter, type: { $nin: [null, ''] } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Device.aggregate([
      { $match: { ...filter, restaurantId: { $ne: null } } },
      { $group: { _id: '$restaurantId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Device.aggregate([
      { $match: { ...filter } },
      {
        $group: {
          _id: null,
          totalSyncFailures: { $sum: '$failedSyncCount' },
          withFailures: {
            $sum: {
              $cond: [{ $gt: ['$failedSyncCount', 0] }, 1, 0],
            },
          },
        },
      },
    ]),
  ]);

  const sync = syncStats[0];
  const onlineRate = total ? Number(((online / total) * 100).toFixed(2)) : 0;
  const unapproved = pending + rejected;
  const avgFailedSync = total ? Number(((sync?.totalSyncFailures ?? 0) / total).toFixed(2)) : 0;

  return {
    summary: {
      total,
      active,
      inactive,
      blocked,
      pending,
      rejected,
      online,
      offline: Math.max(0, total - online),
      onlineRate,
      unapprovedRate: total ? Number(((unapproved / total) * 100).toFixed(2)) : 0,
      avgFailedSync,
      devicesWithSyncFailures: sync?.withFailures ?? 0,
      prevActive,
      activeGrowthPct: pctChange(active, prevActive),
    },
    byPlatform: byPlatform.map((r: any) => ({ platform: String(r._id), count: r.count })),
    byOs: byOs.map((r: any) => ({ os: String(r._id), count: r.count })),
    byAppVersion: byAppVersion.map((r: any) => ({ version: String(r._id), count: r.count })),
    byType: byType.map((r: any) => ({ type: String(r._id), count: r.count })),
    topRestaurants: topRestaurants.map((r: any) => ({ restaurantId: String(r._id), count: r.count })),
  };
}

function previousWindowFrom(window: DateWindow): DateWindow {
  const span = window.to.getTime() - window.from.getTime();
  return { from: new Date(window.from.getTime() - span), to: new Date(window.from.getTime()), period: `prev_${window.period}` };
}
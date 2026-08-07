/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * statsService.ts — Audit dashboard statistics.
 *
 * Aggregations powering the admin audit overview: totals, today, severity /
 * module / category buckets, security events, top actors/errors, a live feed
 * and a time heatmap. All queries run against the active collection.
 */

import AuditLog from '../../models/AuditLog';

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(): Date {
  const d = startOfDay();
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export async function getAuditStats() {
  const now = new Date();
  const dayStart = startOfDay();
  const weekStart = startOfWeek();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY);
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

  const [
    total,
    today,
    thisWeek,
    last30d,
    failureCount,
    securityCount,
    aiCount,
    deviceCount,
    exportCount,
    settingsCount,
    failedLogins,
    permissionChanges,
    criticalWithinDay,
  ] = await Promise.all([
    AuditLog.countDocuments().exec(),
    AuditLog.countDocuments({ createdAt: { $gte: dayStart } }).exec(),
    AuditLog.countDocuments({ createdAt: { $gte: weekStart } }).exec(),
    AuditLog.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }).exec(),
    AuditLog.countDocuments({
      $or: [{ result: 'failure' }, { severity: { $in: ['critical', 'high'] } }],
      createdAt: { $gte: thirtyDaysAgo },
    }).exec(),
    AuditLog.countDocuments({ category: 'security', createdAt: { $gte: thirtyDaysAgo } }).exec(),
    AuditLog.countDocuments({ module: { $in: ['ai', 'voice'] }, createdAt: { $gte: thirtyDaysAgo } }).exec(),
    AuditLog.countDocuments({ module: 'device', createdAt: { $gte: thirtyDaysAgo } }).exec(),
    AuditLog.countDocuments({ action: { $regex: '^.*\\.exported$' }, createdAt: { $gte: thirtyDaysAgo } }).exec(),
    AuditLog.countDocuments({ module: 'settings', createdAt: { $gte: thirtyDaysAgo } }).exec(),
    AuditLog.countDocuments({ action: 'auth.login_failed', createdAt: { $gte: thirtyDaysAgo } }).exec(),
    AuditLog.countDocuments({ action: { $regex: '^(auth.permission_updated|role.changed|owner\\.)' }, createdAt: { $gte: thirtyDaysAgo } }).exec(),
    AuditLog.countDocuments({
      severity: 'critical',
      createdAt: { $gte: startOfDay() },
      category: 'security',
    }).exec(),
  ]);

  const [severityBuckets, moduleBuckets, categoryBuckets, actorTop, errorTop, liveFeed, heatmap] =
    await Promise.all([
      AuditLog.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ]).exec(),
      AuditLog.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo }, module: { $ne: null } } },
        { $group: { _id: '$module', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 12 },
      ]).exec(),
      AuditLog.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo }, category: { $ne: null } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).exec(),
      AuditLog.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo }, performedBy: { $ne: null } } },
        { $group: { _id: '$performedBy', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).exec(),
      AuditLog.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo }, result: 'failure' } },
        { $group: { _id: { a: '$action', r: '$result' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).exec(),
      AuditLog.find({ createdAt: { $gte: tenMinutesAgo } })
        .sort({ createdAt: -1 })
        .limit(25)
        .lean()
        .exec(),
      AuditLog.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]).exec(),
    ]);

  return {
    totals: { total, today, thisWeek, last30d },
    health: {
      failureCount,
      securityCount,
      criticalToday: criticalWithinDay,
      failedLogins,
      permissionChanges,
      aiCount,
      deviceCount,
      exportCount,
      settingsCount,
    },
    buckets: {
      severity: severityBuckets.map((b) => ({ severity: b._id || 'unknown', count: b.count })),
      module: moduleBuckets.map((b) => ({ module: b._id, count: b.count })),
      category: categoryBuckets.map((b) => ({ category: b._id, count: b.count })),
    },
    top: {
      actors: actorTop.map((b) => ({ performer: b._id, count: b.count })),
      errors: errorTop.map((b) => ({ action: b._id.a, result: b._id.r, count: b.count })),
    },
    heatmap: heatmap.map((b) => ({ date: b._id, count: b.count })),
    liveFeed: liveFeed.map((d) => ({
      id: String(d._id),
      action: d.action,
      module: d.module || null,
      category: d.category || null,
      severity: d.severity || null,
      result: d.result || null,
      performedBy: d.performedBy,
      entityType: d.entityType,
      entityLabel: d.entityLabel || null,
      restaurantId: d.restaurantId ? String(d.restaurantId) : null,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}
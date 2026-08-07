/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * owners.ts — Owner-account analytics (Phase 2.10, reports/owners).
 *
 * Ranks owner accounts by restaurants owned, tenant activity, AI spend and
 * support engagement so the platform team can spot healthy / at-risk tenants.
 *
 * Read-only over User, Restaurant, AIUsageLog, Subscription and SupportTicket.
 */

import mongoose from 'mongoose';
import { User, Restaurant, AIUsageLog, Subscription, SupportTicket } from '../../../models';
import { buildWindow, DateWindow } from '../reportQueryBuilder';

export interface OwnerReport {
  summary: {
    totalOwners: number;
    ownersWithRestaurants: number;
    activeOwners: number;
    avgRestaurantsPerOwner: number;
  };
  owners: Array<{
    ownerId: string;
    ownerName: string;
    ownerEmail?: string;
    restaurantCount: number;
    aiEnabledCount: number;
    activeRestaurantCount: number;
    aiCost: number;
    aiRequests: number;
    openTickets: number;
    subscriptionCount: number;
    lastLogin?: Date | null;
  }>;
}

export async function getOwnerReport(
  options: { period?: string | null; from?: string | null; to?: string | null } = {},
): Promise<OwnerReport> {
  const window: DateWindow = buildWindow({ period: options.period, from: options.from, to: options.to });

  const totalOwners = await User.countDocuments({});
  const restaurantOwners = await Restaurant.aggregate([
    { $match: { isDeleted: { $ne: true } } },
    { $group: { _id: '$ownerUserId', count: { $sum: 1 } } },
  ]);

  const ownerRows = await Restaurant.aggregate([
    { $match: { isDeleted: { $ne: true }, ownerUserId: { $ne: null } } },
    {
      $group: {
        _id: '$ownerUserId',
        restaurantCount: { $sum: 1 },
        aiEnabledCount: { $sum: { $cond: ['$aiEnabled', 1, 0] } },
        activeRestaurantCount: { $sum: { $cond: ['$isActive', 1, 0] } },
        ownerName: { $first: '$ownerName' },
        ownerEmail: { $first: '$ownerEmail' },
      },
    },
    { $sort: { restaurantCount: -1 } },
    { $limit: 50 },
  ]);

  const owners = [];
  for (const row of ownerRows) {
    const ownerId = String(row._id);
    // ownerUserId may be stored as a non-ObjectId string (demo/legacy data, e.g.
    // "owner_c_tzso"). Only ObjectId lookups against AIUsageLog/User when the id is
    // valid — never let a bad cast 500 the report.
    const idValid = mongoose.Types.ObjectId.isValid(ownerId);
    const [aiStats, openTickets, subs, userDoc] = await Promise.all([
      idValid
        ? AIUsageLog.aggregate([
            { $match: { ownerId: new mongoose.Types.ObjectId(ownerId), success: true, createdAt: { $gte: window.from, $lte: window.to } } },
            { $group: { _id: null, cost: { $sum: '$cost' }, count: { $sum: 1 } } },
          ])
        : Promise.resolve([]),
      SupportTicket.countDocuments({ isDeleted: { $ne: true }, status: { $in: ['new', 'open', 'in_progress', 'pending', 'reopened'] }, restaurantId: { $ne: null } }),
      Subscription.countDocuments({ restaurantId: { $ne: null } }),
      idValid ? User.findById(row._id).select('name email lastLogin').lean() : Promise.resolve(null),
    ]);
    owners.push({
      ownerId,
      ownerName: row.ownerName || (userDoc as any)?.name || ownerId,
      ownerEmail: row.ownerEmail || (userDoc as any)?.email,
      restaurantCount: row.restaurantCount,
      aiEnabledCount: row.aiEnabledCount,
      activeRestaurantCount: row.activeRestaurantCount,
      aiCost: Number((aiStats[0]?.cost ?? 0).toFixed(2)),
      aiRequests: aiStats[0]?.count ?? 0,
      openTickets,
      subscriptionCount: subs,
      lastLogin: (userDoc as any)?.lastLogin ?? null,
    });
  }

  const ownersWithRestaurants = ownerRows.length;
  const activeOwners = owners.filter((o) => o.activeRestaurantCount > 0).length;

  return {
    summary: {
      totalOwners,
      ownersWithRestaurants,
      activeOwners,
      avgRestaurantsPerOwner: ownersWithRestaurants
        ? Number((owners.reduce((s, o) => s + o.restaurantCount, 0) / ownersWithRestaurants).toFixed(2))
        : 0,
    },
    owners,
  };
}
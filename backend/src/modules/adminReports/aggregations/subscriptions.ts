/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * subscriptions.ts — Subscription intelligence (Phase 2.10, reports/subscriptions).
 *
 * Fixes the pre-existing churn bug: legacy code filtered status by
 * `['cancelled','expired']` but the Subscription enum is `trial|active|grace|suspended`
 * (see PHASE-2.10-ADMIN-REPORTS-AUDIT.md §churn). We now derive churn from the
 * `SubscriptionHistory` event stream (actions cancelled/expired/suspended) and
 * fall back to structurally-correct counts for fresh installs.
 *
 * Provides: MRR by plan, plan distribution, upgrade/downgrade velocity,
 * renewal counts, churn rate and the life-cycle event feed.
 */

import mongoose from 'mongoose';
import { Subscription, SubscriptionPlan, Restaurant } from '../../../models';
import { SubscriptionHistory, ISubscriptionHistory } from '../models';
import {
  buildWindow,
  previousWindow,
  pctChange,
  safeStep,
  DateWindow,
} from '../reportQueryBuilder';

export interface SubscriptionReport {
  summary: {
    totalSubscriptions: number;
    activeCount: number;
    trialCount: number;
    graceCount: number;
    suspendedCount: number;
    churnedCount: number;
    prevChurnedCount: number;
    churnRate: number;
    churnGrowthPct: number;
    renewalCount: number;
    upgradeCount: number;
    downgradeCount: number;
    mrr: number;
    arr: number;
  };
  planDistribution: Array<{ plan: string; planName?: string; count: number; price: number; mrr: number }>;
  statusDistribution: Array<{ status: string; count: number }>;
  lifecycleEvents: Array<Record<string, any>>;
  recentEvents: Array<Record<string, any>>;
}

interface EventCounts {
  churned: number;
  prevChurned: number;
  renewals: number;
  upgrades: number;
  downgrades: number;
}

export async function recordSubscriptionHistory(input: {
  restaurantId: string | mongoose.Types.ObjectId;
  subscriptionId?: string | mongoose.Types.ObjectId;
  action: ISubscriptionHistory['action'];
  fromStatus?: string;
  toStatus?: string;
  fromPlanId?: string;
  toPlanId?: string;
  fromPlanName?: string;
  toPlanName?: string;
  amount?: number;
  currency?: string;
  reason?: ISubscriptionHistory['reason'];
  performedBy?: string;
  performedById?: string;
  details?: Record<string, unknown>;
  occurredAt?: Date;
}): Promise<void> {
  try {
    await SubscriptionHistory.create({
      restaurantId: new mongoose.Types.ObjectId(String(input.restaurantId)),
      subscriptionId: input.subscriptionId ? new mongoose.Types.ObjectId(String(input.subscriptionId)) : undefined,
      action: input.action,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      fromPlanId: input.fromPlanId,
      toPlanId: input.toPlanId,
      fromPlanName: input.fromPlanName,
      toPlanName: input.toPlanName,
      amount: input.amount,
      currency: input.currency ?? 'INR',
      reason: input.reason ?? 'manual',
      performedBy: input.performedBy,
      performedById: input.performedById,
      details: input.details,
      occurredAt: input.occurredAt ?? new Date(),
    } as Partial<ISubscriptionHistory>);
  } catch {
    // Non-blocking best-effort.
  }
}

async function eventCounts(window: DateWindow, prev: DateWindow): Promise<EventCounts> {
  const churnedActions = ['cancelled', 'expired', 'suspended'];
  const renewalActions = ['renewed'];
  const upgradeActions = ['upgraded'];
  const downgradeActions = ['downgraded'];

  const count = async (actions: string[], w: DateWindow): Promise<number> => {
    const rows = await SubscriptionHistory.aggregate([
      { $match: { action: { $in: actions }, occurredAt: { $gte: w.from, $lte: w.to } } },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]);
    return rows[0]?.count ?? 0;
  };

  const [churned, prevChurned, renewals, upgrades, downgrades] = await Promise.all([
    count(churnedActions, window),
    count(churnedActions, prev),
    count(renewalActions, window),
    count(upgradeActions, window),
    count(downgradeActions, window),
  ]);

  return { churned, prevChurned, renewals, upgrades, downgrades };
}

/** Correctly-derived churn for fresh installs with no history stream. */
async function fallbackChurn(window: DateWindow): Promise<number> {
  // A subscription is churned when its status is suspended OR (grace and the
  // grace window elapsed). The enum has no cancelled/expired values.
  const suspended = await Subscription.countDocuments({ status: 'suspended' });
  const now = Date.now();
  const grace = await Subscription.countDocuments({ status: 'grace', graceEnd: { $lt: new Date(now) } });
  const windowed = await Subscription.countDocuments({ status: 'suspended', updatedAt: { $gte: window.from, $lte: window.to } });
  return suspended + grace + windowed;
}

export async function getSubscriptionReport(
  options: { period?: string | null; from?: string | null; to?: string | null } = {},
): Promise<SubscriptionReport> {
  const window: DateWindow = buildWindow({ period: options.period, from: options.from, to: options.to });
  const prev = previousWindow(window);

  const [total, activeCount, trialCount, graceCount, suspendedCount, plans, lifecycle, events] = await Promise.all([
    Subscription.countDocuments({}),
    Subscription.countDocuments({ status: 'active' }),
    Subscription.countDocuments({ status: 'trial' }),
    Subscription.countDocuments({ status: 'grace' }),
    Subscription.countDocuments({ status: 'suspended' }),
    SubscriptionPlan.find({}).lean(),
    Subscription.aggregate([
      {
        $group: {
          _id: '$plan',
          count: { $sum: 1 },
          activeInPlan: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          // Active split by billing cadence so MRR can price each bucket
          // correctly (yearly subscriptions are billed at yearlyPrice/12 per
          // month, not the monthly price). Legacy rows without billingPeriod
          // default to monthly.
          activeMonthly: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'active'] },
                    { $ne: [{ $ifNull: ['$billingPeriod', 'monthly'] }, 'yearly'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          activeYearly: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'active'] },
                    { $eq: [{ $ifNull: ['$billingPeriod', 'monthly'] }, 'yearly'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { count: -1 } },
    ]),
    SubscriptionHistory.find({ occurredAt: { $gte: window.from, $lte: window.to } })
      .sort({ occurredAt: -1 })
      .limit(50)
      .lean(),
  ]);

  const counts = await eventCounts(window, prev);
  const fallbackChurned = await fallbackChurn(window);

  const activeSubs = activeCount || 1;
  const churnRate = counts.churned > 0 || counts.prevChurned > 0
    ? Number(((counts.churned / activeSubs) * 100).toFixed(2))
    : Number(((Math.min(fallbackChurned, activeSubs) / activeSubs) * 100).toFixed(2));

  const planById = new Map(plans.map((p: any) => [p.planId, p]));

  const planDistribution = lifecycle.map((l: any) => {
    const planDoc = planById.get(l._id);
    const monthlyPrice = planDoc?.price ?? 0;
    // Monthly-equivalent of a yearly subscriber — the annual price amortized
    // over 12 months. Plans without a yearly price bill yearly subs at the
    // monthly rate.
    const yearlyMonthlyEquiv = planDoc?.yearlyPrice && planDoc.yearlyPrice > 0
      ? planDoc.yearlyPrice / 12
      : monthlyPrice;
    // Older aggregation rows / fresh installs may lack the cadence breakdown —
    // fall back to billing the whole active bucket at the monthly rate.
    const activeMonthly = typeof l.activeMonthly === 'number' ? l.activeMonthly : l.activeInPlan;
    const activeYearly = typeof l.activeYearly === 'number' ? l.activeYearly : 0;
    return {
      plan: l._id,
      planName: planDoc?.name ?? l._id,
      count: l.count,
      price: monthlyPrice,
      mrr: round2(monthlyPrice * activeMonthly + yearlyMonthlyEquiv * activeYearly),
    };
  });

  const mrr = planDistribution.reduce((s, p) => s + p.mrr, 0);
  const fallbackMrr = await subscriptionMrrFromPayments(window);

  return {
    summary: {
      totalSubscriptions: total,
      activeCount,
      trialCount,
      graceCount,
      suspendedCount,
      churnedCount: counts.churned || Math.min(fallbackChurned, activeSubs),
      prevChurnedCount: counts.prevChurned,
      churnRate,
      churnGrowthPct: pctChange(counts.churned, counts.prevChurned),
      renewalCount: counts.renewals,
      upgradeCount: counts.upgrades,
      downgradeCount: counts.downgrades,
      mrr: round2(mrr || fallbackMrr),
      arr: round2((mrr || fallbackMrr) * 12),
    },
    planDistribution,
    statusDistribution: [
      { status: 'trial', count: trialCount },
      { status: 'active', count: activeCount },
      { status: 'grace', count: graceCount },
      { status: 'suspended', count: suspendedCount },
    ],
    lifecycleEvents: events.map((e: any) => ({
      id: e._id,
      restaurantId: e.restaurantId,
      action: e.action,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      fromPlanName: e.fromPlanName,
      toPlanName: e.toPlanName,
      amount: e.amount,
      occurredAt: e.occurredAt,
    })),
    recentEvents: events.slice(0, 15).map((e: any) => ({
      id: e._id,
      restaurantId: e.restaurantId,
      action: e.action,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      fromPlanName: e.fromPlanName,
      toPlanName: e.toPlanName,
      amount: e.amount,
      occurredAt: e.occurredAt,
    })),
  };
}

/** MRR fallback from recent successful payments (avg monthly collection).
 * Yearly payments are amortized (amount / 12) so a ₹4999 annual payment
 * contributes its monthly-equivalent, not its full face value. */
async function subscriptionMrrFromPayments(window: DateWindow): Promise<number> {
  try {
    const { default: Payment } = await import('../../../models/Payment');
    const rows = await Payment.aggregate([
      { $match: { status: 'success', createdAt: { $gte: window.from, $lte: window.to } } },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [
                { $eq: [{ $ifNull: ['$billingPeriod', 'monthly'] }, 'yearly'] },
                { $divide: ['$amount', 12] },
                '$amount',
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);
    const total = rows[0]?.total ?? 0;
    const count = Math.max(1, rows[0]?.count ?? 1);
    return total / count;
  } catch {
    return 0;
  }
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

// Used by controllers to build the "lifecycle" audience pivot per restaurant.
export async function getRestaurantSubscriptionLifecycle(
  restaurantId: string,
): Promise<Array<Record<string, any>>> {
  const rows = await SubscriptionHistory.find({ restaurantId })
    .sort({ occurredAt: 1 })
    .lean();
  return rows.map((e: any) => ({
    id: e._id,
    action: e.action,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    fromPlanName: e.fromPlanName,
    toPlanName: e.toPlanName,
    amount: e.amount,
    occurredAt: e.occurredAt,
    performedBy: e.performedBy,
  }));
}
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * subscriptions.test.ts — Subscription intelligence + the churn-bug fix.
 *
 * Regression target (PHASE-2.10-ADMIN-REPORTS-AUDIT.md §churn): legacy code
 * queried `status: { $in: ['cancelled','expired'] }` even though the enum is
 * `trial|active|grace|suspended`. We verify the report derives churn from the
 * SubscriptionHistory event stream and never relies on the bogus statuses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createFn, countDocumentsFn, aggregateFn, findFn } = vi.hoisted(() => ({
  createFn: vi.fn(),
  countDocumentsFn: vi.fn(),
  aggregateFn: vi.fn(),
  findFn: vi.fn(),
}));

vi.mock('../../../models', () => {
  const Subscription: Record<string, any> = vi.fn();
  Subscription.countDocuments = countDocumentsFn;
  Subscription.aggregate = aggregateFn;
  const SubscriptionPlan: Record<string, any> = vi.fn();
  SubscriptionPlan.find = vi.fn(() => ({ lean: () => Promise.resolve([]) }));
  const Restaurant: Record<string, any> = vi.fn();
  return { Subscription, SubscriptionPlan, Restaurant };
});

vi.mock('../models', () => {
  const SubscriptionHistory: Record<string, any> = vi.fn();
  SubscriptionHistory.create = createFn;
  SubscriptionHistory.aggregate = aggregateFn;
  SubscriptionHistory.find = findFn;
  return { SubscriptionHistory };
});

import { recordSubscriptionHistory, getSubscriptionReport } from '../aggregations/subscriptions';

describe('recordSubscriptionHistory', () => {
  beforeEach(() => { createFn.mockReset(); });

  it('writes a history event with an ObjectId restaurantId', async () => {
    createFn.mockResolvedValue({});
    await recordSubscriptionHistory({
      restaurantId: '507f1f77bcf86cd799439011',
      action: 'upgraded',
      toPlanId: 'premium',
    });
    expect(createFn).toHaveBeenCalledTimes(1);
    const args = createFn.mock.calls[0][0];
    expect(args.action).toBe('upgraded');
    expect(String(args.restaurantId)).toBe('507f1f77bcf86cd799439011');
  });

  it('never throws when the write fails', async () => {
    createFn.mockRejectedValue(new Error('boom'));
    await expect(recordSubscriptionHistory({ restaurantId: '507f1f77bcf86cd799439011', action: 'renewed' })).resolves.toBeUndefined();
  });
});

describe('getSubscriptionReport churn logic', () => {
  beforeEach(async () => {
    countDocumentsFn.mockReset();
    aggregateFn.mockReset();
    findFn.mockReset();
    const { SubscriptionPlan } = await import('../../../models');
    (SubscriptionPlan.find as any).mockImplementation(() => ({ lean: () => Promise.resolve([]) }));
  });

  it('derives churn from history events (correct enum, no cancelled/expired query)', async () => {
    countDocumentsFn.mockResolvedValue(100); // total subscriptions
    countDocumentsFn.mockResolvedValueOnce(100);
    countDocumentsFn.mockResolvedValueOnce(70); // active
    countDocumentsFn.mockResolvedValueOnce(20); // trial
    countDocumentsFn.mockResolvedValueOnce(5); // grace
    countDocumentsFn.mockResolvedValueOnce(5); // suspended

    aggregateFn.mockImplementation((pipeline: any[]) => {
      const match = pipeline[0]?.$match ?? {};
      // lifecycle plan distribution
      if (match.action === undefined && pipeline[0]?.$group?._id === '$plan') {
        return Promise.resolve([
          { _id: 'professional', count: 50, activeInPlan: 40 },
          { _id: 'premium', count: 30, activeInPlan: 25 },
        ]);
      }
      // event counts
      if (match.action) {
        const actions = match.action.$in ?? [];
        if (actions.includes('cancelled')) {
          // churned events in current window
          return Promise.resolve([{ _id: null, count: 4 }]);
        }
        if (actions.includes('renewed')) return Promise.resolve([{ _id: null, count: 3 }]);
        if (actions.includes('upgraded')) return Promise.resolve([{ _id: null, count: 2 }]);
        if (actions.includes('downgraded')) return Promise.resolve([{ _id: null, count: 1 }]);
      }
      return Promise.resolve([]);
    });

    findFn.mockReturnValue({
      sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }),
    });

    const report = await getSubscriptionReport({ period: '30d' });
    expect(report.summary.churnedCount).toBe(4);
    expect(report.summary.renewalCount).toBe(3);
    expect(report.summary.upgradeCount).toBe(2);
    expect(report.summary.downgradeCount).toBe(1);
    // churn rate = churned / active
    expect(report.summary.churnRate).toBeCloseTo((4 / 70) * 100, 1);
    expect(report.planDistribution.length).toBe(2);
  });

  it('annualizes yearly subscriptions in MRR using yearly price / 12', async () => {
    countDocumentsFn.mockResolvedValue(100); // total (base for extra calls)
    countDocumentsFn.mockResolvedValueOnce(100); // total
    countDocumentsFn.mockResolvedValueOnce(70); // active
    countDocumentsFn.mockResolvedValueOnce(20); // trial
    countDocumentsFn.mockResolvedValueOnce(5); // grace
    countDocumentsFn.mockResolvedValueOnce(5); // suspended

    const { SubscriptionPlan } = await import('../../../models');
    (SubscriptionPlan.find as any).mockReturnValue({
      lean: () => Promise.resolve([
        { planId: 'professional', name: 'Professional', price: 1000, yearlyPrice: 10000 },
        { planId: 'premium', name: 'Premium', price: 2000, yearlyPrice: 0 },
      ]),
    });

    aggregateFn.mockImplementation((pipeline: any[]) => {
      const match = pipeline[0]?.$match ?? {};
      if (match.action === undefined && pipeline[0]?.$group?._id === '$plan') {
        return Promise.resolve([
          { _id: 'professional', count: 12, activeInPlan: 12, activeMonthly: 9, activeYearly: 3 },
          { _id: 'premium', count: 6, activeInPlan: 6, activeMonthly: 6, activeYearly: 0 },
        ]);
      }
      return Promise.resolve([]);
    });

    findFn.mockReturnValue({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }) });

    const report = await getSubscriptionReport({ period: '30d' });

    // professional: 9 × 1000 (monthly) + 3 × (10000 / 12) = 9000 + 2500 = 11500
    // premium:      6 × 2000 = 12000 (no yearly price → monthly rate)
    const prof = report.planDistribution.find((p) => p.plan === 'professional');
    const prem = report.planDistribution.find((p) => p.plan === 'premium');
    expect(prof?.mrr).toBeCloseTo(11500, 2);
    expect(prem?.mrr).toBeCloseTo(12000, 2);
    expect(report.summary.mrr).toBeCloseTo(23500, 2);
    expect(report.summary.arr).toBeCloseTo(23500 * 12, 2);
  });

  it('never queries cancelled/expired as Subscription statuses', async () => {
    countDocumentsFn.mockResolvedValue(1);
    aggregateFn.mockImplementation(() => Promise.resolve([]));
    findFn.mockReturnValue({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }) });
    await getSubscriptionReport({ period: '7d' });
    const statusFilters = countDocumentsFn.mock.calls.map((c) => c[0]);
    for (const f of statusFilters) {
      if (f.status) {
        expect(['active', 'trial', 'grace', 'suspended']).toContain(f.status);
      }
    }
  });
});
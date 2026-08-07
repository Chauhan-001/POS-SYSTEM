/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * revenue.test.ts — Revenue ledger + MRR/ARR/forecast tests.
 *
 * The aggregation reads the append-only RevenueEvent ledger when present and
 * falls back to Payment. Both paths are exercised here via mocked models.
 * Aggregate call ordering is deterministic because the queries are evaluated
 * synchronously in a known Promise.all array.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createFn, countDocumentsFn, aggregateFn, findFn } = vi.hoisted(() => ({
  createFn: vi.fn(),
  countDocumentsFn: vi.fn(),
  aggregateFn: vi.fn(),
  findFn: vi.fn(),
}));

vi.mock('../../../models/Payment', () => {
  const Payment: Record<string, any> = vi.fn();
  Payment.aggregate = aggregateFn;
  Payment.find = findFn;
  Payment.countDocuments = countDocumentsFn;
  return { default: Payment };
});

vi.mock('../../../models', () => {
  const Restaurant: Record<string, any> = vi.fn();
  Restaurant.findById = vi.fn();
  return { Restaurant };
});

vi.mock('../models', () => {
  const RevenueEvent: Record<string, any> = vi.fn();
  RevenueEvent.create = createFn;
  RevenueEvent.countDocuments = countDocumentsFn;
  RevenueEvent.aggregate = aggregateFn;
  RevenueEvent.find = findFn;
  const Refund: Record<string, any> = vi.fn();
  Refund.countDocuments = countDocumentsFn;
  return { RevenueEvent, Refund };
});

import { recordRevenueEvent, getRevenueReport } from '../aggregations/revenue';

describe('recordRevenueEvent', () => {
  beforeEach(() => {
    createFn.mockReset();
  });

  it('writes a valid event to the ledger', async () => {
    createFn.mockResolvedValue({});
    await recordRevenueEvent({ type: 'subscription', amount: 499, planId: 'professional' });
    expect(createFn).toHaveBeenCalledTimes(1);
    const args = createFn.mock.calls[0][0];
    expect(args.type).toBe('subscription');
    expect(args.amount).toBe(499);
    expect(args.currency).toBe('INR');
  });

  it('is a no-op for invalid amounts', async () => {
    await recordRevenueEvent({ type: 'subscription', amount: -10 });
    expect(createFn).not.toHaveBeenCalled();
  });

  it('never throws when the ledger write fails', async () => {
    createFn.mockRejectedValue(new Error('db down'));
    await expect(recordRevenueEvent({ type: 'ai', amount: 10 })).resolves.toBeUndefined();
  });
});

const chainFind = () => ({
  sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }),
});

describe('getRevenueReport (ledger path)', () => {
  beforeEach(() => {
    countDocumentsFn.mockReset();
    aggregateFn.mockReset();
    findFn.mockReset();
    countDocumentsFn.mockResolvedValue(1); // has ledger
    findFn.mockImplementation(chainFind);
  });

  it('computes MRR/ARR, refunds and forecast from the ledger', async () => {
    let call = 0;
    aggregateFn.mockImplementation((_pipeline: any[]) => {
      const idx = call++;
      if (idx === 0) return Promise.resolve([{ _id: null, total: 600, count: 2 }]); // summary
      if (idx === 1) return Promise.resolve([{ _id: null, total: 300, count: 1 }]); // prev summary
      if (idx === 2)
        return Promise.resolve([
          { _id: '2026-01', value: 300 },
          { _id: '2026-02', value: 300 },
        ]); // series
      if (idx === 3) return Promise.resolve([{ _id: '2026-01', value: 150 }]); // prev series
      if (idx === 4)
        return Promise.resolve([
          { _id: 'subscription', amount: 600, count: 2 },
          { _id: 'refund', amount: 50, count: 1 },
        ]); // breakdown
      return Promise.resolve([]);
    });

    const report = await getRevenueReport({ period: '90d' });
    expect(report.summary.mrr).toBe(300);
    expect(report.summary.arr).toBe(3600);
    expect(report.summary.totalCollected).toBe(600);
    expect(report.summary.refunded).toBe(50);
    expect(report.summary.prevMrr).toBe(300);
    expect(report.summary.mrrGrowthPct).toBe(0);
    expect(report.series).toHaveLength(2);
    expect(report.breakdown.find((b) => b.type === 'refund')?.amount).toBe(50);
    expect(report.forecast.length).toBeGreaterThanOrEqual(1);
    expect(report.recent).toEqual([]);
  });
});

describe('getRevenueReport (payment fallback)', () => {
  beforeEach(() => {
    countDocumentsFn.mockReset();
    aggregateFn.mockReset();
    findFn.mockReset();
    countDocumentsFn.mockResolvedValue(0); // no ledger yet
    findFn.mockImplementation(chainFind);
  });

  it('falls back to Payment collections when the ledger is empty', async () => {
    let call = 0;
    aggregateFn.mockImplementation((_pipeline: any[]) => {
      const idx = call++;
      if (idx === 0) return Promise.resolve([{ _id: null, total: 1200, count: 4 }]); // summary
      if (idx === 1) return Promise.resolve([]); // prev summary
      if (idx === 2)
        return Promise.resolve([
          { _id: '2026-01', value: 600 },
          { _id: '2026-02', value: 600 },
        ]); // series
      if (idx === 3) return Promise.resolve([]); // prev series
      return Promise.resolve([]);
    });

    const report = await getRevenueReport({ period: '90d' });
    expect(report.summary.totalCollected).toBe(1200);
    expect(report.summary.mrr).toBe(600);
    expect(report.summary.refunded).toBe(0);
    expect(report.breakdown).toEqual([]);
  });
});
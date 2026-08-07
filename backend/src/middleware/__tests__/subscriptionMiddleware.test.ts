/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * subscriptionMiddleware tests — Phase 1.10 validation of the entitlement
 * layer:
 *   - requireSubscription: suspended → 403, active/trial/grace → pass,
 *     no restaurant context (admin/public) → pass, no record → pass.
 *   - requireFeature: trial unlocks everything, plan feature check,
 *     suspended → 403, tenant-scoped lookup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import { requireSubscription, requireFeature } from '../subscriptionMiddleware';

vi.mock('../../models/Subscription', () => {
  const Subscription = { findOne: vi.fn() };
  return { default: Subscription };
});
vi.mock('../../models/SubscriptionPlan', () => {
  const SubscriptionPlan = { findOne: vi.fn() };
  return { default: SubscriptionPlan };
});

import Subscription from '../../models/Subscription';
import SubscriptionPlan from '../../models/SubscriptionPlan';

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockReq(restaurantId?: string): Request {
  return { user: restaurantId ? { restaurantId } : undefined } as unknown as Request;
}

/**
 * Subscription.findOne() returns a chainable QUERY object, not a promise:
 *   const sub = await Subscription.findOne({...}).exec();
 * So the mock must RETURN (not resolve) an object with an .exec() method.
 */
function mockSubFindOne(doc: any) {
  (Subscription.findOne as any).mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce(doc) });
}

function mockSubFindOneRejected(err: Error) {
  (Subscription.findOne as any).mockReturnValueOnce({ exec: vi.fn().mockRejectedValueOnce(err) });
}

function mockSubFindOneNull() {
  (Subscription.findOne as any).mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce(null) });
}

describe('requireSubscription', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes when there is no restaurant context (admin/public route)', async () => {
    const next = vi.fn();
    await requireSubscription(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes when no subscription record exists (first-time setup)', async () => {
    mockSubFindOneNull();
    const next = vi.fn();
    await requireSubscription(mockReq('rest_a'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('blocks suspended subscriptions with 403', async () => {
    mockSubFindOne({ status: 'suspended' });
    const res = mockRes();
    await requireSubscription(mockReq('rest_a'), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect((res.json as any).mock.calls[0][0].code).toBe('SUBSCRIPTION_SUSPENDED');
  });

  it('passes for trial, active, and grace statuses', async () => {
    for (const status of ['trial', 'active', 'grace']) {
      mockSubFindOne({ status });
      const next = vi.fn();
      await requireSubscription(mockReq('rest_a'), mockRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('scopes the subscription lookup to the authenticated restaurant', async () => {
    mockSubFindOne({ status: 'active' });
    await requireSubscription(mockReq('rest_xyz'), mockRes(), vi.fn());
    expect(Subscription.findOne).toHaveBeenCalledWith({ restaurantId: 'rest_xyz' });
  });

  it('fails open on errors (never blocks the restaurant)', async () => {
    mockSubFindOneRejected(new Error('db down'));
    const next = vi.fn();
    await requireSubscription(mockReq('rest_a'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('requireFeature', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes for admins / no restaurant context', async () => {
    const next = vi.fn();
    await requireFeature('inventory')(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes when no subscription record exists (first-time setup)', async () => {
    mockSubFindOneNull();
    const next = vi.fn();
    await requireFeature('inventory')(mockReq('rest_a'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('blocks suspended subscriptions', async () => {
    mockSubFindOne({ status: 'suspended' });
    const res = mockRes();
    await requireFeature('inventory')(mockReq('rest_a'), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('unlocks every feature during trial', async () => {
    mockSubFindOne({ status: 'trial', features: [] });
    const next = vi.fn();
    await requireFeature('ai')(mockReq('rest_a'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('blocks features absent from the current plan', async () => {
    mockSubFindOne({ status: 'active', plan: 'basic', features: ['core_pos'] });
    (SubscriptionPlan.findOne as any).mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce({ name: 'Basic' }) });
    const res = mockRes();
    await requireFeature('inventory')(mockReq('rest_a'), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect((res.json as any).mock.calls[0][0].code).toBe('FEATURE_NOT_IN_PLAN');
  });

  it('passes when the plan includes the feature', async () => {
    mockSubFindOne({ status: 'active', plan: 'professional', features: ['core_pos', 'inventory'] });
    const next = vi.fn();
    await requireFeature('inventory')(mockReq('rest_a'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

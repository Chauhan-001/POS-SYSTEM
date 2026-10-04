/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * memoryLearningService.test.ts — PHASE 8 acceptance:
 * evidence-driven consolidation, thresholds, conflict/supersede, staleness,
 * and lifecycle episodes. Uses an in-memory MongoDB (no real DB writes).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  MIN_PATTERN_SAMPLE,
  MEMORY_INVALIDATE_DAYS,
  consolidateRestaurantMemory,
  isAgingMemory,
  memoryInformsDecision,
  recordRecommendationLifecycleEvent,
} from '../memoryLearningService';
import RestaurantMemoryModel from '../../../models/memory/RestaurantMemory';
import MemoryEpisodeModel from '../../../models/memory/MemoryEpisode';
import CampaignHistory from '../../../models/marketing/CampaignHistory';
import PromotionCandidateModel from '../../../models/marketing/PromotionCandidate';

let mongod: MongoMemoryServer;

const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439022';
const tenantA = { restaurantId: A, actorId: 'actor-a' };
const tenantB = { restaurantId: B, actorId: 'actor-b' };
const NOW = Date.parse('2026-10-04T12:00:00.000Z');

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await RestaurantMemoryModel.deleteMany({});
  await MemoryEpisodeModel.deleteMany({});
  await CampaignHistory.deleteMany({});
  await PromotionCandidateModel.deleteMany({});
});

async function seedCampaign(restaurantId: string, channel: 'whatsapp' | 'sms', recipients: number, redeemed: number, cost = 100) {
  await CampaignHistory.create({
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    channel,
    recipientCount: recipients,
    openedCount: Math.round(recipients * 0.3),
    redeemedCount: redeemed,
    campaignCost: cost,
    status: 'sent' as const,
    sentDate: new Date(NOW).toISOString(),
  });
}

async function seedCandidate(
  restaurantId: string,
  type: 'CREATE_COMBO' | 'PROMOTE_SLOW_ITEM',
  status: 'ACCEPTED' | 'REJECTED',
) {
  await PromotionCandidateModel.create({
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    type,
    priority: 'medium',
    score: 70,
    confidence: 0.7,
    title: `${type} candidate`,
    description: 'd',
    target: { productIds: [], productNames: [], categoryIds: [], segmentIds: [] },
    evidence: [],
    financialModel: {
      currentPrice: 100, proposedPrice: 90, recipeCost: 40, discountPercent: 10, discountAmount: 10,
      currentContribution: 60, projectedContribution: 50, projectedContributionMargin: 50,
      incrementalUnits: 5, incrementalRevenue: 450, incrementalContribution: 50,
      breakEvenIncrementalUnits: 2, paybackPeriodDays: 3, minMarginConstraint: 15, maxDiscountConstraint: 30,
    },
    cannibalization: { estimatedCannibalizationRate: 0.1, incrementalVsCannibalized: 2, confidence: 0.6, evidence: [] },
    risks: [], prerequisites: [],
    constraints: { minMarginPercent: 15, maxDiscountPercent: 30, minSellingPrice: 50, restrictedCategories: [], excludedProductIds: [] },
    status,
    recommendedAction: 'create_offer',
    sourceSignals: [],
    fingerprint: `${type}:${status}:${Math.random()}`,
    instanceCount: 1,
    expiresAt: new Date(NOW + 30 * 24 * 3600 * 1000),
  });
}

describe('1. lifecycle episodes', () => {
  it('records an accepted recommendation as an episode', async () => {
    const res = await recordRecommendationLifecycleEvent({
      tenant: tenantA,
      action: 'accepted',
      recommendationId: 'rec-1',
      strategy: 'CREATE_COMBO',
      title: 'Lunch combo',
    });
    expect(res.recorded).toBe(true);
    const episode = await MemoryEpisodeModel.findById(res.episodeId).lean();
    expect(episode?.episodeType).toBe('campaign_proposed');
    expect(String(episode?.restaurantId)).toBe(A);
    expect(episode?.recommendationRef).toBe('rec-1');
    expect(episode?.source).toBe('service');
  });

  it('records outcome episodes with metrics', async () => {
    const res = await recordRecommendationLifecycleEvent({
      tenant: tenantA,
      action: 'outcome_positive',
      recommendationId: 'rec-2',
      outcome: { status: 'success', summary: 'Redemptions beat baseline', metrics: { redemptionRate: 0.12 } },
    });
    expect(res.recorded).toBe(true);
    const episode = await MemoryEpisodeModel.findById(res.episodeId).lean();
    expect(episode?.episodeType).toBe('experiment_result');
    expect(episode?.outcome?.metrics?.redemptionRate).toBe(0.12);
  });

  it('never throws on invalid input — learning must not break the lifecycle', async () => {
    const res = await recordRecommendationLifecycleEvent({
      tenant: { restaurantId: 'not-an-objectid', actorId: 'x' },
      action: 'recommended',
    });
    expect(res.recorded).toBe(false);
    expect(res.reason).toBeTruthy();
  });

  it('episodes stay tenant-scoped', async () => {
    await recordRecommendationLifecycleEvent({ tenant: tenantA, action: 'recommended', recommendationId: 'rec-a' });
    await recordRecommendationLifecycleEvent({ tenant: tenantB, action: 'recommended', recommendationId: 'rec-b' });
    const episodes = await MemoryEpisodeModel.find({}).lean();
    expect(episodes).toHaveLength(2);
    expect(episodes.map((e) => String(e.restaurantId)).sort()).toEqual([A, B].sort());
  });
});

describe('2. consolidation thresholds', () => {
  it('skips campaigns below the minimum sample size', async () => {
    await seedCampaign(A, 'sms', MIN_PATTERN_SAMPLE - 1, 3);
    const result = await consolidateRestaurantMemory(tenantA, NOW);
    const campaignItem = result.items.find((i) => i.memoryType === 'campaign_performance_pattern');
    expect(campaignItem?.action).toBe('skipped');
    expect(campaignItem?.reason).toContain('minimum');
    expect(result.written).toBe(0);
  });

  it('consolidates a campaign pattern once evidence thresholds are met', async () => {
    await seedCampaign(A, 'whatsapp', 500, 80);
    const result = await consolidateRestaurantMemory(tenantA, NOW);
    const item = result.items.find((i) => i.entityRef === 'channel:whatsapp');
    expect(item?.action).toBe('created');
    const row = await RestaurantMemoryModel.findOne({ memoryType: 'campaign_performance_pattern', entityRef: 'channel:whatsapp' }).lean();
    expect(row?.sampleSize).toBe(500);
    expect((row?.value as Record<string, number>).redemptionRate).toBeCloseTo(0.16, 2);
    expect(row?.source).toBe('service'); // arithmetic, never LLM interpretation
  });

  it('one observation never becomes a long-term memory', async () => {
    await seedCandidate(A, 'CREATE_COMBO', 'REJECTED');
    const result = await consolidateRestaurantMemory(tenantA, NOW);
    const strategyItem = result.items.find((i) => i.memoryType === 'audience_response_pattern');
    expect(strategyItem?.action).toBe('skipped');
  });

  it('aggregates owner approvals across many recommendations', async () => {
    for (let i = 0; i < 3; i++) await seedCandidate(A, 'CREATE_COMBO', 'ACCEPTED');
    for (let i = 0; i < 3; i++) await seedCandidate(A, 'PROMOTE_SLOW_ITEM', 'REJECTED');
    const result = await consolidateRestaurantMemory(tenantA, NOW);
    const combo = result.items.find((i) => i.entityRef === 'strategy:CREATE_COMBO');
    expect(combo?.action).toBe('created');
    expect((combo?.value as Record<string, number>).acceptRate).toBe(1);

    // 3 rejections is at the threshold AND ≥60% of observations → pattern recorded.
    const fatigue = result.items.find((i) => i.memoryType === 'promotion_fatigue_pattern' && i.entityRef === 'strategy:PROMOTE_SLOW_ITEM');
    expect(fatigue?.action).toBe('created');
    expect((fatigue?.value as Record<string, number>).rejectionRate).toBe(1);
  });

  it('writes nothing when there is no lifecycle data at all', async () => {
    const result = await consolidateRestaurantMemory(tenantA, NOW);
    expect(result.written).toBe(0);
    expect(result.items.every((i) => i.action === 'skipped')).toBe(true);
    expect(await RestaurantMemoryModel.countDocuments({})).toBe(0);
  });
});

describe('3. tenant isolation in consolidation', () => {
  it('never consolidates another tenant’s data', async () => {
    await seedCampaign(A, 'sms', 500, 100);
    await consolidateRestaurantMemory(tenantB, NOW);
    expect(await RestaurantMemoryModel.countDocuments({ restaurantId: new mongoose.Types.ObjectId(B) })).toBe(0);
    // And A's data was not touched by B's pass.
    expect(await RestaurantMemoryModel.countDocuments({ restaurantId: new mongoose.Types.ObjectId(A) })).toBe(0);
  });
});

describe('4. conflict and staleness handling', () => {
  it('does not downgrade an existing stronger memory', async () => {
    await seedCampaign(A, 'sms', 1_000, 100);
    const first = await consolidateRestaurantMemory(tenantA, NOW);
    expect(first.written).toBeGreaterThan(0);
    const row1 = await RestaurantMemoryModel.findOne({ entityRef: 'channel:sms' }).lean();

    // A weaker observation arrives (same factory → but with fewer recipients).
    await CampaignHistory.deleteMany({});
    await seedCampaign(A, 'sms', 60, 6);
    const second = await consolidateRestaurantMemory(tenantA, NOW + 1000);
    const item = second.items.find((i) => i.entityRef === 'channel:sms');
    expect(item?.action).toBe('skipped');
    expect(item?.reason).toContain('stronger');
    const row2 = await RestaurantMemoryModel.findOne({ entityRef: 'channel:sms' }).lean();
    expect(row2?.sampleSize).toBe(row1?.sampleSize); // unchanged
  });

  it('supersedes a contradicted memory and writes the replacement', async () => {
    await seedCampaign(A, 'sms', 200, 50);
    await consolidateRestaurantMemory(tenantA, NOW);
    const before = await RestaurantMemoryModel.findOne({ entityRef: 'channel:sms' }).lean();
    expect((before?.value as Record<string, number>).redemptionRate).toBeCloseTo(0.25, 2);

    // Contradicting evidence: still-strong sample, but negative/unusual primary
    // direction is simulated by a very different rate — the guard compares sign.
    await RestaurantMemoryModel.updateOne(
      { _id: (before as unknown as { _id: unknown })?._id },
      { $set: { value: { redemptionRate: -0.1, recipients: 200 } } },
    );
    await CampaignHistory.deleteMany({});
    await seedCampaign(A, 'sms', 300, 60); // positive 0.2 with a larger sample
    const result = await consolidateRestaurantMemory(tenantA, NOW + 1000);
    const item = result.items.find((i) => i.entityRef === 'channel:sms');
    expect(item?.action).toBe('superseded');
    // Phase 2's unique key keeps ONE row per (tenant, branch, type, subject);
    // the contradicted value is preserved in metadata rather than a second row.
    const rows = await RestaurantMemoryModel.find({ entityRef: 'channel:sms' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('active');
    expect((rows[0].value as Record<string, number>).redemptionRate).toBeCloseTo(0.2, 2);
    const meta = rows[0].metadata as Record<string, unknown>;
    expect(meta.supersededAt).toBeTruthy();
    expect((meta.supersededValue as Record<string, number>).redemptionRate).toBe(-0.1);
  });

  it('invalidates aging memories that no fresh evidence re-validates', async () => {
    // A memory exists from long ago and NO lifecycle data supports it now, so
    // nothing refreshes it — it must be invalidated, never silently kept.
    await RestaurantMemoryModel.create({
      restaurantId: new mongoose.Types.ObjectId(A),
      branchId: null,
      memoryType: 'campaign_performance_pattern',
      entityRef: 'channel:sms',
      value: { redemptionRate: 0.2 },
      confidence: 0.8,
      sampleSize: 500,
      evidence: [{ kind: 'campaign', ref: 'channel:sms:history' }],
      source: 'service',
      status: 'active',
      tags: ['campaign'],
      lastValidatedAt: new Date(NOW - (MEMORY_INVALIDATE_DAYS + 10) * 24 * 3600 * 1000),
      expiresAt: null,
    });
    const result = await consolidateRestaurantMemory(tenantA, NOW);
    expect(result.invalidated).toBeGreaterThan(0);
    const rows = await RestaurantMemoryModel.find({}).lean();
    expect(rows.some((r) => r.status === 'invalidated')).toBe(true);
  });

  it('does NOT invalidate a memory that fresh evidence re-validates', async () => {
    await RestaurantMemoryModel.create({
      restaurantId: new mongoose.Types.ObjectId(A),
      branchId: null,
      memoryType: 'campaign_performance_pattern',
      entityRef: 'channel:sms',
      value: { redemptionRate: 0.2 },
      confidence: 0.8,
      sampleSize: 500,
      evidence: [{ kind: 'campaign', ref: 'channel:sms:history' }],
      source: 'service',
      status: 'active',
      tags: ['campaign'],
      lastValidatedAt: new Date(NOW - (MEMORY_INVALIDATE_DAYS + 10) * 24 * 3600 * 1000),
      expiresAt: null,
    });
    // Fresh evidence for the same pattern exists → consolidation refreshes it.
    await seedCampaign(A, 'sms', 500, 100);
    const result = await consolidateRestaurantMemory(tenantA, NOW);
    const row = await RestaurantMemoryModel.findOne({ entityRef: 'channel:sms' }).lean();
    expect(row?.status).toBe('active');
    const last = Date.parse(String(row?.lastValidatedAt));
    expect(last).toBeGreaterThanOrEqual(NOW - 1000);
    expect(result.written).toBeGreaterThan(0);
  });

  it('aging memory stops informing decisions until re-validated', () => {
    const fresh = {
      confidence: 0.8,
      sampleSize: 100,
      status: 'active' as const,
      lastValidatedAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    };
    expect(memoryInformsDecision(fresh, NOW)).toBe(true);
    expect(isAgingMemory(fresh, NOW)).toBe(false);

    const aging = { ...fresh, lastValidatedAt: new Date(NOW - 100 * 24 * 3600 * 1000).toISOString() };
    expect(isAgingMemory(aging, NOW)).toBe(true);
    expect(memoryInformsDecision(aging, NOW)).toBe(false);

    const invalidated = { ...fresh, status: 'invalidated' as const };
    expect(memoryInformsDecision(invalidated, NOW)).toBe(false);

    const weak = { ...fresh, confidence: 0.3 };
    expect(memoryInformsDecision(weak, NOW)).toBe(false);

    const tinySample = { ...fresh, sampleSize: 1 };
    expect(memoryInformsDecision(tinySample, NOW)).toBe(false);
  });
});

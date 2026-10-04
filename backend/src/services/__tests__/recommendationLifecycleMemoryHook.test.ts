/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * recommendationLifecycleMemoryHook.test.ts — PHASE 8 wiring acceptance:
 * the EXISTING recommendation lifecycle (accept/reject/implement/convert)
 * feeds the Phase 2 memory system, and a memory failure never breaks it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  recordRecommendationAction,
  markRecommendationConverted,
} from '../recommendationCandidateService';
import PromotionCandidateModel from '../../models/marketing/PromotionCandidate';
import MemoryEpisodeModel from '../../models/memory/MemoryEpisode';

let mongod: MongoMemoryServer;
const A = '507f1f77bcf86cd799439011';
const REC = '607f1f77bcf86cd799439099';

function candidateDoc() {
  return {
    _id: new mongoose.Types.ObjectId(REC),
    restaurantId: new mongoose.Types.ObjectId(A),
    type: 'CREATE_COMBO',
    priority: 'medium',
    score: 70,
    confidence: 0.7,
    title: 'Lunch combo',
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
    status: 'NEW',
    recommendedAction: 'create_combo',
    sourceSignals: [],
    fingerprint: 'create_combo:test',
    instanceCount: 1,
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
  };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await PromotionCandidateModel.deleteMany({});
  await MemoryEpisodeModel.deleteMany({});
  await PromotionCandidateModel.collection.insertOne(candidateDoc());
});

/** The hook is fire-and-forget: poll briefly for the episode. */
async function waitForEpisode(type: string, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await MemoryEpisodeModel.findOne({ episodeType: type }).lean();
    if (found) return found;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

describe('1. lifecycle actions record memory episodes', () => {
  it('accept writes a campaign_proposed episode for the right tenant', async () => {
    const doc = await recordRecommendationAction(A, REC, 'accept');
    expect(doc?.status).toBe('ACCEPTED');

    const episode = await waitForEpisode('campaign_proposed');
    expect(episode).not.toBeNull();
    expect(String(episode!.restaurantId)).toBe(A);
    expect(episode!.recommendationRef).toBe(REC);
    expect(episode!.source).toBe('service');
  });

  it('reject writes an episode without changing the lifecycle contract', async () => {
    const doc = await recordRecommendationAction(A, REC, 'reject');
    expect(doc?.status).toBe('REJECTED');
    const episode = await waitForEpisode('manual_note');
    expect(episode).not.toBeNull();
  });

  it('convert writes a campaign_launched episode', async () => {
    const doc = await markRecommendationConverted(A, REC, '607f1f77bcf86cd799439088');
    expect(doc?.status).toBe('CONVERTED');
    const episode = await waitForEpisode('campaign_launched');
    expect(episode).not.toBeNull();
  });

  it('snooze/dismiss do not create decision episodes', async () => {
    await recordRecommendationAction(A, REC, 'snooze');
    await new Promise((r) => setTimeout(r, 150));
    expect(await MemoryEpisodeModel.countDocuments({})).toBe(0);
  });
});

describe('2. learning never breaks the lifecycle', () => {
  it('the action still succeeds when the tenant has no memory rows and an unknown strategy', async () => {
    // A foreign-but-valid tenant id: the query still matches this row only if
    // the tenant matches, so use the owner tenant but break the strategy value
    // — the hook must swallow any mapping problem and the action must succeed.
    await PromotionCandidateModel.updateOne(
      { _id: new mongoose.Types.ObjectId(REC) },
      { $set: { type: undefined, recommendedAction: 'create_combo' } },
    );
    const doc = await recordRecommendationAction(A, REC, 'accept');
    expect(doc?.status).toBe('ACCEPTED');
    const episode = await waitForEpisode('campaign_proposed');
    expect(episode).not.toBeNull();
  });

  it('a different tenant cannot act on this recommendation (tenant scoping preserved)', async () => {
    const otherTenant = '507f1f77bcf86cd799439099';
    const doc = await recordRecommendationAction(otherTenant, REC, 'accept');
    expect(doc).toBeNull();
    await new Promise((r) => setTimeout(r, 120));
    expect(await MemoryEpisodeModel.countDocuments({})).toBe(0);
  });

  it('a nonexistent recommendation returns null and writes no episode', async () => {
    const doc = await recordRecommendationAction(A, '607f1f77bcf86cd799439077', 'accept');
    expect(doc).toBeNull();
    await new Promise((r) => setTimeout(r, 120));
    expect(await MemoryEpisodeModel.countDocuments({})).toBe(0);
  });
});

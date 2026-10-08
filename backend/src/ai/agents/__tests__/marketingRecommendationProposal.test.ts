/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingRecommendationProposal.test.ts — PHASE D acceptance:
 * the owner-selected ranked recommendation is the ONE decision that becomes the
 * proposal. The proposal records the exact recommendation id + snapshot, is
 * tenant-scoped, and never regenerates a different decision.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { createProposalFromRankedRecommendation } from '../marketingAgentProposal';
import CampaignProposal from '../../../models/marketing/CampaignProposal';

let mongod: MongoMemoryServer;
const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439022';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(async () => {
  await CampaignProposal.deleteMany({});
});

describe('createProposalFromRankedRecommendation', () => {
  it('references the exact selected recommendation and never regenerates one', async () => {
    const outcome = await createProposalFromRankedRecommendation(
      A,
      {
        id: 'rec_12345',
        type: 'CREATE_PROMOTION',
        title: 'Daily Revenue Demand Recovery',
        recommendedAction: 'create_offer',
        confidence: 0.7,
        economics: { discountPercent: 0, projectedContributionMargin: 0, economicallySafe: false, available: false },
        target: { segmentIds: ['seg_1'], productIds: ['p1'] },
        provenance: { signalCodes: ['sales_revenue_level'], mlKinds: ['segment'], memoryRefs: [] },
        why: ['Scored 70/100 by the existing candidate engine.'],
      },
      { operator: 'owner-1' },
    );

    expect(outcome.created).toBe(true);
    const proposal = await CampaignProposal.findById(outcome.proposalId).lean();
    expect(proposal).toBeTruthy();
    expect(proposal!.source).toBe('recommendation');
    expect(proposal!.sourceRecommendationId).toBe('rec_12345');
    expect((proposal!.sourceRecommendation as any)?.type).toBe('CREATE_PROMOTION');
    // Tenant isolation: the proposal belongs to A only.
    expect(String(proposal!.restaurantId)).toBe(A);

    // No fabricated economics: unavailable stays unavailable.
    expect((proposal as any).sourceRecommendation.economics.available).toBe(false);
  });

  it('carries the engine audience through instead of inventing phones', async () => {
    const outcome = await createProposalFromRankedRecommendation(A, {
      id: 'rec_2',
      type: 'RUN_REACTIVATION',
      title: 'Win-back',
      target: { segmentIds: ['seg_a', 'seg_b'] },
    });
    expect(outcome.created).toBe(true);
    expect(outcome.audience.phones).toEqual([]);
    expect(outcome.audience.isEmpty).toBe(false); // segments exist
  });

  it('rejects an incomplete recommendation with a deterministic reason', async () => {
    const outcome = await createProposalFromRankedRecommendation(A, { id: '', type: '', title: '' } as any);
    expect(outcome.created).toBe(false);
    expect(outcome.skipReason).toContain('required');
  });

  it('does not leak tenant A proposals into tenant B queries', async () => {
    await createProposalFromRankedRecommendation(A, { id: 'rec_a', type: 'CREATE_COMBO', title: 'A combo' });
    const bProposals = await CampaignProposal.find({ restaurantId: new mongoose.Types.ObjectId(B) }).lean();
    expect(bProposals).toEqual([]);
  });
});

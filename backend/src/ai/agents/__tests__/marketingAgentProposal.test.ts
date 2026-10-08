/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgentProposal.test.ts — the recommendation → proposal LIFECYCLE.
 *
 * The removed deterministic marketing agent can no longer reach /proposal, so
 * only a ranked INTELLIGENCE recommendation becomes a CampaignProposal. What
 * must keep holding:
 *   - a draft is created with `approvalStatus: 'pending'` (approval mandatory);
 *   - submit → approve works, reject records owner feedback;
 *   - scheduling is refused while the audience/offer is not ready;
 *   - tenant isolation is enforced by every lifecycle call.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ai } from '../../index';
import { createProposalFromRankedRecommendation } from '../marketingAgentProposal';
import { submitProposal, approveProposal, rejectProposal, scheduleProposal } from '../../services/proposalLifecycle';
import Customer from '../../../models/customers/Customer';
import CampaignProposal from '../../../models/marketing/CampaignProposal';
import Offer from '../../../models/marketing/Offer';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ai.bootstrap();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await CampaignProposal.deleteMany({});
  await Offer.deleteMany({ restaurantId: { $in: [R1, R2] } });
  await Customer.deleteMany({ restaurantId: { $in: [R1, R2] } });
});

/** A ranked recommendation as the owner selects it in /intelligence. */
function rankedRec(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'CREATE_PROMOTION',
    title: 'Weekend demand push',
    description: 'Weekend demand is below its usual level.',
    recommendedAction: 'create_offer',
    strategyLabel: 'Discount',
    engineScore: 72,
    confidence: 0.7,
    priority: 'high',
    economics: { discountPercent: 10, projectedContributionMargin: 22, economicallySafe: true, available: true },
    target: { segmentIds: ['seg_weekend'], productIds: [] },
    provenance: { signalCodes: ['sales_revenue_level'], signalThemes: [], mlKinds: [], memoryRefs: [] },
    why: ['Scored 72/100 by the existing candidate engine.'],
    ...overrides,
  } as any;
}

describe('recommendation → proposal lifecycle', () => {
  it('submit → approve works for a ready ranked proposal', async () => {
    const offer = await Offer.create({
      restaurantId: R1,
      title: 'Test Offer',
      description: 'Test offer description',
      type: 'percentage',
      value: 10,
      status: 'active',
    } as any);
    const customer = await Customer.create({ restaurantId: R1, phone: '9000000003', name: 'E' } as any);

    const outcome = await createProposalFromRankedRecommendation(R1, rankedRec('rec_life_1'), { operator: 'test' });
    expect(outcome.created).toBe(true);
    expect(outcome.proposal!.approvalStatus).toBe('pending');
    expect(outcome.proposal!.sourceRecommendationId).toBe('rec_life_1');

    // The owner supplies the offer + a reachable audience before submitting.
    await CampaignProposal.updateOne(
      { _id: outcome.proposalId },
      {
        $set: {
          offerId: offer._id,
          'audience.customerPhones': [customer.phone],
          'audience.segmentNames': ['seg_weekend'],
          // The owner resolves the audience before submitting, which is what
          // makes expected reach real (never fabricated by the mapper).
          'expectedImpact.expectedReach': 1,
        },
      },
    );

    const submitted = await submitProposal(R1, String(outcome.proposalId), { operator: 't' });
    expect(submitted.validation.valid).toBe(true);
    expect(submitted.proposal.approvalStatus).toBe('ready_for_approval');

    const approved = await approveProposal(R1, String(outcome.proposalId), { operator: 't' });
    expect(approved.proposal.approvalStatus).toBe('approved');
  });

  it('reject records owner feedback', async () => {
    const outcome = await createProposalFromRankedRecommendation(R1, rankedRec('rec_life_2'), { operator: 'test' });
    const rejected = await rejectProposal(
      R1,
      String(outcome.proposalId),
      { rating: 'negative', categories: ['too_expensive'], comment: 'too rich' },
      { operator: 't' },
    );
    expect(rejected.proposal.approvalStatus).toBe('rejected');
    expect(rejected.proposal.ownerFeedback?.rating).toBe('negative');
  });

  it('scheduling is refused while the audience is empty', async () => {
    const outcome = await createProposalFromRankedRecommendation(
      R1,
      rankedRec('rec_life_3', { target: { segmentIds: [] } }),
      { operator: 'test' },
    );
    expect(outcome.created).toBe(true);
    expect(outcome.audience.isEmpty).toBe(true);
    expect(outcome.readiness.blockers).toContain('AUDIENCE_EMPTY');
    await CampaignProposal.updateOne({ _id: outcome.proposalId }, { $set: { approvalStatus: 'approved' } });
    await expect(scheduleProposal(R1, String(outcome.proposalId), {}, { operator: 't' })).rejects.toThrow(/audience|offer/i);
  });

  it('tenant isolation: R1 proposals are invisible to R2 lifecycle calls', async () => {
    const outcome = await createProposalFromRankedRecommendation(R1, rankedRec('rec_life_4'), { operator: 'test' });
    await expect(submitProposal(R2, String(outcome.proposalId))).rejects.toThrow(/not found for this restaurant/i);
    const bProposals = await CampaignProposal.find({ restaurantId: new mongoose.Types.ObjectId(R2) }).lean();
    expect(bProposals).toEqual([]);
  });
});

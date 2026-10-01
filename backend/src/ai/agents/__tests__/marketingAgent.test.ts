/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgent.test.ts — Step 8 acceptance: the agent walks the targeting
 * honesty ladder (uplift gate → segments → none), never fabricates scores,
 * returns drafts only, and stays tenant-isolated.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ai } from '../../index';
import { runMarketingAgent } from '../marketingAgent';
import OfferExperimentEvent from '../../../models/intelligence/OfferExperimentEvent';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';
const tenantR1 = { restaurantId: R1, actorId: 'actor-1' };
const tenantR2 = { restaurantId: R2, actorId: 'actor-2' };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ai.bootstrap();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('runMarketingAgent honesty ladder', () => {
  it('returns NONE with next actions when there is no ML signal at all', async () => {
    const result = await runMarketingAgent({ tenant: tenantR1 });
    expect(result.targetingSource).toBe('NONE');
    expect(result.targets).toHaveLength(0);
    expect(result.offerDraft).toBeNull();
    expect(result.nextActions.length).toBeGreaterThan(0);
    expect(result.targetingScope).toMatch(/no ML signal/i);
  });

  it('falls back to ML_SEGMENTS when the uplift gate fails, with the gate reasons surfaced', async () => {
    // A thin experiment ledger → uplift gate fails; segmentation predictions exist.
    await OfferExperimentEvent.create({
      restaurantId: R1,
      customerId: 'cust-1',
      eventType: 'assigned',
      treatment: 1,
      purchase: 0,
    } as any);
    const { default: MLPrediction } = await import('../../../models/intelligence/MLPrediction');
    await MLPrediction.create({
      restaurantId: R1,
      modelName: 'segment',
      modelVersion: 'seg-v1',
      predictionType: 'customer_segment',
      entityId: 'c1',
      predictionFor: '-',
      generatedAt: new Date(),
      prediction: { segment: 'Champions', method: 'kmeans', isTrained: true, recencyDays: 5, frequency: 8, monetary: 2500 },
      source: 'segment_model',
    } as any);

    const result = await runMarketingAgent({ tenant: tenantR1 }, { minimumExperimentSize: 100 });
    expect(result.targetingSource).toBe('ML_SEGMENTS');
    expect(result.targetingReason).toMatch(/gate not passed/i);
    expect(result.targetingScope).toMatch(/descriptive/i);
    expect(result.targets[0]).toMatchObject({ refType: 'segment', label: 'Champions', score: null });
    // Segment fallback never invents per-customer scores.
    expect(result.targets.every((t: { score: number | null }) => t.score === null)).toBe(true);
  });

  it('is tenant isolated: R2 sees NONE even though R1 has segments', async () => {
    const result = await runMarketingAgent({ tenant: tenantR2 });
    expect(result.targetingSource).toBe('NONE');
  });
});

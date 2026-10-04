/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgentResponseRung.test.ts — the RESPONSE_MODEL rung of the
 * targeting honesty ladder (Step 8 batch per-customer scoring):
 *
 *   - uplift gate fails + trained offer-response model + candidates
 *     ⇒ RESPONSE_MODEL with per-customer probabilities (non-causal scope),
 *       ranked best-first, with the pre-treatment features actually batched
 *       from Mongo (leakage-guarded feature mapping);
 *   - model NOT trained ⇒ falls to ML_SEGMENTS with BOTH rung reasons
 *     surfaced (uplift gate + offer-response gate) — never silent;
 *   - tenant without a trained model / candidates ⇒ NONE or ML_SEGMENTS,
 *     never another tenant's signal;
 *   - service not configured ⇒ honest fallthrough, no network call.
 *
 * The offer-response client is mocked (per-tenant trained state); Mongo is a
 * real MongoMemoryServer so the candidate query + batch feature snapshot are
 * exercised end to end.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ai } from '../../index';
import { runMarketingAgent } from '../marketingAgent';
import Customer from '../../../models/customers/Customer';
import MLPrediction from '../../../models/intelligence/MLPrediction';
import OfferExperimentEvent from '../../../models/intelligence/OfferExperimentEvent';
import {
  getOfferResponseClientConfig,
  fetchOfferResponseStatus,
  fetchOfferResponseBatchScore,
} from '../../../modules/ml-pipeline/offerResponseClient';

vi.mock('../../../modules/ml-pipeline/offerResponseClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../modules/ml-pipeline/offerResponseClient')>();
  return {
    ...actual,
    getOfferResponseClientConfig: vi.fn(),
    fetchOfferResponseStatus: vi.fn(),
    fetchOfferResponseBatchScore: vi.fn(),
  };
});

const mockConfig = vi.mocked(getOfferResponseClientConfig);
const mockStatus = vi.mocked(fetchOfferResponseStatus);
const mockBatch = vi.mocked(fetchOfferResponseBatchScore);

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';
const tenantR1 = { restaurantId: R1, actorId: 'actor-1' };
const tenantR2 = { restaurantId: R2, actorId: 'actor-2' };

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** A recent customer with a full pre-treatment feature profile. */
async function seedCustomer(restaurantId: string, phone: string, lastVisit: Date | null, visits = 12) {
  return Customer.create({
    restaurantId,
    phone,
    name: `Cust ${phone}`,
    lastVisit,
    visits,
    totalSpend: visits * 900,
    averageSpend: 450,
    totalOrders: visits,
    marketingOptIn: true,
    favoriteCategories: ['Indian'],
    favoriteItems: ['Paneer Tikka'],
  } as any);
}

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
  vi.clearAllMocks();
  await Promise.all([
    Customer.deleteMany({}),
    MLPrediction.deleteMany({}),
    OfferExperimentEvent.deleteMany({}),
  ]);

  // Configured for every test unless a test overrides it.
  mockConfig.mockReturnValue({ baseUrl: 'http://uplift.test', serviceToken: 'st', timeoutMs: 500 });

  // Per-tenant trained state: only R1 has a trained offer-response model.
  mockStatus.mockImplementation(async (restaurantId: string) =>
    restaurantId === R1
      ? {
          model: 'offer_response',
          restaurant_id: R1,
          is_trained: true,
          model_version: '2026-10-02T00:00:00Z',
          scope: 'response (non-causal)',
          metadata: { trained_at: '2026-10-02T00:00:00Z', trained_rows: 260, trained_conversions: 130, response_rate_baseline: 0.3 },
          gate: { ready: true, reasons: [] },
        }
      : {
          model: 'offer_response',
          restaurant_id: restaurantId,
          is_trained: false,
          model_version: null,
          scope: 'response (non-causal)',
          gate: { ready: false, reasons: ['treated rows 30 < 100 minimum', 'conversions 4 < 20 minimum'] },
        },
  );

  // Scores align 1:1 with the submitted order: first customer scores highest.
  mockBatch.mockImplementation(async (restaurantId: string, customers: Array<Record<string, unknown>>) => ({
    scores: customers.map((_, i) => ({ p_response: Number((0.9 - i * 0.1).toFixed(2)) })),
    is_trained: restaurantId === R1,
    model_version: restaurantId === R1 ? '2026-10-02T00:00:00Z' : null,
    reason: restaurantId === R1 ? null : 'insufficient_data',
    data: { trained_rows: 260, trained_conversions: 130, response_rate_baseline: 0.3, requested: customers.length },
    model: 'offer_response',
    scope: 'response (non-causal) — for causal targeting use /api/customers uplift ranking',
  }));
});

describe('marketing agent — RESPONSE_MODEL rung', () => {
  it('uses the trained offer-response model when the uplift gate fails: ranked per-customer scores', async () => {
    const recent = await seedCustomer(R1, '9888000001', daysAgo(2), 14);
    const lapsed = await seedCustomer(R1, '9888000002', daysAgo(10), 3);
    await seedCustomer(R1, '9888000003', null, 0); // no visit history → never a candidate
    // One prior assignment → previous_offer_count must appear in the snapshot.
    await OfferExperimentEvent.create({
      restaurantId: R1,
      customerId: String(recent._id),
      eventType: 'assigned',
      treatment: 1,
      purchase: 0,
    } as any);

    const result = await runMarketingAgent({ tenant: tenantR1 }, { minimumExperimentSize: 100 });

    expect(result.targetingSource).toBe('RESPONSE_MODEL');
    expect(result.targetingScope).toMatch(/non-causal/i);
    // The reason names the rung above it AND the batch counts.
    expect(result.targetingReason).toMatch(/Uplift gate not passed/i);
    expect(result.targetingReason).toMatch(/p\(redeem \| offer\)/);
    expect(result.targetingReason).toMatch(/2 of 2 recent customers/);

    // Ranked best-first, customer-level refs with real probabilities.
    expect(result.targets).toHaveLength(2);
    expect(result.targets.every((t) => t.refType === 'customer')).toBe(true);
    expect(result.targets[0]).toMatchObject({ refId: String(recent._id), score: 0.9 });
    expect(result.targets[1]).toMatchObject({ refId: String(lapsed._id), score: 0.8 });

    // The features sent for scoring are the leakage-guarded batch snapshots.
    expect(mockBatch).toHaveBeenCalledTimes(1);
    const [batchRestaurantId, batchCustomers] = mockBatch.mock.calls[0];
    expect(batchRestaurantId).toBe(R1);
    expect(batchCustomers).toHaveLength(2); // null-lastVisit customer excluded
    const first = batchCustomers[0] as Record<string, unknown>;
    expect(first.days_since_last_visit).toBe(2); // recency sort: most recent first
    expect(first.visits_90d).toBe(14);
    expect(first.total_spend).toBe(14 * 900);
    expect(first.average_order_value).toBe(450);
    expect(first.opted_in).toBe(1);
    expect(first.favorite_category).toBe('Indian');
    expect(first.previous_offer_count).toBe(1); // batched ledger count

    // Honest ladder messaging: the owner is told how to move UP the ladder.
    expect(result.nextActions.join(' ')).toMatch(/causal/i);
  });

  it('falls to ML_SEGMENTS when the model is NOT trained, with BOTH rung reasons surfaced', async () => {
    // This tenant's ledger cannot support a response model.
    mockStatus.mockResolvedValue({
      model: 'offer_response',
      restaurant_id: R1,
      is_trained: false,
      model_version: null,
      scope: 'response (non-causal)',
      gate: { ready: false, reasons: ['treated rows 30 < 100 minimum', 'conversions 4 < 20 minimum'] },
    });
    await seedCustomer(R1, '9888000011', daysAgo(3), 8);
    const c = await seedCustomer(R1, '9888000012', daysAgo(6), 5);
    await MLPrediction.create({
      restaurantId: R1,
      modelName: 'segment',
      modelVersion: 'seg-v1',
      predictionType: 'customer_segment',
      entityId: String(c._id),
      predictionFor: '-',
      generatedAt: new Date(),
      prediction: { segment: 'Champions', method: 'kmeans', isTrained: true, recencyDays: 5, frequency: 8, monetary: 2500 },
      source: 'segment_model',
    } as any);

    const result = await runMarketingAgent({ tenant: tenantR1 }, { minimumExperimentSize: 100 });

    expect(result.targetingSource).toBe('ML_SEGMENTS');
    // Rung above: uplift gate. Rung skipped: offer-response gate — named.
    expect(result.targetingReason).toMatch(/Uplift gate not passed/i);
    expect(result.targetingReason).toMatch(/Offer-response rung unavailable/i);
    expect(result.targetingReason).toMatch(/treated rows 30 < 100 minimum/);
    expect(result.targets[0]).toMatchObject({ refType: 'segment', label: 'Champions', score: null });
    // Scoring was attempted (pool existed) but the status gate refused.
    expect(mockBatch).not.toHaveBeenCalled();
  });

  it('falls through honestly when the service is not configured (no network attempt)', async () => {
    await seedCustomer(R1, '9888000021', daysAgo(4), 6);
    const c = await seedCustomer(R1, '9888000022', daysAgo(9), 4);
    await MLPrediction.create({
      restaurantId: R1,
      modelName: 'segment',
      modelVersion: 'seg-v1',
      predictionType: 'customer_segment',
      entityId: String(c._id),
      predictionFor: '-',
      generatedAt: new Date(),
      prediction: { segment: 'Loyal', method: 'kmeans', isTrained: true },
      source: 'segment_model',
    } as any);
    mockConfig.mockReturnValue(null);

    const result = await runMarketingAgent({ tenant: tenantR1 }, { minimumExperimentSize: 100 });

    expect(result.targetingSource).toBe('ML_SEGMENTS');
    expect(result.targetingReason).toMatch(/not configured/i);
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockBatch).not.toHaveBeenCalled();
  });

  it('tenant isolation: R2 (no trained model, no segments) gets NONE — never R1 signal', async () => {
    // R1 has both segments and a trained model; R2 only has a candidate pool.
    await seedCustomer(R1, '9888000031', daysAgo(1), 20);
    await MLPrediction.create({
      restaurantId: R1,
      modelName: 'segment',
      modelVersion: 'seg-v1',
      predictionType: 'customer_segment',
      entityId: '507f1f77bcf86cd799439011',
      predictionFor: '-',
      generatedAt: new Date(),
      prediction: { segment: 'Champions', method: 'kmeans', isTrained: true },
      source: 'segment_model',
    } as any);
    await seedCustomer(R2, '9777000001', daysAgo(2), 9);

    const result = await runMarketingAgent({ tenant: tenantR2 }, { minimumExperimentSize: 100 });

    expect(result.targetingSource).toBe('NONE');
    expect(result.targets).toHaveLength(0);
    expect(result.targetingReason).toMatch(/no response-model batch scoring/i);
    // The batch endpoint was never asked to score for R2 (status gate refused first).
    expect(mockBatch).not.toHaveBeenCalled();
  });
});

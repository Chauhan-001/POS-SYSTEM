/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the customer segmentation bridge (4th model):
 *   - extractor: RFM derivation, honest skips, tenant isolation
 *   - segmentSyncService: ml_predictions store/read round-trip
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Customer from '../../../models/customers/Customer';
import MLPrediction from '../../../models/intelligence/MLPrediction';
import { extractCustomersForSegmentation } from '../customerSegmentExtractor';
import { storeSegments, getStoredSegments } from '../segmentSyncService';

let mongod: MongoMemoryServer;
const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Customer.deleteMany({}).exec(),
    MLPrediction.deleteMany({}).exec(),
  ]);
});

describe('customerSegmentExtractor', () => {
  it('derives RFM from real Customer fields and skips unusable rows honestly', async () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
    await Customer.create([
      { restaurantId: REST_A, phone: '+911111111101', name: 'Recent Big Spender', lastVisit: daysAgo(3), visits: 12, totalSpend: 25000, favoriteCategories: ['Biryani'] },
      { restaurantId: REST_A, phone: '+911111111102', name: 'Dormant', lastVisit: daysAgo(180), visits: 4, totalSpend: 3000 },
      { restaurantId: REST_A, phone: '+911111111103', name: 'No Visits', lastVisit: null, visits: 0, totalSpend: 0 },
      { restaurantId: REST_A, phone: '+911111111104', name: 'LastVisit But Zero Activity', lastVisit: daysAgo(1), visits: 0, totalSpend: 0 },
    ]);

    const { rows, stats } = await extractCustomersForSegmentation(REST_A);
    expect(stats.totalCustomers).toBe(4);
    expect(stats.extracted).toBe(2);
    expect(stats.skippedNoLastVisit).toBe(1);
    expect(stats.skippedZeroActivity).toBe(1);

    const recent = rows.find((r) => r.frequency === 12)!;
    expect(recent.monetary).toBe(25000);
    expect(recent.recency_days).toBe(3);
    expect(recent.favorite_category).toBe('Biryani');

    const dormant = rows.find((r) => r.frequency === 4)!;
    expect(dormant.recency_days).toBe(180);
  });

  it('never leaks tenant B customers', async () => {
    await Customer.create([
      { restaurantId: REST_B, phone: '+912222222201', name: 'Foreign', lastVisit: new Date(), visits: 5, totalSpend: 900 },
      { restaurantId: REST_A, phone: '+912222222202', name: 'Local', lastVisit: new Date(), visits: 2, totalSpend: 400 },
    ]);
    const { rows } = await extractCustomersForSegmentation(REST_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].monetary).toBe(400);
  });
});

describe('segmentSyncService storage', () => {
  it('stores trained and rule-tier rows with honest provenance, read back tenant-scoped', async () => {
    await storeSegments(REST_A, {
      restaurant_id: REST_A,
      is_trained: true,
      model_version: 'seg_v123',
      feature_version: 'rfm-v1',
      customers: [
        { customer_id: 'C1', segment: 'Champions', is_trained: true, method: 'kmeans_rfm', recency_days: 3, frequency: 12, monetary: 25000 },
        { customer_id: 'C2', segment: 'New', is_trained: false, method: 'rule_based_tier', recency_days: 1, frequency: 1, monetary: 500 },
      ],
    });

    const rows = await getStoredSegments(REST_A);
    expect(rows).toHaveLength(2);
    const champ = rows.find((r) => r.entityId === 'C1')!;
    expect(champ.segment).toBe('Champions');
    expect(champ.isTrained).toBe(true);
    expect(champ.modelVersion).toBe('seg_v123');
    const rule = rows.find((r) => r.entityId === 'C2')!;
    expect(rule.isTrained).toBe(false);

    // Tenant B sees nothing of A's segments.
    const rowsB = await getStoredSegments(REST_B);
    expect(rowsB).toHaveLength(0);

    // Segment filter works.
    const champsOnly = await getStoredSegments(REST_A, { segment: 'Champions' });
    expect(champsOnly.map((r) => r.entityId)).toEqual(['C1']);
  });
});

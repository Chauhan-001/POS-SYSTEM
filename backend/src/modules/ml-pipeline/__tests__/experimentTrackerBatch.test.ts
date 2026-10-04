/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * experimentTrackerBatch.test.ts — snapshotPreTreatmentFeaturesBatch:
 *   - one batch call produces the SAME features as the per-customer builder
 *     (shared field mapping ⇒ the leakage guard cannot drift);
 *   - both identifier forms work (ObjectId + phone), unknown ids are absent
 *     from the map (never fabricated), prior assignment counts are batched;
 *   - empty input short-circuits.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  snapshotPreTreatmentFeatures,
  snapshotPreTreatmentFeaturesBatch,
} from '../experimentTracker';
import Customer from '../../../models/customers/Customer';
import OfferExperimentEvent from '../../../models/intelligence/OfferExperimentEvent';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';
const LAST_VISIT = new Date(Date.now() - 3 * 86_400_000);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('snapshotPreTreatmentFeaturesBatch', () => {
  it('matches the per-customer builder exactly and handles both id forms', async () => {
    const full = await Customer.create({
      restaurantId: R1,
      phone: '9811112222',
      name: 'Full',
      lastVisit: LAST_VISIT,
      visits: 14,
      totalSpend: 12600,
      averageSpend: 450,
      totalOrders: 9,
      marketingOptIn: true,
      favoriteCategories: ['Indian', 'Chinese'],
      favoriteItems: ['Paneer Tikka'],
    } as any);
    const sparse = await Customer.create({
      restaurantId: R1,
      phone: '9811113333',
      name: 'Sparse',
      lastVisit: LAST_VISIT,
    } as any);
    await Customer.create({
      restaurantId: R2,
      phone: '9811112222', // same phone as `full`, different tenant — must not leak
      name: 'Other tenant',
      lastVisit: LAST_VISIT,
      visits: 99,
    } as any);

    // Two prior assignments → previous_offer_count = 2 (batched ledger count).
    // The ledger's unique index is (restaurantId, customerId, offerId,
    // eventType), so two 'assigned' rows need distinct offerIds.
    for (let i = 0; i < 2; i++) {
      await OfferExperimentEvent.create({
        restaurantId: R1,
        customerId: String(full._id),
        offerId: new mongoose.Types.ObjectId(),
        eventType: 'assigned',
        treatment: 1,
        purchase: 0,
      } as any);
    }

    const map = await snapshotPreTreatmentFeaturesBatch(R1, [
      String(full._id),
      '9811113333', // phone form resolves to `sparse`
      'not-a-customer',
    ]);

    expect(map.size).toBe(2);
    expect(map.has('not-a-customer')).toBe(false); // absent, never fabricated

    const batched = map.get(String(full._id))!;
    expect(batched).toEqual({
      days_since_last_visit: 3,
      visits_90d: 14,
      total_spend: 12600,
      average_order_value: 450,
      orders_30d: 9,
      opted_in: 1,
      previous_offer_count: 2,
      favorite_category: 'Indian',
      favorite_item: 'Paneer Tikka',
    });

    // Parity with the single builder — one shared field mapping.
    const single = await snapshotPreTreatmentFeatures(R1, String(full._id));
    expect(single).toEqual(batched);

    const sparseFeatures = map.get('9811113333')!;
    expect(sparseFeatures.days_since_last_visit).toBe(3);
    expect(sparseFeatures.visits_90d).toBe(0); // schema default — honest zero, not invented history
    expect(sparseFeatures.previous_offer_count).toBeUndefined(); // no ledger rows ⇒ omitted
    expect(sparseFeatures.favorite_category).toBeUndefined(); // empty favorites ⇒ omitted
  });

  it('returns an empty map for empty input', async () => {
    const map = await snapshotPreTreatmentFeaturesBatch(R1, []);
    expect(map.size).toBe(0);
  });
});

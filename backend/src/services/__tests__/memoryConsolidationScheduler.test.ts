/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * memoryConsolidationScheduler.test.ts — PHASE C acceptance:
 * memory consolidation is hosted by the EXISTING marketing scheduler (no new
 * scheduler), runs tenant-by-tenant, and writes real RestaurantMemory from
 * real CampaignHistory evidence — with tenant isolation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { shouldRunMemoryConsolidation, consolidateAllRestaurantMemories } from '../marketingScheduler';
import Restaurant from '../../models/core/Restaurant';
import CampaignHistory from '../../models/marketing/CampaignHistory';
import RestaurantMemoryModel from '../../models/memory/RestaurantMemory';

let mongod: MongoMemoryServer;

const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439022';
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
  await Restaurant.deleteMany({});
  await CampaignHistory.deleteMany({});
  await RestaurantMemoryModel.deleteMany({});
});

async function seedRestaurant(id: string, name: string) {
  await Restaurant.create({ restaurantId: name.toUpperCase(), name, phone: '9999999999', isActive: true, _id: new mongoose.Types.ObjectId(id) });
}

async function seedChannel(restaurantId: string, channel: 'whatsapp' | 'sms', recipients: number, redeemed: number) {
  await CampaignHistory.create({
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    channel,
    recipientCount: recipients,
    openedCount: Math.round(recipients * 0.3),
    redeemedCount: redeemed,
    campaignCost: 100,
    status: 'sent',
    sentDate: new Date(NOW).toISOString(),
  });
}

describe('shouldRunMemoryConsolidation (nightly window)', () => {
  const at = (hour: number, minute = 0, day = '2026-08-08') => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, hour, minute, 0, 0);
  };

  it('runs once per day shortly after 05:00 local', () => {
    expect(shouldRunMemoryConsolidation('', at(5, 5))).toBe(true);
  });
  it('does not run before 05:00', () => {
    expect(shouldRunMemoryConsolidation('', at(4, 59))).toBe(false);
  });
  it('does not run twice on the same day', () => {
    expect(shouldRunMemoryConsolidation('2026-08-08', at(23, 0))).toBe(false);
  });
  it('runs again on a new day', () => {
    expect(shouldRunMemoryConsolidation('2026-08-07', at(5, 1, '2026-08-08'))).toBe(true);
  });
});

describe('consolidateAllRestaurantMemories (tenant-batched, isolated)', () => {
  it('writes real RestaurantMemory from real CampaignHistory, scoped per tenant', async () => {
    await seedRestaurant(A, 'tenant-a');
    await seedRestaurant(B, 'tenant-b');
    // A: whatsapp, 200 recipients / 40 redeemed (20%) → confidence 0.7 ≥ 0.55
    await seedChannel(A, 'whatsapp', 200, 40);
    // B: sms, 100 recipients / 10 redeemed (10%) → separate tenant memory
    await seedChannel(B, 'sms', 100, 10);

    const res = await consolidateAllRestaurantMemories(NOW);
    expect(res.tenants).toBeGreaterThanOrEqual(2);
    expect(res.written).toBeGreaterThanOrEqual(1);

    const aRows = await RestaurantMemoryModel.find({ restaurantId: new mongoose.Types.ObjectId(A) }).lean();
    expect(aRows.length).toBeGreaterThanOrEqual(1);
    const wa = aRows.find((r) => r.entityRef === 'channel:whatsapp');
    expect(wa).toBeTruthy();
    expect(wa!.sampleSize).toBe(200);

    // Tenant isolation: B never received A's whatsapp pattern.
    const bRows = await RestaurantMemoryModel.find({ restaurantId: new mongoose.Types.ObjectId(B) }).lean();
    expect(bRows.some((r) => r.entityRef === 'channel:whatsapp')).toBe(false);
  });

  it('never throws and skips tenants with insufficient evidence', async () => {
    await seedRestaurant(A, 'tenant-a');
    await seedChannel(A, 'whatsapp', 5, 1); // below MIN_PATTERN_SAMPLE
    const res = await consolidateAllRestaurantMemories(NOW);
    expect(res.tenants).toBeGreaterThanOrEqual(1);
    expect(res.written).toBe(0);
  });
});

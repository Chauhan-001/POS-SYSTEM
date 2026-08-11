import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Restaurant from '../../../models/Restaurant';
import Reward from '../../../models/Reward';
import Offer from '../../../models/Offer';
import LoyaltyTier from '../../../models/LoyaltyTier';
import LoyaltySettings from '../../../models/LoyaltySettings';
import { publicStoreService } from '../services/publicStoreService';
import { generatePublicToken } from '../../../utils/publicToken';

let mongod: MongoMemoryServer;

describe('PublicStoreService (Phase 62.1)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Restaurant.deleteMany({}).exec(),
      Reward.deleteMany({}).exec(),
      Offer.deleteMany({}).exec(),
      LoyaltyTier.deleteMany({}).exec(),
      LoyaltySettings.deleteMany({}).exec(),
    ]);
  });

  async function seed(overrides: Record<string, any> = {}) {
    const token = generatePublicToken();
    const restaurant = await Restaurant.create({
      restaurantId: 'rest-a',
      name: 'Alpha Kitchen',
      brandName: 'Alpha Kitchen Grill',
      description: 'Test dining',
      phone: '9999999999',
      area: 'Indiranagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      currency: 'INR',
      loyaltyEnabled: true,
      isActive: true,
      publicToken: token,
      ...overrides,
    });

    await LoyaltySettings.create({ restaurantId: restaurant._id, pointsPerCurrency: 1, pointsValueInCurrency: 10 });

    await LoyaltyTier.create({ restaurantId: restaurant._id, name: 'Bronze', priority: 0, isActive: true });
    await LoyaltyTier.create({ restaurantId: restaurant._id, name: 'Gold', minLifetimeSpend: 20000, pointsMultiplier: 1.5, priority: 1, isActive: true });

await Reward.create({
      restaurantId: restaurant._id, title: 'Rs 50 off', pointsRequired: 500, type: 'flat', value: 50, isActive: true,
    });
    // Out of stock - must not appear on the public site.
    await Reward.create({
      restaurantId: restaurant._id, title: 'Free dessert', pointsRequired: 200, type: 'item', value: 0, isActive: true,
      stock: 1, redeemedCount: 1,
    });

    const today = new Date().toISOString().slice(0, 10);
    // Active offer within window (checks the coupon code surfaces on the site).
    await Offer.create({
      restaurantId: restaurant._id, title: 'Weekend Combo', description: 'Combo for the weekend', type: 'percentage', value: 15, status: 'active',
      couponCode: 'WEEN22', startDate: '2000-01-01', endDate: '2099-12-31',
    });
    // Expired offer - excluded.
    await Offer.create({
      restaurantId: restaurant._id, title: 'Old offer', description: 'Old offer', type: 'flat', value: 100, status: 'active',
      couponCode: 'OLD2001', startDate: '2000-01-01', endDate: '2001-01-01',
    });
    // Draft offer - excluded.
    await Offer.create({
      restaurantId: restaurant._id, title: 'Draft', description: 'Draft offer', type: 'percentage', value: 5, status: 'draft',
      couponCode: 'DRAFT22',
    });

    void today;
    return { restaurant, token };
  }

  it('resolves an active store and returns identity, earn rate, tiers, rewards and live offers', async () => {
    const { restaurant, token } = await seed();
    const cfg = await publicStoreService.getSiteConfig(token);

    expect(cfg.store.name).toBe('Alpha Kitchen Grill');
    expect(cfg.store.loyaltyEnabled).toBe(true);
    expect(cfg.store.location).toContain('Bengaluru');

    expect(cfg.loyalty.enabled).toBe(true);
    expect(cfg.loyalty.earnRate).toEqual({ pointsPerCurrency: 1, currencyUnit: 10 });
    expect(cfg.loyalty.tiers.map((t: any) => t.name)).toEqual(['Bronze', 'Gold']);

    void restaurant;
    // Stock-aware: only the in-stock reward is live.
    expect(cfg.rewards).toHaveLength(1);
    expect(cfg.rewards[0].title).toBe('Rs 50 off');

    // Only the in-window active offer survives.
    expect(cfg.offers).toHaveLength(1);
    expect(cfg.offers[0].title).toBe('Weekend Combo');
    expect(cfg.offers[0].couponCode).toBe('WEEN22');
  });

  it('returns 404 for unknown, inactive or deleted restaurants', async () => {
    await expect(publicStoreService.getSiteConfig('pbl_doesNotExist12345'))
      .rejects.toMatchObject({ statusCode: 404 });

    const { restaurant, token } = await seed();
    await Restaurant.updateOne({ _id: restaurant._id }, { $set: { isActive: false } }).exec();
    await expect(publicStoreService.getSiteConfig(token))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('marks the loyalty section disabled for non-loyalty restaurants (still reachable)', async () => {
    const { token } = await seed({ loyaltyEnabled: false });
    const cfg = await publicStoreService.getSiteConfig(token);
    expect(cfg.store.loyaltyEnabled).toBe(false);
    expect(cfg.loyalty.enabled).toBe(false);
  });
});
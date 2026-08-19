/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase C — Promotion Studio lifecycle integration tests with real Mongo
 * (memory server). Covers the acceptance criteria:
 *  1. Promotion references a valid offer of the same restaurant.
 *  2. Cross-tenant offer reference is rejected.
 *  3. Tenant cannot access another restaurant's promotion.
 *  4. Draft is created; draft can be published.
 *  5. Publishing an archived promotion is rejected.
 *  6. Duplicate copies the creative config, keeps the offer, stays a draft.
 *  7. Offer/creative mismatch is detected when the offer changes.
 *  8. Published promotions surface on the public endpoint only while the
 *     linked offer is live; expired offers never surface their creative.
 *  9. Public projection exposes only safe presentation fields.
 * 10. AI copy falls back deterministically (no provider configured) and
 *     never invents financial values.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Restaurant from '../../../models/Restaurant';
import Offer from '../../../models/Offer';
import Product from '../../../models/Product';
import Promotion from '../models/Promotion';
import { promotionsService } from '../services/promotionsService';
import { publicStoreOrderService } from '../../public-store/services/publicStoreOrderService';
import { generatePublicToken } from '../../../utils/publicToken';

let mongod: MongoMemoryServer;

function oid(): mongoose.Types.ObjectId { return new mongoose.Types.ObjectId(); }

async function seedRestaurant(overrides: Record<string, any> = {}) {
  const token = generatePublicToken();
  const restaurant = await Restaurant.create({
    restaurantId: `rest-${oid()}`,
    name: 'Promo Kitchen',
    brandName: 'Promo Kitchen',
    description: 'Test',
    phone: '9999999999',
    area: 'Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    currency: 'INR',
    isActive: true,
    publicToken: token,
    ...overrides,
  });
  return { restaurant, token };
}

async function seedOffer(restaurantId: mongoose.Types.ObjectId, overrides: Record<string, any> = {}) {
  return Offer.create({
    restaurantId,
    title: 'Weekend Burger Treat',
    description: '20% off burgers',
    shortDescription: '20% off all burgers',
    type: 'percentage',
    value: 20,
    minOrderValue: 499,
    status: 'active',
    ...overrides,
  });
}

const actor = { id: 'u1', name: 'Tester', restaurantId: 'r1', ipAddress: '127.0.0.1' };

describe('Phase C — Promotion Studio lifecycle', () => {
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
      Offer.deleteMany({}).exec(),
      Product.deleteMany({}).exec(),
      Promotion.deleteMany({}).exec(),
    ]);
  });

  const baseCreative = {
    title: 'Weekend Burger Treat',
    subtitle: 'On orders above ₹499',
    description: 'Get 20% off burgers this weekend.',
    cta: 'Order Now',
    language: 'en' as const,
    tone: 'friendly',
    templateId: 'hero-banner',
    colors: { background: '#0b2a5b', text: '#ffffff', accent: '#f59e0b' },
    image: null,
    logoKey: null,
    productImageKeys: [],
    layout: 'hero-banner',
  };

  it('1. creates a draft promotion linked to a valid offer', async () => {
    const { restaurant } = await seedRestaurant();
    const offer = await seedOffer(restaurant._id as mongoose.Types.ObjectId);
    const promo = await promotionsService.create(
      String(restaurant._id),
      { offerId: String(offer._id), name: 'Weekend Burger Promo', channels: ['website'], templateId: 'hero-banner', creative: baseCreative },
      actor,
    );
    expect((promo as any).status).toBe('draft');
    expect((promo as any).offerSnapshot.discountDisplay).toBe('20% OFF');
    expect((promo as any).offer).toBeTruthy();
  });

  it('2. rejects a cross-tenant offer reference', async () => {
    const { restaurant } = await seedRestaurant();
    const { restaurant: other } = await seedRestaurant();
    const otherOffer = await seedOffer(other._id as mongoose.Types.ObjectId);
    await expect(
      promotionsService.create(
        String(restaurant._id),
        { offerId: String(otherOffer._id), name: 'Bad', channels: ['website'], templateId: 'hero-banner', creative: baseCreative },
        actor,
      ),
    ).rejects.toThrow('Offer not found for this restaurant');
  });

  it('3. tenant cannot read another restaurant\'s promotion', async () => {
    const { restaurant } = await seedRestaurant();
    const { restaurant: other } = await seedRestaurant();
    const offer = await seedOffer(restaurant._id as mongoose.Types.ObjectId);
    const promo = await promotionsService.create(
      String(restaurant._id),
      { offerId: String(offer._id), name: 'Mine', channels: ['website'], templateId: 'hero-banner', creative: baseCreative },
      actor,
    );
    await expect(promotionsService.get(String(other._id), String((promo as any)._id))).rejects.toThrow('Promotion not found');
  });

  it('4. draft can be published (and re-published idempotently)', async () => {
    const { restaurant } = await seedRestaurant();
    const offer = await seedOffer(restaurant._id as mongoose.Types.ObjectId);
    const promo = await promotionsService.create(
      String(restaurant._id),
      { offerId: String(offer._id), name: 'Live Promo', channels: ['website', 'qr'], templateId: 'hero-banner', creative: baseCreative },
      actor,
    );
    const id = String((promo as any)._id);
    const published = await promotionsService.publish(String(restaurant._id), id, actor);
    expect((published as any).status).toBe('published');
    expect((published as any).publishedAt).toBeTruthy();
    const again = await promotionsService.publish(String(restaurant._id), id, actor);
    expect((again as any).status).toBe('published');
  });

  it('5. publishing is rejected when the linked offer is not live', async () => {
    const { restaurant } = await seedRestaurant();
    const offer = await seedOffer(restaurant._id as mongoose.Types.ObjectId, { status: 'expired' });
    const promo = await promotionsService.create(
      String(restaurant._id),
      { offerId: String(offer._id), name: 'Expired-linked', channels: ['website'], templateId: 'hero-banner', creative: baseCreative },
      actor,
    );
    await expect(promotionsService.publish(String(restaurant._id), String((promo as any)._id), actor))
      .rejects.toThrow(/offer is expired/);
  });

  it('5b. archived promotion cannot be published directly', async () => {
    const { restaurant } = await seedRestaurant();
    const offer = await seedOffer(restaurant._id as mongoose.Types.ObjectId);
    const promo = await promotionsService.create(
      String(restaurant._id),
      { offerId: String(offer._id), name: 'Archived soon', channels: ['website'], templateId: 'hero-banner', creative: baseCreative },
      actor,
    );
    const id = String((promo as any)._id);
    await promotionsService.archive(String(restaurant._id), id, actor);
    await expect(promotionsService.publish(String(restaurant._id), id, actor)).rejects.toThrow(/archived/);
  });

  it('6. duplicate copies creative config, keeps offer, stays draft', async () => {
    const { restaurant } = await seedRestaurant();
    const offer = await seedOffer(restaurant._id as mongoose.Types.ObjectId);
    const promo = await promotionsService.create(
      String(restaurant._id),
      { offerId: String(offer._id), name: 'Original', channels: ['website'], templateId: 'hero-banner', creative: baseCreative },
      actor,
    );
    const copy = await promotionsService.duplicate(String(restaurant._id), String((promo as any)._id), actor);
    expect((copy as any).status).toBe('draft');
    expect((copy as any).name).toContain('Copy');
    expect(String((copy as any).offerId)).toBe(String(offer._id));
    expect((copy as any).creative.title).toBe(baseCreative.title);
    // Financial offer data is untouched — the copy points at the SAME offer.
    expect((copy as any).offerSnapshot.offerId).toBe(String(offer._id));
  });

  it('7. offer/creative mismatch is detected when the offer changes', async () => {
    const { restaurant } = await seedRestaurant();
    const offer = await seedOffer(restaurant._id as mongoose.Types.ObjectId, { value: 20, minOrderValue: 499 });
    const promo = await promotionsService.create(
      String(restaurant._id),
      { offerId: String(offer._id), name: 'Mismatch test', channels: ['website'], templateId: 'hero-banner', creative: baseCreative },
      actor,
    );
    const id = String((promo as any)._id);
    expect((await promotionsService.checkMismatch(String(restaurant._id), id)).mismatched).toBe(false);

    // Owner edits the offer (discount + min order) after the creative was made.
    await Offer.updateOne({ _id: offer._id }, { $set: { value: 50, minOrderValue: 999 } }).exec();
    const check = await promotionsService.checkMismatch(String(restaurant._id), id);
    expect(check.mismatched).toBe(true);
    expect(check.reason).toMatch(/discount|minimum order/);
  });

  it('8/9. public endpoint surfaces only live, safe promotion fields', async () => {
    const { restaurant, token } = await seedRestaurant();
    const offer = await seedOffer(restaurant._id as mongoose.Types.ObjectId, { status: 'active' });
    const promo = await promotionsService.create(
      String(restaurant._id),
      { offerId: String(offer._id), name: 'Public Promo', channels: ['website'], templateId: 'hero-banner', creative: baseCreative },
      actor,
    );
    await promotionsService.publish(String(restaurant._id), String((promo as any)._id), actor);

    const result = await publicStoreOrderService.getPromotions(token);
    expect(result.promotions.length).toBe(1);
    const p = result.promotions[0];
    expect(p.creative.title).toBe('Weekend Burger Treat');
    expect(p.offer.discountDisplay).toBe('20% OFF');
    // Safe projection — no internal fields leak.
    expect((p as any).restaurantId).toBeUndefined();
    expect((p as any).offerSnapshot).toBeUndefined();
    expect((p as any).generatedBy).toBeUndefined();
  });

  it('8b. expired offer never surfaces its published creative', async () => {
    const { restaurant, token } = await seedRestaurant();
    const offer = await seedOffer(restaurant._id as mongoose.Types.ObjectId, { status: 'active', endDate: '2020-01-01' });
    const promo = await promotionsService.create(
      String(restaurant._id),
      { offerId: String(offer._id), name: 'Old Promo', channels: ['website'], templateId: 'hero-banner', creative: baseCreative },
      actor,
    );
    await promotionsService.publish(String(restaurant._id), String((promo as any)._id), actor);
    const result = await publicStoreOrderService.getPromotions(token);
    expect(result.promotions.length).toBe(0);
  });

  it('10. AI copy falls back deterministically and never invents financial values', async () => {
    const { restaurant } = await seedRestaurant();
    const offer = await seedOffer(restaurant._id as mongoose.Types.ObjectId, { value: 20, minOrderValue: 499 });
    const copy = await promotionsService.generateCreativeCopy(String(restaurant._id), {
      offerId: String(offer._id),
      restaurantName: 'Promo Kitchen',
      offerTitle: 'Weekend Burger Treat',
      discountValue: '20% OFF',
      minOrderValue: 499,
      productNames: ['Burger'],
    });
    // AI is unavailable in the test env → deterministic fallback, no crash.
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.cta.length).toBeGreaterThan(0);
    // The fallback derives from authoritative offer data, never invents it.
    expect(copy.title).toContain('20% OFF');
  });
});

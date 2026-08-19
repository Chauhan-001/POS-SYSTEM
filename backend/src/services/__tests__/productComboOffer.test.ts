/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Meal-combo product → backing Offer sync tests.
 *
 * A meal combo is a PRODUCT that bundles other products at a single price.
 * The product is the owner's source of truth; productService auto-syncs a
 * backing Offer (type 'combo', linkedProductId → this product) so the whole
 * existing combo pipeline — billing validation, usage ledger, OfferAnalytics,
 * customer store — works unchanged.
 *
 * Rules enforced server-side (deterministic, never left to the frontend):
 *   - ≥2 components, all existing, same tenant, no nested combos
 *   - comboPrice > 0 and comboPrice < sum of component base prices
 *   - the backing Offer is idempotent (looked up by linkedProductId)
 *   - deleting the product cancels the backing Offer
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Product from '../../models/Product';
import Offer from '../../models/Offer';
import { productService } from '../index';

let mongod: MongoMemoryServer;
const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();

const baseFields = {
  category: 'Main Course',
  gstPercent: 5,
  availability: true,
  currentStock: 10,
  unit: 'serving',
  minStock: 0,
  maxStock: 100,
  reorderLevel: 0,
  averageCost: 20,
  supplier: '',
  storageLocation: '',
  notes: '',
  barcode: '',
  expiryDate: '',
  batchNumber: '',
  voiceAliases: [],
  searchAliases: [],
  learnedAliases: [],
  lastUsedAlias: null,
  aliasUsageCount: 0,
};

async function makeProduct(name: string, price: number, restaurantId = REST_A) {
  return Product.create({
    name,
    code: `PC-${name.toUpperCase().replace(/\s+/g, '')}-${restaurantId.slice(-4)}-${Math.random().toString(36).slice(2, 8)}`,
    price,
    restaurantId,
    ...baseFields,
    isDeleted: false,
    deletedAt: null,
  } as any);
}

async function comboOffer(productId: string) {
  return Offer.findOne({ linkedProductId: String(productId), isDeleted: { $ne: true } }).exec();
}

let comboSeq = 0;
function comboPayload(name: string, price: number, restaurantId: string, comboComponentIds: string[], comboPrice: number) {
  comboSeq += 1;
  return {
    name,
    code: `COMBO-${comboSeq}-${Math.random().toString(36).slice(2, 8)}`,
    price,
    restaurantId,
    isCombo: true,
    comboComponentIds,
    comboPrice,
    ...baseFields,
  };
}

describe('Meal-combo product → backing Offer sync', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Product.deleteMany({});
    await Offer.deleteMany({});
  });

  it('PC-01 — creating a combo product auto-creates one backing Offer', async () => {
    const a = await makeProduct('Paneer Tikka', 220);
    const b = await makeProduct('Masala Chai', 80);

    const created: any = await productService.create(
      comboPayload('Paneer + Chai Combo', 249, REST_A, [String(a._id), String(b._id)], 249),
    );

    expect(created).toBeTruthy();
    const offers = await Offer.find({ linkedProductId: String(created._id), isDeleted: { $ne: true } }).exec();
    expect(offers).toHaveLength(1);

    const offer: any = offers[0];
    expect(offer.type).toBe('combo');
    expect(offer.comboPrice).toBe(249);
    expect(offer.comboProductIds.map(String).sort()).toEqual([String(a._id), String(b._id)].sort());
    expect(offer.restaurantId.toString()).toBe(REST_A);
    expect(offer.title).toBe('Paneer + Chai Combo');
    expect(offer.value).toBe(0); // combo discount is structural, not a value discount

    // Product is linked back to its offer (idempotent).
    const linked = await Product.findById(created._id).exec();
    expect(String((linked as any).linkedComboOfferId)).toBe(String(offer._id));
  });

  it('PC-02 — re-saving a combo product never duplicates the backing Offer', async () => {
    const a = await makeProduct('Burger', 150);
    const b = await makeProduct('Fries', 90);
    const created: any = await productService.create(
      comboPayload('Burger + Fries', 199, REST_A, [String(a._id), String(b._id)], 199),
    );

    // Save again with the same definition (idempotency).
    await productService.update(String(created._id), {
      isCombo: true,
      comboComponentIds: [String(a._id), String(b._id)],
      comboPrice: 199,
    });

    const offers = await Offer.find({ linkedProductId: String(created._id), isDeleted: { $ne: true } }).exec();
    expect(offers).toHaveLength(1);
    expect(offers[0].comboPrice).toBe(199);
  });

  it('PC-03 — updating comboPrice refreshes the backing Offer', async () => {
    const a = await makeProduct('Dosa', 120);
    const b = await makeProduct('Coffee', 60);
    const created: any = await productService.create(
      comboPayload('Dosa + Coffee', 149, REST_A, [String(a._id), String(b._id)], 149),
    );

    await productService.update(String(created._id), { comboPrice: 129, price: 129 });

    const offer: any = await comboOffer(String(created._id));
    expect(offer).toBeTruthy();
    expect(offer.comboPrice).toBe(129);
    expect(offer.title).toBe('Dosa + Coffee');
  });

  it('PC-12 — per-branch combo prices sync onto the backing Offer', async () => {
    const a = await makeProduct('Dosa', 120);
    const b = await makeProduct('Coffee', 60);
    const branchA = new mongoose.Types.ObjectId().toString();
    const branchB = new mongoose.Types.ObjectId().toString();
    const created: any = await productService.create({
      ...comboPayload('Dosa + Coffee', 149, REST_A, [String(a._id), String(b._id)], 149),
      comboBranchPrice: { [branchA]: 139, [branchB]: 159 },
    });

    // Mongoose returns the Map field as a Map on the doc — read either shape.
    const readBranch = (o: any, bid: string) => {
      if (!o || !o.comboBranchPrices) return undefined;
      const m = o.comboBranchPrices;
      return typeof m.get === 'function' ? m.get(bid) : m[bid];
    };

    const offer: any = await comboOffer(String(created._id));
    expect(offer).toBeTruthy();
    expect(offer.comboPrice).toBe(149); // head-office default untouched
    expect(readBranch(offer, branchA)).toBe(139);
    expect(readBranch(offer, branchB)).toBe(159);

    // Updating the product's per-branch prices refreshes the offer (idempotent).
    await productService.update(String(created._id), { comboBranchPrice: { [branchA]: 129 } });
    const refreshed: any = await comboOffer(String(created._id));
    expect(readBranch(refreshed, branchA)).toBe(129);
    expect(readBranch(refreshed, branchB)).toBeUndefined();
  });

  it('PC-13 — a combo\'s sell price is always its comboPrice', async () => {
    const a = await makeProduct('Dosa', 120);
    const b = await makeProduct('Coffee', 60);
    // Deliberately pass a different base price — the server must force it to
    // the combo price so the tile, billing and offer never drift apart.
    const created: any = await productService.create(
      comboPayload('Dosa + Coffee', 999, REST_A, [String(a._id), String(b._id)], 149),
    );
    expect(Number(created.price)).toBe(149);
    expect(Number(created.comboPrice)).toBe(149);

    // Updating only the combo price also re-derives the sell price.
    await productService.update(String(created._id), { comboPrice: 129 });
    const refreshed: any = await productService.getById(String(created._id));
    expect(Number(refreshed.price)).toBe(129);
    expect(Number(refreshed.comboPrice)).toBe(129);
  });

  it('PC-04 — clearing isCombo cancels the backing Offer', async () => {
    const a = await makeProduct('Pizza', 300);
    const b = await makeProduct('Cold Drink', 60);
    const created: any = await productService.create(
      comboPayload('Pizza + Drink', 329, REST_A, [String(a._id), String(b._id)], 329),
    );

    await productService.update(String(created._id), { isCombo: false });

    const active = await comboOffer(String(created._id));
    expect(active).toBeNull();
    const cancelled = await Offer.findOne({ linkedProductId: String(created._id) }).exec();
    expect((cancelled as any).isDeleted).toBe(true);
    expect((cancelled as any).status).toBe('cancelled');
  });

  it('PC-05 — deleting a combo product cancels the backing Offer', async () => {
    const a = await makeProduct('Samosa', 30);
    const b = await makeProduct('Chai', 40);
    const created: any = await productService.create(
      comboPayload('Samosa + Chai', 59, REST_A, [String(a._id), String(b._id)], 59),
    );

    await productService.delete(String(created._id));

    const active = await comboOffer(String(created._id));
    expect(active).toBeNull();
    const cancelled = await Offer.findOne({ linkedProductId: String(created._id) }).exec();
    expect((cancelled as any).isDeleted).toBe(true);
  });

  it('PC-06 — comboPrice not below component total is rejected (400)', async () => {
    const a = await makeProduct('Item A', 100);
    const b = await makeProduct('Item B', 100);
    await expect(
      productService.create(
        comboPayload('Bad Combo', 200, REST_A, [String(a._id), String(b._id)], 200), // = sum, must be strictly less
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('PC-07 — fewer than 2 components is rejected (400)', async () => {
    const a = await makeProduct('Solo Item', 100);
    await expect(
      productService.create(
        comboPayload('Solo Combo', 90, REST_A, [String(a._id)], 90),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('PC-08 — cross-tenant components are rejected (400)', async () => {
    const a = await makeProduct('Tenant B Item', 100, REST_B);
    const b = await makeProduct('Tenant A Item', 80);
    await expect(
      productService.create(
        comboPayload('Cross Tenant Combo', 149, REST_A, [String(a._id), String(b._id)], 149),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('PC-09 — combos cannot contain combos (400)', async () => {
    const a = await makeProduct('Base A', 100);
    const b = await makeProduct('Base B', 80);
    const inner: any = await productService.create(
      comboPayload('Inner Combo', 149, REST_A, [String(a._id), String(b._id)], 149),
    );
    const c = await makeProduct('Extra Item', 50);

    await expect(
      productService.create(
        comboPayload('Nested Combo', 179, REST_A, [String(inner._id), String(c._id)], 179),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('PC-11 — a rejected combo create never leaves an orphan product', async () => {
    const a = await makeProduct('Tenant B Item X', 100, REST_B);
    const b = await makeProduct('Tenant A Item Y', 80);
    await expect(
      productService.create(
        comboPayload('Cross Tenant Combo X', 149, REST_A, [String(a._id), String(b._id)], 149),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    // The product itself must NOT have been persisted (create is atomic).
    const orphan = await Product.findOne({ name: 'Cross Tenant Combo X' }).exec();
    expect(orphan).toBeNull();
    // And no dangling combo offer either.
    const offers = await Offer.find({ title: 'Cross Tenant Combo X' }).exec();
    expect(offers).toHaveLength(0);
  });

  it('PC-10 — tenant B combo never syncs an offer for tenant A', async () => {
    const a = await makeProduct('B Burger', 150, REST_B);
    const b = await makeProduct('B Fries', 90, REST_B);
    const created: any = await productService.create(
      comboPayload('B Combo', 199, REST_B, [String(a._id), String(b._id)], 199),
    );

    const offer: any = await comboOffer(String(created._id));
    expect(offer).toBeTruthy();
    expect(offer.restaurantId.toString()).toBe(REST_B);

    // Nothing under tenant A references tenant B's offer.
    const aOffers = await Offer.find({ restaurantId: REST_A, isDeleted: { $ne: true } }).exec();
    expect(aOffers).toHaveLength(0);
  });
});

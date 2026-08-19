/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P2 — Combo analytics unit tests (COMBO-01 .. COMBO-15).
 *
 * These exercise getComboAnalytics() against mongodb-memory-server with the
 * REAL source records (CouponRedemption + Bill + BillItem + Product/Recipe).
 * The computation is read-only, so "incremental" and "rebuild" are the same
 * computation — idempotency is asserted by running it twice.
 *
 * Financial values are deterministic: recipe costs come from the real
 * recipeCostEngine (single-ingredient recipes → exact numbers), products
 * without recipes fall back to Product.averageCost. No AI anywhere.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Offer from '../../models/Offer';
import CouponRedemption from '../../models/CouponRedemption';
import Bill from '../../models/Bill';
import BillItem from '../../models/BillItem';
import Product from '../../models/Product';
import Recipe from '../../modules/recipes/models/Recipe';
import {
  getComboAnalytics,
  rankCombos,
  classifyCombo,
} from '../offerAnalyticsService';
import { ProvenOfferRecommendationProvider, type RecommendationContext } from '../offerEngine';

let mongod: MongoMemoryServer;
const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();
const BRANCH = new mongoose.Types.ObjectId().toString();

const round2 = (n: number) => Math.round(n * 100) / 100;

async function makeProduct(name: string, price: number, averageCost: number, restaurantId = REST_A) {
  return Product.create({
    name,
    code: `P-${name.toUpperCase().replace(/\s+/g, '')}-${restaurantId.slice(-4)}`,
    price,
    category: 'Main Course',
    gstPercent: 5,
    availability: true,
    restaurantId,
    currentStock: 10,
    unit: 'serving',
    minStock: 0,
    maxStock: 100,
    reorderLevel: 0,
    averageCost,
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
    isDeleted: false,
    deletedAt: null,
  } as any);
}

async function makeIngredient(name: string, averageCost: number, restaurantId = REST_A) {
  return Product.create({
    name,
    code: `ING-${name.toUpperCase().replace(/\s+/g, '')}-${restaurantId.slice(-4)}`,
    price: 0,
    category: 'Inventory',
    gstPercent: 0,
    availability: false,
    restaurantId,
    currentStock: 100,
    unit: 'kg',
    minStock: 0,
    maxStock: 1000,
    reorderLevel: 0,
    averageCost,
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
    isDeleted: false,
    deletedAt: null,
  } as any);
}

/** Single-ingredient recipe → exact deterministic cost = qty × ingredient cost. */
async function makeRecipe(restaurantId: string, product: any, ingredient: any, qty: number) {
  return Recipe.create({
    restaurantId,
    productId: product._id,
    productName: product.name,
    name: product.name,
    status: 'active',
    effectiveFrom: '2020-01-01',
    yieldQuantity: 1,
    yieldUnit: 'serving',
    servingSize: 1,
    components: [
      {
        inventoryItemId: ingredient._id,
        itemName: ingredient.name,
        unit: ingredient.unit,
        quantity: qty,
        componentType: 'ingredient',
        wastagePercent: 0,
        optional: false,
      },
    ],
  } as any);
}

async function makeCombo(restaurantId: string, title: string, comboPrice: number, productIds: any[]) {
  return Offer.create({
    restaurantId,
    title,
    description: title,
    type: 'combo',
    value: comboPrice,
    status: 'active',
    currentUses: 0,
    comboProductIds: productIds.map((p) => String(p._id)),
    comboPrice,
  } as any);
}

let billSeq = 0;
async function makeBill(restaurantId: string, subtotal: number, opts: any = {}) {
  billSeq += 1;
  return Bill.create({
    clientRef: opts.clientRef || `CB-${billSeq}`,
    invoiceNumber: `CB-INV-${billSeq}`,
    ticketNumber: `T-${billSeq}`,
    date: opts.date || '2026-08-01',
    time: '13:00',
    cashierName: 'Tester',
    cashierRole: 'Cashier',
    subtotal,
    discount: opts.discount || 0,
    gst: 0,
    grandTotal: subtotal,
    paymentMethod: 'Cash',
    orderType: 'Dine-in',
    restaurantId,
    branchId: BRANCH,
    isVoided: opts.isVoided || false,
    isRefunded: opts.isRefunded || false,
    refundAmount: opts.refundAmount || 0,
    refundedItems: opts.refundedItems || undefined,
    pointsEarned: 0,
    pointsRedeemed: 0,
    createdAt: opts.createdAt,
  } as any);
}

async function addItem(bill: any, product: any, quantity: number, price: number) {
  return BillItem.create({
    billId: bill._id,
    menuItemId: String(product._id),
    itemName: product.name,
    priceAtSale: price,
    quantity,
    gstRateAtSale: 5,
    discountAtSale: 0,
    isFree: false,
  } as any);
}

async function redeem(restaurantId: string, offer: any, bill: any, discountAmount: number, customerPhone?: string, createdAt?: Date) {
  return CouponRedemption.create({
    restaurantId,
    offerId: offer._id,
    status: 'applied',
    billId: String(bill._id),
    discountAmount,
    customerPhone,
    branchId: BRANCH,
    createdAt,
  } as any);
}

describe('Combo analytics (P2)', () => {
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
      Offer.deleteMany({}).exec(),
      CouponRedemption.deleteMany({}).exec(),
      Bill.deleteMany({}).exec(),
      BillItem.deleteMany({}).exec(),
      Product.deleteMany({}).exec(),
      Recipe.deleteMany({}).exec(),
    ]);
    billSeq = 0;
  });

  // ─── Setup: deterministic components ────────────────────────────────────
  // Paneer Tikka: recipe 0.15 kg paneer @ ₹300/kg → cost ₹45; price ₹249
  // Masala Chai:  recipe 0.12 L milk @ ₹60/L → cost ₹7.2;  price ₹49
  // Veg Burger:   NO recipe → variableCost = averageCost ₹128; price ₹149
  // Cold Drink:   NO recipe → variableCost = averageCost ₹25;  price ₹60
  async function seedProducts() {
    const paneer = await makeIngredient('Paneer', 300);
    const milk = await makeIngredient('Milk', 60);
    const tikka = await makeProduct('Paneer Tikka', 249, 0);
    const chai = await makeProduct('Masala Chai', 49, 0);
    await makeRecipe(REST_A, tikka, paneer, 0.15);
    await makeRecipe(REST_A, chai, milk, 0.12);
    const burger = await makeProduct('Veg Burger', 149, 128);
    const coke = await makeProduct('Cold Drink', 60, 25);
    const comboA = await makeCombo(REST_A, 'Tikka + Chai', 249, [tikka, chai]);
    const comboB = await makeCombo(REST_A, 'Burger + Drink', 179, [burger, coke]);
    return { tikka, chai, burger, coke, comboA, comboB };
  }

  it('COMBO-01: single combo order → 1 unit, exact revenue/discount/contribution', async () => {
    const { tikka, chai, comboA } = await seedProducts();
    const bill = await makeBill(REST_A, 298);
    await addItem(bill, tikka, 1, 249);
    await addItem(bill, chai, 1, 49);
    await redeem(REST_A, comboA, bill, 49, '9822000001');

    const [c] = await getComboAnalytics({ restaurantId: REST_A });
    expect(c.orders).toBe(1);
    expect(c.units).toBe(1);
    expect(c.comboRevenue).toBe(249);            // 1 × comboPrice
    expect(c.listValueAtSale).toBe(298);         // 249 + 49 at sale prices
    expect(c.structuralSavings).toBe(49);
    expect(c.redemptionDiscount).toBe(49);
    expect(c.additionalDiscount).toBe(0);
    expect(c.variableCost).toBe(52.2);           // 45 + 7.2 (recipe costs)
    expect(c.contribution).toBe(196.8);          // 249 − 52.2
    expect(c.contributionMargin).toBe(79.04);    // 196.8 / 249
    expect(c.individualValue).toBe(298);         // counterfactual (current prices)
    expect(c.customerSavings).toBe(49);
    expect(c.individualContribution).toBe(245.8); // (249−45)+(49−7.2)
    expect(c.economicDelta).toBe(49);            // contribution given up by bundling
    expect(c.impressions).toBeNull();
    expect(c.clicks).toBeNull();
    expect(c.conversionRate).toBeNull();
  });

  it('COMBO-02: multiple quantities of the same combo in one bill', async () => {
    const { tikka, chai, comboA } = await seedProducts();
    const bill = await makeBill(REST_A, 596);
    await addItem(bill, tikka, 2, 249);
    await addItem(bill, chai, 2, 49);
    await redeem(REST_A, comboA, bill, 98, '9822000002');

    const [c] = await getComboAnalytics({ restaurantId: REST_A });
    expect(c.units).toBe(2);
    expect(c.comboRevenue).toBe(498);
    expect(c.listValueAtSale).toBe(596);
    expect(c.structuralSavings).toBe(98);
    expect(c.variableCost).toBe(104.4);
    expect(c.contribution).toBe(393.6);
  });

  it('COMBO-03: two different combos in one bill → clean per-combo attribution', async () => {
    const { tikka, chai, burger, coke, comboA, comboB } = await seedProducts();
    const bill = await makeBill(REST_A, 298 + 209);
    await addItem(bill, tikka, 1, 249);
    await addItem(bill, chai, 1, 49);
    await addItem(bill, burger, 1, 149);
    await addItem(bill, coke, 1, 60);
    await redeem(REST_A, comboA, bill, 49, '9822000003');
    await redeem(REST_A, comboB, bill, 30, '9822000003');

    const cs = await getComboAnalytics({ restaurantId: REST_A });
    const a = cs.find((c) => c.offerId === String(comboA._id))!;
    const b = cs.find((c) => c.offerId === String(comboB._id))!;
    expect(a.units).toBe(1);
    expect(a.comboRevenue).toBe(249);
    expect(a.listValueAtSale).toBe(298);
    expect(b.units).toBe(1);
    expect(b.comboRevenue).toBe(179);
    expect(b.listValueAtSale).toBe(209);
    // Whole-bill subtotal context (existing influenced-revenue semantics).
    expect(a.billRevenue).toBe(507);
    expect(b.billRevenue).toBe(507);
    // No cross-contamination of component costs.
    expect(a.variableCost).toBe(52.2);
    expect(b.variableCost).toBe(153);
  });

  it('COMBO-04: combo + individual product in one bill → NO double counting', async () => {
    const { tikka, chai, comboA } = await seedProducts();
    // 1 combo (tikka+chai) + 1 EXTRA tikka sold individually.
    const bill = await makeBill(REST_A, 298 + 249);
    await addItem(bill, tikka, 2, 249);
    await addItem(bill, chai, 1, 49);
    await redeem(REST_A, comboA, bill, 49, '9822000004');

    const [c] = await getComboAnalytics({ restaurantId: REST_A });
    expect(c.units).toBe(1);                    // min(2, 1) — only 1 complete set
    expect(c.comboRevenue).toBe(249);           // NOT 249+220+80 style sums
    expect(c.listValueAtSale).toBe(298);        // extra tikka excluded
    expect(c.structuralSavings).toBe(49);
    // The individual tikka's revenue stays in the bill, not in combo revenue.
    expect(c.billRevenue).toBe(547);
    // Combo-attributed value (list value of the BUNDLED units only) = 298,
    // which is well under the 547 bill subtotal — the extra tikka is NOT
    // counted in combo revenue or combo list value (no double counting).
    expect(c.comboRevenue + c.structuralSavings).toBe(298);
    expect(c.comboRevenue).toBeLessThanOrEqual(c.billRevenue);
  });

  it('COMBO-05: combo + unrelated coupon → structural savings vs additional discount stay separate', async () => {
    const { tikka, chai, comboA } = await seedProducts();
    const bill = await makeBill(REST_A, 298);
    await addItem(bill, tikka, 1, 249);
    await addItem(bill, chai, 1, 49);
    // Ledger records combo discount 49 + stacked coupon 20 = 69.
    await redeem(REST_A, comboA, bill, 69, '9822000005');

    const [c] = await getComboAnalytics({ restaurantId: REST_A });
    expect(c.structuralSavings).toBe(49);       // COMBO_SAVINGS
    expect(c.redemptionDiscount).toBe(69);
    expect(c.additionalDiscount).toBe(20);      // ORDER_LEVEL/COUPON_DISCOUNT
    expect(c.comboRevenue).toBe(249);
  });

  it('COMBO-06: voided bill → combo excluded from active revenue', async () => {
    const { tikka, chai, comboA } = await seedProducts();
    const live = await makeBill(REST_A, 298);
    await addItem(live, tikka, 1, 249);
    await addItem(live, chai, 1, 49);
    await redeem(REST_A, comboA, live, 49, '9822000006');

    const voided = await makeBill(REST_A, 298, { isVoided: true });
    await addItem(voided, tikka, 1, 249);
    await addItem(voided, chai, 1, 49);
    await redeem(REST_A, comboA, voided, 49, '9822000007');

    const [c] = await getComboAnalytics({ restaurantId: REST_A });
    expect(c.orders).toBe(1);   // only the live redemption counted
    expect(c.units).toBe(1);
    expect(c.comboRevenue).toBe(249);
  });

  it('COMBO-07: partial refund → net quantity reflected', async () => {
    const { tikka, chai, comboA } = await seedProducts();
    // 2 complete combos, then 1 tikka refunded → net 1 complete combo.
    const bill = await makeBill(REST_A, 596, {
      isRefunded: true,
      refundAmount: 249,
      refundedItems: [{ menuItemId: String(tikka._id), itemName: 'Paneer Tikka', quantity: 1, amount: 249 }],
    });
    await addItem(bill, tikka, 2, 249);
    await addItem(bill, chai, 2, 49);
    await redeem(REST_A, comboA, bill, 98, '9822000008');

    const [c] = await getComboAnalytics({ restaurantId: REST_A });
    expect(c.units).toBe(1);   // min(2−1, 2) = 1
    expect(c.comboRevenue).toBe(249);
    expect(c.listValueAtSale).toBe(298);
  });

  it('COMBO-08/09: idempotent — repeated calls (incremental vs rebuild) return identical numbers', async () => {
    const { tikka, chai, comboA } = await seedProducts();
    const bill = await makeBill(REST_A, 298);
    await addItem(bill, tikka, 1, 249);
    await addItem(bill, chai, 1, 49);
    await redeem(REST_A, comboA, bill, 49, '9822000009');

    const first = await getComboAnalytics({ restaurantId: REST_A });
    const second = await getComboAnalytics({ restaurantId: REST_A });
    expect(second).toEqual(first);
    expect(first[0].orders).toBe(1);
    // Source records untouched.
    expect(await CouponRedemption.countDocuments({ restaurantId: REST_A })).toBe(1);
  });

  it('COMBO-10: tenant isolation — zero leakage between restaurants', async () => {
    const { tikka, chai, comboA } = await seedProducts();
    // Tenant A has its own combo + redemption.
    const aBill = await makeBill(REST_A, 298);
    await addItem(aBill, tikka, 1, 249);
    await addItem(aBill, chai, 1, 49);
    await redeem(REST_A, comboA, aBill, 49, '9822000400');
    // Tenant B has its own burger combo + redemptions.
    const bBurger = await makeProduct('B Burger', 100, 60, REST_B);
    const bCoke = await makeProduct('B Coke', 40, 15, REST_B);
    const comboB2 = await makeCombo(REST_B, 'B Combo', 99, [bBurger, bCoke]);
    const bBill = await makeBill(REST_B, 140);
    await addItem(bBill, bBurger, 1, 100);
    await addItem(bBill, bCoke, 1, 40);
    await redeem(REST_B, comboB2, bBill, 41, '9822999001');

    const a = await getComboAnalytics({ restaurantId: REST_A });
    const b = await getComboAnalytics({ restaurantId: REST_B });
    expect(a.map((c) => c.offerId)).toEqual([String(comboA._id)]);
    expect(b.map((c) => c.offerId)).toEqual([String(comboB2._id)]);
    expect(a[0].comboRevenue).toBe(249);
    expect(b[0].comboRevenue).toBe(99);
    expect(a[0].components.every((comp) => comp.productName !== 'B Burger' && comp.productName !== 'B Coke')).toBe(true);
  });

  it('COMBO-11/12: rankings — revenue leader can be a margin laggard', async () => {
    const { tikka, chai, burger, coke, comboA, comboB } = await seedProducts();
    // Combo A: 12 units (high performer). Combo B: 20 units (low margin).
    for (let i = 0; i < 12; i++) {
      const bill = await makeBill(REST_A, 298);
      await addItem(bill, tikka, 1, 249);
      await addItem(bill, chai, 1, 49);
      await redeem(REST_A, comboA, bill, 49, `9822000100${i}`);
    }
    for (let i = 0; i < 20; i++) {
      const bill = await makeBill(REST_A, 209);
      await addItem(bill, burger, 1, 149);
      await addItem(bill, coke, 1, 60);
      await redeem(REST_A, comboB, bill, 30, `9822000200${i}`);
    }
    const cs = await getComboAnalytics({ restaurantId: REST_A });
    const a = cs.find((c) => c.offerId === String(comboA._id))!;
    const b = cs.find((c) => c.offerId === String(comboB._id))!;
    expect(a.units).toBe(12);
    expect(b.units).toBe(20);
    expect(a.classification).toContain('HIGH_PERFORMER');
    expect(b.classification).toContain('HIGH_REVENUE_LOW_MARGIN');

    const ranks = rankCombos(cs);
    // Revenue + units leader is Combo B; margin leader is Combo A.
    expect(ranks.topByRevenue[0].offerId).toBe(String(comboB._id));
    expect(ranks.topByUnits[0].offerId).toBe(String(comboB._id));
    expect(ranks.topByMargin[0].offerId).toBe(String(comboA._id));
    expect(ranks.topByContribution[0].offerId).toBe(String(comboA._id));
    // Weakest by margin is Combo B.
    expect(ranks.weakestByMargin[0].offerId).toBe(String(comboB._id));
    // A single ranking would have hidden this split — dimensions differ.
    expect(ranks.topByRevenue[0].offerId).not.toBe(ranks.topByMargin[0].offerId);
  });

  it('COMBO-13: repeat customers → repeat rate from redemption ledger', async () => {
    const { tikka, chai, comboA } = await seedProducts();
    // 8 redemptions across 5 unique customers; 3 of them repeat (2× each) and
    // 2 are single-purchase → unique 5, repeat 3, rate 60%.
    const repeaters = ['9822000301', '9822000302', '9822000303'];
    for (let i = 0; i < 6; i++) {
      const bill = await makeBill(REST_A, 298);
      await addItem(bill, tikka, 1, 249);
      await addItem(bill, chai, 1, 49);
      await redeem(REST_A, comboA, bill, 49, repeaters[i % 3]);
    }
    for (const phone of ['9822000304', '9822000305']) {
      const bill = await makeBill(REST_A, 298);
      await addItem(bill, tikka, 1, 249);
      await addItem(bill, chai, 1, 49);
      await redeem(REST_A, comboA, bill, 49, phone);
    }

    const [c] = await getComboAnalytics({ restaurantId: REST_A });
    expect(c.orders).toBe(8);
    expect(c.uniqueCustomers).toBe(5);
    expect(c.repeatCustomers).toBe(3);
    expect(c.repeatRate).toBe(60);
    expect(c.classification).toContain('STRONG_REPEAT_USAGE');
  });

  it('COMBO-14: weak combo → LOW_PERFORMER + weakest ranking', async () => {
    const { tikka, chai, burger, coke, comboA, comboB } = await seedProducts();
    for (let i = 0; i < 4; i++) {
      const bill = await makeBill(REST_A, 298);
      await addItem(bill, tikka, 1, 249);
      await addItem(bill, chai, 1, 49);
      await redeem(REST_A, comboA, bill, 49, `982200040${i}`);
    }
    const weakBill = await makeBill(REST_A, 209);
    await addItem(weakBill, burger, 1, 149);
    await addItem(weakBill, coke, 1, 60);
    await redeem(REST_A, comboB, weakBill, 30, '9822000409');

    const cs = await getComboAnalytics({ restaurantId: REST_A });
    const a = cs.find((c) => c.offerId === String(comboA._id))!;
    const b = cs.find((c) => c.offerId === String(comboB._id))!;
    expect(a.units).toBe(4);
    expect(b.units).toBe(1);
    expect(b.classification).toContain('LOW_PERFORMER');
    expect(rankCombos(cs).weakestByUnits[0].offerId).toBe(String(comboB._id));
    expect(rankCombos(cs).weakestByMargin[0].offerId).toBe(String(comboB._id));
  });

  it('COMBO-15: analytics-driven combo recommendation — bundle-margin-aware re-run (economic context preserved)', async () => {
    const provider = new ProvenOfferRecommendationProvider();
    const ctx: RecommendationContext = {
      restaurantId: REST_A,
      customerCount: 100,
      activeCustomers: 60,
      newCustomersToday: 3,
      repeatCustomersToday: 5,
      offerPerformance: [
        {
          // STAR performer — healthy deterministic margin → qualifies.
          offerId: String(new mongoose.Types.ObjectId()),
          title: 'Tikka + Chai Combo',
          type: 'combo',
          value: 249,
          redemptions: 50,
          revenueGenerated: 12000,
          discountGiven: 2000,
          averageOrderValue: 240,
          uniqueCustomers: 30,
          comboUnits: 45,
          comboRevenue: 18000,
          comboPrice: 400,
          comboOrders: 40,
          structuralSavings: 3000,
          contributionMargin: 62,
        },
        {
          // HIGH-VOLUME / LOW-MARGIN — lots of units but 9.12% margin.
          // Must NOT be auto-recommended: volume alone is not proof of health.
          offerId: String(new mongoose.Types.ObjectId()),
          title: 'Biryani + Cold Drink Combo',
          type: 'combo',
          value: 199,
          redemptions: 130,
          revenueGenerated: 40000,
          discountGiven: 14000,
          averageOrderValue: 300,
          uniqueCustomers: 90,
          comboUnits: 120,
          comboRevenue: 26000,
          comboPrice: 199,
          comboOrders: 125,
          structuralSavings: 13000,
          contributionMargin: 9.12,
        },
        {
          // No deterministic margin data → treated as unproven (never guessed).
          offerId: String(new mongoose.Types.ObjectId()),
          title: 'Chai + Samosa Combo',
          type: 'combo',
          value: 80,
          redemptions: 25,
          revenueGenerated: 8000,
          discountGiven: 500,
          averageOrderValue: 300,
          uniqueCustomers: 12,
        },
        {
          // Ordinary non-combo offer — behavior must remain unchanged.
          offerId: String(new mongoose.Types.ObjectId()),
          title: 'Chai Friday',
          type: 'flat',
          value: 10,
          redemptions: 12,
          revenueGenerated: 5000,
          discountGiven: 300,
          averageOrderValue: 400,
          uniqueCustomers: 8,
          repeatCustomers: 2,
          customersTargeted: 0,
          customersReached: 0,
          opened: 0,
          daysActive: 10,
          trend: [],
        },
      ],
    } as unknown as RecommendationContext;

    const suggestions = await provider.getSuggestions(ctx);
    expect(suggestions.length).toBeGreaterThan(0);

    // The STAR combo IS recommended — with its deterministic margin cited.
    const star = suggestions.find((s) => String(s.title).includes('Tikka + Chai'));
    expect(star).toBeDefined();
    expect(star!.type).toBe('combo');
    expect(String(star!.recommendationReason)).toContain('62.0% contribution margin');
    expect(String(star!.recommendationReason)).toContain('18,000'); // combo-attributed revenue, not whole-bill

    // The HIGH-VOLUME/LOW-MARGIN combo is NOT recommended — the recommendation
    // is economics-driven, not volume-driven (P2 §15: never pick on redemptions
    // alone). Same for the combo with no margin data.
    expect(suggestions.every((s) => !String(s.title).includes('Biryani + Cold Drink'))).toBe(true);
    expect(suggestions.every((s) => !String(s.title).includes('Chai + Samosa'))).toBe(true);

    // The non-combo offer still gets its repeat recommendation (unchanged).
    expect(suggestions.some((s) => String(s.title).includes('Chai Friday'))).toBe(true);
  });

  it('time windows — date-range filtering is honored', async () => {
    const { tikka, chai, comboA } = await seedProducts();
    const old = await makeBill(REST_A, 298, { date: '2026-07-01', createdAt: new Date('2026-07-01T12:00:00Z') });
    await addItem(old, tikka, 1, 249);
    await addItem(old, chai, 1, 49);
    await redeem(REST_A, comboA, old, 49, '9822000501', new Date('2026-07-01T12:00:00Z'));

    const recent = await makeBill(REST_A, 298, { date: '2026-08-01', createdAt: new Date('2026-08-01T12:00:00Z') });
    await addItem(recent, tikka, 1, 249);
    await addItem(recent, chai, 1, 49);
    await redeem(REST_A, comboA, recent, 49, '9822000502', new Date('2026-08-01T12:00:00Z'));

    const all = await getComboAnalytics({ restaurantId: REST_A });
    expect(all[0].orders).toBe(2);
    const july = await getComboAnalytics({ restaurantId: REST_A, from: '2026-07-01', to: '2026-07-31' });
    expect(july[0].orders).toBe(1);
    expect(july[0].comboRevenue).toBe(249);
    const aug = await getComboAnalytics({ restaurantId: REST_A, from: '2026-08-01', to: '2026-08-31' });
    expect(aug[0].orders).toBe(1);
    const none = await getComboAnalytics({ restaurantId: REST_A, from: '2025-01-01', to: '2025-01-31' });
    expect(none).toEqual([]);
  });

  it('classifyCombo is deterministic and dataset-independent', () => {
    const high = classifyCombo({ units: 15, contributionMargin: 60, comboRevenue: 5000, structuralSavings: 500, repeatRate: 20, uniqueCustomers: 10 });
    expect(high).toContain('HIGH_PERFORMER');
    const lowMargin = classifyCombo({ units: 20, contributionMargin: 12, comboRevenue: 10000, structuralSavings: 2500, repeatRate: 10, uniqueCustomers: 15 });
    expect(lowMargin).toContain('HIGH_REVENUE_LOW_MARGIN');
    expect(lowMargin).toContain('HIGH_DISCOUNT_LOW_CONTRIBUTION');
    const weak = classifyCombo({ units: 2, contributionMargin: 40, comboRevenue: 500, structuralSavings: 50, repeatRate: null, uniqueCustomers: 1 });
    expect(weak).toContain('LOW_PERFORMER');
    const silent = classifyCombo({ units: 0, contributionMargin: null, comboRevenue: 0, structuralSavings: 0, repeatRate: null, uniqueCustomers: 0 });
    expect(silent).toEqual([]);
  });
});

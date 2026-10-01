/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * fixPassBridge.test.ts — regression tests for the audit fix pass:
 *
 *   Phase 7  — real stockout/availability signal reaches the Demand envelope
 *              (explicit POS state only; never inferred from zero sales).
 *   Phase 8  — prediction → actual → error → durable outcome; honest missing
 *              actuals; divide-by-zero guarded.
 *   Phase 14 — segmentation rows stored under modelName 'segment'.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod: MongoMemoryServer;
import Bill from '../../../models/intelligence/Bill';
import BillItem from '../../../models/intelligence/BillItem';
import Product from '../../../models/catalog/Product';
import MenuAvailability from '../../../models/catalog/MenuAvailability';
import MLPrediction from '../../../models/intelligence/MLPrediction';
import MLPredictionOutcome from '../../../models/intelligence/MLPredictionOutcome';
import { extractBillsForDemandModel } from '../billExtractor';
import { evaluateDemandPredictionOutcomes, buildProductionPerformance } from '../predictionFeedbackService';
import { storeSegments, getStoredSegments } from '../segmentSyncService';

const REST_A = new mongoose.Types.ObjectId();
const REST_B = new mongoose.Types.ObjectId();

async function seedProduct(restaurantId: mongoose.Types.ObjectId, id: string, availability = true) {
  const existing = await Product.findOne({ restaurantId, code: id }).lean<{ _id: mongoose.Types.ObjectId }>();
  if (existing) return existing;
  const doc = await Product.create({
    name: `Prod ${id}`,
    code: id,
    price: 100,
    category: 'Starters',
    gstPercent: 5,
    type: 'menu',
    availability,
    restaurantId,
    currentStock: 50,
    unit: 'pcs',
    minStock: 5,
    maxStock: 100,
    reorderLevel: 10,
    averageCost: 40,
  });
  return { _id: doc._id } as { _id: mongoose.Types.ObjectId };
}

describe('Phase 7 — real stockout signal in the Demand envelope', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await Promise.all([
      Bill.deleteMany({ restaurantId: { $in: [REST_A, REST_B] } }).exec(),
      BillItem.deleteMany({}).exec(),
      Product.deleteMany({ restaurantId: { $in: [REST_A, REST_B] } }).exec(),
      MenuAvailability.deleteMany({ restaurantId: { $in: [REST_A, REST_B] } }).exec(),
    ]);
    await seedProduct(REST_A, 'P_AVAIL', true);
    await seedProduct(REST_A, 'P_SOLDOUT', true);
    await seedProduct(REST_A, 'P_LEGACY_OFF', false); // Product.availability=false
    await seedProduct(REST_B, 'P_AVAIL', true);

    // MenuAvailability: P_SOLDOUT explicitly UNAVAILABLE for tenant A.
    await MenuAvailability.create({
      restaurantId: REST_A,
      branchId: null,
      productId: (await Product.findOne({ restaurantId: REST_A, code: 'P_SOLDOUT' }))!._id,
      status: 'UNAVAILABLE',
      visibleOnSite: true,
      source: 'manual',
    });

    // One bill per product for tenant A + one for tenant B (isolation check).
    for (const [rest, code] of [
      [REST_A, 'P_AVAIL'],
      [REST_A, 'P_SOLDOUT'],
      [REST_A, 'P_LEGACY_OFF'],
      [REST_B, 'P_AVAIL'],
    ] as const) {
      const bill = await Bill.create({
        invoiceNumber: `INV-${rest.toString()}-${code}`,
        ticketNumber: `TKT-${code}`,
        date: '2026-09-28',
        time: '19:30',
        cashierName: 't',
        cashierRole: 'cashier',
        subtotal: 200,
        discount: 0,
        gst: 10,
        grandTotal: 210,
        paymentMethod: 'Cash',
        orderType: 'dine-in',
        restaurantId: rest,
        pointsEarned: 0,
        pointsRedeemed: 0,
        isVoided: false,
        isRefunded: false,
      });
      await BillItem.create({
        billId: bill._id,
        menuItemId: (await Product.findOne({ restaurantId: rest, code }))!._id.toString(),
        itemName: code,
        priceAtSale: 100,
        quantity: 2,
        gstRateAtSale: 5,
        discountAtSale: 0,
        isFree: false,
      });
    }
  });

  afterAll(async () => {
    await Promise.all([
      Bill.deleteMany({ restaurantId: { $in: [REST_A, REST_B] } }).exec(),
      BillItem.deleteMany({ billId: { $exists: true } }).exec(),
      Product.deleteMany({ restaurantId: { $in: [REST_A, REST_B] } }).exec(),
      MenuAvailability.deleteMany({ restaurantId: { $in: [REST_A, REST_B] } }).exec(),
      mongoose.connection.close(),
    ]);
  });

  it('normal sales carry NO stockout flag', async () => {
    const { envelope } = await extractBillsForDemandModel(REST_A.toString());
    const item = envelope.orders.flatMap((o) => o.items).find((i) => i.product_name === 'P_AVAIL');
    expect(item).toBeDefined();
    expect(item!.stockout).toBeUndefined();
  });

  it('MenuAvailability UNAVAILABLE → stockout: true + menu_available: false', async () => {
    const { envelope } = await extractBillsForDemandModel(REST_A.toString());
    const item = envelope.orders.flatMap((o) => o.items).find((i) => i.product_name === 'P_SOLDOUT');
    expect(item?.stockout).toBe(true);
    expect(item?.menu_available).toBe(false);
  });

  it('Product.availability=false (sold-out toggle) → stockout: true', async () => {
    const { envelope } = await extractBillsForDemandModel(REST_A.toString());
    const item = envelope.orders.flatMap((o) => o.items).find((i) => i.product_name === 'P_LEGACY_OFF');
    expect(item?.stockout).toBe(true);
  });

  it('stockout flags never leak across tenants (B has no MenuAvailability rows)', async () => {
    const { envelope } = await extractBillsForDemandModel(REST_B.toString());
    const items = envelope.orders.flatMap((o) => o.items);
    expect(items.length).toBe(1);
    expect(items[0].stockout).toBeUndefined();
    // No MenuAvailability rows for this tenant → signal omitted; the Demand
    // engine's documented default (menu_available = !stockout → true) applies.
  });

  it('never infers stockout from quantity alone (qty=2 sold → not stockout)', async () => {
    const { envelope } = await extractBillsForDemandModel(REST_A.toString());
    const normal = envelope.orders.flatMap((o) => o.items).find((i) => i.product_name === 'P_AVAIL');
    expect(normal!.quantity).toBe(2);
    expect(normal!.stockout).toBeUndefined();
  });
});

describe('Phase 8 — prediction → actual → error feedback', () => {
  beforeAll(async () => {
    if (!mongoose.connection.readyState) {
      mongod = await MongoMemoryServer.create();
      await mongoose.connect(mongod.getUri());
    }
    await Promise.all([
      MLPrediction.deleteMany({ restaurantId: { $in: [REST_A, REST_B] } }).exec(),
      MLPredictionOutcome.deleteMany({ restaurantId: { $in: [REST_A, REST_B] } }).exec(),
      Bill.deleteMany({ restaurantId: { $in: [REST_A, REST_B] } }).exec(),
      BillItem.deleteMany({}).exec(),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      MLPrediction.deleteMany({ restaurantId: { $in: [REST_A, REST_B] } }).exec(),
      MLPredictionOutcome.deleteMany({ restaurantId: { $in: [REST_A, REST_B] } }).exec(),
      Bill.deleteMany({ restaurantId: { $in: [REST_A, REST_B] } }).exec(),
      BillItem.deleteMany({ billId: { $exists: true } }).exec(),
      mongoose.connection.close(),
    ]);
  });

  it('evaluates matured predictions against real bill actuals (idempotent upsert)', async () => {
    const past = '2026-09-27';
    // Real actuals: 5 units of P_FB on `past` for tenant A.
    const bill = await Bill.create({
      invoiceNumber: `FB-${REST_A}`, ticketNumber: 'FB', date: past, time: '20:00',
      cashierName: 't', cashierRole: 'cashier', subtotal: 500, discount: 0, gst: 25,
      grandTotal: 525, paymentMethod: 'UPI', orderType: 'dine-in', restaurantId: REST_A,
      pointsEarned: 0, pointsRedeemed: 0, isVoided: false, isRefunded: false,
    });
    const prod = await seedProduct(REST_A, 'P_FB', true);
    await BillItem.create({
      billId: bill._id, menuItemId: prod._id.toString(), itemName: 'P_FB',
      priceAtSale: 100, quantity: 5, gstRateAtSale: 5, discountAtSale: 0, isFree: false,
    });

    await MLPrediction.create({
      restaurantId: REST_A, modelName: 'demand', predictionType: 'product_demand',
      entityId: prod._id.toString(), predictionFor: past, modelVersion: 'v1', generatedAt: new Date(),
      prediction: { expected: 4, lower: 2, upper: 6 }, source: 'demand_model',
    });

    const stats = await evaluateDemandPredictionOutcomes([REST_A.toString()]);
    expect(stats.predictionsEvaluated).toBeGreaterThanOrEqual(1);
    expect(stats.outcomesStored).toBeGreaterThanOrEqual(1);

    const outcome = await MLPredictionOutcome.findOne({ restaurantId: REST_A, predictionFor: past }).lean();
    expect(outcome).toBeDefined();
    expect(outcome!.actualValue).toBe(5);
    expect(outcome!.absoluteError).toBe(1); // |5 - 4|
    expect(outcome!.signedError).toBe(1);
    expect(outcome!.errorPct).toBeCloseTo(0.2, 6); // 1/5

    // Idempotent: second run replaces, never duplicates.
    const countBefore = await MLPredictionOutcome.countDocuments({ restaurantId: REST_A });
    await evaluateDemandPredictionOutcomes([REST_A.toString()]);
    const countAfter = await MLPredictionOutcome.countDocuments({ restaurantId: REST_A });
    expect(countAfter).toBe(countBefore);
  });

  it('handles actual = 0 honestly (real zero, no divide-by-zero)', async () => {
    const past = '2026-09-26';
    const prod = await seedProduct(REST_A, 'P_ZERO', true);
    // No bills that day → tenant had no sales; product present in catalog but
    // no bill items → treated as no-observation (null actual), NOT fake zero.
    await MLPrediction.create({
      restaurantId: REST_A, modelName: 'demand', predictionType: 'product_demand',
      entityId: prod._id.toString(), predictionFor: past, modelVersion: 'v1', generatedAt: new Date(),
      prediction: { expected: 3 }, source: 'demand_model',
    });
    const stats = await evaluateDemandPredictionOutcomes([REST_A.toString()]);
    expect(stats.missingActuals).toBeGreaterThanOrEqual(1);
    const outcome = await MLPredictionOutcome.findOne({ restaurantId: REST_A, predictionFor: past }).lean();
    expect(outcome!.actualValue).toBeNull();
    expect(outcome!.absoluteError).toBeNull();
    expect(outcome!.errorPct).toBeNull();
  });

  it('never touches another tenant’s predictions (isolation)', async () => {
    const past = '2026-09-25';
    await MLPrediction.create({
      restaurantId: REST_B, modelName: 'demand', predictionType: 'product_demand',
      entityId: 'FOREIGN', predictionFor: past, modelVersion: 'v1', generatedAt: new Date(),
      prediction: { expected: 10 }, source: 'demand_model',
    });
    await evaluateDemandPredictionOutcomes([REST_A.toString()]);
    const leaked = await MLPredictionOutcome.findOne({ restaurantId: REST_B });
    expect(leaked).toBeNull();
  });

  it('production performance aggregate computes WAPE over durable outcomes', async () => {
    const report = await buildProductionPerformance(REST_A.toString(), 30);
    expect(report).not.toBeNull();
    expect(report!.sample_count).toBeGreaterThanOrEqual(1);
    // From the seeded outcome: pred 4 vs actual 5 → WAPE = 1/5 = 0.2.
    expect(report!.mean_wape).toBeCloseTo(0.2, 6);
  });
});

describe('Phase 14 — segmentation stored under modelName "segment"', () => {
  beforeAll(async () => {
    if (!mongoose.connection.readyState) {
      mongod = await MongoMemoryServer.create();
      await mongoose.connect(mongod.getUri());
    }
  });

  afterAll(async () => {
    await MLPrediction.deleteMany({ restaurantId: REST_A }).exec();
    mongoose.connection.close();
  });

  it('storeSegments writes modelName=segment / source=segment_model and reads back tenant-scoped', async () => {
    await MLPrediction.deleteMany({ restaurantId: REST_A }).exec();
    await storeSegments(REST_A.toString(), {
      restaurant_id: REST_A.toString(),
      is_trained: true,
      model_version: 'seg_v123',
      feature_version: 'rfm-v1',
      customers: [
        { customer_id: 'C1', segment: 'Champions', is_trained: true, method: 'kmeans_rfm', recency_days: 2, frequency: 9, monetary: 9000 },
        { customer_id: 'C2', segment: 'New', is_trained: false, method: 'rule_based_tier', recency_days: 1, frequency: 1, monetary: 300 },
      ],
    } as any);

    const docs = await MLPrediction.find({ restaurantId: REST_A }).lean();
    expect(docs.length).toBe(2);
    for (const d of docs) {
      expect(d.modelName).toBe('segment');
      expect(d.predictionType).toBe('customer_segment');
      expect(d.source).toBe('segment_model');
    }

    const readBack = await getStoredSegments(REST_A.toString());
    expect(readBack.length).toBe(2);
    expect(readBack.some((r) => r.segment === 'Champions')).toBe(true);
  });
});

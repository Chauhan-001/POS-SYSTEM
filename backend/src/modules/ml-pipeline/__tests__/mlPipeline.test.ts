import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import http from 'http';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Bill from '../../../models/intelligence/Bill';
import BillItem from '../../../models/intelligence/BillItem';
import Product from '../../../models/catalog/Product';
import { extractBillsForDemandModel } from '../billExtractor';
import { syncBillsToDemandModel } from '../demandModelClient';
import { runDemandSync } from '../demandSyncService';
import { DEMAND_SYNC_MAX_BILLS_PER_BATCH, chunkArray } from '../demandIngestionContract';

let mongod: MongoMemoryServer;
const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();
const PRODUCT_PIZZA = new mongoose.Types.ObjectId();
const PRODUCT_KABAB = new mongoose.Types.ObjectId();

let mockServer: http.Server | null = null;
let mockCalls: Array<{ headers: http.IncomingHttpHeaders; body: any }> = [];
let mockResponse: { status: number; body: unknown } = { status: 200, body: null };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  await Product.create({
    _id: PRODUCT_PIZZA,
    restaurantId: REST_A,
    name: 'Margherita Pizza',
    code: 'PIZZA-MARG',
    price: 220,
    category: 'Pizza',
    isAvailable: true,
  });
  await Product.create({
    _id: PRODUCT_KABAB,
    restaurantId: REST_A,
    name: 'Paneer Kabab',
    code: 'KABAB-PANEER',
    price: 180,
    category: 'Starters',
    isAvailable: true,
  });
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Bill.deleteMany({}).exec(),
    BillItem.deleteMany({}).exec(),
    Product.deleteMany({ restaurantId: { $in: [REST_B] } }).exec(),
  ]);
});

// ─── Mock Demand model server ────────────────────────────────────────────────

async function startMockDemandServer(handler?: (req: http.IncomingMessage, body: any) => { status: number; body: unknown }) {
  mockServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      mockCalls.push({ headers: req.headers, body });
      const out = handler ? handler(req, body) : mockResponse;
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body ?? {
        success: true,
        accepted_rows_count: body?.orders?.reduce((a: number, o: any) => a + o.items.length, 0) ?? 0,
        rejected_rows_count: 0,
        data_quality_score: 95,
        readiness_status: 'Ready for ML',
      }));
    });
  });
  await new Promise<void>((resolve) => mockServer!.listen(0, '127.0.0.1', resolve));
  const addr = mockServer.address() as { port: number };
  return `http://127.0.0.1:${addr.port}`;
}

afterEach(async () => {
  if (mockServer) {
    await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
    mockServer = null;
  }
  mockCalls = [];
  mockResponse = { status: 200, body: null };
  delete process.env.ML_DEMAND_BASE_URL;
  delete process.env.ML_SERVICE_TOKEN;
});

// ─── Seed helpers ────────────────────────────────────────────────────────────

async function seedBill(opts: {
  restaurantId?: string;
  date?: string;
  isVoided?: boolean;
  isRefunded?: boolean;
  refundedItems?: Array<{ menuItemId?: string; itemName?: string; quantity: number; amount: number }>;
  customerId?: string;
  customerPhone?: string;
  items: Array<{ menuItemId?: string; itemName: string; priceAtSale: number; quantity: number; discountAtSale?: number; isFree?: boolean }>;
}) {
  const bill = await Bill.create({
    invoiceNumber: `INV-${Math.floor(Math.random() * 1e9)}`,
    ticketNumber: `T-${Math.floor(Math.random() * 1e6)}`,
    date: opts.date || '2026-09-20',
    time: '19:45',
    cashierName: 'Owner',
    cashierRole: 'owner',
    subtotal: 1000,
    discount: 0,
    gst: 50,
    grandTotal: 1050,
    paymentMethod: 'Cash',
    orderType: 'Dine In',
    restaurantId: opts.restaurantId ?? REST_A,
    customerId: opts.customerId ?? null,
    customerPhone: opts.customerPhone,
    isVoided: opts.isVoided ?? false,
    isRefunded: opts.isRefunded ?? false,
    refundAmount: 0,
    refundedItems: opts.refundedItems,
    pointsEarned: 0,
    pointsRedeemed: 0,
  });
  for (const it of opts.items) {
    await BillItem.create({
      billId: bill._id,
      menuItemId: it.menuItemId,
      itemName: it.itemName,
      priceAtSale: it.priceAtSale,
      quantity: it.quantity,
      gstRateAtSale: 5,
      discountAtSale: it.discountAtSale ?? 0,
      isFree: it.isFree ?? false,
    });
  }
  return bill;
}

// ─── Extractor tests ─────────────────────────────────────────────────────────

describe('billExtractor (P0 data bridge)', () => {
  it('extracts paid bills into the Demand POS-sync envelope with product enrichment', async () => {
    await seedBill({
      items: [
        { menuItemId: PRODUCT_PIZZA.toString(), itemName: 'Margherita Pizza', priceAtSale: 220, quantity: 2 },
        { menuItemId: PRODUCT_KABAB.toString(), itemName: 'Paneer Kabab', priceAtSale: 180, quantity: 1 },
      ],
    });

    const { envelope, stats } = await extractBillsForDemandModel(REST_A);

    expect(envelope.orders).toHaveLength(1);
    const order = envelope.orders[0];
    expect(order.payment_status).toBe('paid');
    expect(order.items).toHaveLength(2);
    expect(order.items[0].product_id).toBe(PRODUCT_PIZZA.toString());
    expect(order.items[0].category).toBe('Pizza');
    expect(order.items[0].quantity).toBe(2);
    expect(order.items[0].unit_price).toBe(220);
    expect(stats.totalBills).toBe(1);
    expect(stats.byStatus.paid).toBe(1);
    expect(stats.productsEnriched).toBe(2);
  });

  it('excludes voided bills entirely (never real demand)', async () => {
    await seedBill({
      isVoided: true,
      items: [{ menuItemId: PRODUCT_PIZZA.toString(), itemName: 'Margherita Pizza', priceAtSale: 220, quantity: 1 }],
    });
    await seedBill({
      items: [{ menuItemId: PRODUCT_PIZZA.toString(), itemName: 'Margherita Pizza', priceAtSale: 220, quantity: 1 }],
    });

    const { envelope, stats } = await extractBillsForDemandModel(REST_A);
    expect(envelope.orders).toHaveLength(1);
    expect(stats.totalBills).toBe(1); // voided filtered at query level
  });

  it('maps refunded bills to payment_status "refunded"', async () => {
    await seedBill({
      isRefunded: true,
      refundAmount: 220,
      items: [{ menuItemId: PRODUCT_PIZZA.toString(), itemName: 'Margherita Pizza', priceAtSale: 220, quantity: 1 }],
    });

    const { envelope } = await extractBillsForDemandModel(REST_A);
    expect(envelope.orders[0].payment_status).toBe('refunded');
  });

  it('nets out fully-refunded line items on partially-refunded bills', async () => {
    const pizzaId = PRODUCT_PIZZA.toString();
    await seedBill({
      refundedItems: [{ menuItemId: pizzaId, itemName: 'Margherita Pizza', quantity: 2, amount: 440 }],
      items: [
        { menuItemId: pizzaId, itemName: 'Margherita Pizza', priceAtSale: 220, quantity: 2 },
        { menuItemId: PRODUCT_KABAB.toString(), itemName: 'Paneer Kabab', priceAtSale: 180, quantity: 1 },
      ],
    });

    const { envelope } = await extractBillsForDemandModel(REST_A);
    const items = envelope.orders[0].items;
    const pizzaRow = items.find((i) => i.product_id === pizzaId);
    expect(pizzaRow).toBeUndefined(); // fully refunded → dropped
    expect(items).toHaveLength(1);
    expect(items[0].product_id).toBe(PRODUCT_KABAB.toString());
  });

  it('skips free (complimentary) items and counts them', async () => {
    await seedBill({
      items: [
        { itemName: 'Complimentary Papad', priceAtSale: 0, quantity: 1, isFree: true },
        { menuItemId: PRODUCT_PIZZA.toString(), itemName: 'Margherita Pizza', priceAtSale: 220, quantity: 1 },
      ],
    });

    const { envelope, stats } = await extractBillsForDemandModel(REST_A);
    expect(envelope.orders[0].items).toHaveLength(1);
    expect(stats.excludedFreeItems).toBe(1);
  });

  it('falls back to deterministic slug product ids when menuItemId is missing', async () => {
    await seedBill({
      items: [{ itemName: 'Special Thali', priceAtSale: 300, quantity: 1 }],
    });

    const { envelope, stats } = await extractBillsForDemandModel(REST_A);
    // Slug matches SchemaMappingEngine's exact format: P_ + first 10 name chars
    expect(envelope.orders[0].items[0].product_id).toBe('P_SPECIAL_THAL');
    expect(stats.skippedNoMenuId).toBe(1);
  });

  it('converts absolute per-unit discount to the contract percentage honestly', async () => {
    await seedBill({
      items: [{ menuItemId: PRODUCT_PIZZA.toString(), itemName: 'Margherita Pizza', priceAtSale: 200, quantity: 1, discountAtSale: 50 }],
    });

    const { envelope } = await extractBillsForDemandModel(REST_A);
    expect(envelope.orders[0].items[0].discount).toBeCloseTo(25, 5);
  });

  it('enforces tenant isolation: REST_B bills are never visible to REST_A extraction', async () => {
    await seedBill({
      restaurantId: REST_B,
      items: [{ itemName: 'Cross-Tenant Secret Dish', priceAtSale: 999, quantity: 10 }],
    });
    await seedBill({
      items: [{ menuItemId: PRODUCT_PIZZA.toString(), itemName: 'Margherita Pizza', priceAtSale: 220, quantity: 1 }],
    });

    const { envelope, stats } = await extractBillsForDemandModel(REST_A);
    expect(stats.totalBills).toBe(1);
    const allNames = envelope.orders.flatMap((o) => o.items.map((i) => i.product_name));
    expect(allNames).not.toContain('Cross-Tenant Secret Dish');
  });

  it('respects the date window', async () => {
    await seedBill({ date: '2026-09-01', items: [{ itemName: 'Old Item', priceAtSale: 100, quantity: 1 }] });
    await seedBill({ date: '2026-09-20', items: [{ itemName: 'New Item', priceAtSale: 100, quantity: 1 }] });

    const { envelope } = await extractBillsForDemandModel(REST_A, { fromDate: '2026-09-10' });
    expect(envelope.orders).toHaveLength(1);
    expect(envelope.orders[0].items[0].product_name).toBe('New Item');
  });
});

// ─── Contract helpers ────────────────────────────────────────────────────────

describe('demandIngestionContract chunking', () => {
  it('chunks arrays and handles remainder', () => {
    const items = Array.from({ length: 1101 }, (_, i) => i);
    const chunks = chunkArray(items, DEMAND_SYNC_MAX_BILLS_PER_BATCH);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(500);
    expect(chunks[2]).toHaveLength(101);
    expect(chunks.flat()).toEqual(items);
  });
});

// ─── Client + end-to-end sync (mock Demand model) ────────────────────────────

describe('demandModelClient + runDemandSync (mocked Demand model)', () => {
  it('rejects when ML_DEMAND_BASE_URL is unset', async () => {
    await seedBill({ items: [{ menuItemId: PRODUCT_PIZZA.toString(), itemName: 'Margherita Pizza', priceAtSale: 220, quantity: 1 }] });

    await expect(runDemandSync(REST_A)).rejects.toThrow(/ML_DEMAND_BASE_URL/);
  });

  it('performs the full extract→push cycle with service-token and tenant headers', async () => {
    const baseUrl = await startMockDemandServer();
    process.env.ML_DEMAND_BASE_URL = baseUrl;
    process.env.ML_SERVICE_TOKEN = 'st_test_123';

    await seedBill({
      customerId: new mongoose.Types.ObjectId().toString(),
      items: [{ menuItemId: PRODUCT_PIZZA.toString(), itemName: 'Margherita Pizza', priceAtSale: 220, quantity: 2 }],
    });

    const result = await runDemandSync(REST_A);

    expect(result.configured).toBe(true);
    expect(result.sync).not.toBeNull();
    expect(result.sync!.status).toBe('synced');
    expect(result.sync!.acceptedRows).toBe(1);
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0].headers['x-restaurant-id']).toBe(REST_A);
    expect(mockCalls[0].headers['x-service-token']).toBe('st_test_123');
    expect(mockCalls[0].body.orders[0].items[0].quantity).toBe(2);
  });

  it('reports partial success honestly when the Demand model rejects rows', async () => {
    const baseUrl = await startMockDemandServer();
    process.env.ML_DEMAND_BASE_URL = baseUrl;
    mockResponse = {
      status: 200,
      body: { success: true, accepted_rows_count: 1, rejected_rows_count: 2, data_quality_score: 70 },
    };

    await seedBill({
      items: [{ menuItemId: PRODUCT_PIZZA.toString(), itemName: 'Margherita Pizza', priceAtSale: 220, quantity: 2 }],
    });

    const result = await runDemandSync(REST_A);
    expect(result.sync!.status).toBe('partial');
    expect(result.sync!.acceptedRows).toBe(1);
    expect(result.sync!.rejectedRows).toBe(2);
  });

  it('marks the sync failed when the Demand model is unreachable', async () => {
    process.env.ML_DEMAND_BASE_URL = 'http://127.0.0.1:1'; // nothing listens here
    process.env.ML_DEMAND_TIMEOUT_MS = '2000';

    await seedBill({
      items: [{ menuItemId: PRODUCT_PIZZA.toString(), itemName: 'Margherita Pizza', priceAtSale: 220, quantity: 1 }],
    });

    const result = await runDemandSync(REST_A);
    expect(result.sync!.status).toBe('failed');
    expect(result.sync!.batchesFailed).toBe(1);
    expect(result.sync!.batchResults[0].error).toBeTruthy();
  });

  it('returns sync:null with honest stats for a tenant with no bills', async () => {
    const baseUrl = await startMockDemandServer();
    process.env.ML_DEMAND_BASE_URL = baseUrl;

    const result = await runDemandSync(REST_A);
    expect(result.sync).toBeNull();
    expect(result.extraction.totalBills).toBe(0);
    expect(mockCalls).toHaveLength(0);
  });

  it('splits >500 bills into multiple batched HTTP calls', async () => {
    const baseUrl = await startMockDemandServer();
    process.env.ML_DEMAND_BASE_URL = baseUrl;

    // Seed 505 tiny bills (max limit on extraction is 50k; fine here)
    const docs = [];
    for (let i = 0; i < 505; i++) {
      docs.push({
        invoiceNumber: `INV-BATCH-${i}`,
        ticketNumber: `T-${i}`,
        date: '2026-09-21',
        time: '12:00',
        cashierName: 'Owner',
        cashierRole: 'owner',
        subtotal: 100,
        discount: 0,
        gst: 5,
        grandTotal: 105,
        paymentMethod: 'Cash',
        orderType: 'Dine In',
        restaurantId: REST_A,
        isVoided: false,
        isRefunded: false,
        refundAmount: 0,
        pointsEarned: 0,
        pointsRedeemed: 0,
      });
    }
    const bills = await Bill.insertMany(docs);
    await BillItem.insertMany(
      bills.map((b: any) => ({
        billId: b._id,
        menuItemId: PRODUCT_PIZZA.toString(),
        itemName: 'Margherita Pizza',
        priceAtSale: 220,
        quantity: 1,
        gstRateAtSale: 5,
        discountAtSale: 0,
        isFree: false,
      }))
    );

    const result = await runDemandSync(REST_A);
    expect(result.sync!.batchesTotal).toBe(2);
    expect(mockCalls).toHaveLength(2);
    expect(mockCalls[0].body.orders).toHaveLength(500);
    expect(mockCalls[1].body.orders).toHaveLength(5);
  });
});

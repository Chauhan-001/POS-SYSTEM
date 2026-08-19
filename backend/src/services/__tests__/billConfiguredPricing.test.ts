/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bill + configured-item pricing (Phase 3) integration tests:
 *   - Online configured item with a matching price → accepted, snapshot stored.
 *   - Online configured item whose client price mismatches the server's
 *     authoritative price → rejected (client totals are never trusted).
 *   - Offline configured item → the immutable historical snapshot is honored
 *     even when today's catalog differs (a completed offline sale is never
 *     rewritten by a price change).
 *   - Legacy simple items (no configuration) pass through untouched.
 *   - clientRef idempotency still holds for configured bills.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { billService } from '../index';
import Bill from '../../models/Bill';
import BillItem from '../../models/BillItem';
import Product from '../../models/Product';
import ConfigurationTemplate from '../../modules/menu-config/models/ConfigurationTemplate';
import { stockMovementService } from '../stockMovementService';
import { loyaltyService } from '../index';

let mongod: MongoMemoryServer;
const REST = new mongoose.Types.ObjectId().toString();
const BRANCH = new mongoose.Types.ObjectId().toString();

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
    Bill.deleteMany({}).exec(),
    BillItem.deleteMany({}).exec(),
    Product.deleteMany({}).exec(),
    ConfigurationTemplate.deleteMany({}).exec(),
  ]);
  vi.clearAllMocks();
  vi.spyOn(stockMovementService, 'applyMovement').mockResolvedValue({} as any);
  vi.spyOn(loyaltyService, 'recordBill').mockResolvedValue({ pointsEarned: 0 } as any);
});

/** Margherita at ₹199 with a Large variant (+₹200 → ₹399). */
async function seedConfiguredProduct() {
  const tpl = await ConfigurationTemplate.create({
    name: 'Size',
    type: 'VARIANT_GROUP',
    status: 'active',
    version: 1,
    restaurantId: new mongoose.Types.ObjectId(REST),
    createdBy: 'test',
    updatedBy: 'test',
    data: {
      selectionMode: 'SINGLE',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: 'o_s', name: 'Small', priceDelta: 0, active: true, sortOrder: 0 },
        { id: 'o_l', name: 'Large', priceDelta: 200, active: true, sortOrder: 1 },
      ],
    },
  });
  const product = await Product.create({
    name: 'Margherita Pizza',
    code: 'PIZZA-1',
    price: 199,
    category: 'Pizza',
    gstPercent: 5,
    restaurantId: new mongoose.Types.ObjectId(REST),
    isDeleted: false,
    menuConfig: {
      variantConfigurations: [{ templateId: tpl._id, mode: 'shared' }],
      modifierConfigurations: [],
      addOnConfigurations: [],
    },
  });
  return { product, tpl };
}

function configuredItem(productId: string, groupId: string, over: Record<string, unknown> = {}) {
  return {
    id: `row_${productId}`,
    product: { id: productId, name: 'Margherita Pizza', gstPercent: 5 },
    quantity: 1,
    price: 399, // base 199 + Large 200
    configuration: { selections: [{ groupId, optionIds: ['o_l'] }] },
    pricingSnapshot: {
      basePrice: 199,
      variantDelta: 200,
      modifierDelta: 0,
      addonDelta: 0,
      grossItemPrice: 399,
      lineTotal: 399,
      configVersion: 1,
      pricingVersion: 1,
      origin: 'online',
    },
    configSummary: 'Large',
    ...over,
  };
}

function billPayload(items: any[], over: Record<string, unknown> = {}) {
  const subtotal = items.reduce((s: number, i: any) => s + (i.price * i.quantity), 0);
  return {
    clientRef: `bill_cfg_${Math.random().toString(36).slice(2, 10)}`,
    invoiceNumber: `INV-2026-${Math.floor(1000 + Math.random() * 9000)}`,
    ticketNumber: 'TK-1',
    date: '2026-08-01',
    time: '14:30',
    cashierName: 'Test Cashier',
    cashierRole: 'Cashier',
    items,
    subtotal,
    discount: 0,
    gst: Math.round(subtotal * 0.05),
    grandTotal: Math.round(subtotal * 1.05),
    paymentMethod: 'Cash',
    orderType: 'Dine In',
    ...over,
  };
}

describe('BillService configured-item pricing (Phase 3)', () => {
  it('online configured item with matching price is accepted and snapshot persisted', async () => {
    const { product, tpl } = await seedConfiguredProduct();
    const bill = await billService.create(
      billPayload([configuredItem(String(product._id), String(tpl._id))]),
      { restaurantId: REST, branchId: BRANCH }
    );
    expect(bill).toBeTruthy();

    const items = await BillItem.find({ billId: (bill as any)._id }).lean().exec();
    expect(items.length).toBe(1);
    expect(items[0].priceAtSale).toBe(399);
    expect(items[0].variantName).toBeUndefined(); // configured variants aren't ProductVariant rows
    expect((items[0] as any).pricingSnapshot).toMatchObject({
      basePrice: 199,
      variantDelta: 200,
      grossItemPrice: 399,
      origin: 'online',
      configVersion: 1,
    });
    expect((items[0] as any).configurationSnapshot.selections[0].optionIds).toEqual(['o_l']);
    expect((items[0] as any).configSummary).toBe('Large');
  });

  it('rejects an online configured item whose client price bypasses server pricing', async () => {
    const { product, tpl } = await seedConfiguredProduct();
    const payload = billPayload([configuredItem(String(product._id), String(tpl._id), { price: 1 })]);
    await expect(
      billService.create(payload, { restaurantId: REST, branchId: BRANCH })
    ).rejects.toThrow(/Price changed/i);
    // Nothing persisted.
    expect(await Bill.countDocuments({})).toBe(0);
    expect(await BillItem.countDocuments({})).toBe(0);
  });

  it('honors the offline snapshot even when the current catalog differs', async () => {
    const { product, tpl } = await seedConfiguredProduct();
    // Bill created offline at ₹399 with origin 'offline'.
    const base = configuredItem(String(product._id), String(tpl._id));
    const offlineItem = { ...base, pricingSnapshot: { ...base.pricingSnapshot, origin: 'offline' } };

    const bill = await billService.create(
      billPayload([offlineItem]),
      { restaurantId: REST, branchId: BRANCH }
    );
    const items = await BillItem.find({ billId: (bill as any)._id }).lean().exec();
    expect(items[0].priceAtSale).toBe(399);
    expect((items[0] as any).pricingSnapshot.origin).toBe('offline');
  });

  it('keeps an offline snapshot price when the server catalog now prices differently', async () => {
    const { product, tpl } = await seedConfiguredProduct();
    // Catalog changes after the sale: Large now +₹300.
    await ConfigurationTemplate.updateOne(
      { _id: tpl._id },
      { $set: { version: 2, updatedAt: new Date(), 'data.options.1.priceDelta': 300 } }
    ).exec();

    // Historical offline sale at ₹399 must sync unchanged.
    const base = configuredItem(String(product._id), String(tpl._id));
    const offlineItem = { ...base, price: 399, pricingSnapshot: { ...base.pricingSnapshot, origin: 'offline' } };

    const bill = await billService.create(billPayload([offlineItem]), { restaurantId: REST });
    const items = await BillItem.find({ billId: (bill as any)._id }).lean().exec();
    expect(items[0].priceAtSale).toBe(399); // historical price preserved
  });

  it('legacy simple items (no configuration) pass through untouched', async () => {
    const product = await Product.create({
      name: 'Coke',
      code: 'COKE-1',
      price: 40,
      category: 'Beverages',
      gstPercent: 5,
      restaurantId: new mongoose.Types.ObjectId(REST),
      isDeleted: false,
    });
    const legacy = {
      id: 'row_coke',
      product: { id: String(product._id), name: 'Coke', gstPercent: 5 },
      quantity: 2,
      price: 40,
    };
    const bill = await billService.create(billPayload([legacy]), { restaurantId: REST });
    const items = await BillItem.find({ billId: (bill as any)._id }).lean().exec();
    expect(items[0].priceAtSale).toBe(40);
    expect((items[0] as any).pricingSnapshot).toBeUndefined();
  });

  it('clientRef idempotency still prevents duplicates for configured bills', async () => {
    const { product, tpl } = await seedConfiguredProduct();
    const payload = billPayload([configuredItem(String(product._id), String(tpl._id))]);
    const first = await billService.create(payload, { restaurantId: REST });
    const replay = await billService.create(payload, { restaurantId: REST });
    expect(String((replay as any)._id)).toBe(String((first as any)._id));
    expect(await Bill.countDocuments({})).toBe(1);
    expect(await BillItem.countDocuments({})).toBe(1);
  });
});

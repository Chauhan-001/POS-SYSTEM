/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FIFO batch consumption + lightweight inventory summary tests.
 *
 *   - Purchases with an expiry date create/merge FIFO batches.
 *   - Sales consume the OLDEST-expiry batch first ('' expiry → last).
 *   - Fully-consumed batches drop out and no longer drive expiry warnings.
 *   - The inventory summary reports batchCount + earliest REMAINING expiry
 *     without transferring the full batch array.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Product from '../../../models/Product';
import { stockMovementService } from '../../../services/stockMovementService';
import { inventoryReportService } from '../../reports/services';

const REST = new mongoose.Types.ObjectId().toString();

const FUTURE = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function makeItem(name: string): Promise<any> {
  return Product.create({
    name,
    code: `INV-${name.toUpperCase().replace(/\s+/g, '')}`,
    price: 0,
    category: 'Inventory',
    type: 'inventory',
    availability: false,
    restaurantId: REST,
    currentStock: 0,
    unit: 'kg',
    minStock: 0,
    maxStock: 1000,
    averageCost: 0,
    supplier: '',
    expiryDate: '',
    batchNumber: '',
    voiceAliases: [],
    searchAliases: [],
    learnedAliases: [],
    isDeleted: false,
    batches: [],
  } as any);
}

async function buy(itemId: string, name: string, qty: number, expiry?: string) {
  await stockMovementService.applyMovement({
    restaurantId: REST,
    productId: itemId,
    itemName: name,
    delta: qty,
    type: 'purchase',
    unit: 'kg',
    purchasePrice: 10,
    expiryDate: expiry,
  });
}

async function sell(itemId: string, qty: number) {
  await stockMovementService.applyMovement({
    restaurantId: REST,
    productId: itemId,
    delta: -qty,
    type: 'sale',
    unit: 'kg',
    allowNegative: true,
  });
}

describe('FIFO batch consumption', () => {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  it('consumes the oldest-expiry batch first (2-day batch fully consumed, 5-day batch reduced)', async () => {
    const paneer = await makeItem('Paneer');
    const d2 = FUTURE(2);
    const d5 = FUTURE(5);
    await buy(paneer._id, 'Paneer', 2, d2); // batch A: 2kg @ d2
    await buy(paneer._id, 'Paneer', 5, d5); // batch B: 5kg @ d5

    await sell(paneer._id, 3); // 2kg from A + 1kg from B

    const fresh = await Product.findById(paneer._id).lean().exec();
    expect(Number(fresh!.currentStock)).toBe(4); // 5 - 1
    const batches = fresh!.batches as any[];
    expect(batches).toHaveLength(1); // batch A fully consumed → dropped
    expect(String(batches[0].expiryDate)).toBe(d5);
    expect(Number(batches[0].quantity)).toBe(4);
    // Earliest REMAINING expiry drives warnings — the exhausted 2-day batch is ignored.
    expect(String(fresh!.expiryDate)).toBe(d5);
  });

  it('partially consumed batches keep their remaining quantity', async () => {
    const tomato = await makeItem('Tomato');
    const d3 = FUTURE(3);
    await buy(tomato._id, 'Tomato', 5, d3);
    await sell(tomato._id, 2);
    const fresh = await Product.findById(tomato._id).lean().exec();
    expect(Number(fresh!.currentStock)).toBe(3);
    expect(Number((fresh!.batches as any[])[0].quantity)).toBe(3);
  });

  it('same-expiry purchases merge into one batch', async () => {
    const milk = await makeItem('Milk');
    const d1 = FUTURE(1);
    await buy(milk._id, 'Milk', 2, d1);
    await buy(milk._id, 'Milk', 3, d1);
    const fresh = await Product.findById(milk._id).lean().exec();
    expect(fresh!.batches).toHaveLength(1);
    expect(Number((fresh!.batches as any[])[0].quantity)).toBe(5);
  });

  it('fully consumed stock clears the expiry date', async () => {
    const cream = await makeItem('Cream');
    const d1 = FUTURE(1);
    await buy(cream._id, 'Cream', 1, d1);
    await sell(cream._id, 1);
    const fresh = await Product.findById(cream._id).lean().exec();
    expect(Number(fresh!.currentStock)).toBe(0);
    expect(String(fresh!.expiryDate || '')).toBe('');
  });

  it('no-expiry batch is consumed last under FIFO', async () => {
    const oil = await makeItem('Oil');
    const d4 = FUTURE(4);
    await buy(oil._id, 'Oil', 2, d4); // expiring batch
    await buy(oil._id, 'Oil', 3, ''); // no-expiry batch
    await sell(oil._id, 2); // consumes the expiring batch first
    const fresh = await Product.findById(oil._id).lean().exec();
    const batches = fresh!.batches as any[];
    expect(batches).toHaveLength(1);
    expect(String(batches[0].expiryDate)).toBe('');
    expect(Number(batches[0].quantity)).toBe(3);
  });

  it('summary reports batchCount + earliest remaining expiry without the batch array', async () => {
    const paneer = await makeItem('PaneerSummary');
    const d2 = FUTURE(2);
    const d5 = FUTURE(5);
    await buy(paneer._id, 'PaneerSummary', 2, d2);
    await buy(paneer._id, 'PaneerSummary', 5, d5);
    await sell(paneer._id, 1); // 1kg of the d2 batch remains

    const rows = await inventoryReportService.summary({
      restaurantId: REST,
      branchId: undefined,
      startDate: undefined,
      endDate: undefined,
    } as any);
    const row = rows.find((r: any) => r.name === 'PaneerSummary') as any;
    expect(row).toBeDefined();
    expect(row.batchCount).toBe(2); // both batches still have remaining qty
    expect(String(row.expiryDate)).toBe(d2); // earliest REMAINING expiry
    expect(row.batches).toBeUndefined(); // full batch array NOT transferred
    expect(row.variants).toBeUndefined();
  });
});

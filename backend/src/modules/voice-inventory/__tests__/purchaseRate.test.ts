/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Purchase-rate flow tests — verify that a rate spoken in a voice command
 * ("5 kg aloo 40 rupaye ke rate par") is:
 *   - carried through the pending action (staged confirmation)
 *   - applied as the product's weighted averageCost on confirm
 *   - kept when no rate is spoken (never zeroed out)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Product from '../../../models/Product';
import VoicePendingAction from '../models/VoicePendingAction';
import { issuePendingAction } from '../services/PendingActionService';
import { updateInventory } from '../services/InventoryService';

let mongod: MongoMemoryServer;

const REST = new mongoose.Types.ObjectId();
const AUDIT_LOG_ID = new mongoose.Types.ObjectId().toString();

async function seedProduct(name: string, overrides: Partial<Record<string, any>> = {}) {
  return Product.create({
    name,
    code: `TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    category: 'Test',
    availability: false,
    price: 0,
    currentStock: 0,
    unit: 'kg',
    minStock: 0,
    maxStock: 100,
    restaurantId: REST,
    ...overrides,
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Product.deleteMany({}).exec();
  await VoicePendingAction.deleteMany({}).exec();
});

describe('pending action rate persistence', () => {
  it('carries the spoken rate through to the staged action', async () => {
    const issued = await issuePendingAction({
      restaurantId: REST.toString(),
      employeeId: 'emp1',
      employeeName: 'Ravi',
      auditLogId: AUDIT_LOG_ID,
      intent: 'inventory_add',
      items: [{ name: 'Potato', quantity: 5, unit: 'kg', rate: 40 }],
      transcript: '5 kg aloo 40 rupaye ke rate par lao',
    });

    const doc = await VoicePendingAction.findById(issued.pendingActionId).lean();
    expect(doc).toBeTruthy();
    expect(doc!.items[0]).toMatchObject({ name: 'Potato', quantity: 5, unit: 'kg', rate: 40 });
  });

  it('stores rate as null when no rate was spoken', async () => {
    const issued = await issuePendingAction({
      restaurantId: REST.toString(),
      employeeId: 'emp1',
      employeeName: 'Ravi',
      auditLogId: AUDIT_LOG_ID,
      intent: 'inventory_add',
      items: [{ name: 'Flour', quantity: 20, unit: 'kg' }],
      transcript: '20 kg flour add karo',
    });

    const doc = await VoicePendingAction.findById(issued.pendingActionId).lean();
    expect(doc!.items[0].rate).toBeNull();
  });
});

describe('updateInventory — averageCost from spoken rate', () => {
  it('applies the spoken rate as averageCost when adding new stock', async () => {
    await seedProduct('Potato', { currentStock: 0, averageCost: 0 });

    const result = await updateInventory({
      restaurantId: REST.toString(),
      operation: 'inventory_add',
      items: [{ itemName: 'Potato', quantity: 5, unit: 'kg', purchaseRate: 40 }],
      performedBy: 'emp1',
      performedByName: 'Ravi',
      source: 'voice',
    });

    expect(result.success).toBe(true);
    const p = await Product.findOne({ name: 'Potato' }).lean();
    expect(p!.currentStock).toBe(5);
    expect(p!.averageCost).toBe(40);
  });

  it('computes a weighted average cost across purchases at different rates', async () => {
    // 10 kg @ 30 already in stock
    await seedProduct('Paneer', { currentStock: 10, averageCost: 30 });

    // + 10 kg @ 50 → avg = (30*10 + 50*10) / 20 = 40
    const result = await updateInventory({
      restaurantId: REST.toString(),
      operation: 'inventory_add',
      items: [{ itemName: 'Paneer', quantity: 10, unit: 'kg', purchaseRate: 50 }],
      performedBy: 'emp1',
      performedByName: 'Ravi',
      source: 'voice',
    });

    expect(result.success).toBe(true);
    const p = await Product.findOne({ name: 'Paneer' }).lean();
    expect(p!.currentStock).toBe(20);
    expect(p!.averageCost).toBe(40);
  });

  it('seeds averageCost on an auto-created product when a rate is spoken', async () => {
    const result = await updateInventory({
      restaurantId: REST.toString(),
      operation: 'inventory_add',
      items: [{ itemName: 'Tomato', quantity: 5, unit: 'kg', purchaseRate: 28 }],
      performedBy: 'emp1',
      performedByName: 'Ravi',
      source: 'voice',
    });

    expect(result.success).toBe(true);
    const p = await Product.findOne({ name: 'Tomato' }).lean();
    expect(p).toBeTruthy();
    expect(p!.currentStock).toBe(5);
    expect(p!.averageCost).toBe(28);
    expect(p!.unit).toBe('kg');
  });

  it('never zeroes averageCost when no rate is spoken', async () => {
    await seedProduct('Milk', { currentStock: 8, unit: 'L', averageCost: 55 });

    const result = await updateInventory({
      restaurantId: REST.toString(),
      operation: 'inventory_add',
      items: [{ itemName: 'Milk', quantity: 2, unit: 'L' }],
      performedBy: 'emp1',
      performedByName: 'Ravi',
      source: 'voice',
    });

    expect(result.success).toBe(true);
    const p = await Product.findOne({ name: 'Milk' }).lean();
    expect(p!.currentStock).toBe(10);
    expect(p!.averageCost).toBe(55); // untouched
  });

  it('scopes the update to the authenticated restaurant', async () => {
    const otherRest = new mongoose.Types.ObjectId();
    await seedProduct('Flour', { currentStock: 5, averageCost: 30 });
    await Product.create({
      name: 'Flour',
      code: 'OTHER-FLOUR',
      category: 'Test',
      availability: false,
      price: 0,
      currentStock: 5,
      averageCost: 50,
      unit: 'kg',
      restaurantId: otherRest,
    });

    const result = await updateInventory({
      restaurantId: otherRest.toString(),
      operation: 'inventory_add',
      items: [{ itemName: 'Flour', quantity: 5, unit: 'kg', purchaseRate: 60 }],
      performedBy: 'emp1',
      performedByName: 'Ravi',
      source: 'voice',
    });

    expect(result.success).toBe(true);
    // Only the OTHER restaurant's product is touched — the seeded one stays
    // untouched, proving restaurantId scoping. Weighted avg = (50*5 + 60*5)/10.
    const seeded = await Product.findOne({ code: /^TEST-/ }).lean();
    expect(seeded!.currentStock).toBe(5);
    expect(seeded!.averageCost).toBe(30);
    const theirs = await Product.findOne({ code: 'OTHER-FLOUR' }).lean();
    expect(theirs!.currentStock).toBe(10);
    expect(theirs!.averageCost).toBe(55);
  });
});

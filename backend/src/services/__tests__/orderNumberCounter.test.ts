/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for OrderService.getNextOrderNumber — the atomic order-number counter.
 * Uses mongodb-memory-server (real MongoDB) so $inc atomicity and seeding from
 * existing orders are exercised against a real database.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Order, TakeawayOrder } from '../../models';
import { orderService } from '../index';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Order.deleteMany({});
  await TakeawayOrder.deleteMany({});
  // Drop the counter collection so each test starts from a fresh seed.
  await mongoose.connection.dropCollection('ordercounters').catch(() => undefined);
});

describe('OrderService.getNextOrderNumber', () => {
  it('starts at the default starting number on a fresh database', async () => {
    expect(await orderService.getNextOrderNumber()).toBe(1001);
    expect(await orderService.getNextOrderNumber()).toBe(1002);
    expect(await orderService.getNextOrderNumber()).toBe(1003);
  });

  it('is strictly increasing and never repeats across many calls', async () => {
    const numbers = new Set<number>();
    let prev = 0;
    for (let i = 0; i < 50; i++) {
      const n = await orderService.getNextOrderNumber();
      expect(n).toBeGreaterThan(prev);
      expect(numbers.has(n)).toBe(false);
      numbers.add(n);
      prev = n;
    }
  });

  it('seeds above the highest existing order number so it never regresses', async () => {
    // Existing orders created under the old per-device numbering.
    await Order.create({ orderNumber: 1005, type: 'Dine In', status: 'Paid' });
    await Order.create({ orderNumber: 1010, type: 'Takeaway', status: 'Paid' });
    expect(await orderService.getNextOrderNumber()).toBe(1011);
    expect(await orderService.getNextOrderNumber()).toBe(1012);
  });

  it('also seeds above existing takeaway order numbers (shared series)', async () => {
    await TakeawayOrder.create({ orderNumber: 2007, customerName: 'Guest', amount: 0, status: 'Preparing', paymentStatus: 'Pending' });
    expect(await orderService.getNextOrderNumber()).toBe(2008);
  });

  it('returns a unique number even when two terminals request concurrently', async () => {
    const results = await Promise.all([
      orderService.getNextOrderNumber(),
      orderService.getNextOrderNumber(),
      orderService.getNextOrderNumber(),
      orderService.getNextOrderNumber(),
      orderService.getNextOrderNumber(),
    ]);
    expect(new Set(results).size).toBe(results.length);
  });

  it('uses ONE shared series even when a branchId is supplied (no per-branch counters)', async () => {
    // Regression: per-branch counters seeded from the global max collided with
    // the base series (a branch-scoped website order and a base order both got
    // the same number). Numbering must stay a single restaurant-wide series.
    const branch = new mongoose.Types.ObjectId().toString();
    const n1 = await orderService.getNextOrderNumber(1001, branch);
    const n2 = await orderService.getNextOrderNumber();
    const n3 = await orderService.getNextOrderNumber(1001, branch);
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBe(n1 + 1);
    expect(n3).toBe(n2 + 1);
  });
});

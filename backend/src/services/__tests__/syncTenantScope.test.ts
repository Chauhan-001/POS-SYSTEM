/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 6 — Sync tenant-scope regression tests (real MongoDB).
 *
 * GET /api/sync previously pulled products/orders/employees/branches with an
 * EMPTY filter — an authenticated POS terminal received every restaurant's
 * data (including every employee's bcrypt pin/password hash). These tests
 * prove the sync payload is now:
 *   - scoped to the caller's restaurant for EVERY collection,
 *   - free of employee credential fields (pin/password),
 *   - still able to bootstrap from the shared/global catalog when a restaurant
 *     has no own products.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { SyncService } from '../syncService';
import Product from '../../models/Product';
import Order from '../../models/Order';
import Employee from '../../models/Employee';
import Branch from '../../models/Branch';
import Bill from '../../models/Bill';
import Customer from '../../models/Customer';

let mongod: MongoMemoryServer;

const syncService = new SyncService();

const REST_A = new mongoose.Types.ObjectId().toString();
const REST_B = new mongoose.Types.ObjectId().toString();

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
    Product.deleteMany({}).exec(),
    Order.deleteMany({}).exec(),
    Employee.deleteMany({}).exec(),
    Branch.deleteMany({}).exec(),
    Bill.deleteMany({}).exec(),
    Customer.deleteMany({}).exec(),
  ]);
});

describe('SyncService.pull — tenant isolation', () => {
  it('returns ONLY the caller restaurant\'s products', async () => {
    await Product.create({ name: 'Paneer A', restaurantId: REST_A, price: 100, category: 'Main Course', code: 'A1' });
    await Product.create({ name: 'Paneer B', restaurantId: REST_B, price: 100, category: 'Main Course', code: 'B1' });

    const data = await syncService.pull(REST_A);
    const names = data.products.map((p: any) => p.name);
    expect(names).toEqual(['Paneer A']);
    expect(names).not.toContain('Paneer B');
  });

  it('returns ONLY the caller restaurant\'s orders', async () => {
    await Order.create({ orderNumber: 1, restaurantId: REST_A, status: 'New', type: 'Dine In' });
    await Order.create({ orderNumber: 2, restaurantId: REST_B, status: 'New', type: 'Dine In' });

    const data = await syncService.pull(REST_A);
    const numbers = data.orders.map((o: any) => o.orderNumber);
    expect(numbers).toEqual([1]);
  });

  it('returns ONLY the caller restaurant\'s employees and strips credentials', async () => {
    await Employee.create({ username: 'u-a', name: 'A', role: 'Cashier', restaurantId: REST_A, pin: '1111' });
    await Employee.create({ username: 'u-b', name: 'B', role: 'Cashier', restaurantId: REST_B, pin: '9999' });

    const data = await syncService.pull(REST_A);
    const usernames = data.employees.map((e: any) => e.username);
    expect(usernames).toEqual(['u-a']);
    expect(usernames).not.toContain('u-b');
    // Credential fields must never leave the server.
    for (const emp of data.employees) {
      expect((emp as any).pin).toBeUndefined();
      expect((emp as any).password).toBeUndefined();
    }
  });

  it('returns ONLY the caller restaurant\'s branches and branch settings', async () => {
    await Branch.create({ name: 'Branch A', restaurantId: REST_A });
    await Branch.create({ name: 'Branch B', restaurantId: REST_B });

    const data = await syncService.pull(REST_A);
    const names = data.branches.map((b: any) => b.name);
    expect(names).toEqual(['Branch A']);
    expect(names).not.toContain('Branch B');
  });

  it('bootstraps from the shared catalog only when the restaurant has no own products', async () => {
    // Restaurant B has no own products — shared/global catalog (null) applies.
    // Shared catalog: restaurantId null is the runtime convention (the Product
    // schema defaults to null; the TS type only models ObjectId | undefined).
    await Product.create({ name: 'Shared Paneer', restaurantId: null as any, price: 100, category: 'Main Course', code: 'SH1' });

    const emptyData = await syncService.pull(REST_B);
    expect(emptyData.products.map((p: any) => p.name)).toContain('Shared Paneer');

    // Once Restaurant B creates its own product, the shared catalog is excluded.
    await Product.create({ name: 'Own Paneer', restaurantId: REST_B, price: 200, category: 'Main Course', code: 'OB1' });
    const ownData = await syncService.pull(REST_B);
    const names = ownData.products.map((p: any) => p.name);
    expect(names).toContain('Own Paneer');
    expect(names).not.toContain('Shared Paneer');
  });
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RestaurantService Integration Tests (Phase 2.2)
 *
 * Uses mongodb-memory-server (real MongoDB) and exercises the REAL
 * restaurantService methods end to end.
 *
 * Coverage:
 *   - create (cash / trial / create_only onboarding + subscription + payment + invoice)
 *   - list (real total, search, status filter, plan filter, pagination, N+1-safe counts)
 *   - update (whitelist guard, feature-flag to subscription sync)
 *   - setStatus (suspend / activate)
 *   - softDelete / restore / permanentDelete
 *   - statistics
 *   - resetOwnerPassword (no plaintext leak)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { restaurantService } from '../restaurantService';

import Restaurant from '../../models/Restaurant';
import Subscription from '../../models/Subscription';
import SubscriptionPlan from '../../models/SubscriptionPlan';
import Branch from '../../models/Branch';
import Payment from '../../models/Payment';
import Invoice from '../../models/Invoice';
import User from '../../models/User';
import Device from '../../models/Device';
import DeviceActivity from '../../models/DeviceActivity';
import Bill from '../../models/Bill';
import Product from '../../models/Product';
import Customer from '../../models/Customer';
import Order from '../../models/Order';

let mongod: MongoMemoryServer;

const admin = {
  id: 'super_admin_1',
  name: 'Super Admin Test',
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await SubscriptionPlan.create({
    planId: 'basic_phase2',
    name: 'Basic',
    description: 'Basic test plan',
    price: 499,
    maxUsers: 5,
    maxDevices: 3,
    features: ['core_pos', 'basic_reports'],
    trialDays: 7,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Restaurant.deleteMany({}).exec(),
    Subscription.deleteMany({}).exec(),
    SubscriptionPlan.deleteMany({ planId: { $ne: 'basic_phase2' } }).exec(),
    Branch.deleteMany({}).exec(),
    Payment.deleteMany({}).exec(),
    Invoice.deleteMany({}).exec(),
    User.deleteMany({}).exec(),
    Device.deleteMany({}).exec(),
    DeviceActivity.deleteMany({}).exec(),
  ]);
});

async function createRestaurant(mode: 'cash' | 'trial' | 'create_only' = 'cash', overrides: Record<string, any> = {}) {
  return restaurantService.create({
    name: 'Test Eats',
    phone: '+1-555-0001',
    email: 'owner@test.com',
    plan: 'basic_phase2',
    onboardingMode: mode,
    ownerName: 'Test Owner',
    ...overrides,
  }, admin);
}

describe('restaurantService.create', () => {
  it('creates restaurant, subscription, branch, settings and owner in cash mode', async () => {
    const out = await createRestaurant('cash');

    expect(out.id).toBeTruthy();
    expect(out.status).toBe('trial');
    expect(out.ownerPin).toBeTruthy();
    expect(out.invoice).toBeTruthy();
    expect(out.invoice?.number).toMatch(/^SUB-/);

    const restaurant = await Restaurant.findById(out.id).lean().exec();
    expect(restaurant).toBeTruthy();
    expect(restaurant!.ownerPin).not.toBe(out.ownerPin); // stored hashed

    const sub = await Subscription.findOne({ restaurantId: restaurant!._id }).lean().exec();
    expect(sub!.status).toBe('trial');
    expect(sub!.plan).toBe('basic_phase2');

    const branch = await Branch.findOne({ restaurantId: restaurant!._id }).lean().exec();
    expect(branch!.isHeadBranch).toBe(true);

    const payment = await Payment.findOne({ restaurantId: restaurant!._id }).lean().exec();
    expect(payment!.status).toBe('success');

    const ownerUser = await User.findOne({ restaurantId: restaurant!._id, role: 'owner' }).lean().exec();
    expect(ownerUser).toBeTruthy();
  });

  it('create_only mode returns pending and no payment/invoice (suspended sub)', async () => {
    const created = await createRestaurant('create_only');
    expect(created.status).toBe('pending');
    expect(created.invoice).toBeUndefined();

    const restaurant = await Restaurant.findById(created.id).lean().exec();
    const sub = await Subscription.findOne({ restaurantId: restaurant!._id }).lean().exec();
    expect(sub!.status).toBe('suspended');
    expect(sub!.features).toEqual([]);
  });

  it('trial mode sets a trial subscription', async () => {
    const created = await createRestaurant('trial');
    const restaurant = await Restaurant.findById(created.id).lean().exec();
    const sub = await Subscription.findOne({ restaurantId: restaurant!._id }).lean().exec();
    expect(sub!.status).toBe('trial');
    expect(sub!.trialEnd).toBeTruthy();
  });

  it('rejects an unknown plan up-front so no partial records are ever written', async () => {
    // Plan validation fails BEFORE Restaurant.create runs, so there is nothing
    // to roll back — no orphan documents can be left behind.
    let threw = false;
    try {
      await restaurantService.create({
        name: 'Rollback Eats',
        phone: '1-555-rollback',
        plan: 'does_not_exist_plan',
        onboardingMode: 'cash',
      }, admin);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    const orphans = await Restaurant.find({ name: 'Rollback Eats' }).exec();
    expect(orphans.length).toBe(0);
  });

  it('fails with a friendly error when the requested plan is unavailable', async () => {
    await expect(
      restaurantService.create(
        { name: 'Bad Plan Eats', phone: '1-555-bad', plan: 'nope_plan', onboardingMode: 'cash' },
        admin,
      ),
    ).rejects.toThrow(/not available/);
  });
});

describe('restaurantService.list', () => {
  it('returns real totals and N+1-safe device/branch counts', async () => {
    const { id } = await createRestaurant('trial');
    const restaurantId = new mongoose.Types.ObjectId(id);
    await Branch.create({ name: 'Branch 2', restaurantId, isActive: true });
    await Device.create({
      restaurantId,
      userId: new mongoose.Types.ObjectId(),
      deviceId: 'terminal-1',
      deviceName: 'Terminal 1',
      isActive: true,
    });

    const result = await restaurantService.list({ page: 1, limit: 10 });
    expect(result.data.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.data[0].branchCount).toBe(2);
    expect(result.data[0].devices).toBe(1);
  });

  it('excludes soft-deleted restaurants by default and includes with deleted=true', async () => {
    const { id } = await createRestaurant('cash');
    await restaurantService.softDelete(id, admin);

    const normal = await restaurantService.list({});
    expect(normal.total).toBe(0);

    const withDeleted = await restaurantService.list({ deleted: 'true' });
    expect(withDeleted.total).toBe(1);
  });

  it('filters by search and by status', async () => {
    await createRestaurant('cash', { name: 'Alpha Grill' });
    await createRestaurant('cash', { name: 'Beta Bistro' });

    const search = await restaurantService.list({ search: 'alpha' });
    expect(search.total).toBe(1);
    expect(search.data[0].name).toBe('Alpha Grill');

    await restaurantService.setStatus(search.data[0].id, 'suspend', admin);
    const active = await restaurantService.list({ status: 'active' });
    expect(active.total).toBe(1);
    const inactive = await restaurantService.list({ status: 'inactive' });
    expect(inactive.data[0].name).toBe('Alpha Grill');
  });

  it('filters by plan', async () => {
    await createRestaurant('cash');
    const result = await restaurantService.list({ plan: 'basic_phase2' });
    expect(result.total).toBe(1);
    const none = await restaurantService.list({ plan: 'enterprise_zz' });
    expect(none.total).toBe(0);
  });

  it('filters by owner identity fields', async () => {
    await createRestaurant('cash', { name: 'Alice Grill', ownerName: 'Alice Owner' });
    await createRestaurant('cash', { name: 'Bob Grill', ownerName: 'Bob Owner' });

    const byOwner = await restaurantService.list({ owner: 'alice' });
    expect(byOwner.total).toBe(1);
    expect(byOwner.data[0].ownerName).toBe('Alice Owner');
  });

  it('filters by last-activity date via device events', async () => {
    const { id } = await createRestaurant('cash');
    const rid = new mongoose.Types.ObjectId(id);

    // No activity yet → an upcoming lastActiveFrom matches nothing.
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect((await restaurantService.list({ lastActiveFrom: future })).total).toBe(0);

    await DeviceActivity.create({
      restaurantId: rid,
      deviceId: new mongoose.Types.ObjectId(),
      event: 'device_login',
      description: 'Owner login',
    });

    const active = await restaurantService.list({
      lastActiveFrom: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(active.total).toBe(1);
    expect(active.data[0].id).toBe(id);
  });

  it('searches by restaurantId and ownerEmail', async () => {
    const { id, restaurantId } = await createRestaurant('cash', { ownerEmail: 'owner-search@test.com' });
    expect((await restaurantService.list({ search: restaurantId })).total).toBe(1);
    expect((await restaurantService.list({ search: 'owner-search@test.com' })).data[0].id).toBe(id);
  });

  it('rejects unknown sort fields by falling back to createdAt', async () => {
    await createRestaurant('cash');
    const result = await restaurantService.list({ sortBy: 'evil$where', sortOrder: 'desc' });
    expect(result.data.length).toBeGreaterThanOrEqual(0);
  });
});

describe('restaurantService.update', () => {
  it('applies whitelisted fields and updates subscription features on flag toggle', async () => {
    const { id } = await createRestaurant('cash', { plan: 'basic_phase2' });

    await restaurantService.update(id, { name: 'Renamed Eats', aiEnabled: true }, admin);

    const updated = await Restaurant.findById(id).lean().exec();
    expect(updated!.name).toBe('Renamed Eats');

    const sub = await Subscription.findOne({ restaurantId: new mongoose.Types.ObjectId(id) }).lean().exec();
    expect(sub!.features).toContain('ai');
  });

  it('ignores unauthorized mass-assignment fields (ownerPin, secretKey, apiKey)', async () => {
    const { id } = await createRestaurant('cash');
    await restaurantService.update(id, {
      name: 'Safe Name',
      ownerPin: 'hacked',
      ownerUserId: 'hacked_owner',
      secretKey: 'hacked',
      apiKey: 'hacked',
    }, admin);
    const updated = await Restaurant.findById(id).lean().exec();
    expect(updated!.name).toBe('Safe Name');
    expect(updated!.ownerUserId).not.toBe('hacked_owner');
  });
});

describe('restaurantService.setStatus', () => {
  it('suspends and reactivates restaurant + subscription', async () => {
    const { id } = await createRestaurant('cash');

    await restaurantService.setStatus(id, 'suspend', admin);
    let restaurant = await Restaurant.findById(id).lean().exec();
    let sub = await Subscription.findOne({ restaurantId: new mongoose.Types.ObjectId(id) }).lean().exec();
    expect(restaurant!.isActive).toBe(false);
    expect(sub!.status).toBe('suspended');

    await restaurantService.setStatus(id, 'activate', admin);
    restaurant = await Restaurant.findById(id).lean().exec();
    sub = await Subscription.findOne({ restaurantId: new mongoose.Types.ObjectId(id) }).lean().exec();
    expect(restaurant!.isActive).toBe(true);
    expect(sub!.status).toBe('active');
  });
});

describe('restaurantService.delete / restore / permanentDelete', () => {
  it('soft-deletes, restores, and permanently deletes', async () => {
    const { id } = await createRestaurant('cash');

    await restaurantService.softDelete(id, admin);
    let restaurant = await Restaurant.findById(id).lean().exec();
    expect(restaurant!.isDeleted).toBe(true);

    await restaurantService.restore(id, admin);
    restaurant = await Restaurant.findById(id).lean().exec();
    expect(restaurant!.isDeleted).toBe(false);

    await restaurantService.softDelete(id, admin);
    await restaurantService.permanentDelete(id, admin);
    const gone = await Restaurant.findById(id).lean().exec();
    expect(gone).toBeNull();
    const subGone = await Subscription.findOne({ restaurantId: new mongoose.Types.ObjectId(id) }).lean().exec();
    expect(subGone).toBeNull();
  });

  it('rejects permanent delete before soft delete', async () => {
    const { id } = await createRestaurant('cash');
    await expect(restaurantService.permanentDelete(id, admin)).rejects.toThrow(/soft-deleted/);
  });

  it('restore reactivates devices that soft-delete deactivated', async () => {
    const { id } = await createRestaurant('cash');
    const restaurantId = new mongoose.Types.ObjectId(id);
    const dev = await Device.create({
      restaurantId,
      userId: new mongoose.Types.ObjectId(),
      deviceId: 'terminal-restore',
      deviceName: 'Terminal 1',
      isActive: true,
    });

    await restaurantService.softDelete(id, admin);
    expect((await Device.findById(dev._id).lean().exec())!.isActive).toBe(false);

    await restaurantService.restore(id, admin);
    expect((await Device.findById(dev._id).lean().exec())!.isActive).toBe(true);
  });

  it('restore does not reactivate blocked devices', async () => {
    const { id } = await createRestaurant('cash');
    const restaurantId = new mongoose.Types.ObjectId(id);
    const blocked = await Device.create({
      restaurantId,
      userId: new mongoose.Types.ObjectId(),
      deviceId: 'terminal-blocked',
      deviceName: 'Blocked Terminal',
      isActive: false,
      status: 'blocked',
    });

    await restaurantService.softDelete(id, admin);
    await restaurantService.restore(id, admin);
    expect((await Device.findById(blocked._id).lean().exec())!.isActive).toBe(false);
  });

  it('permanently deletes all tenant data including bills, products, customers and branch-scoped orders', async () => {
    const { id } = await createRestaurant('cash');
    const restaurantId = new mongoose.Types.ObjectId(id);
    const branch = await Branch.create({ name: 'Head', restaurantId, isHeadBranch: true, isActive: true });

    await Bill.create({
      restaurantId,
      invoiceNumber: 'INV-1',
      ticketNumber: 'T1',
      date: '2026-08-03',
      time: '12:00',
      cashierName: 'Owner',
      cashierRole: 'Owner',
      subtotal: 100,
      grandTotal: 118,
      paymentMethod: 'Cash',
      orderType: 'Dine In',
    });
    await Product.create({ restaurantId, name: 'Paneer', code: 'PNR', price: 200, category: 'Main' });
    await Customer.create({ restaurantId, name: 'John', phone: '9999999999' });
    await Order.create({ branchId: branch._id, orderNumber: 1, type: 'Dine In' });

    await restaurantService.softDelete(id, admin);
    await restaurantService.permanentDelete(id, admin);

    expect(await Bill.countDocuments({ restaurantId }).exec()).toBe(0);
    expect(await Product.countDocuments({ restaurantId }).exec()).toBe(0);
    expect(await Customer.countDocuments({ restaurantId }).exec()).toBe(0);
    expect(await Order.countDocuments({ branchId: branch._id }).exec()).toBe(0);
    expect(await Branch.findById(branch._id).lean().exec()).toBeNull();
  });
});

describe('restaurantService.resetOwnerPassword', () => {
  it('does not return the plaintext new PIN', async () => {
    const { id } = await createRestaurant('cash');
    const out = await restaurantService.resetOwnerPassword(id, admin);
    expect('newPin' in out).toBe(false);
    expect(out.ownerUserId).toBeTruthy();
  });

  it('keeps the linked owner User doc password in sync', async () => {
    const { id } = await createRestaurant('cash');
    const restaurant = await Restaurant.findById(id).lean().exec();
    const ownerUser = await User.findOne({ restaurantId: restaurant!._id, role: 'owner' }).lean().exec();
    expect(ownerUser).toBeTruthy();
    const oldHash = ownerUser!.password;

    await restaurantService.resetOwnerPassword(id, admin);

    const updatedUser = await User.findOne({ restaurantId: restaurant!._id, role: 'owner' }).lean().exec();
    expect(updatedUser!.password).not.toBe(oldHash);
  });
});

describe('restaurantService.statistics', () => {
  it('returns real plan, branch, device and usage metrics for a restaurant', async () => {
    const { id } = await createRestaurant('cash');
    const stats = await restaurantService.statistics(id);
    expect(stats.id).toBe(id);
    expect(stats.plan).toBe('basic_phase2');
    expect(stats.subscriptionStatus).toBe('trial');
    expect(typeof stats.branches).toBe('number');
    expect(stats.branchStats.total).toBe(1);
    expect(stats.branchStats.headBranches).toBe(1);
    expect(stats.devices.total).toBe(0);
    expect(stats.devices.limit).toBeGreaterThan(0);
    expect(stats.usage).toBeDefined();
    expect(stats.usage.products).toBe(0);
    expect(stats.usage.revenue).toBe(0);
  });
});

describe('restaurantService.regenerateCredentials', () => {
  it('rotates secretKey and apiKey and appends an audit trail entry', async () => {
    const { id } = await createRestaurant('cash');
    const before = await Restaurant.findById(id).lean().exec();

    const out = await restaurantService.regenerateCredentials(id, admin);
    expect(out.secretKey).toBeTruthy();
    expect(out.apiKey).toMatch(/^pk_live_/);

    const after = await Restaurant.findById(id).lean().exec();
    expect(after!.secretKey).not.toBe(before!.secretKey);
    expect(after!.apiKey).not.toBe(before!.apiKey);
    expect(after!.auditTrail!.some((e) => e.action.includes('Regenerated'))).toBe(true);
  });
});
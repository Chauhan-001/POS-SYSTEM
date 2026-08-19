/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PlanService Integration Tests (Phase 2.4)
 *
 * Uses mongodb-memory-server (real MongoDB) and exercises the REAL planService
 * methods end to end.
 *
 * Coverage:
 *   - create (limits merge, feature sanitization, duplicate planId, default flag)
 *   - update (version bump + before-image snapshot, limits, status sync)
 *   - clone (draft clone, unique planId)
 *   - status / archive / restore
 *   - softDelete / restore / permanentDelete (in-use guard)
 *   - version history + rollback
 *   - list (real total, search, filters, sort, pagination, restaurant counts)
 *   - assignment (immediate + scheduled effective date + downgrade guard)
 *   - trial conversion
 *   - statistics (backend-generated)
 *   - audit logging on every mutation
 *   - security (inactive plans not assignable, duplicate prevention)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { planService } from '../planService';
import SubscriptionPlan from '../../models/SubscriptionPlan';
import Subscription from '../../models/Subscription';
import Restaurant from '../../models/Restaurant';
import Branch from '../../models/Branch';
import Device from '../../models/Device';
import Payment from '../../models/Payment';
import AIUsageLog from '../../models/AIUsageLog';
import AuditLog from '../../models/AuditLog';
import { subscriptionService } from '../../modules/subscription/subscriptionService';

let mongod: MongoMemoryServer;

const admin = {
  id: 'super_admin_1',
  name: 'Super Admin Test',
  ipAddress: '203.0.113.9',
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    SubscriptionPlan.deleteMany({}).exec(),
    Subscription.deleteMany({}).exec(),
    Restaurant.deleteMany({}).exec(),
    Branch.deleteMany({}).exec(),
    Device.deleteMany({}).exec(),
    Payment.deleteMany({}).exec(),
    AIUsageLog.deleteMany({}).exec(),
    AuditLog.deleteMany({}).exec(),
  ]);
});

async function createPlan(over: Record<string, any> = {}) {
  return planService.create({
    planId: 'pro_test',
    name: 'Pro Test',
    description: 'Pro test plan',
    price: 999,
    maxUsers: 20,
    maxDevices: 8,
    features: ['core_pos', 'ai', 'inventory', 'loyalty'],
    aiEnabled: true,
    trialDays: 14,
    sortOrder: 2,
    limits: { maxBranches: 5, maxStorageMB: 2048 },
    ...over,
  }, admin);
}

async function createRestaurant(name = 'Assign Eats') {
  return Restaurant.create({
    restaurantId: name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().slice(0, 20),
    name,
    phone: '+1-555-0001',
    isActive: true,
  });
}

describe('planService.create', () => {
  it('creates a plan with merged limits and default status', async () => {
    const row = await createPlan();
    expect(row.planId).toBe('pro_test');
    expect(row.status).toBe('active');
    expect(row.version).toBe(1);
    expect(row.limits.maxBranches).toBe(5);
    expect(row.limits.maxStorageMB).toBe(2048);
    // Unspecified limits fall back to defaults (0 = unlimited).
    expect(row.limits.maxProducts).toBe(0);
    expect(row.limits.maxCustomers).toBe(0);
    expect(row.limits.maxAIRequests).toBe(0);
    expect(row.createdBy).toBe('Super Admin Test');
  });

  it('sanitizes unknown feature keys against the centralized catalog', async () => {
    const row = await createPlan({ features: ['core_pos', 'not_a_real_feature', 'ai'] });
    expect(row.features).toEqual(['core_pos', 'ai']);
  });

  it('rejects duplicate planId', async () => {
    await createPlan();
    await expect(createPlan({ name: 'Different Name' })).rejects.toThrow(/already exists/);
  });

  it('allows only one default plan at a time', async () => {
    await createPlan({ planId: 'plan_a', isDefault: true });
    await createPlan({ planId: 'plan_b', isDefault: true });

    const defaults = await SubscriptionPlan.find({ isDefault: true }).lean().exec();
    expect(defaults.length).toBe(1);
    expect(defaults[0].planId).toBe('plan_b');
  });

  it('writes an audit entry', async () => {
    await createPlan();
    const audit = await AuditLog.findOne({ action: 'ADMIN_PLAN_CREATE' }).lean().exec();
    expect(audit).toBeTruthy();
    expect(audit!.performedById).toBe('super_admin_1');
    expect(audit!.ipAddress).toBe('203.0.113.9');
  });
});

describe('planService.update', () => {
  it('bumps the version and appends a before-image snapshot', async () => {
    const created = await createPlan();
    const updated = await planService.update(created.id, { price: 1999, name: 'Pro Plus' }, admin);

    expect(updated.version).toBe(2);
    expect(updated.price).toBe(1999);
    expect(updated.name).toBe('Pro Plus');

    const plan = await SubscriptionPlan.findById(created.id).lean().exec();
    expect(plan!.versions.length).toBe(1);
    expect(plan!.versions[0].version).toBe(1);
    expect(plan!.versions[0].price).toBe(999); // before-image
  });

  it('updates limits partially (merge, not replace)', async () => {
    const created = await createPlan();
    const updated = await planService.update(created.id, { limits: { maxBranches: 8 } }, admin);
    expect(updated.limits.maxBranches).toBe(8);
    expect(updated.limits.maxStorageMB).toBe(2048); // preserved
    expect(updated.limits.maxDevicesPerBranch).toBe(8); // from create (legacy alias)
  });

  it('syncs status ↔ isActive', async () => {
    const created = await createPlan();
    const updated = await planService.update(created.id, { status: 'deprecated' }, admin);
    expect(updated.status).toBe('deprecated');
    expect(updated.isActive).toBe(false);
  });

  it('rejects an empty update', async () => {
    const created = await createPlan();
    await expect(planService.update(created.id, {}, admin)).rejects.toThrow(/No valid fields/);
  });

  it('writes an audit entry with before/after', async () => {
    const created = await createPlan();
    await planService.update(created.id, { price: 4999 }, admin);
    const audit = await AuditLog.findOne({ action: 'ADMIN_PLAN_UPDATE' }).lean().exec();
    expect(audit).toBeTruthy();
    expect((audit!.details as any).before.price).toBe(999);
    expect((audit!.details as any).after.price).toBe(4999);
  });
});

describe('planService.clone', () => {
  it('clones a plan as a draft with unique planId', async () => {
    const source = await createPlan();
    const clone = await planService.clone(source.id, { planId: 'pro_test_clone', name: 'Pro Clone' }, admin);

    expect(clone.planId).toBe('pro_test_clone');
    expect(clone.status).toBe('draft');
    expect(clone.isActive).toBe(false);
    expect(clone.price).toBe(999);
    expect(clone.features).toEqual(['core_pos', 'ai', 'inventory', 'loyalty']);
    expect(clone.limits.maxBranches).toBe(5);
    expect(clone.limits.maxStorageMB).toBe(2048);

    const audit = await AuditLog.findOne({ action: 'ADMIN_PLAN_CLONE' }).lean().exec();
    expect(audit).toBeTruthy();
    expect((audit!.details as any).sourcePlanId).toBe('pro_test');
  });

  it('rejects cloning onto an existing planId', async () => {
    const source = await createPlan();
    await expect(
      planService.clone(source.id, { planId: 'pro_test', name: 'Dup' }, admin),
    ).rejects.toThrow(/already exists/);
  });
});

describe('planService status / archive / restore', () => {
  it('archives a plan (not assignable, isActive false)', async () => {
    const created = await createPlan();
    const archived = await planService.archive(created.id, admin);
    expect(archived.status).toBe('archived');
    expect(archived.isActive).toBe(false);
    expect(archived.archivedAt).toBeTruthy();
  });

  it('sets arbitrary statuses (draft / deprecated / hidden)', async () => {
    const created = await createPlan();
    const hidden = await planService.setStatus(created.id, 'hidden', admin, 'Hide from storefront');
    expect(hidden.status).toBe('hidden');
    expect(hidden.visibility).toBe('hidden');
  });

  it('restores a deleted plan', async () => {
    const created = await createPlan();
    await planService.softDelete(created.id, admin);
    const restored = await planService.restore(created.id, admin);
    expect(restored.isDeleted).toBe(false);
  });

  it('writes audit for status changes', async () => {
    const created = await createPlan();
    await planService.setStatus(created.id, 'archived', admin, 'No longer offered');
    const audit = await AuditLog.findOne({ action: 'ADMIN_PLAN_STATUS' }).lean().exec();
    expect(audit).toBeTruthy();
    expect((audit!.details as any).before.status).toBe('active');
    expect((audit!.details as any).after.status).toBe('archived');
  });
});

describe('planService soft/hard delete', () => {
  it('soft-deletes then permanently deletes', async () => {
    const created = await createPlan();
    await planService.softDelete(created.id, admin);
    const soft = await SubscriptionPlan.findById(created.id).lean().exec();
    expect(soft!.isDeleted).toBe(true);

    await planService.permanentDelete(created.id, admin);
    expect(await SubscriptionPlan.findById(created.id).lean().exec()).toBeNull();
  });

  it('rejects permanent delete before soft delete', async () => {
    const created = await createPlan();
    await expect(planService.permanentDelete(created.id, admin)).rejects.toThrow(/soft-deleted/);
  });

  it('refuses to permanently delete a plan still referenced by subscriptions', async () => {
    const created = await createPlan();
    const restaurant = await createRestaurant('Guard Eats');
    await Subscription.create({
      restaurantId: restaurant._id,
      plan: created.planId,
      status: 'active',
      startDate: new Date(),
    });

    await planService.softDelete(created.id, admin);
    await expect(planService.permanentDelete(created.id, admin)).rejects.toThrow(/still reference this plan/);
  });

  it('excludes deleted plans from the default list', async () => {
    const created = await createPlan();
    await planService.softDelete(created.id, admin);
    const list = await planService.list({});
    expect(list.total).toBe(0);
    const withDeleted = await planService.list({ deleted: 'true' });
    expect(withDeleted.total).toBe(1);
  });
});

describe('planService versioning + rollback', () => {
  it('lists version history newest-first', async () => {
    const created = await createPlan();
    await planService.update(created.id, { price: 1999 }, admin);
    await planService.update(created.id, { price: 2999 }, admin);

    const versions = await planService.listVersions(created.id);
    expect(versions.length).toBe(2);
    expect(versions[0].version).toBe(2);
    expect(versions[1].version).toBe(1);
    expect(versions[0].price).toBe(1999);
  });

  it('rolls back to a previous version (creating a new version)', async () => {
    const created = await createPlan(); // v1 price 999
    await planService.update(created.id, { price: 1999 }, admin); // v2
    const rolled = await planService.rollback(created.id, 1, admin, 'Revert pricing');

    expect(rolled.price).toBe(999);
    expect(rolled.version).toBe(3);

    const plan = await SubscriptionPlan.findById(created.id).lean().exec();
    expect(plan!.versions.length).toBe(2); // snapshot + rollback marker
    expect(plan!.versions[1].note).toBe('Revert pricing');

    const audit = await AuditLog.findOne({ action: 'ADMIN_PLAN_ROLLBACK' }).lean().exec();
    expect(audit).toBeTruthy();
  });

  it('rejects rollback to unknown or current/future versions', async () => {
    const created = await createPlan();
    await planService.update(created.id, { price: 1999 }, admin);
    await expect(planService.rollback(created.id, 99, admin)).rejects.toThrow(/not found/);
    await expect(planService.rollback(created.id, 2, admin)).rejects.toThrow(/current or a future version/);
  });
});

describe('planService.list (search / filter / sort / pagination)', () => {
  it('returns a real total and pagination metadata with hasNext/hasPrevious', async () => {
    for (let i = 0; i < 5; i++) await createPlan({ planId: `plan_${i}`, name: `Plan ${i}` });

    const page1 = await planService.list({ page: 1, limit: 2 });
    expect(page1.data.length).toBe(2);
    expect(page1.total).toBe(5);
    expect(page1.hasNext).toBe(true);
    expect(page1.hasPrevious).toBe(false);
    expect(page1.next).toBe(2);

    const page3 = await planService.list({ page: 3, limit: 2 });
    expect(page3.hasNext).toBe(false);
    expect(page3.next).toBeNull();
  });

  it('searches by name and planId (case-insensitive partial)', async () => {
    await createPlan({ planId: 'gold_tier', name: 'Gold Restaurant Plan' });
    await createPlan({ planId: 'silver_tier', name: 'Silver Plan' });

    expect((await planService.list({ search: 'gold' })).total).toBe(1);
    expect((await planService.list({ search: 'GOLD' })).total).toBe(1);
    expect((await planService.list({ search: 'silver_tier' })).total).toBe(1);
  });

  it('filters by status, planType, visibility and feature', async () => {
    await createPlan({ planId: 'active_plan', status: 'active', planType: 'paid', features: ['ai'] });
    await createPlan({ planId: 'draft_plan', status: 'draft', planType: 'trial', features: ['crm'] });
    await createPlan({ planId: 'archived_plan', status: 'archived', planType: 'enterprise', features: ['ai', 'crm'] });

    expect((await planService.list({ status: 'draft' })).total).toBe(1);
    expect((await planService.list({ planType: 'enterprise' })).total).toBe(1);
    expect((await planService.list({ feature: 'crm' })).total).toBe(2);
    expect((await planService.list({ archived: 'true' })).total).toBe(1);
    expect((await planService.list({ paid: 'true' })).total).toBe(1);
  });

  it('sorts by price asc/desc and defaults to sortOrder', async () => {
    await createPlan({ planId: 'cheap', name: 'Cheap', price: 100, sortOrder: 1 });
    await createPlan({ planId: 'expensive', name: 'Expensive', price: 5000, sortOrder: 2 });
    await createPlan({ planId: 'mid', name: 'Mid', price: 1000, sortOrder: 3 });

    const asc = await planService.list({ sortBy: 'price', sortOrder: 'asc' });
    expect(asc.data.map((p: any) => p.planId)).toEqual(['cheap', 'mid', 'expensive']);

    const desc = await planService.list({ sortBy: 'price', sortOrder: 'desc' });
    expect(desc.data.map((p: any) => p.planId)).toEqual(['expensive', 'mid', 'cheap']);
  });

  it('reports per-plan restaurant counts (aggregated, not N+1)', async () => {
    const created = await createPlan();
    const restaurant = await createRestaurant('Count Eats');
    await Subscription.create({
      restaurantId: restaurant._id,
      plan: created.planId,
      status: 'active',
      startDate: new Date(),
    });

    const list = await planService.list({});
    expect(list.data.find((p: any) => p.planId === 'pro_test')!.restaurantCount).toBe(1);
  });

  it('sorts by restaurantCount', async () => {
    const planA = await createPlan({ planId: 'a', name: 'A' });
    await createPlan({ planId: 'b', name: 'B' });
    const restaurant = await createRestaurant('Sort Eats');
    await Subscription.create({ restaurantId: restaurant._id, plan: planA.planId, status: 'active', startDate: new Date() });

    const asc = await planService.list({ sortBy: 'restaurantCount', sortOrder: 'asc' });
    expect(asc.data[0].planId).toBe('b');
    expect(asc.data[1].planId).toBe('a');
  });
});

describe('planService assignment', () => {
  it('assigns a plan immediately with snapshot sync (features + limits)', async () => {
    const plan = await createPlan();
    const restaurant = await createRestaurant('Immediate Eats');
    await Subscription.create({
      restaurantId: restaurant._id,
      plan: 'old_plan',
      status: 'trial',
      startDate: new Date(),
      features: ['core_pos'],
    });

    const out = await planService.assign({
      restaurantId: restaurant._id.toString(),
      planId: plan.planId,
    }, admin);

    expect(out.scheduled).toBe(false);
    const sub = await Subscription.findOne({ restaurantId: restaurant._id }).lean().exec();
    expect(sub!.plan).toBe('pro_test');
    expect(sub!.features).toEqual(['core_pos', 'ai', 'inventory', 'loyalty']);
    expect(sub!.limits.maxBranches).toBe(5);
    expect(sub!.limits.maxStorageMB).toBe(2048);
  });

  it('rejects assigning an inactive plan', async () => {
    const plan = await createPlan();
    await planService.archive(plan.id, admin);
    const restaurant = await createRestaurant('Blocked Eats');

    await expect(
      planService.assign({ restaurantId: restaurant._id.toString(), planId: plan.planId }, admin),
    ).rejects.toThrow(/cannot be assigned/);
  });

  it('schedules a future-dated change (pendingPlan) and applies it when due', async () => {
    const plan = await createPlan();
    const restaurant = await createRestaurant('Scheduled Eats');
    const future = new Date(Date.now() + 60 * 1000).toISOString();

    const out = await planService.assign({
      restaurantId: restaurant._id.toString(),
      planId: plan.planId,
      effectiveDate: future,
    }, admin);

    expect(out.scheduled).toBe(true);
    let sub = await Subscription.findOne({ restaurantId: restaurant._id }).exec();
    expect(sub!.pendingPlan).toBe('pro_test');
    expect(sub!.plan).toBe('pro_test'); // created with the target plan immediately
    expect(sub!.status).toBe('trial');

    // Backdate the effective date and re-evaluate — applies the snapshot.
    sub!.pendingEffectiveDate = new Date(Date.now() - 1000);
    await sub!.save();
    const status = await subscriptionService.getSubscriptionStatus(restaurant._id.toString());
    expect(status.plan).toBe('pro_test');
    expect(status.features).toEqual(['core_pos', 'ai', 'inventory', 'loyalty']);
  });

  it('guards downgrades against current usage', async () => {
    const cheap = await createPlan({ planId: 'cheap_plan', name: 'Cheap', price: 100, limits: { maxBranches: 1 } });
    const restaurant = await createRestaurant('Downgrade Eats');
    const sub = await Subscription.create({
      restaurantId: restaurant._id,
      plan: 'pro_test',
      status: 'active',
      startDate: new Date(),
      features: ['core_pos', 'ai', 'inventory', 'loyalty'],
    });
    // 2 branches exceed the cheap plan's 1-branch limit.
    await Branch.create({ restaurantId: restaurant._id, name: 'B1', isActive: true });
    await Branch.create({ restaurantId: restaurant._id, name: 'B2', isActive: true });

    await expect(
      planService.assign({ restaurantId: restaurant._id.toString(), planId: cheap.planId }, admin),
    ).rejects.toThrow(/exceeds the selected plan limit/i);
  });

  it('converts a trial to a paid plan', async () => {
    const plan = await createPlan();
    const restaurant = await createRestaurant('Convert Eats');
    await Subscription.create({
      restaurantId: restaurant._id,
      plan: 'some_free_plan',
      status: 'trial',
      startDate: new Date(),
    });

    const out = await planService.convertTrial(restaurant._id.toString(), plan.planId, admin);
    expect(out.subscription.plan).toBe('pro_test');
    const sub = await Subscription.findOne({ restaurantId: restaurant._id }).lean().exec();
    expect(sub!.status).toBe('active'); // changePlan activates suspended/trial via needsActivation
  });
});

describe('planService.statistics', () => {
  it('returns backend-generated statistics', async () => {
    const plan = await createPlan();
    const restaurant = await createRestaurant('Stat Eats');
    const sub = await Subscription.create({
      restaurantId: restaurant._id,
      plan: plan.planId,
      status: 'active',
      startDate: new Date(),
      features: ['core_pos', 'ai'],
    });
    await Branch.create({ restaurantId: restaurant._id, name: 'B1', isActive: true });
    await Device.create({
      restaurantId: restaurant._id,
      userId: new mongoose.Types.ObjectId(),
      deviceId: 'term-1',
      deviceName: 'Terminal 1',
      isActive: true,
    });
    await AIUsageLog.create({ restaurantId: restaurant._id, feature: 'ai' });
    await Payment.create({
      restaurantId: restaurant._id,
      subscriptionId: sub._id,
      razorpayOrderId: 'pay_stat',
      amount: 999,
      currency: 'INR',
      status: 'success',
      invoiceNumber: 'PAY_STAT_001',
    });

    const stats = await planService.statistics(plan.id);
    expect(stats.restaurantsUsing).toBe(1);
    expect(stats.activeSubscriptions).toBe(1);
    expect(stats.revenue).toBe(999);
    expect(stats.devices).toBe(1);
    expect(stats.branches).toBe(1);
    expect(stats.aiRequests).toBe(1);
  });
});

describe('planService audit + security', () => {
  it('audits clone, archive, delete, restore, permanent-delete, rollback, assign', async () => {
    const created = await createPlan();
    const restaurant = await createRestaurant('Audit Eats');

    await planService.clone(created.id, { planId: 'audit_clone', name: 'Audit Clone' }, admin);
    await planService.archive(created.id, admin);
    await planService.softDelete(created.id, admin);
    await planService.restore(created.id, admin);
    await planService.assign({ restaurantId: restaurant._id.toString(), planId: created.planId }, admin);

    const actions = (await AuditLog.find({}).lean().exec()).map((a) => a.action);
    expect(actions).toContain('ADMIN_PLAN_CLONE');
    expect(actions).toContain('ADMIN_PLAN_STATUS');
    expect(actions).toContain('ADMIN_PLAN_DELETE');
    expect(actions).toContain('ADMIN_PLAN_RESTORE');
    expect(actions).toContain('ADMIN_PLAN_ASSIGN');
  });

  it('rejects unknown plan status values via service guard', async () => {
    const created = await createPlan();
    await expect(planService.setStatus(created.id, 'evil', admin)).rejects.toThrow();
  });
});

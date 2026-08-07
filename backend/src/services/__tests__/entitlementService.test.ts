/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EntitlementService Integration Tests
 *
 * These tests use mongodb-memory-server to spin up a real MongoDB instance,
 * seed actual models (Restaurant, Subscription, SubscriptionPlan, Branch,
 * Employee, Table), and exercise the REAL entitlementService methods.
 *
 * Coverage:
 *   - getBranchUsage      (branch counting, details, inactive/deleted filtering)
 *   - canCreateBranch     (limits, features, suspended subscription)
 *   - validatePlanDowngrade (over-limit blocking, unlimited plan)
 *   - canUseFeature       (suspended, missing feature, upgrade message)
 *   - getSubscriptionLimits (null when missing, full object when present)
 *
 * Run: npx vitest run src/services/__tests__/entitlementService.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { entitlementService, EntitlementService } from '../entitlementService';

// ─── Models ───────────────────────────────────────────────────────────────
import Subscription from '../../models/Subscription';
import SubscriptionPlan from '../../models/SubscriptionPlan';
import Branch from '../../models/Branch';
import Employee from '../../models/Employee';
import Table from '../../models/Table';

// ─── Helpers ──────────────────────────────────────────────────────────────
let mongod: MongoMemoryServer;
let restaurantId: mongoose.Types.ObjectId;
let restaurantId2: mongoose.Types.ObjectId;

const professionalPlanId = 'professional_integration';
const enterprisePlanId  = 'enterprise_integration';

async function seedData(): Promise<void> {
  // ---- Restaurant ----
  const Restaurant = (await import('../../models/Restaurant')).default;
  const restaurant = await Restaurant.create({
    restaurantId: 'INTEGRATION_TEST',
    name: 'Integration Test Restaurant',
    phone: '+1-555-INTEG',
    isActive: true,
  });
  restaurantId = restaurant._id as mongoose.Types.ObjectId;

  const restaurant2 = await Restaurant.create({
    restaurantId: 'INTEGRATION_TEST_2',
    name: 'Second Restaurant',
    phone: '+1-555-INTEG2',
    isActive: true,
  });
  restaurantId2 = restaurant2._id as mongoose.Types.ObjectId;

  // ---- Subscription Plans ----
  await SubscriptionPlan.create({
    planId: professionalPlanId,
    name: 'Professional Plan',
    description: 'Integration test plan with 2 branches',
    price: 499,
    maxUsers: 10,
    maxDevices: 3,
    features: ['core_pos', 'basic_reports', 'multi_branch', 'ai'],
    aiEnabled: true,
    trialDays: 7,
    sortOrder: 1,
    isActive: true,
    isDefault: true,
    limits: { maxBranches: 2, maxDevices: 3, maxEmployees: 10 },
  });

  await SubscriptionPlan.create({
    planId: enterprisePlanId,
    name: 'Enterprise Plan',
    description: 'Integration test unlimited plan',
    price: 999,
    maxUsers: 50,
    maxDevices: 10,
    features: ['core_pos', 'basic_reports', 'multi_branch', 'ai', 'analytics'],
    aiEnabled: true,
    trialDays: 7,
    sortOrder: 2,
    isActive: true,
    isDefault: false,
    limits: { maxBranches: 0, maxDevices: 10, maxEmployees: 50 }, // 0 = unlimited
  });

  await SubscriptionPlan.create({
    planId: 'basic_integration',
    name: 'Basic Plan',
    description: 'Single branch, no multi_branch feature',
    price: 199,
    maxUsers: 3,
    maxDevices: 1,
    features: ['core_pos'],  // No multi_branch
    aiEnabled: false,
    trialDays: 7,
    sortOrder: 0,
    isActive: true,
    isDefault: false,
    limits: { maxBranches: 1, maxDevices: 3, maxEmployees: 5 },
  });

  // ---- Subscription (restaurant 1: active, multi-branch plan) ----
  await Subscription.create({
    restaurantId,
    plan: professionalPlanId,
    status: 'active',
    subscriptionStart: new Date(),
    expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    startDate: new Date(),
    maxUsers: 10,
    maxDevices: 3,
    features: ['core_pos', 'basic_reports', 'multi_branch', 'ai'],
    limits: { maxBranches: 2, maxDevices: 3, maxEmployees: 10 },
  });

  // ---- Subscription (restaurant 2: suspended) ----
  await Subscription.create({
    restaurantId: restaurantId2,
    plan: 'basic_integration',
    status: 'suspended',
    expiryDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    maxUsers: 3,
    maxDevices: 1,
    features: ['core_pos'],
    limits: { maxBranches: 1, maxDevices: 3, maxEmployees: 5 },
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  await seedData();
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Clean up branch/employee/table data between tests
  // but keep the seeded restaurant, subscription plan, and subscription records
  await Branch.deleteMany({}).exec();
  await Employee.deleteMany({}).exec();
  await Table.deleteMany({}).exec();
});

// =========================================================================
// getBranchUsage
// =========================================================================

describe('getBranchUsage', () => {
  it('returns zero usage when no branches exist', async () => {
    const result = await entitlementService.getBranchUsage(restaurantId.toString());

    expect(result.plan).toBe('Professional Plan');
    expect(result.maxBranches).toBe(2);
    expect(result.usage.totalBranches).toBe(0);
    expect(result.usage.activeBranches).toBe(0);
    expect(result.usage.remainingBranches).toBe(2);
    expect(result.branches).toHaveLength(0);
  });

  it('returns correct count for a single branch', async () => {
    await Branch.create({
      restaurantId,
      name: 'Downtown',
      isHeadBranch: true,
      isActive: true,
    });

    const result = await entitlementService.getBranchUsage(restaurantId.toString());

    expect(result.usage.totalBranches).toBe(1);
    expect(result.usage.activeBranches).toBe(1);
    expect(result.branches).toHaveLength(1);
    expect(result.branches[0].name).toBe('Downtown');
    expect(result.branches[0].isHeadBranch).toBe(true);
  });

  it('excludes deleted branches from count', async () => {
    await Branch.create({ restaurantId, name: 'Active Branch', isActive: true });
    await Branch.create({ restaurantId, name: 'Deleted Branch', isActive: false, isDeleted: true, deletedAt: new Date() });

    const result = await entitlementService.getBranchUsage(restaurantId.toString());

    expect(result.usage.totalBranches).toBe(1);
    expect(result.usage.activeBranches).toBe(1);
  });

  it('distinguishes active from inactive branches', async () => {
    await Branch.create({ restaurantId, name: 'Open Branch', isActive: true });
    await Branch.create({ restaurantId, name: 'Closed Branch', isActive: false });

    const result = await entitlementService.getBranchUsage(restaurantId.toString());

    expect(result.usage.totalBranches).toBe(2);
    expect(result.usage.activeBranches).toBe(1);
  });

  it('includes branch details with employee and table counts', async () => {
    const branch = await Branch.create({
      restaurantId,
      name: 'Main Street',
      isHeadBranch: true,
      isActive: true,
    });
    const branchId = branch._id as mongoose.Types.ObjectId;

    // Add employees and tables to this branch
    await Employee.create([
      { username: 'emp1', name: 'Alice', role: 'Cashier', pin: '1234', restaurantId, branchId, status: 'Active' },
      { username: 'emp2', name: 'Bob', role: 'Manager', pin: '5678', restaurantId, branchId, status: 'Active' },
    ]);
    await Table.create([
      { number: 1, capacity: 4, branchId, status: 'Available' },
      { number: 2, capacity: 6, branchId, status: 'Occupied' },
    ]);

    const result = await entitlementService.getBranchUsage(restaurantId.toString());

    expect(result.branches).toHaveLength(1);
    expect(result.branches[0].employees).toBe(2);
    expect(result.branches[0].tables).toBe(2);
  });

  it('falls back to basic plan when no subscription exists', async () => {
    const unknownOid = new mongoose.Types.ObjectId();
    const result = await entitlementService.getBranchUsage(unknownOid.toString());

    // No subscription/plan to resolve — falls back to 'N/A' with default limits
    expect(result.plan).toBe('N/A');
    expect(result.maxBranches).toBe(1);
    expect(result.usage.totalBranches).toBe(0);
    expect(result.usage.remainingBranches).toBe(1);
  });
});

// =========================================================================
// canCreateBranch
// =========================================================================

describe('canCreateBranch', () => {
  it('allows branch creation when no subscription exists', async () => {
    const unknownOid = new mongoose.Types.ObjectId();
    const result = await entitlementService.canCreateBranch(unknownOid.toString());

    expect(result.allowed).toBe(true);
  });

  it('blocks branch creation when subscription is suspended', async () => {
    // restaurantId2 has a suspended subscription
    const result = await entitlementService.canCreateBranch(restaurantId2.toString());

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('suspended');
  });

  it('allows branch creation when under limit', async () => {
    // Plan allows 2 branches, 0 exist
    const result = await entitlementService.canCreateBranch(restaurantId.toString());

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('blocks branch creation when plan has no multi_branch feature', async () => {
    // Create a 3rd restaurant with active subscription on the basic plan (no multi_branch, 1 branch limit)
    const Restaurant = (await import('../../models/Restaurant')).default;
    const basicRest = await Restaurant.create({
      restaurantId: 'BASIC_TEST',
      name: 'Basic Plan Restaurant',
      phone: '+1-555-BASIC',
      isActive: true,
    });
    const basicRestId = basicRest._id as mongoose.Types.ObjectId;

    await Subscription.create({
      restaurantId: basicRestId,
      plan: 'basic_integration',
      status: 'active',
      subscriptionStart: new Date(),
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      startDate: new Date(),
      maxUsers: 3,
      maxDevices: 1,
      features: ['core_pos'],  // No multi_branch
      limits: { maxBranches: 1, maxDevices: 3, maxEmployees: 5 },
    });

    // Create 1 branch (at limit)
    await Branch.create({ restaurantId: basicRestId, name: 'Only Branch', isActive: true });

    const result = await entitlementService.canCreateBranch(basicRestId.toString());

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('does not support multiple branches');
    expect(result.limit).toBe(1);
    expect(result.current).toBe(1);
  });

  it('blocks branch creation when at plan limit', async () => {
    // Professional plan allows 2 branches — create 2
    await Branch.create({ restaurantId, name: 'Branch 1', isActive: true });
    await Branch.create({ restaurantId, name: 'Branch 2', isActive: true });

    const result = await entitlementService.canCreateBranch(restaurantId.toString());

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Your plan allows');
    expect(result.limit).toBe(2);
    expect(result.current).toBe(2);
  });

  it('allows unlimited branches when maxBranches is 0', async () => {
    // Create an enterprise subscription for restaurant 1
    // Temporarily update their subscription to enterprise
    await Subscription.findOneAndUpdate(
      { restaurantId },
      { $set: { plan: enterprisePlanId, features: ['core_pos', 'multi_branch', 'ai', 'analytics'], limits: { maxBranches: 0, maxDevices: 10, maxEmployees: 50 } } }
    ).exec();

    // Create 5 branches — all should be allowed
    for (let i = 1; i <= 5; i++) {
      await Branch.create({ restaurantId, name: `Branch ${i}`, isActive: true });
    }

    const result = await entitlementService.canCreateBranch(restaurantId.toString());

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(0);
    expect(result.remaining).toBe(-1);
    expect(result.current).toBe(5);

    // Restore subscription to professional
    await Subscription.findOneAndUpdate(
      { restaurantId },
      { $set: { plan: professionalPlanId, features: ['core_pos', 'basic_reports', 'multi_branch', 'ai'], limits: { maxBranches: 2, maxDevices: 3, maxEmployees: 10 } } }
    ).exec();
  });
});

// =========================================================================
// validatePlanDowngrade
// =========================================================================

describe('validatePlanDowngrade', () => {
  it('allows downgrade when branch count is under new plan limit', async () => {
    // Current branches: 0, new plan limit: 1 (basic_integration)
    const result = await entitlementService.validatePlanDowngrade(
      restaurantId.toString(),
      'basic_integration'
    );
    expect(result.allowed).toBe(true);
  });

  it('blocks downgrade when branch count exceeds new plan limit', async () => {
    // Create 3 branches
    for (let i = 1; i <= 3; i++) {
      await Branch.create({ restaurantId, name: `Over Branch ${i}`, isActive: true });
    }

    const result = await entitlementService.validatePlanDowngrade(
      restaurantId.toString(),
      'basic_integration' // limit: 1 branch
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('exceeds');
    expect(result.limit).toBe(1);
    expect(result.current).toBe(3);
  });

  it('blocks downgrade when target plan is not found', async () => {
    const result = await entitlementService.validatePlanDowngrade(
      restaurantId.toString(),
      'nonexistent_plan'
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Target plan not found.');
  });

  it('allows downgrade to unlimited plan regardless of branch count', async () => {
    // Enterprise plan has maxBranches: 0 (unlimited)
    for (let i = 1; i <= 10; i++) {
      await Branch.create({ restaurantId, name: `Unlimited Branch ${i}`, isActive: true });
    }

    const result = await entitlementService.validatePlanDowngrade(
      restaurantId.toString(),
      enterprisePlanId
    );

    expect(result.allowed).toBe(true);
  });
});

// =========================================================================
// canUseFeature
// =========================================================================

describe('canUseFeature', () => {
  it('allows feature when no subscription exists', async () => {
    const unknownOid = new mongoose.Types.ObjectId();
    const result = await entitlementService.canUseFeature(unknownOid.toString(), 'ai');

    expect(result.allowed).toBe(true);
  });

  it('blocks feature when subscription is suspended', async () => {
    const result = await entitlementService.canUseFeature(restaurantId2.toString(), 'core_pos');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('suspended');
  });

  it('allows feature that is included in the plan', async () => {
    const result = await entitlementService.canUseFeature(restaurantId.toString(), 'multi_branch');

    expect(result.allowed).toBe(true);
  });

  it('blocks feature that is NOT included in the plan', async () => {
    // Professional plan does NOT include 'loyalty'
    const result = await entitlementService.canUseFeature(restaurantId.toString(), 'loyalty');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('does not include');
    expect(result.reason).toContain('loyalty');
  });
});

// =========================================================================
// getSubscriptionLimits
// =========================================================================

describe('getSubscriptionLimits', () => {
  it('returns null when no subscription exists', async () => {
    const unknownOid = new mongoose.Types.ObjectId();
    const result = await entitlementService.getSubscriptionLimits(unknownOid.toString());

    expect(result).toBeNull();
  });

  it('returns plan limits for an active subscription', async () => {
    const result = await entitlementService.getSubscriptionLimits(restaurantId.toString());

    expect(result).not.toBeNull();
    expect(result!.plan).toBe(professionalPlanId);
    expect(result!.planName).toBe('Professional Plan');
    expect(result!.status).toBe('active');
    expect(result!.limits.maxBranches).toBe(2);
    expect(result!.limits.maxDevices).toBe(3);
    expect(result!.limits.maxEmployees).toBe(10);
    expect(result!.features).toEqual(['core_pos', 'basic_reports', 'multi_branch', 'ai']);
  });

  it('returns limits for a suspended subscription', async () => {
    const result = await entitlementService.getSubscriptionLimits(restaurantId2.toString());

    expect(result).not.toBeNull();
    expect(result!.plan).toBe('basic_integration');
    expect(result!.status).toBe('suspended');
    expect(result!.limits.maxBranches).toBe(1);
  });
});

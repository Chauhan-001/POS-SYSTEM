/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * phase3Tools.test.ts — Acceptance tests for the core tool categories
 * (spec §30): registration, valid data, empty data, tenant isolation,
 * invalid input. Each tool is exercised against real models in an
 * in-memory MongoDB, through the same executeTool path agents will use.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ai } from '../../index';
import { toolRegistry } from '../../tools/registry/toolRegistry';
import { executeTool } from '../../tools/registry/toolExecutor';
import { getInventoryStatusToolDefinition } from '../inventory/getInventoryStatusTool';
import { getExpiryRiskToolDefinition } from '../inventory/getExpiryRiskTool';
import { getWastageToolDefinition } from '../inventory/getWastageTool';
import { getStockoutRiskToolDefinition } from '../inventory/getStockoutRiskTool';
import { getCustomerSegmentsToolDefinition, getRetentionSignalsToolDefinition } from '../customers/customerTools';
import { getMenuPerformanceToolDefinition } from '../products/menuPerformanceTool';
import { getProductCombinationsToolDefinition } from '../products/getProductCombinationsTool';
import {
  getActiveOffersToolDefinition,
  getOfferPerformanceToolDefinition,
  getCampaignPerformanceToolDefinition,
} from '../marketing/marketingTools';
import { getRestaurantProfileToolDefinition, getBranchesToolDefinition } from '../restaurant/restaurantTools';
import { getFestivalContextToolDefinition, getWeatherContextToolDefinition } from '../context/contextTools';

import Product from '../../../models/catalog/Product';
import Customer from '../../../models/customers/Customer';
import Offer from '../../../models/marketing/Offer';
import CampaignHistory from '../../../models/marketing/CampaignHistory';
import RestaurantModel from '../../../models/core/Restaurant';
import Branch from '../../../models/core/Branch';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';
const BRANCH_R1 = '507f1f77bcf86cd799439033';

const tenantR1 = { restaurantId: R1, actorId: 'actor-1' };
const tenantR2 = { restaurantId: R2, actorId: 'actor-2' };

let seq = 0;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ai.bootstrap();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Product.deleteMany({}).exec(),
    Customer.deleteMany({}).exec(),
    Offer.deleteMany({}).exec(),
    CampaignHistory.deleteMany({}).exec(),
    RestaurantModel.deleteMany({}).exec(),
    Branch.deleteMany({}).exec(),
  ]);
});

// ─── Fixtures ───────────────────────────────────────────────────────

async function makeProduct(restaurantId: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return Product.create({
    name: `Item ${seq}`,
    code: `P-${seq}`,
    price: 200,
    category: 'Main Course',
    gstPercent: 5,
    availability: true,
    restaurantId,
    ...overrides,
  } as any);
}

async function makeCustomer(restaurantId: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return Customer.create({
    name: `Customer ${seq}`,
    phone: `98000000${String(seq).padStart(3, '0')}`,
    restaurantId,
    ...overrides,
  } as any);
}

async function makeOffer(restaurantId: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return Offer.create({
    title: `Offer ${seq}`,
    description: 'Test offer',
    type: 'percentage',
    value: 10,
    status: 'active',
    restaurantId,
    ...overrides,
  } as any);
}

async function makeCampaignHistory(restaurantId: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return CampaignHistory.create({
    restaurantId,
    channel: 'whatsapp',
    recipientCount: 10,
    openedCount: 4,
    redeemedCount: 2,
    campaignCost: 5,
    status: 'sent',
    sentDate: '2026-09-28',
    ...overrides,
  } as any);
}

// ─── Registration ───────────────────────────────────────────────────

describe('Phase 3 — tool registration', () => {
  it('registers every core tool under its category', () => {
    const names = new Set(toolRegistry.list().map((t) => t.name));
    for (const name of [
      'getInventoryStatus', 'getExpiryRisk', 'getWastage', 'getStockoutRisk',
      'getCustomerSegments', 'getRetentionSignals',
      'getMenuPerformance', 'getProductMargins', 'getProductCombinations',
      'getActiveOffers', 'getOfferPerformance', 'getCampaignPerformance',
      'getRestaurantProfile', 'getBranches',
      'getFestivalContext', 'getWeatherContext',
    ]) {
      expect(names.has(name)).toBe(true);
    }
    expect(toolRegistry.get('getInventoryStatus')?.category).toBe('inventory');
    expect(toolRegistry.get('getCustomerSegments')?.category).toBe('customers');
    expect(toolRegistry.get('getMenuPerformance')?.category).toBe('products');
    expect(toolRegistry.get('getActiveOffers')?.category).toBe('marketing');
    expect(toolRegistry.get('getRestaurantProfile')?.category).toBe('restaurant');
    expect(toolRegistry.get('getFestivalContext')?.category).toBe('context');
  });
});

// ─── Inventory ──────────────────────────────────────────────────────

describe('inventory tools', () => {
  it('getInventoryStatus returns stock-tracked items for the tenant', async () => {
    await makeProduct(R1, { name: 'Paneer 1kg', currentStock: 40, minStock: 10, maxStock: 100, unit: 'kg' });
    const result = await executeTool(getInventoryStatusToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.available) throw new Error(JSON.stringify(result));
    expect(result.data.items).toHaveLength(1);
    expect(result.data.items![0]).toMatchObject({ name: 'Paneer 1kg', currentStock: 40, maxStock: 100 });
  });

  it('getInventoryStatus reports NO_INVENTORY_DATA for a tenant without stock', async () => {
    await makeProduct(R1, { currentStock: 40, minStock: 10, maxStock: 100 });
    const result = await executeTool(getInventoryStatusToolDefinition, {}, { tenant: tenantR2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ available: false, reason: 'NO_INVENTORY_DATA' });
  });

  it('getExpiryRisk rejects malformed branchId input', async () => {
    const result = await executeTool(getExpiryRiskToolDefinition, { branchId: 'zzz' }, { tenant: tenantR1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TOOL_INPUT_INVALID');
  });

  it('getWastage reports NO_WASTAGE_DATA when nothing was wasted', async () => {
    const result = await executeTool(getWastageToolDefinition, {}, { tenant: tenantR2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.available).toBe(false);
    expect(result.data.reason).toBe('NO_WASTAGE_DATA');
  });

  it('getStockoutRisk rejects out-of-range horizons', async () => {
    const result = await executeTool(getStockoutRiskToolDefinition, { horizonDays: 0 }, { tenant: tenantR1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TOOL_INPUT_INVALID');
  });
});

// ─── Customers ──────────────────────────────────────────────────────

describe('customer tools', () => {
  it('getCustomerSegments returns aggregate totals without leaking PII', async () => {
    await makeCustomer(R1, { visits: 3, totalSpend: 900, points: 120, lastVisit: new Date() });
    const result = await executeTool(getCustomerSegmentsToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.available) throw new Error(JSON.stringify(result));
    expect(result.data.totals).toMatchObject({ customerCount: 1, activeCustomers: 1 });
    // Aggregate-only contract: no customer names/phones anywhere.
    expect(JSON.stringify(result.data)).not.toContain('Customer 1');
    expect(JSON.stringify(result.data)).not.toContain('980000');
  });

  it('getRetentionSignals classifies inactive customers', async () => {
    // Service semantics: active = has visited at least once (lifetime),
    // inactive = no visit within the 30-day threshold. A lapsed customer is
    // counted in both — the facets are independent, not exclusive.
    const daysAgo45 = new Date(Date.now() - 45 * 86_400_000);
    await makeCustomer(R1, { visits: 2, totalSpend: 400, lastVisit: daysAgo45, createdAt: daysAgo45 });
    const result = await executeTool(getRetentionSignalsToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.available) throw new Error(JSON.stringify(result));
    expect(result.data.summary).toMatchObject({
      totalCustomers: 1,
      inactiveCustomers: 1,
    });
  });

  it('getRetentionSignals enforces tenant isolation on branch scope', async () => {
    await Branch.create({
      _id: new mongoose.Types.ObjectId(BRANCH_R1),
      name: 'R1 Branch',
      restaurantId: R1,
      isHeadBranch: true,
      isActive: true,
    } as any);
    const result = await executeTool(
      getRetentionSignalsToolDefinition,
      { branchId: BRANCH_R1 },
      { tenant: tenantR2 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TOOL_TENANT_MISMATCH');
  });
});

// ─── Products ───────────────────────────────────────────────────────

describe('product tools', () => {
  it('getMenuPerformance reports NO_MENU_PERFORMANCE_DATA without sales', async () => {
    await makeProduct(R1);
    const result = await executeTool(getMenuPerformanceToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ available: false, reason: 'NO_MENU_PERFORMANCE_DATA' });
  });

  it('getProductCombinations reports NO_BASKET_DATA without bills', async () => {
    const result = await executeTool(getProductCombinationsToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ available: false, reason: 'NO_BASKET_DATA' });
  });
});

// ─── Marketing ──────────────────────────────────────────────────────

describe('marketing tools', () => {
  it('getActiveOffers returns only live offers of the tenant', async () => {
    await makeOffer(R1, { title: 'Diwali Combo' });
    await makeOffer(R1, { title: 'Draft Offer', status: 'draft' });
    const result = await executeTool(getActiveOffersToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.available) throw new Error(JSON.stringify(result));
    expect(result.data.offers).toHaveLength(1);
    expect(result.data.offers![0].title).toBe('Diwali Combo');
  });

  it('getActiveOffers reports NO_ACTIVE_OFFERS when none are live', async () => {
    const result = await executeTool(getActiveOffersToolDefinition, {}, { tenant: tenantR2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ available: false, reason: 'NO_ACTIVE_OFFERS' });
  });

  it('getOfferPerformance reports NO_OFFER_PERFORMANCE_DATA without analytics', async () => {
    const result = await executeTool(getOfferPerformanceToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ available: false, reason: 'NO_OFFER_PERFORMANCE_DATA' });
  });

  it('getCampaignPerformance returns real delivery history', async () => {
    await makeCampaignHistory(R1, { redeemedCount: 3 });
    await makeCampaignHistory(R2, { redeemedCount: 99 });
    const result = await executeTool(getCampaignPerformanceToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.available) throw new Error(JSON.stringify(result));
    expect(result.data.campaigns).toHaveLength(1);
    expect(result.data.campaigns![0].redeemedCount).toBe(3);
    expect(result.data.campaigns![0].channel).toBe('whatsapp');
  });
});

// ─── Restaurant ─────────────────────────────────────────────────────

describe('restaurant tools', () => {
  it('getRestaurantProfile returns the tenant profile incl. establishedDate', async () => {
    await RestaurantModel.create({
      _id: new mongoose.Types.ObjectId(R1),
      restaurantId: 'R1REST',
      name: 'Royal Bistro',
      phone: '9800000000',
      establishedDate: new Date('2019-04-15T00:00:00Z'),
    } as any);
    const result = await executeTool(getRestaurantProfileToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.available) throw new Error(JSON.stringify(result));
    expect(result.data.profile).toMatchObject({
      name: 'Royal Bistro',
      establishedDate: '2019-04-15',
      currency: 'INR',
    });
    expect(result.data.profile!.onboardedAt).toBeTruthy();
  });

  it('getBranches returns only the tenant branches', async () => {
    await Branch.create({ name: 'HQ', restaurantId: R1, isHeadBranch: true, isActive: true } as any);
    const result = await executeTool(getBranchesToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.available) throw new Error(JSON.stringify(result));
    expect(result.data.branches).toHaveLength(1);
    expect(result.data.branches![0].isHeadBranch).toBe(true);

    const r2 = await executeTool(getBranchesToolDefinition, {}, { tenant: tenantR2 });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.data).toMatchObject({ available: false, reason: 'NO_BRANCHES' });
  });
});

// ─── Context ────────────────────────────────────────────────────────

describe('context tools', () => {
  it('getFestivalContext returns a deterministic, well-shaped answer', async () => {
    const result = await executeTool(getFestivalContextToolDefinition, { maxDays: 30 }, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.data.available) {
      expect(Array.isArray(result.data.upcoming)).toBe(true);
    } else {
      expect(result.data.reason).toBe('NO_UPCOMING_FESTIVALS');
    }
  });

  it('getWeatherContext never fabricates — it reports unavailability', async () => {
    const result = await executeTool(getWeatherContextToolDefinition, {}, { tenant: tenantR1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      available: false,
      reason: 'NO_WEATHER_PROVIDER',
      generatedAt: expect.any(String),
    });
  });
});

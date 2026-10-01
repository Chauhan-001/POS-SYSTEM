/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getSalesTrendsTool.test.ts — Phase 2 acceptance tests (spec §30).
 *
 * Covers: valid input, empty data, tenant isolation (foreign branch rejected,
 * own branch accepted), service failure, and the platform contracts
 * (registration, resolver allow-list, executor result codes).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ai } from '../../../index';
import { toolRegistry } from '../../registry/toolRegistry';
import { executeTool } from '../../registry/toolExecutor';
import { resolveAllowedTools } from '../../registry/toolResolver';
import { getSalesTrendsToolDefinition } from '../getSalesTrendsTool';
import Bill from '../../../../models/intelligence/Bill';
import BillItem from '../../../../models/intelligence/BillItem';
import Product from '../../../../models/catalog/Product';
import Branch from '../../../../models/core/Branch';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const R2 = '507f1f77bcf86cd799439022';
const BRANCH_R1 = '507f1f77bcf86cd799439033';

const tenantR1 = { restaurantId: R1, actorId: 'actor-1' };
const tenantR2 = { restaurantId: R2, actorId: 'actor-2' };

let billSeq = 0;

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
    Bill.deleteMany({}).exec(),
    BillItem.deleteMany({}).exec(),
    Product.deleteMany({}).exec(),
    Branch.deleteMany({}).exec(),
  ]);
});

async function seedSales(restaurantId: string, branchId?: string): Promise<void> {
  await Product.create({
    name: 'Paneer Tikka',
    code: `P-${restaurantId.slice(-4)}`,
    price: 220,
    category: 'Main Course',
    gstPercent: 5,
    availability: true,
    restaurantId,
  } as any);
  const bill = await Bill.create({
    clientRef: `AI-${++billSeq}`,
    invoiceNumber: `AI-INV-${billSeq}`,
    ticketNumber: `T-${billSeq}`,
    date: '2026-09-30',
    time: '13:00',
    cashierName: 'Test',
    cashierRole: 'Cashier',
    subtotal: 500,
    discount: 0,
    gst: 0,
    grandTotal: 500,
    paymentMethod: 'Cash',
    orderType: 'Dine-in',
    restaurantId,
    branchId: branchId ?? undefined,
    pointsEarned: 0,
    pointsRedeemed: 0,
  } as any);
  await BillItem.create({
    billId: bill._id,
    itemName: 'Paneer Tikka',
    priceAtSale: 250,
    quantity: 2,
    restaurantId,
  } as any);
}

describe('tool registry — shared platform contracts', () => {
  it('registers getSalesTrends exactly once, visible to any agent', () => {
    expect(toolRegistry.has('getSalesTrends')).toBe(true);
    expect(toolRegistry.list()).toContainEqual(
      expect.objectContaining({ name: 'getSalesTrends', category: 'sales', access: 'read' }),
    );
  });

  it('resolves policy allow-lists from the registry', () => {
    const tools = resolveAllowedTools(['getSalesTrends']);
    expect(tools.map((t) => t.name)).toEqual(['getSalesTrends']);
  });

  it('rejects policies referencing unregistered tools (fail fast)', () => {
    expect(() => resolveAllowedTools(['getNonexistentTool'])).toThrow(/unregistered tool/);
  });

  it('refuses duplicate registrations', () => {
    expect(() => toolRegistry.register(getSalesTrendsToolDefinition)).toThrow(/already registered/);
  });
});

describe('getSalesTrends tool', () => {
  it('returns real aggregated sales for the authenticated tenant', async () => {
    await seedSales(R1);
    const result = await executeTool(getSalesTrendsToolDefinition, {}, { tenant: tenantR1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.available).toBe(true);
    if (result.data.available !== true) return;
    expect(result.data.scope).toBe('tenant');
    expect(result.data.monthlyRevenue).toBe(500);
    expect(result.data.orderCount).toBe(1);
    expect(result.data.averageOrderValue).toBe(500);
    expect(result.data.weekdayPerformance).toHaveLength(7);
    expect(result.data.hourlyPerformance).toHaveLength(24);
  });

  it('returns an explicit empty state instead of fake zeros', async () => {
    const result = await executeTool(getSalesTrendsToolDefinition, {}, { tenant: tenantR2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      available: false,
      reason: 'NO_SALES_DATA',
      generatedAt: expect.any(String),
    });
  });

  it('rejects input that fails the schema', async () => {
    const result = await executeTool(getSalesTrendsToolDefinition, { branchId: 'not-an-id' }, { tenant: tenantR1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TOOL_INPUT_INVALID');
  });

  it('enforces tenant isolation: a foreign branchId is a tenant mismatch', async () => {
    await Branch.create({ name: 'R1 Branch', restaurantId: R1, isHeadBranch: true, isActive: true } as any);
    const result = await executeTool(
      getSalesTrendsToolDefinition,
      { branchId: BRANCH_R1 },
      { tenant: tenantR2 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TOOL_TENANT_MISMATCH');
  });

  it('accepts a branch scope that genuinely belongs to the tenant', async () => {
    await Branch.create({
      _id: new mongoose.Types.ObjectId(BRANCH_R1),
      name: 'R1 Branch',
      restaurantId: R1,
      isHeadBranch: true,
      isActive: true,
    } as any);
    await seedSales(R1, BRANCH_R1);

    const result = await executeTool(
      getSalesTrendsToolDefinition,
      { branchId: BRANCH_R1 },
      { tenant: tenantR1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.data.available !== true) return failResult(result);
    expect(result.data.scope).toBe('branch');
    expect(result.data.monthlyRevenue).toBe(500);
  });

  it('keeps tenants isolated: R2 never sees R1 sales', async () => {
    await seedSales(R1);
    const result = await executeTool(getSalesTrendsToolDefinition, {}, { tenant: tenantR2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // R2 has no sales of its own — the tool must NOT leak R1 aggregates.
    expect(result.data).toMatchObject({ available: false, reason: 'NO_SALES_DATA' });
  });
});

/** readable assertion failure when an expected-ok branch turns out not to be */
function failResult(r: unknown): never {
  throw new Error(`expected ok result, got ${JSON.stringify(r)}`);
}

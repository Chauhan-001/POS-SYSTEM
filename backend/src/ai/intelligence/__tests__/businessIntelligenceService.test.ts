/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * businessIntelligenceService.test.ts — PHASE 3 service-level acceptance.
 *
 * Uses the REAL shared tool registry (no duplicated read paths) with
 * registered stub tools so the fan-out, isolation, degradation and budget
 * behavior are verified end to end without a database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';

import {
  BUSINESS_DIMENSIONS,
  investigateBusiness,
  businessInvestigationSummary,
} from '../businessIntelligenceService';
import { toolRegistry } from '../../tools/registry/toolRegistry';
import { registerAllTools } from '../../tools/registerAllTools';
import type { ToolContext, ToolDefinition } from '../../tools/registry/toolTypes';

const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439022';
const BR_A1 = '507f1f77bcf86cd7994390b1';
const tenantA = { restaurantId: A, actorId: 'a' } as never;
const tenantB = { restaurantId: B, actorId: 'b' } as never;

/** Tools used by the default plan (registered once, stubbed here). */
const PLAN_TOOLS = [
  'getSalesTrends',
  'getMenuPerformance',
  'getProductMargins',
  'getInventoryStatus',
  'getExpiryRisk',
  'getStockoutRisk',
  'getCustomerSegments',
  'getRetentionSignals',
  'getActiveOffers',
  'getOfferPerformance',
  'getCampaignPerformance',
  'getDemandForecast',
  'getMarketBasketSignals',
  'getFestivalContext',
  'getSportsContext',
  'getNearbyCompetition',
  'getWeatherContext',
] as const;

/** Per-tenant deterministic payloads so isolation is observable. */
const PAYLOADS: Record<string, Record<string, unknown>> = {
  [A]: {
    getSalesTrends: {
      available: true,
      scope: 'tenant',
      dailyRevenue: 11111,
      weeklyRevenue: 77777,
      monthlyRevenue: 333333,
      orderCount: 100,
      averageOrderValue: 111.11,
      topCategories: [{ name: 'A-TopCat', revenue: 5000, qty: 50 }],
      weakCategories: [{ name: 'A-WeakCat', revenue: 100, qty: 2 }],
      weekdayPerformance: [1, 2, 3, 4, 5, 6, 7],
      hourlyPerformance: Array.from({ length: 24 }, () => 1),
      generatedAt: new Date().toISOString(),
    },
  },
  [B]: {
    getSalesTrends: {
      available: true,
      scope: 'tenant',
      dailyRevenue: 22222,
      weeklyRevenue: 88888,
      monthlyRevenue: 444444,
      orderCount: 200,
      averageOrderValue: 222.22,
      topCategories: [{ name: 'B-TopCat', revenue: 9000, qty: 90 }],
      weakCategories: [],
      weekdayPerformance: [7, 6, 5, 4, 3, 2, 1],
      hourlyPerformance: Array.from({ length: 24 }, () => 2),
      generatedAt: new Date().toISOString(),
    },
  },
};

/**
 * The shared registry is a single instance and refuses duplicate names, so
 * tests swap stubs in through its map (restored in afterAll) instead of
 * registering a second registry — the production code path stays the only
 * execution path under test.
 */
const registryTools = (toolRegistry as unknown as { tools: Map<string, ToolDefinition<unknown, unknown>> }).tools;
const ORIGINALS = new Map<string, ToolDefinition<unknown, unknown> | undefined>();

function registerStub(name: string) {
  const def: ToolDefinition<{ branchId?: string }, unknown> = {
    name,
    category: 'sales',
    access: 'read',
    meta: { description: `stub ${name}`, source: 'test' },
    // Mirrors the real tools: window-aware tools accept lookbackDays/days
    // (D-16), so the plan may legitimately pass them through.
    inputSchema: z
      .object({
        branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
        lookbackDays: z.number().int().min(7).max(365).optional(),
        days: z.number().int().min(7).max(180).optional(),
      })
      .strict(),
    outputSchema: z.any(),
    execute: async (_input, ctx: ToolContext) => {
      // Record which tenant asked — used to prove scoping.
      SEEN.push({ name, restaurantId: ctx.tenant.restaurantId });
      const payload = PAYLOADS[ctx.tenant.restaurantId]?.[name];
      return payload ?? { available: false, reason: 'NO_DATA', generatedAt: new Date().toISOString() };
    },
  };
  if (!ORIGINALS.has(name)) ORIGINALS.set(name, registryTools.get(name));
  registryTools.set(name, def as never);
}

const SEEN: Array<{ name: string; restaurantId: string }> = [];

beforeAll(() => {
  registerAllTools(); // real registry bootstrap (idempotent)
  for (const name of PLAN_TOOLS) registerStub(name);
});

afterAll(() => {
  for (const [name, original] of ORIGINALS) {
    if (original) registryTools.set(name, original);
    else registryTools.delete(name);
  }
  ORIGINALS.clear();
  SEEN.length = 0;
});

describe('1. fan-out over the real tool registry', () => {
  it('runs every planned dimension and normalizes available evidence', async () => {
    SEEN.length = 0;
    const investigation = await investigateBusiness({ tenant: tenantA as never, budgetMs: 20_000 });

    expect(investigation.dimensions.length).toBe(17);
    expect(investigation.toolErrors).toEqual([]);
    expect(investigation.signals.length).toBeGreaterThan(0);
    // Sales payload produced canonical signals.
    expect(investigation.signals.some((s) => s.code === 'sales_revenue_level')).toBe(true);
    expect(investigation.signals.some((s) => s.code === 'sales_category_strong')).toBe(true);
    // Dimensions without payloads are honestly reported unavailable.
    expect(investigation.unavailableDimensions.length).toBeGreaterThan(0);
    expect(investigation.usable).toBe(true);

    // Every tool was invoked through the registry with the authenticated tenant.
    const names = new Set(SEEN.map((s) => s.name));
    for (const name of PLAN_TOOLS) expect(names.has(name)).toBe(true);
    expect(SEEN.every((s) => s.restaurantId === A)).toBe(true);
  });

  it('dimension filter restricts the fan-out', async () => {
    const investigation = await investigateBusiness({
      tenant: tenantA as never,
      dimensions: ['sales'],
      budgetMs: 20_000,
    });
    expect(investigation.dimensions).toHaveLength(1);
    expect(investigation.dimensions[0].dimension).toBe('sales');
    expect(investigation.signals.every((s) => s.category === 'sales')).toBe(true);
  });
});

describe('2. tenant isolation', () => {
  it('tenant B sees only B evidence, never A', async () => {
    const invA = await investigateBusiness({ tenant: tenantA as never, dimensions: ['sales'], budgetMs: 20_000 });
    const invB = await investigateBusiness({ tenant: tenantB as never, dimensions: ['sales'], budgetMs: 20_000 });

    expect(invA.signals.some((s) => s.statement.includes('A-TopCat'))).toBe(true);
    expect(invA.signals.some((s) => s.statement.includes('B-TopCat'))).toBe(false);
    expect(invB.signals.some((s) => s.statement.includes('B-TopCat'))).toBe(true);
    expect(invB.signals.some((s) => s.statement.includes('A-TopCat'))).toBe(false);
    expect(invA.signals.every((s) => s.scope.restaurantId === A)).toBe(true);
    expect(invB.signals.every((s) => s.scope.restaurantId === B)).toBe(true);
  });

  it('rejects a missing/invalid tenant identity (never guesses)', async () => {
    await expect(investigateBusiness({ tenant: {} as never })).rejects.toThrow(/authenticated tenant/);
    await expect(investigateBusiness({ tenant: { restaurantId: 'not-an-objectid' } as never })).rejects.toThrow(/authenticated tenant/);
  });
});

describe('3. branch scope', () => {
  it('propagates the branch into signal scope', async () => {
    const investigation = await investigateBusiness({
      tenant: tenantA as never,
      branchId: BR_A1,
      dimensions: ['sales'],
      budgetMs: 20_000,
    });
    expect(investigation.signals.length).toBeGreaterThan(0);
    expect(investigation.signals.every((s) => s.scope.branchId === BR_A1)).toBe(true);
    expect(investigation.signals.every((s) => s.scope.scope === 'branch')).toBe(true);
  });
});

describe('4. failure and budget degradation', () => {
  it('a throwing tool becomes a toolError and the investigation continues', async () => {
    const name = 'getSalesTrends';
    const original = registryTools.get(name)!;
    registryTools.set(name, {
      ...original,
      execute: async () => {
        throw new Error('mongo down');
      },
    } as never);

    try {
      const investigation = await investigateBusiness({ tenant: tenantA as never, dimensions: ['sales', 'menu'], budgetMs: 20_000 });
      const err = investigation.toolErrors.find((e) => e.tool === name);
      expect(err).toBeDefined();
      expect(err!.message).toContain('mongo down');
      expect(investigation.dimensions.find((d) => d.normalizer === 'sales_context')).toMatchObject({
        status: 'error',
        reason: 'TOOL_FAILED',
      });
    } finally {
      registryTools.set(name, original);
    }
  });

  it('a missing tool is an explicit TOOL_NOT_FOUND, never a silent skip', async () => {
    const investigation = await investigateBusiness({
      tenant: tenantA as never,
      budgetMs: 20_000,
      plan: [
        {
          dimension: 'sales',
          toolName: 'definitelyNotRegisteredTool',
          normalizer: 'sales_context',
          input: {},
          timeoutMs: 500,
          normalize: () => ({ status: 'ok', normalizer: 'sales_context', signals: [], caveats: [], generatedAt: new Date().toISOString() }),
        },
      ],
    });
    expect(investigation.toolErrors[0]).toMatchObject({ tool: 'definitelyNotRegisteredTool', code: 'TOOL_NOT_FOUND' });
    expect(investigation.usable).toBe(false);
  });

  it('an already-exhausted budget is reported per dimension, not silently dropped', async () => {
    const investigation = await investigateBusiness({
      tenant: tenantA as never,
      budgetMs: 0, // deadline is already in the past when the fan-out starts
      dimensions: ['sales', 'menu'],
    });
    expect(investigation.toolErrors.some((e) => e.code === 'BUDGET_EXHAUSTED')).toBe(true);
    expect(investigation.dimensions.every((d) => d.reason === 'BUDGET_EXHAUSTED')).toBe(true);
    expect(investigation.usable).toBe(false);
  });

  it('a slow tool is clamped to the remaining budget and fails with TOOL_TIMEOUT', async () => {
    // The executor clamps each tool to the run deadline, so a tool slower than
    // the whole budget times out honestly instead of overrunning the run.
    const slowName = 'phase3SlowStub';
    const slowTool = {
      name: slowName,
      category: 'sales' as const,
      access: 'read' as const,
      meta: { description: 'slow stub', source: 'test' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.any(),
      timeoutMs: 5_000,
      execute: async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { available: false, reason: 'NO_DATA', generatedAt: new Date().toISOString() };
      },
    };
    if (!ORIGINALS.has(slowName)) ORIGINALS.set(slowName, registryTools.get(slowName));
    registryTools.set(slowName, slowTool as never);

    const step = {
      dimension: 'sales' as const,
      toolName: slowName,
      normalizer: 'sales_context' as const,
      input: {},
      timeoutMs: 5_000,
      normalize: () => ({ status: 'ok' as const, normalizer: 'sales_context' as const, signals: [], caveats: [], generatedAt: new Date().toISOString() }),
    };
    const investigation = await investigateBusiness({
      tenant: tenantA as never,
      budgetMs: 80,
      plan: [step],
    });
    expect(investigation.toolErrors).toHaveLength(1);
    expect(investigation.toolErrors[0].code).toBe('TOOL_TIMEOUT');
    expect(investigation.usable).toBe(false);
  });
});

describe('5. observability summary', () => {
  it('summarizes without raw business values', async () => {
    const investigation = await investigateBusiness({ tenant: tenantA as never, dimensions: ['sales'], budgetMs: 20_000 });
    const summary = businessInvestigationSummary(investigation);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('11111');
    expect(serialized).not.toContain('A-TopCat');
    expect(summary.signals).toBeGreaterThan(0);
  });
});

describe('6. dimension vocabulary', () => {
  it('exposes the documented dimensions', () => {
    expect(BUSINESS_DIMENSIONS).toEqual(
      expect.arrayContaining(['sales', 'menu', 'margin', 'inventory', 'customer', 'marketing', 'demand', 'basket', 'context']),
    );
  });
});

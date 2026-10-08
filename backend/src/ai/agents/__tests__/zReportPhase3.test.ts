/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * zReportPhase3.test.ts — Phase 3 (Daily Summary / Z-Report Intelligence)
 * acceptance: collectZReportEvidence (Batch 1/2/3), signalConflictDetector and
 * evidenceMerger.
 *
 * What is REAL here:
 *   - The shared tool registry + executor (Batch 1/3 run through the SAME
 *     investigateBusiness fan-out as every other agent; tools are stubbed
 *     through the registry Map, restored in afterAll).
 *   - salesReportService.summary + detectAllDemandAnomalies against a real
 *     mongodb-memory-server with real Bill rows (Batch 2) — no mocked
 *     production service.
 *   - buildZReportContext (Phase 2) for tenant/branch scoping.
 *
 * The anomaly → signal mapping is tested against the exported PURE mapper,
 * because detectAllDemandAnomalies derives its windows from the real clock
 * (its own baseline behaviour is covered by its own suite).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { businessSignalSchema, type BusinessSignal } from '../../intelligence/businessSignalTypes';
import { toolRegistry } from '../../tools/registry/toolRegistry';
import { registerAllTools } from '../../tools/registerAllTools';
import type { ToolContext, ToolDefinition } from '../../tools/registry/toolTypes';
import { buildZReportContext, type ZReportContext } from '../zReportContext';
import { collectZReportEvidence, signalFromAnomaly, signalFromWeekdayBaseline, weekdayBaseline } from '../zReportSignals';
import { mergeEvidence } from '../evidenceMerger';
import { describeConflict, detectSignalConflicts } from '../signalConflictDetector';
import type { ZReportEvidence } from '../zReportSignals';
import Bill from '../../../models/intelligence/Bill';
import BranchModel from '../../../models/core/Branch';
import RestaurantModel from '../../../models/core/Restaurant';
import type { DemandAnomaly } from '../../../services/demandAnomalyService';

const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439022';
const BR_A1 = '507f1f77bcf86cd7994390b1';
const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const D = '2026-08-01';
const D_PREV = '2026-07-31';

const tenantA = { restaurantId: A, actorId: 'tester' } as never;

// ─────────────────────────────────────────────────────────────────────────────
// Shared registry stubs (the production execution path only)
// ─────────────────────────────────────────────────────────────────────────────

type StubMode = 'ok' | 'unavailable' | 'throw';

/** Per-tool behaviour, mutable per test (reset in beforeEach). */
const MODES: Record<string, StubMode> = {};

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
  'getWastage',
] as const;

const SEEN: Array<{ name: string; restaurantId: string }> = [];

/** Tool payloads for the two tools whose normalized output the tests assert. */
const PAYLOADS: Record<string, unknown> = {
  getSalesTrends: {
    available: true,
    scope: 'tenant',
    dailyRevenue: 11111,
    weeklyRevenue: 77777,
    monthlyRevenue: 333333,
    orderCount: 100,
    averageOrderValue: 111.11,
    topCategories: [{ name: 'Biryani', revenue: 5000, qty: 50 }],
    weakCategories: [{ name: 'Desserts', revenue: 100, qty: 2 }],
    weekdayPerformance: [1, 2, 3, 4, 5, 6, 7],
    hourlyPerformance: Array.from({ length: 24 }, () => 1),
    generatedAt: new Date().toISOString(),
  },
  getWastage: {
    available: true,
    items: [{ name: 'Paneer', unit: 'kg', qty: 6, cost: 1200, prevQty: 3, prevCost: 600 }],
    generatedAt: new Date().toISOString(),
  },
  getDemandForecast: {
    available: true,
    generatedAt: new Date().toISOString(),
    modelVersion: 'stub-v1',
    evaluationStatus: 'ok',
    predictions: [{ productId: 'prod-1', expected: 42, predictionFor: D, lower: 30, upper: 55 }],
  },
};

/**
 * The shared registry is a single instance and refuses duplicate names, so
 * stubs are swapped through its map and restored in afterAll — the production
 * path stays the only execution path under test.
 */
const registryTools = (toolRegistry as unknown as { tools: Map<string, ToolDefinition<unknown, unknown>> }).tools;
const ORIGINALS = new Map<string, ToolDefinition<unknown, unknown> | undefined>();

function registerStub(name: string) {
  const def: ToolDefinition<Record<string, unknown>, unknown> = {
    name,
    category: 'sales',
    access: 'read',
    meta: { description: `stub ${name}`, source: 'test' },
    inputSchema: z
      .object({
        branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
        lookbackDays: z.number().int().min(7).max(365).optional(),
        days: z.number().int().min(7).max(180).optional(),
      })
      .strict(),
    outputSchema: z.any(),
    execute: async (_input, ctx: ToolContext) => {
      SEEN.push({ name, restaurantId: ctx.tenant.restaurantId });
      const mode = MODES[name] ?? 'unavailable';
      if (mode === 'throw') throw new Error(`stub ${name} exploded`);
      if (mode === 'unavailable') return { available: false, reason: 'NO_DATA', generatedAt: new Date().toISOString() };
      return PAYLOADS[name] ?? { available: true, generatedAt: new Date().toISOString() };
    },
  };
  if (!ORIGINALS.has(name)) ORIGINALS.set(name, registryTools.get(name));
  registryTools.set(name, def as never);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bill seeding (mirrors the reports test-suite pattern)
// ─────────────────────────────────────────────────────────────────────────────

let mongo: MongoMemoryServer;

/**
 * Bills carry BOTH a `date` string (what the reports services filter on) and a
 * `createdAt` timestamp — the demand-anomaly service buckets by `createdAt`.
 * Seeding them inconsistently would place every row in "today" and make the
 * anomaly evidence depend on the wall clock.
 */
const billPayload = (over: any = {}) => {
  const date: string = over.date ?? D;
  return {
    invoiceNumber: `INV-${Math.floor(Math.random() * 1e9)}`,
    ticketNumber: 'T-1',
    date,
    createdAt: new Date(`${date}T12:30:00.000Z`),
    time: '12:30',
  cashierName: 'Owner',
  cashierRole: 'Owner',
  subtotal: 1000,
  discount: 0,
  gst: 0,
  grandTotal: 1000,
  paymentMethod: 'Cash',
  orderType: 'Dine In',
  restaurantId: A,
  branchId: null,
  isVoided: false,
  isRefunded: false,
  refundAmount: 0,
    pointsEarned: 0,
    pointsRedeemed: 0,
    ...over,
  };
};

/** Seed `count` bills of `grandTotal` on `date`. */
async function seedDay(date: string, count: number, grandTotal: number, over: any = {}) {
  for (let i = 0; i < count; i += 1) {
    await Bill.create(billPayload({ date, grandTotal, subtotal: grandTotal, ...over }));
  }
}

async function contextFor(date = D, branchId?: string): Promise<ZReportContext> {
  return buildZReportContext(tenantA, { date, ...(branchId ? { branchId } : {}), now: NOW });
}

/** Syntactically complete closing payload (deterministic figures, not recomputed). */
const CLOSING = {
  sales: {
    date: D,
    grossRevenue: 8400,
    netRevenue: 8200,
    orders: 12,
    averageOrderValue: 683.33,
    discounts: 200,
    taxes: 400,
    payments: [{ method: 'Cash', amount: 8000, count: 10 }],
  },
  cash: {
    openingCash: 2000,
    cashSales: 8000,
    cashIn: 0,
    cashOut: 0,
    expenses: 500,
    adjustments: 0,
    expectedCash: 9500,
    actualCash: 9485,
    overShort: -15,
  },
  requiresManagerApproval: true,
  generatedAt: new Date().toISOString(),
};

function expectScoped(signals: BusinessSignal[], restaurantId: string, branchId: string | null) {
  for (const s of signals) {
    const parsed = businessSignalSchema.safeParse(s);
    expect(parsed.success, `${s.signalId}: ${parsed.success ? '' : JSON.stringify((parsed as { error?: unknown }).error)}`).toBe(true);
    expect(s.scope.restaurantId).toBe(restaurantId);
    expect(s.scope.branchId).toBe(branchId);
    expect(s.scope.scope).toBe(branchId ? 'branch' : 'tenant');
    expect(s.evidence.length).toBeGreaterThan(0);
  }
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  registerAllTools(); // real registry bootstrap (idempotent)
  for (const name of PLAN_TOOLS) registerStub(name);
  await RestaurantModel.create({ restaurantId: 'rest-a', name: 'Rest A', phone: '100' });
  await BranchModel.create({
    _id: new mongoose.Types.ObjectId(BR_A1),
    restaurantId: new mongoose.Types.ObjectId(A),
    name: 'Koramangala',
    isHeadBranch: true,
    isActive: true,
  });
});

afterAll(async () => {
  for (const [name, def] of ORIGINALS) {
    if (def) registryTools.set(name, def);
    else registryTools.delete(name);
  }
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  for (const name of PLAN_TOOLS) MODES[name] = 'unavailable';
  SEEN.length = 0;
  await Bill.deleteMany({}).exec();
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch 1 — core facts through the shared plan/registry path
// ─────────────────────────────────────────────────────────────────────────────

describe('collectZReportEvidence — Batch 1', () => {
  it('normalizes core facts and the added wastage dimension, scoped to the tenant', async () => {
    MODES.getSalesTrends = 'ok';
    MODES.getWastage = 'ok';
    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });

    expect(evidence.batch1.batch).toBe(1);
    expect(evidence.batch1.signals.some((s) => s.source === 'sales_context')).toBe(true);
    // The canonical plan has no wastage step — the pipeline's own step must
    // resolve through the same registry and normalize through the same helper.
    const wastage = evidence.batch1.signals.filter((s) => s.source === 'inventory_context');
    expect(wastage.length).toBeGreaterThan(0);
    expect(wastage.some((s) => s.code === 'inventory_wastage_spike')).toBe(true);
    expectScoped(evidence.batch1.signals, A, null);
    expect(SEEN.length).toBeGreaterThan(0);
    expect(SEEN.every((s) => s.restaurantId === A)).toBe(true);
  });

  it('discloses unavailable normalizers and tool failures instead of hiding them', async () => {
    MODES.getSalesTrends = 'ok';
    MODES.getExpiryRisk = 'throw';
    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });

    const failing = evidence.batch1.toolErrors.find((e) => e.tool === 'getExpiryRisk');
    expect(failing).toBeDefined();
    expect(failing?.code).toBe('TOOL_FAILED');
    expect(failing?.message.length).toBeGreaterThan(0);
    // Every stub that reported itself unavailable is named by normalizer identity.
    expect(evidence.batch1.unavailable.length).toBeGreaterThan(0);
    expect(evidence.batch1.unavailable).not.toContain('sales_context');
  });

  it('folds the deterministic closing report in, and discloses its absence', async () => {
    MODES.getSalesTrends = 'ok';
    const withClosing = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA, closing: CLOSING });
    expect(withClosing.batch1.signals.some((s) => s.code === 'cash_over_short')).toBe(true);
    expect(withClosing.batch1.signals.some((s) => s.code === 'sales_day_close')).toBe(true);

    const withoutClosing = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    expect(withoutClosing.batch1.unavailable).toContain('cash_ledger');
    expect(withoutClosing.batch1.toolErrors.some((e) => e.code === 'NO_CLOSING_REPORT')).toBe(true);
    expect(withoutClosing.caveats.join(' ')).toContain('Closing-day cash/sales facts were not available');
  });

  it('propagates branch scope into every batch-1 signal', async () => {
    MODES.getSalesTrends = 'ok';
    const evidence = await collectZReportEvidence({ context: await contextFor(D, BR_A1), tenant: tenantA });
    expect(evidence.branchId).toBe(BR_A1);
    expectScoped(evidence.batch1.signals, A, BR_A1);
  });

  it('rejects an unauthenticated/invalid tenant before any data work', async () => {
    await expect(
      collectZReportEvidence({ context: await contextFor(), tenant: { restaurantId: 'not-an-id' } as never }),
    ).rejects.toMatchObject({ code: 'TOOL_TENANT_MISMATCH' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch 2 — deterministic derived intelligence (real services + real bills)
// ─────────────────────────────────────────────────────────────────────────────

describe('collectZReportEvidence — Batch 2', () => {
  it('derives a previous-day growth signal across the ±10% threshold', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 12, 700); // 8400
    await seedDay(D_PREV, 10, 400); // 4000 → +110%

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    const growth = evidence.batch2.signals.find((s) => s.code === 'sales_growth');
    expect(growth).toBeDefined();
    expect(growth?.direction).toBe('up');
    expect(growth?.baseline).toBe(4000);
    expect(growth?.value).toBe(8400);
    expect(growth?.changePct).toBeCloseTo(1.1, 1);
    expect(growth?.confidence).toBe(0.85); // 12 orders ≥ the low-sample floor
    expect(growth?.caveats?.join(' ')).toContain('previous calendar day');
    expectScoped(evidence.batch2.signals, A, null);
  });

  it('emits sales_decline for a fall and lowers confidence below the sample floor', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 4, 100); // 400
    await seedDay(D_PREV, 4, 500); // 2000 → −80%

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    const decline = evidence.batch2.signals.find((s) => s.code === 'sales_decline');
    expect(decline).toBeDefined();
    expect(decline?.direction).toBe('down');
    expect(decline?.confidence).toBe(0.6); // 4 orders < 10
    expect(evidence.batch2.signals.some((s) => s.code === 'sales_growth')).toBe(false);
  });

  it('stays silent when the movement is inside the threshold band', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 10, 500);
    await seedDay(D_PREV, 10, 505); // −1%

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    expect(evidence.batch2.signals.some((s) => s.code === 'sales_growth' || s.code === 'sales_decline')).toBe(false);
  });

  it('flags volume/AOV divergence when orders and ticket size move in opposite directions', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 12, 100); // 12 orders × 100
    await seedDay(D_PREV, 10, 200); // 10 orders × 200 → orders +20%, AOV −50%

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    const divergence = evidence.batch2.signals.find((s) => s.code === 'volume_aov_divergence');
    expect(divergence).toBeDefined();
    expect(divergence?.statement).toContain('average order value');
  });

  it('flags discount pressure at/above 15% of gross sales', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 10, 700, { discount: 300, subtotal: 1000 }); // discounts 3000 / gross 7000 = 42.9%

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    const pressure = evidence.batch2.signals.find((s) => s.code === 'discount_pressure');
    expect(pressure).toBeDefined();
    expect(pressure?.statement).toContain('%');
  });

  it('flags refund spikes at/above 5% of net sales, and not below it', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 5, 840); // net 4200
    // refunded bill: net contribution 500 − 450 = 50 → refunds 450 / 4250 = 10.6%
    await Bill.create(billPayload({ date: D, grandTotal: 500, subtotal: 500, isRefunded: true, refundAmount: 450 }));

    const spiked = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    const refund = spiked.batch2.signals.find((s) => s.code === 'refund_spike');
    expect(refund).toBeDefined();
    expect(refund?.value).toBe(450);

    await Bill.deleteMany({}).exec();
    await seedDay(D, 5, 840);
    await Bill.create(billPayload({ date: D, grandTotal: 500, subtotal: 500, isRefunded: true, refundAmount: 10 }));
    const quiet = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    expect(quiet.batch2.signals.some((s) => s.code === 'refund_spike')).toBe(false);
  });

  it('discloses the absence of anomalies as no-evidence rather than inventing any', async () => {
    MODES.getSalesTrends = 'ok';
    // Seeded business date is far outside the anomaly service's rolling window,
    // so this asserts the empty-anomaly path explicitly.
    await seedDay(D, 5, 500);
    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    expect(evidence.batch2.unavailable).toContain('demand_anomaly');
    expect(evidence.batch2.toolErrors.some((e) => e.tool.startsWith('demandAnomaly'))).toBe(false);
    expect(evidence.batch2.caveats.join(' ')).toContain('previous-period v1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weekday-aware rolling baseline (pure mapper + real services)
// ─────────────────────────────────────────────────────────────────────────────

// D = 2026-08-01 is a Saturday; these are prior Saturdays.
const D_W1 = '2026-07-25';
const D_W2 = '2026-07-18';
const D_W3 = '2026-07-11';
const D_W4 = '2026-07-04';

describe('weekdayBaseline (pure)', () => {
  it('averages the trailing 7 calendar days and discloses coverage gaps', () => {
    const series = [
      { date: '2026-07-31', revenue: 700, orders: 10 }, // D−1
      { date: '2026-07-30', revenue: 500, orders: 8 },  // D−2
      { date: '2026-07-29', revenue: 400, orders: 5 },  // D−3
      // D−4, D−5 missing (no bills) → coverage counts them as missing, not zero
      { date: '2026-07-26', revenue: 900, orders: 9 },  // D−6
      { date: '2026-07-25', revenue: 500, orders: 7 },  // D−7
    ];
    const wc = weekdayBaseline(series, D);
    expect(wc.weekday).toBe('Saturday');
    expect(wc.trailing7.daysFound).toBe(5);
    expect(wc.trailing7.avgRevenue).toBe(600); // (700+500+400+900+500)/5
    expect(wc.trailing7.avgOrders).toBe(7.8); // (10+8+5+9+7)/5
  });

  it('picks the 4 most recent prior same weekdays and excludes the business date', () => {
    const series = [
      { date: D, revenue: 999, orders: 99 }, // must be excluded
      { date: D_W1, revenue: 100, orders: 1 },
      { date: D_W2, revenue: 200, orders: 2 },
      { date: D_W3, revenue: 300, orders: 3 },
      { date: D_W4, revenue: 400, orders: 4 },
      { date: '2026-06-27', revenue: 9000, orders: 90 }, // 5th prior Saturday — cut
      { date: '2026-07-31', revenue: 50, orders: 1 }, // Friday — ignored
    ];
    const wc = weekdayBaseline(series, D);
    expect(wc.sameWeekday.days).toBe(4);
    expect(wc.sameWeekday.dates).toEqual([D_W1, D_W2, D_W3, D_W4]);
    expect(wc.sameWeekday.avgRevenue).toBe(250);
    expect(wc.sameWeekday.avgOrders).toBe(2.5);
  });
});

describe('collectZReportEvidence — weekday-aware baseline (Batch 2)', () => {
  it('fires a weekday signal when net revenue clears ±10% vs the same-weekday average', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 12, 300);    // 3600
    await seedDay(D_W1, 10, 500); // 5000
    await seedDay(D_W2, 10, 500); // 5000 → weekday avg 5000 → −28%

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    const weekday = evidence.batch2.signals.find((s) => s.code === 'sales_weekday_baseline');
    expect(weekday).toBeDefined();
    expect(weekday?.direction).toBe('down');
    expect(weekday?.value).toBe(3600);
    expect(weekday?.baseline).toBe(5000);
    expect(weekday?.changePct).toBeCloseTo(-0.28, 2);
    expect(weekday?.statement).toContain('Saturday');
    expect(weekday?.statement).toContain('trailing 7-day average');
    expect(weekday?.confidence).toBe(0.85); // 12 orders ≥ the low-sample floor
    expectScoped(evidence.batch2.signals, A, null);
    // The weekday signal alone justifies the Batch 3 cross-check.
    expect(evidence.batch3Reason.startsWith('triggered:')).toBe(true);
    expect(evidence.batch3Reason).toContain('same-weekday');
  });

  it('stays silent inside the ±10% weekday band', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 10, 505);    // 5050
    await seedDay(D_W1, 10, 500); // 5000
    await seedDay(D_W2, 10, 500); // → +1%

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    expect(evidence.batch2.signals.some((s) => s.code === 'sales_weekday_baseline')).toBe(false);
  });

  it('discloses insufficient history instead of comparing against one prior weekday', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 10, 500);
    await seedDay(D_W1, 10, 500); // only ONE prior Saturday

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    expect(evidence.batch2.signals.some((s) => s.code === 'sales_weekday_baseline')).toBe(false);
    expect(evidence.batch2.caveats.join(' ')).toContain('insufficient history for a weekday baseline');
  });

  it('reports the full baseline semantics when enough history exists', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 10, 500);
    await seedDay(D_W1, 10, 500);
    await seedDay(D_W2, 10, 500);

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    const joined = evidence.batch2.caveats.join(' ');
    expect(joined).toContain('previous-period v1');
    expect(joined).toContain('same weekday (last 2 week(s))');
  });
});

describe('signalFromWeekdayBaseline (pure gating)', () => {
  it('returns null below the minimum same-weekday history', async () => {
    const summary = { summary: { netSales: 3600, orders: 12 } } as never;
    const context = await contextFor();
    const wc = weekdayBaseline([{ date: D_W1, revenue: 5000, orders: 10 }], D);
    expect(signalFromWeekdayBaseline(summary, wc, context)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Anomaly mapping (pure mapper — the service's own windows use the real clock)
// ─────────────────────────────────────────────────────────────────────────────

describe('signalFromAnomaly', () => {
  const anomaly = (over: Partial<DemandAnomaly> = {}): DemandAnomaly => ({
    restaurantId: A,
    type: 'REVENUE_DROP',
    entityType: 'restaurant',
    currentValue: 5000,
    baselineValue: 10000,
    percentageChange: -50,
    confidence: 0.9,
    sampleSize: 20,
    severity: 'high',
    evidence: [
      { description: 'Revenue fell 50% vs baseline', value: 5000, baseline: 10000, percentageChange: -50, sampleSize: 20, confidence: 0.9 },
    ],
    detectedAt: new Date('2026-10-07T00:00:00.000Z'),
    period: 'daily',
    ...over,
  });

  it('maps every canonical anomaly type into an existing signal code', async () => {
    const ctx = await contextFor();
    const mapping: Array<[DemandAnomaly['type'], BusinessSignal['code']]> = [
      ['REVENUE_DROP', 'sales_decline'],
      ['REVENUE_SURGE', 'sales_growth'],
      ['ORDERS_DROP', 'sales_decline'],
      ['ORDERS_SURGE', 'sales_growth'],
      ['PRODUCT_DEMAND_DECLINED', 'product_declining'],
      ['PRODUCT_DEMAND_INCREASED', 'product_growing'],
      ['CATEGORY_UNDERPERFORMING', 'sales_category_weak'],
      ['CATEGORY_OVERPERFORMING', 'sales_category_strong'],
    ];
    for (const [type, code] of mapping) {
      const sig = signalFromAnomaly(anomaly({ type }), ctx);
      expect(sig, type).not.toBeNull();
      expect(sig?.code).toBe(code);
    }
  });

  it('returns null (disclosed, never reshaped) for time-slot anomalies', async () => {
    const ctx = await contextFor();
    for (const type of ['TIME_SLOT_UNDERPERFORMING', 'TIME_SLOT_OVERPERFORMING'] as const) {
      expect(signalFromAnomaly(anomaly({ type }), ctx)).toBeNull();
    }
  });

  it('converts the percentage into a fraction and keeps subject/evidence provenance', async () => {
    const ctx = await contextFor();
    const sig = signalFromAnomaly(
      anomaly({ type: 'PRODUCT_DEMAND_DECLINED', entityType: 'product', entityId: 'prod-1', entityName: 'Paneer Tikka' }),
      ctx,
    );
    expect(sig).not.toBeNull();
    expect(sig?.changePct).toBeCloseTo(-0.5, 6);
    expect(sig?.direction).toBe('down');
    expect(sig?.subject).toEqual({ type: 'product', id: 'prod-1', label: 'Paneer Tikka' });
    expect(sig?.category).toBe('product');
    expect(businessSignalSchema.safeParse(sig).success).toBe(true);
    expectScoped([sig as BusinessSignal], A, null);
  });

  it('does not attach a subject for restaurant-wide and time-slot anomalies', async () => {
    const ctx = await contextFor();
    expect(signalFromAnomaly(anomaly({ entityType: 'restaurant' }), ctx)?.subject).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch 3 gating
// ─────────────────────────────────────────────────────────────────────────────

describe('collectZReportEvidence — Batch 3 gating', () => {
  it('skips Batch 3 when nothing notable moved, stating why', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 10, 500);
    await seedDay(D_PREV, 10, 505);

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    expect(evidence.batch3).toBeNull();
    expect(evidence.batch3Reason).toBe('not triggered (no notable movement)');
  });

  it('triggers Batch 3 automatically on a >25% day-over-day revenue move, with the reason recorded', async () => {
    MODES.getSalesTrends = 'ok';
    MODES.getDemandForecast = 'ok';
    await seedDay(D, 10, 1000);
    await seedDay(D_PREV, 10, 100);

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    expect(evidence.batch3).not.toBeNull();
    expect(evidence.batch3Reason.startsWith('triggered:')).toBe(true);
    expect(evidence.batch3Reason).toContain('revenue moved');
    expect(evidence.batch3?.signals.some((s) => s.source === 'demand_forecast')).toBe(true);
    expect(SEEN.some((s) => s.name === 'getWeatherContext')).toBe(true);
    expectScoped(evidence.batch3?.signals ?? [], A, null);
  });

  it('triggers Batch 3 on a wastage spike in Batch 1 even without revenue movement', async () => {
    MODES.getSalesTrends = 'ok';
    MODES.getWastage = 'ok';
    await seedDay(D, 10, 500);
    await seedDay(D_PREV, 10, 500);

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    expect(evidence.batch3).not.toBeNull();
    expect(evidence.batch3Reason).toContain('wastage signals present');
  });

  it('honours an explicit force and an explicit skip, distinguishably', async () => {
    MODES.getSalesTrends = 'ok';
    MODES.getDemandForecast = 'ok';
    await seedDay(D, 10, 500);
    await seedDay(D_PREV, 10, 500);

    const forced = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA, includeBatch3: true });
    expect(forced.batch3).not.toBeNull();
    expect(forced.batch3Reason).toBe('forced by caller');

    const skipped = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA, includeBatch3: false });
    expect(skipped.batch3).toBeNull();
    expect(skipped.batch3Reason).toBe('skipped by caller');
  });

  it('never lets a failed Batch 3 tool kill the run', async () => {
    MODES.getSalesTrends = 'ok';
    MODES.getDemandForecast = 'throw';
    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA, includeBatch3: true });
    expect(evidence.batch3).not.toBeNull();
    expect(evidence.batch3?.toolErrors.some((e) => e.tool === 'getDemandForecast')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Conflict detection + evidence merging (pure, plus one end-to-end pack)
// ─────────────────────────────────────────────────────────────────────────────

function mkSignal(over: Partial<BusinessSignal> = {}): BusinessSignal {
  return {
    signalId: 'sales_growth:restaurant',
    code: 'sales_growth',
    category: 'sales',
    source: 'sales_context',
    statement: 'Revenue rose.',
    value: 100,
    direction: 'up',
    confidence: 0.8,
    freshness: 'fresh',
    generatedAt: new Date().toISOString(),
    scope: { restaurantId: A, branchId: null, scope: 'tenant' },
    evidence: [{ kind: 'metric', ref: 'metric:x', value: 100 }],
    ...over,
  };
}

function evidenceOf(parts: Partial<Pick<ZReportEvidence, 'batch1' | 'batch2' | 'batch3' | 'batch3Reason' | 'caveats'>>): ZReportEvidence {
  const empty = (batch: 1 | 2 | 3): ZReportEvidence['batch1'] => ({
    batch,
    signals: [],
    toolErrors: [],
    unavailable: [],
    caveats: [],
    durationMs: 1,
  });
  return {
    restaurantId: A,
    businessDate: D,
    batch1: empty(1),
    batch2: empty(2),
    batch3: null,
    batch3Reason: 'skipped by caller',
    caveats: [],
    generatedAt: new Date().toISOString(),
    ...parts,
  } as ZReportEvidence;
}

describe('detectSignalConflicts', () => {
  it('reports a same-metric disagreement above the relative gap threshold', () => {
    const set = detectSignalConflicts([
      mkSignal({ signalId: 'a', value: 100, source: 'sales_context' }),
      mkSignal({ signalId: 'b', value: 40, source: 'cash_ledger' }),
    ]);
    expect(set.conflicts).toHaveLength(1);
    expect(set.checkedSignals).toBe(2);
    expect(set.conflictedMetrics).toEqual(['sales_growth|restaurant']);
    expect(set.conflicts[0].relativeGapPct).toBeCloseTo(0.6, 6);
    const text = describeConflict(set.conflicts[0]);
    expect(text).toContain('sales_growth');
    expect(text).toContain('sales_context');
    expect(text).toContain('cash_ledger');
  });

  it('treats values within the gap threshold as agreement', () => {
    const set = detectSignalConflicts([
      mkSignal({ signalId: 'a', value: 100 }),
      mkSignal({ signalId: 'b', value: 90, source: 'cash_ledger' }),
    ]);
    expect(set.conflicts).toHaveLength(0);
  });

  it('is deterministic and ignores distinct metrics', () => {
    const set = detectSignalConflicts([
      mkSignal({ signalId: 'a', value: 10 }),
      mkSignal({ signalId: 'b', value: 1000, code: 'sales_decline', subject: { type: 'product', id: 'p1' } }),
    ]);
    expect(set.conflicts).toHaveLength(0);
    expect(set.conflictedMetrics).toEqual([]);
  });
});

describe('mergeEvidence', () => {
  it('dedups by metric, keeps the higher-confidence signal and counts the collision', () => {
    const pack = mergeEvidence(
      evidenceOf({
        batch1: {
          batch: 1,
          signals: [mkSignal({ signalId: 'low', confidence: 0.5, value: 10, freshness: 'aging' })],
          toolErrors: [],
          unavailable: [],
          caveats: [],
          durationMs: 1,
        },
        batch2: {
          batch: 2,
          signals: [mkSignal({ signalId: 'high', confidence: 0.9, value: 10 })],
          toolErrors: [],
          unavailable: ['demand_anomaly'],
          caveats: ['baseline note'],
          durationMs: 2,
        },
      }),
    );
    expect(pack.signals).toHaveLength(1);
    expect(pack.signals[0].signalId).toBe('high');
    expect(pack.dedupCollisions).toBe(1);
    expect(pack.unavailable).toEqual(['batch2:demand_anomaly']);
    expect(pack.caveats).toContain('baseline note');
    expect(pack.freshness.fresh).toBe(1);
    expect(pack.usable).toBe(true);
    expect(pack.sources.batch2.durationMs).toBe(2);
    expect(pack.sources.batch3).toBeNull();
  });

  it('discloses stale evidence and marks a pack with only stale signals unusable', () => {
    const pack = mergeEvidence(
      evidenceOf({
        batch1: {
          batch: 1,
          signals: [
            mkSignal({ signalId: 'fresh', confidence: 0.9, freshness: 'fresh' }),
            mkSignal({ signalId: 'stale', subject: { type: 'product', id: 'p1' }, freshness: 'stale', confidence: 0.3 }),
          ],
          toolErrors: [],
          unavailable: [],
          caveats: [],
          durationMs: 1,
        },
      }),
    );
    expect(pack.staleSignals.map((s) => s.signalId)).toEqual(['stale']);
    expect(pack.usable).toBe(true);

    const staleOnly = mergeEvidence(
      evidenceOf({
        batch1: {
          batch: 1,
          signals: [mkSignal({ signalId: 'stale', freshness: 'expired' })],
          toolErrors: [],
          unavailable: [],
          caveats: [],
          durationMs: 1,
        },
      }),
    );
    expect(staleOnly.usable).toBe(false);
    expect(staleOnly.freshness.expired).toBe(1);
  });

  it('aggregates tool failures from all three batches and carries memory degradation', () => {
    const pack = mergeEvidence(
      evidenceOf({
        batch1: {
          batch: 1,
          signals: [],
          toolErrors: [{ tool: 'getExpiryRisk', code: 'TOOL_FAILED', message: 'boom' }],
          unavailable: ['inventory_context'],
          caveats: [],
          durationMs: 1,
        },
        batch3: {
          batch: 3,
          signals: [],
          toolErrors: [{ tool: 'getDemandForecast', code: 'TOOL_TIMEOUT', message: 'slow' }],
          unavailable: [],
          caveats: [],
          durationMs: 3,
        },
      }),
      'memory read degraded',
    );
    expect(pack.toolErrors.map((e) => e.tool)).toEqual(['getExpiryRisk', 'getDemandForecast']);
    expect(pack.unavailable).toEqual(['batch1:inventory_context']);
    expect(pack.memoryDegraded).toEqual({ reason: 'memory read degraded' });
    expect(pack.usable).toBe(false);
  });

  it('produces a usable, tenant-scoped pack from a real evidence collection', async () => {
    MODES.getSalesTrends = 'ok';
    MODES.getWastage = 'ok';
    await seedDay(D, 12, 700);
    await seedDay(D_PREV, 10, 400);
    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA, closing: CLOSING });
    const pack = mergeEvidence(evidence);

    expect(pack.businessDate).toBe(D);
    expect(pack.usable).toBe(true);
    expect(pack.sources.batch1.signals).toBe(evidence.batch1.signals.length);
    expect(pack.signals.some((s) => s.code === 'cash_over_short')).toBe(true);
    expect(pack.signals.some((s) => s.code === 'sales_growth')).toBe(true);
    // 110% day-over-day revenue plus a wastage spike → Batch 3 did run.
    expect(pack.batch3Reason.startsWith('triggered:')).toBe(true);
    expect(pack.sources.batch3).not.toBeNull();
    // The baseline disclosure must survive the merge.
    expect(pack.caveats.join(' ')).toContain('previous calendar day');
    expectScoped(pack.signals, A, null);
    // Batch-1 closing facts and Batch-2 summary facts describe the same day
    // from different sources; any disagreement must be surfaced, not hidden.
    for (const c of pack.conflicts.conflicts) expect(c.relativeGapPct === undefined || c.relativeGapPct > 0.2).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tenant isolation across the whole pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('keeps another tenant\'s bills out of the evidence for tenant A', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 12, 700);
    await seedDay(D_PREV, 10, 400);
    // Tenant B has a very different day, which must never leak into A's pack.
    await seedDay(D, 12, 9_999, { restaurantId: B, branchId: null });
    await seedDay(D_PREV, 10, 1, { restaurantId: B, branchId: null });

    const evidence = await collectZReportEvidence({ context: await contextFor(), tenant: tenantA });
    const growth = evidence.batch2.signals.find((s) => s.code === 'sales_growth');
    expect(growth?.value).toBe(8400);
    expect(growth?.baseline).toBe(4000);

    const forB = await collectZReportEvidence({
      context: { ...(await contextFor()), restaurantId: B },
      tenant: { restaurantId: B, actorId: 'tester' } as never,
    });
    expectScoped(forB.batch2.signals, B, null);
  });
});

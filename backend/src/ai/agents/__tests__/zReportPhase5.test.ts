/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * zReportPhase5.test.ts — Phase 5 (Daily Summary / Z-Report Intelligence)
 * acceptance: the orchestrator service, its persistence, its observability and
 * the HTTP surface registration.
 *
 * Everything is real except the shared LLM client (mocked at that single
 * boundary, exactly like the repository's explanation tests) and the tool
 * registry entries for the plan tools (stubbed through the registry map, as
 * the investigation tests do). The deterministic closing Z-report is the REAL
 * closingReportService over REAL seeded bills.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { z } from 'zod';

vi.mock('../../shared/llmClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/llmClient')>();
  return { ...actual, generateJsonWithMeta: vi.fn() };
});

import { generateJsonWithMeta, type LlmJsonResult } from '../../shared/llmClient';
import { toolRegistry } from '../../tools/registry/toolRegistry';
import { registerAllTools } from '../../tools/registerAllTools';
import type { ToolDefinition } from '../../tools/registry/toolTypes';
import { generateDailySummaryIntelligence } from '../zReportAgent';
import zReportRouter from '../zReportRoutes';
import { deterministicZReportNarrative } from '../zReportPrompts';
import type { ZReportEvidence } from '../zReportSignals';
import { mergeEvidence } from '../evidenceMerger';
import Bill from '../../../models/intelligence/Bill';
import BranchModel from '../../../models/core/Branch';
import RestaurantModel from '../../../models/core/Restaurant';
import DailySummaryEvidenceModel from '../../../models/finance/DailySummaryEvidence';
import AIUsageLog from '../../../models/core/AIUsageLog';

const mockedGenerate = vi.mocked(generateJsonWithMeta);

const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439022';
const BR_A1 = '507f1f77bcf86cd7994390b1';
const D = '2026-08-01';
const D_PREV = '2026-07-31';
const NOW = Date.parse('2026-10-07T12:00:00.000Z');

const tenantA = { restaurantId: A, actorId: 'tester' } as never;

/** Mutable per-tool behaviour for the stubbed plan tools. */
const MODES: Record<string, 'ok' | 'unavailable' | 'throw'> = {};
const PLAN_TOOLS = [
  'getSalesTrends', 'getMenuPerformance', 'getProductMargins', 'getInventoryStatus',
  'getExpiryRisk', 'getStockoutRisk', 'getCustomerSegments', 'getRetentionSignals',
  'getActiveOffers', 'getOfferPerformance', 'getCampaignPerformance', 'getDemandForecast',
  'getMarketBasketSignals', 'getFestivalContext', 'getSportsContext', 'getNearbyCompetition',
  'getWeatherContext', 'getWastage',
] as const;

const PAYLOADS: Record<string, unknown> = {
  getSalesTrends: {
    available: true,
    scope: 'tenant',
    dailyRevenue: 8400,
    weeklyRevenue: 50000,
    monthlyRevenue: 200000,
    orderCount: 12,
    averageOrderValue: 700,
    topCategories: [{ name: 'Biryani', revenue: 5000, qty: 50 }],
    weakCategories: [],
    weekdayPerformance: [1, 2, 3, 4, 5, 6, 7],
    hourlyPerformance: Array.from({ length: 24 }, () => 1),
    generatedAt: new Date().toISOString(),
  },
  getWastage: {
    available: true,
    items: [{ name: 'Paneer', unit: 'kg', qty: 6, cost: 1200, prevQty: 3, prevCost: 600 }],
    generatedAt: new Date().toISOString(),
  },
};

const registryTools = (toolRegistry as unknown as { tools: Map<string, ToolDefinition<unknown, unknown>> }).tools;
const ORIGINALS = new Map<string, ToolDefinition<unknown, unknown> | undefined>();

function registerStub(name: string) {
  const def = {
    name,
    category: 'sales',
    access: 'read',
    meta: { description: `stub ${name}`, source: 'test' },
    inputSchema: z.object({ branchId: z.string().optional(), lookbackDays: z.number().optional(), days: z.number().optional() }).strict(),
    outputSchema: z.any(),
    execute: async () => {
      const mode = MODES[name] ?? 'unavailable';
      if (mode === 'throw') throw new Error(`${name} exploded`);
      if (mode === 'unavailable') return { available: false, reason: 'NO_DATA', generatedAt: new Date().toISOString() };
      return PAYLOADS[name] ?? { available: true, generatedAt: new Date().toISOString() };
    },
  };
  if (!ORIGINALS.has(name)) ORIGINALS.set(name, registryTools.get(name));
  registryTools.set(name, def as never);
}

let mongo: MongoMemoryServer;

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

async function seedDay(date: string, count: number, grandTotal: number, over: any = {}) {
  for (let i = 0; i < count; i += 1) {
    await Bill.create(billPayload({ date, grandTotal, subtotal: grandTotal, ...over }));
  }
}

const llmResult = (value: unknown): LlmJsonResult<unknown> => ({
  value,
  model: 'test-model',
  provider: 'test-provider',
  latencyMs: 20,
  usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  registerAllTools();
  for (const name of PLAN_TOOLS) registerStub(name);
  await RestaurantModel.create({ restaurantId: 'rest-a', name: 'Rest A', phone: '100' });
  await BranchModel.create({
    _id: new mongoose.Types.ObjectId(BR_A1),
    restaurantId: new mongoose.Types.ObjectId(A),
    name: 'Koramangala',
    isHeadBranch: true,
    isActive: true,
  });
  await RestaurantModel.create({ restaurantId: 'rest-b', name: 'Rest B', phone: '200' });
  await BranchModel.create({
    _id: new mongoose.Types.ObjectId('507f1f77bcf86cd7994390b2'),
    restaurantId: new mongoose.Types.ObjectId(B),
    name: 'Foreign Branch',
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
  mockedGenerate.mockReset();
  await Promise.all([
    Bill.deleteMany({}).exec(),
    DailySummaryEvidenceModel.deleteMany({}).exec(),
    AIUsageLog.deleteMany({}).exec(),
  ]);
});

describe('generateDailySummaryIntelligence — end to end', () => {
  it('produces, persists and observes a complete daily summary from real evidence', async () => {
    MODES.getSalesTrends = 'ok';
    MODES.getWastage = 'ok';
    await seedDay(D, 12, 700); // 8400, 12 orders
    await seedDay(D_PREV, 10, 400); // 4000 → +110%

    const result = await generateDailySummaryIntelligence({
      tenant: tenantA,
      date: D,
      now: NOW,
      disableLlm: true,
      executionId: 'run-phase5-1',
    });

    // Report contract
    expect(result.runId).toBe('run-phase5-1');
    expect(result.businessDate).toBe(D);
    expect(result.reportSource).toBe('deterministic');
    expect(result.reportDegradedReason).toBe('llm_disabled');
    expect(result.report.headline).toContain(D);
    expect(result.report.whatHappened.length).toBeGreaterThan(0);
    expect(result.report.needsAttention.length).toBeGreaterThan(0);
    expect(result.report.focusNext.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.degraded).toBe(true); // degraded reads exist and are disclosed
    expect(result.degradations.length).toBeGreaterThan(0);
    expect(result.evidence.signals).toBeGreaterThan(0);
    expect(result.generation.toolCalls).toBeGreaterThan(0);
    // The deterministic narrative is grounded by construction and discloses its
    // gaps, so the critic accepts it (it is only replaced when the critic finds
    // a problem — see the unaddressed-evidence test below).
    expect(result.generation.validationStatus).toContain('accepted');
    expect(result.generation.criticIssues).toEqual([]);

    // Persistence: one document for THIS tenant and date, with the full pack.
    const stored = await DailySummaryEvidenceModel.findOne({ runId: 'run-phase5-1' }).lean();
    expect(stored).not.toBeNull();
    expect(String(stored!.restaurantId)).toBe(A);
    expect(stored!.branchId).toBeNull();
    expect(stored!.businessDate).toBe(D);
    expect(stored!.agent).toBe('z_report');
    expect(stored!.reportSource).toBe('deterministic');
    const pack = stored!.evidencePack as unknown as {
      signals: Array<{ code: string; scope: { restaurantId: string } }>;
      freshness: Record<string, number>;
      batch3Reason: string;
      sources: { batch1: { signals: number } };
    };
    const codes = pack.signals.map((s) => s.code);
    // Batch 1 facts (incl. the real deterministic closing report) + Batch 2 derivation.
    expect(codes).toContain('cash_over_short');
    expect(codes).toContain('sales_day_close');
    expect(codes).toContain('sales_growth');
    expect(codes).toContain('inventory_wastage_spike');
    // Every persisted signal is scoped to the authenticated tenant.
    expect(pack.signals.every((s) => s.scope.restaurantId === A)).toBe(true);
    expect(pack.sources.batch1.signals).toBeGreaterThan(0);
    expect(result.persisted).toBe(true);
    expect(stored!.generationMetadata.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('accepts a grounded LLM narrative and records one AI usage row for the run', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 12, 700);
    await seedDay(D_PREV, 10, 400);

    mockedGenerate.mockResolvedValue(
      llmResult({
        headline: 'On 2026-08-01 net revenue rose and the cash drawer position needs a check.',
        whatHappened: ['Net revenue was 8400 versus 4000 the previous day.', 'The cash drawer variance was flagged by the closing report.'],
        whatMattered: ['The day closed well above the previous day.'],
        needsAttention: ['Recheck the cash drawer count against the closing report.'],
        focusNext: ['Keep the same staffing pattern tomorrow.'],
        caveats: ['Some reads were not available and are excluded from this summary.'],
      }),
    );

    const result = await generateDailySummaryIntelligence({
      tenant: tenantA,
      date: D,
      now: NOW,
      executionId: 'run-phase5-llm',
    });

    expect(result.reportSource).toBe('llm');
    expect(result.report.headline).toContain('cash drawer');
    const stored = await DailySummaryEvidenceModel.findOne({ runId: 'run-phase5-llm' }).lean();
    expect(stored?.reportSource).toBe('llm');
    expect(stored?.generationMetadata.llmTokens).toBe(300);

    const usage = await AIUsageLog.find({ requestId: 'run-phase5-llm' }).lean();
    expect(usage).toHaveLength(1);
    expect(usage[0].feature).toBe('z_report');
    expect(usage[0].success).toBe(true);
    expect(String(usage[0].restaurantId)).toBe(A);
    expect(usage[0].promptHash).toBeTruthy();
  });

  it('overrides an ungrounded-but-valid LLM report when the critic finds unaddressed evidence', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 12, 700);
    await seedDay(D_PREV, 10, 400);

    // Grounded numbers, but it never addresses the drawer variance the pack
    // contains → the critic must force the deterministic narrative.
    mockedGenerate.mockResolvedValue(
      llmResult({
        headline: 'Net revenue was 8400 versus 4000 the previous day.',
        whatHappened: ['Net revenue was 8400 versus 4000.'],
        whatMattered: ['Sales grew.'],
        needsAttention: ['Review tomorrow.'],
        focusNext: ['Keep going.'],
        caveats: [],
      }),
    );

    const result = await generateDailySummaryIntelligence({
      tenant: tenantA,
      date: D,
      now: NOW,
      executionId: 'run-phase5-critic',
    });

    expect(result.reportSource).toBe('deterministic');
    expect(result.reportDegradedReason).toContain('critic_repair');
    expect(result.report.needsAttention.join(' ')).toMatch(/cash|drawer|till|variance/i);
    expect(result.generation.criticIssues.join(' ')).toContain('unaddressed:cash_over_short');
    const stored = await DailySummaryEvidenceModel.findOne({ runId: 'run-phase5-critic' }).lean();
    expect(stored?.reportSource).toBe('deterministic');
    expect(stored?.degraded).toBe(true);
  });

  it('runs a branch-scoped summary only for a branch the tenant owns', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 12, 700, { branchId: new mongoose.Types.ObjectId(BR_A1) });
    await seedDay(D_PREV, 10, 400, { branchId: new mongoose.Types.ObjectId(BR_A1) });

    const own = await generateDailySummaryIntelligence({
      tenant: tenantA,
      date: D,
      branchId: BR_A1,
      now: NOW,
      disableLlm: true,
    });
    expect(own.branchId).toBe(BR_A1);
    expect(own.branchName).toBe('Koramangala');
    expect(own.reportSource).toBe('deterministic');

    await expect(
      generateDailySummaryIntelligence({
        tenant: tenantA,
        date: D,
        branchId: '507f1f77bcf86cd7994390b2', // tenant B's branch
        now: NOW,
        disableLlm: true,
      }),
    ).rejects.toMatchObject({ code: 'TOOL_TENANT_MISMATCH' });
  });

  it('rejects a malformed business date before any data work', async () => {
    await expect(
      generateDailySummaryIntelligence({ tenant: tenantA, date: '2026-02-30', now: NOW, disableLlm: true }),
    ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });

    await expect(
      generateDailySummaryIntelligence({ tenant: { restaurantId: 'nope' } as never, disableLlm: true }),
    ).rejects.toMatchObject({ code: 'TOOL_TENANT_MISMATCH' });
  });

  it('honours persist:false and never writes history for that run', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 5, 500);
    const result = await generateDailySummaryIntelligence({
      tenant: tenantA,
      date: D,
      now: NOW,
      disableLlm: true,
      persist: false,
      executionId: 'run-phase5-nopersist',
    });
    expect(result.persisted).toBe(false);
    expect(await DailySummaryEvidenceModel.countDocuments({ runId: 'run-phase5-nopersist' })).toBe(0);
  });

  it('keeps a tenant\'s summary isolated from another tenant\'s data', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 12, 700);
    await seedDay(D_PREV, 10, 400);
    await seedDay(D, 50, 9_999, { restaurantId: B });

    const forA = await generateDailySummaryIntelligence({ tenant: tenantA, date: D, now: NOW, disableLlm: true });
    const stored = await DailySummaryEvidenceModel.findOne({ runId: forA.runId }).lean();
    const pack = stored!.evidencePack as unknown as { signals: Array<{ value?: number }> };
    // Tenant B's 50 huge bills must not appear anywhere in A's evidence.
    expect(pack.signals.some((s) => s.value === 9_999)).toBe(false);
    expect(String(stored!.restaurantId)).toBe(A);

    const forB = await generateDailySummaryIntelligence({
      tenant: { restaurantId: B, actorId: 'tester' } as never,
      date: D,
      now: NOW,
      disableLlm: true,
    });
    const storedB = await DailySummaryEvidenceModel.findOne({ runId: forB.runId }).lean();
    expect(String(storedB!.restaurantId)).toBe(B);
    // Scoped reads: A's run is not reachable from B's tenant scope.
    const crossTenant = await DailySummaryEvidenceModel.findOne({ restaurantId: B, runId: forA.runId }).lean();
    expect(crossTenant).toBeNull();
  });

  it('regenerate performs a fresh run and appends history instead of overwriting', async () => {
    MODES.getSalesTrends = 'ok';
    await seedDay(D, 12, 700);
    await seedDay(D_PREV, 10, 400);

    const first = await generateDailySummaryIntelligence({ tenant: tenantA, date: D, now: NOW, disableLlm: true });
    const second = await generateDailySummaryIntelligence({ tenant: tenantA, date: D, now: NOW, disableLlm: true });
    expect(second.runId).not.toBe(first.runId);
    const docs = await DailySummaryEvidenceModel.find({ restaurantId: A, businessDate: D }).lean();
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.promptVersion === 'z-report-daily-v1')).toBe(true);
  });

  it('exposes a complete evidencepack shape that the deterministic narrative can consume', async () => {
    // Guards the contract between the collection layer and the synthesis layer:
    // a real collected+merged pack must be usable by the narrative builder.
    const evidence: ZReportEvidence = {
      restaurantId: A,
      businessDate: D,
      batch1: { batch: 1, signals: [], toolErrors: [], unavailable: ['inventory_context'], caveats: ['c'], durationMs: 1 },
      batch2: { batch: 2, signals: [], toolErrors: [], unavailable: [], caveats: [], durationMs: 1 },
      batch3: null,
      followUp: null,
      batch3Reason: 'not triggered (no notable movement)',
      caveats: [],
      generatedAt: new Date().toISOString(),
    };
    const pack = mergeEvidence(evidence);
    expect(pack.sources.followUp).toBeNull();
    const narrative = deterministicZReportNarrative({ businessDate: D, comparison: { previousDate: D_PREV } } as never, pack);
    expect(narrative.headline).toContain(D);
  });
});

describe('zReportRoutes registration', () => {
  it('registers POST /generate on the mounted router path', () => {
    const stack = (zReportRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack;
    const generate = stack.find((l) => l.route?.path === '/generate');
    expect(generate).toBeDefined();
    expect(generate?.route?.methods.post).toBe(true);
    // The deterministic Z-report route lives elsewhere and is untouched.
    expect(stack.some((l) => l.route?.path === '/closing/z')).toBe(false);
  });
});

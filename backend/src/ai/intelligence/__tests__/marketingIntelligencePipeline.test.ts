/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingIntelligencePipeline.test.ts — PHASE 3→7 end-to-end acceptance.
 *
 * The pipeline is exercised with the REAL business-investigation fan-out (via
 * the shared registry with stub tools), the REAL ranking and explanation code
 * (LLM disabled), and a mocked candidate-engine call so no database is needed.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// The candidate engine is mocked at the SERVICE boundary the tool calls —
// everything else (tool shape, ranking, explanation) stays real.
vi.mock('../../../services/promotionCandidateService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/promotionCandidateService')>();
  return {
    ...actual,
    generatePromotionCandidates: vi.fn(async () => CANDIDATES),
  };
});

import type { PromotionCandidate } from '../../../services/promotionCandidateService';
import { runMarketingIntelligence, marketingIntelligenceLines, memoryStatement } from '../marketingIntelligencePipeline';
import { toolRegistry } from '../../tools/registry/toolRegistry';
import { registerAllTools } from '../../tools/registerAllTools';
import type { ToolContext, ToolDefinition } from '../../tools/registry/toolTypes';

const A = '507f1f77bcf86cd799439011';
const tenantA = { restaurantId: A, actorId: 'a' } as never;

function candidate(over: Partial<PromotionCandidate> & { id: string; type: PromotionCandidate['type'] }): PromotionCandidate {
  return {
    id: over.id,
    type: over.type,
    priority: over.priority ?? 'medium',
    score: over.score ?? 70,
    confidence: over.confidence ?? 0.7,
    title: over.title ?? `Candidate ${over.id}`,
    description: over.description ?? 'desc',
    target: over.target ?? { productIds: [], productNames: [], categoryIds: [], segmentIds: [] },
    evidence: over.evidence ?? [{ description: 'evidence line', value: 1 }],
    financialModel: {
      currentPrice: 200, proposedPrice: 180, recipeCost: 80,
      discountPercent: 10, discountAmount: 20, currentContribution: 120,
      projectedContribution: 100, projectedContributionMargin: 55,
      incrementalUnits: 20, incrementalRevenue: 3600, incrementalContribution: 400,
      breakEvenIncrementalUnits: 5, paybackPeriodDays: 3,
      minMarginConstraint: 15, maxDiscountConstraint: 30,
      ...over.financialModel,
    },
    cannibalization: over.cannibalization ?? { estimatedCannibalizationRate: 0.1, incrementalVsCannibalized: 2, confidence: 0.6, evidence: [] },
    risks: over.risks ?? [],
    prerequisites: over.prerequisites ?? [],
    constraints: over.constraints ?? { minMarginPercent: 15, maxDiscountPercent: 30, minSellingPrice: 50, restrictedCategories: [], excludedProductIds: [] },
    status: 'NEW',
    recommendedAction: over.recommendedAction ?? 'create_combo',
    sourceSignals: over.sourceSignals ?? [],
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    expiresAt: new Date('2026-11-01T00:00:00.000Z'),
  };
}

const CANDIDATES: PromotionCandidate[] = [
  candidate({ id: 'c1', type: 'CREATE_COMBO', score: 88, title: 'Lunch combo' }),
  candidate({ id: 'c2', type: 'RUN_REACTIVATION', score: 82, title: 'Win-back' }),
  candidate({ id: 'c3', type: 'REDUCE_WASTAGE', score: 75, title: 'Clear expiring stock' }),
  candidate({ id: 'c4', type: 'CREATE_COMBO', score: 74, title: 'Combo 2' }),
  candidate({ id: 'c5', type: 'PROMOTE_SLOW_ITEM', score: 71, title: 'Slow item push' }),
];

const registryTools = (toolRegistry as unknown as { tools: Map<string, ToolDefinition<unknown, unknown>> }).tools;
const ORIGINALS = new Map<string, ToolDefinition<unknown, unknown> | undefined>();

function stub(name: string, output: unknown) {
  if (!ORIGINALS.has(name)) ORIGINALS.set(name, registryTools.get(name));
  registryTools.set(name, {
    name,
    category: 'sales',
    access: 'read',
    meta: { description: `stub ${name}`, source: 'test' },
    inputSchema: z.object({ branchId: z.string().optional() }).passthrough(),
    outputSchema: z.any(),
    execute: async (_input: unknown, ctx: ToolContext) => {
      SEEN.push({ name, restaurantId: ctx.tenant.restaurantId });
      return output;
    },
  } as never);
}

const SEEN: Array<{ name: string; restaurantId: string }> = [];

beforeAll(() => {
  registerAllTools();
  const now = new Date().toISOString();
  stub('getSalesTrends', {
    available: true, scope: 'tenant', dailyRevenue: 45000, weeklyRevenue: 315000, monthlyRevenue: 1350000,
    orderCount: 320, averageOrderValue: 140, topCategories: [{ name: 'Mains', revenue: 20000, qty: 90 }],
    weakCategories: [{ name: 'Desserts', revenue: 800, qty: 4 }], weekdayPerformance: [1, 2, 3, 4, 5, 9, 8],
    hourlyPerformance: Array.from({ length: 24 }, (_, h) => (h === 13 ? 500 : 10)), generatedAt: now,
  });
  stub('getMenuPerformance', { available: false, reason: 'NO_MENU_PERFORMANCE_DATA', generatedAt: now });
  stub('getProductMargins', { available: false, reason: 'NO_MARGIN_DATA', generatedAt: now });
  stub('getInventoryStatus', { available: false, reason: 'NO_INVENTORY_DATA', generatedAt: now });
  stub('getExpiryRisk', {
    available: true,
    alerts: [{ itemId: 'i1', itemName: 'Cream', currentStock: 4, daysUntilExpiry: 2, severity: 'critical', canPromote: true }],
    generatedAt: now,
  });
  stub('getStockoutRisk', { available: false, reason: 'NO_STOCKOUT_RISK', generatedAt: now });
  stub('getCustomerSegments', { available: true, segments: [{ id: 's1', name: 'VIP', customerCount: 120 }], generatedAt: now });
  stub('getRetentionSignals', {
    available: true,
    summary: { totalCustomers: 1000, newCustomers: 50, activeCustomers: 600, inactiveCustomers: 300, highValueCustomers: 90, atRiskCustomers: 75, avgOrderValue: 150, avgVisitsPerCustomer: 3 },
    generatedAt: now,
  });
  stub('getActiveOffers', { available: false, reason: 'NO_ACTIVE_OFFERS', generatedAt: now });
  stub('getOfferPerformance', {
    available: true,
    offers: [{ offerId: 'o1', title: 'Weak offer', redemptions: 1, revenueGenerated: 100, discountGiven: 10, averageOrderValue: 100, uniqueCustomers: 200, repeatCustomers: 0 }],
    generatedAt: now,
  });
  stub('getCampaignPerformance', { available: false, reason: 'NO_CAMPAIGN_HISTORY', generatedAt: now });
  stub('getDemandForecast', {
    available: true, modelId: 'demand', modelVersion: 'v2', evaluationStatus: 'evaluated', freshnessAgeDays: 1,
    predictions: [{ productId: 'p1', predictionFor: '2026-10-05', expected: 40, lower: null, upper: null, confidenceLevel: null, dataMode: null }],
    generatedAt: now,
  });
  stub('getMarketBasketSignals', {
    available: true, modelId: 'combo', modelVersion: 'v2', predictionSource: 'stored_predictions',
    signals: [{ productAId: 'p1', productBId: 'p2', expectedPurchases7d: 25, estimatedFutureProfit: 4000, source: 'ml_prediction' }],
    generatedAt: now,
  });
  stub('getFestivalContext', { available: true, nearest: { name: 'Diwali', daysAway: 3 }, generatedAt: now });
  stub('getSportsContext', { available: false, reason: 'NO_RELEVANT_SPORTS_EVENT', generatedAt: now });
  stub('getNearbyCompetition', {
    available: true, summary: { totalCompetitors: 12, nearestDistanceMeters: 300, density: 'high' }, searchRadiusMeters: 2000,
    signals: [{ freshness: { status: 'fresh' } }], generatedAt: now,
  });
  stub('getWeatherContext', { available: true, current: { condition: 'clear', temperatureC: 28 }, generatedAt: now });
  stub('getUpliftSignals', { available: false, modelId: 'uplift', evaluationStatus: 'not_evaluable', gateReasons: ['treated rows 30 < 100 minimum'], detail: 'Experiment data does not support trustworthy uplift estimates.', generatedAt: now });
  stub('getOfferResponseBatchScores', { available: true, modelId: 'response', evaluationStatus: 'evaluated', generatedAt: now });
  stub('getMLCustomerSegments', { available: true, modelId: 'segment', evaluationStatus: 'evaluated', generatedAt: now });
});

afterAll(() => {
  for (const [name, original] of ORIGINALS) {
    if (original) registryTools.set(name, original);
    else registryTools.delete(name);
  }
  ORIGINALS.clear();
});

beforeEach(() => {
  SEEN.length = 0;
});

const memoryContext = {
  episodes: [],
  longTerm: [
    {
      id: 'mem1',
      restaurantId: A,
      branchId: null,
      memoryType: 'customer_behavior_pattern',
      entityRef: '',
      value: { weekendComboLiftPct: 12 },
      confidence: 0.8,
      sampleSize: 100,
      evidence: [],
      source: 'service',
      status: 'active',
      tags: [],
      lastValidatedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
      priority: 'long_term_memory',
    },
  ],
  priorityStatement: 'x',
  loadedAt: '2026-10-04T00:00:00.000Z',
} as never;

describe('1. full pipeline (signals → candidates → ML → ranking → explanation)', () => {
  it('produces a diverse, grounded result end to end', async () => {
    const result = await runMarketingIntelligence({
      tenant: tenantA,
      limit: 5,
      disableLlm: true,
      loadMemory: async () => memoryContext,
    });

    // Ranking selected candidates and kept strategy diversity.
    expect(result.ranking.recommendations.length).toBeGreaterThanOrEqual(4);
    expect(result.ranking.recommendations[0].id).toBe('c1');
    expect(result.ranking.strategies.length).toBeGreaterThanOrEqual(3);

    // Signals were gathered through the shared registry with the right tenant.
    expect(result.investigation).toBeDefined();
    expect(result.investigation!.summary.signals).toBeGreaterThan(0);
    expect(SEEN.every((s) => s.restaurantId === A)).toBe(true);
    expect(result.investigation!.topSignalLines.length).toBeGreaterThan(0);

    // ML semantics: response ≠ uplift; the smoke-test gate failure is surfaced.
    expect(result.ml.summary.hasCausalEvidence).toBe(false);
    expect(result.ml.summary.hasTargetingEvidence).toBe(true);
    expect(result.ml.summary.availableKinds).toContain('response_model');
    expect(result.ml.degradationLines.join(' ')).toContain('not usable yet');

    // Long-term memory was loaded and described, not dumped.
    expect(result.memory.longTerm).toBe(1);
    expect(result.memory.statements[0].statement).toContain('customer behavior pattern');

    // Explanation degraded to the deterministic path (LLM disabled).
    expect(result.explanation).not.toBeNull();
    expect(result.explanation!.source).toBe('deterministic');
    expect(JSON.stringify(result.explanation)).not.toMatch(/chain|reasoning|thought/i);

    // Every recommendation keeps evidence + economics + provenance.
    for (const rec of result.ranking.recommendations) {
      expect(rec.economics.projectedContributionMargin).toBeGreaterThan(0);
      expect(rec.provenance).toBeDefined();
      expect(rec.why.length).toBeGreaterThan(0);
    }
  });

  it('exposes compact lines for prompt/UI use', async () => {
    const result = await runMarketingIntelligence({ tenant: tenantA, limit: 3, disableLlm: true, loadMemory: async () => memoryContext });
    const lines = marketingIntelligenceLines(result);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/^#1 \[/);
  });
});

describe('2. degradation: signals unavailable, candidates unavailable', () => {
  it('reports missing dimensions and tool failures without failing the run', async () => {
    const result = await runMarketingIntelligence({
      tenant: tenantA,
      limit: 5,
      disableLlm: true,
      dimensions: ['menu', 'margin'] as never,
      loadMemory: async () => memoryContext,
    });
    expect(result.investigation!.summary.unavailableDimensions.length).toBeGreaterThan(0);
    expect(result.ranking.recommendations.length).toBeGreaterThan(0); // ranking still works
    expect(result.degradations.length).toBeGreaterThan(0);
  });

  it('memory load failure degrades but the pipeline completes', async () => {
    const result = await runMarketingIntelligence({
      tenant: tenantA,
      limit: 3,
      disableLlm: true,
      loadMemory: async () => {
        throw new Error('mongo down');
      },
    });
    expect(result.memory.degraded).toBe(true);
    expect(result.memory.longTerm).toBe(0);
    expect(result.ranking.recommendations.length).toBeGreaterThan(0);
  });

  it('rejects invalid tenant identity', async () => {
    await expect(runMarketingIntelligence({ tenant: {} as never })).rejects.toThrow(/authenticated tenant/);
  });
});

describe('3. memory statement rendering', () => {
  it('renders structured values as short human statements', () => {
    const s = memoryStatement({
      id: 'm',
      memoryType: 'campaign_performance_pattern',
      entityRef: 'channel:sms',
      value: { redemptionRate: 0.16, recipients: 500 },
      confidence: 0.8,
      sampleSize: 500,
      source: 'service',
      status: 'active',
      tags: [],
      lastValidatedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
      restaurantId: A,
      branchId: null,
      priority: 'long_term_memory',
    } as never);
    expect(s).toContain('campaign performance pattern');
    expect(s).toContain('channel:sms');
    expect(s).toContain('redemptionRate=0.16');
  });
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAnalyze.test.ts — the canonical Marketing Agent path.
 *
 * Covers the rules that are easy to regress:
 *   - no hidden reasoning can be returned (strict critic schema);
 *   - an unimplemented / empty domain is NEVER reported as "healthy";
 *   - the stop guard refuses a whole-restaurant conclusion from one domain;
 *   - the deterministic validation gate rejects on economics, stockout and
 *     untargeted win-backs, and the LLM cannot resurrect them;
 *   - the final critic degrades explicitly (never silently) without a model;
 *   - the /analyze orchestrator completes end-to-end with NO model, disclosed
 *     as degraded, and declares the declared-only domains.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { criticVerdictSchema, criticResponseSchema } from '../contracts';
import { buildSituationModel } from '../situationModel';
import { marketingManagerStopGuard, investigationsFromMemory, runMarketingManager } from '../marketingManager';
import type { LoopLlmFn, LoopMemoryFn } from '../../agents/loop/agentLoop';
import {
  validateCandidates,
  fetchStockoutExposure,
  fetchActiveOfferCoverage,
  type StockoutExposure,
  type ActiveOfferCoverage,
  type ValidationSources,
} from '../validationGate';
import { promotionTypesForDirections, reportDirectionPolicy, directionRealised, DIRECTION_TO_TYPES } from '../directionPolicy';
import { generatePromotionCandidates } from '../../../services/promotionCandidateService';
import { registerAllTools } from '../../tools/registerAllTools';
import { runFinalCritic } from '../finalCritic';
import { runMarketingAnalyze } from '../analyze';
import { DOMAIN_SPECS, domainCapabilityCatalog, registerMarketingDomainTools, domainNameForTool } from '../domains';
import { toolRegistry } from '../../tools/registry/toolRegistry';
import type { AgentRunMemory } from '../../shared/agentRunContext';
import type { DomainInvestigation } from '../contracts';
import type { PromotionCandidate } from '../../../services/promotionCandidateService';
import type { MlSignalSummary } from '../../intelligence/mlTypes';
import type { BusinessSignal } from '../../intelligence/businessSignalTypes';

let mongod: MongoMemoryServer;

const R1 = '507f1f77bcf86cd799439011';
const tenant = { restaurantId: R1, actorId: 'actor-1' };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  registerMarketingDomainTools();
  registerAllTools();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ─────────────────────────────────────────────────────────────────────────────
// Contracts
// ─────────────────────────────────────────────────────────────────────────────

describe('marketing contracts', () => {
  it('rejects a critic verdict that smuggles a chain-of-thought field', () => {
    const bad = {
      candidateId: 'c1',
      verdict: 'REJECT',
      reasons: ['unsupported'],
      chainOfThought: 'the model was thinking about margins',
    };
    expect(criticVerdictSchema.safeParse(bad).success).toBe(false);
    expect(criticResponseSchema.safeParse({ verdicts: [bad], reasoning: 'why' }).success).toBe(false);
  });

  it('accepts a well-formed grounded verdict', () => {
    const good = { candidateId: 'c1', verdict: 'DOWNGRADE', reasons: ['evidence disagrees'], confidenceDelta: -0.1 };
    expect(criticVerdictSchema.safeParse(good).success).toBe(true);
  });

  it('every declared capability is registered in the ONE shared registry', () => {
    for (const spec of DOMAIN_SPECS) {
      const tool = toolRegistry.get(spec.toolName);
      expect(tool, `${spec.toolName} must be registered`).toBeDefined();
      expect(tool?.access).toBe('read');
      expect(tool?.category).toBe('domain');
    }
  });

  it('declares feedback and competition as declared-only capabilities', () => {
    const catalog = domainCapabilityCatalog();
    const feedback = catalog.find((c) => c.domain === 'feedback');
    const competition = catalog.find((c) => c.domain === 'competition');
    expect(feedback?.implemented).toBe(false);
    expect(competition?.implemented).toBe(false);
    expect(catalog.filter((c) => c.implemented).length).toBeGreaterThanOrEqual(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Situation model
// ─────────────────────────────────────────────────────────────────────────────

function investigation(over: Partial<DomainInvestigation> & Pick<DomainInvestigation, 'domain'>): DomainInvestigation {
  return {
    status: 'ok',
    question: 'q',
    findings: [],
    signals: [],
    evidenceRefs: [],
    implemented: true,
    durationMs: 1,
    generatedAt: new Date().toISOString(),
    ...over,
  };
}

function signal(over: Partial<BusinessSignal> & Pick<BusinessSignal, 'signalId' | 'code'>): BusinessSignal {
  return {
    category: 'product',
    source: 'menu_engineering',
    statement: 'statement',
    direction: 'down',
    confidence: 0.8,
    freshness: 'fresh',
    generatedAt: new Date().toISOString(),
    scope: { restaurantId: R1, branchId: null, scope: 'tenant' },
    evidence: [],
    ...over,
  };
}

describe('situation model', () => {
  it('never reports an unavailable domain as healthy and drops evidence-less facts', () => {
    const model = buildSituationModel({
      objective: 'goal',
      investigations: [
        investigation({
          domain: 'inventory',
          status: 'unavailable',
          reasonCode: 'NO_DATA_IN_DOMAIN',
          degradedReason: 'no stock data in window',
          findings: [{ code: 'x', domain: 'inventory', statement: 'no evidence', confidence: 1, evidenceRefs: [] }],
        }),
      ],
    });
    expect(model.unavailableDomains).toEqual(['inventory']);
    expect(model.confirmedFacts).toHaveLength(0);
    expect(model.missingEvidence.join(' ')).toContain('inventory');
    expect(model.uncertainties.join(' ')).toContain('no stock data in window');
  });

  it('derives an evidence-backed direction from an actionable signal', () => {
    const s = signal({
      signalId: 'sig-1',
      code: 'product_slow_moving',
      subject: { type: 'product', id: 'p1', label: 'Paneer Tikka' },
    });
    const model = buildSituationModel({
      objective: 'goal',
      investigations: [
        investigation({
          domain: 'products',
          signals: [s],
          findings: [
            {
              code: 'product_slow_moving',
              domain: 'products',
              statement: 'Paneer Tikka is moving slowly',
              confidence: 0.8,
              evidenceRefs: ['signal:sig-1'],
            },
          ],
        }),
      ],
    });
    expect(model.opportunities).toHaveLength(1);
    expect(model.candidateDirections[0]?.direction).toBe('activate_slow_item');
    expect(model.candidateDirections[0]?.target.productNames).toEqual(['Paneer Tikka']);
    expect(model.candidateDirections[0]?.evidenceRefs).toEqual(['signal:sig-1']);
    expect(model.confidence).toBeGreaterThan(0);
  });

  it('surfaces a contradiction between two domains instead of resolving it', () => {
    const model = buildSituationModel({
      objective: 'goal',
      investigations: [
        investigation({
          domain: 'products',
          signals: [
            signal({ signalId: 's1', code: 'product_growing', subject: { type: 'product', id: 'p1' } }),
            signal({ signalId: 's2', code: 'product_declining', subject: { type: 'product', id: 'p1' } }),
          ],
        }),
      ],
    });
    expect(model.contradictions).toHaveLength(1);
    expect(model.contradictions[0]).toContain('product:p1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stop guard + captured investigations
// ─────────────────────────────────────────────────────────────────────────────

function memoryWith(observations: Array<{ tool: string; ok: boolean; usable?: boolean }>, toolCalls = observations.length): AgentRunMemory {
  return {
    observations: observations.map((o) => ({ step: 1, tool: o.tool, ok: o.ok, usable: o.usable, summary: '' })),
    toolCalls: Array.from({ length: toolCalls }, () => ({})),
  } as unknown as AgentRunMemory;
}

describe('marketing manager stop guard', () => {
  it('refuses to conclude with no investigation at all', () => {
    const objection = marketingManagerStopGuard(memoryWith([], 0));
    expect(objection).toContain('No domain has been investigated');
  });

  it('refuses a whole-restaurant conclusion from a single usable domain', () => {
    const objection = marketingManagerStopGuard(
      memoryWith([{ tool: 'investigateSalesDomain', ok: true, usable: true }]),
    );
    expect(objection).toContain('one domain');
    expect(objection).toContain('not evidence that business is healthy');
  });

  it('allows the stop once two independent domains returned usable evidence', () => {
    expect(
      marketingManagerStopGuard(
        memoryWith([
          { tool: 'investigateSalesDomain', ok: true, usable: true },
          { tool: 'investigateCustomersDomain', ok: true, usable: true },
        ]),
      ),
    ).toBeNull();
  });

  it('an empty domain does not count as usable evidence', () => {
    const objection = marketingManagerStopGuard(
      memoryWith([
        { tool: 'investigateSalesDomain', ok: true, usable: false },
        { tool: 'investigateInventoryDomain', ok: true, usable: true },
      ]),
    );
    expect(objection).not.toBeNull();
  });

  it('keeps the first successful investigation per domain and ignores failures', () => {
    const a = investigation({ domain: 'sales' });
    const b = investigation({ domain: 'sales', status: 'unavailable' });
    const memory = {
      toolData: [
        { step: 1, tool: 'investigateSalesDomain', ok: true, data: a },
        { step: 2, tool: 'investigateSalesDomain', ok: true, data: b },
        { step: 3, tool: 'investigateCustomersDomain', ok: false, data: null },
        { step: 4, tool: 'getSalesTrends', ok: true, data: {} },
      ],
    } as unknown as AgentRunMemory;
    const result = investigationsFromMemory(memory);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sequential investigation, driven by a scripted model
// ─────────────────────────────────────────────────────────────────────────────

const emptyMemory: LoopMemoryFn = async () => ({
  episodes: [],
  longTerm: [],
  priorityStatement: 'current data first',
  loadedAt: new Date().toISOString(),
});

function scriptedLlm(steps: Array<{ tool: string; needMoreEvidence: boolean }>): LoopLlmFn {
  let i = 0;
  return async () => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return {
      value: {
        plan: [],
        toolCalls: [{ name: step.tool }],
        needMoreEvidence: step.needMoreEvidence,
        reason: `step ${i}`,
      },
    };
  };
}

describe('marketing manager sequential investigation', () => {
  it('reads ONE domain per step, in the order the model chooses, and returns the captured investigations', async () => {
    const result = await runMarketingManager({
      tenant,
      objective: 'Find the most important marketing action.',
      llm: scriptedLlm([
        { tool: 'investigateSalesDomain', needMoreEvidence: true },
        { tool: 'investigateCustomersDomain', needMoreEvidence: true },
        { tool: 'investigateMarketingHistoryDomain', needMoreEvidence: false },
      ]),
      loadMemory: emptyMemory,
    });

    // One domain per step — never a batch.
    expect(result.domainOrder).toEqual(['sales', 'customers', 'marketing_history']);
    expect(result.memory.toolCalls).toHaveLength(3);

    // The EXACT domain results reach the deterministic layers (the old defect was
    // that the agent's observations were discarded before recommendation build).
    expect(result.investigations.map((i) => i.domain).sort()).toEqual(['customers', 'marketing_history', 'sales']);
    for (const investigation of result.investigations) {
      expect(typeof investigation.question).toBe('string');
      expect(investigation.question.length).toBeGreaterThan(0);
      expect(Array.isArray(investigation.findings)).toBe(true);
    }
  });

  it('never reports a sufficient stop unless two independent domains returned usable evidence', async () => {
    const result = await runMarketingManager({
      tenant,
      objective: 'Find the most important marketing action.',
      llm: scriptedLlm([
        { tool: 'investigateSalesDomain', needMoreEvidence: true },
        { tool: 'investigateInventoryDomain', needMoreEvidence: true },
        { tool: 'investigateCustomersDomain', needMoreEvidence: false },
      ]),
      loadMemory: emptyMemory,
      budget: { maxSteps: 4, maxToolCalls: 6, durationMs: 30_000 },
    });

    const usableDomains = new Set(
      result.memory.observations
        .filter((o) => o.ok && o.usable !== false)
        .map((o) => domainNameForTool(o.tool))
        .filter(Boolean),
    );
    // THE INVARIANT: a `completed_sufficient` stop implies the guard was
    // satisfied, i.e. at least two independent domains actually had evidence.
    if (result.memory.status === 'completed_sufficient') {
      expect(usableDomains.size).toBeGreaterThanOrEqual(2);
    } else {
      expect(['stopped_max_steps', 'stopped_budget', 'stopped_max_tool_calls']).toContain(result.memory.status);
    }
  }, 30_000);

  it('fails closed on a non-domain tool (the allow-list is the domain catalog)', async () => {
    const result = await runMarketingManager({
      tenant,
      objective: 'x',
      llm: scriptedLlm([
        { tool: 'getSalesTrends', needMoreEvidence: true },
        { tool: 'investigateSalesDomain', needMoreEvidence: false },
      ]),
      loadMemory: emptyMemory,
      budget: { maxSteps: 3, maxToolCalls: 4, durationMs: 20_000 },
    });
    const rejection = result.memory.rejections.find((r) => r.ref === 'getSalesTrends');
    expect(rejection?.stage).toBe('policy');
    // The low-level database tool is never what the manager runs.
    expect(result.memory.toolCalls.map((t) => t.tool)).not.toContain('getSalesTrends');
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic validation gate
// ─────────────────────────────────────────────────────────────────────────────

function candidate(over: Partial<PromotionCandidate> = {}): PromotionCandidate {
  return {
    id: 'c1',
    type: 'CREATE_PROMOTION',
    priority: 'high',
    score: 70,
    confidence: 0.7,
    title: 'Promote Paneer Tikka',
    description: 'd',
    target: { productIds: ['p1'], productNames: ['Paneer Tikka'], categoryIds: [], segmentIds: [] },
    evidence: [],
    financialModel: {
      discountPercent: 10,
      maxDiscountConstraint: 30,
      projectedContributionMargin: 40,
      minMarginConstraint: 15,
      incrementalRevenue: 1000,
      incrementalUnits: 10,
      breakEvenIncrementalUnits: 5,
      paybackPeriodDays: 3,
      economicallySafe: true,
      economicsUnavailable: false,
    },
    cannibalization: { rate: 0.1, incrementalVsCannibalized: 9 },
    risks: [],
    prerequisites: [],
    constraints: {
      minMarginPercent: 15,
      maxDiscountPercent: 30,
      minSellingPrice: 50,
      restrictedCategories: [],
      excludedProductIds: [],
    },
    status: 'pending',
    recommendedAction: 'create_offer',
    sourceSignals: [],
    createdAt: new Date(),
    expiresAt: new Date(),
    ...over,
  } as PromotionCandidate;
}

describe('deterministic validation gate', () => {
  it('rejects a candidate whose own economics are unsafe', async () => {
    const bad = candidate({
      financialModel: { ...candidate().financialModel, economicsUnavailable: true },
    });
    const result = await validateCandidates({
      tenant,
      candidates: [bad],
      investigations: [],
    });
    expect(result.passed).toHaveLength(0);
    expect(result.rejected[0].codes).toContain('ECONOMICS_UNSAFE');
  });

  it('rejects a candidate that targets an item at stockout risk (never promote what cannot be served)', async () => {
    const investigations = [
      investigation({
        domain: 'inventory',
        signals: [
          signal({
            signalId: 'inv-1',
            code: 'inventory_stockout_risk',
            category: 'inventory',
            source: 'inventory_context',
            subject: { type: 'product', id: 'p1' },
          }),
        ],
      }),
    ];
    const result = await validateCandidates({ tenant, candidates: [candidate()], investigations });
    expect(result.rejected[0].codes).toContain('STOCKOUT_RISK_ON_TARGET');
  });

  it('rejects an untargeted win-back but passes a clean candidate', async () => {
    const winBack = candidate({
      id: 'c2',
      type: 'RUN_REACTIVATION',
      target: { productIds: [], productNames: [], categoryIds: [], segmentIds: [] },
    });
    const result = await validateCandidates({ tenant, candidates: [candidate(), winBack], investigations: [] });
    expect(result.passed.map((c) => c.id)).toEqual(['c1']);
    expect(result.rejected[0].codes).toContain('NO_TARGET_SEGMENT');
  });

  it('always reports the safety check (this path cannot act)', async () => {
    const result = await validateCandidates({ tenant, candidates: [candidate()], investigations: [] });
    const safety = result.validations[0].checks.find((c) => c.name === 'safety');
    expect(safety?.status).toBe('pass');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 8 — directions constrain the engine
// ─────────────────────────────────────────────────────────────────────────────

function direction(directionCode: string, over: Partial<import('../contracts').CandidateDirection> = {}) {
  return {
    direction: directionCode,
    domain: 'sales' as const,
    objective: 'objective for ' + directionCode,
    mechanism: 'mechanism',
    target: { productIds: [], productNames: [], categoryIds: [], segmentIds: [] },
    evidenceRefs: ['signal:1'],
    ...over,
  } as import('../contracts').CandidateDirection;
}

describe('direction → engine promotion type (Phase 8)', () => {
  it('maps each representable direction onto EXISTING engine types only', () => {
    const ENGINE_TYPES = new Set([
      'CREATE_COMBO', 'CREATE_ADDON', 'CREATE_PROMOTION', 'RUN_REACTIVATION', 'REVIEW_PRICE',
      'REVIEW_RECIPE_COST', 'PROMOTE_SLOW_ITEM', 'PROTECT_HIGH_DEMAND_STOCK', 'REDUCE_WASTAGE',
    ]);
    for (const [code, types] of Object.entries(DIRECTION_TO_TYPES)) {
      for (const t of types) expect(ENGINE_TYPES.has(t), `${code} → ${t}`).toBe(true);
    }
  });

  it('unions the types of the investigated directions and reports those with no representation', () => {
    const narrowing = promotionTypesForDirections([
      direction('activate_slow_item'),
      direction('win_back'),
      direction('retain_high_value'),
    ]);
    expect(narrowing.types).toEqual(['PROMOTE_SLOW_ITEM', 'CREATE_ADDON', 'RUN_REACTIVATION']);
    // A pure retention play has no engine type: reported, never turned into a discount.
    expect(narrowing.unrepresentable.map((u) => u.direction)).toEqual(['retain_high_value']);
  });

  it('does not count a type-only hit as realising a TARGETED direction', () => {
    const targeted = direction('activate_slow_item', {
      target: { productIds: ['p1'], productNames: [], categoryIds: [], segmentIds: [] },
    });
    const unrelated = { type: 'PROMOTE_SLOW_ITEM', target: { productIds: ['p9'], categoryIds: [], segmentIds: [] } };
    const related = { type: 'PROMOTE_SLOW_ITEM', target: { productIds: ['p1'], categoryIds: [], segmentIds: [] } };
    expect(directionRealised(targeted, [unrelated])).toBe(false);
    expect(directionRealised(targeted, [related])).toBe(true);
  });

  it('reports unrealised directions and a disclosed fallback instead of padding', () => {
    const narrowing = promotionTypesForDirections([direction('win_back')]);
    const report = reportDirectionPolicy(narrowing, [direction('win_back')], [], true, true);
    expect(report.applied).toBe(true);
    expect(report.fallbackUsed).toBe(true);
    expect(report.unrealisedDirections).toEqual(['win_back']);
    expect(report.note).toContain('unrestricted engine was used');
  });

  it('an EMPTY type restriction means nothing is allowed — it never falls back silently', async () => {
    const none = await generatePromotionCandidates({ restaurantId: R1, types: [] });
    expect(none).toEqual([]);
  });

  it('leaves the unrestricted engine unchanged for existing callers', async () => {
    const all = await generatePromotionCandidates({ restaurantId: R1 });
    expect(Array.isArray(all)).toBe(true);
    const restricted = await generatePromotionCandidates({ restaurantId: R1, types: ['RUN_REACTIVATION'] });
    expect(restricted.every((c) => c.type === 'RUN_REACTIVATION')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 10 — real per-product feasibility checks
// ─────────────────────────────────────────────────────────────────────────────

function okStockout(over: Partial<StockoutExposure> = {}): StockoutExposure {
  return { status: 'ok', byProductId: new Map(), byProductName: new Map(), detail: 'assessed', ...over };
}
function okOffers(over: Partial<ActiveOfferCoverage> = {}): ActiveOfferCoverage {
  return { status: 'ok', byProductId: new Map(), byCategoryId: new Map(), detail: 'checked', ...over };
}
function noSources(over: Partial<ValidationSources> = {}): ValidationSources {
  return {
    fetchStockoutExposure: async () => okStockout(),
    fetchActiveOfferCoverage: async () => okOffers(),
    ...over,
  };
}

describe('real per-product feasibility (Phase 10)', () => {
  it('rejects a candidate whose targeted menu item consumes an at-risk ingredient', async () => {
    const sources = noSources({
      fetchStockoutExposure: async () =>
        okStockout({
          byProductName: new Map([
            ['paneer tikka', { ingredientName: 'Paneer', daysUntilDepletion: 3, severity: 'critical' }],
          ]),
        }),
    });
    const result = await validateCandidates({ tenant, candidates: [candidate()], investigations: [], sources });
    expect(result.rejected[0].codes).toContain('STOCKOUT_RISK_ON_TARGET');
    const check = result.validations[0].checks.find((c) => c.name === 'inventory_feasibility');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toContain('Paneer');
    expect(check?.detail).toContain('3 day');
  });

  it('rejects a candidate that stacks on a running offer covering the same product', async () => {
    const sources = noSources({
      fetchActiveOfferCoverage: async () =>
        okOffers({ byProductId: new Map([['p1', { offerId: 'o1', title: 'Weekend Combo' }]]) }),
    });
    const result = await validateCandidates({ tenant, candidates: [candidate()], investigations: [], sources });
    expect(result.rejected[0].codes).toContain('DUPLICATE_ACTIVE_OFFER');
    const check = result.validations[0].checks.find((c) => c.name === 'marketing_conflict');
    expect(check?.detail).toContain('Weekend Combo');
  });

  it('detects category-level overlap too', async () => {
    const sources = noSources({
      fetchActiveOfferCoverage: async () =>
        okOffers({ byCategoryId: new Map([['cat-1', { offerId: 'o2', title: 'Starters Fest' }]]) }),
    });
    const c = candidate({ target: { productIds: [], productNames: [], categoryIds: ['cat-1'], segmentIds: [] } });
    const result = await validateCandidates({ tenant, candidates: [c], investigations: [], sources });
    expect(result.rejected[0].codes).toContain('DUPLICATE_ACTIVE_OFFER');
  });

  it('NEVER fails a candidate on missing data — an unavailable source is reported as skipped', async () => {
    const sources = noSources({
      fetchStockoutExposure: async () => ({ status: 'unavailable', byProductId: new Map(), byProductName: new Map(), detail: 'forecast had no input' }),
      fetchActiveOfferCoverage: async () => ({ status: 'unavailable', byProductId: new Map(), byCategoryId: new Map(), detail: 'offer list unreadable' }),
    });
    const result = await validateCandidates({ tenant, candidates: [candidate()], investigations: [], sources });
    expect(result.passed.map((c) => c.id)).toEqual(['c1']);
    const inv = result.validations[0].checks.find((c) => c.name === 'inventory_feasibility');
    const conflict = result.validations[0].checks.find((c) => c.name === 'marketing_conflict');
    expect(inv?.status).toBe('skipped');
    expect(conflict?.status).toBe('skipped');
    expect(result.sources.stockout.status).toBe('unavailable');
    expect(result.degradations.join(' ')).toContain('inventory feasibility');
  });

  it('the real fetchers degrade (never throw) when the registry cannot serve them', async () => {
    const ctx = { tenant, timeoutMs: 2_000 };
    const stockout = await fetchStockoutExposure(ctx);
    const offers = await fetchActiveOfferCoverage(ctx);
    // Either a real assessable/unavailable answer, but never a throw and never
    // a bogus 'ok'.
    expect(['ok', 'unavailable']).toContain(stockout.status);
    expect(['ok', 'unavailable']).toContain(offers.status);
    if (stockout.status === 'ok') expect(stockout.detail.length).toBeGreaterThan(0);
    if (offers.status === 'ok') expect(offers.detail.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Final critic
// ─────────────────────────────────────────────────────────────────────────────

describe('final critic', () => {
  const emptyMl = {
    evidence: [],
    availableKinds: [],
    missingKinds: [],
    degradations: [],
    strongest: null,
    hasTargetingEvidence: false,
    hasCausalEvidence: false,
  } as MlSignalSummary;

  it('degrades explicitly (deterministic PASS) when no model is available, and says so', async () => {
    const rec = {
      id: 'c1',
      rank: 1,
      title: 't',
      strategy: 'CREATE_PROMOTION',
      engineScore: 70,
      confidence: 0.7,
      economics: {
        discountPercent: 10,
        projectedContributionMargin: 40,
        incrementalRevenue: 1000,
        incrementalUnits: 10,
        breakEvenIncrementalUnits: 5,
        paybackPeriodDays: 3,
        economicallySafe: true,
        available: true,
      },
      why: ['because'],
      risks: [],
    } as unknown as import('../../intelligence/recommendationRanking').RankedRecommendation;
    const result = await runFinalCritic({
      recommendations: [rec],
      situation: buildSituationModel({ objective: 'g', investigations: [] }),
      ml: emptyMl,
      restaurantId: R1,
      disableLlm: true,
    });
    expect(result.source).toBe('deterministic_fallback');
    expect(result.verdicts[0].verdict).toBe('PASS');
    expect(result.verdicts[0].reasons[0]).toContain('No independent critic review was performed');
  });

  it('strips a verdict reason that quotes a number absent from the factsheet', async () => {
    const rec = {
      id: 'c1',
      rank: 1,
      title: 't',
      strategy: 'CREATE_PROMOTION',
      engineScore: 70,
      confidence: 0.7,
      economics: {
        discountPercent: 10,
        projectedContributionMargin: 40,
        incrementalRevenue: 1000,
        incrementalUnits: 10,
        breakEvenIncrementalUnits: 5,
        paybackPeriodDays: 3,
        economicallySafe: true,
        available: true,
      },
      why: [],
      risks: [],
    } as unknown as import('../../intelligence/recommendationRanking').RankedRecommendation;
    const result = await runFinalCritic({
      recommendations: [rec],
      situation: buildSituationModel({ objective: 'g', investigations: [] }),
      ml: emptyMl,
      restaurantId: R1,
      llm: (async () => ({
        value: { verdicts: [{ candidateId: 'c1', verdict: 'PASS', reasons: ['revenue grew 987654% last week'] }] },
      })) as never,
    });
    expect(result.source).toBe('llm');
    expect(result.verdicts[0].strippedClaims).toHaveLength(1);
    expect(result.verdicts[0].reasons.join(' ')).not.toContain('987654');
  });

  it('falls back when the critic returns a schema-violating payload', async () => {
    const rec = { id: 'c1', rank: 1, title: 't', strategy: 'S', engineScore: 1, confidence: 0.5, economics: {}, why: [], risks: [] } as unknown as import('../../intelligence/recommendationRanking').RankedRecommendation;
    const result = await runFinalCritic({
      recommendations: [rec],
      situation: buildSituationModel({ objective: 'g', investigations: [] }),
      ml: emptyMl,
      restaurantId: R1,
      llm: (async () => ({ value: { verdicts: [{ candidateId: 'c1', verdict: 'PASS', reasons: ['x'], thinking: 'hidden' }] } })) as never,
    });
    expect(result.source).toBe('deterministic_fallback');
    expect(result.degradedReason).toContain('strict schema validation');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end orchestrator (no model, empty tenant)
// ─────────────────────────────────────────────────────────────────────────────

describe('runMarketingAnalyze (no model, empty restaurant)', () => {
  it('completes as an explicitly degraded run, discloses declared-only domains and never asserts a healthy business', async () => {
    const result = await runMarketingAnalyze({ tenant, disableLlm: true, requestId: 'test-analyze-1' });

    expect(result.mode).toBe('marketing_analyze');
    expect(result.runId).toBeTruthy();
    expect(result.approvalRequired).toBe(true);
    expect(result.status).toBe('degraded_no_llm');

    // Declared-only capabilities must be visible in the output.
    expect(result.situation.missingEvidence.join(' ')).toContain('feedback');
    expect(result.situation.missingEvidence.join(' ')).toContain('competition');
    expect(result.degradations.join(' ')).toContain('declared only');

    // The deterministic sweep still grounded the situation with real domains.
    expect(result.investigation.domainOrder.length).toBeGreaterThan(0);
    expect(result.situation.investigatedDomains.length).toBeGreaterThan(0);

    // Phase 8 is always disclosed, even when no direction was derived.
    expect(result.directionPolicy).toBeDefined();
    expect(result.directionPolicy.note.length).toBeGreaterThan(0);
    expect(Array.isArray(result.directionPolicy.unrepresentableDirections)).toBe(true);

    // No fabricated recommendation: nothing was invented from an empty database.
    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    if (!result.recommendations.length) {
      expect(result.degradations.join(' ')).toMatch(/no candidates|no recommendation|evidence bar/);
    }
  }, 60_000);
});

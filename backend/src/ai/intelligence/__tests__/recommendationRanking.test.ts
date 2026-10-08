/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * recommendationRanking.test.ts — PHASE 6 acceptance: deterministic ranking
 * with strategic diversity over the EXISTING engine's candidates.
 */

import { describe, it, expect } from 'vitest';
import type { PromotionCandidate } from '../../../services/promotionCandidateService';
import {
  STRATEGY_LABELS,
  isEconomicallySafe,
  rankAndDiversify,
  rankScore,
  rankedRecommendationLines,
  strategyLabel,
} from '../recommendationRanking';

function candidate(over: Partial<PromotionCandidate> & { id: string; type: PromotionCandidate['type'] }): PromotionCandidate {
  const discount = over.financialModel?.discountPercent ?? 10;
  const margin = over.financialModel?.projectedContributionMargin ?? 55;
  return {
    id: over.id,
    type: over.type,
    priority: over.priority ?? 'medium',
    score: over.score ?? 70,
    confidence: over.confidence ?? 0.7,
    title: over.title ?? `Candidate ${over.id}`,
    description: over.description ?? 'desc',
    target: over.target ?? { productIds: [], productNames: [], categoryIds: [], segmentIds: [] },
    evidence: over.evidence ?? [{ description: 'e', value: 1 }],
    financialModel: {
      currentPrice: 200,
      proposedPrice: 180,
      recipeCost: 80,
      discountPercent: discount,
      discountAmount: 20,
      currentContribution: 120,
      projectedContribution: 100,
      projectedContributionMargin: margin,
      incrementalUnits: 20,
      incrementalRevenue: 3600,
      incrementalContribution: over.financialModel?.incrementalContribution ?? 400,
      breakEvenIncrementalUnits: 5,
      paybackPeriodDays: 3,
      minMarginConstraint: 15,
      maxDiscountConstraint: 30,
      ...over.financialModel,
    },
    cannibalization: over.cannibalization ?? { estimatedCannibalizationRate: 0.1, incrementalVsCannibalized: 2, confidence: 0.6, evidence: [] },
    risks: over.risks ?? [],
    prerequisites: over.prerequisites ?? [],
    constraints: over.constraints ?? { minMarginPercent: 15, maxDiscountPercent: 30, minSellingPrice: 50, restrictedCategories: [], excludedProductIds: [] },
    status: over.status ?? 'NEW',
    recommendedAction: over.recommendedAction ?? 'create_offer',
    sourceSignals: over.sourceSignals ?? ['sig:1'],
    createdAt: over.createdAt ?? new Date('2026-10-01T00:00:00.000Z'),
    expiresAt: over.expiresAt ?? new Date('2026-11-01T00:00:00.000Z'),
  };
}

describe('1. economic safety uses the engine’s own constraints', () => {
  it('safe when discount and margin are within constraints and payback is finite', () => {
    expect(isEconomicallySafe(candidate({ id: 'a', type: 'CREATE_COMBO' }))).toBe(true);
  });

  it('unsafe when discount exceeds the max-discount constraint', () => {
    const c = candidate({ id: 'a', type: 'CREATE_PROMOTION', financialModel: { discountPercent: 40 } as never });
    expect(isEconomicallySafe(c)).toBe(false);
  });

  it('unsafe when projected margin is below the floor', () => {
    const c = candidate({ id: 'a', type: 'CREATE_PROMOTION', financialModel: { projectedContributionMargin: 5 } as never });
    expect(isEconomicallySafe(c)).toBe(false);
  });

  it('unsafe when payback is infinite (unrecoverable economics)', () => {
    const c = candidate({ id: 'a', type: 'CREATE_PROMOTION', financialModel: { paybackPeriodDays: Infinity } as never });
    expect(isEconomicallySafe(c)).toBe(false);
  });
});

describe('2. deterministic scoring', () => {
  const ctx = { mlKinds: new Set<string>(), memoryTypes: new Set<string>() };

  it('the engine score dominates the adjustment factors', () => {
    const low = candidate({ id: 'low', type: 'CREATE_COMBO', score: 50, confidence: 1 });
    const high = candidate({ id: 'high', type: 'CREATE_COMBO', score: 95, confidence: 0.4 });
    expect(rankScore(high, ctx)).toBeGreaterThan(rankScore(low, ctx));
  });

  it('is a pure function of its inputs (no clock/randomness)', () => {
    const c = candidate({ id: 'a', type: 'CREATE_COMBO', score: 70 });
    const a = rankScore(c, ctx);
    const b = rankScore(c, ctx);
    expect(a).toBe(b);
  });

  it('aligns candidate types with available ML kinds', () => {
    const combo = candidate({ id: 'combo', type: 'CREATE_COMBO', score: 60 });
    const withBasket = rankScore(combo, { mlKinds: new Set(['basket']), memoryTypes: new Set() });
    const without = rankScore(combo, { mlKinds: new Set(), memoryTypes: new Set() });
    expect(withBasket).toBeGreaterThan(without);
  });

  it('demotes high cannibalization', () => {
    const low = candidate({ id: 'low', type: 'CREATE_PROMOTION', score: 60, cannibalization: { estimatedCannibalizationRate: 0.05, incrementalVsCannibalized: 3, confidence: 0.6, evidence: [] } });
    const high = candidate({ id: 'high', type: 'CREATE_PROMOTION', score: 60, cannibalization: { estimatedCannibalizationRate: 0.9, incrementalVsCannibalized: 0.5, confidence: 0.6, evidence: [] } });
    expect(rankScore(low, ctx)).toBeGreaterThan(rankScore(high, ctx));
  });
});

describe('3. diversity — never 10 variations of the same discount', () => {
  const many = [
    ...Array.from({ length: 6 }, (_, i) => candidate({ id: `combo-${i}`, type: 'CREATE_COMBO', score: 90 - i })),
    ...Array.from({ length: 3 }, (_, i) => candidate({ id: `addon-${i}`, type: 'CREATE_ADDON', score: 80 - i })),
    candidate({ id: 'react', type: 'RUN_REACTIVATION', score: 75 }),
    candidate({ id: 'waste', type: 'REDUCE_WASTAGE', score: 74 }),
  ];

  /** Enough distinct strategies to satisfy the caps within the limit. */
  const rich = [
    ...Array.from({ length: 5 }, (_, i) => candidate({ id: `combo-${i}`, type: 'CREATE_COMBO', score: 90 - i })),
    ...Array.from({ length: 4 }, (_, i) => candidate({ id: `addon-${i}`, type: 'CREATE_ADDON', score: 84 - i })),
    candidate({ id: 'react', type: 'RUN_REACTIVATION', score: 82 }),
    candidate({ id: 'waste', type: 'REDUCE_WASTAGE', score: 81 }),
    candidate({ id: 'slow', type: 'PROMOTE_SLOW_ITEM', score: 80 }),
    candidate({ id: 'stock', type: 'PROTECT_HIGH_DEMAND_STOCK', score: 79 }),
    candidate({ id: 'price', type: 'REVIEW_PRICE', score: 78 }),
    candidate({ id: 'recipe', type: 'REVIEW_RECIPE_COST', score: 77 }),
  ];

  it('caps items per strategy and fills across strategies when enough exist', () => {
    const result = rankAndDiversify({ candidates: rich, limit: 8, maxPerStrategy: 2 });
    expect(result.recommendations).toHaveLength(8);
    const counts = new Map<string, number>();
    for (const r of result.recommendations) counts.set(r.strategy, (counts.get(r.strategy) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    expect(result.strategies.length).toBeGreaterThanOrEqual(4);
    expect(result.diversityRelaxed).toBe(false);
  });

  it('with few strategies, still spreads picks instead of flooding one type', () => {
    const result = rankAndDiversify({ candidates: many, limit: 8, maxPerStrategy: 2 });
    expect(result.recommendations).toHaveLength(8);
    const counts = new Map<string, number>();
    for (const r of result.recommendations) counts.set(r.strategy, (counts.get(r.strategy) ?? 0) + 1);
    // Only 4 strategies exist (two with a single candidate each); relaxation
    // still hands slots round-robin, so no strategy may exceed
    // maxPerStrategy + 1 instead of flooding the shortlist.
    const values = [...counts.values()];
    expect(Math.max(...values)).toBeLessThanOrEqual(3);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(1);
    expect(result.strategies.length).toBeGreaterThanOrEqual(4);
    expect(result.diversityRelaxed).toBe(true);
  });

  it('orders strategies by their strongest candidate', () => {
    const result = rankAndDiversify({ candidates: many, limit: 8, maxPerStrategy: 2 });
    // The first pick is the best combo (score 90), the second the best addon (80).
    expect(result.recommendations[0].type).toBe('CREATE_COMBO');
    expect(result.recommendations[1].type).toBe('CREATE_ADDON');
  });

  it('relaxes caps only when necessary and says so', () => {
    const oneStrategy = Array.from({ length: 5 }, (_, i) => candidate({ id: `only-${i}`, type: 'CREATE_COMBO', score: 90 - i }));
    const result = rankAndDiversify({ candidates: oneStrategy, limit: 5, maxPerStrategy: 2 });
    expect(result.recommendations).toHaveLength(5);
    expect(result.diversityRelaxed).toBe(true);
    expect(result.notes.join(' ')).toContain('relaxed');
    expect(result.notes.join(' ')).toContain('one strategy');
  });

  it('respects the 1..12 limit clamp', () => {
    const result = rankAndDiversify({ candidates: many, limit: 99 });
    expect(result.recommendations.length).toBeLessThanOrEqual(12);
  });
});

describe('4. determinism and stability', () => {
  it('same input → identical ranking (including tie-breakers)', () => {
    const tied = [
      candidate({ id: 'b', type: 'CREATE_COMBO', score: 70 }),
      candidate({ id: 'a', type: 'CREATE_ADDON', score: 70 }),
      candidate({ id: 'c', type: 'CREATE_COMBO', score: 70 }),
    ];
    const r1 = rankAndDiversify({ candidates: tied, limit: 3 });
    const r2 = rankAndDiversify({ candidates: [...tied].reverse(), limit: 3 });
    expect(r1.recommendations.map((r) => r.id)).toEqual(r2.recommendations.map((r) => r.id));
  });

  it('ranks are 1..N in order', () => {
    const result = rankAndDiversify({
      candidates: [candidate({ id: 'a', type: 'CREATE_COMBO', score: 80 }), candidate({ id: 'b', type: 'CREATE_ADDON', score: 60 })],
      limit: 2,
    });
    expect(result.recommendations.map((r) => r.rank)).toEqual([1, 2]);
  });
});

describe('5. provenance and evidence are carried through', () => {
  it('carries engine evidence, economics, risks and signal provenance', () => {
    const result = rankAndDiversify({
      candidates: [candidate({ id: 'a', type: 'CREATE_COMBO', score: 80, risks: ['Stock risk'], sourceSignals: ['sig:42'] })],
      signals: [
        {
          signalId: 's1',
          code: 'basket_pair_strength',
          category: 'basket',
          source: 'market_basket',
          statement: 'pair',
          direction: 'up',
          confidence: 0.7,
          freshness: 'fresh',
          generatedAt: '2026-10-04T00:00:00.000Z',
          scope: { restaurantId: '507f1f77bcf86cd799439011', branchId: null, scope: 'tenant' },
          evidence: [{ kind: 'model', ref: 'm' }],
        },
      ],
      ml: {
        evidence: [],
        availableKinds: ['basket', 'response_model'],
        missingKinds: [],
        degradations: [],
        strongest: 'response_model',
        hasTargetingEvidence: true,
        hasCausalEvidence: false,
      },
      memoryHints: [
        { ref: 'mem:1', statement: 'Combos worked on weekends.', confidence: 0.8, memoryType: 'customer_behavior_pattern' },
      ],
      limit: 1,
    });
    const rec = result.recommendations[0];
    expect(rec.evidence.length).toBeGreaterThan(0);
    expect(rec.risks).toContain('Stock risk');
    expect(rec.provenance.sourceSignals).toContain('sig:42');
    // The fixture signal has NO subject/product link, so it must be disclosed as
    // a dimension-level THEME — never as product-specific evidence (D-19).
    expect(rec.provenance.signalCodes).not.toContain('basket_pair_strength');
    expect(rec.provenance.signalThemes).toContain('basket_pair_strength');
    expect(rec.why.join(' ')).toContain('not specific to these products');
    expect(rec.provenance.mlKinds).toContain('basket');
    expect(rec.provenance.memoryRefs).toContain('mem:1');
    expect(rec.why.join(' ')).toContain('validated past learning');
  });

  it('D-19: a signal ABOUT the candidate product counts as correlated evidence', () => {
    const result = rankAndDiversify({
      candidates: [
        candidate({
          id: 'a',
          type: 'CREATE_COMBO',
          score: 80,
          target: { productIds: ['paneer-1'], productNames: ['Paneer Tikka'], categoryIds: ['starters'], segmentIds: [] },
        }),
      ],
      signals: [
        {
          signalId: 's1',
          code: 'basket_pair_strength',
          category: 'basket',
          source: 'market_basket',
          statement: 'Paneer Tikka pairs with Naan',
          direction: 'up',
          confidence: 0.8,
          freshness: 'fresh',
          generatedAt: '2026-10-04T00:00:00.000Z',
          subject: { type: 'product', id: 'paneer-1', label: 'Paneer Tikka' },
          scope: { restaurantId: '507f1f77bcf86cd799439011', branchId: null, scope: 'tenant' },
          evidence: [{ kind: 'metric', ref: 'metric:product:paneer-1:pairScore', value: 0.7 }],
        },
      ],
      limit: 1,
    });
    const rec = result.recommendations[0];
    expect(rec.provenance.signalCodes).toContain('basket_pair_strength');
    expect(rec.provenance.signalThemes).not.toContain('basket_pair_strength');
    expect(rec.why.join(' ')).toContain('product-correlated');
  });

  it('labels unsafe economics transparently in the why', () => {
    const result = rankAndDiversify({
      candidates: [candidate({ id: 'a', type: 'CREATE_PROMOTION', score: 80, financialModel: { discountPercent: 45 } as never })],
      limit: 1,
    });
    expect(result.recommendations[0].economics.economicallySafe).toBe(false);
    expect(result.recommendations[0].why.join(' ')).toContain('do NOT satisfy');
  });

  it('empty candidates → empty shortlist with a note, never a throw', () => {
    const result = rankAndDiversify({ candidates: [] });
    expect(result.recommendations).toEqual([]);
    expect(result.notes[0]).toContain('No candidates');
  });
});

describe('6. strategy vocabulary is the engine’s own', () => {
  it('maps every engine PromotionType to a friendly label', () => {
    for (const t of ['CREATE_COMBO', 'CREATE_ADDON', 'CREATE_PROMOTION', 'RUN_REACTIVATION', 'PROMOTE_SLOW_ITEM', 'PROTECT_HIGH_DEMAND_STOCK', 'REDUCE_WASTAGE', 'REVIEW_PRICE', 'REVIEW_RECIPE_COST']) {
      expect(STRATEGY_LABELS[t]).toBeTruthy();
      expect(strategyLabel(t)).toBe(STRATEGY_LABELS[t]);
    }
  });

  it('renders compact lines for prompts/UI', () => {
    const result = rankAndDiversify({ candidates: [candidate({ id: 'a', type: 'CREATE_COMBO', score: 88 })], limit: 1 });
    const lines = rankedRecommendationLines(result);
    expect(lines[0]).toContain('#1');
    expect(lines[0]).toContain('product combo');
    expect(lines[0]).toContain('88/100');
  });
});
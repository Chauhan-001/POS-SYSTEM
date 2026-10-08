/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * remediationGuards.test.ts — acceptance tests for the production-remediation
 * P1 fixes:
 *   D-05 per-recommendation ML provenance (never the whole pipeline's set)
 *   D-06 explanation grounding (no dangling symbols/units/time)
 *   D-07 memory relevance filtering (no blanket memory attachment)
 *   D-08 no placeholder "₹0" economics presented as a validated economy
 *   D-11 canonical PromotionType → memory-type mapping (was always false)
 */

import { describe, it, expect } from 'vitest';
import {
  rankAndDiversify,
  rankScore,
  isEconomicallySafe,
  memoryTypesForType,
  type RankedRecommendation,
} from '../recommendationRanking';
import {
  stripUngroundedNumbers,
  isMalformedGroundedText,
  hasUnsupportedCausalLanguage,
  deterministicExplanation,
  buildExplanationFacts,
  type ExplanationFacts,
} from '../recommendationExplanation';
import type { PromotionCandidate, PromotionType } from '../../../services/promotionCandidateService';
import type { MlSignalSummary } from '../mlTypes';

function candidate(type: PromotionType, overrides: Partial<PromotionCandidate> = {}): PromotionCandidate {
  return {
    id: `cand_${type}`,
    type,
    priority: 'medium',
    score: 70,
    confidence: 0.7,
    title: `${type} title`,
    description: 'description',
    target: { productIds: [], productNames: [], categoryIds: [], segmentIds: [] },
    evidence: [],
    financialModel: {
      currentPrice: 100,
      proposedPrice: 90,
      recipeCost: 40,
      discountPercent: 10,
      discountAmount: 10,
      currentContribution: 60,
      projectedContribution: 55,
      projectedContributionMargin: 55,
      incrementalUnits: 5,
      incrementalRevenue: 12000,
      incrementalContribution: 100,
      breakEvenIncrementalUnits: 5,
      paybackPeriodDays: 3,
      minMarginConstraint: 15,
      maxDiscountConstraint: 30,
    },
    cannibalization: { estimatedCannibalizationRate: 0.1, incrementalVsCannibalized: 1.2, confidence: 0.5, evidence: [] },
    risks: [],
    prerequisites: [],
    constraints: { minMarginPercent: 15, maxDiscountPercent: 30, minSellingPrice: 50, restrictedCategories: [], excludedProductIds: [] },
    status: 'NEW',
    recommendedAction: 'create_offer',
    sourceSignals: ['demand_anomaly'],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    expiresAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  };
}

const ALL_ML: MlSignalSummary = {
  evidence: [],
  availableKinds: ['causal_uplift', 'response_model', 'segment', 'forecast', 'basket'],
  missingKinds: [],
  degradations: [],
  strongest: 'causal_uplift',
  hasTargetingEvidence: true,
  hasCausalEvidence: true,
};

describe('D-05 / D-11 — per-recommendation ML provenance + canonical memory mapping', () => {
  it('each recommendation records ONLY the ML that influenced it', () => {
    const res = rankAndDiversify({
      candidates: [candidate('CREATE_PROMOTION'), candidate('CREATE_COMBO'), candidate('RUN_REACTIVATION')],
      ml: ALL_ML,
    });
    const byType = new Map<string, RankedRecommendation>(res.recommendations.map((r) => [r.type, r]));

    expect(byType.get('CREATE_PROMOTION')!.provenance.mlKinds).toEqual(['segment']);
    expect(byType.get('CREATE_COMBO')!.provenance.mlKinds).toEqual(['basket']);
    // Reactivation uses the response model / gated uplift, never basket or segment.
    expect(byType.get('RUN_REACTIVATION')!.provenance.mlKinds.sort()).toEqual(['causal_uplift', 'response_model']);
  });

  it('never leaks causal_uplift into a recommendation that did not use it', () => {
    const res = rankAndDiversify({ candidates: [candidate('CREATE_PROMOTION')], ml: ALL_ML });
    expect(res.recommendations[0].provenance.mlKinds).not.toContain('causal_uplift');
  });

  it('mock: memory alignment uses the canonical mapping (was always false)', () => {
    const promotion = candidate('CREATE_PROMOTION');
    const noMemory = rankScore(promotion, { mlKinds: new Set(), memoryTypes: new Set() });
    const withMemory = rankScore(promotion, {
      mlKinds: new Set(),
      memoryTypes: new Set(['campaign_performance_pattern']),
    });
    expect(withMemory).toBeCloseTo(noMemory + 4, 5);
    // A seasonality pattern is NOT relevant to a targeted promotion.
    const irrelevant = rankScore(promotion, { mlKinds: new Set(), memoryTypes: new Set(['seasonality_pattern']) });
    expect(irrelevant).toBe(noMemory);
  });

  it('exposes the canonical PromotionType → memory-type mapping', () => {
    expect(memoryTypesForType('CREATE_PROMOTION')).toContain('campaign_performance_pattern');
    expect(memoryTypesForType('RUN_REACTIVATION')).toContain('audience_response_pattern');
  });
});

describe('D-07 — memory relevance filtering', () => {
  it('does not attach an irrelevant memory as supporting evidence', () => {
    const res = rankAndDiversify({
      candidates: [candidate('CREATE_PROMOTION')],
      ml: { ...ALL_ML, availableKinds: [], strongest: null, hasTargetingEvidence: false, hasCausalEvidence: false },
      memoryHints: [
        { ref: 'm1', statement: 'seasonality_pattern: festive lift 12.', confidence: 0.75, memoryType: 'seasonality_pattern' },
        { ref: 'm2', statement: 'campaign_performance_pattern for channel:whatsapp.', confidence: 0.7, memoryType: 'campaign_performance_pattern' },
      ],
    });
    const rec = res.recommendations[0];
    expect(rec.provenance.memoryRefs).toEqual(['m2']);
  });
});

describe('D-08 — placeholder economics are never presented as validated', () => {
  const placeholder = candidate('CREATE_PROMOTION', {
    financialModel: {
      currentPrice: 0,
      proposedPrice: 0,
      recipeCost: 0,
      discountPercent: 0,
      discountAmount: 0,
      currentContribution: 0,
      projectedContribution: 0,
      projectedContributionMargin: 0,
      incrementalUnits: 0,
      incrementalRevenue: 0,
      incrementalContribution: 0,
      breakEvenIncrementalUnits: 0,
      paybackPeriodDays: 0,
      minMarginConstraint: 15,
      maxDiscountConstraint: 30,
      economicsUnavailable: true,
    },
  });

  it('is never economically safe', () => {
    expect(isEconomicallySafe(placeholder)).toBe(false);
  });

  it('is surfaced with an explicit unavailable flag and a disclosure note', () => {
    const res = rankAndDiversify({ candidates: [placeholder] });
    expect(res.recommendations[0].economics.available).toBe(false);
    expect(res.notes.join(' ')).toContain('no verified economics');
    expect(res.recommendations[0].why.join(' ')).not.toContain('₹0');
  });
});

describe('Phase F — server-side causal language guard', () => {
  it('detects unsupported causal claims', () => {
    expect(hasUnsupportedCausalLanguage('This offer caused a 20% sales lift')).toBe(true);
    expect(hasUnsupportedCausalLanguage('Traffic was driven by the promotion')).toBe(true);
    expect(hasUnsupportedCausalLanguage('The campaign will increase revenue')).toBe(true);
  });

  it('does not flag neutral associative language', () => {
    expect(hasUnsupportedCausalLanguage('This option is consistent with past weekend combos')).toBe(false);
    expect(hasUnsupportedCausalLanguage('Other options ranked lower')).toBe(false);
  });
});

describe('D-06 — explanation grounding never emits broken copy', () => {
  it('removes a dangling currency symbol left by a stripped amount', () => {
    const { text } = stripUngroundedNumbers('Daily revenue dropped to ₹0 from baseline of ₹', new Set(['0']));
    expect(text).not.toMatch(/₹\s*$/);
    expect(text).not.toMatch(/\bof\s*$/);
  });

  it('removes a whole time expression, never leaving "PM to PM"', () => {
    const { text } = stripUngroundedNumbers('Enjoy 20% off from 12 PM to 3 PM', new Set(['20']));
    expect(text).toContain('20%');
    expect(text).not.toMatch(/PM\s+to\s+PM/);
  });

  it('removes a dangling connector after a stripped percentage', () => {
    const { text } = stripUngroundedNumbers('Seasonality pattern shows a festive lift of 12%', new Set<string>());
    expect(text).not.toMatch(/\bof\s*$/);
    expect(text).not.toContain('12');
  });

  it('never glues surrounding words together when stripping a number', () => {
    const { text } = stripUngroundedNumbers('redemption rate from 2 campaigns to 1002 recipients', new Set<string>());
    expect(text).not.toContain('fromcampaigns');
    expect(text).not.toContain('torecipients');
    expect(text).toContain('from campaigns');
    expect(text).toContain('to recipients');
  });

  it('marks placeholder economics as NaN facts (no fake zeros quotable)', () => {
    const ranking = rankAndDiversify({
      candidates: [
        candidate('CREATE_PROMOTION', {
          financialModel: {
            currentPrice: 0, proposedPrice: 0, recipeCost: 0, discountPercent: 0, discountAmount: 0,
            currentContribution: 0, projectedContribution: 0, projectedContributionMargin: 0,
            incrementalUnits: 0, incrementalRevenue: 0, incrementalContribution: 0,
            breakEvenIncrementalUnits: 0, paybackPeriodDays: 0,
            minMarginConstraint: 15, maxDiscountConstraint: 30, economicsUnavailable: true,
          },
        }),
      ],
    });
    const facts = buildExplanationFacts({ ranking, currency: '₹' });
    const r = facts.recommendations[0];
    expect(r.economicsAvailable).toBe(false);
    expect(Number.isNaN(r.incrementalRevenue)).toBe(true);
    expect(Number.isNaN(r.breakEvenUnits)).toBe(true);
    expect(Number.isNaN(r.discountPct)).toBe(true);
  });

  it('flags broken grounded text for fallback', () => {
    expect(isMalformedGroundedText('Revenue dropped to ₹')).toBe(true);
    expect(isMalformedGroundedText('Open from PM to PM')).toBe(true);
    // Stripped-value residue that survived earlier guards.
    expect(isMalformedGroundedText('Daily revenue dropped to from baseline.')).toBe(true);
    expect(isMalformedGroundedText('SMS campaigns had a rate ( campaigns, recipients).')).toBe(true);
    expect(isMalformedGroundedText('Lunch combo today!')).toBe(false);
    expect(isMalformedGroundedText('See the offer (below) for details.')).toBe(false);
    // Valid English with adjacent connectors is NOT a stripped-value artifact.
    expect(isMalformedGroundedText('Happy hour runs from about 5pm to 7pm.')).toBe(false);
    expect(isMalformedGroundedText('About 21% of recipients redeemed, with around 3,107 reached.')).toBe(false);
    expect(isMalformedGroundedText('The combo starts at about ₹199.')).toBe(false);
  });

  it('deterministic fallback omits profit claims when economics are unavailable', () => {
    const facts: ExplanationFacts = {
      currency: '₹',
      recommendations: [
        {
          rank: 1,
          title: 'Daily revenue demand recovery',
          strategyLabel: 'targeted promotion',
          description: 'Recover demand',
          action: 'create_offer',
          engineScore: 70,
          confidencePct: 70,
          discountPct: 0,
          marginPct: 0,
          incrementalRevenue: 0,
          breakEvenUnits: 0,
          paybackDays: 0,
          economicallySafe: false,
          economicsAvailable: false,
          risks: [],
          prerequisites: [],
          signalCodes: [],
          signalThemes: [],
          mlKinds: [],
          memoryStatements: [],
          evidenceDescriptions: [],
        },
      ],
      unusedSignals: [],
      mlDegradations: [],
      droppedStrategies: [],
    };
    const out = deterministicExplanation(facts, facts.recommendations[0]);
    expect(out.offerDescription).not.toContain('₹0');
    expect(out.offerDescription.toLowerCase()).toContain('not available');
    expect(out.whyItFits.toLowerCase()).toContain('no verified cost');
  });
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for Promotion Candidate Service
 *
 * NOTE: generatePromotionCandidates consumes raw signal-opportunity objects
 * (ComboOpportunity etc. - the OUTPUT of the detect* services) and builds
 * PromotionCandidate instances from them. The mocks below therefore use the
 * ComboOpportunity input contract: primaryProduct/addOnProduct, basketAffinity,
 * comboEconomics, inventoryHealth and overallScore. The built candidate derives
 * its id (promo_<opp.id>), title (opp.id minus the combo_ prefix), score
 * (opp.overallScore) and confidence (opp.confidence) from the opportunity.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generatePromotionCandidates,
  deduplicateCandidates,
  type PromotionCandidate,
  type PromotionCandidateOptions,
} from '../promotionCandidateService';
import { detectComboOpportunities } from '../comboOpportunityService';
import { detectAddOnOpportunities } from '../addOnOpportunityService';
import { detectInventoryOpportunities } from '../inventoryOpportunityService';
import { detectCustomerOpportunities } from '../customerOpportunityService';
import { analyzeMenuEngineering } from '../menuEngineeringService';
import { detectMarginSignals } from '../marginSignalsService';
import { detectAllDemandAnomalies } from '../demandAnomalyService';

vi.mock('../comboOpportunityService', () => ({
  detectComboOpportunities: vi.fn(),
}));

vi.mock('../addOnOpportunityService', () => ({
  detectAddOnOpportunities: vi.fn(),
}));

vi.mock('../inventoryOpportunityService', () => ({
  detectInventoryOpportunities: vi.fn(),
}));

vi.mock('../customerOpportunityService', () => ({
  detectCustomerOpportunities: vi.fn(),
}));

vi.mock('../menuEngineeringService', () => ({
  analyzeMenuEngineering: vi.fn(),
}));

vi.mock('../marginSignalsService', () => ({
  detectMarginSignals: vi.fn(),
}));

vi.mock('../demandAnomalyService', () => ({
  detectAllDemandAnomalies: vi.fn(),
}));

describe('Promotion Candidate Service', () => {
  const mockRestaurantId = '507f1f77bcf86cd799439011';
  const mockBranchId = '507f1f77bcf86cd799439012';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * A valid ComboOpportunity-shaped mock (the input contract consumed by
   * generatePromotionCandidates). Financial numbers are chosen so the built
   * candidate passes validateFinancialModel and is therefore not dropped.
   */
  const makeComboOpp = (overrides: Record<string, unknown> = {}): any => ({
    id: 'combo_burger_fries',
    primaryProduct: {
      id: 'prod_1', name: 'Burger', category: 'mains',
      price: 180, cost: 60, margin: 67, dailyUnits: 40, dailyRevenue: 7200,
    },
    addOnProduct: {
      id: 'prod_2', name: 'Fries', category: 'appetizers',
      price: 60, cost: 20, margin: 67, dailyUnits: 25, dailyRevenue: 1500,
    },
    basketAffinity: { support: 0.18, confidence: 0.42, lift: 2.4, coOccurrenceCount: 320 },
    comboEconomics: {
      normalPrice: 240, suggestedComboPrice: 216, discountPercent: 10,
      estimatedMargin: 63, projectedUnitsPerDay: 15,
      projectedDailyRevenue: 3240, projectedDailyContribution: 2040,
    },
    inventoryHealth: {
      primaryStock: 120, primaryMinStock: 20, primaryMaxStock: 200,
      addOnStock: 80, addOnMinStock: 15, addOnMaxStock: 150, bothHealthy: true,
    },
    existingOffersConflict: { hasConflict: false, conflictingOfferIds: [] },
    demandScore: 80, marginScore: 85, inventoryScore: 90, overallScore: 85,
    confidence: 0.9,
    evidence: [{ description: 'Fries attached to 42% of Burger orders', value: 0.42, baseline: 0.2, confidence: 0.9 }],
    recommendedAction: 'create_combo' as const,
    ...overrides,
  });

  /** Mock every signal detector; only the combo source returns opportunities. */
  const mockDetectors = (comboOpps: unknown[]) => {
    vi.mocked(detectComboOpportunities).mockResolvedValue(comboOpps as any);
    vi.mocked(detectAddOnOpportunities).mockResolvedValue([] as any);
    vi.mocked(detectInventoryOpportunities).mockResolvedValue([] as any);
    vi.mocked(detectCustomerOpportunities).mockResolvedValue([] as any);
    vi.mocked(analyzeMenuEngineering).mockResolvedValue([] as any);
    vi.mocked(detectMarginSignals).mockResolvedValue([] as any);
    vi.mocked(detectAllDemandAnomalies).mockResolvedValue([] as any);
  };

  describe('generatePromotionCandidates', () => {
    const defaultOpts: PromotionCandidateOptions = {
      restaurantId: mockRestaurantId,
      branchId: mockBranchId,
      lookbackDays: 90,
      minScore: 40,
      minConfidence: 0.4,
    };

    it('should return empty array when no opportunities exist', async () => {
      mockDetectors([]);

      const candidates = await generatePromotionCandidates(defaultOpts);

      expect(candidates).toEqual([]);
    });

    it('should generate candidates from combo opportunities', async () => {
      mockDetectors([makeComboOpp()]);

      const candidates = await generatePromotionCandidates(defaultOpts);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('CREATE_COMBO');
      expect(candidates[0].id).toBe('promo_combo_burger_fries');
      expect(candidates[0].title).toBe('burger_fries'); // opp.id minus combo_ prefix
      expect(candidates[0].score).toBe(85); // mirrored from opp.overallScore
      expect(candidates[0].confidence).toBe(0.9);
      expect(candidates[0].target.productIds).toEqual(['prod_1', 'prod_2']);
      expect(candidates[0].target.productNames).toEqual(['Burger', 'Fries']);
    });

    it('should filter by minScore and minConfidence', async () => {
      const highScoreOpp = makeComboOpp({ id: 'combo_1' }); // overallScore 85, confidence 0.9
      const lowScoreOpp = makeComboOpp({ id: 'combo_2', overallScore: 30, confidence: 0.3 });

      mockDetectors([highScoreOpp, lowScoreOpp]);

      // With minScore 40, minConfidence 0.4 - lowScoreOpp should be filtered out
      const candidates = await generatePromotionCandidates({
        ...defaultOpts,
        minScore: 40,
        minConfidence: 0.4,
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].id).toBe('promo_combo_1');
    });

    it('should sort by score descending', async () => {
      mockDetectors([
        makeComboOpp({ id: 'combo_1', overallScore: 60, confidence: 0.6 }),
        makeComboOpp({ id: 'combo_2', overallScore: 90 }),
        makeComboOpp({ id: 'combo_3', overallScore: 45, confidence: 0.5 }),
      ]);

      const candidates = await generatePromotionCandidates(defaultOpts);

      expect(candidates.map((c) => c.score)).toEqual([90, 60, 45]);
    });
  });

  describe('deduplicateCandidates', () => {
    const makeCandidate = (overrides: Partial<PromotionCandidate> = {}): PromotionCandidate => ({
      id: 'promo_1',
      type: 'CREATE_COMBO',
      priority: 'high',
      score: 85,
      confidence: 0.9,
      title: 'Burger + Fries',
      description: 'Combo',
      target: { productIds: ['1', '2'], productNames: ['Burger', 'Fries'], categoryIds: [], segmentIds: [] },
      evidence: [],
      financialModel: {
        currentPrice: 100, proposedPrice: 90, recipeCost: 50, discountPercent: 10, discountAmount: 10,
        currentContribution: 50, projectedContribution: 40, projectedContributionMargin: 44,
        incrementalUnits: 10, incrementalRevenue: 900, incrementalContribution: 400,
        breakEvenIncrementalUnits: 5, paybackPeriodDays: 3, minMarginConstraint: 15, maxDiscountConstraint: 30,
      },
      cannibalization: { estimatedCannibalizationRate: 0, incrementalVsCannibalized: 0, confidence: 0, evidence: [] },
      risks: [],
      prerequisites: [],
      constraints: { minMarginPercent: 15, maxDiscountPercent: 30, minSellingPrice: 50, restrictedCategories: [], excludedProductIds: [] },
      status: 'NEW',
      recommendedAction: 'create_combo',
      sourceSignals: ['test'],
      createdAt: new Date(),
      expiresAt: new Date(),
      ...overrides,
    });

    it('should remove duplicates based on fingerprint', () => {
      const candidate1 = makeCandidate();
      const candidate2 = makeCandidate({ id: 'promo_2', title: 'Burger + Fries (duplicate)' });

      const unique = deduplicateCandidates([candidate1, candidate2]);

      expect(unique).toHaveLength(1);
      expect(unique[0].id).toBe('promo_1');
    });

    it('should keep different candidates', () => {
      const candidate1 = makeCandidate();
      const candidate2 = makeCandidate({
        id: 'promo_2',
        title: 'Burger + Drink',
        target: { productIds: ['1', '3'], productNames: ['Burger', 'Drink'], categoryIds: [], segmentIds: [] },
      });

      const unique = deduplicateCandidates([candidate1, candidate2]);

      expect(unique).toHaveLength(2);
    });
  });
});

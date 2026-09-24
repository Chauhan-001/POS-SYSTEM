/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the (deterministic) Advisory Service.
 *
 * PHASE 3: the LLM was removed from the advisory service. These tests now
 * cover the deterministic behavior that replaced it:
 *   - classifyPriority (from advisorCore)
 *   - enrichRecommendationsWithAI (priority/rank classification — API kept)
 *   - generateCampaignCopy (deterministic template copy)
 *   - generateDailyAdvisorSummary (deterministic pipeline)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enrichRecommendationsWithAI,
  generateDailyAdvisorSummary,
  generateCampaignCopy,
  classifyPriority,
} from '../aiAdvisoryService';
import { generatePromotionCandidates, type PromotionCandidate } from '../promotionCandidateService';

// Mock the promotion candidate service
vi.mock('../promotionCandidateService', () => ({
  generatePromotionCandidates: vi.fn(),
}));

// Mock other services
vi.mock('../menuEngineeringService', () => ({
  analyzeMenuEngineering: vi.fn().mockResolvedValue([]),
}));

vi.mock('../marginSignalsService', () => ({
  detectMarginSignals: vi.fn().mockResolvedValue([]),
}));

vi.mock('../inventoryOpportunityService', () => ({
  detectInventoryOpportunities: vi.fn().mockResolvedValue([]),
}));

vi.mock('../customerOpportunityService', () => ({
  detectCustomerOpportunities: vi.fn().mockResolvedValue([]),
}));

vi.mock('../demandAnomalyService', () => ({
  detectAllDemandAnomalies: vi.fn().mockResolvedValue([]),
}));

vi.mock('../basketAnalysisService', () => ({
  getProductAffinities: vi.fn().mockResolvedValue([]),
}));

vi.mock('../salesBaselineService', () => ({
  computeAllBaselines: vi.fn().mockResolvedValue({
    aov: { value: 250 },
    dailyRevenue: { value: 5000 },
    dailyOrders: { value: 20 },
    weeklyRevenue: { value: 35000 },
    monthlyRevenue: { value: 150000 },
    weekdays: [],
    categories: [],
    products: [],
  }),
}));

describe('Advisory Service (deterministic)', () => {
  const mockRestaurantId = '507f1f77bcf86cd799439011';
  const mockBranchId = '507f1f77bcf86cd799439012';

  const mockCandidate: PromotionCandidate = {
    id: 'promo_123',
    type: 'CREATE_COMBO',
    priority: 'high' as const,
    score: 85,
    confidence: 0.9,
    title: 'Burger + Fries Combo',
    description: 'Burger and fries have 42% attachment rate',
    target: {
      productIds: ['prod_1', 'prod_2'],
      productNames: ['Burger', 'Fries'],
      categoryIds: [],
      segmentIds: [],
    },
    evidence: [
      { description: 'Burger sells 420 units/30 days', value: 420, baseline: 100, sampleSize: 30, confidence: 0.8 },
      { description: 'Fries attach rate 42%', value: 42, baseline: 20, sampleSize: 30, confidence: 0.9 },
    ],
    financialModel: {
      currentPrice: 240,
      proposedPrice: 219,
      recipeCost: 71,
      discountPercent: 8.75,
      discountAmount: 21,
      currentContribution: 169,
      projectedContribution: 148,
      projectedContributionMargin: 67.6,
      incrementalUnits: 15,
      incrementalRevenue: 3285,
      incrementalContribution: 2220,
      breakEvenIncrementalUnits: 5,
      paybackPeriodDays: 3,
      minMarginConstraint: 15,
      maxDiscountConstraint: 30,
    },
    cannibalization: {
      estimatedCannibalizationRate: 0.3,
      incrementalVsCannibalized: 2.5,
      confidence: 0.7,
      evidence: [],
    },
    risks: ['Cannibalization risk moderate'],
    prerequisites: ['Verify inventory', 'Configure in POS'],
    constraints: {
      minMarginPercent: 15,
      maxDiscountPercent: 30,
      minSellingPrice: 50,
      restrictedCategories: [],
      excludedProductIds: [],
    },
    status: 'NEW' as const,
    recommendedAction: 'create_combo',
    sourceSignals: ['basket_affinity', 'real_attachment', 'combo_margin'],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('classifyPriority', () => {
    it('should classify high-impact urgent recommendations as act_now', () => {
      const candidate = {
        ...mockCandidate,
        score: 80,
        confidence: 0.8,
        sourceSignals: ['expiry_risk'],
        type: 'CREATE_COMBO',
      };
      expect(classifyPriority(candidate)).toBe('act_now');
    });

    it('should classify high-impact non-urgent as consider', () => {
      const candidate = {
        ...mockCandidate,
        score: 80,
        confidence: 0.8,
        sourceSignals: ['basket_affinity'],
        type: 'CREATE_COMBO',
      };
      expect(classifyPriority(candidate)).toBe('consider');
    });

    it('should classify RUN_REACTIVATION as act_now', () => {
      const candidate = {
        ...mockCandidate,
        type: 'RUN_REACTIVATION',
        score: 75,
        confidence: 0.7,
        sourceSignals: ['dormant_30d'],
      };
      expect(classifyPriority(candidate)).toBe('act_now');
    });

    it('should classify REVIEW_PRICE as maintain', () => {
      const candidate = {
        ...mockCandidate,
        type: 'REVIEW_PRICE',
        score: 60,
        confidence: 0.6,
        sourceSignals: ['margin_deterioration'],
      };
      expect(classifyPriority(candidate)).toBe('maintain');
    });

    it('should classify low-score as monitor', () => {
      const candidate = {
        ...mockCandidate,
        score: 40,
        confidence: 0.4,
        sourceSignals: [],
        type: 'CREATE_PROMOTION',
      };
      expect(classifyPriority(candidate)).toBe('monitor');
    });
  });

  describe('enrichRecommendationsWithAI (deterministic enrichment, API kept)', () => {
    it('assigns priority and rank without any LLM', async () => {
      const result = await enrichRecommendationsWithAI('rest_1', undefined, [mockCandidate]);

      expect(result).toHaveLength(1);
      expect(result[0].candidate).toEqual(mockCandidate);
      expect(result[0].priority).toBe('consider');
      expect(result[0].rank).toBe(1);
    });

    it('returns an empty array for empty candidates', async () => {
      const result = await enrichRecommendationsWithAI('rest_1', undefined, []);
      expect(result).toHaveLength(0);
    });

    it('is deterministic — same input, same output', async () => {
      const a = await enrichRecommendationsWithAI('rest_1', undefined, [mockCandidate]);
      const b = await enrichRecommendationsWithAI('rest_1', undefined, [mockCandidate]);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });

  describe('generateCampaignCopy (deterministic template copy)', () => {
    it('produces complete multi-channel copy from the candidate facts', async () => {
      const result = await generateCampaignCopy('rest_1', undefined, mockCandidate, 'friendly', 'en');

      expect(result.title).toBe(mockCandidate.title);
      expect(result.description).toBe(mockCandidate.description);
      expect(result.whatsapp).toContain('₹219');
      expect(result.sms).toContain('₹219');
      expect(result.emailSubject).toContain('Burger + Fries Combo');
    });

    it('is deterministic — same candidate, same copy', async () => {
      const a = await generateCampaignCopy('rest_1', undefined, mockCandidate);
      const b = await generateCampaignCopy('rest_1', undefined, mockCandidate);
      expect(a).toEqual(b);
    });
  });

  describe('generateDailyAdvisorSummary (deterministic pipeline)', () => {
    it('generates a full summary with deterministic components', async () => {
      const { generatePromotionCandidates } = await import('../promotionCandidateService');
      (generatePromotionCandidates as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'promo_1',
          type: 'CREATE_COMBO',
          priority: 'high',
          score: 85,
          confidence: 0.9,
          title: 'Burger + Fries Combo',
          description: 'Burger and fries have 42% attachment rate',
          target: { productIds: ['1', '2'], productNames: ['Burger', 'Fries'], categoryIds: [], segmentIds: [] },
          evidence: [{ description: 'Test evidence', value: 1, sampleSize: 1, confidence: 0.8 }],
          financialModel: { incrementalContribution: 100, proposedPrice: 219, discountPercent: 10, currentPrice: 240 },
          risks: [],
          sourceSignals: ['basket_affinity'],
          status: 'NEW',
          recommendedAction: 'create_combo',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        } as unknown as PromotionCandidate,
      ]);

      const summary = await generateDailyAdvisorSummary('rest_1', undefined, 'Test Restaurant');

      expect(summary.restaurantId).toBe('rest_1');
      expect(summary.topOpportunity).toBeDefined();
      expect(summary.opportunities.length).toBeGreaterThan(0);
      expect(summary.insights).toBeInstanceOf(Array);
      expect(summary.alerts).toBeInstanceOf(Array);
    });
  });
});

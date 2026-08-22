/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AI Advisory Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enrichRecommendationsWithAI,
  generateDailyAdvisorSummary,
  generateCampaignCopy,
  runWhatIfSimulation,
  answerAdvisoryQuestion,
  classifyPriority,
  buildAdvisorExplanationPrompt,
  buildCampaignCopyPrompt,
  buildWhatIfPrompt,
  buildNaturalLanguageAdvisorPrompt,
  buildDailyAdvisorPrompt,
} from '../services/aiAdvisoryService';
import { executeAiCall } from '../../modules/ai/services/aiService';
import { generatePromotionCandidates } from '../services/promotionCandidateService';

// Mock the AI service
vi.mock('../../modules/ai/services/aiService', () => ({
  executeAiCall: vi.fn(),
}));

// Mock the promotion candidate service
vi.mock('../services/promotionCandidateService', () => ({
  generatePromotionCandidates: vi.fn(),
}));

// Mock other services
vi.mock('../services/menuEngineeringService', () => ({
  analyzeMenuEngineering: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/marginSignalsService', () => ({
  detectMarginSignals: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/inventoryOpportunityService', () => ({
  detectInventoryOpportunities: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/customerOpportunityService', () => ({
  detectCustomerOpportunities: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/demandAnomalyService', () => ({
  detectAllDemandAnomalies: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/basketAnalysisService', () => ({
  getProductAffinities: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/salesBaselineService', () => ({
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

describe('AI Advisory Service', () => {
  const mockRestaurantId = '507f1f77bcf86cd799439011';
  const mockBranchId = '507f1f77bcf86cd799439012';

  const mockCandidate = {
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

  describe('enrichRecommendationsWithAI', () => {
    it('should return enriched recommendations when AI succeeds', async () => {
      const { executeAiCall } = await import('../../modules/ai/services/aiService');
      (executeAiCall as vi.Mock).mockResolvedValue({
        success: true,
        data: {
          explanations: [
            { index: 0, why: 'Burger is top seller with strong fries attachment', impact: 'Higher AOV', risk: 'Low - both items sell well' },
          ],
        },
        fallback: false,
      });

      const result = await enrichRecommendationsWithAI('rest_1', undefined, [mockCandidate]);

      expect(result).toHaveLength(1);
      expect(result[0].candidate).toEqual(mockCandidate);
      expect(result[0].aiExplanation).toEqual({
        why: 'Burger is top seller with strong fries attachment',
        impact: 'Higher AOV',
        risk: 'Low - both items sell well',
      });
      expect(result[0].priority).toBe('consider');
      expect(result[0].rank).toBe(1);
    });

    it('should fall back to deterministic copy when AI fails', async () => {
      const { executeAiCall } = await import('../../modules/ai/services/aiService');
      (executeAiCall as vi.Mock).mockRejectedValue(new Error('AI unavailable'));

      const result = await enrichRecommendationsWithAI('rest_1', undefined, [mockCandidate]);

      expect(result).toHaveLength(1);
      expect(result[0].candidate).toEqual(mockCandidate);
      expect(result[0].aiExplanation).toBeUndefined();
      expect(result[0].priority).toBe('consider');
    });
  });

  describe('generateCampaignCopy', () => {
    it('should generate copy when AI succeeds', async () => {
      const { executeAiCall } = await import('../../modules/ai/services/aiService');
      (executeAiCall as vi.Mock).mockResolvedValue({
        success: true,
        data: {
          title: 'Burger Buddy Meal',
          description: 'Your favorite burger with crispy fries',
          whatsapp: '🍔 Burger Buddy Meal - Get burger + fries for ₹219! Tap to order!',
          sms: '🍟 Burger + Fries for ₹219 - Save ₹21!',
          push: '🍔 Burger Buddy Meal for ₹219!',
          emailSubject: 'Special: Burger Buddy Meal',
          emailBody: 'Hi! Enjoy our Burger Buddy Meal - burger + fries for just ₹219. Visit us today!',
        },
        fallback: false,
      });

      const result = await generateCampaignCopy('rest_1', undefined, mockCandidate, 'friendly', 'en');

      expect(result.title).toBe('Burger Buddy Meal');
      expect(result.whatsapp).toContain('🍔');
      expect(result.sms).toContain('₹219');
    });

    it('should use deterministic fallback when AI fails', async () => {
      const { executeAiCall } = await import('../../modules/ai/services/aiService');
      (executeAiCall as vi.Mock).mockRejectedValue(new Error('AI unavailable'));

      const result = await generateCampaignCopy('rest_1', undefined, mockCandidate, 'friendly', 'en');

      expect(result.title).toBe(mockCandidate.title);
      expect(result.description).toBe(mockCandidate.description);
      expect(result.whatsapp).toContain('₹219');
    });
  });

  describe('runWhatIfSimulation', () => {
    it('should simulate discount scenario', async () => {
      const { generatePromotionCandidates } = await import('../services/promotionCandidateService');
      (generatePromotionCandidates as vi.Mock).mockResolvedValue([mockCandidate]);

      const result = await runWhatIfSimulation({
        restaurantId: mockRestaurantId,
        branchId: mockBranchId,
        type: 'discount',
        currentPrice: 240,
        discountPercent: 10,
      });

      expect(result.current.price).toBe(240);
      expect(result.proposed.price).toBe(216);
      expect(result.viable).toBe(true);
      expect(result.breakEvenPercent).toBeGreaterThan(0);
      expect(result.explanation).toBeDefined();
    });

    it('should simulate combo price scenario', async () => {
      const { generatePromotionCandidates } = await import('../services/promotionCandidateService');
      (generatePromotionCandidates as vi.Mock).mockResolvedValue([mockCandidate]);

      const result = await runWhatIfSimulation({
        restaurantId: mockRestaurantId,
        branchId: mockBranchId,
        type: 'combo_price',
        proposedPrice: 200,
      });

      expect(result.proposed.price).toBe(200);
      expect(result.viable).toBeDefined();
    });
  });

  describe('answerAdvisoryQuestion', () => {
    it('should answer questions using recommendation context', async () => {
      const { executeAiCall } = await import('../../modules/ai/services/aiService');
      (executeAiCall as vi.Mock).mockResolvedValue({
        success: true,
        data: {
          answer: 'Create the Burger + Fries combo - it has 42% attachment rate and high margin.',
          relevantRecommendationIndices: [0],
          suggestedActions: ['Create Combo'],
          dataSources: ['basket_affinity', 'margin_analysis'],
        },
      });

      const result = await answerAdvisoryQuestion({
        message: 'What should I promote today?',
        restaurantId: mockRestaurantId,
        branchId: mockBranchId,
      });

      expect(result.answer).toContain('Burger');
      expect(result.relevantRecommendations).toHaveLength(1);
      expect(result.suggestedActions).toContain('Create Combo');
    });

    it('should handle AI failure gracefully', async () => {
      const { executeAiCall } = await import('../../modules/ai/services/aiService');
      (executeAiCall as vi.Mock).mockRejectedValue(new Error('AI unavailable'));

      const result = await answerAdvisoryQuestion({
        message: 'What should I do?',
        restaurantId: mockRestaurantId,
      });

      expect(result.answer).toContain('trouble connecting');
      expect(result.relevantRecommendations).toHaveLength(3);
    });
  });

  describe('buildAdvisorExplanationPrompt', () => {
    it('should build valid prompt with all candidate facts', () => {
      const facts = [{
        index: 0,
        title: 'Test Combo',
        type: 'CREATE_COMBO',
        why: 'High attachment rate',
        evidence: ['42% attachment', 'High margin'],
        economics: { proposedPrice: 219, discountPercent: 10 },
        expectedImpact: 'Higher AOV',
        risk: 'Low risk',
        score: 85,
        confidence: 0.9,
      }];

      const prompt = buildAdvisorExplanationPrompt('increase_sales', facts);

      expect(prompt).toContain('Goal: increase_sales');
      expect(prompt).toContain('Test Combo');
      expect(prompt).toContain('42% attachment');
      expect(prompt).toContain('owner-friendly');
      expect(prompt).toContain('{"explanations"');
    });
  });

  describe('buildCampaignCopyPrompt', () => {
    it('should build prompt with all offer details', () => {
      const candidate = {
        title: 'Burger Combo',
        description: 'Burger + Fries',
        type: 'CREATE_COMBO',
        target: { productNames: ['Burger', 'Fries'] },
        financialModel: { proposedPrice: 219, discountPercent: 8 },
        evidence: ['42% attachment'],
        expectedImpact: 'Higher AOV',
      };

      const prompt = buildCampaignCopyPrompt(candidate, 'friendly', 'en');

      expect(prompt).toContain('Burger Combo');
      expect(prompt).toContain('219');
      expect(prompt).toContain('8');
      expect(prompt).toContain('Tone: friendly');
      expect(prompt).toContain('Language: English');
      expect(prompt).toContain('"whatsapp"');
    });
  });

  describe('buildWhatIfPrompt', () => {
    it('should build prompt with simulation data', () => {
      const simulation = {
        type: 'discount',
        current: { price: 240, contribution: 72, marginPercent: 30, aov: 250 },
        proposed: { price: 216, contribution: 48, marginPercent: 22, aov: 250 },
        incrementalUnitsRequired: 15,
        incrementalRevenueRequired: 3240,
        breakEvenPercent: 150,
        confidence: 0.7,
        viable: true,
      };

      const prompt = buildWhatIfPrompt(simulation);

      expect(prompt).toContain('Simulation: discount');
      expect(prompt).toContain('240');
      expect(prompt).toContain('216');
      expect(prompt).toContain('150%');
      expect(prompt).toContain('"explanation"');
    });
  });

  describe('buildNaturalLanguageAdvisorPrompt', () => {
    it('should build prompt with context', () => {
      const prompt = buildNaturalLanguageAdvisorPrompt(
        'What should I promote?',
        {
          restaurantName: 'Test Restaurant',
          topRecommendations: [
            { title: 'Burger Combo', why: 'High attachment', type: 'CREATE_COMBO', score: 85, expectedImpact: 'Higher AOV' },
          ],
          activePromotions: ['Weekend Special'],
          insights: ['2 STAR items', 'No margin risks'],
        }
      );

      expect(prompt).toContain('Test Restaurant');
      expect(prompt).toContain('Burger Combo');
      expect(prompt).toContain('Weekend Special');
      expect(prompt).toContain('STAR items');
      expect(prompt).toContain('What should I promote?');
      expect(prompt).toContain('"answer"');
    });
  });

  describe('buildDailyAdvisorPrompt', () => {
    it('should build daily briefing prompt', () => {
      const prompt = buildDailyAdvisorPrompt(
        'Test Restaurant',
        [{
          title: 'Burger Combo',
          type: 'CREATE_COMBO',
          why: 'High attachment',
          evidence: ['42% attachment'],
          score: 85,
          confidence: 0.9,
          expectedImpact: 'Higher AOV',
        }],
        ['2 STAR items'],
        [{ type: 'margin', message: 'Low margin on Paneer' }]
      );

      expect(prompt).toContain('Test Restaurant');
      expect(prompt).toContain('Burger Combo');
      expect(prompt).toContain('STAR items');
      expect(prompt).toContain('Low margin on Paneer');
      expect(prompt).toContain('"briefing"');
      expect(prompt).toContain('"topOpportunities"');
    });
  });
});

describe('Daily Advisor Integration', () => {
  it('should generate daily summary with all components', async () => {
    const { generateDailyAdvisorSummary } = await import('../services/aiAdvisoryService');
    const { generatePromotionCandidates } = await import('../services/promotionCandidateService');
    const { executeAiCall } = await import('../../modules/ai/services/aiService');

    (generatePromotionCandidates as vi.Mock).mockResolvedValue([
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
        type: 'CREATE_COMBO',
        status: 'NEW',
        recommendedAction: 'create_combo',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      } as any,
    ]);

    (executeAiCall as vi.Mock).mockResolvedValue({
      success: true,
      data: { explanations: [{ index: 0, why: 'Test', impact: 'Test', risk: 'Test' }] },
      fallback: false,
    });

    const summary = await (await import('../services/aiAdvisoryService')).generateDailyAdvisorSummary(
      'rest_1',
      undefined,
      'Test Restaurant'
    );

    expect(summary.restaurantId).toBe('rest_1');
    expect(summary.topOpportunity).toBeDefined();
    expect(summary.opportunities.length).toBeGreaterThan(0);
    expect(summary.insights).toBeInstanceOf(Array);
    expect(summary.alerts).toBeInstanceOf(Array);
  });
});
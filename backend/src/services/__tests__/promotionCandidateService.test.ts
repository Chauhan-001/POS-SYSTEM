/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for Promotion Candidate Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePromotionCandidates, deduplicateCandidates, buildCandidateFromCombo } from '../services/promotionCandidateService';
import { detectComboOpportunities } from '../services/comboOpportunityService';
import { detectAddOnOpportunities } from '../services/addOnOpportunityService';
import { detectInventoryOpportunities } from '../services/inventoryOpportunityService';
import { detectCustomerOpportunities } from '../services/customerOpportunityService';
import { analyzeMenuEngineering } from '../services/menuEngineeringService';
import { detectMarginSignals } from '../services/marginSignalsService';
import { detectAllDemandAnomalies } from '../services/demandAnomalyService';
import { PromotionCandidate, PromotionCandidateOptions } from '../services/promotionCandidateService';

// Mock all dependent services
vi.mock('../services/comboOpportunityService', () => ({
  detectComboOpportunities: vi.fn(),
}));

vi.mock('../services/addOnOpportunityService', () => ({
  detectAddOnOpportunities: vi.fn(),
}));

vi.mock('../services/inventoryOpportunityService', () => ({
  detectInventoryOpportunities: vi.fn(),
}));

vi.mock('../services/customerOpportunityService', () => ({
  detectCustomerOpportunities: vi.fn(),
}));

vi.mock('../services/menuEngineeringService', () => ({
  analyzeMenuEngineering: vi.fn(),
}));

vi.mock('../services/marginSignalsService', () => ({
  detectMarginSignals: vi.fn(),
}));

vi.mock('../services/demandAnomalyService', () => ({
  detectAllDemandAnomalies: vi.fn(),
}));

describe('Promotion Candidate Service', () => {
  const mockRestaurantId = '507f1f77bcf86cd799439011';
  const mockBranchId = '507f1f77bcf86cd799439012';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generatePromotionCandidates', () => {
    const defaultOpts: PromotionCandidateOptions = {
      restaurantId: mockRestaurantId,
      branchId: mockBranchId,
      lookbackDays: 90,
      minScore: 40,
      minConfidence: 0.4,
    };

    it('should return empty array when no opportunities exist', async () => {
      const { detectComboOpportunities } = await import('../services/comboOpportunityService');
      const { detectAddOnOpportunities } = await import('../services/addOnOpportunityService');
      const { detectInventoryOpportunities } = await import('../services/inventoryOpportunityService');
      const { detectCustomerOpportunities } = await import('../services/customerOpportunityService');
      const { analyzeMenuEngineering } = await import('../services/menuEngineeringService');
      const { detectMarginSignals } = await import('../services/marginSignalsService');
      const { detectAllDemandAnomalies } = await import('../services/demandAnomalyService');

      (detectComboOpportunities as vi.Mock).mockResolvedValue([]);
      (detectAddOnOpportunities as vi.Mock).mockResolvedValue([]);
      (detectInventoryOpportunities as vi.Mock).mockResolvedValue([]);
      (detectCustomerOpportunities as vi.Mock).mockResolvedValue([]);
      (analyzeMenuEngineering as vi.Mock).mockResolvedValue([]);
      (detectMarginSignals as vi.Mock).mockResolvedValue([]);
      (detectAllDemandAnomalies as vi.Mock).mockResolvedValue([]);

      const candidates = await generatePromotionCandidates(defaultOpts);

      expect(candidates).toEqual([]);
    });

    it('should generate candidates from combo opportunities', async () => {
      const { detectComboOpportunities } = await import('../services/comboOpportunityService');
      const { detectAddOnOpportunities } = await import('../services/addOnOpportunityService');
      const { detectInventoryOpportunities } = await import('../services/inventoryOpportunityService');
      const { detectCustomerOpportunities } = await import('../services/customerOpportunityService');
      const { analyzeMenuEngineering } = await import('../services/menuEngineeringService');
      const { detectMarginSignals } = await import('../services/marginSignalsService');
      const { detectAllDemandAnomalies } = await import('../services/demandAnomalyService');

      const mockComboOpp = {
        id: 'combo_burger_fries',
        type: 'CREATE_COMBO',
        priority: 'high' as const,
        score: 85,
        confidence: 0.9,
        title: 'Burger + Fries Combo',
        description: 'Bundle Burger + Fries for ₹219 (save ₹21)',
        target: { productIds: ['prod_1', 'prod_2'], productNames: ['Burger', 'Fries'], categoryIds: [], segmentIds: [] },
        evidence: ['Burger: 420 units sold', 'Fries attached to 42% of Burger orders'],
        financialModel: {
          currentPrice: 240,
          proposedPrice: 219,
          recipeCost: 71,
          discountPercent: 8.75,
          discountAmount: 21,
          currentContribution: 169,
          projectedContribution: 148,
          projectedContributionMargin: 67,
          incrementalUnits: 15,
          incrementalRevenue: 3285,
          incrementalContribution: 2220,
          breakEvenIncrementalUnits: 5,
          paybackPeriodDays: 3,
          minMarginConstraint: 15,
          maxDiscountConstraint: 30,
        },
        cannibalization: { estimatedCannibalizationRate: 0.3, incrementalVsCannibalized: 2.5, confidence: 0.7, evidence: [] },
        risks: ['Cannibalization risk'],
        prerequisites: ['Verify inventory'],
        constraints: { minMarginPercent: 15, maxDiscountPercent: 30, minSellingPrice: 50, restrictedCategories: [], excludedProductIds: [] },
        status: 'NEW' as const,
        recommendedAction: 'create_combo',
        sourceSignals: ['basket_affinity', 'margin_analysis', 'inventory_health'],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      (detectComboOpportunities as vi.Mock).mockResolvedValue([mockComboOpp]);
      (detectAddOnOpportunities as vi.Mock).mockResolvedValue([]);
      (detectInventoryOpportunities as vi.Mock).mockResolvedValue([]);
      (detectCustomerOpportunities as vi.Mock).mockResolvedValue([]);
      (analyzeMenuEngineering as vi.Mock).mockResolvedValue([]);
      (detectMarginSignals as vi.Mock).mockResolvedValue([]);
      (detectAllDemandAnomalies as vi.Mock).mockResolvedValue([]);

      const candidates = await generatePromotionCandidates(defaultOpts);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('CREATE_COMBO');
      expect(candidates[0].title).toBe('Burger + Fries Combo');
      expect(candidates[0].score).toBe(85);
    });

    it('should filter by minScore and minConfidence', async () => {
      const highScoreOpp = {
        id: 'combo_1',
        type: 'CREATE_COMBO',
        priority: 'high' as const,
        score: 85,
        confidence: 0.9,
        title: 'High Score Combo',
        description: 'High score combo',
        target: { productIds: ['1'], productNames: ['Item'], categoryIds: [], segmentIds: [] },
        evidence: ['Test'],
        financialModel: { currentPrice: 100, proposedPrice: 90, recipeCost: 50, discountPercent: 10, discountAmount: 10, currentContribution: 50, projectedContribution: 40, projectedContributionMargin: 44, incrementalUnits: 10, incrementalRevenue: 900, incrementalContribution: 400, breakEvenIncrementalUnits: 5, paybackPeriodDays: 3, minMarginConstraint: 15, maxDiscountConstraint: 30 },
        cannibalization: { estimatedCannibalizationRate: 0, incrementalVsCannibalized: 0, confidence: 0, evidence: [] },
        risks: [], prerequisites: [], constraints: { minMarginPercent: 15, maxDiscountPercent: 30, minSellingPrice: 50, restrictedCategories: [], excludedProductIds: [] },
        status: 'NEW' as const,
        recommendedAction: 'create_combo',
        sourceSignals: ['test'],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      const lowScoreOpp = {
        ...highScoreOpp,
        id: 'combo_2',
        title: 'Low Score Combo',
        score: 30,
        confidence: 0.3,
      };

      const { detectComboOpportunities } = await import('../services/comboOpportunityService');
      const { detectAddOnOpportunities } = await import('../services/addOnOpportunityService');
      const { detectInventoryOpportunities } = await import('../services/inventoryOpportunityService');
      const { detectCustomerOpportunities } = await import('../services/customerOpportunityService');
      const { analyzeMenuEngineering } = await import('../services/menuEngineeringService');
      const { detectMarginSignals } = await import('../services/marginSignalsService');
      const { detectAllDemandAnomalies } = await import('../services/demandAnomalyService');

      (detectComboOpportunities as vi.Mock).mockResolvedValue([highScoreOpp, lowScoreOpp]);
      (detectAddOnOpportunities as vi.Mock).mockResolvedValue([]);
      (detectInventoryOpportunities as vi.Mock).mockResolvedValue([]);
      (detectCustomerOpportunities as vi.Mock).mockResolvedValue([]);
      (analyzeMenuEngineering as vi.Mock).mockResolvedValue([]);
      (detectMarginSignals as vi.Mock).mockResolvedValue([]);
      (detectAllDemandAnomalies as vi.Mock).mockResolvedValue([]);

      // With minScore 40, minConfidence 0.4 - lowScoreOpp should be filtered out
      const candidates = await generatePromotionCandidates({
        ...defaultOpts,
        minScore: 40,
        minConfidence: 0.4,
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].id).toBe(highScoreOpp.id);
    });

    it('should sort by score descending', async () => {
      const opp1 = {
        id: 'combo_1',
        type: 'CREATE_COMBO',
        priority: 'medium' as const,
        score: 60,
        confidence: 0.6,
        title: 'Medium Score',
        description: 'Desc',
        target: { productIds: ['1'], productNames: ['Item'], categoryIds: [], segmentIds: [] },
        evidence: ['Test'],
        financialModel: { currentPrice: 100, proposedPrice: 90, recipeCost: 50, discountPercent: 10, discountAmount: 10, currentContribution: 50, projectedContribution: 40, projectedContributionMargin: 44, incrementalUnits: 10, incrementalRevenue: 900, incrementalContribution: 400, breakEvenIncrementalUnits: 5, paybackPeriodDays: 3, minMarginConstraint: 15, maxDiscountConstraint: 30 },
        cannibalization: { estimatedCannibalizationRate: 0, incrementalVsCannibalized: 0, confidence: 0, evidence: [] },
        risks: [], prerequisites: [], constraints: { minMarginPercent: 15, maxDiscountPercent: 30, minSellingPrice: 50, restrictedCategories: [], excludedProductIds: [] },
        status: 'NEW' as const,
        recommendedAction: 'create_combo',
        sourceSignals: ['test'],
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      const opp2 = { ...opp1, id: 'combo_2', title: 'High Score', score: 90, confidence: 0.9 };
      const opp3 = { ...opp1, id: 'combo_3', title: 'Low Score', score: 45, confidence: 0.5 };

      const { detectComboOpportunities } = await import('../services/comboOpportunityService');
      const { detectAddOnOpportunities } = await import('../services/addOnOpportunityService');
      const { detectInventoryOpportunities } = await import('../services/inventoryOpportunityService');
      const { detectCustomerOpportunities } = await import('../services/customerOpportunityService');
      const { analyzeMenuEngineering } = await import('../services/menuEngineeringService');
      const { detectMarginSignals } = await import('../services/marginSignalsService');
      const { detectAllDemandAnomalies } = await import('../services/demandAnomalyService');

      (detectComboOpportunities as vi.Mock).mockResolvedValue([opp1, opp2, opp3]);
      (detectAddOnOpportunities as vi.Mock).mockResolvedValue([]);
      (detectInventoryOpportunities as vi.Mock).mockResolvedValue([]);
      (detectCustomerOpportunities as vi.Mock).mockResolvedValue([]);
      (analyzeMenuEngineering as vi.Mock).mockResolvedValue([]);
      (detectMarginSignals as vi.Mock).mockResolvedValue([]);
      (detectAllDemandAnomalies as vi.Mock).mockResolvedValue([]);

      const candidates = await generatePromotionCandidates(defaultOpts);

      expect(candidates[0].score).toBe(90);
      expect(candidates[1].score).toBe(60);
      expect(candidates[2].score).toBe(45);
    });
  });

  describe('deduplicateCandidates', () => {
    it('should remove duplicates based on fingerprint', async () => {
      const { deduplicateCandidates } = await import('../services/promotionCandidateService');

      const candidate1 = {
        id: 'promo_1',
        type: 'CREATE_COMBO',
        priority: 'high' as const,
        score: 85,
        confidence: 0.9,
        title: 'Burger + Fries',
        description: 'Combo',
        target: { productIds: ['1', '2'], productNames: ['Burger', 'Fries'], categoryIds: [], segmentIds: [] },
        evidence: [],
        financialModel: { currentPrice: 100, proposedPrice: 90, recipeCost: 50, discountPercent: 10, discountAmount: 10, currentContribution: 50, projectedContribution: 40, projectedContributionMargin: 44, incrementalUnits: 10, incrementalRevenue: 900, incrementalContribution: 400, breakEvenIncrementalUnits: 5, paybackPeriodDays: 3, minMarginConstraint: 15, maxDiscountConstraint: 30 },
        cannibalization: { estimatedCannibalizationRate: 0, incrementalVsCannibalized: 0, confidence: 0, evidence: [] },
        risks: [], prerequisites: [], constraints: { minMarginPercent: 15, maxDiscountPercent: 30, minSellingPrice: 50, restrictedCategories: [], excludedProductIds: [] },
        status: 'NEW' as const,
        recommendedAction: 'create_combo',
        sourceSignals: ['test'],
        createdAt: new Date(),
        expiresAt: new Date(),
      };

      const candidate2 = {
        ...candidate1,
        id: 'promo_2',
        title: 'Burger + Fries (duplicate)',
      };

      const unique = deduplicateCandidates([candidate1, candidate2]);

      expect(unique).toHaveLength(1);
      expect(unique[0].id).toBe('promo_1');
    });

    it('should keep different candidates', async () => {
      const { deduplicateCandidates } = await import('../services/promotionCandidateService');

      const candidate1 = {
        id: 'promo_1',
        type: 'CREATE_COMBO',
        priority: 'high' as const,
        score: 85,
        confidence: 0.9,
        title: 'Burger + Fries',
        description: 'Combo',
        target: { productIds: ['1', '2'], productNames: ['Burger', 'Fries'], categoryIds: [], segmentIds: [] },
        evidence: [],
        financialModel: { currentPrice: 100, proposedPrice: 90, recipeCost: 50, discountPercent: 10, discountAmount: 10, currentContribution: 50, projectedContribution: 40, projectedContributionMargin: 44, incrementalUnits: 10, incrementalRevenue: 900, incrementalContribution: 400, breakEvenIncrementalUnits: 5, paybackPeriodDays: 3, minMarginConstraint: 15, maxDiscountConstraint: 30 },
        cannibalization: { estimatedCannibalizationRate: 0, incrementalVsCannibalized: 0, confidence: 0, evidence: [] },
        risks: [], prerequisites: [], constraints: { minMarginPercent: 15, maxDiscountPercent: 30, minSellingPrice: 50, restrictedCategories: [], excludedProductIds: [] },
        status: 'NEW' as const,
        recommendedAction: 'create_combo',
        sourceSignals: ['test'],
        createdAt: new Date(),
        expiresAt: new Date(),
      };

      const candidate2 = {
        ...candidate1,
        id: 'promo_2',
        title: 'Burger + Drink',
        target: { productIds: ['1', '3'], productNames: ['Burger', 'Drink'], categoryIds: [], segmentIds: [] },
      };

      const unique = deduplicateCandidates([candidate1, candidate2]);

      expect(unique).toHaveLength(2);
    });
  });
});
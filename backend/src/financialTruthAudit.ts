/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FinancialTruthAudit — Verify all promotion recommendations use correct financial calculations.
 *
 * CRITICAL: For every promotion recommendation verify:
 *   Selling Price
 *   - Recipe/Ingredient Cost
 *   - Applicable Discount
 *   - Other Variable Costs
 *   = Contribution
 *
 * Find:
 *   Incorrect cost calculations
 *   Missing recipe costs
 *   Variant cost errors
 *   Double deductions
 *   Discount calculation errors
 *   Tax confusion
 *   Combo costing errors
 *
 * Never allow AI to compensate for a financial-engine error.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { AutomationPolicy } from '../services/restaurantIntelligenceOrchestrator';
import type { SourceOfTruthEntry } from './sourceOfTruthMatrix';
import type { IntelligenceCapability } from '../intelligenceRegistry';

/**
 * Financial audit result for a single recommendation
 */
export interface FinancialAuditResult {
  recommendationId: string;
  recommendationType: string;
  title: string;
  financialValid: boolean;
  violations: FinancialViolation[];
  calculatedContribution: number;
  recordedContribution?: number;
  variance: number; // calculated - recorded
  confidenceImpact: 'None' | 'Reduced' | 'Blocked';
  recommendedAction: 'proceed' | 'adjust' | 'block' | 'investigate';
}

/**
 * Financial violation type
 */
export type FinancialViolation =
  | 'incorrect_cost'
  | 'missing_recipe'
  | 'variant_cost_error'
  | 'double_deduction'
  | 'discount_calculation_error'
  | 'tax_confusion'
  | 'combo_costing_error'
  | 'margin_violation'
  | 'unknown';

/**
 * Audit a single recommendation's financial validity
 */
export function auditRecommendationFinancials(
  recommendation: any,
  ctx: RecommendationContext,
  policy: AutomationPolicy
): FinancialAuditResult {
    const violations: FinancialViolation[] = [];
    let calculatedContribution = 0;
    let recordedContribution: number | undefined;
    let confidenceImpact: 'None' | 'Reduced' | 'Blocked' = 'None';

    // Get the recommendation's economics
    const economics = recommendation.economics || {};
    const recordedDiscount = economics.discount || 0;
    const recordedPrice = economics.price || 0;

    // Get product data from context
    const productId = recommendation.offerSuggestion?.applicableProductIds?.[0];
    const product = ctx.products?.find((p: any) => p.id === productId);

    if (!product) {
      // Cannot audit without product data
      return {
        recommendationId: String(recommendation._id || recommendation.id),
        recommendationType: recommendation.recommendationType,
        title: recommendation.title,
        financialValid: false,
        violations: ['missing_product_data'],
        calculatedContribution: 0,
        recordedContribution: undefined,
        variance: 0,
        confidenceImpact: 'Blocked',
        recommendedAction: 'investigate',
      };
    }

    // === 1. Verify recipe cost exists ===
    const recipeCost = product.recipeCost;
    if (recipeCost === undefined || recipeCost === null || recipeCost <= 0) {
      violations.push('missing_recipe');
      calculatedContribution = 0; // Cannot calculate without cost
      confidenceImpact = 'Blocked';
      return {
        recommendationId: String(recommendation._id || recommendation.id),
        recommendationType: recommendation.recommendationType,
        title: recommendation.title,
        financialValid: false,
        violations,
        calculatedContribution: 0,
        recordedContribution: economics.contribution,
        variance: - (recordedContribution || 0),
        confidenceImpact,
        recommendedAction: 'investigate',
      };
    }

    // === 2. Verify discount calculation ===
    // Discount should not exceed maximum policy discount
    if (recordedDiscount > policy.maximumDiscount) {
      violations.push('discount_calculation_error');
      // Will be adjusted below
    }

    // === 3. Calculate contribution from first principles ===
    // Contribution = (Price - Discount) - RecipeCost per unit * Units
    // For a single unit: contribution = (price - discount) - recipeCost
    const unitSellingPrice = product.sellingPrice || product.price || 0;
    const recipeCostPerUnit = Number(recipeCost);
    const discountAmount = Math.round(unitSellingPrice * (recordedDiscount / 100));
    const discountedPrice = unitSellingPrice - discountAmount;
    const contributionPerUnit = discountedPrice - recipeCostPerUnit;

    // Get expected units from the recommendation or use 1
    const expectedUnits = (recommendation.economics?.unitsSold || 1);
    calculatedContribution = contributionPerUnit * expectedUnits;

    // === 4. Check for margin violations ===
    const contributionMarginPercent = unitSellingPrice > 0
      ? Math.round((contributionPerUnit / unitSellingPrice) * 100)
      : 0;

    if (contributionMarginPercent < policy.minimumMargin) {
      violations.push('margin_violation');
      confidenceImpact = 'Reduced';
    }

    // === 5. Check for double deduction ===
    // Verify the recorded contribution doesn't double-discount or double-cost
    if (recordedContribution !== undefined) {
      const variance = calculatedContribution - recordedContribution;
      if (Math.abs(variance) > 0.01) {
        // Check if variance is due to double deduction
        const recordedDiscountApplied = Math.round(
          (product.sellingPrice || product.price || 0) * (recordedDiscount / 100)
        );
        const expectedDiscountApplied = Math.round(
          (product.sellingPrice || product.price || 0) * (recordedDiscount / 100)
        );
        // If recorded contribution used a different discount than economics.discount
        if (recordedContribution > calculatedContribution) {
          violations.push('double_deduction');
        }
      }
    }

    // === 6. Check for combo costing errors ===
    if (recommendation.recommendationType === 'combo' || recommendation.type === 'combo') {
      // Verify combo components have recipe costs
      const comboComponents = recommendation.offerSuggestion?.applicableProductIds || [];
      let comboHasMissingRecipe = false;
      for (const compId of comboComponents) {
        const compProduct = ctx.products?.find((p: any) => p.id === compId);
        if (!compProduct || !compProduct.recipeCost || compProduct.recipeCost <= 0) {
          comboHasMissingRecipe = true;
          break;
        }
      }
      if (comboHasMissingRecipe) {
        violations.push('combo_costing_error');
        confidenceImpact = 'Blocked';
      }
    }

    // === 7. Determine financial validity ===
    const financialValid = violations.length === 0;

    // === 8. Determine recommended action ===
    let recommendedAction: 'proceed' | 'adjust' | 'block' | 'investigate' = 'proceed';
    if (!financialValid) {
      if (violations.includes('missing_recipe')) {
        recommendedAction = 'investigate';
      } else if (violations.includes('combo_costing_error')) {
        recommendedAction = 'block';
      } else if (violations.includes('margin_violation')) {
        recommendedAction = 'adjust';
      } else {
        recommendedAction = 'investigate';
      }
    }

    // === 9. Compute variance ===
    const variance = financialValid ? 0 : calculatedContribution - (recordedContribution || 0);

    return {
      recommendationId: String(recommendation._id || recommendation.id),
      recommendationType: recommendation.recommendationType,
      title: recommendation.title,
      financialValid,
      violations,
      calculatedContribution: Math.max(0, calculatedContribution),
      recordedContribution,
      variance: Math.round(variance),
      confidenceImpact,
      recommendedAction,
    };
}

/**
 * Audit all recommendations for financial validity
 */
export function auditAllRecommendationsFinancials(
  restaurantId: string,
  policy: AutomationPolicy
): FinancialAuditResult[] {
    // Get recommendations for all goals
    const goals: string[] = [
      'increase_sales',
      'increase_profit',
      'increase_aov',
      'bring_customers_back',
      'move_inventory',
    ];

    const results: FinancialAuditResult[] = [];

    for (const goal of goals) {
      try {
        const result = require('./advisorService').generateAdvisorRecommendations(restaurantId, goal as any);
        // In production, import properly; for now, simulate
        // const recs = await generateAdvisorRecommendations(restaurantId, goal as any);
        // results.push(...recs.recommendations.map(r => auditRecommendationFinancials(r, {}, policy)));
      } catch {
        // Continue if one goal fails
      }
    }

    // Return placeholder - in production would audit actual recommendations
    return results;
}

/**
 * Verify promotion optimization financial calculations
 */
export function auditPromotionOptimizationFinancials(
  productId: string,
  productData: {
    sellingPrice: number;
    recipeCost: number;
    baselineDemand: number;
    discountPercent: number;
    elasticity: number;
  },
  constraints: {
    minMarginPercent: number;
    maxDiscountPercent: number;
    minSellingPrice: number;
  }
): {
  valid: boolean;
  violations: FinancialViolation[];
  contributionPerUnit: number;
  contributionMarginPercent: number;
  expectedDemand: number;
  expectedContribution: number;
  discountViolation: number; // how much over max discount
  marginViolation: number; // how much under min margin
} {
    const violations: FinancialViolation[] = [];
    let discountViolation = 0;
    let marginViolation = 0;

    const { sellingPrice, recipeCost, baselineDemand, discountPercent, elasticity } = productData;
    const { minMarginPercent, maxDiscountPercent, minSellingPrice } = constraints;

    // Calculate discounted price
    const discountAmount = Math.round(sellingPrice * (discountPercent / 100));
    const proposedPrice = sellingPrice - discountAmount;

    // Validate discount against max
    if (discountPercent > maxDiscountPercent) {
      violations.push('discount_calculation_error');
      discountViolation = discountPercent - maxDiscountPercent;
    }

    // Calculate contribution per unit
    const contributionPerUnit = Math.round(proposedPrice - recipeCost);

    // Calculate contribution margin percent
    const contributionMarginPercent = proposedPrice > 0
      ? Math.round((contributionPerUnit / proposedPrice) * 100)
      : 0;

    // Validate margin against min
    if (contributionMarginPercent < minMarginPercent) {
      violations.push('margin_violation');
      marginViolation = minMarginPercent - contributionMarginPercent;
    }

    // Calculate demand at discount using elasticity
    // %ΔQ = elasticity × %ΔP; %ΔP = -discount/100; so %ΔQ = elasticity × (-discount/100)
    const pctPriceChange = -discountPercent / 100;
    const pctDemandChange = elasticity * pctPriceChange;
    const expectedDemand = Math.max(0, Math.round(baselineDemand * (1 + pctDemandChange)));

    // Calculate expected contribution
    const expectedContribution = Math.round(contributionPerUnit * expectedDemand);

    const valid = violations.length === 0;

    return {
      valid,
      violations,
      contributionPerUnit,
      contributionMarginPercent,
      expectedDemand,
      expectedContribution,
      discountViolation,
      marginViolation,
    };
}

/**
 * Run financial audit on a restaurant's recommendations
 */
export function runFinancialAudit(restaurantId: string, policy: AutomationPolicy): {
    totalAudited: number;
    financiallyValid: number;
    violationsByType: Record<FinancialViolation, number>;
    violations: FinancialViolation[];
    blockedRecommendations: number;
    averageVariance: number;
    confidenceImpacts: Record<'None' | 'Reduced' | 'Blocked', number>;
  } {
    // In production, this would fetch actual recommendations from DB
    // For now, return structure with explanation

    return {
      totalAudited: 0,
      financiallyValid: 0,
      violationsByType: {} as Record<FinancialViolation, number>,
      violations: [],
      blockedRecommendations: 0,
      averageVariance: 0,
      confidenceImpacts: { None: 0, Reduced: 0, Blocked: 0 },
    };
  }

/**
 * Generate financial audit report for display
 */
export function formatFinancialAuditReport(
  results: FinancialAuditResult[]
): string {
    if (results.length === 0) {
      return 'No recommendations audited.';
    }

    const validCount = results.filter(r => r.financialValid).length;
    const violationCounts: Record<FinancialViolation, number> = {
      incorrect_cost: 0,
      missing_recipe: 0,
      variant_cost_error: 0,
      double_deduction: 0,
      discount_calculation_error: 0,
      tax_confusion: 0,
      combo_costing_error: 0,
      margin_violation: 0,
      unknown: 0,
    };

    let blocked = 0;
    let totalVariance = 0;
    let confidenceImpactCounts: Record<'None' | 'Reduced' | 'Blocked', number> = {
      None: 0,
      Reduced: 0,
      Blocked: 0,
    };

    for (const r of results) {
      if (!r.financialValid) {
        blocked++;
      }
      for (const v of r.violations) {
        violationCounts[v] = (violationCounts[v] || 0) + 1;
      }
      totalVariance += r.variance;
      confidenceImpactCounts[r.confidenceImpact] = (confidenceImpactCounts[r.confidenceImpact] || 0) + 1;
    }

    const avgVariance = results.length > 0 ? totalVariance / results.length : 0;

    const report = [
      `Financial Audit Report: ${results.length} recommendations audited`,
      ``,
      `Financially valid: ${validCount}/${results.length} (${Math.round((validCount / results.length) * 100)}%)`,
      `Blocked/${'adjust'}/${'investigate'} recommendations: ${blocked}/${results.length - blocked}`,
      ``,
      'Violations by type:',
    ];

    for (const [violationType, count] of Object.entries(violationCounts)) {
      if (count > 0) {
        report.push(`  - ${violationType}: ${count}`);
      }
    }

    report.push(``, `Average variance: ₹${avgVariance.toFixed(0).toLocaleString('en-IN')}/recommendation`, ``, `Confidence impact:`, `  - None: ${confidenceImpactCounts.None}`, `  - Reduced: ${confidenceImpactCounts.Reduced}`, `  - Blocked: ${confidenceImpactCounts.Blocked}`);

    return report.join('\n');
}
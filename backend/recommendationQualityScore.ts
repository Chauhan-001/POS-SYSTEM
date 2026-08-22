/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecommendationQualityScore — Internal quality metric for engineering evaluation.
 *
 * For each recommendation evaluate:
 *   Correctness
 *   Financial usefulness
 *   Confidence
 *   Actionability
 *   Timeliness
 *   Outcome
 *
 * Do not expose an arbitrary single number to the restaurant owner.
 * This metric is primarily for engineering evaluation.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { FinancialAuditResult } from './financialTruthAudit';
import type { InventoryAudit } from './inventoryAudit';
import type { OfferEligibilityResult } from './offerAudit';
import type { ComboAuditResult } from './comboAudit';

/**
 * Recommendation quality dimensions
 */
export interface RecommendationQualityScore {
  recommendationId: string;
  title: string;
  type: string;

  // Correctness (0-100)
  correctness: number; // How factually correct is the recommendation?

  // Financial usefulness (-50 to +50)
  // Positive = recommended action improves finances
  // Negative = recommended action loses money
  financialUsefulness: number;

  // Confidence (0-100) - from the system's confidence
  confidence: number;

  // Actionability (0-100)
  // How easy is it to act on this recommendation?
  actionability: number;

  // Timeliness (0-100)
  // How recent is the data supporting this recommendation?
  timeliness: number;

  // Outcome prediction (-1 to +1)
  // -1 = likely negative outcome, 0 = neutral, +1 = likely positive
  outcomePrediction: number;

  // Data quality supporting the recommendation
  dataQuality: 'Excellent' | 'Good' | 'Limited' | 'Poor';

  // Supporting metrics
  supportingMetrics: {
    salesDataFreshness: number; // minutes ago
    inventoryFreshness: number; // minutes ago
    recipeCompleteness: number; // 0-100
    marginDataValidity: number; // 0-100
  };
}

/**
 * Calculate recommendation quality score
 */
export function calculateRecommendationQualityScore(
  recommendation: any,
  ctx: RecommendationContext,
  financialAudit: FinancialAuditResult,
  inventoryAudit: ReturnType<typeof inventoryAudit.auditRecommendationInventory>[],
  offerAudit: OfferEligibilityResult,
  comboAudit?: ComboAuditResult
): RecommendationQualityScore {
    // 1. Correctness: How factually accurate are the claims?
    let correctness = 100;

    // Check if recipe is complete (affects correctness of margin claims)
    const hasCompleteRecipe = ctx.margin?.productMargins?.some(
      (m: any) => m.productId === (recommendation.offerSuggestion?.applicableProductIds?.[0] || '') &&
      m.contributionMarginPercent !== undefined
    ) || false;

    if (!hasCompleteRecipe && recommendation.economics) {
      correctness -= 30; // Significant drop
    }

    // Check data freshness
    const sales = ctx.sales;
    if (sales) {
      // Sales data freshness - estimate from order count recency
      const orderCount = sales.orderCount || 0;
      if (orderCount < 10) {
        correctness -= 20; // Stale data
      } else if (orderCount < 20) {
        correctness -= 10; // Moderately fresh
      }
    }

    // Check if financial audit found violations
    if (!financialAudit.financialValid) {
      correctness -= 20; // Financial claims are wrong
      if (financialAudit.confidenceImpact === 'Blocked') {
        correctness -= 15;
      }
    }

    // Ensure correctness is within 0-100
    correctness = Math.max(0, Math.min(100, correctness));

    // 2. Financial usefulness: Does the recommendation actually improve finances?
    // positive value = recommended action makes money, negative = loses money
    let financialUsefulness = 0;

    if (financialAudit.calculatedContribution > 0) {
      financialUsefulness = 30 + Math.min(20, Math.round((financialAudit.calculatedContribution / 1000) * 10)); // More contribution = more useful
    } else if (financialAudit.calculatedContribution < 0) {
      financialUsefulness = -20; // Recommended action loses money
    } else {
      financialUsefulness = 0; // Break-even
    }

    // Adjust based on audit violations
    if (financialAudit.violations.length > 0) {
      financialUsefulness -= 15 * financialAudit.violations.length;
    }

    // 3. Confidence: System's confidence in the recommendation
    const confidence = recommendation.confidence === 'High' ? 80
      : recommendation.confidence === 'Medium' ? 60
        : recommendation.confidence === 'Low' ? 30
          : 50; // default

    // 4. Actionability: How easy is it to act on this?
    let actionability = 75; // base

    // If recipe is missing, acting on contribution recommendations is hard
    if (!hasCompleteRecipe) {
      actionability -= 25;
    }

    // If inventory is blocked, acting is hard
    if (inventoryAudit.some((a) => a.promotionBlocked)) {
      actionability -= 20;
    }

    // If offer is not eligible, acting is impossible
    if (!offerAudit.eligible) {
      actionability -= 30;
    }

    // Ensure 0-100
    actionability = Math.max(0, Math.min(100, actionability));

    // 5. Timeliness: How recent is the data?
    let timeliness = 75; // base

    const sales = ctx.sales;
    if (sales) {
      // Estimate freshness: if we have recent orders, data is fresh
      const orderCount = order.orderCount || 0;
      if (orderCount > 50) {
        timeliness = 90; // Very fresh
      } else if (orderCount > 20) {
        timeliness = 75; // Fresh
      } else if (orderCount > 10) {
        timeliness = 50; // Moderately fresh
      } else {
        timeliness = 20; // Stale
      }
    }

    // 6. Outcome prediction: Likely result based on similar historical cases
    // Simplified: based on financial correctness and confidence
    let outcomePrediction: number = 0; // -1 to +1

    if (financialAudit.calculatedContribution > 0 && financialAudit.confidenceImpact !== 'Blocked') {
      outcomePrediction = 0.5; // Positive
    } else if (financialAudit.calculatedContribution < 0) {
      outcomePrediction = -0.5; // Negative
    } else if (financialAudit.financialValid && confidence >= 70) {
      outcomePrediction = 0.2; // Slightly positive
    }

    // 7. Data quality
    let dataQuality: 'Excellent' | 'Good' | 'Limited' | 'Poor' = 'Good';

    const issuesCount = financialAudit.violations.length +
      (inventoryAudit.some((a) => a.promotionBlocked) ? 1 : 0) +
      (offerAudit.eligible ? 0 : 1);

    if (issuesCount === 0) {
      dataQuality = 'Excellent';
    } else if (issuesCount <= 1) {
      dataQuality = 'Good';
    } else if (issuesCount <= 3) {
      dataQuality = 'Limited';
    } else {
      dataQuality = 'Poor';
    }

    // Build supporting metrics
    const supportingMetrics = {
      salesDataFreshness: sales ? /* minutes ago estimate */ 15 : 1440, // placeholder
      inventoryFreshness: /* minutes ago */ 5,
      recipeCompleteness: hasCompleteRecipe ? 100 : 0,
      marginDataValidity: financialAudit.financialValid ? 90 : 40,
    };

    return {
      recommendationId: String(recommendation._id || recommendation.id),
      title: recommendation.title,
      type: recommendation.recommendationType,
      correctness,
      financialUsefulness,
      confidence,
      actionability,
      timeliness,
      outcomePrediction,
      dataQuality,
      supportingMetrics,
    };
  }

  /**
   * Calculate quality scores for all recommendations
   */
  export function calculateAllRecommendationsQuality(
    restaurantId: string,
    ctx: RecommendationContext,
    policy: AutomationPolicy
  ): RecommendationQualityScore[] {
    // Get recommendations for all goals
    const goals: string[] = [
      'increase_sales',
      'increase_profit',
      'increase_aov',
      'bring_customers_back',
      'move_inventory',
    ];

    const results: RecommendationQualityScore[] = [];

    for (const goal of goals) {
      try {
        // In production, fetch actual recommendations from DB
        // const recs = await generateAdvisorRecommendations(restaurantId, goal as any);
        // For now, push a placeholder
        // results.push(...recs.recommendations.map(r =>
        //   calculateRecommendationQualityScore(r, ctx, policy)
        // ));
        results.push({
          recommendationId: 'placeholder',
          title: `${goal} recommendation`,
          type: 'placeholder',
          correctness: 70,
          financialUsefulness: 10,
          confidence: 60,
          actionability: 70,
          timeliness: 75,
          outcomePrediction: 0,
          dataQuality: 'Good',
          supportingMetrics: {
            salesDataFreshness: 15,
            inventoryFreshness: 5,
            recipeCompleteness: 80,
            marginDataValidity: 85,
          },
        });
      } catch {
        continue;
      }
    }

    return results;
  }

  /**
   * Generate quality report
   */
  export function formatQualityReport(
    scores: RecommendationQualityScore[]
  ): string {
    if (scores.length === 0) return 'No recommendations scored.';

    const total = scores.length;
    const avgCorrectness = scores.reduce((s, r) => s + r.correctness, 0) / total;
    const avgFinancialUsefulness = scores.reduce((s, r) => s + r.financialUsefulness, 0) / total;
    const avgConfidence = scores.reduce((s, r) => s + r.confidence, 0) / total;
    const avgActionability = scores.reduce((s, r) => s + r.actionability, 0) / total;
    const avgTimeliness = scores.reduce((s, r) => s + r.timeliness, 0) / total;

    const dataQualityCounts: Record<string, number> = {
      Excellent: 0,
      Good: 0,
      Limited: 0,
      Poor: 0,
    };
    const outcomePredictionCounts: Record<number, number> = {
      '-1 (negative)': 0,
      '0 (neutral)': 0,
      '+1 (positive)': 0,
    };

    for (const s of scores) {
      dataQualityCounts[s.dataQuality]++;
      outcomePredictionCounts[Math.round(s.outcomePrediction) * 100] = (
        outcomePredictionCounts[Math.round(s.outcomePrediction) * 100] || 0
      ) + 1;
    }

    const report = [
      `Recommendation Quality Report: ${total} recommendations analyzed`,
      ``,
      `Average Correctness: ${Math.round(avgCorrectness)}/100`,
      `Average Financial Usefulness: ${Math.round(avgFinancialUsefulness)}/50`,
      `Average Confidence: ${Math.round(avgConfidence)}/100`,
      `Average Actionability: ${Math.round(avgActionability)}/100`,
      `Average Timeliness: ${Math.round(avgTimeliness)}/100`,
      ``,
      `Data Quality Distribution:`,
      `  • Excellent: ${dataQualityCounts.Excellent}`,
      `  • Good: ${dataQualityCounts.Good}`,
      `  • Limited: ${dataQualityCounts.Limited}`,
      `  • Poor: ${dataQualityCounts.Poor}`,
      ``,
      `Outcome Prediction Distribution:`,
      `  • Positive: ${outcomePredictionCounts['1'] || 0}`,
      `  • Neutral: ${outcomePredictionCounts['0'] || 0}`,
      `  • Negative: ${outcomePredictionCounts['-1'] || 0}`,
      ``,
      `Key: Correctness = factual accuracy; Financial Usefulness = $ impact direction; `,
      `  Confidence = system certainty; Actionability = ease of implementation;`,
      `  Timeliness = data recency; Data Quality = supporting evidence quality`,
    ];

    return report.join('\n');
  }
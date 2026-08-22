/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FalsePositiveNegativeAnalysis — Analyze recommendations that were technically valid
 * but commercially useless (false positives) or missed opportunities (false negatives).
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { FinancialAuditResult } from './financialTruthAudit';

/**
 * False positive: technically valid but commercially useless
 */
export interface FalsePositive {
  recommendationId: string;
  title: string;
  type: string;
  reason: string; // Why it was useless
  expectedContribution: number;
  actualContribution?: number;
  reasonCategory: 'no_demand' | 'strong_demand_already' | 'margin_too_thin' | 'seasonal_decline' | 'other';
  lessonsLearned: string;
}

/**
 * False negative: missed opportunity
 */
export interface FalseNegative {
  recommendationId?: string;
  description: string;
  missedOpportunity: string;
  productId?: string;
  productName?: string;
  reason: string; // Why it was missed
  lessonsLearned: string;
  suggestedFix: string;
}

/**
 * False positive analysis
 */
export function analyzeFalsePositives(
  restaurantId: string,
  historicalOutcomes: Array<{
    recommendationId: string;
    title: string;
    type: string;
    expectedContribution: number;
    actualContribution: number;
    outcome: 'positive' | 'negative' | 'neutral';
    executed: boolean;
  }>
): FalsePositive[] {
    const falsePositives: FalsePositive[] = [];

    for (const outcome of historicalOutcomes) {
      // If the recommendation was executed but actual contribution was
      // significantly lower than expected, or actual was negative/neutral
      if (outcome.executed && outcome.outcome !== 'positive') {
        let reasonCategory: 'no_demand' | 'strong_demand_already' | 'margin_too_thin' | 'seasonal_decline' | 'other' = 'other';

        if (outcome.actualContribution < 0) {
          reasonCategory = 'margin_too_thin';
        } else if (outcome.expectedContribution > 0 && outcome.actualContribution < outcome.expectedContribution * 0.5) {
          reasonCategory = 'no_demand';
        } else if (outcome.expectedContribution > 0 && outcome.actualContribution < outcome.expectedContribution * 0.8) {
          reasonCategory = 'seasonal_decline';
        } else if (outcome.expectedContribution === 0 || outcome.expectedContribution < 100) {
          reasonCategory = 'no_demand_already';
        }

        falsePositives.push({
          recommendationId: outcome.recommendationId,
          title: outcome.title,
          type: outcome.type,
          reason: getFalsePositiveReason(reasonCategory),
          expectedContribution: outcome.expectedContribution,
          actualContribution: outcome.actualContribution,
          reasonCategory,
          lessonsLearned: `Recommendation "${outcome.title}" executed but delivered ${outcome.actualContribution >= 0 ? 'modest' : 'negative'} financial result. Expected ₹${outcome.expectedContribution.toLocaleString('en-IN')}, got ₹${outcome.actualContribution.toLocaleString('en-IN')}.`,
        });
      }
    }

    return falsePositives;
  }

  function getFalsePositiveReason(category: string): string {
    const reasons: Record<string, string> = {
      no_demand: 'Insufficient customer demand during promotion period',
      strong_demand_already: 'Product/item already selling well - promotion unnecessary',
      margin_too_thin: 'Promotion margin would be too thin to be meaningful',
      seasonal_decline: 'Promotion timed wrong for current season/demand pattern',
      other: 'Commercial reason not categorized above',
    };
    return reasons[category] || 'Commercially useless';
  }

  /**
   * False negative analysis
   */
  export function analyzeFalseNegatives(
    restaurantId: string,
    all historicalRecommendations: Array<{
      recommendationId: string;
      title: string;
      type: string;
      expectedContribution: number;
      executed: boolean;
      outcome?: 'positive' | 'negative' | 'neutral';
    }>,
    currentRestaurantData: {
      productId?: string;
      productName?: string;
      salesTrend?: 'up' | 'down' | 'stable';
      marginStatus?: 'healthy' | 'thin' | 'critical';
      demandStatus?: 'high' | 'medium' | 'low';
    }
  ): FalseNegative[] {
    const falseNegatives: FalseNegative[] = [];

    // Group recommendations by type and look for patterns
    const byType = historicalRecommendations.reduce((acc, rec) => {
      (acc[rec.type] = acc[rec.type] || []).push(rec);
      return acc;
    }, {} as Record<string, typeof historicalRecommendations>);

    // Check for each recommendation type if there are missed opportunities
    // Specifically look for cases where current data suggests opportunity but no recommendation was generated

    // 1. Check for products with high margin + high sales + no combo recommendation
    if (historicalRecommendations.length > 0) {
      const hasCombo = historicalRecommendations.some(r => r.type === 'combo' || r.recommendationType === 'combo');
      const hasMarginPromotion = historicalRecommendations.some(r => r.type === 'margin_promotion' || r.recommendationType === 'margin_promotion');

      // If no combo recommendations were generated but current data shows
      // products with high margin + strong attachment potential
      if (!hasCombo && currentDataSalesTrendIsUp && !hasMarginPromotion) {
        falseNegatives.push({
          description: 'No combo recommendation generated for high-margin products with strong attachment',
          missedOpportunity: 'Combo promotions could increase basket value',
          reason: 'Combo generator may not have triggered due to signal thresholds',
          lessonsLearned: 'Ensure combo detection activates on high-margin product pairs with above-average attachment rates',
          suggestedFix: 'Lower combo detection threshold for high-margin product pairs',
        });
      }

      // 2. Check for win-back recommendations
      if (!hasMarginPromotion) {
        falseNegatives.push({
          description: 'No margin protection recommendations for thin-margin products',
          missedOpportunity: 'Protect margins before they are eroded by discounts',
          reason: 'Margin risk generator may not have flagged products with margin < 25%',
          lessonsLearned: 'Ensure margin risk detection activates on all products with contribution margin < 30%',
          suggestedFix: 'Activate margin risk detection for all products below 30% contribution margin',
        });
      }
    }

    // 3. Check current data for missed opportunities
    if (currentRestaurantData.salesTrend === 'up' && currentRestaurantData.marginStatus === 'healthy') {
      // If sales are up and margins are healthy, there may be expansion opportunities
      // that the system didn't surface
      falseNegatives.push({
        description: 'Expansion opportunities not surfaced when restaurant is performing well',
        missedOpportunity: 'New promotions, combo opportunities, or customer reactivation campaigns',
        reason: 'System may be in "maintenance mode" when data is sufficient',
        lessonsLearned: 'System should proactively suggest growth opportunities, not just corrective actions, when data is sufficient',
        suggestedFix: 'Add growth-op detection trigger when data quality is Excellent and trends are positive',
      });
    }

    return falseNegatives;
  }

  /**
   * Format false positive analysis
   */
  export function formatFalsePositiveAnalysis(
    falsePositives: FalsePositive[]
  ): string {
    if (falsePositives.length === 0) return 'No false positives detected in analyzed history.';

    const lines: string[] = [];

    lines.push(`False Positive Analysis: ${falsePositives.length} recommendations were technically valid but commercially useless`);
    lines.push('');

    for (const fp of falsePositives) {
      lines.push(`Recommendation: ${fp.title} (${fp.type})`);
      lines.push(`  Reason: ${fp.reason}`);
      lines.push(`  Expected: ₹${fp.expectedContribution.toLocaleString('en-IN')}`);
      if (fp.actualContribution !== undefined) {
        lines.push(`  Actual: ₹${fp.actualContribution.toLocaleString('en-IN')}`);
      }
      lines.push(`  Lesson: ${fp.lessonsLearned}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format false negative analysis
   */
  export function formatFalseNegativeAnalysis(
    falseNegatives: FalseNegative[]
  ): string {
    if (falseNegatives.length === 0) return 'No false negatives detected. All apparent opportunities were captured.';

    const lines: string[] = [];

    lines.push(`False Negative Analysis: ${falseNegatives.length} missed opportunities identified`);
    lines.push('');

    for (const fn of falseNegatives) {
      lines.push(`Missed: ${fn.description}`);
      lines.push(`  Opportunity: ${fn.missedOpportunity}`);
      lines.push(`  Reason: ${fn.reason}`);
      lines.push(`  Lesson: ${fn.lessonsLearned}`);
      if (fn.suggestedFix) {
        lines.push(`  Fix: ${fn.suggestedFix}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
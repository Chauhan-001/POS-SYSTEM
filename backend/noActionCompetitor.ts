/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NoActionCompetitor — Every optimization problem should compare against "Do nothing."
 *
 * Example:
 *   No promotion
 *   Expected contribution: ₹15,000
 *
 *   Promotion A
 *   Expected contribution: ₹15,200
 *
 *   Promotion B
 *   Expected contribution: ₹16,400
 *
 *   Then B wins.
 *
 *   But if:
 *   No promotion: ₹15,000
 *   Promotion A: ₹14,800
 *   Promotion B: ₹15,100
 *
 *   The recommendation should be:
 *   "Promotion B is only marginally better; no promotion may be preferable given uncertainty."
 *
 * This prevents aggressive recommendations.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { FinancialAuditResult } from './financialTruthAudit';

/**
 * No-action competitor benchmark result
 */
export interface NoActionBenchmark {
  noPromotionContribution: number;
  promotionAContribution: number;
  promotionBContribution?: number;
  winner: 'no_action' | 'promotion_a' | 'promotion_b' | 'marginal';
  recommendation: string;
  uncertaintyPenaltyApplied: boolean;
  confidenceAdjusted: boolean;
}

/**
 * Apply uncertainty penalty to recommendation evaluation
 */
export function applyUncertaintyPenalty(
  noPromotionContribution: number,
  promotionContribution: number,
  promotionConfidence: number, // 0-100
  confidenceThreshold: number = 70
): NoActionBenchmark {
    // Calculate uncertainty penalty
    // Lower confidence = larger penalty on promotion contribution
    const penaltyPercent = promotionConfidence < confidenceThreshold
      ? (100 - promotionConfidence) * 0.2 // 20% penalty per 10 confidence points below threshold
      : 0;

    const penalty = promotionContribution * (penaltyPercent / 100);
    const adjustedPromotionContribution = promotionContribution - penalty;

    // Compare no-action vs adjusted promotion
    let winner: 'no_action' | 'promotion_a' | 'promotion_b' | 'marginal' = 'no_action';
    let recommendation = '';
    let uncertaintyPenaltyApplied = penalty > 0;
    let confidenceAdjusted = penalty > 0;

    if (noPromotionContribution > adjustedPromotionContribution) {
      winner = 'no_action';
      recommendation = `No promotion is preferable. ` +
        `Expected contribution without promotion: ₹${noPromotionContribution.toLocaleString('en-IN')}. ` +
        `Promotion would yield ₹${promotionContribution.toLocaleString('en-IN')}, ` +
        `but with ${penaltyPercent.toFixed(1)}% uncertainty penalty (confidence: ${promotionConfidence}%), ` +
        `adjusted contribution is ₹${adjustedPromotionContribution.toLocaleString('en-IN')}. ` +
        `Given the uncertainty, sticking with no promotion avoids risk.`;
    } else if (Math.abs(noPromotionContribution - adjustedPromotionContribution) < 500) {
      // Marginal difference - within ₹500
      winner = 'marginal';
      const diff = adjustedPromotionContribution - noPromotionContribution;
      recommendation = `Promotion is only marginally better (₹${diff > 0 ? '+' : ''}${diff.toLocaleString('en-IN')} contribution). ` +
        `Given uncertainty (confidence: ${promotionConfidence}%), ` +
        `no promotion may be preferable. ` +
        `If you proceed with the promotion, ensure you monitor results closely and be prepared to stop early if results underperform.`;
    } else {
      winner = 'promotion_a'; // promotion has higher adjusted contribution
      const diff = adjustedPromotionContribution - noPromotionContribution;
      recommendation = `Promotion recommended. ` +
        `Expected contribution with promotion: ₹${adjustedPromotionContribution.toLocaleString('en-IN')}. ` +
        `Without promotion: ₹${noPromotionContribution.toLocaleString('en-IN')}. ` +
        `Difference: ₹${diff.toLocaleString('en-IN')}. ` +
        `(Confidence: ${promotionConfidence}%)`;
    }

    return {
      noPromotionContribution,
      promotionAContribution: promotionContribution,
      promotionBContribution: undefined,
      winner,
      recommendation,
      uncertaintyPenaltyApplied,
      confidenceAdjusted,
    };
  }

  /**
   * Benchmark recommendation against no-action competitor
   */
  export function benchmarkRecommendationAgainstNoAction(
    restaurantId: string,
    recommendation: any,
    ctx: RecommendationContext,
    policy: AutomationPolicy
  ): NoActionBenchmark {
    // Get no-promotion baseline (current contribution without any new promotion)
    const noPromotionContribution = calculateNoPromotionContribution(ctx);

    // Get promotion's expected contribution from the financial audit
    const financialAudit = auditRecommendationFinancials(
      recommendation,
      ctx,
      policy
    );

    // Get promotion confidence
    const confidence = recommendation.confidence === 'High' ? 90
      : recommendation.confidence === 'Medium' ? 60
        : recommendation.confidence === 'Low' ? 30
          : 50;

    return applyUncertaintyPenalty(
      noPromotionContribution,
      financialAudit.calculatedContribution || 0,
      confidence
    );
  }

  /**
   Calculate no-promotion baseline contribution from current sales and margins
   */
  function calculateNoPromotionContribution(ctx: RecommendationContext): number {
    const margins = ctx.margin?.productMargins || [];
    const baseContribution = margins.reduce((sum: number, m: any) => sum + (m.totalContribution || 0), 0) || 0;

    // Add current campaign contributions if any
    // In a full implementation, would subtract active campaign impacts

    return baseContribution;
  }

  /**
   * Format no-action benchmark result
   */
  export function formatNoActionBenchmark(
    benchmark: NoActionBenchmark
  ): string {
    const lines: string[] = [];

    lines.push('No-Action Competitor Benchmark');
    lines.push('=' .repeat(40));
    lines.push('');
    lines.push(`Without promotion: ₹${benchmark.noPromotionContribution.toLocaleString('en-IN')}`);
    lines.push(`With promotion: ₹${benchmark.promotionAContribution.toLocaleString('en-IN')}`);
    if (benchmark.promotionBContribution !== undefined) {
      lines.push(`With promotion B: ₹${benchmark.promotionBContribution.toLocaleString('en-IN')}`);
    }
    lines.push('');
    lines.push(`Winner: ${benchmark.winner}`);
    lines.push(`Recommendation: ${benchmark.recommendation}`);
    lines.push('');
    lines.push(`Uncertainty penalty applied: ${benchmark.uncertaintyPenaltyApplied}`);
    lines.push(`Confidence adjusted: ${benchmark.confidenceAdjusted}`);

    return lines.join('\n');
  }
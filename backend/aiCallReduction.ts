/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICallReduction — Replace unnecessary LLM calls with deterministic computations.
 *
 * Bad:
 *   LLM → calculate top-selling product
 *
 * Correct:
 *   Database aggregation → top product
 *   LLM → explain significance
 *
 * Bad:
 *   LLM → calculate discount economics
 *
 * Correct:
 *   Financial engine → economics
 *   LLM → explain result
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { AutomationPolicy } from '../services/restaurantIntelligenceOrchestrator';

/**
 * AI call reduction analysis
 */
export interface AICallReduction {
  originalCalls: number;
  reducibleCalls: number;
  remainingCalls: number;
  estimatedMonthlySavings: number;
  recommendations: AICallReductionRecommendation[];
}

/**
 * AI call reduction recommendation
 */
export interface AICallReductionRecommendation {
  area: string;
  originalLLMCall: string;
  replacementDeterministic: string;
  savingsEstimate: number;
  risk: 'low' | 'medium' | 'high';
}

/**
 * Analyze AI call reduction opportunities
 */
export function analyzeAICallReduction(
  restaurantId: string,
  monthlyAIUsage: {
    totalCalls: number;
    callTypes: Record<string, number>;
  }
): AICallReduction {
    const originalCalls = monthlyAIUsage.totalCalls;
    const callTypes = monthlyAIUsage.callTypes;

    // Identify reducible call types
    let reducibleCalls = 0;
    const recommendations: AICallReductionRecommendation[] = [];

    // 1. Top-selling product - should NOT use LLM
    if (callTypes.top_product || 0 > 0) {
      reducibleCalls++;
      recommendations.push({
        area: 'top_selling_product',
        originalLLMCall: 'LLM → calculate top-selling product',
        replacementDeterministic: 'Database aggregation → top product by units sold',
        savingsEstimate: 15, // ₹ per call estimate
        risk: 'low',
      });
    }

    // 2. Discount economics - should NOT use LLM
    if (callTypes.discount_economics || 0 > 0) {
      reducibleCalls++;
      recommendations.push({
        area: 'discount_economics',
        originalLLMCall: 'LLM → calculate discount economics',
        replacementDeterministic: 'Financial engine → economics; LLM → explain result',
        savingsEstimate: 20,
        risk: 'low',
      });
    }

    // 3. Recommendation explanations - CAN use LLM (enhancement only)
    // These are already best-effort with deterministic fallback
    // No reduction needed - already properly designed

    // 4. Forecast explanations - can use deterministic baselines
    if (callTypes.forecast_explanation || 0 > 0) {
      reducibleCalls++;
      recommendations.push({
        area: 'forecast_explanation',
        originalLLMCall: 'LLM → explain forecast',
        replacementDeterministic: 'Baseline comparisons + trend analysis; LLM only if needed for complex interpretation',
        savingsEstimate: 10,
        risk: 'medium',
      });
    }

    // 5. Customer segment analysis - database should handle this
    if (callTypes.customer_segment || 0 > 0) {
      reducibleCalls++;
      recommendations.push({
        area: 'customer_segment',
        originalLLMCall: 'LLM → analyze customer segments',
        replacementDeterministic: 'Customer segmentation service → aggregate metrics',
        savingsEstimate: 12,
        risk: 'low',
      });
    }

    // 6. Promotion optimization - financial engine should handle
    if (callTypes.promotion_optimization || 0 > 0) {
      reducibleCalls++;
      recommendations.push({
        area: 'promotion_optimization',
        originalLLMCall: 'LLM → generate promotion',
        replacementDeterministic: 'Promotion optimization service → bounded discount search',
        savingsEstimate: 30,
        risk: 'low',
      });
    }

    // 7. Recommendation ranking - can use deterministic scoring
    if (callTypes.recommendation_ranking || 0 > 0) {
      reducibleCalls++;
      recommendations.push({
        area: 'recommendation_ranking',
        originalLLMCall: 'LLM → rank recommendations',
        replacementDeterministic: 'Deterministic scoring: Impact × Confidence × Urgency × Actionability - Risk',
        savingsEstimate: 18,
        risk: 'low',
      });
    }

    // Calculate estimated monthly savings
    const estimatedMonthlySavings = reducibleCalls * 20; // average savings per call

    return {
      originalCalls,
      reducibleCalls,
      remainingCalls: originalCalls - reducibleCalls,
      estimatedMonthlySavings,
      recommendations,
    };
  }

  /**
   * Format AI call reduction analysis
   */
  export function formatAICallReduction(
    analysis: AICallReduction
  ): string {
    const lines: string[] = [];

    lines.push('AI Call Reduction Analysis');
    lines.push('=' .repeat(30));
    lines.push('');
    lines.push(`Original calls/month: ${analysis.originalCalls}`);
    lines.push(`Reducible calls/month: ${analysis.reducibleCalls}`);
    lines.push(`Remaining calls/month: ${analysis.remainingCalls}`);
    lines.push(`Estimated monthly savings: ₹${analysis.estimatedMonthlySavings.toLocaleString('en-IN')}`);
    lines.push('');

    for (const rec of analysis.recommendations) {
      lines.push(`Area: ${rec.area}`);
      lines.push(`  Original: ${rec.originalLLMCall}`);
      lines.push(`  Replacement: ${rec.replacementDeterministic}`);
      lines.push(`  Savings: ₹${rec.savingsEstimate.toLocaleString('en-IN')}/month`);
      lines.push(`  Risk: ${rec.risk}`);
      lines.push('');
    }

    return lines.join('\n');
  }
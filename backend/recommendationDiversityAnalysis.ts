/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RecommendationDiversityAnalysis — Avoid generating ten variations of the same
 * recommendation. If all arise from the same underlying signal, consolidate them.
 *
 * Show the owner:
 *   Increase burger basket value
 *   with several validated strategies inside it.
 */

import mongoose from 'mongoose';
import type { RecommendationContext } from './recommendationContext';
import type { RecommendationQualityScore } from './recommendationQualityScore';

/**
 * Signal identity for dedupulation
 */
export interface SignalIdentity {
  signalType: string;
  productId?: string;
  category?: string;
  timePattern?: string;
  marginRange?: string;
  customerSegment?: string;
}

/**
 * Opportunity identity
 */
export interface OpportunityIdentity {
  opportunityType: string; // e.g., 'low_demand', 'high_margin', 'slow_inventory', 'dormant_customers'
  rootSignal: string; // The underlying signal that creates this opportunity
  affectedProducts: string[]; // Product IDs
  customerSegments: string[]; // Segment IDs
  timeContext: string; // e.g., 'tuesday_afternoon', 'dinner_rush', 'weekend'
}

/**
 * Recommendation diversity analysis
 */
export function analyzeRecommendationDiversity(
  scores: RecommendationQualityScore[]
): {
  diversityScore: number; // 0-100, higher = more diverse
  consolidatedGroups: Array<{
    rootSignal: string;
    recommendations: Array<{
      recommendationId: string;
      title: string;
    }>;
    action: 'consolidate' | 'present_as_options';
  }>;
  ownerPresentation: string; // How to present to owner
  recommendations: string[]; // Action items
} {
    if (scores.length === 0) {
      return {
        diversityScore: 100,
        consolidatedGroups: [],
        ownerPresentation: 'No recommendations to analyze',
        recommendations: [],
      };
    }

    // Group recommendations by their underlying signal
    // We infer the signal from the quality score's supporting indicators
    // and the recommendation's title/type

    const groups: Map<string, Array<{ recommendationId: string; title: string }>> = new Map();

    for (const score of scores) {
      // Infer signal from the recommendation
      const signalKey = inferSignalKey(score);

      if (!groups.has(signalKey)) {
        groups.set(signalKey, []);
      }
      groups.get(signalKey)!.push({
        recommendationId: score.recommendationId,
        title: score.title,
      });
    }

    // Analyze groups
    const consolidatedGroups: Array<{
      rootSignal: string;
      recommendations: Array<{
        recommendationId: string;
        title: string;
      }>;
      action: 'consolidate' | 'present_as_options';
    }[]> = [];

    let totalUniqueSignals = 0;

    for (const [signalKey, recs] of groups) {
      totalUniqueSignals++;

      // If this group has many recommendations (3+), consolidate them
      if (recs.length >= 3) {
        consolidatedGroups.push({
          rootSignal: signalKey,
          recommendations: recs,
          action: 'consolidate',
        });
      } else {
        // Small groups - present as options
        consolidatedGroups.push({
          rootSignal: signalKey,
          recommendations: recs,
          action: 'present_as_options',
        });
      }
    }

    // Calculate diversity score
    // Higher score = more unique signals / fewer consolidated groups
    const diversityScore = Math.round((totalUniqueSignals / scores.length) * 100);
    // Cap at 100, but ensure it reflects diversity
    const adjustedDiversity = Math.min(100, Math.round((totalUniqueSignals / Math.max(1, scores.length)) * 100));

    // Generate owner presentation
    const topSignals = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3);

    const ownerPresentationLines: string[] = [];

    for (const [signal, recs] of topSignals) {
      const action = groups.get(signal)![0].action;
      ownerPresentationLines.push(
        `${action === 'consolidate' ? 'Consolidated' : 'Option'}: ${signal} (${recs.length} recommendations)`
      );
    }

    if (ownerPresentationLines.length === 0) {
      ownerPresentationLines.push('All recommendations address unique situations');
    }

    // Generate recommendations
    const recs: string[] = [];

    if (adjustedDiversity < 50) {
      // Low diversity - too many same-signals
      recs.push(
        'Consolidate similar recommendations - show owner 1-2 root problems with multiple validated strategies'
      );
    } else if (adjustedDiversity > 70) {
      // High diversity - many different situations
      recs.push(
        'Present full range of opportunities - owner can prioritize based on current business objective'
      );
    } else {
      // Medium diversity
      recs.push(
        'Show top 3-5 prioritized recommendations aligned with current business objective'
      );
    }

    return {
      diversityScore: adjustedDiversity,
      consolidatedGroups,
      ownerPresentation: ownerPresentationLines.join('. ') + '.',
      recommendations: recs,
    };
  }

  /**
   * Infer the signal key from a quality score
   */
  function inferSignalKey(score: RecommendationQualityScore): string {
    const titleLower = score.title.toLowerCase();
  const typeLower = score.type.toLowerCase();

  // Based on title and type, infer the underlying signal
  if (titleLower.includes('margin') || typeLower === 'margin_promotion' || typeLower === 'margin_protection') {
    return 'thin_margin';
  }

  if (titleLower.includes('combo') || typeLower === 'combo') {
    return 'combo_opportunity';
  }

  if (titleLower.includes('add-on') || typeLower === 'add_on' || titleLower.includes('upsell')) {
    return 'aov_increase';
  }

  if (titleLower.includes('win_back') || titleLower.includes('lapsed') || typeLower === 'win_back') {
    return 'customer_reactivation';
  }

  if (titleLower.includes('slow') || titleLower.includes('hour') || titleLower.includes('afternoon')) {
    return 'slow_hours';
  }

  if (titleLower.includes('inventory') || titleLower.includes('surplus')) {
    return 'inventory_opportunity';
  }

  if (titleLower.includes('discount') || titleLower.includes('promotion')) {
    return 'promotion_opportunity';
  }

  // Default based on financial usefulness
  if (score.financialUsefulness > 20) {
    return 'positive_opportunity';
  } else if (score.financialUsefulness < -20) {
    return 'negative_recommendation';
  }

  return 'general_recommendation';
  }

  /**
   * Format diversity analysis for display
   */
  export function formatDiversityAnalysis(
    analysis: ReturnType<typeof analyzeRecommendationDiversity>
  ): string {
    const lines: string[] = [];

    lines.push(`Recommendation Diversity Score: ${analysis.diversityScore}/100`);
    lines.push('');

    for (const group of analysis.consolidatedGroups) {
      const actionWord = action => (action === 'consolidate' ? 'Consolidate' : 'Present as options');
      lines.push(`${actionWord(action.action)} ${group.rootSignal}:`);
      for (const rec of group.recommendations) {
        lines.push(`  • ${rec.title}`);
      }
      lines.push('');
    }

    lines.push(analysis.ownerPresentation);
    lines.push('');

    for (const rec of analysis.recommendations) {
      lines.push(`  ${rec}`);
    }

    return lines.join('\n');
  }
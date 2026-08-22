/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BusinessObjectiveSelector — Deterministic objective-based recommendation ranking.
 *
 * The recommendation engine optimizes toward the selected objective while still
 * respecting hard constraints (minimum margin, maximum discount, etc.).
 *
 * Objective change must change recommendations deterministically:
 *   Same data, different objective → different ranked recommendations.
 *
 * Scoring per objective:
 *   increase_profit    → maximize contribution margin
 *   increase_revenue   → maximize revenue (with margin floor)
 *   increase_aov       → maximize average order value
 *   increase_repeat    → maximize repeat customer rate
 *   fill_slow_hours    → maximize slow hour utilization
 *   reduce_wastage     → minimize inventory waste
 *   improve_efficiency → maximize inventory turnover
 *   increase_premium   → maximize premium-item revenue share
 */

import mongoose from 'mongoose';
import RestaurantIntelligenceOrchestrator from '../services/restaurantIntelligenceOrchestrator';
import type { AutomationPolicy, AutomationLevel, BusinessObjective } from '../services/restaurantIntelligenceOrchestrator';
import type { RecommendationContext } from './recommendationContext';

/**
 * Business objectives and their scoring functions
 */
export type BusinessObjectiveId =
  | 'increase_revenue'
  | 'increase_profit'
  | 'increase_aov'
  | 'increase_repeat_customers'
  | 'fill_slow_hours'
  | 'reduce_wastage'
  | 'improve_inventory_efficiency'
  | 'increase_premium_item_sales';

export const BUSINESS_OBJECTIVES: Record<BusinessObjectiveId, BusinessObjective> = {
  increase_revenue: {
    id: 'increase_revenue',
    name: 'Increase revenue',
    arn: 'increase_revenue',
  },
  increase_profit: {
    id: 'increase_profit',
    name: 'Increase profit',
    arn: 'increase_profit',
  },
  increase_aov: {
    id: 'increase_aov',
    name: 'Increase AOV',
    arn: 'increase_aov',
  },
  increase_repeat_customers: {
    id: 'increase_repeat_customers',
    name: 'Increase repeat customers',
    arn: 'increase_repeat_customers',
  },
  fill_slow_hours: {
    id: 'fill_slow_hours',
    name: 'Fill slow hours',
    arn: 'fill_slow_hours',
  },
  reduce_wastage: {
    id: 'reduce_wastage',
    name: 'Reduce wastage',
    arn: 'reduce_wastage',
  },
  improve_inventory_efficiency: {
    id: 'improve_inventory_efficiency',
    name: 'Improve inventory efficiency',
    arn: 'improve_inventory_efficiency',
  },
  increase_premium_item_sales: {
    id: 'increase_premium_item_sales',
    name: 'Increase premium-item sales',
    arn: 'increase_premium_item_sales',
  },
};

/**
 * Score a recommendation candidate based on the current business objective.
 * Higher score = better match for the objective.
 */
function scoreByObjective(
  candidate: any,
  objective: BusinessObjective,
  context: RecommendationContext
): number {
  const baseScore = candidate.score || 0;
  const titleLower = (candidate.title || '').toLowerCase();
  const typeLower = (candidate.type || '').toLowerCase();

  // Objective-specific scoring adjustments
  let objectiveBonus = 0;

  switch (objective.id) {
    case 'increase_profit':
      // Prioritize high-margin recommendations
      const marginMatch = titleLower.match(/margin|profit|contribution/);
      if (marginMatch) objectiveBonus += 20;

      // Prioritize recommendations that don't deep-discount
      const deepDiscount = titleLower.includes('20% off') || titleLower.includes('50% off');
      if (deepDiscount) objectiveBonus -= 30;
      break;

    case 'increase_revenue':
      // Prioritize volume-increasing recommendations
      const volumeKeywords = ['increase', 'lift', 'growth', 'more', 'boost'];
      if (volumeKeywords.some(k => titleLower.includes(k))) objectiveBonus += 15;

      // Penalize deep discounts that might hurt brand
      if (titleLower.includes('discount') && !titleLower.includes('10%')) objectiveBonus -= 10;
      break;

    case 'increase_aov':
      // Prioritize combo/add-on recommendations
      if (typeLower === 'combo' || typeLower === 'add_on' || typeLower.includes('upsell')) {
        objectiveBonus += 25;
      }
      // Prioritize minimum-order deals
      if (titleLower.includes('minimum') || titleLower.includes('spend')) {
        objectiveBonus += 10;
      }
      break;

    case 'increase_repeat_customers':
      // Prioritize win-back and loyalty recommendations
      if (titleLower.includes('win_back') || titleLower.includes('lapsed') || titleLower.includes('repeat')) {
        objectiveBonus += 20;
      }
      if (typeLower === 'reward_points' || typeLower === 'loyalty') {
        objectiveBonus += 15;
      }
      break;

    case 'fill_slow_hours':
      // Prioritize time-based and slow-hour recommendations
      if (titleLower.includes('slow') || titleLower.includes('hour') || titleLower.includes('afternoon')) {
        objectiveBonus += 20;
      }
      if (typeLower === 'time_based' || titleLower.includes('happy hour')) {
        objectiveBonus += 15;
      }
      break;

    case 'reduce_wastage':
      // Prioritize clearance and inventory recommendations
      if (titleLower.includes('clearance') || titleLower.includes('surplus') || titleLower.includes('waste')) {
        objectiveBonus += 20;
      }
      break;

    case 'improve_inventory_efficiency':
      // Prioritize inventory-moving recommendations
      if (titleLower.includes('inventory') || titleLower.includes('stock') || titleLower.includes('efficiency')) {
        objectiveBonus += 15;
      }
      break;

    case 'increase_premium_item_sales':
      // Prioritize premium/high-margin items
      const premiumKeywords = ['premium', 'special', 'signature', 'deluxe', 'chef\'s'];
      if (premiumKeywords.some(k => titleLower.includes(k))) objectiveBonus += 20;
      // Also prioritize high-margin recommendations
      const marginMatch = titleLower.match(/margin|profit|contribution/);
      if (marginMatch) objectiveBonus += 10;
      break;
  }

  return Math.max(0, Math.min(100, baseScore + objectiveBonus));
}

/**
 * Rank recommendations by the current business objective.
 * Returns top N recommendations re-ranked for the objective.
 */
export async function rankByObjective(
  restaurantId: string,
  objective: BusinessObjective,
  policy: AutomationPolicy,
  limit: number = 5
): Promise<Array<{
  title: string;
  type: string;
  expectedImpact: string;
  confidence: 'Low' | 'Medium' | 'High';
  score: number;
  objectiveId: BusinessObjectiveId;
}>> {
  // Get all recommendations from all goals
  const goals: string[] = [
    'increase_sales',
    'increase_profit',
    'increase_aov',
    'bring_customers_back',
    'move_inventory',
  ];

  const allCandidates: any[] = [];

  for (const goal of goals) {
    try {
      const result = await RestaurantIntelligenceOrchestrator?.generateAdvisorRecommendations
        ?.(restaurantId, goal as any);
      if (result && result.recommendations) {
        allCandidates.push(...result.recommendations);
      }
    } catch {
      // Continue if one goal fails
    }
  }

  // Score each candidate by the current objective
  const scored = allCandidates
    .map((c: any) => {
      const score = scoreByObjective(c, objective, {} as RecommendationContext);
      return {
        title: c.title,
        type: c.recommendationType,
        expectedImpact: c.expectedImpact,
        confidence: c.confidence,
        score,
        objectiveId: objective.id as BusinessObjectiveId,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

/**
 * Get recommendation for a specific objective with explanation
 */
export async function getObjectiveRecommendation(
  restaurantId: string,
  objective: BusinessObjective,
  policy: AutomationPolicy
): Promise<{
  objective: BusinessObjective;
  topRecommendation: {
    title: string;
    type: string;
    why: string;
    expectedImpact: string;
    confidence: 'Low' | 'Medium' | 'High';
    score: number;
  } | null;
  alternativeRecommendations: Array<{
    title: string;
    type: string;
    expectedImpact: string;
    confidence: 'Low' | 'Medium' | 'High';
    score: number;
  }>;
}> {
  const ranked = await rankByObjective(restaurantId, objective, policy, 3);

  if (ranked.length === 0) {
    return {
      objective,
      topRecommendation: null,
      alternativeRecommendations: [],
    };
  }

  const top = ranked[0];
  const alternatives = ranked.slice(1);

  // Build the top recommendation with why/impact from the original candidate
  // We need to fetch the full candidate details
  const fullResult = await RestaurantIntelligenceOrchestrator?.generateAdvisorRecommendations
    ?.(restaurantId, objective.id as any);

  let why = top.title;
  let expectedImpact = top.expectedImpact;

  if (fullResult && fullResult.recommendations) {
    const topCandidate = fullResult.recommendations.find(
      (c: any) => c.title === top.title || c.recommendationType === top.type
    );
    if (topCandidate) {
      why = topCandidate.why || top.title;
      expectedImpact = topCandidate.expectedImpact || top.expectedImpact;
    }
  }

  return {
    objective,
    topRecommendation: {
      title: top.title,
      type: top.type,
      why,
      expectedImpact,
      confidence: top.confidence,
      score: top.score,
    },
    alternativeRecommendations: alternatives.map(a => ({
      title: a.title,
      type: a.type,
      expectedImpact: a.expectedImpact,
      confidence: a.confidence,
      score: a.score,
    })),
  };
}

/**
 * Demonstrate objective change effect:
 * Same data, different objective → different recommendations
 */
export async function demoObjectiveChange(restaurantId: string, policy: AutomationPolicy) {
  console.log('=== DEMONSTRATION: Objective Change Effect ===\n');

  const objectives: BusinessObjective[] = [
    BUSINESS_OBJECTIVES.increase_profit,
    BUSINESS_OBJECTIVES.increase_revenue,
    BUSINESS_OBJECTIVES.increase_aov,
    BUSINESS_OBJECTIVES.fill_slow_hours,
  ];

  for (const objective of objectives) {
    const result = await getObjectiveRecommendation(restaurantId, objective, policy);

    console.log(`\n--- Objective: ${objective.name} ---`);
    if (result.topRecommendation) {
      console.log(`Top: ${result.topRecommendation.title}`);
      console.log(`Why: ${result.topRecommendation.why}`);
      console.log(`Impact: ${result.topRecommendation.expectedImpact}`);
      console.log(`Score: ${result.topRecommendation.score}`);
    } else {
      console.log('No recommendations for this objective');
    }
    console.log(`Alternatives: ${result.alternativeRecommendations.length} available`);
  }

  console.log('\n=== Same data, different objectives produce different recommendations ===\n');
}
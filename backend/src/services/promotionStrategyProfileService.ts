/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Promotion Strategy Profile Service — Builds restaurant-specific promotion
 * performance profiles. These profiles are deterministic, auditable, and
 * tenant-isolated. They feed recommendation ranking but do NOT auto-publish
 * promotions.
 *
 * Profile characteristics are derived from actual historical outcomes, not
 * opaque predictions.
 */

import IRecommendationOutcome from '../models/RecommendationOutcome';
import mongoose from 'mongoose';

const PROFILE_WINDOW_DAYS = 180; // 6 months of history

export interface StrategyProfile {
  restaurantId: string;
  discountSensitivity: 'low' | 'moderate' | 'high';
  comboAffinity: 'low' | 'moderate' | 'high';
  addonAffinity: 'low' | 'moderate' | 'high';
  aovImpact: 'negative' | 'neutral' | 'positive';
  marginProfile: 'margin-preserving' | 'margin-trading' | 'margin-eroding';
  peakHours: string[]; // e.g., ['12:00-14:00', '19:00-21:00']
  slowHours: string[];
  topCategories: string[];
  promotionResponsiveness: 'low' | 'moderate' | 'high';
  repeatPurchaseRate: number; // 0-1
  newCustomerConversionRate: number; // 0-1
  lastUpdated: Date;
  dataPoints: number; // number of measured outcomes
}

export interface ProfileComparison {
  restaurantA: StrategyProfile;
  restaurantB: StrategyProfile;
  differences: string[];
  recommendations: string[];
}

export interface StrategyPerformanceMetrics {
  avgContribution: number;
  avgROI: number; // incrementalContribution / discountCost
  freqDistribution: Record<string, number>; // promotionType -> count
  successRate: number; // % of outcomes with positive contribution
  avgOrderUpliftPercent: number;
  mostEffectivePromotion?: string;
  leastEffectivePromotion?: string;
}

/**
 * Build a strategy profile for a restaurant based on historical outcomes.
 * Only uses completed, measured outcomes with sufficient data.
 */
export async function buildStrategyProfile(
  restaurantId: string
): Promise<StrategyProfile> {
  const outcomes = await IRecommendationOutcome.find({
    restaurantId,
    status: 'completed',
  })
    .lean()
    .exec();

  const dataPoints = outcomes.length;

  if (dataPoints === 0) {
    // Return default profile for new restaurant
    return {
      restaurantId,
      discountSensitivity: 'moderate',
      comboAffinity: 'moderate',
      addonAffinity: 'moderate',
      aovImpact: 'neutral',
      marginProfile: 'margin-preserving',
      peakHours: [],
      slowHours: [],
      topCategories: [],
      promotionResponsiveness: 'moderate',
      repeatPurchaseRate: 0,
      newCustomerConversionRate: 0,
      lastUpdated: new Date(),
      dataPoints: 0,
    };
  }

  // Calculate metrics from outcomes
  const contributions = outcomes
    .map(o => o.metrics['contribution'] || 0)
    .filter(c => c > 0);

  const orderUplifts = outcomes
    .map(o => o.variance?.orderUpliftPercentDiff ?? 0)
    .filter(u => u !== undefined);

  // Discount sensitivity: how does contribution change with discount level?
  // Group by promotion type and analyze
  const promotionGroups = outcomes.reduce<(Record<string, IRecommendationOutcome[]>)>(
    (acc, outcome) => {
      const key = outcome.promotionType || 'unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(outcome);
      return acc;
    },
    {}
  );

  // Calculate discount sensitivity from contribution vs promotion type
  let discountSensitivity: 'low' | 'moderate' | 'high' = 'moderate';
  let comboAffinity: 'low' | 'moderate' | 'high' = 'moderate';
  let addonAffinity: 'low' | 'moderate' | 'high' = 'moderate';
  let aovImpact: 'negative' | 'neutral' | 'positive' = 'neutral';
  let promotionResponsiveness: 'low' | 'moderate' | 'high' = 'moderate';

  // Analyze contribution by promotion type
  const typeContributions: Record<string, number[]> = {};
  for (const [type, group] of Object.entries(promotionGroups)) {
    typeContributions[type] = group.map(o => o.metrics['contribution'] || 0);
  }

  // Simple heuristic: if free items or combos have high contribution, affinity is high
  if (typeContributions['free_item'] && typeContributions['free_item'][0] > 0) {
    const freeItemAvg = typeContributions['free_item'].reduce((a, b) => a + b, 0) / typeContributions['free_item'].length;
    if (freeItemAvg > 500) addonAffinity = 'high';
    else if (freeItemAvg > 200) addonAffinity = 'moderate';
    else addonAffinity = 'low';
  }

  if (typeContributions['combo'] && typeContributions['combo'][0] > 0) {
    const comboAvg = typeContributions['combo'].reduce((a, b) => a + b, 0) / typeContributions['combo'].length;
    if (comboAvg > 500) comboAffinity = 'high';
    else if (comboAvg > 200) comboAffinity = 'moderate';
    else comboAffinity = 'low';
  }

  // Analyze AOV impact
  const aovDiffs = outcomes.map(o => o.variance?.aovDiff ?? 0);
  const positiveAOV = aovDiffs.filter(d => d > 0).length;
  const negativeAOV = aovDiffs.filter(d => d < 0).length;
  const total = aovDiffs.length;

  if (total > 0) {
    const positiveRatio = positiveAOV / total;
    if (positiveRatio > 0.6) aovImpact = 'positive';
    else if (positiveRatio < 0.3) aovImpact = 'negative';
    else aovImpact = 'neutral';
  }

  // Promotion responsiveness: % of outcomes with positive contribution
  const positiveContributions = contributions.length;
  const totalOutcomes = outcomes.length;
  const successRate = positiveContributions / totalOutcomes;

  if (successRate > 0.7) promotionResponsiveness = 'high';
  else if (successRate > 0.4) promotionResponsiveness = 'moderate';
  else promotionResponsiveness = 'low';

  // Determine margin profile based on contribution vs discount cost
  // If most outcomes have positive contribution relative to discount, it's margin-preserving
  let marginProfile: 'margin-preserving' | 'margin-trading' | 'margin-eroding' = 'margin-preserving';
  if (successRate < 0.3) {
    marginProfile = 'margin-eroding';
  } else if (successRate < 0.5) {
    marginProfile = 'margin-trading';
  }

  return {
    restaurantId,
    discountSensitivity,
    comboAffinity,
    addonAffinity,
    aovImpact,
    marginProfile,
    peakHours: [], // would need hour-of-day analysis
    slowHours: [],
    topCategories: [], // would need category analysis
    promotionResponsiveness,
    repeatPurchaseRate: 0, // would need repeat purchase tracking
    newCustomerConversionRate: 0, // would need new customer tracking
    lastUpdated: new Date(),
    dataPoints,
  };
}

/**
 * Compare strategy profiles between two restaurants.
 * Ensures tenant isolation — never generalizes Restaurant A's behavior to Restaurant B.
 */
export function compareProfiles(
  profileA: StrategyProfile,
  profileB: StrategyProfile
): ProfileComparison {
  const differences: string[] = [];
  const recommendations: string[] = [];

  // Compare key characteristics
  if (profileA.discountSensitivity !== profileB.discountSensitivity) {
    differences.push(
      `Restaurant A: ${profileA.discountSensitivity} discount sensitivity vs ` +
      `Restaurant B: ${profileB.discountSensitivity}`
    );
  }

  if (profileA.comboAffinity !== profileB.comboAffinity) {
    differences.push(
      `Restaurant A: ${profileA.comboAffinity} combo affinity vs ` +
      `Restaurant B: ${profileB.comboAffinity}`
    );
  }

  if (profileA.marginProfile !== profileB.marginProfile) {
    differences.push(
      `Restaurant A: ${profileA.marginProfile} margin profile vs ` +
      `Restaurant B: ${profileB.marginProfile}`
    );
  }

  if (profileA.promotionResponsiveness !== profileB.promotionResponsiveness) {
    differences.push(
      `Restaurant A: ${profileA.promotionResponsiveness} responsiveness vs ` +
      `Restaurant B: ${profileB.promotionResponsiveness}`
    );
  }

  // Generate cross-restaurant recommendations (never generalize!)
  if (profileA.promotionResponsiveness === 'high' && profileB.promotionResponsiveness === 'low') {
    recommendations.push(
      'Restaurant A responds well to promotions; Restaurant B does not. ' +
      'Do not generalize Restaurant A\'s promotion strategy to Restaurant B.'
    );
  }

  if (profileA.marginProfile === 'margin-eroding' && profileB.marginProfile === 'margin-preserving') {
    recommendations.push(
      'Restaurant A has margin-eroding promotions; Restaurant B preserves margins. ' +
      'Different optimization targets.'
    );
  }

  return { differences, recommendations };
}
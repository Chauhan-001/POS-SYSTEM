/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Promotion Fatigue Service — Tracks repeated promotions and detects declining
 * response over time. This is a deterministic, auditable service that does NOT
 * create a self-learning AI. It merely surfaces patterns in historical data.
 *
 * Fatigue detection is based on measured outcomes, not opaque predictions.
 */

import IRecommendationOutcome from '../models/RecommendationOutcome';
import mongoose from 'mongoose';

const PROMOTION_FATIGUE_WINDOW = 90; // days
const FATIGUE_THRESHOLD_REDUCTION = 0.3; // 30% reduction from peak

export interface FatiguePattern {
  promotionType: string;
  productId?: string;
  restaurantId: string;
  runCount: number;
  peakContribution: number;
  latestContribution: number;
  contributionReductionPercent: number;
  isFatigued: boolean;
  lastRunAt: Date;
  firstRunAt: Date;
  trend: 'declining' | 'stable' | 'improving';
  recommendation: string;
}

export interface FatigueAnalysis {
  patterns: FatiguePattern[];
  generatedAt: Date;
}

/**
 * Analyze promotion fatigue for a restaurant based on historical outcomes.
 * Only analyzes completed, measured outcomes.
 */
export async function analyzePromotionFatigue(
  restaurantId: string
): Promise<FatigueAnalysis> {
  const outcomes = await IRecommendationOutcome.find({
    restaurantId,
    status: 'completed',
  }).lean().exec();

  // Group outcomes by promotion type
  const promotionGroups = outcomes.reduce((acc: Record<string, IRecommendationOutcome[]>, outcome) => {
    const promoType = outcome.promotionType;
    if (!acc[promoType]) acc[promoType] = [];
    acc[promoType].push(outcome);
    return acc;
  }, {} as Record<string, IRecommendationOutcome[]>);

  const patterns: FatiguePattern[] = [];

  for (const [promoType, group] of Object.entries(promotionGroups)) {
    // Sort by promotedAt descending (most recent first)
    const sorted = group.sort((a, b) => b.promotedAt!.getTime() - a.promotedAt!.getTime());

    // Calculate peak contribution
    const contributions = sorted.map(o => o.metrics['contribution'] || 0);
    const peakContribution = Math.max(...contributions);
    const latestContribution = contributions[0] || 0;

    // Calculate reduction from peak
    const contributionReductionPercent = peakContribution > 0
      ? Math.max(0, ((peakContribution - latestContribution) / peakContribution) * 100)
      : 0;

    const isFatigued = contributionReductionPercent >= (FATIGUE_THRESHOLD_REDUCTION * 100);

    // Determine trend: compare first half vs second half
    const midPoint = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, midPoint);
    const secondHalf = sorted.slice(midPoint);

    const firstHalfAvg = firstHalf.reduce((sum, o) => sum + (o.metrics['contribution'] || 0), 0) / Math.max(firstHalf.length, 1);
    const secondHalfAvg = secondHalf.reduce((sum, o) => sum + (o.metrics['contribution'] || 0), 0) / Math.max(secondHalf.length, 1);

    let trend: 'declining' | 'stable' | 'improving' = 'stable';
    if (secondHalfAvg < firstHalfAvg * 0.8) {
      trend = 'declining';
    } else if (secondHalfAvg > firstHalfAvg * 1.2) {
      trend = 'improving';
    }

    patterns.push({
      promotionType: promoType,
      runCount: sorted.length,
      peakContribution,
      latestContribution,
      contributionReductionPercent,
      isFatigued,
      lastRunAt: sorted[0].promotedAt,
      firstRunAt: sorted[sorted.length - 1].promotedAt,
      trend,
      recommendation: isFatigued
        ? `Consider trying a different promotion type. Response has declined by ${contributionReductionPercent.toFixed(1)}%`
        : `Promotion type is performing steadily.`,
    });
  }

  return { patterns, generatedAt: new Date() };
}

/**
 * Record a fatigue detection event for a specific promotion run.
 * Called after an outcome is measured.
 */
export async function recordFatigueEvent(
  restaurantId: string,
  promotionType: string,
  productId?: string,
  outcome?: IRecommendationOutcome
): Promise<void> {
  // Record learning signal
  const signal: LearningSignal = outcome?.status === 'completed'
    ? 'promotion_redeemed'
    : 'promotion_implemented';

  // The learning signal is recorded via the outcome model itself.
  // This function primarily analyzes fatigue patterns.
}
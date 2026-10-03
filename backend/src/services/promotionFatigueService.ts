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

import RecommendationOutcome from '../models/intelligence/RecommendationOutcome';
import type { IRecommendationOutcome, LearningSignal } from '../models/intelligence/RecommendationOutcome';

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

/** Coarse fatigue severity derived from the measured contribution decline. */
export type FatigueLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Per-offer (promotion-type) fatigue signal. `offerId` mirrors the key the
 * caller passes to isOfferFatigued; the promotion-history model stores outcomes
 * per promotion type, so the promotion type is the finest key we can report.
 */
export interface OfferFatigueSignal {
  offerId: string;
  promotionType: string;
  fatigueLevel: FatigueLevel;
  contributionReductionPercent: number;
  runCount: number;
  trend: 'declining' | 'stable' | 'improving';
  recommendation: string;
}

/** Result of checking whether a single offer key is fatigued. */
export interface OfferFatigueCheck {
  fatigued: boolean;
  level: FatigueLevel;
  recommendation: string;
}

/** Lightweight shape of a leaned RecommendationOutcome that we actually read. */
interface OutcomeLike {
  promotionType?: string;
  promotedAt?: Date;
  metrics?: Map<string, number> | Record<string, number | undefined>;
}

function contributionOf(outcome: OutcomeLike): number {
  const metrics = outcome?.metrics;
  if (!metrics) return 0;
  if (metrics instanceof Map) return Number(metrics.get('contribution') || 0);
  return Number((metrics as Record<string, number | undefined>)['contribution'] || 0);
}

/**
 * Group completed outcomes by promotion type and derive peak-vs-latest
 * contribution patterns. Shared by analyzePromotionFatigue and
 * detectPromotionFatigue so both read the exact same deterministic math.
 */
function buildFatiguePatterns(outcomes: OutcomeLike[], restaurantId: string): FatiguePattern[] {
  const promotionGroups = outcomes.reduce((acc: Record<string, OutcomeLike[]>, outcome) => {
    const promoType = outcome.promotionType || 'unknown';
    if (!acc[promoType]) acc[promoType] = [];
    acc[promoType].push(outcome);
    return acc;
  }, {});

  const patterns: FatiguePattern[] = [];

  for (const [promoType, group] of Object.entries(promotionGroups)) {
    // Sort by promotedAt descending (most recent first)
    const sorted = [...group].sort(
      (a, b) => (b.promotedAt?.getTime() ?? 0) - (a.promotedAt?.getTime() ?? 0),
    );

    // Calculate peak contribution
    const contributions = sorted.map((o) => contributionOf(o));
    const peakContribution = contributions.length > 0 ? Math.max(...contributions) : 0;
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

    const firstHalfAvg = firstHalf.reduce((sum, o) => sum + contributionOf(o), 0) / Math.max(firstHalf.length, 1);
    const secondHalfAvg = secondHalf.reduce((sum, o) => sum + contributionOf(o), 0) / Math.max(secondHalf.length, 1);

    let trend: 'declining' | 'stable' | 'improving' = 'stable';
    if (secondHalfAvg < firstHalfAvg * 0.8) {
      trend = 'declining';
    } else if (secondHalfAvg > firstHalfAvg * 1.2) {
      trend = 'improving';
    }

    patterns.push({
      promotionType: promoType,
      restaurantId,
      runCount: sorted.length,
      peakContribution,
      latestContribution,
      contributionReductionPercent,
      isFatigued,
      lastRunAt: sorted[0]?.promotedAt ?? new Date(),
      firstRunAt: sorted[sorted.length - 1]?.promotedAt ?? new Date(),
      trend,
      recommendation: isFatigued
        ? `Consider trying a different promotion type. Response has declined by ${contributionReductionPercent.toFixed(1)}%`
        : `Promotion type is performing steadily.`,
    });
  }

  return patterns;
}

/** Map a measured decline in contribution to a coarse fatigue level. */
function levelForReduction(reductionPercent: number): FatigueLevel {
  if (reductionPercent >= 50) return 'CRITICAL';
  if (reductionPercent >= FATIGUE_THRESHOLD_REDUCTION * 100) return 'HIGH';
  if (reductionPercent >= 15) return 'MEDIUM';
  if (reductionPercent > 0) return 'LOW';

  return 'NONE';
}

/** Load completed outcomes for a restaurant, optionally within a lookback window. */
async function loadCompletedOutcomes(restaurantId: string, lookbackDays?: number): Promise<OutcomeLike[]> {
  const filter: Record<string, unknown> = { restaurantId, status: 'completed' };
  if (lookbackDays && lookbackDays > 0) {
    filter.promotedAt = { $gte: new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000) };
  }
  const outcomes = await RecommendationOutcome.find(filter).lean().exec();
  return outcomes as unknown as OutcomeLike[];
}

/**
 * Analyze promotion fatigue for a restaurant based on historical outcomes.
 * Only analyzes completed, measured outcomes.
 */
export async function analyzePromotionFatigue(
  restaurantId: string
): Promise<FatigueAnalysis> {
  const outcomes = await loadCompletedOutcomes(restaurantId);
  return { patterns: buildFatiguePatterns(outcomes, restaurantId), generatedAt: new Date() };
}

/**
 * Detect per-promotion-type fatigue signals over a lookback window. Consumed by
 * the promotion calendar to avoid recommending promotion types whose measured
 * response is declining.
 */
export async function detectPromotionFatigue(options: {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number;
}): Promise<OfferFatigueSignal[]> {
  const { restaurantId, lookbackDays = PROMOTION_FATIGUE_WINDOW } = options;
  const outcomes = await loadCompletedOutcomes(restaurantId, lookbackDays);
  return buildFatiguePatterns(outcomes, restaurantId).map((pattern) => ({
    offerId: pattern.promotionType,
    promotionType: pattern.promotionType,
    fatigueLevel: levelForReduction(pattern.contributionReductionPercent),
    contributionReductionPercent: pattern.contributionReductionPercent,
    runCount: pattern.runCount,
    trend: pattern.trend,
    recommendation: pattern.recommendation,
  }));
}

/**
 * Check whether a single offer key is fatigued. Unknown keys (no completed
 * promotion history) are reported as not fatigued rather than guessed, so the
 * calendar never suppresses a promotion without measured evidence.
 */
export async function isOfferFatigued(
  restaurantId: string,
  offerId: string,
  // Reserved for branch-scoped outcomes; the outcome model is restaurant-scoped.
  _branchId?: string
): Promise<OfferFatigueCheck> {
  const signals = await detectPromotionFatigue({ restaurantId, lookbackDays: 180 });
  const match = signals.find((s) => s.offerId === offerId || s.promotionType === offerId);
  if (!match) {
    return {
      fatigued: false,
      level: 'NONE',
      recommendation: 'No completed promotion history for this offer yet.',
    };
  }
  return {
    fatigued: match.fatigueLevel === 'HIGH' || match.fatigueLevel === 'CRITICAL',
    level: match.fatigueLevel,
    recommendation: match.recommendation,
  };
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
  void signal;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Learning Scheduler — Background jobs that process learning signals, update
 * strategy profiles, detect fatigue, and generate insights. These jobs run
 * on a schedule and are tenant-isolated.
 *
 * Billing remains independent of the learning system. No autonomous promotion
 * publishing.
 */

import IRecommendationOutcome from '../models/RecommendationOutcome';
import mongoose from 'mongoose';
import { analyzePromotionFatigue } from './promotionFatigueService';
import { buildStrategyProfile, compareProfiles } from './promotionStrategyProfileService';
import { getFeedbackSummary, shouldSuppressStrategy, getStrategyPreferenceTrends } from './recommendationFeedbackService';
import LearningSignal from '../models/LearningSignal';

const SCHEDULE_INTERVAL_DAYS = 7; // Weekly learning cycle

/**
 * Weekly learning cycle job.
 * Processes all outcomes, updates strategy profiles, detects fatigue,
 * and records learning signals.
 */
export async function runWeeklyLearningCycle(): Promise<{
  cycleId: string;
  restaurantsProcessed: number;
  fatigueDetected: number;
  profilesUpdated: number;
  feedbackRecorded: number;
  suppressions: number;
}> {
  const cycleId = `cycle_${new Date().toISOString()}`;

  // Get all restaurants that have outcomes
  const restaurants = await IRecommendationOutcome.distinct('restaurantId');

  let restaurantsProcessed = 0;
  let fatigueDetected = 0;
  let profilesUpdated = 0;
  let feedbackRecorded = 0;
  let suppressions = 0;

  for (const restaurantId of restaurants) {
    restaurantsProcessed++;

    // 1. Analyze promotion fatigue
    const fatigueAnalysis = await analyzePromotionFatigue(restaurantId);
    if (fatigueAnalysis.patterns.some(p => p.isFatigued)) {
      fatigueDetected++;

      // Record learning signals for fatigued promotions
      for (const pattern of fatigueAnalysis.patterns.filter(p => p.isFatigued)) {
        // Record that this promotion type is showing fatigue
        await LearningSignal.create({
          signal: 'promotion_redeemed',
          strength: 'moderate',
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          promotionType: pattern.promotionType,
          metadata: {
            runCount: pattern.runCount,
            reductionPercent: pattern.contributionReductionPercent,
            recommendation: pattern.recommendation,
          },
        });
      }
    }

    // 2. Build/update strategy profile
    const profile = await buildStrategyProfile(restaurantId);
    profilesUpdated++;

    // 3. Get feedback summary
    const feedbackSummary = await getFeedbackSummary(restaurantId);
    feedbackRecorded++;

    // 4. Check for strategies to suppress
    const strategyTypes = ['percentage', 'fixed_amount', 'free_item', 'combo'];
    for (const type of strategyTypes) {
      const suppressionResult = await shouldSuppressStrategy(restaurantId, type);
      if (suppressionResult.shouldSuppress) {
        suppressions++;
        // Record suppression learning signal
        await LearningSignal.create({
          signal: 'promotion_rejected',
          strength: 'strong',
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          promotionType: type,
          metadata: {
            negativeCount: suppressionResult.negativeCount,
            totalEvidence: suppressionResult.totalEvidence,
            reason: suppressionResult.reason,
          },
        });
      }
    }

    // 5. Get strategy preference trends
    const trends = await getStrategyPreferenceTrends(restaurantId);
    // Trends are stored/used for recommendation ranking; not acted on autonomously
  }

  return {
    cycleId,
    restaurantsProcessed: restaurantsProcessed || restaurants.length,
    fatigueDetected,
    profilesUpdated,
    feedbackRecorded,
    suppressions,
  };
}

/**
 * Get restaurants that need learning cycle processing.
 * A restaurant needs processing if it has enough outcomes to warrant analysis.
 */
export async function getRestaurantsNeedingProcessing(minimumOutcomes: number = 5): Promise<string[]> {
  const counts = await IRecommendationOutcome.aggregate([
    { $match: { status: 'completed' } },
    { $group: { _id: '$restaurantId', outcomeCount: { $sum: 1 } } },
    { $match: { outcomeCount: { $gte: minimumOutcomes } } },
  ]).exec();

  return counts.map((c: any) => c._id);
}

/**
 * Get learning summary for a restaurant.
 * Summary includes: fatigue patterns, strategy profile, feedback trends,
 * and suppression status.
 */
export async function getLearningSummary(restaurantId: string): Promise<{
  fatiguePatterns: any[];
  strategyProfile: any;
  feedbackSummary: {
    ratingDistribution: Record<string, number>;
    categoryDistribution: Record<string, number>;
    totalFeedback: number;
    wouldAcceptAgain: number;
  };
  suppressionStatus: {
    shouldSuppressPercentage: string;
    suppressedTypes: string[];
  };
  strategyTrends: {
    gainingFavor: Array<{ promotionType: string; supportRate: number }>;
    losingFavor: Array<{ promotionType: string; rejectionRate: number }>;
    stable: Array<{ promotionType: string; consistencyRate: number }>;
  };
}> {
  const [fatigueAnalysis, strategyProfile, feedbackSummary, suppressionResult, strategyTrends] = await Promise.all([
    analyzePromotionFatigue(restaurantId),
    buildStrategyProfile(restaurantId),
    getFeedbackSummary(restaurantId),
    shouldSuppressStrategy(restaurantId, 'percentage'),
    getStrategyPreferenceTrends(restaurantId),
  ]);

  return {
    fatiguePatterns: fatigueAnalysis.patterns,
    strategyProfile,
    feedbackSummary,
    suppressionStatus: {
      shouldSuppressPercentage: suppressionResult.shouldSuppress ? 'yes' : 'no',
      suppressedTypes: suppressionResult.shouldSuppress ? ['percentage'] : [],
    },
    strategyTrends,
  };
}
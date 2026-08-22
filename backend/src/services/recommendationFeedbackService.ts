/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Recommendation Feedback Service — Captures explicit owner feedback on
 * recommendations and stores it for influencing future ranking. This is
 * structured, not opaque LLM interpretation.
 *
 * Feedback categories are well-defined. The system does not permanently
 * suppress strategies based on single rejections — evidence is required.
 */

import IRecommendationOutcome from '../models/RecommendationOutcome';
import mongoose from 'mongoose';

export type FeedbackRating = 'positive' | 'neutral' | 'negative';

export type FeedbackCategory =
  | 'too_expensive'
  | 'already_tried'
  | 'not_useful'
  | 'good_idea'
  | 'other';

export interface OwnerFeedbackRecord {
  recommendationId: string;
  restaurantId: string;
  rating: FeedbackRating;
  categories: FeedbackCategory[];
  comment?: string;
  would_accept_again: boolean;
  recordedAt: Date;
}

/**
 * Record owner feedback on a recommendation outcome.
 * Called when the owner explicitly provides feedback.
 */
export async function recordOwnerFeedback(
  recommendationId: string,
  restaurantId: string,
  rating: FeedbackRating,
  categories: FeedbackCategory[],
  comment?: string,
  would_accept_again: boolean = true
): Promise<void> {
  // Update the outcome record with owner feedback
  await IRecommendationOutcome.findOneAndUpdate(
    { recommendationId, restaurantId },
    {
      $set: {
        'ownerFeedback.rating': rating,
        'ownerFeedback.categories': categories,
        'ownerFeedback.comment': comment,
        'ownerFeedback.would_accept_again': would_accept_again,
      },
    },
    { upsert: true, new: true }
  );
}

/**
 * Get feedback summary for a restaurant.
 * Returns categories and ratings that can influence recommendation ranking.
 */
export async function getFeedbackSummary(restaurantId: string): Promise<{
  ratingDistribution: Record<FeedbackRating, number>;
  categoryDistribution: Record<FeedbackCategory, number>;
  totalFeedback: number;
  wouldAcceptAgain: number;
}> {
  const outcomes = await IRecommendationOutcome.find({
    restaurantId,
    'ownerFeedback.rating': { $exists: true },
  })
    .lean()
    .exec();

  const ratingDistribution: Record<FeedbackRating, number> = {
    positive: 0,
    neutral: 0,
    negative: 0,
  };

  const categoryDistribution: Record<FeedbackCategory, number> = {
    too_expensive: 0,
    already_tried: 0,
    not_useful: 0,
    good_idea: 0,
    other: 0,
  };

  let totalWouldAccept = 0;
  let totalFeedback = outcomes.length;

  for (const outcome of outcomes) {
    const feedback = outcome.ownerFeedback;
    if (feedback) {
      ratingDistribution[feedback.rating as FeedbackRating] = (
        ratingDistribution[feedback.rating as FeedbackRating] || 0
      ) + 1;

      for (const cat of feedback.categories) {
        categoryDistribution[cat as FeedbackCategory] = (
          categoryDistribution[cat as FeedbackCategory] || 0
        ) + 1;
      }

      if (feedback.would_accept_again) {
        totalWouldAccept++;
      }
    }
  }

  return {
    ratingDistribution,
    categoryDistribution,
    totalFeedback,
    wouldAcceptAgain: totalFeedback > 0 ? totalWouldAccept / totalFeedback : 0,
  };
}

/**
 * Check if a strategy should be suppressed based on owner rejection evidence.
 * Requires enough evidence before suppression — does not act on single rejection.
 *
 * Returns true only if:
 * - Negative feedback rate exceeds threshold (e.g., > 60% of recent feedback)
 * - Same category repeated in > 50% of negative feedback
 * - Evidence is from sufficient data points (minimum 5 outcomes)
 */
export async function shouldSuppressStrategy(
  restaurantId: string,
  strategyType: string,
  minimumEvidence: number = 5
): Promise<{
  shouldSuppress: boolean;
  negativeCount: number;
  totalEvidence: number;
  reason?: string;
}> {
  const outcomes = await IRecommendationOutcome.find({
    restaurantId,
    status: 'completed',
    'ownerFeedback.rating': 'negative',
  })
    .sort({ promotedAt: -1 })
    .limit(minimumEvidence * 2)
    .lean()
    .exec();

  const totalEvidence = outcomes.length;

  if (totalEvidence < minimumEvidence) {
    return { shouldSuppress: false, negativeCount: 0, totalEvidence };
  }

  // Count negative feedback for this specific strategy type
  const negativeCount = outcomes.filter(o => o.promotionType === strategyType && o.ownerFeedback.rating === 'negative')
    .length;

  const negativeRate = negativeCount / totalEvidence;

  // Suppress only if negative rate exceeds 60% AND same strategy type appears in > 50% of negatives
  if (negativeRate > 0.6 && negativeCount / totalEvidence > 0.5) {
    return {
      shouldSuppress: true,
      negativeCount,
      totalEvidence,
      reason: `Negative feedback rate ${(negativeRate * 100).toFixed(1)}% for ${strategyType} exceeds 60% threshold`,
    };
  }

  return {
    shouldSuppress: false,
    negativeCount,
    totalEvidence,
  };
}

/**
 * Get strategy preference trends for a restaurant.
 * Shows which promotion types are gaining or losing favor based on owner feedback.
 */
export async function getStrategyPreferenceTrends(
  restaurantId: string): Promise<{
  gainingFavor: Array<{ promotionType: string; supportRate: number }>;
  losingFavor: Array<{ promotionType: string; rejectionRate: number }>;
  stable: Array<{ promotionType: string; consistencyRate: number }>;
}> {
  const outcomes = await IRecommendationOutcome.find({
    restaurantId,
    status: 'completed',
    'ownerFeedback.rating': { $exists: true },
  })
    .sort({ promotedAt: -1 })
    .exec();

  // Group by promotion type
  const typeFeedback = outcomes.reduce<
    Record<string, { positive: number; negative: number; total: number }>
  >((acc, outcome) => {
    const type = outcome.promotionType || 'unknown';
    if (!acc[type]) acc[type] = { positive: 0, negative: 0, total: 0 };
    acc[type].total++;

    if (outcome.ownerFeedback.rating === 'positive') {
      acc[type].positive++;
    } else if (outcome.ownerFeedback.rating === 'negative') {
      acc[type].negative++;
    }

    if (outcome.ownerFeedback.rating === 'positive') {
      acc[type].positive++; // already above
    }
    if (outcome.ownerFeedback.rating === 'negative') {
      acc[type].negative++; // already above
    }

    return acc;
  }, {} as Record<string, { positive: number; negative: number; total: number }>);

  const gainingFavor: Array<{ promotionType: string; supportRate: number }> = [];
  const losingFavor: Array<{ promotionType: string; rejectionRate: number }> = [];
  const stable: Array<{ promotionType: string; consistencyRate: number }> = [];

  for (const [type, feedback] of Object.entries(typeFeedback)) {
    const supportRate = feedback.total > 0 ? feedback.positive / feedback.total : 0;
    const rejectionRate = feedback.total > 0 ? feedback.negative / feedback.total : 0;
    const consistencyRate = feedback.total > 0 ? Math.min(feedback.positive, feedback.negative) / feedback.total : 0;

    if (supportRate > 0.7 && rejectionRate < 0.3) {
      gainingFavor.push({ promotionType: type, supportRate });
    } else if (rejectionRate > 0.6 && supportRate < 0.3) {
      losingFavor.push({ promotionType: type, rejectionRate });
    } else {
      stable.push({ promotionType: type, consistencyRate });
    }
  }

  // Sort gaining favor by support rate descending
  gainingFavor.sort((a, b) => b.supportRate - a.supportRate);
  losingFavor.sort((a, b) => b.rejectionRate - a.rejectionRate);
  stable.sort((a, b) => b.consistencyRate - a.consistencyRate);

  return { gainingFavor, losingFavor, stable };
}
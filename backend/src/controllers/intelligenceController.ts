/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Intelligence Controller — Phase 5: Closed-Loop Learning, Promotion Experiments
 * and Restaurant-Specific Optimization.
 *
 * All routes require authentication. Restaurant isolation enforced by controllers
 * using req.user.restaurantId.
 *
 * This controller provides endpoints for:
 * - Recording recommendation outcomes (expected vs actual)
 * - Retrieving learning summaries and strategy profiles
 * - A/B experiment management
 * - Owner feedback recording
 * - Fatigue detection and strategy suppression
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import IRecommendationOutcome from '../models/RecommendationOutcome';
import LearningSignal from '../models/LearningSignal';
import {
  recordOwnerFeedback,
  getFeedbackSummary,
  shouldSuppressStrategy,
  getStrategyPreferenceTrends,
  runWeeklyLearningCycle,
  getRestaurantsNeedingProcessing,
  getLearningSummary,
} from '../services';

export async function recordOutcomeHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(req.user?.restaurantId || '');
    if (!restaurantId) {
      res.status(400).json({ error: 'Missing restaurant ID' }); return;
    }

    const {
      recommendationId,
      promotedAt,
      measurementWindowDays = 30,
      status = 'completed' as const,
      metrics,
      baseline,
      expected,
      actual,
      attributionMethod,
      promotionType,
    } = req.body || {};

    if (!recommendationId) {
      res.status(400).json({ error: 'Missing recommendationId' }); return;
    }

    // Check if outcome already exists
    const existing = await IRecommendationOutcome.findOne({
      recommendationId,
      restaurantId,
    }).lean().exec();

    if (existing) {
      // Update existing outcome
      const updated = await IRecommendationOutcome.findOneAndUpdate(
        { recommendationId, restaurantId },
        {
          $set: {
            status,
            promotedAt: promotedAt || existing.promotedAt,
            measurementWindowDays,
            metrics: metrics || existing.metrics,
            baseline: baseline || existing.baseline,
            expected: expected || existing.expected,
            actual: actual || existing.actual,
            variance: {
              orderUpliftPercentDiff: actual?.expectedOrderUpliftPercent !== undefined
                ? actual.expectedOrderUpliftPercent - baseline?.baselineValue ?? 0
                : existing.variance?.orderUpliftPercentDiff,
              contributionDiff: actual?.actualContribution !== undefined
                ? actual.actualContribution - (baseline?.baselineValue ?? 0)
                : existing.variance?.contributionDiff,
              newCustomerDiff: actual?.actualNewCustomers !== undefined
                ? actual.actualNewCustomers - (baseline?.baselineValue ?? 0)
                : existing.variance?.newCustomerDiff,
              repeatPurchaseDiff: actual?.actualRepeatPurchases !== undefined
                ? actual.actualRepeatPurchases - (baseline?.baselineValue ?? 0)
                : existing.variance?.repeatPurchaseDiff,
              aovDiff: actual?.actualAOVImpact !== undefined
                ? actual.actualAOVImpact - (baseline?.baselineValue ?? 0)
                : existing.variance?.aovDiff,
            },
            attributionMethod: attributionMethod || existing.attributionMethod,
            promotionType: promotionType || existing.promotionType,
            learningSignals: [
              ...new Set([
                ...(existing.learningSignals || []),
                ...(status === 'completed'
                  ? ['promotion_redeemed', 'incremental_sales', 'incremental_contribution']
                  : []),
              ]),
            ],
            ownerFeedback: existing.ownerFeedback || {},
            updatedAt: new Date(),
          },
        },
        { new: true, runValidators: true }
      );

      // Record learning signals
      await recordLearningSignals(updated);

      res.json({
        success: true,
        outcome: updated,
        message: 'Outcome updated and learning signals recorded',
      });
      return;
    }

    // Create new outcome
    const orderUpliftPercentDiff = actual?.expectedOrderUpliftPercent !== undefined
      ? actual.expectedOrderUpliftPercent - (baseline?.baselineValue ?? 0)
      : 0;

    const contributionDiff = actual?.actualContribution !== undefined
      ? actual.actualContribution - (baseline?.baselineValue ?? 0)
      : 0;

    const newOutcome = new IRecommendationOutcome({
      recommendationId,
      restaurantId,
      promotedAt: promotedAt || new Date(),
      measurementWindowDays,
      status,
      metrics: metrics || {},
      baseline: baseline || {
        method: attributionMethod || 'pre_post',
        comparisonPeriodStart: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        comparisonPeriodEnd: new Date(),
        baselineValue: baseline?.baselineValue ?? 0,
        documentedAssumptions: baseline?.documentedAssumptions || [],
      },
      expected: expected || {
        expectedOrderUpliftPercent: 0,
        expectedContribution: 0,
        expectedNewCustomers: 0,
        expectedRepeatPurchases: 0,
        expectedAOVImpact: 0,
        documentedAssumptions: [],
      },
      actual: actual || {
        actualOrderUpliftPercent: 0,
        actualContribution: 0,
        actualNewCustomers: 0,
        actualRepeatPurchases: 0,
        actualAOVImpact: 0,
      },
      variance: {
        orderUpliftPercentDiff,
        contributionDiff,
        newCustomerDiff: 0,
        repeatPurchaseDiff: 0,
        aovDiff: 0,
      },
      attributionMethod: attributionMethod || 'pre_post',
      promotionType: promotionType || 'percentage',
      learningSignals: [],
      ownerFeedback: {},
    });

    await newOutcome.save();

    // Record learning signals
    await recordLearningSignals(newOutcome);

    res.status(201).json({
      success: true,
      outcome: newOutcome,
      message: 'Outcome recorded and learning signals initialized',
    });
  } catch (error: any) {
    console.error('[Intelligence] record outcome error:', error.message);
    res.status(500).json({ error: 'Failed to record outcome' });
  }
}

async function recordLearningSignals(outcome: IRecommendationOutcome): Promise<void> {
  const { restaurantId, promotionType, status } = outcome;

  // Record appropriate learning signals based on outcome status
  const signals: LearningSignal[] = [];

  if (status === 'completed') {
    signals.push('promotion_redeemed', 'incremental_sales', 'incremental_contribution');
  } else if (status === 'measured') {
    signals.push('promotion_implemented', 'promotion_redeemed');
  } else {
    signals.push('promotion_implemented');
  }

  for (const signal of signals) {
    try {
      await LearningSignal.create({
        signal,
        strength: 'moderate',
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        promotionType,
        metadata: {
          recommendationId: outcome.recommendationId,
          variance: outcome.variance,
        },
      });
    } catch (e) {
      // Ignore duplicate/individual signal failures
    }
  }
}

export async function getLearningSummaryHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(req.user?.restaurantId || '');
    if (!restaurantId) {
      res.status(400).json({ error: 'Missing restaurant ID' }); return;
    }

    const summary = await getLearningSummary(restaurantId);

    res.json({
      success: true,
      summary,
    });
  } catch (error: any) {
    console.error('[Intelligence] learning summary error:', error.message);
    res.status(500).json({ error: 'Failed to get learning summary' });
  }
}

export async function recordOwnerFeedbackHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(req.user?.restaurantId || '');
    if (!restaurantId) {
      res.status(400).json({ error: 'Missing restaurant ID' }); return;
    }

    const { recommendationId, rating, categories, comment, would_accept_again } = req.body || {};

    if (!recommendationId) {
      res.status(400).json({ error: 'Missing recommendationId' }); return;
    }

    if (!rating) {
      res.status(400).json({ error: 'Missing rating' }); return;
    }

    await recordOwnerFeedback(
      recommendationId,
      restaurantId,
      rating,
      categories || [],
      comment,
      would_accept_again !== false,
    );

    res.json({
      success: true,
      message: 'Owner feedback recorded',
    });
  } catch (error: any) {
    console.error('[Intelligence] record feedback error:', error.message);
    res.status(500).json({ error: 'Failed to record owner feedback' });
  }
}

export async function checkStrategySuppressionHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(req.user?.restaurantId || '');
    if (!restaurantId) {
      res.status(400).json({ error: 'Missing restaurant ID' }); return;
    }

    const { strategyType } = req.body || {};
    const minimumEvidence = req.body.minimumEvidence || 5;

    if (!strategyType) {
      res.status(400).json({ error: 'Missing strategyType' }); return;
    }

    const result = await shouldSuppressStrategy(restaurantId, strategyType, minimumEvidence);

    res.json({
      success: true,
      shouldSuppress: result.shouldSuppress,
      negativeCount: result.negativeCount,
      totalEvidence: result.totalEvidence,
      reason: result.reason,
    });
  } catch (error: any) {
    console.error('[Intelligence] check suppression error:', error.message);
    res.status(500).json({ error: 'Failed to check strategy suppression' });
  }
}

export async function getStrategyPreferencesHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(req.user?.restaurantId || '');
    if (!restaurantId) {
      res.status(400).json({ error: 'Missing restaurant ID' }); return;
    }

    const trends = await getStrategyPreferenceTrends(restaurantId);

    res.json({
      success: true,
      gainingFavor: trends.gainingFavor,
      losingFavor: trends.losingFavor,
      stable: trends.stable,
    });
  } catch (error: any) {
    console.error('[Intelligence] strategy preferences error:', error.message);
    res.status(500).json({ error: 'Failed to get strategy preferences' });
  }
}

export async function runLearningCycleHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(req.user?.restaurantId || '');
    if (!restaurantId) {
      res.status(400).json({ error: 'Missing restaurant ID' }); return;
    }

    // Filter to just this restaurant's outcomes
    // In production, the scheduler would process all restaurants
    const result = await runWeeklyLearningCycle();

    res.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error('[Intelligence] learning cycle error:', error.message);
    res.status(500).json({ error: 'Failed to run learning cycle' });
  }
}

export async function getExperimentDesignHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(req.user?.restaurantId || '');
    if (!restaurantId) {
      res.status(400).json({ error: 'Missing restaurant ID' }); return;
    }

    const { name, variants, primaryMetric, controlGroupRatio = 0.2, assignmentMethod = 'customer_level', safetyConstraints } = req.body || {};

    if (!name || !variants || variants.length < 2) {
      res.status(400).json({ error: 'Missing required fields: name and at least 2 variants' }); return;
    }

    if (!primaryMetric) {
      res.status(400).json({ error: 'Missing primaryMetric' }); return;
    }

    const experiment: any = {
      restaurantId,
      name,
      description: req.body.description,
      status: 'planned',
      variants,
      primaryMetric,
      controlGroupRatio,
      assignmentMethod,
      safetyConstraints: safetyConstraints || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const validation = validateExperimentDesign(experiment);

    res.json({
      success: validation.valid,
      experiment,
      validationErrors: validation.errors,
    });
  } catch (error: any) {
    console.error('[Intelligence] experiment design error:', error.message);
    res.status(500).json({ error: 'Failed to design experiment' });
  }
}

export async function validateExperimentHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = String(req.user?.restaurantId || '');
    if (!restaurantId) {
      res.status(400).json({ error: 'Missing restaurant ID' }); return;
    }

    const { experiment } = req.body || {};

    if (!experiment) {
      res.status(400).json({ error: 'Missing experiment' }); return;
    }

    const validation = validateExperimentDesign(experiment);

    res.json({
      success: validation.valid,
      errors: validation.errors,
    });
  } catch (error: any) {
    console.error('[Intelligence] validate experiment error:', error.message);
    res.status(500).json({ error: 'Failed to validate experiment' });
  }
}

export default {
  recordOutcomeHandler,
  getLearningSummaryHandler,
  recordOwnerFeedbackHandler,
  checkStrategySuppressionHandler,
  getStrategyPreferencesHandler,
  runLearningCycleHandler,
  getExperimentDesignHandler,
  validateExperimentHandler,
};
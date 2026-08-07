/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ConfidenceEngine — Decides how to act on a resolution confidence score.
 *
 * Rules (commercial SaaS — NEVER silently guess):
 *   Confidence ≥ 0.95  → auto-select (apply the inventory change)
 *   0.80 – 0.94        → ask for confirmation (show summary)
 *   0.50 – 0.79        → present a product picker (top N candidates)
 *   0.30 – 0.49        → if the term looks like a real product, suggest a NEW
 *                        product (pre-filled creation dialog)
 *   < 0.30             → unresolved / ask to repeat
 *
 * The engine is also responsible for combining multiple stage scores into a
 * single calibrated confidence, using per-stage weights and an optional
 * per-restaurant calibration factor learned from historical accuracy.
 */

import type { ConfidenceDecision, StageResult, ResolutionStage } from '../types';

// ====================================================================
// THRESHOLDS (configurable per restaurant via env overrides)
// ====================================================================

export const CONFIDENCE_THRESHOLDS = {
  autoSelect: parseFloat(process.env.VOICE_AUTO_SELECT_THRESHOLD || '0.95'),
  confirm: parseFloat(process.env.VOICE_CONFIRM_THRESHOLD || '0.80'),
  picker: parseFloat(process.env.VOICE_PICKER_THRESHOLD || '0.50'),
  newProduct: parseFloat(process.env.VOICE_NEW_PRODUCT_THRESHOLD || '0.30'),
};

/** Per-stage reliability weights used when combining multiple stage hits. */
export const STAGE_WEIGHTS: Record<ResolutionStage, number> = {
  exact_name: 1.0,
  voice_alias: 0.98,
  search_alias: 0.94,
  learned_alias: 0.9,
  sku: 1.0,
  barcode: 1.0,
  fuzzy: 0.78,
  semantic: 0.72,
};

// ====================================================================
// COMBINED SCORING
// ====================================================================

export interface CombineOptions {
  /** Optional per-restaurant calibration factor (0.8–1.2) from learning. */
  restaurantCalibration?: number;
  /** When true, boost confidence slightly for very recent alias usage. */
  boostRecentUsage?: boolean;
}

/**
 * Combine multiple stage results into a single calibrated confidence score.
 *
 * Strategy:
 *   - Take the highest-confidence stage as the base.
 *   - If multiple independent stages agree on the SAME product, add a
 *     consensus bonus (capped).
 *   - Apply the per-restaurant calibration factor.
 *   - Clamp to [0, 1].
 */
export function combineStageConfidence(
  stages: StageResult[],
  options: CombineOptions = {}
): { score: number; matchedStage?: ResolutionStage; productId?: string } {
  if (!stages || stages.length === 0) {
    return { score: 0 };
  }

  // Find the highest-confidence stage with an actual product.
  const ranked = stages
    .filter((s) => s.productId && s.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  if (ranked.length === 0) {
    return { score: 0 };
  }

  const winner = ranked[0];

  // Consensus bonus: count how many distinct stages agreed on the winner.
  const agreeingStages = ranked.filter((s) => s.productId === winner.productId).length;
  const consensusBonus = agreeingStages > 1 ? 0.03 * (agreeingStages - 1) : 0;

  let score = winner.confidence + consensusBonus;

  // Apply calibration (default 1.0 = no change).
  const calibration = options.restaurantCalibration ?? 1.0;
  score *= calibration;

  // Clamp.
  score = Math.min(1.0, Math.max(0.0, score));

  return {
    score,
    matchedStage: winner.stage,
    productId: winner.productId,
  };
}

// ====================================================================
// DECISION
// ====================================================================

/**
 * Map a combined confidence score to an action decision.
 *
 * @param score - Combined 0..1 confidence
 * @param hasRealProductCandidate - True when a semantic/fuzzy candidate exists
 *                                  (used for the new-product path)
 * @returns A decision with the threshold that was applied.
 */
export function decideAction(score: number, hasRealProductCandidate = false): ConfidenceDecision {
  if (score >= CONFIDENCE_THRESHOLDS.autoSelect) {
    return { level: 'auto_select', score, thresholdApplied: 'auto_select' };
  }
  if (score >= CONFIDENCE_THRESHOLDS.confirm) {
    return { level: 'confirm', score, thresholdApplied: 'confirm' };
  }
  if (score >= CONFIDENCE_THRESHOLDS.picker) {
    return { level: 'product_picker', score, thresholdApplied: 'product_picker' };
  }
  if (score >= CONFIDENCE_THRESHOLDS.newProduct && hasRealProductCandidate) {
    return { level: 'new_product_suggestion', score, thresholdApplied: 'new_product_suggestion' };
  }
  return { level: 'unresolved', score, thresholdApplied: 'unresolved' };
}

// ====================================================================
// EXPORTED PUBLIC API
// ====================================================================

/**
 * Convenience wrapper used by the ProductResolutionEngine:
 * combine stage scores + decide the action in one call.
 */
export function evaluateResolution(
  stages: StageResult[],
  options: CombineOptions = {}
): { decision: ConfidenceDecision; matchedStage?: ResolutionStage; productId?: string } {
  const { score, matchedStage, productId } = combineStageConfidence(stages, options);
  const decision = decideAction(score, stages.some((s) => s.stage === 'semantic' || s.stage === 'fuzzy'));
  return { decision, matchedStage, productId };
}


/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * advisorCore — LAYER: CORE / ML-READY
 *
 * Deterministic advisor logic, fully independent of AI/ML:
 *   - classifyPriority: rule-based priority for promotion candidates
 *   - PRIORITY_RANK: stable ordering used by ranking code
 *   - runWhatIfMath: pure break-even simulation math (discount + combo price)
 *
 * Produces structured business data a future ML service can consume (scores,
 * confidences, break-even volumes). No model inference belongs in this module.
 *
 * FUTURE AI INTEGRATION POINT: AI may explain these results later; the math
 * and the priority rules must stay authoritative and AI-independent.
 */

/**
 * Classify recommendation priority from deterministic signals.
 * (Previously private in aiAdvisoryService — now shared, AI-free.)
 */
export function classifyPriority(c: {
  sourceSignals: string[];
  score: number;
  confidence: number;
  type: string;
}): 'act_now' | 'consider' | 'maintain' | 'monitor' {
  // Act Now: high score, high confidence, urgent condition (inventory expiry, demand anomaly)
  const isUrgent = c.sourceSignals.some(s =>
    s.includes('expiry') || s.includes('anomaly') || s.includes('stockout')
  );
  const highImpact = c.score >= 70 && c.confidence >= 0.7;
  const mediumImpact = c.score >= 50 && c.confidence >= 0.5;

  if (highImpact && (isUrgent || c.type === 'RUN_REACTIVATION')) return 'act_now';
  // Review-type candidates are inherently maintenance actions regardless of
  // score — they never escalate to act_now/consider.
  if (c.type === 'REVIEW_PRICE' || c.type === 'REVIEW_RECIPE_COST') return 'maintain';
  if (highImpact) return 'consider';
  if (mediumImpact) return 'consider';
  return 'monitor';
}

/** Stable priority ordering for ranking enriched recommendations. */
export const PRIORITY_RANK: Record<'act_now' | 'consider' | 'maintain' | 'monitor', number> = {
  act_now: 0,
  consider: 1,
  maintain: 2,
  monitor: 3,
};

// ─── WHAT-IF SIMULATION (deterministic math, ML-READY) ───────────────

export interface WhatIfEconomics {
  price: number;
  contribution: number;
  marginPercent: number;
  aov: number;
}

export interface WhatIfSimulationRequest {
  type: 'discount' | 'combo_price' | 'promotion_budget';
  currentPrice?: number;
  proposedPrice?: number;
  discountPercent?: number;
  productIds?: string[];
  categoryIds?: string[];
  segmentIds?: string[];
  restaurantId: string;
  branchId?: string;
}

export interface WhatIfMathResult {
  current: WhatIfEconomics;
  proposed: WhatIfEconomics;
  incrementalUnitsRequired: number;
  incrementalRevenueRequired: number;
  breakEvenPercent: number;
  confidence: number;
  viable: boolean;
  /** Deterministic explanation — used verbatim when no AI layer is present. */
  explanation: string;
}

/**
 * Pure break-even math for the what-if advisor. No DB, no LLM, no clock —
 * every input is supplied, every output is reproducible.
 *
 * Estimates are intentionally simple and documented (30% assumed gross margin,
 * fixed base volumes): they are heuristics, not financial truth from a model.
 * A future ML service can replace the margin/volume estimates by consuming
 * real baselines; the break-even algebra stays the same.
 */
export function runWhatIfMath(
  request: Pick<WhatIfSimulationRequest, 'type' | 'currentPrice' | 'proposedPrice' | 'discountPercent'>,
  opts: { aov: number; current?: Partial<WhatIfEconomics> },
): WhatIfMathResult {
  const { type, currentPrice, proposedPrice, discountPercent } = request;
  const aov = opts.aov;
  let current: WhatIfEconomics = {
    price: currentPrice || 0,
    contribution: opts.current?.contribution ?? 0,
    marginPercent: opts.current?.marginPercent ?? 0,
    aov,
  };
  let proposed: WhatIfEconomics = { price: proposedPrice || 0, contribution: 0, marginPercent: 0, aov };
  let incrementalUnitsRequired = 0;
  let incrementalRevenueRequired = 0;
  let breakEvenPercent = 0;
  let confidence = 0.5;
  let viable = false;

  if (type === 'discount' && currentPrice && discountPercent) {
    proposed.price = Math.round(currentPrice * (1 - discountPercent / 100));
    current.contribution = currentPrice * 0.3; // Estimate 30% margin
    current.marginPercent = 30;
    proposed.contribution = proposed.price - (currentPrice * 0.7);
    proposed.marginPercent = proposed.price > 0 ? Math.round((proposed.contribution / proposed.price) * 100) : 0;

    const marginLossPerUnit = currentPrice - proposed.price;
    const baseVolume = 10; // Estimated daily volume
    const totalMarginLoss = baseVolume * marginLossPerUnit;
    incrementalUnitsRequired = proposed.contribution > 0 ? Math.ceil(totalMarginLoss / proposed.contribution) : 999;
    incrementalRevenueRequired = incrementalUnitsRequired * proposed.price;
    breakEvenPercent = baseVolume > 0 ? (incrementalUnitsRequired / baseVolume) * 100 : 0;
    viable = proposed.marginPercent >= 15 && breakEvenPercent < 100;
    confidence = viable ? 0.7 : 0.4;
  } else if (type === 'combo_price' && proposedPrice && (opts.current?.price || 0) + (opts.current?.contribution || 0) > 0) {
    // Combo path: caller supplies the current combo economics (from the
    // deterministic promotion-candidate engine); the math stays pure.
    // (When no candidate was found the caller passes empty current values and
    // this branch is skipped — mirroring the original relevantCandidates gate.)
    current.price = opts.current!.price ?? 0;
    current.contribution = opts.current!.contribution ?? 0;
    current.marginPercent = opts.current!.marginPercent ?? 0;

    proposed.price = proposedPrice;
    proposed.contribution = proposedPrice - (current.price - current.contribution);
    proposed.marginPercent = proposed.price > 0 ? Math.round((proposed.contribution / proposed.price) * 100) : 0;
    proposed.aov = current.aov;

    const baseVolume = 5;
    const marginLossPerUnit = current.contribution - proposed.contribution;
    const totalMarginLoss = baseVolume * Math.max(0, marginLossPerUnit);
    incrementalUnitsRequired = proposed.contribution > 0 ? Math.ceil(totalMarginLoss / proposed.contribution) : 999;
    incrementalRevenueRequired = incrementalUnitsRequired * proposed.price;
    breakEvenPercent = baseVolume > 0 ? (incrementalUnitsRequired / baseVolume) * 100 : 0;
    viable = proposed.marginPercent >= 20 && breakEvenPercent < 50;
    confidence = viable ? 0.75 : 0.4;
  }

  const explanation = viable
    ? `Viable: need ${incrementalUnitsRequired} extra units to break even (${Math.round(breakEvenPercent)}% volume increase).`
    : `Not viable: would need ${incrementalUnitsRequired} extra units (${Math.round(breakEvenPercent)}% volume increase) to break even.`;

  return {
    current,
    proposed,
    incrementalUnitsRequired,
    incrementalRevenueRequired,
    breakEvenPercent,
    confidence,
    viable,
    explanation,
  };
}

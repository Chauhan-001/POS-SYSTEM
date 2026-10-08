/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * outcomeLearning.ts — PHASE 15: measured outcomes and product-level patterns
 * feed the NEXT run.
 *
 * Two independent, deterministic pieces:
 *
 *  1. `linkMeasuredOutcomesToMemory` — reads the ALREADY-MEASURED
 *     `RecommendationOutcome` rows (written by the existing measurement
 *     services) and folds each one into memory as an explicit
 *     outcome_positive/outcome_negative event, carrying the REAL numbers
 *     (baseline, actual, variance) and no estimates.
 *
 *     CAUSALITY RULE (task §12/§17): only an outcome measured with
 *     `control_vs_test` attribution may be described as incremental. Every
 *     other attribution method (pre_post / time_series / cohort) is a
 *     correlation and is labelled as such in the stored summary.
 *
 *     IDEMPOTENCY: each row is CLAIMED atomically
 *     (`findOneAndUpdate({ memoryLinkedAt: null })`) before it is learned from,
 *     so a concurrent run can never write the same learning event twice.
 *
 *  2. `consolidateProductPatterns` — per-item "high demand / weak margin"
 *     long-term memory computed ARITHMETICALLY from the existing menu
 *     engineering service (never from an LLM), keyed by `product:<id>` so it
 *     upserts instead of accumulating.
 *
 * Feedback-trend learning is NOT implemented: the feedback domain is
 * declared-only, so no satisfaction signal exists to learn from.
 */

import RecommendationOutcomeModel from '../../models/intelligence/RecommendationOutcome';
import { analyzeMenuEngineering } from '../../services/menuEngineeringService';
import { recordRecommendationLifecycleEvent } from '../memory/memoryLearningService';
import { getRelevantMemories, upsertLongTermMemory } from '../memory/memoryManager';
import type { AiTenantContext } from '../shared/tenantContext';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Outcome statuses that represent a REAL measurement (not a pending row). */
export const LEARNABLE_OUTCOME_STATUSES = ['measured', 'completed'] as const;

/** Reading window for the per-item pattern (matches the engine's default). */
export const PRODUCT_PATTERN_LOOKBACK_DAYS = 90;
/** Minimum items before percentiles mean anything. */
export const MIN_PRODUCTS_FOR_PATTERN = 3;
/** Floor confidence for a pattern worth remembering. */
export const MIN_PRODUCT_PATTERN_CONFIDENCE = 0.55;
/** Cap on patterns written per consolidation pass. */
export const MAX_PRODUCT_PATTERNS = 8;
/** A pattern younger than this is not recomputed. */
export const PRODUCT_PATTERN_FRESHNESS_DAYS = 7;

export interface OutcomeVerdict {
  positive: boolean;
  /** True only when the measurement used a control group. */
  gated: boolean;
  reason: string;
}

/**
 * Decide whether a measured outcome was positive, using ONLY real numbers.
 *
 * Returns null — i.e. "nothing to learn from" — in two cases:
 *   - no variance was recorded at all; and
 *   - the recorded difference is EXACTLY zero. The outcome schema DEFAULTS the
 *     variance fields to 0, so a row that was never actually measured is
 *     indistinguishable from a measured zero delta. Treating that as success
 *     would fabricate a positive learning signal from an absent measurement, so
 *     a zero delta is deliberately neither a success nor a failure: the row is
 *     left unclaimed and can be learned from once real variance exists.
 */
export function verdictForOutcome(row: {
  attributionMethod?: string;
  variance?: { contributionDiff?: number; orderUpliftPercentDiff?: number } | null;
}): OutcomeVerdict | null {
  const gated = row.attributionMethod === 'control_vs_test';
  const contributionDiff = finite(row.variance?.contributionDiff);
  const upliftDiff = finite(row.variance?.orderUpliftPercentDiff);
  if (contributionDiff === undefined && upliftDiff === undefined) return null;
  const signal = contributionDiff ?? upliftDiff!;
  if (signal === 0) return null;
  const reason =
    contributionDiff !== undefined
      ? `contribution vs expectation: ${contributionDiff > 0 ? '+' : ''}${contributionDiff}`
      : `order uplift vs expectation: ${upliftDiff! > 0 ? '+' : ''}${upliftDiff!}%`;
  return { positive: signal > 0, gated, reason };
}

/** Owner/machine-readable summary — causal language ONLY when gated. */
export function outcomeSummary(row: {
  promotionType?: string;
  attributionMethod?: string;
  status?: string;
  variance?: { contributionDiff?: number; orderUpliftPercentDiff?: number } | null;
}): string {
  const verdict = verdictForOutcome(row);
  const head = `Measured ${row.promotionType ?? 'promotion'} outcome (${row.attributionMethod ?? 'unknown attribution'}, status ${row.status ?? 'unknown'}).`;
  const body = verdict ? `${verdict.reason}.` : 'No usable variance was recorded.';
  const causality = verdict?.gated
    ? 'Measured against a control group, so this is an incremental effect.'
    : 'NOT a controlled experiment: this is an association, not an incrementality claim.';
  return `${head} ${body} ${causality}`.slice(0, 1_000);
}

/** Real measured numbers only (no derived or estimated values). */
export function outcomeMetrics(row: {
  metrics?: unknown;
  baseline?: { baselineValue?: number } | null;
  variance?: { contributionDiff?: number; orderUpliftPercentDiff?: number } | null;
}): Record<string, number> {
  const raw = row.metrics;
  const source: Record<string, unknown> =
    raw instanceof Map ? Object.fromEntries(raw as Map<string, unknown>) : ((raw as Record<string, unknown>) ?? {});
  const out: Record<string, number> = {};
  for (const key of [
    'orders',
    'revenue',
    'aov',
    'contribution',
    'incrementalContribution',
    'redemptionRate',
    'newCustomers',
    'returningCustomers',
  ]) {
    const n = finite(source[key]);
    if (n !== undefined) out[key] = n;
  }
  const baseline = finite(row.baseline?.baselineValue);
  if (baseline !== undefined) out.baselineValue = baseline;
  const contributionDiff = finite(row.variance?.contributionDiff);
  if (contributionDiff !== undefined) out.contributionDiff = contributionDiff;
  const upliftDiff = finite(row.variance?.orderUpliftPercentDiff);
  if (upliftDiff !== undefined) out.orderUpliftPercentDiff = upliftDiff;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Measured outcomes → memory
// ─────────────────────────────────────────────────────────────────────────────

export interface OutcomeLinkResult {
  scanned: number;
  linked: number;
  positive: number;
  negative: number;
  /** Rows with no usable variance — counted, never guessed. */
  unusable: number;
  /** Rows claimed by another run between the read and the claim. */
  skipped: number;
  causal: number;
  reasons: string[];
}

/**
 * Fold every not-yet-learned measured outcome into memory. NEVER throws.
 */
export async function linkMeasuredOutcomesToMemory(
  tenant: AiTenantContext,
  opts: { limit?: number } = {},
): Promise<OutcomeLinkResult> {
  const result: OutcomeLinkResult = {
    scanned: 0,
    linked: 0,
    positive: 0,
    negative: 0,
    unusable: 0,
    skipped: 0,
    causal: 0,
    reasons: [],
  };

  try {
    const rows = await RecommendationOutcomeModel.find({
      restaurantId: tenant.restaurantId,
      status: { $in: LEARNABLE_OUTCOME_STATUSES },
      implemented: true,
      memoryLinkedAt: null,
    })
      .sort({ promotedAt: -1 })
      .limit(Math.max(1, Math.min(opts.limit ?? 25, 50)))
      .lean()
      .exec();

    result.scanned = rows.length;

    for (const row of rows as unknown as Array<Record<string, unknown>>) {
      const verdict = verdictForOutcome(row as never);
      if (!verdict) {
        result.unusable += 1;
        continue;
      }
      // CLAIM the row atomically — only one run may learn from it.
      const claim = await RecommendationOutcomeModel.updateOne(
        { _id: row._id as never, memoryLinkedAt: null },
        { $set: { memoryLinkedAt: new Date() } },
      ).exec();
      if (!claim.modifiedCount) {
        result.skipped += 1;
        continue;
      }

      const written = await recordRecommendationLifecycleEvent({
        tenant,
        action: verdict.positive ? 'outcome_positive' : 'outcome_negative',
        recommendationId: String(row.recommendationId ?? ''),
        strategy: typeof row.promotionType === 'string' ? row.promotionType : undefined,
        outcome: {
          status: verdict.positive ? 'success' : 'failure',
          summary: outcomeSummary(row as never),
          metrics: outcomeMetrics(row as never),
        },
        confidence: verdict.gated ? 0.9 : 0.6,
      });

      if (written.recorded) {
        result.linked += 1;
        if (verdict.positive) result.positive += 1;
        else result.negative += 1;
        if (verdict.gated) result.causal += 1;
      } else {
        result.reasons.push(written.reason?.slice(0, 160) ?? 'outcome event not recorded');
      }
    }
  } catch (err) {
    result.reasons.push(`outcome linkage failed: ${err instanceof Error ? err.message.slice(0, 160) : 'unknown error'}`);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Product-level long-term patterns
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductPatternResult {
  considered: number;
  written: number;
  skippedFresh: boolean;
  reasons: string[];
}

/** Demand/margin reading derived arithmetically from the item's percentiles. */
export function productPatternReading(item: {
  popularityPercentile: number;
  marginPercentile: number;
}): { demand: 'high' | 'low' | 'middle'; margin: 'strong' | 'weak' | 'middle' } {
  const demand = item.popularityPercentile >= 60 ? 'high' : item.popularityPercentile <= 40 ? 'low' : 'middle';
  const margin = item.marginPercentile >= 60 ? 'strong' : item.marginPercentile <= 40 ? 'weak' : 'middle';
  return { demand, margin };
}

/** Confidence: floors at the pattern minimum and rises with trading volume. */
export function productPatternConfidence(dailyUnits: number): number {
  const volumeBoost = 0.05 * Math.min(4, Math.floor(Math.max(0, dailyUnits) / 5));
  return Math.min(0.9, MIN_PRODUCT_PATTERN_CONFIDENCE + volumeBoost);
}

/**
 * Write per-item demand/margin patterns. Idempotent (upsert by
 * `product:<id>`) and freshness-guarded so a run does not repeat the menu
 * engineering read for no reason. NEVER throws.
 */
export async function consolidateProductPatterns(
  tenant: AiTenantContext,
  opts: { lookbackDays?: number; force?: boolean } = {},
): Promise<ProductPatternResult> {
  const result: ProductPatternResult = { considered: 0, written: 0, skippedFresh: false, reasons: [] };

  try {
    if (!opts.force) {
      const recent = await getRelevantMemories(tenant, {
        memoryTypes: ['product_performance_pattern'],
        sinceDays: PRODUCT_PATTERN_FRESHNESS_DAYS,
        limit: 1,
      });
      if (recent.length) {
        result.skippedFresh = true;
        return result;
      }
    }

    const items = await analyzeMenuEngineering({
      restaurantId: tenant.restaurantId,
      branchId: tenant.branchId,
      lookbackDays: opts.lookbackDays ?? PRODUCT_PATTERN_LOOKBACK_DAYS,
    });
    result.considered = items.length;
    if (items.length < MIN_PRODUCTS_FOR_PATTERN) {
      result.reasons.push(
        `only ${items.length} item(s) had enough trading history for percentiles (need ${MIN_PRODUCTS_FOR_PATTERN})`,
      );
      return result;
    }

    const candidates = items
      .filter((i) => i.dailyUnits > 0)
      .sort((a, b) => b.dailyContribution - a.dailyContribution)
      .slice(0, MAX_PRODUCT_PATTERNS);

    for (const item of candidates) {
      const { demand, margin } = productPatternReading(item);
      await upsertLongTermMemory(tenant, {
        memoryType: 'product_performance_pattern',
        entityRef: `product:${item.productId}`.slice(0, 200),
        value: {
          productName: item.productName,
          category: item.category,
          demand,
          margin,
          dailyUnits: item.dailyUnits,
          dailyContribution: item.dailyContribution,
          contributionMarginPercent: item.contributionMarginPercent,
          popularityPercentile: item.popularityPercentile,
          marginPercentile: item.marginPercentile,
          classification: item.classification,
          trend: item.trend,
        },
        confidence: productPatternConfidence(item.dailyUnits),
        evidence: [
          {
            kind: 'metric',
            ref: `menu_engineering:${item.productId}`.slice(0, 200),
            label: `${item.productName} — ${item.dailyUnits} units/day`.slice(0, 300),
            value: item.dailyUnits,
          },
        ],
        source: 'service',
        tags: ['product', demand, margin].filter((t) => t !== 'middle'),
        lastValidatedAt: new Date(),
      });
      result.written += 1;
    }
  } catch (err) {
    result.reasons.push(`product patterns failed: ${err instanceof Error ? err.message.slice(0, 160) : 'unknown error'}`);
  }

  return result;
}

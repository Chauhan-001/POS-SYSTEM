/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getPromotionCandidatesTool.ts — PHASE 4 bridge between the agent reasoning
 * layer and the EXISTING candidate/offer architecture.
 *
 * WHAT THIS IS: a read-only tool that calls the existing
 * `generatePromotionCandidates` (promotionCandidateService) and returns its
 * candidates in a compact, agent-facing shape. The service remains the ONLY
 * generator: economics (FinancialModel), cannibalization, constraints and
 * financial validation are computed there, deterministically, by the existing
 * code. This tool never re-implements any of it.
 *
 * WHAT THIS IS NOT: no new offer engine, no new candidate engine, no writes.
 * The agent may reason about strategy; it never calculates cost, margin,
 * discount safety or campaign economics.
 */

import { z } from 'zod';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';
import {
  generatePromotionCandidates,
  deduplicateCandidates,
  type PromotionCandidate,
  type PromotionCandidateOptions,
  type BusinessConstraints,
} from '../../../services/promotionCandidateService';
import { AiError } from '../../shared/aiErrors';
import { resolveBranchScope } from '../../../services/recommendationContext';

export const getPromotionCandidatesInputSchema = z
  .object({
    /** Optional branch scope — validated against the tenant before use. */
    branchId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'branchId must be a 24-hex ObjectId').optional(),
    /** Analysis window. */
    lookbackDays: z.number().int().min(7).max(365).optional(),
    /** Minimum unified score (service default 40). */
    minScore: z.number().min(0).max(100).optional(),
    /** Minimum confidence (service default 0.4). */
    minConfidence: z.number().min(0).max(1).optional(),
    /** Cap on returned candidates (post-dedup, score-sorted). */
    limit: z.number().int().min(1).max(60).optional(),
  })
  .strict();

export type GetPromotionCandidatesInput = z.infer<typeof getPromotionCandidatesInputSchema>;

/** Compact, agent-facing candidate view (full economics stay in the service). */
export interface PromotionCandidateView {
  id: string;
  type: string;
  priority: string;
  score: number;
  confidence: number;
  title: string;
  description: string;
  recommendedAction: string;
  target: {
    productIds: string[];
    productNames: string[];
    categoryIds: string[];
    segmentIds: string[];
  };
  /** Deterministic economics computed by the existing engine. */
  economics: {
    currentPrice: number;
    proposedPrice: number;
    discountPercent: number;
    projectedContributionMargin: number;
    incrementalUnits: number;
    incrementalRevenue: number;
    breakEvenIncrementalUnits: number;
    paybackPeriodDays: number;
    minMarginConstraint: number;
    maxDiscountConstraint: number;
  };
  cannibalization: { rate: number; incrementalVsCannibalized: number; confidence: number };
  risks: string[];
  prerequisites: string[];
  evidence: Array<{ description: string; value: number; baseline?: number; percentageChange?: number; sampleSize?: number }>;
  sourceSignals: string[];
  expiresAt: string;
}

export interface PromotionCandidatesOutput {
  available: boolean;
  reason?: 'NO_CANDIDATES';
  candidates: PromotionCandidateView[];
  /** Total produced by the engine before the `limit` cap. */
  totalGenerated: number;
  /** Distinct candidate types present (strategy spread for later ranking). */
  strategyTypes: string[];
  /** Honest note when the engine produced fewer than the requested limit. */
  note?: string;
  generatedAt: string;
}

function toView(c: PromotionCandidate): PromotionCandidateView {
  const f = c.financialModel;
  return {
    id: c.id,
    type: c.type,
    priority: c.priority,
    score: c.score,
    confidence: c.confidence,
    title: c.title,
    description: c.description,
    recommendedAction: c.recommendedAction,
    target: {
      productIds: [...c.target.productIds],
      productNames: [...c.target.productNames],
      categoryIds: [...c.target.categoryIds],
      segmentIds: [...c.target.segmentIds],
    },
    economics: {
      currentPrice: f.currentPrice,
      proposedPrice: f.proposedPrice,
      discountPercent: f.discountPercent,
      projectedContributionMargin: f.projectedContributionMargin,
      incrementalUnits: f.incrementalUnits,
      incrementalRevenue: f.incrementalRevenue,
      breakEvenIncrementalUnits: f.breakEvenIncrementalUnits,
      paybackPeriodDays: Number.isFinite(f.paybackPeriodDays) ? f.paybackPeriodDays : -1,
      minMarginConstraint: f.minMarginConstraint,
      maxDiscountConstraint: f.maxDiscountConstraint,
    },
    cannibalization: {
      rate: c.cannibalization.estimatedCannibalizationRate,
      incrementalVsCannibalized: c.cannibalization.incrementalVsCannibalized,
      confidence: c.cannibalization.confidence,
    },
    risks: [...c.risks],
    prerequisites: [...c.prerequisites],
    evidence: c.evidence.map((e) => ({
      description: e.description,
      value: e.value,
      baseline: e.baseline,
      percentageChange: e.percentageChange,
      sampleSize: e.sampleSize,
    })),
    sourceSignals: [...c.sourceSignals],
    expiresAt: c.expiresAt instanceof Date ? c.expiresAt.toISOString() : String(c.expiresAt),
  };
}

/**
 * Execute the bridge. Errors from the engine surface as explicit tool
 * failures (the agent then degrades to its deterministic path) — the tool
 * never fabricates candidates and never writes anything.
 */
export async function executeGetPromotionCandidates(
  input: GetPromotionCandidatesInput,
  ctx: ToolContext,
): Promise<PromotionCandidatesOutput> {
  const generatedAt = new Date().toISOString();
  const restaurantId = ctx.tenant.restaurantId;

  // D-15: branch ownership is validated against the tenant (same contract as
  // getSalesTrends / getInventoryStatus / customerTools). A foreign branch is
  // rejected with TOOL_TENANT_MISMATCH — never silently used as a filter.
  let branchId: string | undefined;
  if (input.branchId) {
    if (input.branchId === restaurantId) {
      throw new AiError('TOOL_TENANT_MISMATCH', 'branchId must reference a branch, not the restaurant');
    }
    const scope = await resolveBranchScope(restaurantId, input.branchId);
    if (!scope) throw new AiError('TOOL_TENANT_MISMATCH', 'branchId does not belong to this restaurant');
    branchId = scope.branchId;
  }

  const opts: PromotionCandidateOptions = {
    restaurantId,
    branchId,
    lookbackDays: input.lookbackDays ?? 90,
    minScore: input.minScore ?? 40,
    minConfidence: input.minConfidence ?? 0.4,
  };

  let candidates: PromotionCandidate[];
  try {
    const raw = await generatePromotionCandidates(opts);
    candidates = deduplicateCandidates(raw);
  } catch (err) {
    // Surface as an explicit tool failure — never a silent empty success.
    throw new AiError('TOOL_FAILED', `promotion candidate engine failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const limit = input.limit ?? 30;
  const capped = candidates.slice(0, limit);
  const strategyTypes = [...new Set(candidates.map((c) => c.type))].sort();

  if (candidates.length === 0) {
    return {
      available: false,
      reason: 'NO_CANDIDATES',
      candidates: [],
      totalGenerated: 0,
      strategyTypes: [],
      note: 'The existing engine produced no candidates above the score/confidence thresholds for this window.',
      generatedAt,
    };
  }

  return {
    available: true,
    candidates: capped.map(toView),
    totalGenerated: candidates.length,
    strategyTypes,
    note:
      candidates.length < limit
        ? `Only ${candidates.length} candidate(s) passed the existing engine's thresholds (requested ${limit}).`
        : undefined,
    generatedAt,
  };
}

export const getPromotionCandidatesToolDefinition: ToolDefinition<
  GetPromotionCandidatesInput,
  PromotionCandidatesOutput
> = {
  name: 'getPromotionCandidates',
  category: 'marketing',
  access: 'read',
  meta: {
    description:
      "Existing promotion-candidate engine output: financially-evaluated candidate opportunities (combo, add-on, inventory, customer, menu-engineering, margin, demand) with deterministic economics, cannibalization estimates, constraints, risks and evidence. Read-only — the engine itself remains authoritative for cost, margin and discount safety.",
    source: 'promotionCandidateService.generatePromotionCandidates → GetPromotionCandidatesTool',
  },
  inputSchema: getPromotionCandidatesInputSchema,
  timeoutMs: 20_000,
  execute: executeGetPromotionCandidates,
};

// Keep the type import used (BusinessConstraints documents the engine contract).
export type { BusinessConstraints };
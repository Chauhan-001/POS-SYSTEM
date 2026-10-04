/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getOfferResponseBatchScoresTool.ts — the RESPONSE_MODEL rung of the
 * targeting honesty ladder (spec Step 8): batch per-customer p(respond |
 * offer, pre-treatment features) so the marketing agent can rank CUSTOMERS
 * instead of falling through to segment-level targeting.
 *
 * This is a RESPONSE model, NOT causal uplift — payloads always carry that
 * scope label (ranking by redemption likelihood over-serves customers who
 * would have visited anyway; causal targeting stays with getUpliftSignals).
 *
 * Gate order (spec §19 honesty contract — cheapest gate first, so a cold
 * tenant never pays network I/O):
 *   1. Service configured at all (ML_UPLIT_BASE_URL).
 *   2. A candidate pool exists locally (recent customers with visit history).
 *   3. Those candidates have pre-treatment feature snapshots to score
 *      (leakage-guarded single source: experimentTracker feature mapping).
 *   4. The tenant's model is actually TRAINED (status endpoint — read-only,
 *      never triggers training).
 *   5. Only then score the batch in one round trip.
 * Every unavailable path returns `available: false` with named reasons —
 * a probability is never fabricated.
 */

import { z } from 'zod';
import {
  fetchOfferResponseBatchScore,
  fetchOfferResponseStatus,
  getOfferResponseClientConfig,
} from '../../../modules/ml-pipeline/offerResponseClient';
import { snapshotPreTreatmentFeaturesBatch } from '../../../modules/ml-pipeline/experimentTracker';
import { readEvaluationStatus, type MlModelStatus } from './mlModelStatus';
import Customer from '../../../models/customers/Customer';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

const DEFAULT_CANDIDATE_LIMIT = 50;

export const getOfferResponseBatchScoresInputSchema = z
  .object({
    /** Candidate pool size: most-recently-active customers to score (1–200). */
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

export type GetOfferResponseBatchScoresInput = z.infer<typeof getOfferResponseBatchScoresInputSchema>;

export interface OfferResponseBatchScoresOutput extends MlModelStatus {
  available: true;
  isTrained: true;
  /** Ranked best-first; scores are p(redeem | offer) — non-causal. */
  scores: Array<{ customerId: string; pResponse: number }>;
  modelVersion: string | null;
  /** Baseline response rate the model was trained against. */
  responseRateBaseline: number | null;
  trainedRows?: number;
  /** Server-side scope label: response ≠ causal uplift. */
  scope: string;
  /** How many recent customers were considered for scoring. */
  customersConsidered: number;
  /** Candidates skipped because their document carried no snapshotable fields. */
  customersWithoutFeatures: number;
}

export interface OfferResponseBatchScoresUnavailable extends MlModelStatus {
  available: false;
  gateReasons?: string[];
}

function unavailable(
  generatedAt: string,
  evaluationStatus: MlModelStatus['evaluationStatus'],
  detail: string,
  gateReasons?: string[],
): OfferResponseBatchScoresUnavailable {
  return {
    available: false,
    modelId: 'offer_response',
    evaluationStatus,
    detail,
    ...(gateReasons && gateReasons.length > 0 ? { gateReasons } : {}),
    generatedAt,
  };
}

export async function executeGetOfferResponseBatchScores(
  input: GetOfferResponseBatchScoresInput,
  ctx: ToolContext,
): Promise<OfferResponseBatchScoresOutput | OfferResponseBatchScoresUnavailable> {
  const generatedAt = new Date().toISOString();
  const restaurantId = ctx.tenant.restaurantId;
  const limit = input.limit ?? DEFAULT_CANDIDATE_LIMIT;

  // Gate 1 — service configured at all.
  if (!getOfferResponseClientConfig()) {
    return unavailable(
      generatedAt,
      'unknown',
      'Uplift service not configured (ML_UPLIT_BASE_URL unset) — offer-response batch scoring unavailable.',
    );
  }

  // Gate 2 — candidate pool (local, tenant-scoped). Recency-first so the
  // pool the owner would actually target is what gets scored; deleted and
  // blocked customers are excluded (same filters the audience resolver uses).
  let pool: Array<{ customerId: string; features: Record<string, unknown> }>;
  let customersConsidered: number;
  try {
    const candidates = await Customer.find({
      restaurantId,
      lastVisit: { $ne: null },
      isDeleted: { $ne: true },
      isBlocked: { $ne: true },
    })
      .select('_id')
      .sort({ lastVisit: -1, totalSpend: -1 })
      .limit(limit)
      .lean()
      .exec();

    customersConsidered = candidates.length;
    if (candidates.length === 0) {
      return unavailable(
        generatedAt,
        'unknown',
        'No recent customers with visit history to score — offer-response batch scoring needs a candidate pool.',
        ['no candidate customers for this tenant'],
      );
    }

    // Gate 3 — pre-treatment features (batched: one Customer query + one
    // ledger query). Ids with no snapshotable fields are skipped honestly,
    // never imputed with invented history.
    const ids = candidates.map((c) => String((c as { _id: unknown })._id));
    const featureMap = await snapshotPreTreatmentFeaturesBatch(restaurantId, ids);
    pool = [];
    for (const id of ids) {
      const features = featureMap.get(id);
      if (features && Object.keys(features).length > 0) {
        pool.push({ customerId: id, features });
      }
    }
    if (pool.length === 0) {
      return unavailable(
        generatedAt,
        'unknown',
        `All ${ids.length} candidate customers lack pre-treatment feature snapshots — nothing to score honestly.`,
        ['no pre-treatment features for the candidate pool'],
      );
    }
  } catch (err) {
    return unavailable(
      generatedAt,
      'unknown',
      `Candidate/feature loading failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Gate 4 — is this tenant's model actually trained? Status is read-only:
  // it never trains, so the rung can never silently spend training compute
  // or return a cold-start fabrication.
  let status;
  try {
    status = await fetchOfferResponseStatus(restaurantId);
  } catch (err) {
    return unavailable(
      generatedAt,
      'unknown',
      `Offer-response service unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!status.is_trained) {
    return unavailable(
      generatedAt,
      'not_evaluable',
      'No trained offer-response model for this tenant — needs more experiment-ledger data (response ≠ causal uplift).',
      status.gate?.reasons ?? ['model not trained for this tenant'],
    );
  }

  // Gate passed — score the whole batch in one round trip.
  try {
    const batch = await fetchOfferResponseBatchScore(
      restaurantId,
      pool.map((p) => p.features),
    );

    // The service re-checks its own gates at score time; if it answers
    // not-trained, this rung is unavailable — never a partial fabrication.
    if (!batch.is_trained) {
      return unavailable(
        generatedAt,
        'not_evaluable',
        'Offer-response service reported the model as not trained at score time.',
        batch.detail ?? [batch.reason ?? 'model not trained'],
      );
    }

    const scores: Array<{ customerId: string; pResponse: number }> = [];
    batch.scores.forEach((s, i) => {
      const p = s.p_response;
      if (typeof p === 'number' && pool[i]) {
        scores.push({ customerId: pool[i].customerId, pResponse: p });
      }
    });
    if (scores.length === 0) {
      return unavailable(
        generatedAt,
        'unknown',
        'Batch scoring returned no usable probabilities.',
        ['empty score set from offer-response service'],
      );
    }
    scores.sort((a, b) => b.pResponse - a.pResponse);

    const evaluation = await readEvaluationStatus(restaurantId, 'offer_response');
    const data = (batch.data ?? {}) as Record<string, unknown>;
    return {
      available: true,
      modelId: 'offer_response',
      modelVersion: batch.model_version,
      evaluationStatus: evaluation.status,
      isTrained: true,
      scores,
      responseRateBaseline: typeof data.response_rate_baseline === 'number' ? data.response_rate_baseline : null,
      trainedRows: typeof data.trained_rows === 'number' ? data.trained_rows : undefined,
      scope: batch.scope ?? 'response (non-causal)',
      customersConsidered,
      customersWithoutFeatures: customersConsidered - pool.length,
      generatedAt,
    };
  } catch (err) {
    return unavailable(
      generatedAt,
      'unknown',
      `Offer-response batch scoring failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export const getOfferResponseBatchScoresToolDefinition: ToolDefinition<
  GetOfferResponseBatchScoresInput,
  OfferResponseBatchScoresOutput | OfferResponseBatchScoresUnavailable
> = {
  name: 'getOfferResponseBatchScores',
  category: 'ml',
  access: 'read',
  meta: {
    description:
      'Batch per-customer response probabilities (p(redeem | offer)) ranked best-first — a RESPONSE model, not causal uplift. Unavailable with named reasons when the tenant has no trained model or no candidate pool; never fabricates a probability.',
    source:
      'modules/ml-pipeline/offerResponseClient.fetchOfferResponseBatchScore + experimentTracker.snapshotPreTreatmentFeaturesBatch (MLmodels/Offer_Response_Model, served via Uplift /api/offer-response/score-batch)',
  },
  inputSchema: getOfferResponseBatchScoresInputSchema,
  execute: executeGetOfferResponseBatchScores,
};

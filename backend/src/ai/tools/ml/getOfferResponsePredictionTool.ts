/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getOfferResponsePredictionTool.ts — p(respond | offer, pre-treatment
 * features) from the offer-response model (spec Step 5/7). This is a RESPONSE
 * model, NOT causal uplift — payloads always carry that scope label.
 *
 * Gating order (spec §19 honesty contract):
 *   1. Service configured at all (ML_UPLIT_BASE_URL).
 *   2. Tenant's model is actually TRAINED (status endpoint — read-only,
 *      never triggers training).
 *   3. Only then score the caller's pre-treatment features.
 * Every unavailable path returns `available: false` with named reasons —
 * a probability is never fabricated.
 */

import { z } from 'zod';
import {
  fetchOfferResponseScore,
  fetchOfferResponseStatus,
  getOfferResponseClientConfig,
} from '../../../modules/ml-pipeline/offerResponseClient';
import { readEvaluationStatus, type MlModelStatus } from './mlModelStatus';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getOfferResponsePredictionInputSchema = z
  .object({
    /**
     * Pre-treatment customer features to score (e.g. visitCountDays90,
     * avgBasketValue, lastVisitDaysAgo, preferredMeal). Leakage guard: the
     * Uplift ingest boundary filters to pre-treatment fields; post-treatment
     * fields are ignored server-side.
     */
    features: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .strict();

export type GetOfferResponsePredictionInput = z.infer<typeof getOfferResponsePredictionInputSchema>;

export interface OfferResponsePredictionOutput extends MlModelStatus {
  available: true;
  pResponse: number | null;
  isTrained: boolean;
  modelVersion: string | null;
  /** Baseline response rate the model was trained against. */
  responseRateBaseline?: number | null;
  trainedRows?: number;
  /** Server-side scope label: response ≠ causal uplift. */
  scope: string;
}

export interface OfferResponsePredictionUnavailable extends MlModelStatus {
  available: false;
  gateReasons?: string[];
}

export async function executeGetOfferResponsePrediction(
  input: GetOfferResponsePredictionInput,
  ctx: ToolContext,
): Promise<OfferResponsePredictionOutput | OfferResponsePredictionUnavailable> {
  const generatedAt = new Date().toISOString();
  const restaurantId = ctx.tenant.restaurantId;

  // Gate 1 — service configured at all.
  if (!getOfferResponseClientConfig()) {
    return {
      available: false,
      modelId: 'offer_response',
      evaluationStatus: 'unknown',
      detail: 'Uplift service not configured (ML_UPLIT_BASE_URL unset) — offer-response scoring unavailable.',
      generatedAt,
    };
  }

  // Gate 2 — is this tenant's model actually trained? Status is read-only:
  // it never trains, so the tool can never silently spend training compute
  // or return a cold-start fabrication.
  let status;
  try {
    status = await fetchOfferResponseStatus(restaurantId);
  } catch (err) {
    return {
      available: false,
      modelId: 'offer_response',
      evaluationStatus: 'unknown',
      detail: `Offer-response service unreachable: ${err instanceof Error ? err.message : String(err)}`,
      generatedAt,
    };
  }

  if (!status.is_trained) {
    return {
      available: false,
      modelId: 'offer_response',
      evaluationStatus: 'not_evaluable',
      gateReasons: status.gate?.reasons ?? ['model not trained for this tenant'],
      detail: 'No trained offer-response model for this tenant — needs more experiment-ledger data (response ≠ causal uplift).',
      generatedAt,
    };
  }

  // Gate passed — score.
  try {
    const score = await fetchOfferResponseScore(restaurantId, input.features);
    const evaluation = await readEvaluationStatus(restaurantId, 'offer_response');
    return {
      available: true,
      modelId: 'offer_response',
      modelVersion: score.model_version,
      evaluationStatus: evaluation.status,
      pResponse: score.p_response,
      isTrained: true,
      responseRateBaseline: status.metadata?.response_rate_baseline ?? null,
      trainedRows: status.metadata?.trained_rows,
      scope: score.scope ?? 'response (non-causal)',
      generatedAt,
    };
  } catch (err) {
    return {
      available: false,
      modelId: 'offer_response',
      evaluationStatus: 'unknown',
      detail: `Offer-response scoring failed: ${err instanceof Error ? err.message : String(err)}`,
      generatedAt,
    };
  }
}

export const getOfferResponsePredictionToolDefinition: ToolDefinition<
  GetOfferResponsePredictionInput,
  OfferResponsePredictionOutput | OfferResponsePredictionUnavailable
> = {
  name: 'getOfferResponsePrediction',
  category: 'ml',
  access: 'read',
  meta: {
    description:
      'Probability a customer responds (redeems) to an offer, given pre-treatment features — a RESPONSE model, not causal uplift. Unavailable with named reasons when the tenant has no trained model; never fabricates a probability.',
    source: 'modules/ml-pipeline/offerResponseClient (MLmodels/Uplift /api/offer-response/*)',
  },
  inputSchema: getOfferResponsePredictionInputSchema,
  execute: executeGetOfferResponsePrediction,
};

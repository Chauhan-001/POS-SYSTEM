/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getUpliftSignalsTool.ts — Uplift-model signals, hard-gated by the existing
 * experiment diagnostics (evaluateExperimentRandomization). When the gate
 * fails, the tool reports NOT available with the exact reasons — a ranked
 * customer list is never served from a non-evaluable experiment (spec §19).
 */

import { z } from 'zod';
import {
  fetchUplitRankedCustomers,
  getUplitClientConfig,
} from '../../../modules/ml-pipeline/uplitModelClient';
import { evaluateExperimentRandomization } from '../../../modules/ml-pipeline/experimentEval';
import { readEvaluationStatus, type MlModelStatus } from './mlModelStatus';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getUpliftSignalsInputSchema = z
  .object({
    /** Max ranked customers to return (1–200). */
    limit: z.number().int().min(1).max(200).optional(),
    /** Minimum experiment size for the evaluability gate (service default 100). */
    minimumExperimentSize: z.number().int().min(1).max(100000).optional(),
  })
  .strict();

export type GetUpliftSignalsInput = z.infer<typeof getUpliftSignalsInputSchema>;

export interface UpliftSignalsOutput extends MlModelStatus {
  available: true;
  totalEligible: number;
  customers: Array<{
    customerId: string;
    upliftScore: number;
    upliftPercentagePoints: number;
    status?: string;
  }>;
}

export interface UpliftSignalsUnavailable extends MlModelStatus {
  available: false;
  gateReasons?: string[];
}

export async function executeGetUpliftSignals(
  input: GetUpliftSignalsInput,
  ctx: ToolContext,
): Promise<UpliftSignalsOutput | UpliftSignalsUnavailable> {
  const generatedAt = new Date().toISOString();
  const restaurantId = ctx.tenant.restaurantId;

  // Gate 1 — service configured at all.
  if (!getUplitClientConfig()) {
    return {
      available: false,
      modelId: 'uplift',
      evaluationStatus: 'not_evaluable',
      detail: 'Uplift service not configured (ML_UPLIT_BASE_URL unset).',
      generatedAt,
    };
  }

  // Gate 2 — experiment evaluability from the deterministic diagnostics.
  const diagnostics = await evaluateExperimentRandomization(
    restaurantId,
    input.minimumExperimentSize ?? 100,
  );
  if (!diagnostics.evaluable) {
    return {
      available: false,
      modelId: 'uplift',
      evaluationStatus: 'not_evaluable',
      gateReasons: diagnostics.reasons,
      detail: 'Experiment data does not support trustworthy uplift estimates.',
      generatedAt,
    };
  }

  // Gate passed — fetch ranked customers.
  try {
    const ranked = await fetchUplitRankedCustomers(restaurantId, input.limit ?? 50);
    const evaluation = await readEvaluationStatus(restaurantId, 'uplift');
    return {
      available: true,
      modelId: 'uplift',
      evaluationStatus: evaluation.status,
      totalEligible: ranked.total_eligible,
      customers: ranked.customers.map((c) => ({
        customerId: c.customer_id,
        upliftScore: c.uplift_score,
        upliftPercentagePoints: c.uplift_percentage_points,
        status: c.status,
      })),
      generatedAt,
    };
  } catch (err) {
    return {
      available: false,
      modelId: 'uplift',
      evaluationStatus: 'unknown',
      detail: `Uplift service unreachable: ${err instanceof Error ? err.message : String(err)}`,
      generatedAt,
    };
  }
}

export const getUpliftSignalsToolDefinition: ToolDefinition<
  GetUpliftSignalsInput,
  UpliftSignalsOutput | UpliftSignalsUnavailable
> = {
  name: 'getUpliftSignals',
  category: 'ml',
  access: 'read',
  meta: {
    description:
      'Customers most likely to respond to offers (uplift ranking) — only when the underlying experiment is statistically evaluable; otherwise unavailable with the gate reasons.',
    source: 'modules/ml-pipeline/experimentEval.ts gate + uplitModelClient.fetchUplitRankedCustomers',
  },
  inputSchema: getUpliftSignalsInputSchema,
  execute: executeGetUpliftSignals,
};

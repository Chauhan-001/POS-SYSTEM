/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getDemandForecastTool.ts — Stored demand predictions (modelName='demand',
 * predictionType='product_demand') read through the pipeline's existing read
 * model. Predictions are only present after the Demand service has been
 * synced + pulled; absence is reported honestly as unavailable.
 */

import { z } from 'zod';
import { getDemandPredictions, type DemandPredictionReadModel } from '../../../modules/ml-pipeline/predictionService';
import { mlFreshnessAgeDays, readEvaluationStatus, type MlModelStatus } from './mlModelStatus';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getDemandForecastInputSchema = z
  .object({
    /** Restrict to one product id (as stored on the prediction's entityId). */
    productId: z.string().min(1).max(100).optional(),
    /** YYYY-MM-DD window bounds on the prediction target date. */
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

export type GetDemandForecastInput = z.infer<typeof getDemandForecastInputSchema>;

export interface DemandForecastOutput extends MlModelStatus {
  available: true;
  predictions?: Array<{
    productId: string;
    predictionFor: string;
    expected: number;
    lower: number | null;
    upper: number | null;
    confidenceLevel: string | null;
    dataMode: string | null;
  }>;
}

export interface DemandForecastUnavailable extends MlModelStatus {
  available: false;
}

export async function executeGetDemandForecast(
  input: GetDemandForecastInput,
  ctx: ToolContext,
): Promise<DemandForecastOutput | DemandForecastUnavailable> {
  const generatedAt = new Date().toISOString();
  const evaluation = await readEvaluationStatus(ctx.tenant.restaurantId, 'demand');

  let rows: DemandPredictionReadModel[];
  try {
    rows = await getDemandPredictions(ctx.tenant.restaurantId, {
      productId: input.productId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      limit: input.limit,
    });
  } catch {
    return {
      available: false,
      modelId: 'demand',
      evaluationStatus: evaluation.status,
      detail: 'Demand prediction store unavailable.',
      generatedAt,
    };
  }

  if (rows.length === 0) {
    return {
      available: false,
      modelId: 'demand',
      evaluationStatus: evaluation.status,
      detail: 'No stored demand predictions. The Demand service may not be configured or synced yet.',
      generatedAt,
    };
  }

  const newest = rows.reduce((a, b) => (a.generatedAt > b.generatedAt ? a : b));
  return {
    available: true,
    modelId: 'demand',
    modelVersion: newest.modelVersion,
    evaluationStatus: evaluation.status,
    freshnessAgeDays: mlFreshnessAgeDays(newest.generatedAt),
    predictions: rows.map((r) => ({
      productId: r.entityId,
      predictionFor: r.predictionFor,
      expected: r.expected,
      lower: r.lower,
      upper: r.upper,
      confidenceLevel: r.confidenceLevel,
      dataMode: r.dataMode,
    })),
    generatedAt,
  };
}

export const getDemandForecastToolDefinition: ToolDefinition<GetDemandForecastInput, DemandForecastOutput | DemandForecastUnavailable> = {
  name: 'getDemandForecast',
  category: 'ml',
  access: 'read',
  meta: {
    description:
      'ML demand forecasts per product (expected units with confidence bounds). Reports model version, freshness and whether accuracy has been evaluated; unavailable when no predictions exist.',
    source: 'modules/ml-pipeline/predictionService.ts → getDemandPredictions (stored product_demand predictions)',
  },
  inputSchema: getDemandForecastInputSchema,
  execute: executeGetDemandForecast,
};

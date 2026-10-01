/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getMarketBasketSignalsTool.ts — Market-basket ML signals from two honest
 * sources: (a) stored combo_ranking predictions pulled from the Basket
 * service, and (b) the live manager recommendation table whose
 * recommendation_mode says whether rows are model-backed or rule fallback.
 */

import { z } from 'zod';
import {
  getBasketPredictions,
} from '../../../modules/ml-pipeline/predictionService';
import { fetchBasketCombos } from '../../../modules/ml-pipeline/basketSyncService';
import type { BasketManagerRecommendations } from '../../../modules/ml-pipeline/basketIngestionContract';
import { mlFreshnessAgeDays, readEvaluationStatus, type MlModelStatus } from './mlModelStatus';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getMarketBasketSignalsInputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type GetMarketBasketSignalsInput = z.infer<typeof getMarketBasketSignalsInputSchema>;

export interface BasketSignalRow {
  productAId: string;
  productBId: string;
  expectedPurchases7d: number | null;
  estimatedFutureProfit: number | null;
  source: 'ml_prediction' | 'manager_table';
  recommendationMode?: string | null;
}

export interface MarketBasketSignalsOutput extends MlModelStatus {
  available: true;
  predictionSource: 'stored_predictions' | 'manager_table';
  recommendationMode?: string | null;
  signals: BasketSignalRow[];
}

export interface MarketBasketSignalsUnavailable extends MlModelStatus {
  available: false;
}

export async function executeGetMarketBasketSignals(
  input: GetMarketBasketSignalsInput,
  ctx: ToolContext,
): Promise<MarketBasketSignalsOutput | MarketBasketSignalsUnavailable> {
  const generatedAt = new Date().toISOString();
  const evaluation = await readEvaluationStatus(ctx.tenant.restaurantId, 'combo');

  // 1) Stored combo predictions (written when the pipeline pulled them).
  let rows: Awaited<ReturnType<typeof getBasketPredictions>> = [];
  let storeFailed = false;
  try {
    rows = await getBasketPredictions(ctx.tenant.restaurantId, { limit: input.limit });
  } catch {
    storeFailed = true;
  }

  if (rows.length > 0) {
    const newest = rows.reduce((a, b) => (a.generatedAt > b.generatedAt ? a : b));
    return {
      available: true,
      predictionSource: 'stored_predictions',
      modelId: 'combo',
      modelVersion: newest.modelVersion,
      evaluationStatus: evaluation.status,
      freshnessAgeDays: mlFreshnessAgeDays(newest.generatedAt),
      signals: rows.map((r) => ({
        productAId: r.productAId,
        productBId: r.productBId,
        expectedPurchases7d: r.expectedPurchases7d,
        estimatedFutureProfit: r.estimatedFutureProfit,
        source: 'ml_prediction' as const,
        recommendationMode: null,
      })),
      generatedAt,
    };
  }

  // 2) Live manager table — mode + modelVersion come from the service itself.
  let live: BasketManagerRecommendations | null = null;
  try {
    live = await fetchBasketCombos(ctx.tenant.restaurantId);
  } catch {
    live = null;
  }

  if (live && Array.isArray(live.items) && live.items.length > 0) {
    const mode = live.recommendation_mode ?? null;
    const modelBacked = mode === 'model';
    return {
      available: true,
      predictionSource: 'manager_table',
      modelId: 'combo',
      modelVersion: live.model_version ?? null,
      evaluationStatus: evaluation.status,
      recommendationMode: mode,
      signals: live.items.slice(0, input.limit ?? 50).map((it) => ({
        productAId: String(it.product_a_id),
        productBId: String(it.product_b_id),
        expectedPurchases7d: it.ml_prediction ?? null,
        estimatedFutureProfit: it.estimated_future_profit ?? null,
        source: 'manager_table' as const,
        recommendationMode: mode,
      })),
      // Spec §19: never present rule fallback as model output.
      detail: modelBacked
        ? undefined
        : `Basket service is serving rule-based fallback rows (recommendation_mode='${mode ?? 'unknown'}') — treat as heuristics, not model predictions.`,
      generatedAt,
    };
  }

  return {
    available: false,
    modelId: 'combo',
    evaluationStatus: evaluation.status,
    detail: storeFailed
      ? 'Basket prediction store unavailable.'
      : 'No stored combo predictions and the Basket service is unreachable or has no rows for this tenant.',
    generatedAt,
  };
}

export const getMarketBasketSignalsToolDefinition: ToolDefinition<
  GetMarketBasketSignalsInput,
  MarketBasketSignalsOutput | MarketBasketSignalsUnavailable
> = {
  name: 'getMarketBasketSignals',
  category: 'ml',
  access: 'read',
  meta: {
    description:
      'Market-basket signals: product pairs predicted to sell together with expected purchases / future profit. Reports whether rows are model-backed or rule fallback (never presents heuristics as predictions).',
    source: 'modules/ml-pipeline/predictionService.getBasketPredictions + basketSyncService.fetchBasketCombos',
  },
  inputSchema: getMarketBasketSignalsInputSchema,
  execute: executeGetMarketBasketSignals,
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * predictionService.ts — closes audit P0 #4 (prediction storage).
 *
 * Writes: pull this tenant's forecasts from the Demand model and upsert them
 * into MongoDB (ml_predictions via the MLPrediction model). Reads: tenant-safe
 * queries used by the Node read endpoints. Nothing here trusts client input
 * for tenant identity — restaurantId always comes from the verified JWT.
 */

import MLPrediction from '../../models/intelligence/MLPrediction';
import type {
  DemandClientConfig,
} from './demandModelClient';
import { getDemandClientConfig } from './demandModelClient';
import { recordMlEventFireAndForget } from './mlObservability';

// ─── Demand model API types (subset of ProductForecastResult) ────────────────

interface DemandForecastPoint {
  date: string;
  forecast: number;
  lower_bound: number;
  upper_bound: number;
  confidence: number;
  explanation?: {
    top_positive_factors?: string[];
    top_negative_factors?: string[];
    confidence_rating?: string;
  };
}

interface DemandProductForecast {
  restaurant_id: string;
  product_id: string;
  product_name: string;
  method: string;
  model_version: string;
  data_mode: string;
  forecast_horizon_days: number;
  forecasts: DemandForecastPoint[];
  metrics: { wape: number; mae: number; rmse: number; smape: number };
}

// ─── Write path ──────────────────────────────────────────────────────────────

const DATE_TTL_DAYS = 3; // day-scoped demand predictions expire after 3 days

function dayTtlDate(dateStr: string): Date {
  const d = new Date(`${dateStr}T23:59:59Z`);
  d.setDate(d.getDate() + DATE_TTL_DAYS);
  return d;
}

function confidenceLevel(score: number): 'LOW_CONFIDENCE' | 'MODERATE_CONFIDENCE' | 'HIGH_CONFIDENCE' {
  if (score >= 0.8) return 'HIGH_CONFIDENCE';
  if (score >= 0.55) return 'MODERATE_CONFIDENCE';
  return 'LOW_CONFIDENCE';
}

/**
 * Fetches forecasts for one tenant/product from the Demand model and upserts
 * them as product_demand predictions. Returns per-call stats.
 */
export async function pullDemandPredictions(
  restaurantId: string,
  options: { productIds: string[]; horizonDays?: number; jwt?: string; serviceTokenMode?: boolean }
): Promise<{
  productsRequested: number;
  predictionsStored: number;
  predictionsFailed: number;
  errors: string[];
}> {
  const cfg: DemandClientConfig | null = getDemandClientConfig();
  if (!cfg) throw new Error('ML_DEMAND_BASE_URL is not configured — demand predictions unavailable');

  const stats = { productsRequested: 0, predictionsStored: 0, predictionsFailed: 0, errors: [] as string[] };
  const horizon = Math.min(Math.max(options.horizonDays ?? 7, 1), 30);

  for (const productId of options.productIds) {
    stats.productsRequested += 1;
    try {
      const url =
        `${cfg.baseUrl}/api/forecast?restaurant_id=${encodeURIComponent(restaurantId)}` +
        `&product_id=${encodeURIComponent(productId)}&horizon=${horizon}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      const headers: Record<string, string> = {
        'x-service-token': cfg.serviceToken || '',
        'x-restaurant-id': restaurantId,
      };
      const jwt = options.serviceTokenMode ? undefined : options.jwt;
      if (jwt) headers['x-chitkuber-jwt'] = jwt;
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as { success: boolean; data?: DemandProductForecast };
      const forecast = json.data;
      if (!json.success || !forecast || !Array.isArray(forecast.forecasts)) {
        throw new Error('malformed forecast response');
      }

      for (const point of forecast.forecasts) {
        await MLPrediction.updateOne(
          {
            restaurantId,
            modelName: 'demand',
            predictionType: 'product_demand',
            entityId: productId,
            predictionFor: point.date,
          },
          {
            $set: {
              branchId: null,
              modelVersion: forecast.model_version || forecast.method || 'unknown',
              generatedAt: new Date(),
              horizonDays: horizon,
              prediction: {
                expected: point.forecast,
                lower: point.lower_bound,
                upper: point.upper_bound,
                productName: forecast.product_name,
                method: forecast.method,
                dataMode: forecast.data_mode,
                topFactors: [
                  ...(point.explanation?.top_positive_factors || []).slice(0, 3),
                  ...(point.explanation?.top_negative_factors || []).slice(0, 3),
                ],
              },
              confidence: {
                level: confidenceLevel(point.confidence ?? 0),
                score: point.confidence,
                dataMode: forecast.data_mode,
              },
              featuresVersion: forecast.data_mode === 'restaurant_ml' ? 'ml-v1' : 'stat-v1',
              source: 'demand_model',
              expiresAt: dayTtlDate(point.date),
            },
          },
          { upsert: true }
        );
        stats.predictionsStored += 1;
      }
    } catch (err) {
      stats.predictionsFailed += 1;
      stats.errors.push(`product ${productId}: ${err instanceof Error ? err.message : String(err)}`);
      recordMlEventFireAndForget({
        event: 'ml_prediction_failed',
        restaurantId,
        model: 'demand',
        severity: 'error',
        reason: `prediction pull failed for product ${productId}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      });
    }
  }

  return stats;
}

// ─── Basket combo predictions (write path) ──────────────────────────────────

interface BasketComboItem {
  combo_id?: string;
  product_a_id: string;
  product_b_id: string;
  product_a_name?: string;
  product_b_name?: string;
  ml_prediction?: number | null;
  estimated_future_profit?: number | null;
}

interface BasketRecommendationsResponse {
  recommendation_mode?: string;
  model_version?: string | null;
  items?: BasketComboItem[];
}

/**
 * Pulls the tenant's combo recommendations from the Basket service and stores
 * them as combo_affinity predictions (one row per pair per day). Uses the
 * basketModelClient (shared auth headers); predictions are day-scoped with a
 * 3-day TTL like demand rows.
 */
export async function pullBasketComboPredictions(restaurantId: string): Promise<{
  combosFetched: number;
  predictionsStored: number;
  mode: string | null;
}> {
  const { fetchBasketCombos } = await import('./basketSyncService');
  const recommendations = await fetchBasketCombos(restaurantId);
  if (!recommendations || !Array.isArray(recommendations.items)) {
    return { combosFetched: 0, predictionsStored: 0, mode: null };
  }

  const today = new Date().toISOString().slice(0, 10);
  const mode = recommendations.recommendation_mode || null;
  const modelVersion = recommendations.model_version || mode || 'unknown';
  let stored = 0;

  for (const combo of recommendations.items.slice(0, 100)) {
    if (!combo?.product_a_id || !combo?.product_b_id) continue;
    const pairKey = `${combo.product_a_id}::${combo.product_b_id}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DATE_TTL_DAYS);

    await MLPrediction.updateOne(
      {
        restaurantId,
        modelName: 'combo', // MLPrediction enum (no separate basket model)
        predictionType: 'combo_ranking',
        entityId: pairKey,
        predictionFor: today,
      },
      {
        $set: {
          branchId: null,
          modelVersion,
          generatedAt: new Date(),
          horizonDays: 7,
          prediction: {
            productAId: combo.product_a_id,
            productBId: combo.product_b_id,
            productAName: combo.product_a_name,
            productBName: combo.product_b_name,
            expectedPurchases7d: combo.ml_prediction ?? null,
            estimatedFutureProfit: combo.estimated_future_profit ?? null,
            mode,
          },
          // Rule-based rows carry no statistical confidence — left unset.
          featuresVersion: mode === 'ml' ? 'combo-ml-v1' : 'combo-rule-v1',
          source: 'combo_model', // MLPrediction enum
          expiresAt,
        },
      },
      { upsert: true }
    );
    stored += 1;
  }

  return { combosFetched: recommendations.items.length, predictionsStored: stored, mode };
}

/** Latest stored combo predictions for a tenant (read path). */
export async function getBasketPredictions(
  restaurantId: string,
  filter: { limit?: number } = {}
): Promise<
  Array<{
    entityId: string;
    predictionFor: string;
    productAId: string;
    productBId: string;
    expectedPurchases7d: number | null;
    estimatedFutureProfit: number | null;
    modelVersion: string;
    generatedAt: Date;
  }>
> {
  const docs = await MLPrediction.find({
    restaurantId,
    modelName: 'combo',
    predictionType: 'combo_ranking',
  })
    .sort({ generatedAt: -1 })
    .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500))
    .lean();

  return docs.map((d) => {
    const p = (d.prediction || {}) as Record<string, unknown>;
    return {
      entityId: d.entityId,
      predictionFor: d.predictionFor,
      productAId: String(p.productAId ?? ''),
      productBId: String(p.productBId ?? ''),
      expectedPurchases7d: p.expectedPurchases7d === null || p.expectedPurchases7d === undefined ? null : Number(p.expectedPurchases7d),
      estimatedFutureProfit: p.estimatedFutureProfit === null || p.estimatedFutureProfit === undefined ? null : Number(p.estimatedFutureProfit),
      modelVersion: d.modelVersion,
      generatedAt: d.generatedAt,
    };
  });
}

// ─── Read path (demand) ──────────────────────────────────────────────────────

export interface DemandPredictionReadModel {
  entityId: string;
  predictionFor: string;
  expected: number;
  lower: number | null;
  upper: number | null;
  modelVersion: string;
  dataMode: string | null;
  confidenceLevel: string | null;
  generatedAt: Date;
}

/**
 * Latest demand predictions for a tenant, optionally filtered.
 * RestaurantId is required and must come from the verified JWT upstream.
 */
export async function getDemandPredictions(
  restaurantId: string,
  filter: { productId?: string; fromDate?: string; toDate?: string; limit?: number } = {}
): Promise<DemandPredictionReadModel[]> {
  const q: Record<string, unknown> = {
    restaurantId,
    modelName: 'demand',
    predictionType: 'product_demand',
  };
  if (filter.productId) q.entityId = filter.productId;
  if (filter.fromDate || filter.toDate) {
    const rf: Record<string, unknown> = {};
    if (filter.fromDate) rf.$gte = filter.fromDate;
    if (filter.toDate) rf.$lte = filter.toDate;
    q.predictionFor = rf;
  }

  const docs = await MLPrediction.find(q)
    .sort({ predictionFor: 1, generatedAt: -1 })
    .limit(Math.min(Math.max(filter.limit ?? 500, 1), 2000))
    .lean();

  return docs.map((d) => {
    const p = (d.prediction || {}) as Record<string, unknown>;
    return {
      entityId: d.entityId,
      predictionFor: d.predictionFor,
      expected: Number(p.expected ?? 0),
      lower: p.lower === undefined ? null : Number(p.lower),
      upper: p.upper === undefined ? null : Number(p.upper),
      modelVersion: d.modelVersion,
      dataMode: (p.dataMode as string) ?? null,
      confidenceLevel: d.confidence?.level ?? null,
      generatedAt: d.generatedAt,
    };
  });
}

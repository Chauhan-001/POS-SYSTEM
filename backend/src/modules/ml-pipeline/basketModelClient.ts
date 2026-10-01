/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Basket Model Client — pushes extracted transactions, triggers per-tenant
 * training, and pulls manager combo predictions from the Basket service
 * (MLmodels/Market_Basket_Analysis FastAPI backend).
 *
 * Auth mirrors demandModelClient: x-service-token (+ x-restaurant-id, which
 * the Basket service accepts in header-tenant mode for machine-to-machine
 * sync jobs).
 */

import type {
  BasketIngestEnvelope,
  BasketIngestResult,
  BasketManagerRecommendations,
  BasketTrainResult,
} from './basketIngestionContract';
import { config } from '../../config';

export interface BasketClientConfig {
  baseUrl: string;
  serviceToken?: string;
  timeoutMs: number;
}

function safeInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getBasketClientConfig(): BasketClientConfig | null {
  // Call-time env read (config.ts snapshots at import time); config stays the
  // documented fallback, exactly like getDemandClientConfig.
  const baseUrl = (process.env.ML_BASKET_BASE_URL || config.mlPipeline?.demandBaseUrl || '').trim();
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    serviceToken:
      (process.env.ML_SERVICE_TOKEN || config.mlPipeline?.serviceToken || '').trim() || undefined,
    timeoutMs: safeInt(process.env.ML_BASKET_TIMEOUT_MS, config.mlPipeline?.demandTimeoutMs || 30_000),
  };
}

async function basketFetch<T>(
  cfg: BasketClientConfig,
  path: string,
  init: { method: 'GET' | 'POST'; restaurantId?: string; body?: unknown },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: init.method,
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.restaurantId ? { 'x-restaurant-id': init.restaurantId } : {}),
        ...(cfg.serviceToken ? { 'x-service-token': cfg.serviceToken } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Basket service ${init.method} ${path} failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Pushes one batch of transactions (idempotent by transaction_id). */
export function pushTransactionsToBasket(
  cfg: BasketClientConfig,
  restaurantId: string,
  envelope: BasketIngestEnvelope,
): Promise<BasketIngestResult> {
  return basketFetch(cfg, '/api/ingest/transactions', {
    method: 'POST',
    restaurantId,
    body: envelope,
  });
}

/** Triggers the sufficiency-gated training pipeline for one tenant. */
export function triggerBasketTraining(
  cfg: BasketClientConfig,
  restaurantId: string,
): Promise<BasketTrainResult> {
  // ML_ALLOW_HEADER_TENANT=on + x-restaurant-id resolves the tenant
  // server-side; the route's "R001" default never sees an unauthenticated call.
  return basketFetch(cfg, `/api/model/train?restaurant_id=${encodeURIComponent(restaurantId)}`, {
    method: 'POST',
    restaurantId,
  });
}

/** Pulls the manager recommendation table (ML predictions + rule fallback). */
export function fetchBasketManagerRecommendations(
  cfg: BasketClientConfig,
  restaurantId: string,
): Promise<BasketManagerRecommendations> {
  return basketFetch(
    cfg,
    `/api/manager/recommendations?restaurant_id=${encodeURIComponent(restaurantId)}&limit=100`,
    { method: 'GET', restaurantId },
  );
}

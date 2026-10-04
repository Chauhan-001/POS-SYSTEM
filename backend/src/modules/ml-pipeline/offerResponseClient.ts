/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offer-Response Model Client (spec Step 5) — Node-side proxy to the Uplift
 * service's /api/offer-response/* endpoints. The model itself lives in
 * MLmodels/Offer_Response_Model and is re-exported by MLmodels/Uplift. The model is
 * a RESPONSE model: p(redeem | offer, pre-treatment features) — explicitly
 * NON-causal. Causal targeting stays with the uplift T-Learner endpoints.
 *
 * Reuses the Uplift client config (ML_UPLIT_BASE_URL) and the same auth
 * headers: x-restaurant-id + x-service-token (tenant resolved server-side).
 */

import { config } from '../../config';

export interface OfferResponseClientConfig {
  baseUrl: string;
  serviceToken?: string;
  timeoutMs: number;
}

function safeInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getOfferResponseClientConfig(): OfferResponseClientConfig | null {
  const baseUrl = (process.env.ML_UPLIT_BASE_URL || '').trim();
  if (!baseUrl) return null; // integration disabled when unset
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    serviceToken:
      (process.env.ML_SERVICE_TOKEN || config.mlPipeline?.serviceToken || '').trim() || undefined,
    timeoutMs: safeInt(process.env.ML_UPLIT_TIMEOUT_MS, config.mlPipeline?.demandTimeoutMs || 30_000),
  };
}

export interface OfferResponseScoreResult {
  p_response: number | null;
  is_trained: boolean;
  model_version: string | null;
  reason: string | null;
  detail?: string[];
  data?: Record<string, unknown>;
  model?: string;
  scope?: string;
}

export interface OfferResponseBatchScoreResult {
  /** Aligned 1:1 with the submitted customers (same order). */
  scores: Array<{ p_response: number | null }>;
  is_trained: boolean;
  model_version: string | null;
  reason: string | null;
  detail?: string[];
  data?: Record<string, unknown>;
  model?: string;
  scope?: string;
}

export interface OfferResponseEvalResult {
  evaluable: boolean;
  reasons: string[];
  auc: number | null;
  log_loss: number | null;
  temporal_split?: boolean;
  train_rows?: number;
  holdout_rows?: number;
  holdout_conversions?: number;
  model?: string;
}

export interface OfferResponseRetrainResult {
  success: boolean;
  ready: boolean;
  reasons?: string[];
  data?: Record<string, unknown>;
  trained_rows?: number;
  trained_conversions?: number;
  response_rate_baseline?: number;
  trained_at?: string;
}

async function offerResponsePost<T>(cfg: OfferResponseClientConfig, restaurantId: string, path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-restaurant-id': restaurantId,
        ...(cfg.serviceToken ? { 'x-service-token': cfg.serviceToken } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Offer-response ${path} failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function offerResponseGet<T>(cfg: OfferResponseClientConfig, restaurantId: string, path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        'x-restaurant-id': restaurantId,
        ...(cfg.serviceToken ? { 'x-service-token': cfg.serviceToken } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Offer-response ${path} failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * p(respond | offer) for one customer's PRE-TREATMENT features. The caller
 * must pass whitelist-filtered features only (leakage guard lives in the
 * experiment tracker's snapshot + the Uplift ingest boundary).
 */
export async function fetchOfferResponseScore(
  restaurantId: string,
  features: Record<string, unknown>
): Promise<OfferResponseScoreResult> {
  const cfg = getOfferResponseClientConfig();
  if (!cfg) throw new Error('ML_UPLIT_BASE_URL is not configured — offer-response scoring unavailable');
  return offerResponsePost(cfg, restaurantId, '/api/offer-response/score', { customer: features });
}

/**
 * Batch p(respond | offer) for a list of PRE-TREATMENT feature snapshots —
 * one HTTP round trip instead of N single /score calls. `scores` is aligned
 * 1:1 with the input order (the caller maps them back to its own customer
 * ids). Cold start passes through untouched: is_trained=false with the gate
 * reasons and p_response=null per row — never fabricated.
 */
export async function fetchOfferResponseBatchScore(
  restaurantId: string,
  customers: Array<Record<string, unknown>>
): Promise<OfferResponseBatchScoreResult> {
  const cfg = getOfferResponseClientConfig();
  if (!cfg) throw new Error('ML_UPLIT_BASE_URL is not configured — offer-response batch scoring unavailable');
  return offerResponsePost(cfg, restaurantId, '/api/offer-response/score-batch', { customers });
}

export async function fetchOfferResponseEvaluation(
  restaurantId: string,
  holdoutFraction = 0.3
): Promise<OfferResponseEvalResult> {
  const cfg = getOfferResponseClientConfig();
  if (!cfg) throw new Error('ML_UPLIT_BASE_URL is not configured — offer-response evaluation unavailable');
  return offerResponsePost(cfg, restaurantId, '/api/offer-response/evaluate', {
    holdout_fraction: Math.min(Math.max(holdoutFraction, 0.1), 0.5),
  });
}

export async function triggerOfferResponseRetrain(restaurantId: string): Promise<OfferResponseRetrainResult> {
  const cfg = getOfferResponseClientConfig();
  if (!cfg) throw new Error('ML_UPLIT_BASE_URL is not configured — offer-response retrain unavailable');
  return offerResponsePost(cfg, restaurantId, '/api/offer-response/retrain', {});
}

export interface OfferResponseStatusResult {
  model: string;
  restaurant_id: string | null;
  is_trained: boolean;
  model_version: string | null;
  scope?: string;
  metadata?: {
    trained_at?: string;
    trained_rows?: number;
    trained_conversions?: number;
    response_rate_baseline?: number;
    dataset_fingerprint?: string;
    categorical_fields?: string[];
    categorical_levels?: Record<string, number>;
  };
  gate?: { ready: boolean; reasons: string[]; data?: Record<string, unknown> };
}

/** Read-only model metadata + gate report (audit Step 6) — no training, no scoring. */
export async function fetchOfferResponseStatus(restaurantId: string): Promise<OfferResponseStatusResult> {
  const cfg = getOfferResponseClientConfig();
  if (!cfg) throw new Error('ML_UPLIT_BASE_URL is not configured — offer-response status unavailable');
  return offerResponseGet(cfg, restaurantId, '/api/offer-response/status');
}

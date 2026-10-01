/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Segmentation Model Client — pushes tenant RFM rows, triggers gated
 * training, and fetches segments from the 4th ML service
 * (MLmodels/Customer_segmentation_model, FastAPI :8002).
 *
 * Auth mirrors the other three clients: x-service-token + x-restaurant-id
 * (valid when the service runs ML_ALLOW_HEADER_TENANT=on).
 */

import { config } from '../../config';

export interface SegmentClientConfig {
  baseUrl: string;
  serviceToken?: string;
  timeoutMs: number;
}

function safeInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getSegmentClientConfig(): SegmentClientConfig | null {
  const baseUrl = (process.env.ML_SEGMENT_BASE_URL || '').trim();
  if (!baseUrl) return null; // integration disabled when unset
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    serviceToken:
      (process.env.ML_SERVICE_TOKEN || config.mlPipeline?.serviceToken || '').trim() || undefined,
    timeoutMs: safeInt(process.env.ML_SEGMENT_TIMEOUT_MS, config.mlPipeline?.demandTimeoutMs || 30_000),
  };
}

async function segmentFetch<T>(
  cfg: SegmentClientConfig,
  path: string,
  init: { method: 'GET' | 'POST'; restaurantId: string; body?: unknown },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: init.method,
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'x-restaurant-id': init.restaurantId,
        ...(cfg.serviceToken ? { 'x-service-token': cfg.serviceToken } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Segmentation service ${init.method} ${path} failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface SegmentIngestResult {
  success: boolean;
  accepted_count: number;
  total_customers: number;
  rejected_count: number;
  rejected?: Array<{ index?: number; customer_id?: string; reason: string }>;
}

export function pushCustomersToSegmentService(
  cfg: SegmentClientConfig,
  restaurantId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: readonly any[],
): Promise<SegmentIngestResult> {
  return segmentFetch(cfg, '/api/ingest/customers', {
    method: 'POST',
    restaurantId,
    body: { customers: rows },
  });
}

export interface SegmentTrainResult {
  success: boolean;
  is_trained: boolean;
  reason?: string;
  model_version?: string;
  k?: number;
  inertia?: number;
  customers_usable?: number;
  segments?: Array<{ label: string; customers: number; centroid_rfm: Record<string, number> }>;
}

/** Triggers gated training (ingest + train in one call). */
export function trainSegmentModel(
  cfg: SegmentClientConfig,
  restaurantId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: readonly any[],
): Promise<SegmentTrainResult> {
  return segmentFetch(cfg, '/api/model/train/scored', {
    method: 'POST',
    restaurantId,
    body: { customers: rows },
  });
}

export interface SegmentScoreResult {
  restaurant_id: string;
  is_trained: boolean;
  model_version: string | null;
  feature_version: string;
  customers: Array<{
    customer_id: string;
    segment: string;
    is_trained: boolean;
    method: string;
    recency_days: number | null;
    frequency: number | null;
    monetary: number | null;
  }>;
}

/** Scores every stored customer of the tenant (model-backed or rule tiers). */
export function fetchSegments(
  cfg: SegmentClientConfig,
  restaurantId: string,
): Promise<SegmentScoreResult> {
  return segmentFetch(cfg, '/api/segments', { method: 'GET', restaurantId });
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Segmentation Sync Service — orchestrates the 4th model bridge:
 *
 *   MongoDB (Customer, tenant-scoped)
 *     → customerSegmentExtractor.extractCustomersForSegmentation()
 *     → segmentModelClient.pushCustomersToSegmentService() + trainSegmentModel()
 *     → fetchSegments() → upsert into ml_predictions (modelName 'segment',
 *       predictionType 'customer_uplift', entityId = customer id)
 *
 * Tenant isolation: every entry point requires the VERIFIED restaurantId.
 */

import { extractCustomersForSegmentation } from './customerSegmentExtractor';
import {
  getSegmentClientConfig,
  pushCustomersToSegmentService,
  trainSegmentModel,
  fetchSegments,
  type SegmentTrainResult,
  type SegmentScoreResult,
} from './segmentModelClient';
import MLPrediction from '../../models/intelligence/MLPrediction';

const SEGMENTS_TTL_DAYS = 7;

export interface SegmentSyncResult {
  restaurantId: string;
  extraction: {
    totalCustomers: number;
    extracted: number;
    skippedNoLastVisit: number;
    skippedZeroActivity: number;
  };
  ingest: { accepted: number; total: number; rejected: number } | null;
  training: SegmentTrainResult | null;
  segments: SegmentScoreResult | null;
  configured: boolean;
}

function ttlDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Full extract → push+train → fetch cycle. Gated outcomes are surfaced, never
 * faked: with insufficient data the service returns is_trained=false and rule
 * tiers — still stored, clearly labeled method='rule_based_tier'.
 */
export async function runSegmentSync(restaurantId: string): Promise<SegmentSyncResult> {
  const cfg = getSegmentClientConfig();
  if (!cfg) {
    throw new Error('ML_SEGMENT_BASE_URL is not configured — segmentation sync disabled');
  }

  const { rows, stats } = await extractCustomersForSegmentation(restaurantId);
  const result: SegmentSyncResult = {
    restaurantId,
    extraction: stats,
    ingest: null,
    training: null,
    segments: null,
    configured: true,
  };
  if (rows.length === 0) return result;

  const ingest = await pushCustomersToSegmentService(cfg, restaurantId, rows);
  result.ingest = { accepted: ingest.accepted_count, total: ingest.total_customers, rejected: ingest.rejected_count };

  const training = await trainSegmentModel(cfg, restaurantId, rows);
  result.training = training;

  const segments = await fetchSegments(cfg, restaurantId);
  result.segments = segments;
  return result;
}

/**
 * Stores the tenant's segments into ml_predictions. Rule-tier rows are stored
 * too — method distinguishes them (honest provenance in every doc).
 */
export async function storeSegments(restaurantId: string, segments: SegmentScoreResult): Promise<{ stored: number }> {
  let stored = 0;
  for (const c of segments.customers) {
    await MLPrediction.updateOne(
      {
        restaurantId,
        // Own enum value (audit Phase 14 fix): segmentation rows previously
        // abused modelName 'uplift' / source 'uplift_model', which made them
        // indistinguishable from real uplift predictions.
        modelName: 'segment',
        predictionType: 'customer_segment',
        entityId: c.customer_id,
        predictionFor: new Date().toISOString().slice(0, 10),
      },
      {
        $set: {
          modelVersion: segments.is_trained ? String(segments.model_version) : 'rule_tiers',
          generatedAt: new Date(),
          horizonDays: 0,
          prediction: {
            segment: c.segment,
            method: c.method,
            recencyDays: c.recency_days,
            frequency: c.frequency,
            monetary: c.monetary,
            isTrained: c.is_trained,
          },
          source: 'segment_model',
          expiresAt: ttlDate(SEGMENTS_TTL_DAYS),
        },
      },
      { upsert: true }
    );
    stored += 1;
  }
  return { stored };
}

/** Read path for the UI: latest stored segments for the tenant. */
export async function getStoredSegments(
  restaurantId: string,
  filter: { limit?: number; segment?: string } = {}
): Promise<Array<{
  entityId: string;
  segment: string;
  method: string;
  isTrained: boolean;
  recencyDays: number | null;
  frequency: number | null;
  monetary: number | null;
  modelVersion: string;
  generatedAt: Date;
}>> {
  const q: Record<string, unknown> = {
    restaurantId,
    modelName: 'segment',
    predictionType: 'customer_segment',
  };
  if (filter.segment) q['prediction.segment'] = filter.segment;

  const docs = await MLPrediction.find(q)
    .sort({ generatedAt: -1 })
    .limit(Math.min(Math.max(filter.limit ?? 500, 1), 2000))
    .lean<Record<string, any>>();

  return (docs as Record<string, any>[]).map((d) => ({
    entityId: d.entityId,
    segment: d.prediction?.segment ?? 'unknown',
    method: d.prediction?.method ?? 'unknown',
    isTrained: Boolean(d.prediction?.isTrained),
    recencyDays: d.prediction?.recencyDays ?? null,
    frequency: d.prediction?.frequency ?? null,
    monetary: d.prediction?.monetary ?? null,
    modelVersion: d.modelVersion,
    generatedAt: d.generatedAt,
  }));
}

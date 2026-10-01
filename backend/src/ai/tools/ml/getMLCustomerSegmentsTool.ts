/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * getMLCustomerSegmentsTool.ts — ML-driven customer segments from the
 * segmentation pipeline's stored predictions (modelName='segment',
 * predictionType='customer_segment'). Each row carries isTrained so rule /
 * untrained fallbacks are distinguishable from model output. Aggregate-level
 * only: returns segment distribution, never per-customer PII.
 */

import { z } from 'zod';
import { getStoredSegments } from '../../../modules/ml-pipeline/segmentSyncService';
import { mlFreshnessAgeDays, readEvaluationStatus, type MlModelStatus } from './mlModelStatus';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

export const getMLCustomerSegmentsInputSchema = z
  .object({
    /** Filter to one segment label (e.g. 'Champions'). */
    segment: z.string().min(1).max(60).optional(),
    /** Cap on rows inspected (aggregate distillation caps at 2000). */
    limit: z.number().int().min(1).max(2000).optional(),
  })
  .strict();

export type GetMLCustomerSegmentsInput = z.infer<typeof getMLCustomerSegmentsInputSchema>;

export interface MLSegmentDistribution {
  segment: string;
  customerCount: number;
  trainedCount: number;
  untrainedCount: number;
  avgRecencyDays: number | null;
  avgFrequency: number | null;
  avgMonetary: number | null;
}

export interface MLSegmentsOutput extends MlModelStatus {
  available: true;
  totalCustomersScored: number;
  trainedCustomers: number;
  untrainedCustomers: number;
  segments: MLSegmentDistribution[];
}

export interface MLSegmentsUnavailable extends MlModelStatus {
  available: false;
}

export async function executeGetMLCustomerSegments(
  input: GetMLCustomerSegmentsInput,
  ctx: ToolContext,
): Promise<MLSegmentsOutput | MLSegmentsUnavailable> {
  const generatedAt = new Date().toISOString();
  const evaluation = await readEvaluationStatus(ctx.tenant.restaurantId, 'segment');

  let rows: Awaited<ReturnType<typeof getStoredSegments>>;
  try {
    rows = await getStoredSegments(ctx.tenant.restaurantId, {
      segment: input.segment,
      limit: input.limit,
    });
  } catch {
    return {
      available: false,
      modelId: 'segment',
      evaluationStatus: evaluation.status,
      detail: 'Segment prediction store unavailable.',
      generatedAt,
    };
  }

  if (rows.length === 0) {
    return {
      available: false,
      modelId: 'segment',
      evaluationStatus: evaluation.status,
      detail: 'No stored ML segment predictions. The segmentation service may not be configured or synced yet.',
      generatedAt,
    };
  }

  // Distill to aggregates — the agent must not receive per-customer rows.
  const bySegment = new Map<string, { count: number; trained: number; recency: number[]; freq: number[]; monetary: number[] }>();
  let trainedCustomers = 0;
  for (const r of rows) {
    const bucket = bySegment.get(r.segment) ?? { count: 0, trained: 0, recency: [], freq: [], monetary: [] };
    bucket.count += 1;
    if (r.isTrained) {
      bucket.trained += 1;
      trainedCustomers += 1;
    }
    if (r.recencyDays !== null) bucket.recency.push(r.recencyDays);
    if (r.frequency !== null) bucket.freq.push(r.frequency);
    if (r.monetary !== null) bucket.monetary.push(r.monetary);
    bySegment.set(r.segment, bucket);
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10;

  const newest = rows.reduce((a, b) => (a.generatedAt > b.generatedAt ? a : b));
  return {
    available: true,
    modelId: 'segment',
    modelVersion: newest.modelVersion,
    evaluationStatus: evaluation.status,
    freshnessAgeDays: mlFreshnessAgeDays(newest.generatedAt),
    totalCustomersScored: rows.length,
    trainedCustomers,
    untrainedCustomers: rows.length - trainedCustomers,
    segments: [...bySegment.entries()].map(([segment, b]) => ({
      segment,
      customerCount: b.count,
      trainedCount: b.trained,
      untrainedCount: b.count - b.trained,
      avgRecencyDays: avg(b.recency),
      avgFrequency: avg(b.freq),
      avgMonetary: avg(b.monetary),
    })),
    generatedAt,
  };
}

export const getMLCustomerSegmentsToolDefinition: ToolDefinition<
  GetMLCustomerSegmentsInput,
  MLSegmentsOutput | MLSegmentsUnavailable
> = {
  name: 'getMLCustomerSegments',
  category: 'ml',
  access: 'read',
  meta: {
    description:
      'ML customer segmentation distribution (aggregate only, no PII): segment counts with avg recency/frequency/monetary, plus how many rows are model-trained vs fallback.',
    source: 'modules/ml-pipeline/segmentSyncService.ts → getStoredSegments (stored customer_segment predictions)',
  },
  inputSchema: getMLCustomerSegmentsInputSchema,
  execute: executeGetMLCustomerSegments,
};

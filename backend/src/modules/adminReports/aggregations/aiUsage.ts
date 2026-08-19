/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * aiUsage.ts — AI usage & reliability telemetry (Phase 8, reports/ai-usage-metrics).
 *
 * Answers the operational questions: which AI feature is used and how often,
 * how fast, how often it fails, how often fallback/cache is used, how often
 * explicit cache-busting happens, validation failure rate, token usage and
 * estimated cost. Pure read aggregation over AIUsageLog — never writes.
 *
 * Cost is operational telemetry only (per-model pricing from aiCostConfig,
 * recorded on each usage row); it is not accounting truth.
 */

import { AIUsageLog } from '../../../models';
import { buildWindow, DateWindow } from '../reportQueryBuilder';

export interface AiUsageRow {
  _id: string;
  feature: string;
  requests: number;
  cacheHits: number;
  fallbacks: number;
  cacheBusts: number;
  validationFailures: number;
  latencies: number[];
  tokens: number;
  cost: number;
}

export interface AiUsageMetricsReport {
  summary: {
    totalRequests: number;
    cacheHitRate: number;
    fallbackRate: number;
    validationFailureRate: number;
    cacheBustCount: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    totalTokens: number;
    estimatedCost: number;
  };
  byFeature: Array<{
    feature: string;
    requests: number;
    cacheHitRate: number;
    fallbackRate: number;
    validationFailureRate: number;
    cacheBustCount: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    estimatedCost: number;
  }>;
  byProvider: Array<{ provider: string; requests: number; estimatedCost: number; avgLatencyMs: number }>;
}

function pct(n: number, d: number): number {
  return d > 0 ? Number(((n / d) * 100).toFixed(1)) : 0;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)] || 0);
}

export async function getAiUsageMetrics(
  options: { period?: string | null; from?: string | null; to?: string | null } = {},
): Promise<AiUsageMetricsReport> {
  const window: DateWindow = buildWindow({ period: options.period, from: options.from, to: options.to });

  const rows: AiUsageRow[] = await AIUsageLog.aggregate([
    { $match: { createdAt: { $gte: window.from, $lte: window.to } } },
    {
      $group: {
        _id: '$feature',
        requests: { $sum: 1 },
        cacheHits: { $sum: { $cond: ['$cached', 1, 0] } },
        fallbacks: { $sum: { $cond: ['$fallback', 1, 0] } },
        cacheBusts: { $sum: { $cond: ['$cacheBust', 1, 0] } },
        validationFailures: { $sum: { $cond: ['$validationFailed', 1, 0] } },
        latencies: { $push: '$latencyMs' },
        tokens: { $sum: '$totalTokens' },
        cost: { $sum: '$cost' },
      },
    },
    { $sort: { requests: -1 } },
  ]);

  const providerRows = await AIUsageLog.aggregate([
    { $match: { createdAt: { $gte: window.from, $lte: window.to } } },
    {
      $group: {
        _id: { $ifNull: ['$provider', 'unknown'] },
        requests: { $sum: 1 },
        cost: { $sum: '$cost' },
        latencies: { $push: '$latencyMs' },
      },
    },
    { $sort: { requests: -1 } },
  ]);

  const byFeature = rows.map((r) => ({
    feature: r._id || r.feature,
    requests: r.requests,
    cacheHitRate: pct(r.cacheHits, r.requests),
    fallbackRate: pct(r.fallbacks, r.requests),
    validationFailureRate: pct(r.validationFailures, r.requests),
    cacheBustCount: r.cacheBusts,
    avgLatencyMs: r.requests > 0 ? Math.round(r.latencies.reduce((s, v) => s + (Number(v) || 0), 0) / r.requests) : 0,
    p95LatencyMs: percentile(r.latencies, 95),
    estimatedCost: Number((r.cost || 0).toFixed(4)),
  }));

  const byProvider = providerRows.map((r: any) => ({
    provider: r._id,
    requests: r.requests,
    estimatedCost: Number((r.cost || 0).toFixed(4)),
    avgLatencyMs: r.requests > 0 ? Math.round((r.latencies || []).reduce((s: number, v: any) => s + (Number(v) || 0), 0) / r.requests) : 0,
  }));

  const totalRequests = rows.reduce((s, r) => s + r.requests, 0);
  const totalLatencies = rows.flatMap((r) => r.latencies);
  const totalTokens = rows.reduce((s, r) => s + (r.tokens || 0), 0);
  const estimatedCost = rows.reduce((s, r) => s + (r.cost || 0), 0);
  const cacheHits = rows.reduce((s, r) => s + r.cacheHits, 0);
  const fallbacks = rows.reduce((s, r) => s + r.fallbacks, 0);
  const validationFailures = rows.reduce((s, r) => s + r.validationFailures, 0);
  const cacheBustCount = rows.reduce((s, r) => s + r.cacheBusts, 0);

  return {
    summary: {
      totalRequests,
      cacheHitRate: pct(cacheHits, totalRequests),
      fallbackRate: pct(fallbacks, totalRequests),
      validationFailureRate: pct(validationFailures, totalRequests),
      cacheBustCount,
      avgLatencyMs: totalRequests > 0 ? Math.round(totalLatencies.reduce((s, v) => s + (Number(v) || 0), 0) / totalRequests) : 0,
      p95LatencyMs: percentile(totalLatencies, 95),
      totalTokens,
      estimatedCost: Number(estimatedCost.toFixed(4)),
    },
    byFeature,
    byProvider,
  };
}

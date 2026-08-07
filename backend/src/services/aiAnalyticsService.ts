/**
 * =============================================================================
 *  aiAnalyticsService.ts — AI Usage Analytics Service (Phase 2.7)
 * =============================================================================
 *
 * Purpose:
 *   Provides all aggregation logic for the AI Usage Dashboard.
 *   Every metric originates from the AIUsageLog and VoiceAuditLog collections.
 *   All aggregations use MongoDB aggregation pipelines — no in-memory processing.
 *
 * Pipeline categories:
 *   1. Token analytics     — input/output/total by various dimensions
 *   2. Request analytics   — success/fail/cached/fallback/retried/timeout counts
 *   3. Cost analytics      — cost by model/restaurant/owner/feature/time
 *   4. Latency analytics   — avg/p50/p95/p99/min/max by dimension
 *   5. Error analytics     — error count and rate by type
 *   6. Model analytics     — model usage comparison
 *   7. Restaurant analytics — per-restaurant usage with pagination
 *   8. Owner analytics     — per-owner usage
 *   9. Feature analytics   — per-feature usage and trends
 *  10. Voice analytics     — VoiceAuditLog aggregation
 */

import mongoose from 'mongoose';
import AIUsageLog from '../models/AIUsageLog';
import VoiceAuditLog from '../modules/voice-inventory/models/VoiceAuditLog';
import { getCache, setCache } from './cacheService';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TimeRange {
  start: Date;
  end: Date;
}

export type TimeGroup = 'day' | 'week' | 'month' | 'year';

export interface PaginationParams {
  page: number;
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResult {
  data: any[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  next: number | null;
  previous: number | null;
}

export interface AnalyticsFilter {
  restaurantId?: string;
  ownerId?: string;
  model?: string;
  provider?: string;
  feature?: string;
  success?: boolean;
  failed?: boolean;
  cached?: boolean;
  search?: string;
  dateRange?: TimeRange;
}

const CACHE_TTL = 300; // 5 minutes

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildMatch(filter?: AnalyticsFilter): Record<string, any> {
  const match: Record<string, any> = {};

  if (filter?.restaurantId) {
    match.restaurantId = new mongoose.Types.ObjectId(filter.restaurantId);
  }
  if (filter?.ownerId) {
    match.ownerId = new mongoose.Types.ObjectId(filter.ownerId);
  }
  if (filter?.model) {
    match.model = filter.model;
  }
  if (filter?.provider) {
    match.provider = filter.provider;
  }
  if (filter?.feature) {
    match.feature = filter.feature;
  }
  if (filter?.success !== undefined) {
    match.success = filter.success;
  }
  if (filter?.failed) {
    match.success = false;
  }
  if (filter?.cached !== undefined) {
    match.cached = filter.cached;
  }
  if (filter?.dateRange) {
    match.createdAt = {
      $gte: filter.dateRange.start,
      $lte: filter.dateRange.end,
    };
  }

  return match;
}

function buildDayGroup() {
  return { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
}

function buildDateGroup(groupBy: TimeGroup): Record<string, any> {
  switch (groupBy) {
    case 'week':
      return {
        year: { $isoWeekYear: '$createdAt' },
        period: { $isoWeek: '$createdAt' },
      };
    case 'month':
      return {
        year: { $year: '$createdAt' },
        period: { $month: '$createdAt' },
      };
    case 'year':
      return { year: { $year: '$createdAt' } };
    default:
      return { date: buildDayGroup() };
  }
}

function projectDate(groupBy: TimeGroup): Record<string, any> {
  switch (groupBy) {
    case 'week':
      return {
        $concat: [
          { $toString: '$_id.year' }, '-W',
          { $cond: [{ $lt: ['$_id.period', 10] }, { $concat: ['0', { $toString: '$_id.period' }] }, { $toString: '$_id.period' }] },
        ],
      };
    case 'month':
      return {
        $concat: [
          { $toString: '$_id.year' }, '-',
          { $cond: [{ $lt: ['$_id.period', 10] }, { $concat: ['0', { $toString: '$_id.period' }] }, { $toString: '$_id.period' }] },
        ],
      };
    case 'year':
      return { $toString: '$_id.year' };
    default:
      return '$_id.date';
  }
}

async function paginate(
  Model: mongoose.Model<any>,
  match: Record<string, any>,
  groupId: Record<string, any>,
  groupAccumulators: Record<string, any>,
  projectFields: Record<string, any>,
  sortField: string,
  sortOrder: 1 | -1,
  page: number,
  limit: number
): Promise<PaginatedResult> {
  const skip = (page - 1) * limit;

  const pipeline: Record<string, any>[] = [
    { $match: match },
    { $group: { _id: groupId, ...groupAccumulators } },
    { $project: { _id: 0, ...projectFields } },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [
          { $sort: { [sortField]: sortOrder } },
          { $skip: skip },
          { $limit: limit },
        ],
      },
    },
    {
      $project: {
        data: 1,
        total: { $ifNull: [{ $arrayElemAt: ['$metadata.total', 0] }, 0] },
      },
    },
  ];

  const result = await Model.aggregate(pipeline);
  const total = result[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);

  return {
    data: result[0]?.data || [],
    page,
    limit,
    total,
    totalPages,
    next: page < totalPages ? page + 1 : null,
    previous: page > 1 ? page - 1 : null,
  };
}

// ─── 1. TOKEN ANALYTICS ────────────────────────────────────────────────────

export async function getTokenSummary(filter?: AnalyticsFilter): Promise<{
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  avgTokensPerRequest: number;
  totalRequests: number;
}> {
  const cacheKey = `ai:token:summary:${JSON.stringify(filter || {})}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const match = buildMatch(filter);
  const result = await AIUsageLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalInputTokens: { $sum: '$inputTokens' },
        totalOutputTokens: { $sum: '$outputTokens' },
        totalTokens: { $sum: '$totalTokens' },
        totalRequests: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        totalInputTokens: 1,
        totalOutputTokens: 1,
        totalTokens: 1,
        totalRequests: 1,
        avgTokensPerRequest: {
          $cond: [{ $gt: ['$totalRequests', 0] }, { $divide: ['$totalTokens', '$totalRequests'] }, 0],
        },
      },
    },
  ]);

  const summary = result[0] || { totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, avgTokensPerRequest: 0, totalRequests: 0 };
  await setCache(cacheKey, summary, CACHE_TTL);
  return summary;
}

export async function getTokensByModel(
  filter?: AnalyticsFilter,
  pagination?: PaginationParams
): Promise<PaginatedResult> {
  const page = pagination?.page || 1;
  const limit = pagination?.limit || 20;
  return paginate(
    AIUsageLog,
    buildMatch(filter),
    '$model',
    {
      totalRequests: { $sum: 1 },
      totalInputTokens: { $sum: '$inputTokens' },
      totalOutputTokens: { $sum: '$outputTokens' },
      totalTokens: { $sum: '$totalTokens' },
      totalCost: { $sum: '$cost' },
    },
    { model: '$_id', totalRequests: 1, totalInputTokens: 1, totalOutputTokens: 1, totalTokens: 1, totalCost: 1 },
    'totalTokens',
    pagination?.order === 'asc' ? 1 : -1,
    page,
    limit
  );
}

export async function getTokensByRestaurant(
  filter?: AnalyticsFilter,
  pagination?: PaginationParams
): Promise<PaginatedResult> {
  const page = pagination?.page || 1;
  const limit = pagination?.limit || 20;
  return paginate(
    AIUsageLog,
    buildMatch(filter),
    '$restaurantId',
    {
      totalRequests: { $sum: 1 },
      totalInputTokens: { $sum: '$inputTokens' },
      totalOutputTokens: { $sum: '$outputTokens' },
      totalTokens: { $sum: '$totalTokens' },
      totalCost: { $sum: '$cost' },
    },
    { restaurantId: '$_id', totalRequests: 1, totalInputTokens: 1, totalOutputTokens: 1, totalTokens: 1, totalCost: 1 },
    'totalTokens',
    pagination?.order === 'asc' ? 1 : -1,
    page,
    limit
  );
}

export async function getTokensByOwner(
  filter?: AnalyticsFilter,
  pagination?: PaginationParams
): Promise<PaginatedResult> {
  const page = pagination?.page || 1;
  const limit = pagination?.limit || 20;
  return paginate(
    AIUsageLog,
    buildMatch(filter),
    '$ownerId',
    {
      totalRequests: { $sum: 1 },
      totalInputTokens: { $sum: '$inputTokens' },
      totalOutputTokens: { $sum: '$outputTokens' },
      totalTokens: { $sum: '$totalTokens' },
      totalCost: { $sum: '$cost' },
    },
    { ownerId: '$_id', totalRequests: 1, totalInputTokens: 1, totalOutputTokens: 1, totalTokens: 1, totalCost: 1 },
    'totalTokens',
    pagination?.order === 'asc' ? 1 : -1,
    page,
    limit
  );
}

export async function getTokensByFeature(
  filter?: AnalyticsFilter,
  pagination?: PaginationParams
): Promise<PaginatedResult> {
  const page = pagination?.page || 1;
  const limit = pagination?.limit || 20;
  return paginate(
    AIUsageLog,
    buildMatch(filter),
    '$feature',
    {
      totalRequests: { $sum: 1 },
      totalInputTokens: { $sum: '$inputTokens' },
      totalOutputTokens: { $sum: '$outputTokens' },
      totalTokens: { $sum: '$totalTokens' },
      totalCost: { $sum: '$cost' },
    },
    { feature: '$_id', totalRequests: 1, totalInputTokens: 1, totalOutputTokens: 1, totalTokens: 1, totalCost: 1 },
    'totalTokens',
    pagination?.order === 'asc' ? 1 : -1,
    page,
    limit
  );
}

export async function getTokenTimeSeries(
  groupBy: TimeGroup = 'day',
  filter?: AnalyticsFilter
): Promise<Array<{ date: string; inputTokens: number; outputTokens: number; totalTokens: number }>> {
  const cacheKey = `ai:token:timeseries:${groupBy}:${JSON.stringify(filter || {})}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const match = buildMatch(filter);
  const result = await AIUsageLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: buildDateGroup(groupBy),
        inputTokens: { $sum: '$inputTokens' },
        outputTokens: { $sum: '$outputTokens' },
        totalTokens: { $sum: '$totalTokens' },
      },
    },
    { $project: { date: projectDate(groupBy), inputTokens: 1, outputTokens: 1, totalTokens: 1 } },
    { $sort: { date: 1 } },
  ]);

  await setCache(cacheKey, result, CACHE_TTL);
  return result;
}

// ─── 2. REQUEST ANALYTICS ──────────────────────────────────────────────────

export async function getRequestSummary(filter?: AnalyticsFilter): Promise<{
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cachedResponses: number;
  fallbackRequests: number;
  retriedRequests: number;
  cancelledRequests: number;
  timeoutRequests: number;
}> {
  const cacheKey = `ai:request:summary:${JSON.stringify(filter || {})}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const match = buildMatch(filter);
  const result = await AIUsageLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        successfulRequests: { $sum: { $cond: ['$success', 1, 0] } },
        failedRequests: { $sum: { $cond: ['$success', 0, 1] } },
        cachedResponses: { $sum: { $cond: ['$cached', 1, 0] } },
        fallbackRequests: { $sum: { $cond: ['$fallback', 1, 0] } },
        retriedRequests: { $sum: { $cond: ['$retried', 1, 0] } },
        cancelledRequests: { $sum: { $cond: ['$cancelled', 1, 0] } },
        timeoutRequests: { $sum: { $cond: ['$timeout', 1, 0] } },
      },
    },
    { $project: { _id: 0, totalRequests: 1, successfulRequests: 1, failedRequests: 1, cachedResponses: 1, fallbackRequests: 1, retriedRequests: 1, cancelledRequests: 1, timeoutRequests: 1 } },
  ]);

  const summary = result[0] || { totalRequests: 0, successfulRequests: 0, failedRequests: 0, cachedResponses: 0, fallbackRequests: 0, retriedRequests: 0, cancelledRequests: 0, timeoutRequests: 0 };
  await setCache(cacheKey, summary, CACHE_TTL);
  return summary;
}

export async function getRequestTimeSeries(
  groupBy: TimeGroup = 'day',
  filter?: AnalyticsFilter
): Promise<Array<{ date: string; total: number; successful: number; failed: number; cached: number }>> {
  const cacheKey = `ai:request:timeseries:${groupBy}:${JSON.stringify(filter || {})}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const match = buildMatch(filter);
  const result = await AIUsageLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: buildDateGroup(groupBy),
        total: { $sum: 1 },
        successful: { $sum: { $cond: ['$success', 1, 0] } },
        failed: { $sum: { $cond: ['$success', 0, 1] } },
        cached: { $sum: { $cond: ['$cached', 1, 0] } },
      },
    },
    { $project: { date: projectDate(groupBy), total: 1, successful: 1, failed: 1, cached: 1 } },
    { $sort: { date: 1 } },
  ]);

  await setCache(cacheKey, result, CACHE_TTL);
  return result;
}

// ─── 3. COST ANALYTICS ─────────────────────────────────────────────────────

export async function getCostSummary(filter?: AnalyticsFilter): Promise<{
  totalCost: number;
  costByModel: Array<{ model: string; cost: number }>;
  costPerRequest: number;
}> {
  const cacheKey = `ai:cost:summary:${JSON.stringify(filter || {})}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const match = buildMatch(filter);
  const result = await AIUsageLog.aggregate([
    { $match: match },
    { $group: { _id: null, totalCost: { $sum: '$cost' }, totalRequests: { $sum: 1 } } },
    {
      $project: {
        _id: 0, totalCost: 1, totalRequests: 1,
        costPerRequest: { $cond: [{ $gt: ['$totalRequests', 0] }, { $divide: ['$totalCost', '$totalRequests'] }, 0] },
      },
    },
  ]);

  const costByModel = await AIUsageLog.aggregate([
    { $match: match },
    { $group: { _id: '$model', cost: { $sum: '$cost' } } },
    { $match: { cost: { $gt: 0 } } },
    { $project: { _id: 0, model: '$_id', cost: 1 } },
    { $sort: { cost: -1 } },
  ]);

  const summary = result[0] || { totalCost: 0, totalRequests: 0, costPerRequest: 0 };
  const output = { totalCost: summary.totalCost, costByModel, costPerRequest: summary.costPerRequest };
  await setCache(cacheKey, output, CACHE_TTL);
  return output;
}

export async function getCostTimeSeries(groupBy: TimeGroup = 'day', filter?: AnalyticsFilter): Promise<Array<{ date: string; cost: number }>> {
  const cacheKey = `ai:cost:timeseries:${groupBy}:${JSON.stringify(filter || {})}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const match = buildMatch(filter);
  const result = await AIUsageLog.aggregate([
    { $match: match },
    { $group: { _id: buildDateGroup(groupBy), cost: { $sum: '$cost' } } },
    { $project: { date: projectDate(groupBy), cost: 1 } },
    { $sort: { date: 1 } },
  ]);

  await setCache(cacheKey, result, CACHE_TTL);
  return result;
}

export async function getCostByModel(filter?: AnalyticsFilter): Promise<Array<{ model: string; cost: number; requests: number }>> {
  const match = buildMatch(filter);
  return AIUsageLog.aggregate([
    { $match: match },
    { $group: { _id: '$model', cost: { $sum: '$cost' }, requests: { $sum: 1 } } },
    { $project: { _id: 0, model: '$_id', cost: 1, requests: 1 } },
    { $sort: { cost: -1 } },
  ]);
}

export async function getCostByFeature(filter?: AnalyticsFilter): Promise<Array<{ feature: string; cost: number; requests: number }>> {
  const match = buildMatch(filter);
  return AIUsageLog.aggregate([
    { $match: match },
    { $group: { _id: '$feature', cost: { $sum: '$cost' }, requests: { $sum: 1 } } },
    { $project: { _id: 0, feature: '$_id', cost: 1, requests: 1 } },
    { $sort: { cost: -1 } },
  ]);
}

export async function getCostByRestaurant(filter?: AnalyticsFilter, pagination?: PaginationParams): Promise<PaginatedResult> {
  const page = pagination?.page || 1;
  const limit = pagination?.limit || 20;
  return paginate(AIUsageLog, buildMatch(filter), '$restaurantId', { cost: { $sum: '$cost' }, requests: { $sum: 1 } }, { restaurantId: '$_id', cost: 1, requests: 1 }, 'cost', pagination?.order === 'asc' ? 1 : -1, page, limit);
}

export async function getCostByOwner(filter?: AnalyticsFilter, pagination?: PaginationParams): Promise<PaginatedResult> {
  const page = pagination?.page || 1;
  const limit = pagination?.limit || 20;
  return paginate(AIUsageLog, buildMatch(filter), '$ownerId', { cost: { $sum: '$cost' }, requests: { $sum: 1 } }, { ownerId: '$_id', cost: 1, requests: 1 }, 'cost', pagination?.order === 'asc' ? 1 : -1, page, limit);
}

// ─── 4. LATENCY ANALYTICS ──────────────────────────────────────────────────

export async function getLatencySummary(filter?: AnalyticsFilter): Promise<{
  averageLatency: number;
  medianLatency: number;
  p95: number;
  p99: number;
  fastestRequest: number;
  slowestRequest: number;
  totalRequests: number;
}> {
  const cacheKey = `ai:latency:summary:${JSON.stringify(filter || {})}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const match = buildMatch(filter);
  const result = await AIUsageLog.aggregate([
    { $match: match },
    { $group: { _id: null, totalRequests: { $sum: 1 }, fastestRequest: { $min: '$latencyMs' }, slowestRequest: { $max: '$latencyMs' }, avgLatency: { $avg: '$latencyMs' } } },
  ]);

  const latencyValues = await AIUsageLog.aggregate([
    { $match: match },
    { $sort: { latencyMs: 1 } },
    { $group: { _id: null, values: { $push: '$latencyMs' }, count: { $sum: 1 } } },
  ]);

  let medianLatency = 0, p95 = 0, p99 = 0;
  if (latencyValues.length > 0 && latencyValues[0].count > 0) {
    const { values, count } = latencyValues[0];
    medianLatency = values[Math.floor(count * 0.5)] || 0;
    p95 = values[Math.floor(count * 0.95)] || 0;
    p99 = values[Math.floor(count * 0.99)] || 0;
  }

  const s = result[0] || { totalRequests: 0, fastestRequest: 0, slowestRequest: 0, avgLatency: 0 };
  const output = {
    averageLatency: Math.round(s.avgLatency || 0),
    medianLatency, p95, p99,
    fastestRequest: s.fastestRequest || 0,
    slowestRequest: s.slowestRequest || 0,
    totalRequests: s.totalRequests || 0,
  };
  await setCache(cacheKey, output, CACHE_TTL);
  return output;
}

export async function getLatencyByModel(filter?: AnalyticsFilter): Promise<Array<{ model: string; averageLatency: number; minLatency: number; maxLatency: number; requests: number }>> {
  const match = buildMatch(filter);
  return AIUsageLog.aggregate([
    { $match: match },
    { $group: { _id: '$model', requests: { $sum: 1 }, avgLatency: { $avg: '$latencyMs' }, minLatency: { $min: '$latencyMs' }, maxLatency: { $max: '$latencyMs' } } },
    { $project: { _id: 0, model: '$_id', requests: 1, averageLatency: { $round: ['$avgLatency', 0] }, minLatency: 1, maxLatency: 1 } },
    { $sort: { averageLatency: -1 } },
  ]);
}

export async function getLatencyByFeature(filter?: AnalyticsFilter): Promise<Array<{ feature: string; averageLatency: number; requests: number }>> {
  const match = buildMatch(filter);
  return AIUsageLog.aggregate([
    { $match: match },
    { $group: { _id: '$feature', requests: { $sum: 1 }, avgLatency: { $avg: '$latencyMs' } } },
    { $project: { _id: 0, feature: '$_id', requests: 1, averageLatency: { $round: ['$avgLatency', 0] } } },
    { $sort: { averageLatency: -1 } },
  ]);
}

export async function getLatencyTimeSeries(groupBy: TimeGroup = 'day', filter?: AnalyticsFilter): Promise<Array<{ date: string; averageLatency: number; maxLatency: number }>> {
  const cacheKey = `ai:latency:timeseries:${groupBy}:${JSON.stringify(filter || {})}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const match = buildMatch(filter);
  const result = await AIUsageLog.aggregate([
    { $match: match },
    { $group: { _id: buildDateGroup(groupBy), avgLatency: { $avg: '$latencyMs' }, maxLatency: { $max: '$latencyMs' } } },
    { $project: { date: projectDate(groupBy), averageLatency: { $round: ['$avgLatency', 0] }, maxLatency: 1 } },
    { $sort: { date: 1 } },
  ]);

  await setCache(cacheKey, result, CACHE_TTL);
  return result;
}

// ─── 5. ERROR ANALYTICS ────────────────────────────────────────────────────

export async function getErrorSummary(filter?: AnalyticsFilter): Promise<{
  totalFailures: number;
  errorRate: number;
  totalRequests: number;
  errorsByType: Array<{ errorType: string; count: number }>;
}> {
  const cacheKey = `ai:error:summary:${JSON.stringify(filter || {})}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const match = buildMatch(filter);

  const errorTypes = await AIUsageLog.aggregate([
    { $match: { ...match, success: false } },
    { $group: { _id: { $ifNull: ['$errorType', 'unknown'] }, count: { $sum: 1 } } },
    { $project: { _id: 0, errorType: '$_id', count: 1 } },
    { $sort: { count: -1 } },
  ]);

  const totals = await AIUsageLog.aggregate([
    { $match: match },
    { $group: { _id: null, totalRequests: { $sum: 1 }, totalFailures: { $sum: { $cond: ['$success', 0, 1] } } } },
  ]);

  const t = totals[0] || { totalRequests: 0, totalFailures: 0 };
  const output = {
    totalFailures: t.totalFailures,
    errorRate: t.totalRequests > 0 ? parseFloat(((t.totalFailures / t.totalRequests) * 100).toFixed(2)) : 0,
    totalRequests: t.totalRequests,
    errorsByType: errorTypes,
  };
  await setCache(cacheKey, output, CACHE_TTL);
  return output;
}

// ─── 6. MODEL ANALYTICS ────────────────────────────────────────────────────

export async function getModelAnalytics(filter?: AnalyticsFilter): Promise<Array<{
  model: string;
  requests: number;
  totalTokens: number;
  totalCost: number;
  averageLatency: number;
  successRate: number;
  errorRate: number;
  fallbackUsage: number;
}>> {
  const match = buildMatch(filter);
  return AIUsageLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$model',
        requests: { $sum: 1 },
        totalTokens: { $sum: '$totalTokens' },
        totalCost: { $sum: '$cost' },
        avgLatency: { $avg: '$latencyMs' },
        successful: { $sum: { $cond: ['$success', 1, 0] } },
        fallbackUsage: { $sum: { $cond: ['$fallback', 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        model: '$_id',
        requests: 1,
        totalTokens: 1,
        totalCost: 1,
        averageLatency: { $round: ['$avgLatency', 0] },
        successRate: { $round: [{ $multiply: [{ $divide: ['$successful', '$requests'] }, 100] }, 1] },
        errorRate: { $round: [{ $multiply: [{ $subtract: [1, { $divide: ['$successful', '$requests'] }] }, 100] }, 1] },
        fallbackUsage: 1,
      },
    },
    { $sort: { requests: -1 } },
  ]);
}

// ─── 7. RESTAURANT AI USAGE ────────────────────────────────────────────────

export async function getRestaurantAnalytics(
  filter?: AnalyticsFilter,
  pagination?: PaginationParams
): Promise<PaginatedResult> {
  const page = pagination?.page || 1;
  const limit = pagination?.limit || 20;
  const match = buildMatch(filter);

  // Add search filter if provided
  if (filter?.search) {
    // Search will be applied at controller level with a $lookup on restaurants
  }

  return paginate(
    AIUsageLog,
    match,
    '$restaurantId',
    {
      totalRequests: { $sum: 1 },
      totalTokens: { $sum: '$totalTokens' },
      totalCost: { $sum: '$cost' },
      successful: { $sum: { $cond: ['$success', 1, 0] } },
      avgLatency: { $avg: '$latencyMs' },
    },
    {
      restaurantId: '$_id',
      totalRequests: 1,
      totalTokens: 1,
      totalCost: 1,
      successRate: { $round: [{ $multiply: [{ $divide: ['$successful', { $cond: [{ $gt: ['$totalRequests', 0] }, '$totalRequests', 1] }] }, 100] }, 1] },
      errorRate: { $round: [{ $multiply: [{ $subtract: [1, { $divide: ['$successful', { $cond: [{ $gt: ['$totalRequests', 0] }, '$totalRequests', 1] }] }] }, 100] }, 1] },
      averageLatency: { $round: ['$avgLatency', 0] },
    },
    pagination?.sort || 'totalRequests',
    pagination?.order === 'asc' ? 1 : -1,
    page,
    limit
  );
}

export async function getRestaurantDetail(
  restaurantId: string,
  filter?: AnalyticsFilter
): Promise<{
  requests: number;
  tokens: number;
  cost: number;
  modelsUsed: string[];
  featuresUsed: string[];
  errorRate: number;
  averageLatency: number;
}> {
  const match = buildMatch({ ...filter, restaurantId });

  const result = await AIUsageLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        requests: { $sum: 1 },
        tokens: { $sum: '$totalTokens' },
        cost: { $sum: '$cost' },
        modelsUsed: { $addToSet: '$model' },
        featuresUsed: { $addToSet: '$feature' },
        successful: { $sum: { $cond: ['$success', 1, 0] } },
        avgLatency: { $avg: '$latencyMs' },
      },
    },
    {
      $project: {
        _id: 0,
        requests: 1,
        tokens: 1,
        cost: 1,
        modelsUsed: 1,
        featuresUsed: 1,
        errorRate: { $round: [{ $multiply: [{ $subtract: [1, { $divide: ['$successful', { $cond: [{ $gt: ['$requests', 0] }, '$requests', 1] }] }] }, 100] }, 1] },
        averageLatency: { $round: ['$avgLatency', 0] },
      },
    },
  ]);

  return result[0] || { requests: 0, tokens: 0, cost: 0, modelsUsed: [], featuresUsed: [], errorRate: 0, averageLatency: 0 };
}

// ─── 8. OWNER AI USAGE ────────────────────────────────────────────────────

export async function getOwnerAnalytics(
  filter?: AnalyticsFilter,
  pagination?: PaginationParams
): Promise<PaginatedResult> {
  const page = pagination?.page || 1;
  const limit = pagination?.limit || 20;
  const match = buildMatch(filter);

  return paginate(
    AIUsageLog,
    match,
    '$ownerId',
    {
      totalRequests: { $sum: 1 },
      totalTokens: { $sum: '$totalTokens' },
      totalCost: { $sum: '$cost' },
      successful: { $sum: { $cond: ['$success', 1, 0] } },
      avgLatency: { $avg: '$latencyMs' },
      uniqueRestaurants: { $addToSet: '$restaurantId' },
    },
    {
      ownerId: '$_id',
      totalRequests: 1,
      totalTokens: 1,
      totalCost: 1,
      activeRestaurants: { $size: '$uniqueRestaurants' },
      successRate: { $round: [{ $multiply: [{ $divide: ['$successful', { $cond: [{ $gt: ['$totalRequests', 0] }, '$totalRequests', 1] }] }, 100] }, 1] },
      errorRate: { $round: [{ $multiply: [{ $subtract: [1, { $divide: ['$successful', { $cond: [{ $gt: ['$totalRequests', 0] }, '$totalRequests', 1] }] }] }, 100] }, 1] },
      averageLatency: { $round: ['$avgLatency', 0] },
    },
    pagination?.sort || 'totalRequests',
    pagination?.order === 'asc' ? 1 : -1,
    page,
    limit
  );
}

export async function getOwnerDetail(
  ownerId: string,
  filter?: AnalyticsFilter
): Promise<{
  requests: number;
  tokens: number;
  cost: number;
  activeRestaurants: number;
  modelsUsed: string[];
  featuresUsed: string[];
  errorRate: number;
}> {
  const match = buildMatch({ ...filter, ownerId });

  const result = await AIUsageLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        requests: { $sum: 1 },
        tokens: { $sum: '$totalTokens' },
        cost: { $sum: '$cost' },
        modelsUsed: { $addToSet: '$model' },
        featuresUsed: { $addToSet: '$feature' },
        restaurants: { $addToSet: '$restaurantId' },
        successful: { $sum: { $cond: ['$success', 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        requests: 1,
        tokens: 1,
        cost: 1,
        activeRestaurants: { $size: '$restaurants' },
        modelsUsed: 1,
        featuresUsed: 1,
        errorRate: { $round: [{ $multiply: [{ $subtract: [1, { $divide: ['$successful', { $cond: [{ $gt: ['$requests', 0] }, '$requests', 1] }] }] }, 100] }, 1] },
      },
    },
  ]);

  return result[0] || { requests: 0, tokens: 0, cost: 0, activeRestaurants: 0, modelsUsed: [], featuresUsed: [], errorRate: 0 };
}

// ─── 9. FEATURE ANALYTICS ─────────────────────────────────────────────────

export async function getFeatureAnalytics(
  filter?: AnalyticsFilter,
  pagination?: PaginationParams
): Promise<PaginatedResult> {
  const page = pagination?.page || 1;
  const limit = pagination?.limit || 20;
  const match = buildMatch(filter);

  const skip = (page - 1) * limit;

  const pipeline: Record<string, any>[] = [
    { $match: match },
    {
      $group: {
        _id: '$feature',
        totalRequests: { $sum: 1 },
        totalTokens: { $sum: '$totalTokens' },
        totalCost: { $sum: '$cost' },
        successful: { $sum: { $cond: ['$success', 1, 0] } },
        avgLatency: { $avg: '$latencyMs' },
      },
    },
    {
      $project: {
        _id: 0,
        feature: '$_id',
        totalRequests: 1,
        totalTokens: 1,
        totalCost: 1,
        successRate: { $round: [{ $multiply: [{ $divide: ['$successful', { $cond: [{ $gt: ['$totalRequests', 0] }, '$totalRequests', 1] }] }, 100] }, 1] },
        errorRate: { $round: [{ $multiply: [{ $subtract: [1, { $divide: ['$successful', { $cond: [{ $gt: ['$totalRequests', 0] }, '$totalRequests', 1] }] }] }, 100] }, 1] },
        averageLatency: { $round: ['$avgLatency', 0] },
      },
    },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [
          { $sort: pagination?.sort ? { [pagination.sort]: pagination?.order === 'asc' ? 1 : -1 } : { totalTokens: -1 } },
          { $skip: skip },
          { $limit: limit },
        ],
      },
    },
    {
      $project: {
        data: 1,
        total: { $ifNull: [{ $arrayElemAt: ['$metadata.total', 0] }, 0] },
      },
    },
  ];

  const result = await AIUsageLog.aggregate(pipeline);
  const total = result[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);

  return {
    data: result[0]?.data || [],
    page,
    limit,
    total,
    totalPages,
    next: page < totalPages ? page + 1 : null,
    previous: page > 1 ? page - 1 : null,
  };
}

// ─── 10. VOICE AI ANALYTICS ───────────────────────────────────────────────

export async function getVoiceAnalyticsSummary(filter?: AnalyticsFilter): Promise<{
  totalVoiceRequests: number;
  successfulRecognition: number;
  failedRecognition: number;
  averageProcessingTime: number;
  totalTokenUsage: number;
  totalCost: number;
  restaurantUsage: number;
  ownerUsage: number;
  dailyTrends: Array<{ date: string; requests: number; successRate: number }>;
}> {
  const cacheKey = `ai:voice:summary:${JSON.stringify(filter || {})}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const match: Record<string, any> = {};
  if (filter?.restaurantId) match.restaurantId = new mongoose.Types.ObjectId(filter.restaurantId);
  if (filter?.dateRange) match.createdAt = { $gte: filter.dateRange.start, $lte: filter.dateRange.end };

  // Get voice summary from VoiceAuditLog
  const voiceSummary = await VoiceAuditLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        successfulRecognition: { $sum: { $cond: [{ $eq: ['$confirmationStatus', 'confirmed'] }, 1, 0] } },
        failedRecognition: { $sum: { $cond: [{ $eq: ['$confirmationStatus', 'rejected'] }, 1, 0] } },
        avgLatency: { $avg: '$latencyMs' },
        uniqueRestaurants: { $addToSet: '$restaurantId' },
      },
    },
    {
      $project: {
        _id: 0,
        totalRequests: 1,
        successfulRecognition: 1,
        failedRecognition: 1,
        averageProcessingTime: { $round: ['$avgLatency', 0] },
        restaurantUsage: { $size: '$uniqueRestaurants' },
      },
    },
  ]);

  // Get AI usage log voice entries for token/cost
  const aiVoiceTokens = await AIUsageLog.aggregate([
    { $match: { ...match, feature: 'voice-ai' } },
    { $group: { _id: null, totalTokens: { $sum: '$totalTokens' }, totalCost: { $sum: '$cost' }, owners: { $addToSet: '$ownerId' } } },
  ]);

  // Get daily trends from AIUsageLog for voice
  const dailyTrends = await AIUsageLog.aggregate([
    { $match: { ...match, feature: 'voice-ai' } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        requests: { $sum: 1 },
        successful: { $sum: { $cond: ['$success', 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        date: '$_id',
        requests: 1,
        successRate: { $round: [{ $multiply: [{ $divide: ['$successful', { $cond: [{ $gt: ['$requests', 0] }, '$requests', 1] }] }, 100] }, 1] },
      },
    },
    { $sort: { date: 1 } },
  ]);

  const voice = voiceSummary[0] || { totalRequests: 0, successfulRecognition: 0, failedRecognition: 0, averageProcessingTime: 0, restaurantUsage: 0 };
  const tokens = aiVoiceTokens[0] || { totalTokens: 0, totalCost: 0, owners: [] };

  const output = {
    totalVoiceRequests: voice.totalRequests,
    successfulRecognition: voice.successfulRecognition,
    failedRecognition: voice.failedRecognition,
    averageProcessingTime: voice.averageProcessingTime,
    totalTokenUsage: tokens.totalTokens,
    totalCost: tokens.totalCost,
    restaurantUsage: voice.restaurantUsage,
    ownerUsage: tokens.owners.length,
    dailyTrends,
  };

  await setCache(cacheKey, output, CACHE_TTL);
  return output;
}

// ─── 11. DASHBOARD SUMMARY ────────────────────────────────────────────────

export async function getDashboardSummary(filter?: AnalyticsFilter): Promise<{
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokens: number;
  totalCost: number;
  averageLatency: number;
  activeModels: number;
  activeFeatures: number;
  activeRestaurants: number;
  activeOwners: number;
  cachedRate: number;
  fallbackRate: number;
  errorRate: number;
}> {
  const cacheKey = `ai:dashboard:summary:${JSON.stringify(filter || {})}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const match = buildMatch(filter);

  const result = await AIUsageLog.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        successfulRequests: { $sum: { $cond: ['$success', 1, 0] } },
        failedRequests: { $sum: { $cond: ['$success', 0, 1] } },
        totalTokens: { $sum: '$totalTokens' },
        totalCost: { $sum: '$cost' },
        avgLatency: { $avg: '$latencyMs' },
        cachedResponses: { $sum: { $cond: ['$cached', 1, 0] } },
        fallbackResponses: { $sum: { $cond: ['$fallback', 1, 0] } },
        models: { $addToSet: '$model' },
        features: { $addToSet: '$feature' },
        restaurants: { $addToSet: '$restaurantId' },
        owners: { $addToSet: '$ownerId' },
      },
    },
    {
      $project: {
        _id: 0,
        totalRequests: 1,
        successfulRequests: 1,
        failedRequests: 1,
        totalTokens: 1,
        totalCost: 1,
        averageLatency: { $round: ['$avgLatency', 0] },
        activeModels: { $size: '$models' },
        activeFeatures: { $size: '$features' },
        activeRestaurants: { $size: '$restaurants' },
        activeOwners: { $size: '$owners' },
        cachedRate: { $round: [{ $multiply: [{ $divide: ['$cachedResponses', { $cond: [{ $gt: ['$totalRequests', 0] }, '$totalRequests', 1] }] }, 100] }, 1] },
        fallbackRate: { $round: [{ $multiply: [{ $divide: ['$fallbackResponses', { $cond: [{ $gt: ['$totalRequests', 0] }, '$totalRequests', 1] }] }, 100] }, 1] },
        errorRate: { $round: [{ $multiply: [{ $divide: ['$failedRequests', { $cond: [{ $gt: ['$totalRequests', 0] }, '$totalRequests', 1] }] }, 100] }, 1] },
      },
    },
  ]);

  const output = result[0] || {
    totalRequests: 0, successfulRequests: 0, failedRequests: 0,
    totalTokens: 0, totalCost: 0, averageLatency: 0,
    activeModels: 0, activeFeatures: 0, activeRestaurants: 0, activeOwners: 0,
    cachedRate: 0, fallbackRate: 0, errorRate: 0,
  };

  await setCache(cacheKey, output, CACHE_TTL);
  return output;
}

// ─── 12. SEARCH ────────────────────────────────────────────────────────────

export async function searchAnalytics(
  query: string,
  filter?: AnalyticsFilter,
  pagination?: PaginationParams
): Promise<PaginatedResult> {
  const page = pagination?.page || 1;
  const limit = pagination?.limit || 20;
  const match = buildMatch(filter);

  // Add text search across feature, model, provider fields
  match.$or = [
    { feature: { $regex: query, $options: 'i' } },
    { model: { $regex: query, $options: 'i' } },
    { provider: { $regex: query, $options: 'i' } },
  ];

  const skip = (page - 1) * limit;

  // Return the matched records (paginated, newest first)
  const recordsPipeline: Record<string, any>[] = [
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        restaurantId: 1,
        ownerId: 1,
        feature: 1,
        model: 1,
        provider: 1,
        success: 1,
        cached: 1,
        fallback: 1,
        latencyMs: 1,
        totalTokens: 1,
        cost: 1,
        errorType: 1,
        createdAt: 1,
      },
    },
  ];

  const [records, total] = await Promise.all([
    AIUsageLog.aggregate(recordsPipeline),
    AIUsageLog.countDocuments(match),
  ]);

  const totalPages = Math.ceil(total / limit);

  return {
    data: records,
    page,
    limit,
    total,
    totalPages,
    next: page < totalPages ? page + 1 : null,
    previous: page > 1 ? page - 1 : null,
  };
}

export { buildMatch, paginate };

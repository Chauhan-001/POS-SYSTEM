/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AnalyticsService — Voice analytics for the conversational inventory system.
 *
 * Tracks resolution method distribution, confidence trends, most-spoken
 * products, alias usage frequency, and failed recognition patterns.
 *
 * All data is read from the VoiceAuditLog collection (append-only).
 * No separate analytics collection is needed — the logs are the source of truth.
 */

import mongoose from 'mongoose';
import VoiceAuditLog from '../models/VoiceAuditLog';
import Product from '../../../models/Product';
import type { VoiceAnalyticsSummary } from '../types';

// ====================================================================
// QUERY RANGES
// ====================================================================

export interface AnalyticsPeriod {
  from?: Date;
  to?: Date;
}

const DEFAULT_PERIOD_DAYS = 30;

function buildPeriodFilter(restaurantId: string, period?: AnalyticsPeriod) {
  const filter: any = {
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  };

  if (period?.from || period?.to) {
    filter.createdAt = {};
    if (period.from) filter.createdAt.$gte = period.from;
    if (period.to) filter.createdAt.$lte = period.to;
  } else {
    // Default: last 30 days
    filter.createdAt = {
      $gte: new Date(Date.now() - DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000),
    };
  }

  return filter;
}

// ====================================================================
// ANALYTICS SERVICE
// ====================================================================

/**
 * Get comprehensive voice analytics for a restaurant.
 */
export async function getAnalytics(
  restaurantId: string,
  period?: AnalyticsPeriod
): Promise<VoiceAnalyticsSummary> {
  const oid = new mongoose.Types.ObjectId(restaurantId);
  const filter = buildPeriodFilter(restaurantId, period);
  const allTimeFilter: any = { restaurantId: oid };

  // Build the period filter for createdAt
  const createdAtFilter: any = {};
  if (period?.from) createdAtFilter.$gte = period.from;
  if (period?.to) createdAtFilter.$lte = period.to;

  try {
    // ─── Total interactions ───────────────────────────────────────
    const [totalInteractions, periodInteractions] = await Promise.all([
      VoiceAuditLog.countDocuments(allTimeFilter),
      period?.from || period?.to
        ? VoiceAuditLog.countDocuments({ ...allTimeFilter, createdAt: createdAtFilter })
        : Promise.resolve(0),
    ]);

    // ─── Average confidence ───────────────────────────────────────
    const confidenceAgg = await VoiceAuditLog.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          avgConfidence: { $avg: '$confidence' },
          avgLatency: { $avg: '$latencyMs' },
        },
      },
    ]);

    const averageConfidence = confidenceAgg[0]?.avgConfidence || 0;
    const averageLatencyMs = confidenceAgg[0]?.avgLatency || 0;

    // ─── Resolution method distribution ──────────────────────────
    const methodAgg = await VoiceAuditLog.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$matchingMethod',
          count: { $sum: 1 },
        },
      },
    ]);

    const resolutionMethods: Record<string, number> = {};
    for (const row of methodAgg) {
      resolutionMethods[row._id || 'unknown'] = row.count;
    }

    // ─── Intent distribution ─────────────────────────────────────
    const intentAgg = await VoiceAuditLog.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$intent',
          count: { $sum: 1 },
        },
      },
    ]);

    const intentDistribution: Record<string, number> = {};
    for (const row of intentAgg) {
      intentDistribution[row._id || 'unknown'] = row.count;
    }

    // ─── Language distribution ───────────────────────────────────
    const langAgg = await VoiceAuditLog.aggregate([
      { $match: filter },
      { $match: { 'parsedJson.language': { $exists: true } } },
      {
        $group: {
          _id: '$parsedJson.language',
          count: { $sum: 1 },
        },
      },
    ]);

    const languageDistribution: Record<string, number> = {};
    for (const row of langAgg) {
      languageDistribution[row._id || 'unknown'] = row.count;
    }

    // ─── Top products (from audit log item names) ────────────────
    const topProductsAgg = await VoiceAuditLog.aggregate([
      { $match: filter },
      { $unwind: '$items' },
      {
        $group: {
          _id: { name: '$items.name' },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);

    const topProducts = topProductsAgg.map((row) => ({
      productName: row._id.name,
      count: row.count,
    }));

    // ─── Top aliases ─────────────────────────────────────────────
    const topAliasesAgg = await VoiceAuditLog.aggregate([
      { $match: filter },
      { $match: { 'parsedJson.aliasUsed': { $exists: true } } },
      {
        $group: {
          _id: '$parsedJson.aliasUsed',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);

    const topAliases = topAliasesAgg
      .filter((r) => r._id)
      .map((row) => ({
        alias: row._id,
        count: row.count,
      }));

    // ─── Frequently corrected products ───────────────────────────
    const correctionsAgg = await VoiceAuditLog.aggregate([
      {
        $match: {
          ...filter,
          confirmationStatus: 'clarified',
        },
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          correctionCount: { $sum: 1 },
        },
      },
      { $sort: { correctionCount: -1 } },
      { $limit: 20 },
    ]);

    const frequentlyCorrected = correctionsAgg.map((row) => ({
      productName: row._id,
      correctionCount: row.correctionCount,
    }));

    // ─── Failed recognitions ─────────────────────────────────────
    const failedRecognitions = await VoiceAuditLog.countDocuments({
      ...filter,
      $or: [
        { confidence: { $lt: 0.3 } },
        { intent: 'unknown' },
      ],
    });

    // ─── Period info ─────────────────────────────────────────────
    const fromDate = period?.from || filter.createdAt?.$gte;
    const toDate = period?.to || filter.createdAt?.$lte;

    return {
      totalInteractions,
      periodInteractions: periodInteractions || totalInteractions,
      averageConfidence,
      resolutionMethods,
      topProducts,
      topAliases,
      frequentlyCorrected,
      failedRecognitions,
      averageLatencyMs,
      intentDistribution,
      languageDistribution,
      period: {
        from: fromDate,
        to: toDate,
      },
    };
  } catch (error: any) {
    console.error('[AnalyticsService] Failed to get analytics:', error.message);
    return {
      totalInteractions: 0,
      periodInteractions: 0,
      averageConfidence: 0,
      resolutionMethods: {},
      topProducts: [],
      topAliases: [],
      frequentlyCorrected: [],
      failedRecognitions: 0,
      averageLatencyMs: 0,
      intentDistribution: {},
      languageDistribution: {},
      period: {
        from: period?.from,
        to: period?.to,
      },
    };
  }
}

/**
 * Get top products spoken via voice in the given period.
 */
export async function getTopVoiceProducts(
  restaurantId: string,
  limit = 20,
  period?: AnalyticsPeriod
): Promise<Array<{ productName: string; count: number }>> {
  const filter = buildPeriodFilter(restaurantId, period);

  const agg = await VoiceAuditLog.aggregate([
    { $match: filter },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.name',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);

  return agg.map((row) => ({
    productName: row._id,
    count: row.count,
  }));
}

/**
 * Track a resolution method for future analytics.
 * Called by the controller after each successful parse.
 */
export function trackResolutionMethod(
  _method: string,
  _confidence: number
): void {
  // Currently just logged to audit — no additional tracking needed.
  // Future: increment a Redis counter for real-time analytics.
}


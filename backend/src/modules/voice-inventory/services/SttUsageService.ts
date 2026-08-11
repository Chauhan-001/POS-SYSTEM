/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SttUsageService — Fire-and-forget recording of Speech-to-Text usage & cost.
 *
 * Called from the transcribe controller with the provider outcome. Persists
 * to SttUsage in the background so transcription latency is never blocked on
 * the database. Failures are logged and swallowed (cost tracking is
 * best-effort telemetry, not a correctness dependency).
 */

import mongoose from 'mongoose';
import SttUsage from '../models/SttUsage';
import type { STTResult } from '../types';

export interface SttUsageEntry {
  restaurantId: string;
  branchId?: string;
  employeeId?: string;
  provider: string;
  model: string;
  audioBytes: number;
  status: 'success' | 'empty' | 'error';
  latencyMs: number;
  transcriptExcerpt?: string;
  error?: string;
  attemptHistory?: STTResult['attemptHistory'];
  costUsd?: number;
  ipAddress?: string;
}

/**
 * Persist an STT usage/cost record. Never throws to the caller.
 */
export async function recordSttUsage(
  entry: SttUsageEntry
): Promise<void> {
  try {
    if (!entry.restaurantId || !mongoose.Types.ObjectId.isValid(entry.restaurantId)) {
      return;
    }

    // Estimate audio duration from bytes (~16 KB/s WebM/Opus) when unknown.
    const audioSeconds = entry.audioBytes > 0 ? entry.audioBytes / 16_000 : 0;

    const doc = new SttUsage({
      restaurantId: new mongoose.Types.ObjectId(entry.restaurantId),
      branchId: entry.branchId && mongoose.Types.ObjectId.isValid(entry.branchId)
        ? new mongoose.Types.ObjectId(entry.branchId)
        : undefined,
      employeeId: entry.employeeId || undefined,
      provider: entry.provider || 'unknown',
      model: entry.model || 'default',
      status: entry.status,
      audioBytes: entry.audioBytes,
      audioSeconds: Math.round(audioSeconds * 10) / 10,
      latencyMs: entry.latencyMs,
      costUsd: Math.round((entry.costUsd || 0) * 1e4) / 1e4,
      transcriptExcerpt: (entry.transcriptExcerpt || '').slice(0, 200) || undefined,
      error: entry.error ? entry.error.slice(0, 500) : undefined,
      attemptHistory: entry.attemptHistory,
      ipAddress: entry.ipAddress || undefined,
    });

    await doc.save();
  } catch (error: any) {
    console.warn('[SttUsageService] Failed to record STT usage:', error?.message || error);
  }
}

/**
 * Aggregate STT usage for a restaurant over an optional date range.
 */
export async function getSttUsageSummary(
  restaurantId: string,
  range?: { from?: Date; to?: Date }
): Promise<{
  totalCalls: number;
  totalCostUsd: number;
  totalSeconds: number;
  byProvider: Record<string, number>;
  byStatus: Record<string, number>;
  period: { from?: Date; to?: Date };
}> {
  const match: any = { restaurantId: new mongoose.Types.ObjectId(restaurantId) };
  if (range?.from || range?.to) {
    match.createdAt = {};
    if (range.from) match.createdAt.$gte = range.from;
    if (range.to) match.createdAt.$lte = range.to;
  }

  const [count, costAgg, secAgg, providerAgg, statusAgg] = await Promise.all([
    SttUsage.countDocuments(match),
    SttUsage.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$costUsd' } } },
    ]),
    SttUsage.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$audioSeconds' } } },
    ]),
    SttUsage.aggregate([
      { $match: match },
      { $group: { _id: '$provider', count: { $sum: 1 } } },
    ]),
    SttUsage.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const byProvider: Record<string, number> = {};
  for (const row of providerAgg) byProvider[row._id || 'unknown'] = row.count;
  const byStatus: Record<string, number> = {};
  for (const row of statusAgg) byStatus[row._id || 'unknown'] = row.count;

  return {
    totalCalls: count,
    totalCostUsd: Math.round((costAgg[0]?.total || 0) * 1e4) / 1e4,
    totalSeconds: Math.round(secAgg[0]?.total || 0),
    byProvider,
    byStatus,
    period: range ? { from: range.from, to: range.to } : {},
  };
}
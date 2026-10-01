/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SttUsageService — fire-and-forget telemetry into the existing SttUsage
 * ledger (RECOVERED: adapted from the pre-"removed ai" implementation).
 *
 * Records per-call provider, model, estimated duration, latency and cost so
 * STT spend is observable. Never stores raw audio or the full transcript
 * (excerpt only, ≤200 chars). Telemetry failures NEVER break the request.
 */

import SttUsage from '../models/SttUsage';
import type { STTResult } from './SpeechService';

export interface SttUsageRecordInput {
  restaurantId: string;
  branchId?: string;
  employeeId?: string;
  provider: string;
  model: string;
  status: 'success' | 'empty' | 'error';
  audioBytes: number;
  audioSeconds: number;
  latencyMs: number;
  transcriptExcerpt?: string;
  error?: string;
}

/** USD per minute — whisper-large-v3-turbo list price, env-overridable. */
function costUsd(audioSeconds: number): number {
  const perMinute = parseFloat(process.env.STT_COST_PER_MINUTE_USD || '0.04');
  return Math.round(((audioSeconds / 60) * perMinute) * 10_000) / 10_000;
}

export async function recordSttUsage(input: SttUsageRecordInput): Promise<void> {
  try {
    const doc = new SttUsage({
      restaurantId: input.restaurantId,
      branchId: input.branchId,
      employeeId: input.employeeId,
      provider: input.provider,
      model: input.model,
      status: input.status,
      audioBytes: input.audioBytes,
      audioSeconds: Math.round(input.audioSeconds * 100) / 100,
      latencyMs: input.latencyMs,
      costUsd: costUsd(input.audioSeconds),
      transcriptExcerpt: input.transcriptExcerpt?.slice(0, 200),
      error: input.error,
      attemptHistory: [],
    });
    await doc.save();
  } catch (err) {
    // Observability must never break the voice request path.
    console.warn(`[SttUsage] ledger write failed (ignored): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Build a ledger record from a successful STT result. */
export function usageFromResult(
  base: Omit<SttUsageRecordInput, 'status'>,
  result: STTResult,
): SttUsageRecordInput {
  return {
    ...base,
    provider: result.provider,
    status: result.transcript.trim().length > 0 ? 'success' : 'empty',
    transcriptExcerpt: result.transcript.slice(0, 200),
    error: result.transcript.trim().length > 0 ? undefined : 'empty transcript',
  };
}

export const sttUsageService = { recordSttUsage, usageFromResult };

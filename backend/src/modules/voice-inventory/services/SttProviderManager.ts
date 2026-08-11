/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SttProviderManager — Production-grade Speech-to-Text provider orchestration.
 *
 * Design:
 *   - Ordered provider chain: Google Cloud STT (primary) → Deepgram Flux (fallback)
 *     → any additional per-restaurant-provider fallbacks registered later.
 *   - Each provider call is wrapped in its own CircuitBreaker so a slow or failing
 *     upstream never cascades (trips after `failureThreshold`, re-probes after
 *     `cooldownMs`).
 *   - The FIRST provider that returns a non-empty transcript wins. Subsequent
 *     providers are skipped on success.
 *   - On failure the manager moves to the next provider in the chain. If every
 *     provider fails, the last error (with per-provider diagnostics) is thrown.
 *   - Estimated cost is recorded per usage so the restaurant can see provider
 *     spend (never secrets).
 *
 * SECURITY:
 *   - Audio is only processed in memory and discarded after transcription.
 *   - All keys come from environment variables (never the client).
 *   - Nothing here ever touches the database.
 */

import { CircuitBreaker } from '../../../utils/CircuitBreaker';
import type { ISTTProvider, STTResult, STTOptions } from '../types';

// ====================================================================
// COST RATES (USD per minute) — overridable via env
// ====================================================================

export const STT_COST_PER_MINUTE: Record<string, number> = {
  google: parseFloat(process.env.STT_COST_PER_MIN_GOOGLE || '0.024'),
  deepgram: parseFloat(process.env.STT_COST_PER_MIN_DEEPGRAM || '0.004'),
  azure: parseFloat(process.env.STT_COST_PER_MIN_AZURE || '0.024'),
  groq: parseFloat(process.env.STT_COST_PER_MIN_GROQ || '0.001'),
  custom: parseFloat(process.env.STT_COST_PER_MIN_CUSTOM || '0.004'),
};

// ====================================================================
// PROVIDER CHAIN ENTRY
// ====================================================================

export interface SttProviderEntry {
  /** Canonical provider key used for costing/logging (google, deepgram, …). */
  key: string;
  /** A short human-readable name for logs. */
  displayName: string;
  provider: ISTTProvider;
  breaker: CircuitBreaker;
}

export interface SttTranscribeResult {
  success: boolean;
  result?: STTResult;
  costUsd?: number;
  provider?: string;
  /** Providers that failed (or were skipped) in order. */
  attemptHistory: Array<{ key: string; status: 'ok' | 'skipped' | 'failed'; error?: string; latencyMs?: number }>;
  error?: string;
}

const DEFAULT_BREAKER_OPTS = {
  failureThreshold: 3,
  cooldownMs: 30_000,
  timeoutMs: 15_000,
  maxConcurrency: 4,
};

export function createBreaker(name: string): CircuitBreaker {
  return new CircuitBreaker({ name: `STT:${name}`, ...DEFAULT_BREAKER_OPTS });
}

/**
 * Orchestrate the provider chain for a single transcription request.
 */
export class SttProviderManager {
  private readonly chain: SttProviderEntry[];

  constructor(chain: SttProviderEntry[]) {
    this.chain = chain;
  }

  /**
   * Transcribe audio through the chain. First success wins; failures advance
   * to the next provider. Throws only when the entire chain fails.
   *
   * @param audioBlob - Raw audio bytes (never persisted)
   * @param options - STT options (language, timeout)
   * @returns Structured result plus cost estimate and provider attempt trace.
   */
  async transcribe(
    audioBlob: Blob,
    options?: STTOptions
  ): Promise<SttTranscribeResult> {
    const start = Date.now();
    const attemptHistory: SttTranscribeResult['attemptHistory'] = [];

    if (!this.chain.length) {
      return {
        success: false,
        attemptHistory,
        error: 'No STT providers configured',
      };
    }

    for (const entry of this.chain) {
      try {
        if (entry.breaker.getStats().state === 'OPEN') {
          attemptHistory.push({
            key: entry.key,
            status: 'skipped',
            error: 'circuit OPEN — skipped',
          });
          continue;
        }

        const outcome = await entry.breaker.execute<STTResult>(() =>
          entry.provider.transcribe(audioBlob, options)
        );

        const result = outcome.data;
        if (outcome.fallback) {
          entry.breaker.reset(); // Fast-failed through breaker — real next attempt is safe
        }

        // A provider that returns an empty transcript is treated as a failure
        // (no useful content) so the chain can move to the next provider.
        if (!result.transcript || result.transcript.trim().length === 0) {
          attemptHistory.push({
            key: entry.key,
            status: 'failed',
            error: result.error?.message || 'Empty transcript',
            latencyMs: result.durationMs,
          });
          continue;
        }

        attemptHistory.push({
          key: entry.key,
          status: 'ok',
          latencyMs: result.durationMs,
        });

        const durationSec = result.durationMs / 1000 || estimateDurationFromBytes(audioBlob.size);
        const costUsd =
          ((STT_COST_PER_MINUTE[entry.key] ?? 0) * durationSec) / 60;

        return {
          success: true,
          result,
          provider: entry.key,
          costUsd: costUsd > 0 ? Math.round(costUsd * 1e4) / 1e4 : undefined,
          attemptHistory,
        };
      } catch (error: any) {
        attemptHistory.push({
          key: entry.key,
          status: 'failed',
          error: error?.message || 'Unknown error',
          latencyMs: Date.now() - start,
        });
      }
    }

    return {
      success: false,
      attemptHistory,
      error: 'All STT providers failed',
    };
  }

  /** Provider keys currently configured, in order. */
  list(): string[] {
    return this.chain.map((e) => e.key);
  }
}

/**
 * Approximate audio duration (seconds) from encoded byte size for WebM/Opus at
 * ~48kHz mono (~16 KB/s). Used only for cost estimation when a provider does
 * not report duration.
 */
function estimateDurationFromBytes(bytes: number): number {
  if (!bytes || bytes <= 0) return 0;
  return bytes / 16_000;
}
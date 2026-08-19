/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * aiUsageLogger.ts — Fire-and-forget AI usage recording.
 *
 * Extended in Phase 2.7 to support:
 *   - Token tracking (inputTokens, outputTokens, totalTokens)
 *   - Cost tracking (cost)
 *   - Model/Provider tracking (model, provider)
 *   - Error categorization (errorType, retried, cancelled, timeout)
 *
 * Controllers call recordAiUsage() after each AI request completes.
 * Recording is non-blocking and never throws, so it cannot affect the
 * request/response path or break AI features if the DB write fails.
 */

import { AIUsageLog } from '../../../models';
import { calculateCost } from '../../../services/aiCostConfig';

export interface AiUsageRecord {
  restaurantId?: string;
  ownerId?: string;
  feature: string;
  success: boolean;
  fallback: boolean;
  cached: boolean;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  provider?: string;
  errorType?: string | null;
  retried?: boolean;
  cancelled?: boolean;
  timeout?: boolean;
  /** Phase 8 — telemetry extensions (never PII; prompts are stored hashed only). */
  promptVersion?: string;
  cacheBust?: boolean;
  validationPassed?: boolean | null;
  validationFailed?: boolean | null;
  fallbackReason?: string | null;
  promptHash?: string;
  requestId?: string;
}

/**
 * Record an AI usage entry (best-effort, fire-and-forget).
 * Silently ignores missing restaurant context or DB failures.
 * Automatically calculates cost if tokens are provided.
 */
export function recordAiUsage(record: AiUsageRecord): void {
  try {
    if (!record.restaurantId) return;

    const inputTokens = record.inputTokens || 0;
    const outputTokens = record.outputTokens || 0;
    const totalTokens = record.totalTokens || inputTokens + outputTokens;
    const model = record.model || '';
    const provider = record.provider || '';

    // Calculate cost from actual token usage
    const cost = totalTokens > 0
      ? calculateCost(inputTokens, outputTokens, model, provider)
      : 0;

    void AIUsageLog.create({
      restaurantId: record.restaurantId,
      ownerId: record.ownerId || null,
      feature: record.feature,
      success: record.success,
      fallback: record.fallback,
      cached: record.cached,
      latencyMs: record.latencyMs || 0,
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      model,
      provider,
      errorType: record.errorType || null,
      retried: record.retried || false,
      cancelled: record.cancelled || false,
      timeout: record.timeout || false,
      promptVersion: record.promptVersion || '',
      cacheBust: record.cacheBust || false,
      validationPassed: record.validationPassed ?? null,
      validationFailed: record.validationFailed ?? null,
      fallbackReason: record.fallbackReason || null,
      promptHash: record.promptHash || '',
      requestId: record.requestId || '',
    }).catch((err: any) => {
      console.error('[AiUsageLogger] Failed to record AI usage:', err?.message || err);
    });
  } catch (err: any) {
    console.error('[AiUsageLogger] recordAiUsage error:', err?.message || err);
  }
}

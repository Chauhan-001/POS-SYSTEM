/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * mlObservability.ts — structured ML lifecycle observability (Job 3, Sec 16/30).
 *
 * Records ML events (training, promotion, rejection, drift, scheduler and
 * feedback failures) into the EXISTING PlatformEvent collection so the admin
 * reporting surface can query them — no new infrastructure. Design rules:
 *
 *   - FAIL-SAFE (Sec 17): recordMlEvent() never throws into the caller.
 *     Monitoring is secondary to serving; a DB outage here must never break
 *     /api/forecast, the scheduler, or the feedback loop.
 *   - No secrets, no customer PII — only tenant/model identifiers + reasons.
 *   - Every record carries restaurantId / model / modelVersion / event /
 *     severity / reason / timestamp, so degradation is detectable rather than
 *     merely logged to console.
 */

import mongoose from 'mongoose';

export type MlSeverity = 'info' | 'warning' | 'error';

export interface MlEventPayload {
  event:
    | 'ml_training_started'
    | 'ml_training_succeeded'
    | 'ml_training_failed'
    | 'ml_candidate_rejected'
    | 'ml_model_promoted'
    | 'ml_model_rolled_back'
    | 'ml_prediction_failed'
    | 'ml_drift_detected'
    | 'ml_performance_degraded'
    | 'ml_scheduler_failed'
    | 'ml_feedback_failed';
  restaurantId: string;
  model: 'demand' | 'basket' | 'uplift' | 'segment';
  modelVersion?: string | null;
  severity?: MlSeverity;
  reason?: string;
  metrics?: Record<string, number | string | boolean | null>;
  durationMs?: number;
}

/** Fire-and-forget write; resolves always. Best-effort by design. */
export async function recordMlEvent(payload: MlEventPayload): Promise<void> {
  try {
    const { PlatformEvent } = await import('../../modules/adminReports/models');
    await PlatformEvent.create({
      category: 'system',
      event: payload.event,
      restaurantId: mongoose.isValidObjectId(payload.restaurantId)
        ? new mongoose.Types.ObjectId(payload.restaurantId)
        : undefined,
      outcome: payload.severity === 'error' ? 'failure' : 'success',
      durationMs: payload.durationMs,
      meta: {
        surface: 'ml_pipeline',
        model: payload.model,
        modelVersion: payload.modelVersion ?? null,
        severity: payload.severity ?? 'info',
        reason: payload.reason ?? null,
        metrics: payload.metrics ?? null,
      },
      occurredAt: new Date(),
    });
  } catch {
    // Fail-safe (Sec 17): observability must never break serving/scheduling.
  }
}

/** Non-async convenience for hot paths — schedules the write, never blocks. */
export function recordMlEventFireAndForget(payload: MlEventPayload): void {
  void recordMlEvent(payload);
}

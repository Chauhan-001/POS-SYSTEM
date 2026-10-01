/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * mlModelStatus.ts — Shared model-status envelope for ML tools (spec §19).
 * Every ML tool reports availability, model identity, freshness and
 * evaluation status so the agent can never present an unavailable or
 * unevaluable model as a reliable prediction.
 */

/** How the model's real-world accuracy has been evaluated. */
export type MlEvaluationStatus =
  | 'evaluated'      // evaluated outcome rows exist for this tenant+model
  | 'not_evaluated'  // predictions exist, outcomes never recorded
  | 'not_evaluable'  // evaluation gate failed (e.g. insufficient experiment data)
  | 'unknown';       // evaluation store unavailable — never silently 'evaluated'

export interface MlModelStatus {
  available: boolean;
  /** Canonical model id used by the pipeline (demand / combo / segment / uplift). */
  modelId: string;
  modelVersion?: string | null;
  evaluationStatus: MlEvaluationStatus;
  /** Age of the newest stored prediction, in whole days. */
  freshnessAgeDays?: number | null;
  /** Human-readable detail for the agent (why unavailable, gate reasons...). */
  detail?: string;
  generatedAt: string;
}

function ageInDays(from: Date | string | undefined | null): number | null {
  if (!from) return null;
  const t = new Date(from).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/**
 * Evaluation status from the durable outcome ledger (MLPredictionOutcome).
 * Mirrors the filter predictionFeedbackService uses for accuracy reporting.
 * Returns 'unknown' on store failure — honesty over optimism.
 */
export async function readEvaluationStatus(
  restaurantId: string,
  modelId: string,
): Promise<{ status: MlEvaluationStatus; evaluatedCount: number; lastEvaluatedAt: Date | null }> {
  try {
    const { default: MLPredictionOutcome } = await import(
      '../../../models/intelligence/MLPredictionOutcome'
    );
    const row = await MLPredictionOutcome.findOne({
      restaurantId,
      modelName: modelId,
      actualValue: { $ne: null },
    })
      .sort({ evaluatedAt: -1 })
      .select('evaluatedAt')
      .lean()
      .exec();
    if (!row) return { status: 'not_evaluated', evaluatedCount: 0, lastEvaluatedAt: null };
    return {
      status: 'evaluated',
      evaluatedCount: 1, // existence + recency is what the agent needs; full stats live in the feedback service
      lastEvaluatedAt: (row as any).evaluatedAt ?? null,
    };
  } catch {
    return { status: 'unknown', evaluatedCount: 0, lastEvaluatedAt: null };
  }
}

export { ageInDays as mlFreshnessAgeDays };

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * mlTypes.ts — PHASE 5 ML evidence contracts (semantics, not model code).
 */

export const ML_EVIDENCE_KINDS = [
  'causal_uplift',
  'response_model',
  'segment',
  'forecast',
  'basket',
  'descriptive',
] as const;

export type MlEvidenceKind = (typeof ML_EVIDENCE_KINDS)[number];

export interface MlDegradation {
  model: string;
  status: 'unavailable' | 'not_evaluable' | 'stale' | 'heuristic';
  detail: string;
  gateReasons?: string[];
}

/**
 * One piece of ML evidence. `causal` is the load-bearing field: only gated
 * experiment evidence may set it true (see mlSemantics.upliftEvidence).
 */
export interface MlEvidence {
  kind: MlEvidenceKind;
  available: boolean;
  modelId?: string;
  modelVersion?: string;
  evaluationStatus?: string;
  sampleSize?: number;
  freshnessAgeDays?: number;
  stale?: boolean;
  heuristic?: boolean;
  /** TRUE only for evidence from a randomization-validated experiment. */
  causal?: boolean;
  reason?: string;
  degradation?: MlDegradation;
}

export interface MlSignalSummary {
  evidence: MlEvidence[];
  availableKinds: MlEvidenceKind[];
  missingKinds: MlEvidenceKind[];
  degradations: MlDegradation[];
  strongest: MlEvidenceKind | null;
  hasTargetingEvidence: boolean;
  hasCausalEvidence: boolean;
}

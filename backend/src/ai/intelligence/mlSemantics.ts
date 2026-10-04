/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * mlSemantics.ts — PHASE 5 ML integration with EXPLICIT semantic rules.
 *
 * THE ONE RULE THAT MATTERS: response probability is NOT causal uplift.
 *   - `causal` evidence may only be produced from a model that passed the
 *     existing experiment-randomization gate (getUpliftSignalsTool already
 *     enforces that gate upstream — this module never re-implements it and
 *     never overrides it).
 *   - Response-model scores are `response_model` evidence, `causal:false`.
 *   - Segmentation is descriptive grouping only.
 *   - Demand/basket are forecasts/associations, not causal effects.
 *
 * The module is a pure classifier: it takes ALREADY-FETCHED tool outputs and
 * labels them honestly, collecting degradation reasons when a service is
 * missing/unevaluable/stale. It never invents ML results and never makes an
 * unsupported causal claim.
 */

import {
  ML_EVIDENCE_KINDS,
  type MlDegradation,
  type MlEvidence,
  type MlEvidenceKind,
  type MlSignalSummary,
} from './mlTypes';

export {
  ML_EVIDENCE_KINDS,
  type MlDegradation,
  type MlEvidence,
  type MlEvidenceKind,
  type MlSignalSummary,
} from './mlTypes';

// ─────────────────────────────────────────────────────────────────────────────
// Minimal structural shapes (only the fields semantics needs)
// ─────────────────────────────────────────────────────────────────────────────

interface MlStatusLike {
  available?: boolean;
  modelId?: string;
  modelVersion?: string | null;
  evaluationStatus?: string;
  freshnessAgeDays?: number | null;
  detail?: string;
  gateReasons?: string[];
}

function statusFields(raw: MlStatusLike | null | undefined) {
  return {
    modelId: raw?.modelId,
    modelVersion: raw?.modelVersion ?? undefined,
    evaluationStatus: raw?.evaluationStatus,
    freshnessAgeDays: raw?.freshnessAgeDays ?? undefined,
    detail: raw?.detail,
  };
}

function staleByAge(raw: MlStatusLike | null | undefined, windowDays: number): boolean {
  const age = raw?.freshnessAgeDays;
  return typeof age === 'number' && age > windowDays * 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence builders — one per ML capability
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uplift evidence — CAUSAL ONLY WHEN THE UPSTREAM GATE PASSED.
 * `getUpliftSignals` already returns available:false with gateReasons when the
 * experiment is not evaluable; this function simply preserves that verdict.
 */
export function upliftEvidence(raw: MlStatusLike | null | undefined): MlEvidence {
  const base: MlEvidence = {
    kind: 'causal_uplift',
    available: false,
    causal: false,
    ...statusFields(raw),
  };
  if (!raw) {
    return { ...base, reason: 'NOT_FETCHED', degradation: { model: 'uplift', status: 'unavailable', detail: 'Uplift signals were not fetched.' } };
  }
  if (!raw.available) {
    const notEvaluable = raw.evaluationStatus === 'not_evaluable' || (raw.gateReasons?.length ?? 0) > 0;
    return {
      ...base,
      reason: raw.detail ?? (notEvaluable ? 'EXPERIMENT_NOT_EVALUABLE' : 'UNAVAILABLE'),
      degradation: {
        model: 'uplift',
        status: notEvaluable ? 'not_evaluable' : 'unavailable',
        detail: raw.detail ?? 'Uplift unavailable.',
        gateReasons: raw.gateReasons,
      },
    };
  }
  const stale = staleByAge(raw, 7);
  return {
    ...base,
    available: true,
    causal: true, // gate passed upstream — the ONLY place causal:true is set
    stale,
    degradation: stale
      ? { model: 'uplift', status: 'stale', detail: `Uplift predictions are ${raw.freshnessAgeDays} days old.` }
      : undefined,
  };
}

/** Response-model evidence — explicitly NON-causal. */
export function responseEvidence(raw: MlStatusLike | null | undefined): MlEvidence {
  const base: MlEvidence = {
    kind: 'response_model',
    available: false,
    causal: false,
    ...statusFields(raw),
  };
  if (!raw) {
    return { ...base, reason: 'NOT_FETCHED', degradation: { model: 'response', status: 'unavailable', detail: 'Response scores were not fetched.' } };
  }
  if (!raw.available) {
    return {
      ...base,
      reason: raw.detail ?? 'UNAVAILABLE',
      degradation: { model: 'response', status: 'unavailable', detail: raw.detail ?? 'Response model unavailable.' },
    };
  }
  return { ...base, available: true, causal: false, stale: staleByAge(raw, 7) };
}

/** Segment evidence — descriptive grouping, never a causal claim. */
export function segmentEvidence(raw: MlStatusLike | null | undefined): MlEvidence {
  const base: MlEvidence = { kind: 'segment', available: false, causal: false, ...statusFields(raw) };
  if (!raw) return { ...base, reason: 'NOT_FETCHED' };
  if (!raw.available) {
    return {
      ...base,
      reason: raw.detail ?? 'UNAVAILABLE',
      degradation: { model: 'segment', status: 'unavailable', detail: raw.detail ?? 'Segmentation unavailable.' },
    };
  }
  return { ...base, available: true, causal: false };
}

/** Demand-forecast evidence — a forecast, never a measured causal effect. */
export function forecastEvidence(raw: MlStatusLike | null | undefined): MlEvidence {
  const base: MlEvidence = { kind: 'forecast', available: false, causal: false, ...statusFields(raw) };
  if (!raw) return { ...base, reason: 'NOT_FETCHED' };
  if (!raw.available) {
    return {
      ...base,
      reason: raw.detail ?? 'UNAVAILABLE',
      degradation: { model: 'demand', status: 'unavailable', detail: raw.detail ?? 'Demand forecast unavailable.' },
    };
  }
  const stale = staleByAge(raw, 2);
  return { ...base, available: true, causal: false, stale };
}

/** Basket evidence — association only; heuristic rows are disclosed. */
export function basketEvidence(
  raw: (MlStatusLike & { predictionSource?: string }) | null | undefined,
): MlEvidence {
  const base: MlEvidence = { kind: 'basket', available: false, causal: false, ...statusFields(raw) };
  if (!raw) return { ...base, reason: 'NOT_FETCHED' };
  if (!raw.available) {
    return {
      ...base,
      reason: raw.detail ?? 'UNAVAILABLE',
      degradation: { model: 'combo', status: 'unavailable', detail: raw.detail ?? 'Market-basket service unavailable.' },
    };
  }
  const heuristic = raw.predictionSource === 'manager_table';
  return {
    ...base,
    available: true,
    causal: false,
    heuristic,
    degradation: heuristic
      ? { model: 'combo', status: 'heuristic', detail: 'Rule-based manager-table pairs, not model predictions.' }
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

/** Strongest-to-weakest evidence ordering (targeting value). */
const KIND_ORDER: MlEvidenceKind[] = ['causal_uplift', 'response_model', 'segment', 'forecast', 'basket', 'descriptive'];

/**
 * Summarize fetched ML evidence into an honest picture for the agent/UI.
 * `hasTargetingEvidence` is true when SOME usable targeting signal exists
 * (causal, response or segment). `hasCausalEvidence` is true ONLY for gated
 * uplift — callers must use it (never `hasTargetingEvidence`) before making
 * causal statements.
 */
export function summarizeMlEvidence(evidence: MlEvidence[]): MlSignalSummary {
  const availableKinds = evidence.filter((e) => e.available).map((e) => e.kind);
  const missingKinds = ML_EVIDENCE_KINDS.filter((k) => !availableKinds.includes(k));
  const degradations = evidence
    .map((e) => e.degradation)
    .filter((d): d is MlDegradation => Boolean(d));
  const strongest = KIND_ORDER.find((k) => availableKinds.includes(k)) ?? null;
  return {
    evidence,
    availableKinds,
    missingKinds,
    degradations,
    strongest,
    hasTargetingEvidence: availableKinds.some((k) => k === 'causal_uplift' || k === 'response_model' || k === 'segment'),
    hasCausalEvidence: evidence.some((e) => e.kind === 'causal_uplift' && e.available && e.causal === true),
  };
}

/** Human-readable degradation lines (owner-safe, no internals). */
export function mlDegradationLines(summary: MlSignalSummary): string[] {
  return summary.degradations.map((d) => {
    switch (d.status) {
      case 'not_evaluable':
        return `${d.model} evidence is not usable yet: the experiment is not large enough to trust. ${d.gateReasons?.join('; ') ?? ''}`.trim();
      case 'stale':
        return `${d.model} evidence is out of date: ${d.detail}`;
      case 'heuristic':
        return `${d.model} evidence is rule-based, not a model prediction.`;
      default:
        return `${d.model} evidence is unavailable: ${d.detail}`;
    }
  });
}

/**
 * Guard for downstream copy: asserts a causal statement is only produced when
 * gated causal evidence exists. Returns the honest alternative otherwise.
 */
export function causalClaim(
  summary: MlSignalSummary,
  causalText: string,
  nonCausalText: string,
): string {
  return summary.hasCausalEvidence ? causalText : nonCausalText;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * evidenceMerger.ts — PHASE 3 evidence-pack assembly for the Daily Summary /
 * Z-Report Intelligence pipeline.
 *
 * Merges the batch outputs into ONE deduplicated, traceable evidence pack
 * (the EvidencePack consumed by Phase 4 prompts and persisted in
 * DailySummaryEvidence.evidencePack). NO LLM involvement — the pack is the
 * single grounding surface for synthesis.
 *
 * Design notes:
 *   - Dedup is EXPLICIT: identical signalIds collapse; a code+subject
 *     collision from different ids keeps the higher-confidence (then
 *     fresher) signal and is COUNTED (dedupCollisions) — never silently
 *     dropped.
 *   - Degradation is NEVER hidden: unavailable normalizers, tool failures,
 *     stale/expired signals and memory degradation are all represented in
 *     the pack (spec §42 forbids hiding degraded data conditions).
 *   - Conflict detection runs over ALL collected signals (pre-dedup) so a
 *     cross-source disagreement stays visible even after a winner was kept.
 *   - Tenant/branch identity is carried for persistence + scoping; the
 *     LLM-facing projection strips tenant/security metadata (Phase 4).
 */

import type { BusinessSignal, SignalFreshness } from '../intelligence/businessSignalTypes';
import type { MlSignalSummary } from '../intelligence/mlSemantics';
import {
  detectSignalConflicts,
  describeConflict,
  type SignalConflict,
  type SignalConflictSet,
} from './signalConflictDetector';
import type { ZReportEvidence } from './zReportSignals';

export interface EvidencePackSourceSummary {
  signals: number;
  toolErrors: number;
  unavailable: string[];
  durationMs: number;
}

export interface EvidencePackSources {
  batch1: EvidencePackSourceSummary;
  batch2: EvidencePackSourceSummary;
  batch3: EvidencePackSourceSummary | null;
  /** Targeted follow-up (Phase 4); null when not triggered. */
  followUp: EvidencePackSourceSummary | null;
}

/** Honest ML picture attached when the follow-up fetched ML evidence. */
export interface EvidencePackMl {
  availableKinds: string[];
  missingKinds: string[];
  /** Owner-safe degradation lines (never raw provider errors). */
  degradations: string[];
  /** TRUE only for gated causal (uplift) evidence — never assumed. */
  hasCausalEvidence: boolean;
}

export interface EvidencePack {
  restaurantId: string;
  branchId?: string;
  businessDate: string;
  /** Deduplicated, priority-merged signals (canonical BusinessSignal[]). */
  signals: BusinessSignal[];
  /** Same-metric disagreements across sources (computed pre-dedup). */
  conflicts: SignalConflictSet;
  /** Code+subject collisions resolved by the priority merge (disclosed). */
  dedupCollisions: number;
  /** Signals whose freshness disqualifies them as current evidence. */
  staleSignals: Array<{ signalId: string; code: string; freshness: SignalFreshness }>;
  /** Explicit unavailable normalizer identities per batch. */
  unavailable: string[];
  /** Every tool failure across batches (never hidden). */
  toolErrors: Array<{ tool: string; code: string; message: string }>;
  /**
   * Disclosures from the collection layer: every batch's own caveats plus the
   * run-wide statements, deduplicated (batch disclosures are never dropped).
   */
  caveats: string[];
  /** Memory snapshot degradation, if any (memory is context, never a gate). */
  memoryDegraded?: { reason?: string };
  /**
   * ML evidence picture from the follow-up stage. ABSENT means no ML evidence
   * was fetched — the report must not imply that ML ran.
   */
  ml?: EvidencePackMl;
  freshness: Record<SignalFreshness, number>;
  sources: EvidencePackSources;
  /** Why Batch 3 ran or was skipped. */
  batch3Reason: string;
  generatedAt: string;
  /** True when at least one batch produced usable (non-stale) evidence. */
  usable: boolean;
}

const FRESHNESS_WEIGHT: Record<SignalFreshness, number> = { fresh: 1, aging: 0.8, unknown: 0.6, stale: 0.2, expired: 0 };

function sourceSummary(b: {
  signals: BusinessSignal[];
  toolErrors: Array<{ tool: string; code: string; message: string }>;
  unavailable: string[];
  durationMs: number;
}): EvidencePackSourceSummary {
  return {
    signals: b.signals.length,
    toolErrors: b.toolErrors.length,
    unavailable: b.unavailable,
    durationMs: b.durationMs,
  };
}

/** Priority merge order: confidence first, then freshness. */
function better(a: BusinessSignal, b: BusinessSignal): BusinessSignal {
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
  return FRESHNESS_WEIGHT[a.freshness] >= FRESHNESS_WEIGHT[b.freshness] ? a : b;
}

/**
 * Deterministic dedup. Sorted input first so the merge result does not
 * depend on batch completion timing.
 */
function dedupe(signals: BusinessSignal[]): { merged: BusinessSignal[]; collisions: number } {
  const byId = new Map<string, BusinessSignal>();
  const byMetric = new Map<string, BusinessSignal>();
  let collisions = 0;
  for (const s of [...signals].sort((a, b) => a.signalId.localeCompare(b.signalId))) {
    const sameId = byId.get(s.signalId);
    if (sameId) {
      byId.set(s.signalId, better(sameId, s));
      continue;
    }
    const metricKey = `${s.code}|${s.subject?.id ?? 'restaurant'}`;
    const holder = byMetric.get(metricKey);
    if (holder) {
      collisions += 1;
      const winner = better(holder, s);
      byMetric.set(metricKey, winner);
      if (winner.signalId !== holder.signalId) byId.delete(holder.signalId);
      byId.set(winner.signalId, winner);
      continue;
    }
    byId.set(s.signalId, s);
    byMetric.set(metricKey, s);
  }
  return { merged: [...byId.values()], collisions };
}

function freshnessHistogram(signals: BusinessSignal[]): Record<SignalFreshness, number> {
  const h: Record<SignalFreshness, number> = { fresh: 0, aging: 0, stale: 0, expired: 0, unknown: 0 };
  for (const s of signals) h[s.freshness] += 1;
  return h;
}

/**
 * Merge batch results + conflict detection into one evidence pack.
 *
 * `memoryDegradedReason` and `mlSummary` are positional (not an options bag)
 * to keep the existing call sites and tests source-compatible.
 */
export function mergeEvidence(
  evidence: ZReportEvidence,
  memoryDegradedReason?: string,
  mlSummary?: MlSignalSummary,
): EvidencePack {
  const raw = [
    ...evidence.batch1.signals,
    ...evidence.batch2.signals,
    ...(evidence.batch3?.signals ?? []),
    ...(evidence.followUp?.signals ?? []),
  ];
  const { merged, collisions } = dedupe(raw);
  const conflicts = detectSignalConflicts(raw);

  const staleSignals = merged
    .filter((s) => s.freshness === 'stale' || s.freshness === 'expired')
    .map((s) => ({ signalId: s.signalId, code: s.code, freshness: s.freshness }));

  const unavailable = [
    ...evidence.batch1.unavailable.map((u) => `batch1:${u}`),
    ...evidence.batch2.unavailable.map((u) => `batch2:${u}`),
    ...(evidence.batch3?.unavailable ?? []).map((u) => `batch3:${u}`),
    ...(evidence.followUp?.unavailable ?? []).map((u) => `followUp:${u}`),
  ];
  const toolErrors = [
    ...evidence.batch1.toolErrors,
    ...evidence.batch2.toolErrors,
    ...(evidence.batch3?.toolErrors ?? []),
    ...(evidence.followUp?.toolErrors ?? []),
  ];

  const freshness = freshnessHistogram(merged);
  const usable = merged.length > 0 && freshness.fresh + freshness.aging + freshness.unknown > 0;
  // Disclosures are provenance: a batch caveat (baseline semantics, rolling
  // window, model version) must survive the merge, not be flattened away.
  const caveats = [
    ...new Set([
      ...evidence.batch1.caveats,
      ...evidence.batch2.caveats,
      ...(evidence.batch3?.caveats ?? []),
      ...(evidence.followUp?.caveats ?? []),
      ...evidence.caveats,
    ]),
  ];
  const ml = mlSummary
    ? {
        availableKinds: mlSummary.availableKinds,
        missingKinds: mlSummary.missingKinds,
        degradations: mlSummary.degradations.map((d) => d.detail ?? d.model),
        hasCausalEvidence: mlSummary.hasCausalEvidence,
      }
    : undefined;

  return {
    restaurantId: evidence.restaurantId,
    ...(evidence.branchId ? { branchId: evidence.branchId } : {}),
    businessDate: evidence.businessDate,
    signals: merged,
    conflicts,
    dedupCollisions: collisions,
    staleSignals,
    unavailable,
    toolErrors,
    caveats,
    ...(memoryDegradedReason ? { memoryDegraded: { reason: memoryDegradedReason } } : {}),
    ...(ml ? { ml } : {}),
    freshness,
    sources: {
      batch1: {
        signals: evidence.batch1.signals.length,
        toolErrors: evidence.batch1.toolErrors.length,
        unavailable: evidence.batch1.unavailable,
        durationMs: evidence.batch1.durationMs,
      },
      batch2: {
        signals: evidence.batch2.signals.length,
        toolErrors: evidence.batch2.toolErrors.length,
        unavailable: evidence.batch2.unavailable,
        durationMs: evidence.batch2.durationMs,
      },
      batch3: evidence.batch3 ? sourceSummary(evidence.batch3) : null,
      followUp: evidence.followUp ? sourceSummary(evidence.followUp) : null,
    },
    batch3Reason: evidence.batch3Reason,
    generatedAt: evidence.generatedAt,
    usable,
  };
}

/** Prompt-facing conflict lines (Phase 4 consumes). */
export function conflictLines(conflicts: SignalConflict[], limit = 5): string[] {
  return conflicts.slice(0, limit).map((c) => describeConflict(c));
}

export type { SignalConflict };

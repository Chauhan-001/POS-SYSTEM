/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * signalConflictDetector.ts — PHASE 3 conflict detection for the Daily
 * Summary / Z-Report Intelligence pipeline.
 *
 * A conflict is the SAME measured fact reported MORE THAN ONCE with
 * materially different values (e.g. the same metric from two sources, or a
 * fresh batch contradicting a stale follow-up read). Conflicts are EVIDENCE
 * metadata: they are surfaced to the follow-up investigation and disclosed
 * in the final report — never silently resolved by picking a winner here.
 *
 * Grouping rule (deterministic): signals conflict-candidate when they share
 * the same canonical code AND subject (metric identity), regardless of
 * source. Values are compared only when both are finite numbers; the
 * relative gap threshold is explicit and documented.
 */

import type { BusinessSignal } from '../intelligence/businessSignalTypes';

/** Relative gap above which two measurements of the same fact "disagree". */
export const CONFLICT_GAP_THRESHOLD = 0.2;

export interface SignalConflict {
  /** Metric identity: canonical code + subject id. */
  metricKey: string;
  code: BusinessSignal['code'];
  subjectId: string;
  left: { signalId: string; source: BusinessSignal['source']; value?: number; freshness: BusinessSignal['freshness'] };
  right: { signalId: string; source: BusinessSignal['source']; value?: number; freshness: BusinessSignal['freshness'] };
  /** |a-b| / max(|a|,|b|,1) — only present for numeric pairs. */
  relativeGapPct?: number;
}

export interface SignalConflictSet {
  conflicts: SignalConflict[];
  /** Number of signals examined (all merged signals). */
  checkedSignals: number;
  /** Subjects that produced at least one conflict. */
  conflictedMetrics: string[];
}

function relativeGap(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / denom;
}

/** Human-readable framing for prompts / follow-up investigation. */
export function describeConflict(c: SignalConflict): string {
  const lv = c.left.value !== undefined ? String(c.left.value) : 'non-numeric';
  const rv = c.right.value !== undefined ? String(c.right.value) : 'non-numeric';
  const gap = c.relativeGapPct !== undefined ? ` (${Math.round(c.relativeGapPct * 100)}% apart)` : '';
  return `${c.code} for "${c.subjectId}" reported as ${lv} by ${c.left.source} and ${rv} by ${c.right.source}${gap}.`;
}

/**
 * Detect same-metric conflicts across the merged signal set. Deterministic:
 * candidates are examined in sorted order, conflicts are ordered by metric
 * key, and the "left" side is always the earlier signal in sorted order.
 */
export function detectSignalConflicts(signals: BusinessSignal[]): SignalConflictSet {
  const sorted = [...signals].sort((a, b) => a.signalId.localeCompare(b.signalId));
  const groups = new Map<string, BusinessSignal[]>();
  for (const s of sorted) {
    const key = `${s.code}|${s.subject?.id ?? 'restaurant'}`;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  const conflicts: SignalConflict[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const [code, subjectId] = [key.split('|')[0] as BusinessSignal['code'], key.slice(key.indexOf('|') + 1)];
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        // Identical ids cannot happen post-dedup; identical values are not conflicts.
        if (a.signalId === b.signalId) continue;
        if (a.value === undefined || b.value === undefined) {
          // Non-numeric pair: only a conflict when the sources differ — two
          // sources asserting the same subject differently is still a mismatch.
          if (a.source !== b.source) {
            conflicts.push({
              metricKey: key,
              code,
              subjectId,
              left: { signalId: a.signalId, source: a.source, value: a.value, freshness: a.freshness },
              right: { signalId: b.signalId, source: b.source, value: b.value, freshness: b.freshness },
            });
          }
          continue;
        }
        const gap = relativeGap(a.value, b.value);
        if (gap > CONFLICT_GAP_THRESHOLD) {
          conflicts.push({
            metricKey: key,
            code,
            subjectId,
            left: { signalId: a.signalId, source: a.source, value: a.value, freshness: a.freshness },
            right: { signalId: b.signalId, source: b.source, value: b.value, freshness: b.freshness },
            relativeGapPct: gap,
          });
        }
      }
    }
  }

  conflicts.sort((a, b) => a.metricKey.localeCompare(b.metricKey) || a.left.signalId.localeCompare(b.left.signalId));
  return {
    conflicts,
    checkedSignals: sorted.length,
    conflictedMetrics: [...new Set(conflicts.map((c) => c.metricKey))],
  };
}

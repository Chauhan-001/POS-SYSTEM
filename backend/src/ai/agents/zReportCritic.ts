/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * zReportCritic.ts — PHASE 4 FINAL CRITIC for the Daily Summary / Z-Report
 * pipeline.
 *
 * The critic is the last gate before a report is shown to an owner. It is
 * DETERMINISTIC by design (v1): every check is a reproducible rule over the
 * narrative and the evidence pack, so the verdict is auditable and cannot be
 * talked out of by wording. It never rewrites the report — it returns a verdict
 * plus explicit issues, and the orchestrator substitutes the deterministic
 * narrative when the verdict is `repair`.
 *
 * Checks (all server-side; prompt wording is never trusted):
 *   grounding        — every number must exist in the evidence.
 *   causal_language  — no causation without gated causal evidence.
 *   staleness        — stale/expired evidence must not be presented as current.
 *   must_address     — drawer variance, refunds, wastage, revenue decline and
 *                      discounting must be addressed when they are in the pack.
 *   conflict         — cross-source disagreements must be disclosed.
 *   degradation      — an unusable pack must be disclosed as limited.
 */

import type { EvidencePack } from './evidenceMerger';
import { hasUnsupportedCausalLanguage } from '../intelligence/recommendationExplanation';
import {
  Z_REPORT_MUST_ADDRESS,
  zReportTextProblem,
  type ZReportNarrative,
} from './zReportPrompts';
import type { ZReportContext } from './zReportContext';

export interface ZReportCriticIssue {
  code: string;
  detail: string;
  /** Blocking issues force the deterministic narrative. */
  blocking: boolean;
}

export interface ZReportCriticVerdict {
  verdict: 'accept' | 'repair';
  issues: ZReportCriticIssue[];
  /** Names of the checks that ran (observability / audit trail). */
  checks: string[];
}

const CAVEAT_FIELDS: Array<keyof ZReportNarrative> = ['caveats', 'whatMattered', 'needsAttention', 'headline', 'whatHappened', 'focusNext'];

function allText(narrative: ZReportNarrative): string[] {
  const out: string[] = [];
  for (const field of CAVEAT_FIELDS) {
    const v = narrative[field];
    if (Array.isArray(v)) out.push(...v);
    else if (typeof v === 'string') out.push(v);
  }
  return out;
}

/** Numbers present in a narrative (grounding re-verification). */
function numericTokens(text: string): string[] {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g);
  return matches ?? [];
}

/**
 * Audit a generated narrative against its evidence pack.
 * Pure and deterministic: same inputs → same verdict.
 */
export function criticizeZReport(opts: {
  narrative: ZReportNarrative;
  pack: EvidencePack;
  context: ZReportContext;
  /** Numbers the model was allowed to state (see zReportPrompts). */
  allowedNumbers: Set<string>;
  /** Numbers that only stale/expired evidence introduced. */
  staleOnlyNumbers?: Set<string>;
  source: 'llm' | 'deterministic';
}): ZReportCriticVerdict {
  const { narrative, pack, allowedNumbers } = opts;
  const issues: ZReportCriticIssue[] = [];
  const checks: string[] = [];
  const texts = allText(narrative);
  const joined = texts.join(' ');
  const add = (code: string, detail: string, blocking: boolean) => issues.push({ code, detail, blocking });

  // 1. Grounding — an independent re-verification, not a reuse of the prompt
  // layer's verdict. A deterministic narrative is grounded by construction.
  checks.push('grounding');
  if (opts.source === 'llm') {
    const ungrounded: string[] = [];
    for (const t of texts) {
      for (const tok of numericTokens(t)) {
        const clean = tok.replace(/,/g, '');
        if (!allowedNumbers.has(tok) && !allowedNumbers.has(clean) && !allowedNumbers.has(String(Number(clean)))) {
          ungrounded.push(tok);
        }
      }
    }
    if (ungrounded.length) add('ungrounded_number', `numbers not present in evidence: ${[...new Set(ungrounded)].slice(0, 5).join(', ')}`, true);
  }

  // 2. Structural integrity after grounding (broken sentences must never ship).
  checks.push('readability');
  for (const t of texts) {
    const reason = zReportTextProblem(t);
    if (reason) add(`malformed:${reason}`, 'a sentence is broken after grounding', true);
  }

  // 3. Causal safety — only gated causal evidence permits causation.
  checks.push('causal_language');
  if (!pack.ml?.hasCausalEvidence && texts.some(hasUnsupportedCausalLanguage)) {
    add('unsupported_causal_language', 'causation claimed without gated causal evidence', true);
  }

  // 4. Staleness — old readings must not be presented as current.
  checks.push('staleness');
  if (pack.staleSignals.length > 0) {
    if (opts.source === 'llm') {
      const staleOnly: string[] = [];
      for (const tok of numericTokens(joined)) {
        const clean = tok.replace(/,/g, '');
        if (opts.staleOnlyNumbers?.has(tok) || opts.staleOnlyNumbers?.has(clean)) staleOnly.push(tok);
      }
      if (staleOnly.length) {
        add('stale_presented_as_current', `values from no-longer-current readings were quoted: ${[...new Set(staleOnly)].slice(0, 4).join(', ')}`, true);
      }
    }
    if (!/stale|older|out of date|not current|expired/i.test(joined)) {
      add('undisclosed_stale_evidence', `${pack.staleSignals.length} non-current reading(s) were not disclosed`, true);
    }
  }

  // 5. Must-address evidence (the things an owner cannot be left unaware of).
  checks.push('must_address');
  for (const rule of Z_REPORT_MUST_ADDRESS) {
    const present = pack.signals.some((s) => s.code === rule.code && (s.freshness === 'fresh' || s.freshness === 'aging'));
    if (!present) continue;
    if (!rule.pattern.test(joined)) add(`unaddressed:${rule.code}`, `evidence about ${rule.label} is present but not addressed`, true);
  }

  // 6. Cross-source conflicts must be disclosed, never silently resolved.
  checks.push('conflict_disclosure');
  if (pack.conflicts.conflicts.length > 0 && !/disagree|inconsisten|conflict|both readings/i.test(joined)) {
    add('undisclosed_conflict', `${pack.conflicts.conflicts.length} cross-source disagreement(s) were not disclosed`, true);
  }

  // 7. Degradation disclosure — an unusable pack must be presented as limited.
  checks.push('degradation_disclosure');
  const degradedSources = pack.unavailable.length + pack.toolErrors.length;
  if (degradedSources > 0) {
    const disclosed = /not available|unavailable|failed|excluded|incomplete/i.test(joined);
    if (!disclosed) {
      add('undisclosed_degradation', `${degradedSources} unavailable/failed source(s) were not disclosed`, !pack.usable);
    }
  }
  if (!pack.usable && !/limited|incomplete|no usable|not available/i.test(joined)) {
    add('unusable_pack_not_stated', 'the evidence pack is not usable but the report does not say so', true);
  }

  const blocking = issues.filter((i) => i.blocking);
  return {
    verdict: blocking.length ? 'repair' : 'accept',
    issues,
    checks,
  };
}

/** Numbers that appear ONLY in non-current evidence (used for the staleness check). */
export function staleOnlyNumbers(pack: EvidencePack): Set<string> {
  const stale = new Set<string>();
  const current = new Set<string>();
  const push = (target: Set<string>, v: number | undefined) => {
    if (v === undefined || !Number.isFinite(v)) return;
    target.add(String(v));
    target.add(String(Math.round(v)));
    target.add(String(Math.round(v * 10) / 10));
  };
  for (const s of pack.signals) {
    const target = s.freshness === 'stale' || s.freshness === 'expired' ? stale : current;
    push(target, s.value);
    push(target, s.baseline);
    if (s.changePct !== undefined) push(target, Math.round(s.changePct * 1000) / 10);
  }
  for (const v of current) stale.delete(v);
  return stale;
}

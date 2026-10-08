/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * finalCritic.ts — the independent FINAL CRITIC (task §15).
 *
 * One LLM pass over the surviving, already-validated candidates. It can only
 * PASS, DOWNGRADE or REJECT — it can never add a candidate, never change the
 * economics and never introduce new evidence.
 *
 * Enforcement (not convention):
 *   - the response is parsed with a `.strict()` schema, so a `reasoning`,
 *     `chainOfThought` or `thinking` field FAILS validation — no hidden
 *     reasoning can be returned or stored;
 *   - every number an LLM reason states must appear in the grounded fact sheet
 *     it was given; ungrounded reasons are STRIPPED and disclosed;
 *   - a REJECT with no surviving grounded reason is downgraded to DOWNGRADE;
 *   - when the LLM is unavailable the critic returns an explicit
 *     `deterministic_fallback` PASS for every candidate and says so.
 */

import { generateJsonWithMeta, isLlmConfigured, LlmError } from '../shared/llmClient';
import type { RankedRecommendation } from '../intelligence/recommendationRanking';
import type { MlSignalSummary } from '../intelligence/mlTypes';
import {
  criticResponseSchema,
  type CriticVerdict,
  type CriticVerdictOutput,
  type SituationModel,
} from './contracts';

export const CRITIC_PROMPT_VERSION = 'marketing-final-critic-v1';

const CRITIC_SYSTEM = [
  'You are the independent FINAL CRITIC for one restaurant\'s marketing recommendations.',
  'For each candidate you receive, decide PASS, DOWNGRADE or REJECT.',
  'You may ONLY use the numbers and facts in the factsheet. Never invent a number, a metric, a competitor fact or a customer detail.',
  'Reject a candidate when its evidence does not support it, when two pieces of evidence disagree, or when it duplicates something already running.',
  'Return ONLY the JSON shape requested. Do not include any reasoning field, thinking field or prose outside the JSON.',
].join('\n');

const SCHEMA_HINT = `{
  "verdicts": [
    {
      "candidateId": string (exactly as given),
      "verdict": "PASS" | "DOWNGRADE" | "REJECT",
      "confidenceDelta": number (0 to -1, optional),
      "reasons": string[] (1..6, each must cite only numbers present in the factsheet)
    }
  ]
}`;

export interface CriticResult {
  verdicts: CriticVerdict[];
  source: 'llm' | 'deterministic_fallback';
  degradedReason?: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:\.\d+)?%?/g) ?? []).map((n) => n.replace(/[,\s]/g, ''));
}

/** Grounded factsheet: the ONLY numeric surface the critic may quote. */
export function buildCriticFactsheet(input: {
  recommendations: RankedRecommendation[];
  situation: SituationModel;
  ml: MlSignalSummary;
}): string {
  const lines: string[] = ['EVIDENCE FACTSHEET (the only facts and numbers that may be used):'];
  lines.push(`Overall situation confidence: ${input.situation.confidence}`);
  for (const f of input.situation.opportunities.slice(0, 8)) lines.push(`- Opportunity: ${f.statement}`);
  for (const r of input.situation.risks.slice(0, 5)) lines.push(`- Risk: ${r.statement}`);
  for (const c of input.situation.contradictions) lines.push(`- Contradiction: ${c}`);
  for (const u of input.situation.uncertainties.slice(0, 6)) lines.push(`- Uncertainty: ${u}`);
  lines.push(`ML evidence available: ${input.ml.availableKinds.join(', ') || 'none'} (causal uplift available: ${input.ml.hasCausalEvidence ? 'yes' : 'no'})`);
  lines.push('');
  lines.push('CANDIDATES (already deterministically validated):');
  for (const r of input.recommendations) {
    const e = r.economics;
    lines.push(
      [
        `- id=${r.id} rank=${r.rank} strategy=${r.strategy}`,
        `title="${r.title}"`,
        `engineScore=${r.engineScore} confidence=${r.confidence}`,
        `discountPercent=${e.discountPercent} projectedContributionMargin=${e.projectedContributionMargin}`,
        `incrementalRevenue=${e.incrementalRevenue} breakEvenUnits=${e.breakEvenIncrementalUnits}`,
        `economicallySafe=${e.economicallySafe} economicsAvailable=${e.available}`,
        `why="${(r.why[0] ?? '').slice(0, 200)}"`,
        `risks=${r.risks.join(' | ') || 'none stated'}`,
      ].join(' '),
    );
  }
  if (input.situation.unavailableDomains.length) {
    lines.push('');
    lines.push(`Domains with NO evidence (never cite them): ${input.situation.unavailableDomains.join(', ')}`);
  }
  return lines.join('\n');
}

/** Deterministic, honest fallback — no independent review was performed. */
function fallbackVerdicts(recommendations: RankedRecommendation[]): CriticVerdict[] {
  return recommendations.map((r) => ({
    candidateId: r.id,
    verdict: 'PASS' as const,
    reasons: ['No independent critic review was performed (the review model was unavailable); deterministic validation alone governs this candidate.'],
    confidenceDelta: 0,
    source: 'deterministic_fallback' as const,
    strippedClaims: [],
  }));
}

/**
 * Review the shortlist. NEVER throws: on any failure it returns the explicit
 * deterministic fallback for every candidate.
 */
export async function runFinalCritic(input: {
  recommendations: RankedRecommendation[];
  situation: SituationModel;
  ml: MlSignalSummary;
  requestId?: string;
  restaurantId: string;
  disableLlm?: boolean;
  /** Test seam. */
  llm?: typeof generateJsonWithMeta;
}): Promise<CriticResult> {
  if (!input.recommendations.length) {
    return { verdicts: [], source: 'deterministic_fallback', degradedReason: 'no candidates to review' };
  }
  if (input.disableLlm || (!input.llm && !isLlmConfigured())) {
    return {
      verdicts: fallbackVerdicts(input.recommendations),
      source: 'deterministic_fallback',
      degradedReason: 'LLM not configured for the final critic',
    };
  }

  const factsheet = buildCriticFactsheet(input);
  const call = input.llm ?? generateJsonWithMeta;
  try {
    const result = await call({
      system: CRITIC_SYSTEM,
      prompt: factsheet,
      schemaHint: SCHEMA_HINT,
      timeoutMs: 20_000,
    });
    const parsed = criticResponseSchema.safeParse(result.value);
    if (!parsed.success) {
      return {
        verdicts: fallbackVerdicts(input.recommendations),
        source: 'deterministic_fallback',
        degradedReason: `critic response failed strict schema validation (${parsed.error.issues[0]?.message ?? 'invalid'}) — extra reasoning fields are not accepted`,
        model: result.model,
        provider: result.provider,
      };
    }

    const byId = new Map(parsed.data.verdicts.map((v) => [v.candidateId, v]));
    const allowedNumbers = new Set(numbersIn(factsheet));
    const verdicts: CriticVerdict[] = input.recommendations.map((r) => {
      const raw: CriticVerdictOutput | undefined = byId.get(r.id);
      if (!raw) {
        return {
          candidateId: r.id,
          verdict: 'PASS' as const,
          reasons: ['The critic did not return a verdict for this candidate; deterministic validation alone governs it.'],
          confidenceDelta: 0,
          source: 'llm' as const,
          strippedClaims: [],
        };
      }
      const strippedClaims: string[] = [];
      const reasons = raw.reasons.filter((reason) => {
        const ungrounded = numbersIn(reason).filter((n) => !allowedNumbers.has(n));
        if (ungrounded.length) {
          strippedClaims.push(reason);
          return false;
        }
        return true;
      });
      let verdict: CriticVerdict['verdict'] = raw.verdict;
      // A rejection must rest on a surviving, grounded reason.
      if (verdict === 'REJECT' && reasons.length === 0) verdict = 'DOWNGRADE';
      if (verdict !== 'PASS' && reasons.length === 0) {
        reasons.push('The critic flagged this candidate but gave no grounded reason able to be used.');
      }
      return {
        candidateId: r.id,
        verdict,
        reasons,
        confidenceDelta: Math.min(0, raw.confidenceDelta ?? 0),
        source: 'llm' as const,
        strippedClaims,
      };
    });

    return {
      verdicts,
      source: 'llm',
      model: result.model,
      provider: result.provider,
      latencyMs: result.latencyMs,
      usage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        totalTokens: result.usage?.totalTokens ?? 0,
      },
    };
  } catch (err) {
    const kind = err instanceof LlmError ? err.kind : 'error';
    return {
      verdicts: fallbackVerdicts(input.recommendations),
      source: 'deterministic_fallback',
      degradedReason: `critic unavailable (${kind})`,
    };
  }
}

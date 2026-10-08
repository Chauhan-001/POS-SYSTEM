/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * memoryWriteback.ts — PHASE 14: every completed analysis becomes learnable.
 *
 * What is written, and what is deliberately NOT:
 *   - ONE `agent_run` episode per analysis, carrying the objective, the
 *     evidence REFERENCES behind the situation, the outcome status and counts.
 *   - ONE `recommendation_issued` event per recommendation (bounded), so the
 *     recommendation→action→outcome chain the learning layer needs exists.
 *
 * NEVER written: prompts, model output, chain-of-thought, raw tool payloads or
 * customer data. The episode stores statements that are already evidence-backed
 * and bounded, plus counts. Confidence is the DETERMINISTIC situation
 * confidence — this is a `service`-sourced memory, not an LLM claim.
 *
 * Failure is not fatal: recording never throws into the analysis path, and the
 * caller receives an explicit result it can disclose.
 */

import { memoryManager } from '../memory/memoryManager';
import { recordRecommendationLifecycleEvent } from '../memory/memoryLearningService';
import type { MemoryEvidence } from '../memory/memoryTypes';
import type { AiTenantContext } from '../shared/tenantContext';
import type {
  AnalyzedRecommendation,
  AnalyzeStatus,
  InvestigationSummary,
  SituationModel,
} from './contracts';

/** Recommendation lifecycle events written per analysis (bounded). */
export const MAX_RECOMMENDATION_EVENTS = 10;
/** Evidence references attached to one episode (schema max is 20). */
export const MAX_EPISODE_EVIDENCE = 20;

export interface MemoryWriteInput {
  tenant: AiTenantContext;
  runId: string;
  objective: string;
  status: AnalyzeStatus;
  situation: SituationModel;
  investigation: InvestigationSummary;
  recommendations: AnalyzedRecommendation[];
  directionPolicyApplied: boolean;
  rejectedCount: number;
  degradations: string[];
}

export interface MemoryWriteResult {
  episodeWritten: boolean;
  episodeId?: string;
  recommendationsRecorded: number;
  reason?: string;
}

/** Evidence refs from the situation — de-duplicated by ref, bounded. */
export function collectEpisodeEvidence(situation: SituationModel): MemoryEvidence[] {
  const out: MemoryEvidence[] = [];
  const seen = new Set<string>();
  const groups = [situation.opportunities, situation.risks, situation.confirmedFacts];
  for (const group of groups) {
    for (const fact of group) {
      const ref = fact.evidenceRefs.find(Boolean);
      if (!ref || seen.has(ref)) continue;
      seen.add(ref);
      out.push({ kind: 'signal', ref: ref.slice(0, 200), label: fact.statement.slice(0, 300) });
      if (out.length >= MAX_EPISODE_EVIDENCE) return out;
    }
  }
  return out;
}

/**
 * The exact payload handed to the memory manager. Pure + exported so the
 * "no CoT / no prompts / evidence-backed" rules are unit-testable.
 */
export function analysisEpisodeInput(input: MemoryWriteInput): Record<string, unknown> {
  const outcomes = input.situation.opportunities.slice(0, 3).map((f) => f.statement);
  const context = [
    `Marketing analysis ${input.status}.`,
    `Investigated: ${input.investigation.domainsInvestigated.join(', ') || 'none'}.`,
    `Unavailable: ${input.investigation.domainsUnavailable.join(', ') || 'none'}.`,
    `Missing evidence: ${input.situation.missingEvidence.join('; ') || 'none'}.`,
    `Contradictions: ${input.situation.contradictions.length}.`,
    outcomes.length ? `Notable: ${outcomes.join(' | ')}` : '',
    input.degradations.length ? `Degradations: ${input.degradations.slice(0, 4).join('; ')}` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 2_000);

  const outcomeStatus =
    input.status === 'failed' ? 'failure' : input.recommendations.length ? 'pending' : 'partial';
  const summary = (
    input.status === 'failed'
      ? 'The analysis could not produce a usable situation.'
      : `${input.recommendations.length} recommendation(s) issued from ${input.investigation.domainsInvestigated.length} investigated domain(s); ${input.rejectedCount} candidate(s) rejected by deterministic validation.`
  ).slice(0, 1_000);

  return {
    episodeType: 'agent_run',
    objective: input.objective.slice(0, 500),
    context,
    outcome: {
      status: outcomeStatus,
      summary,
      // Real numbers only — never an estimate.
      metrics: {
        recommendations: input.recommendations.length,
        rejected: input.rejectedCount,
        domainsInvestigated: input.investigation.domainsInvestigated.length,
        domainsUnavailable: input.investigation.domainsUnavailable.length,
        contradictions: input.situation.contradictions.length,
        confidence: input.situation.confidence,
      },
    },
    evidence: collectEpisodeEvidence(input.situation),
    confidence: input.situation.confidence,
    source: 'service',
    runId: input.runId,
    metadata: {
      mode: 'marketing_analyze',
      status: input.status,
      directionPolicyApplied: input.directionPolicyApplied,
      declaredDomains: input.situation.missingEvidence
        .filter((m) => m.includes('declared'))
        .map((m) => m.split(':')[0]),
      stepsUsed: input.investigation.stepsUsed,
      llmCalls: input.investigation.llmCalls,
      errorCode: input.investigation.errorCode ?? null,
    },
  };
}

/**
 * Record the episode + its recommendation events. NEVER throws.
 */
export async function recordAnalysisMemory(input: MemoryWriteInput): Promise<MemoryWriteResult> {
  const result: MemoryWriteResult = { episodeWritten: false, recommendationsRecorded: 0 };

  try {
    const episode = await memoryManager.recordEpisode(input.tenant, analysisEpisodeInput(input));
    result.episodeWritten = true;
    result.episodeId = episode.id;
  } catch (err) {
    result.reason = err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240);
    return result;
  }

  // Recommendation events are individually fault-tolerant: one failing event
  // must not lose the episode that was already written.
  for (const rec of input.recommendations.slice(0, MAX_RECOMMENDATION_EVENTS)) {
    const res = await recordRecommendationLifecycleEvent({
      tenant: input.tenant,
      action: 'recommended',
      recommendationId: rec.recommendation.id,
      strategy: rec.recommendation.type,
      title: rec.recommendation.title,
      confidence: rec.recommendation.confidence,
      evidence: [{ kind: 'signal', ref: `analysis:${input.runId}`.slice(0, 200), label: 'marketing analysis run' }],
    });
    if (res.recorded) result.recommendationsRecorded += 1;
    else if (!result.reason) result.reason = res.reason?.slice(0, 240);
  }

  return result;
}

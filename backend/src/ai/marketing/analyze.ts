/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * analyze.ts — the canonical Marketing Agent path (task §1).
 *
 *   context builder → signal scanner → Marketing Manager (sequential domain
 *   investigation) → situation model → candidate engine → ML enrichment →
 *   deterministic validation gate (authority) → ranking + diversity →
 *   final critic → 8–10 recommendations.
 *
 * The investigation the manager performed is CONSUMED here (not discarded):
 * the situation model is built from the captured domain results, and the same
 * evidence feeds ranking and the critic.
 *
 * Read-only: nothing is created, scheduled or sent. Owner approval stays
 * mandatory (the existing `/proposal` route is the only path to a draft).
 */

import { AiError } from '../shared/aiErrors';
import type { AiTenantContext } from '../shared/tenantContext';
import { registerAllTools } from '../tools/registerAllTools';
import type { ToolContext } from '../tools/registry/toolTypes';
import { recordLlmUsage } from '../observability/agentUsage';
import { auditService } from '../../modules/audit/auditService';
import {
  generatePromotionCandidates,
  deduplicateCandidates,
  type PromotionCandidate,
  type PromotionType,
} from '../../services/promotionCandidateService';
import { promotionTypesForDirections, reportDirectionPolicy } from './directionPolicy';
import { rankAndDiversify } from '../intelligence/recommendationRanking';
import { memoryStatement } from '../intelligence/marketingIntelligencePipeline';
import type { RestaurantMemoryRecord } from '../memory/memoryTypes';
import { buildMarketingContext } from './contextBuilder';
import { recordAnalysisMemory } from './memoryWriteback';
import { linkMeasuredOutcomesToMemory, consolidateProductPatterns } from './outcomeLearning';
import { runMarketingManager, runDeterministicDomainSweep, NO_LLM } from './marketingManager';
import { fetchMlEvidence, domainCapabilityCatalog } from './domains';
import { buildSituationModel } from './situationModel';
import { validateCandidates } from './validationGate';
import { runFinalCritic, CRITIC_PROMPT_VERSION } from './finalCritic';
import type { LoopLlmFn, LoopMemoryFn } from '../agents/loop/agentLoop';
import type {
  AnalyzeResponse,
  AnalyzedRecommendation,
  AnalyzeStatus,
  DomainInvestigation,
  InvestigationSummary,
} from './contracts';

export interface AnalyzeOptions {
  tenant: AiTenantContext;
  goal?: string;
  lookbackDays?: number;
  limit?: number;
  requestId?: string;
  /** Test seams. */
  llm?: LoopLlmFn;
  loadMemory?: LoopMemoryFn;
  disableLlm?: boolean;
  criticLlm?: typeof import('../shared/llmClient').generateJsonWithMeta;
}

const MIN_RECOMMENDATIONS = 8;
const MAX_RECOMMENDATIONS = 10;

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Run one canonical analysis. NEVER throws for data/LLM problems (only for an
 * invalid tenant identity — a security error, not a data one).
 */
export async function runMarketingAnalyze(options: AnalyzeOptions): Promise<AnalyzeResponse> {
  const startedAt = Date.now();
  const restaurantId = options.tenant?.restaurantId;
  if (!restaurantId || !/^[a-fA-F0-9]{24}$/.test(restaurantId)) {
    throw new AiError('TOOL_TENANT_MISMATCH', 'runMarketingAnalyze requires an authenticated tenant');
  }
  registerAllTools(); // the shared registry stays the only tool source

  const degradations: string[] = [];
  const lookbackDays = options.lookbackDays ?? 90;

  // ── 0. Learning BEFORE context (Phase 15) ───────────────────────────────
  // Measured outcomes and per-item patterns are folded into memory first, so
  // THIS run's context already reflects what previous runs learned. Both are
  // bounded and never throw; the product-pattern pass is freshness-guarded so
  // it does not repeat the menu-engineering read on every call.
  const outcomeLearning = await linkMeasuredOutcomesToMemory(options.tenant, { limit: 25 });
  const productPatterns = await consolidateProductPatterns(options.tenant, { lookbackDays });
  const learningNotes = [...outcomeLearning.reasons, ...productPatterns.reasons];
  if (outcomeLearning.linked) {
    degradations.push(
      `learned from ${outcomeLearning.linked} measured outcome(s) recorded by earlier campaigns (${outcomeLearning.causal} measured against a control group)`,
    );
  }
  if (outcomeLearning.unusable) {
    degradations.push(
      `${outcomeLearning.unusable} measured outcome(s) carried no usable variance and were NOT learned from`,
    );
  }
  // Feedback-trend learning is deliberately absent: the feedback domain is
  // declared-only, so there is no satisfaction signal to learn from.
  degradations.push('feedback-trend learning is not implemented (feedback domain is declared only)');

  // ── 1. Context (objective + cheap scan + memory ladder) ─────────────────
  const context = await buildMarketingContext({
    tenant: options.tenant,
    branchId: options.tenant.branchId,
    goal: options.goal,
    lookbackDays,
    loadMemory: options.loadMemory,
  });
  degradations.push(...context.degradations);

  // ── 2. Marketing Manager: sequential domain investigation ───────────────
  let manager = await runMarketingManager({
    tenant: options.tenant,
    objective: context.objective,
    requestId: options.requestId,
    // A disabled model is an EXPLICIT unavailability, never a silent fall-through
    // to the configured provider (which would make offline runs hit the network).
    llm: options.llm ?? (options.disableLlm ? NO_LLM : undefined),
    loadMemory: options.loadMemory,
  });
  let investigations: DomainInvestigation[] = manager.investigations;
  let usedDeterministicFallback = false;

  const llmUnusable =
    manager.memory.status === 'llm_unavailable' ||
    manager.memory.status === 'failed' ||
    (options.disableLlm && investigations.length === 0);

  if (investigations.length === 0) {
    // Graceful degradation: the deterministic sweep still grounds the output.
    investigations = await runDeterministicDomainSweep({
      tenant: options.tenant,
      branchId: options.tenant.branchId,
      lookbackDays,
    });
    usedDeterministicFallback = true;
    degradations.push(
      llmUnusable
        ? 'the investigation model was unavailable — the deterministic domain sweep grounded this analysis instead'
        : 'the investigation returned no domain evidence — the deterministic domain sweep was used instead',
    );
  }
  if (usedDeterministicFallback) {
    manager = { ...manager, investigations, usedDeterministicFallback: true };
  }

  // ── 3. Situation model (built FROM the investigation, not a re-run) ──────
  const situation = buildSituationModel({
    objective: context.goal,
    investigations,
    scanSignals: [],
    memoryDegraded: Boolean(context.memory.degraded),
    extraUncertainties: manager.stopGuardObjections,
  });

  // ── 4. Candidate engine, RESTRICTED to the investigated directions ──────
  // The direction constrains GENERATION (the engine does not even detect the
  // sources that cannot produce a directed type) — it does not post-filter a
  // full unrestricted run.
  const narrowing = promotionTypesForDirections(situation.candidateDirections);
  const runEngine = async (types?: PromotionType[]): Promise<PromotionCandidate[]> =>
    deduplicateCandidates(
      await generatePromotionCandidates({ restaurantId, branchId: options.tenant.branchId, lookbackDays, types }),
    );

  let candidates: PromotionCandidate[] = [];
  let directionFallbackUsed = false;
  try {
    candidates = await runEngine(narrowing.types.length ? narrowing.types : undefined);
    if (narrowing.types.length && candidates.length === 0) {
      // Honest fallback: the directions genuinely constrained the engine and it
      // produced nothing. Rather than return an empty page, run unrestricted and
      // DISCLOSE that the directions were not realised (never forced).
      directionFallbackUsed = true;
      degradations.push(
        'the direction-restricted engine run produced no candidate; the unrestricted engine was used instead and every direction is reported as unrealised',
      );
      candidates = await runEngine();
    }
    if (!candidates.length) degradations.push('the candidate engine produced no candidates above its thresholds');
  } catch (err) {
    degradations.push(`candidate engine error: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`);
  }

  const directionPolicy = reportDirectionPolicy(
    narrowing,
    situation.candidateDirections,
    candidates,
    narrowing.types.length > 0,
    directionFallbackUsed,
  );
  if (narrowing.unrepresentable.length) {
    degradations.push(
      `${narrowing.unrepresentable.length} investigated direction(s) have no engine promotion type and were NOT turned into an offer: ${narrowing.unrepresentable.map((u) => u.direction).join(', ')}`,
    );
  }
  if (!directionFallbackUsed && directionPolicy.unrealisedDirections.length) {
    degradations.push(
      `${directionPolicy.unrealisedDirections.length} investigated direction(s) produced no engine candidate and were NOT forced into an offer`,
    );
  }

  // ── 5. ML enrichment (bounded, non-causal unless gated) ─────────────────
  const mlCtx: ToolContext = {
    tenant: options.tenant,
    executionId: `analyze-${startedAt.toString(36)}`,
    timeoutMs: 6_000,
  };
  const ml = await fetchMlEvidence(mlCtx);
  for (const line of ml.summary.degradations.map((d) => `${d.model}: ${d.detail}`)) degradations.push(line);

  // ── 6. Deterministic validation gate (AUTHORITY) ────────────────────────
  const gate = await validateCandidates({
    tenant: options.tenant,
    candidates,
    investigations,
    lookbackDays,
  });
  degradations.push(...gate.degradations);

  // ── 7. Ranking + strategy diversity (8–10 target) ───────────────────────
  const memoryHints = (context.memory.longTerm ?? [] as RestaurantMemoryRecord[]).map((m) => ({
    ref: m.id,
    statement: memoryStatement(m),
    confidence: m.confidence,
    memoryType: m.memoryType,
  }));
  const ranking = rankAndDiversify({
    candidates: gate.passed,
    signals: situation.topSignals,
    ml: ml.summary,
    memoryHints,
    limit: options.limit ?? MAX_RECOMMENDATIONS,
    maxPerStrategy: 2,
  });
  for (const note of ranking.notes) degradations.push(note);
  if (ranking.recommendations.length && ranking.recommendations.length < MIN_RECOMMENDATIONS) {
    degradations.push(
      `only ${ranking.recommendations.length} recommendation(s) met the evidence bar (target ${MIN_RECOMMENDATIONS}–${MAX_RECOMMENDATIONS}); the shortlist was not padded`,
    );
  }

  // ── 8. Final critic (independent, strict, cannot add or re-price) ───────
  const critic = await runFinalCritic({
    recommendations: ranking.recommendations,
    situation,
    ml: ml.summary,
    restaurantId,
    requestId: options.requestId,
    disableLlm: options.disableLlm,
    llm: options.criticLlm,
  });
  if (critic.source === 'llm') {
    void recordLlmUsage({
      restaurantId,
      requestId: options.requestId ?? `critic-${startedAt.toString(36)}`,
      promptVersion: CRITIC_PROMPT_VERSION,
      feature: 'marketing_manager',
      promptText: 'final-critic-factsheet',
      model: critic.model ?? '',
      provider: critic.provider ?? '',
      latencyMs: critic.latencyMs ?? 0,
      inputTokens: critic.usage?.inputTokens ?? 0,
      outputTokens: critic.usage?.outputTokens ?? 0,
      totalTokens: critic.usage?.totalTokens ?? 0,
      success: true,
    });
  } else if (critic.degradedReason) {
    degradations.push(`final critic: ${critic.degradedReason}`);
  }

  const criticById = new Map(critic.verdicts.map((v) => [v.candidateId, v]));
  const validationById = new Map(gate.validations.map((v) => [v.candidateId, v]));

  const recommendations: AnalyzedRecommendation[] = [];
  for (const rec of ranking.recommendations) {
    const verdict = criticById.get(rec.id) ?? {
      candidateId: rec.id,
      verdict: 'PASS' as const,
      reasons: ['No critic verdict returned; deterministic validation alone governs it.'],
      confidenceDelta: 0,
      source: 'deterministic_fallback' as const,
      strippedClaims: [],
    };
    if (verdict.verdict === 'REJECT') {
      const codes = ['CRITIC_REJECT'];
      gate.rejected.push({ candidateId: rec.id, title: rec.title, codes });
      continue;
    }
    const validation = validationById.get(rec.id);
    recommendations.push({
      recommendation: {
        rank: 0,
        id: rec.id,
        type: rec.type,
        strategy: rec.strategy,
        strategyLabel: rec.strategyLabel,
        title: rec.title,
        description: rec.description,
        recommendedAction: rec.recommendedAction,
        engineScore: rec.engineScore,
        confidence: Math.max(0, Math.min(1, rec.confidence + verdict.confidenceDelta)),
        priority: rec.priority,
        economics: rec.economics,
        target: rec.target,
        risks: rec.risks,
        prerequisites: rec.prerequisites,
        why: rec.why,
        provenance: rec.provenance,
      },
      validation:
        validation ?? {
          candidateId: rec.id,
          passed: true,
          rejectionCodes: [],
          checks: [],
        },
      critic: verdict,
    });
  }
  recommendations.forEach((r, i) => {
    r.recommendation.rank = i + 1;
  });

  // ── 9. Assemble + status/confidence/risk ────────────────────────────────
  const llmFailed = manager.memory.status === 'llm_unavailable' || manager.memory.status === 'failed';
  const implementedDomains = investigations.filter((i) => i.implemented);
  const domainsInvestigated = implementedDomains.filter((i) => i.status !== 'unavailable').map((i) => i.domain);
  const domainsUnavailable = implementedDomains.filter((i) => i.status === 'unavailable').map((i) => i.domain);
  // Declared-only capabilities are disclosed even when the model never picked
  // them: a capability that exists in the catalog but has no implementation must
  // be visible in the output, so nobody reads its silence as "nothing to report".
  const declaredOnly = [
    ...new Set([
      ...investigations.filter((i) => !i.implemented).map((i) => i.domain),
      ...domainCapabilityCatalog().filter((c) => !c.implemented).map((c) => c.domain),
    ]),
  ];
  for (const d of declaredOnly) {
    degradations.push(`${d} domain is declared only and was not investigated — no ${d} fact is asserted`);
    situation.missingEvidence.push(`${d}: capability declared but not implemented`);
  }
  situation.missingEvidence = [...new Set(situation.missingEvidence)];

  const investigation: InvestigationSummary = {
    runId: manager.memory.runId,
    status: manager.memory.status,
    stepsUsed: manager.memory.budget.stepsUsed,
    toolCallsUsed: manager.memory.budget.toolCallsUsed,
    llmCalls: manager.memory.llm.calls,
    domainsInvestigated,
    domainsUnavailable,
    domainOrder: usedDeterministicFallback ? investigations.map((i) => i.domain) : manager.domainOrder,
    stopGuardObjections: manager.stopGuardObjections,
    rejections: manager.memory.rejections.map((r) => ({ ref: r.ref, reason: r.reason, stage: r.stage })),
    tokensUsed: manager.memory.budget.tokensUsed,
    costUsd: Number(manager.memory.budget.costUsd.toFixed(6)),
    errorCode: manager.memory.error?.code,
  };

  const hasEvidence = investigations.some((i) => i.findings.length > 0);
  if (!recommendations.length && !hasEvidence) {
    // Honest negative: thin data is disclosed, never dressed up as a finding.
    degradations.push(
      'no usable business evidence was found in this window, so no recommendation could be supported — this is a data gap, not a healthy business',
    );
  }
  // The model can stop early (rate limit / transient error) AFTER real domain
  // evidence was captured. That is NOT "no LLM": the gathered evidence is used,
  // and the early stop is disclosed as a degradation instead.
  const stoppedEarlyWithEvidence =
    llmFailed && !usedDeterministicFallback && investigations.some((i) => i.findings.length > 0);
  if (stoppedEarlyWithEvidence) {
    degradations.push(
      `the investigation model stopped early (${manager.memory.error?.code ?? 'unknown'}) after ${manager.memory.budget.stepsUsed} step(s); the evidence already gathered was used rather than discarded`,
    );
  }

  // 'failed' is reserved for a run that genuinely broke. Thin data / no model is
  // a DISCLOSED degraded run, not a system failure.
  let status: AnalyzeStatus;
  if (manager.memory.status === 'failed' && !hasEvidence && !recommendations.length) status = 'failed';
  else if (usedDeterministicFallback) status = 'degraded_no_llm';
  else if (stoppedEarlyWithEvidence) status = 'completed_degraded';
  else if (llmFailed || degradations.length || domainsUnavailable.length || critic.source !== 'llm') status = 'completed_degraded';
  else status = 'completed';

  const confidence = Number(
    Math.max(0, Math.min(1, 0.5 * situation.confidence + 0.5 * mean(recommendations.map((r) => r.recommendation.confidence)))).toFixed(3),
  );
  const risk: AnalyzeResponse['risk'] =
    situation.contradictions.length > 0 || domainsUnavailable.length >= 3
      ? 'high'
      : degradations.length || declaredOnly.length || !recommendations.length
        ? 'medium'
        : 'low';

  const response: AnalyzeResponse = {
    mode: 'marketing_analyze',
    runId: manager.memory.runId,
    status,
    objective: context.goal,
    situation,
    investigation,
    recommendations,
    directionPolicy,
    rejected: gate.rejected,
    validationSources: gate.sources,
    outcomeLearning: {
      outcomesLinked: outcomeLearning.linked,
      outcomesPositive: outcomeLearning.positive,
      outcomesNegative: outcomeLearning.negative,
      outcomesUnusable: outcomeLearning.unusable,
      causalOutcomes: outcomeLearning.causal,
      productPatternsWritten: productPatterns.written,
      productPatternsSkippedFresh: productPatterns.skippedFresh,
      notes: learningNotes,
    },
    // Filled in below once the write is attempted — never reported as done early.
    memoryWrite: { attempted: false, episodeWritten: false, recommendationsRecorded: 0 },
    confidence,
    risk,
    degradations: [...new Set(degradations)],
    memory: {
      episodes: (context.memory.episodes ?? []).length,
      longTerm: (context.memory.longTerm ?? []).length,
      degraded: Boolean(context.memory.degraded),
    },
    approvalRequired: true,
    generatedAt: new Date().toISOString(),
  };

  // ── 10. Memory write-back (Phase 14) — the analysis becomes learnable ──
  const written = await recordAnalysisMemory({
    tenant: options.tenant,
    runId: response.runId,
    objective: context.goal,
    status: response.status,
    situation: response.situation,
    investigation: response.investigation,
    recommendations: response.recommendations,
    directionPolicyApplied: response.directionPolicy.applied,
    rejectedCount: response.rejected.length,
    degradations: response.degradations,
  });
  response.memoryWrite = {
    attempted: true,
    episodeWritten: written.episodeWritten,
    episodeId: written.episodeId,
    recommendationsRecorded: written.recommendationsRecorded,
    reason: written.reason,
  };
  if (!written.episodeWritten) {
    response.degradations.push(`memory write-back failed: ${written.reason ?? 'unknown reason'}`);
  }

  // ── 11. Observability (counts only — never prompts, payloads or CoT) ────
  try {
    await auditService.log({
      action: 'marketing_analyze_run',
      entityType: 'agent_run',
      entityId: manager.memory.runId,
      entityLabel: 'marketing_manager',
      restaurantId,
      branchId: options.tenant.branchId,
      requestId: options.requestId ?? manager.memory.requestId,
      correlationId: manager.memory.runId,
      durationMs: Date.now() - startedAt,
      executionTimeMs: Date.now() - startedAt,
      success: status !== 'failed',
      status: status === 'completed' ? 'success' : 'partial',
      comments: 'Canonical Marketing Agent analysis — counts only.',
      details: {
        status,
        domainsInvestigated,
        domainsUnavailable,
        declaredOnly,
        candidatesConsidered: candidates.length,
        rejected: gate.rejected.length,
        recommendations: recommendations.length,
        strategies: ranking.strategies,
        criticVerdicts: critic.verdicts.map((v) => v.verdict),
        criticSource: critic.source,
        degradations: response.degradations.slice(0, 12),
      },
    } as never);
  } catch {
    // Observability must never break the analysis.
  }

  return response;
}

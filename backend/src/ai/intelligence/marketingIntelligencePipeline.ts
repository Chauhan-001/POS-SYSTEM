/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingIntelligencePipeline.ts — the Phase 3→7 orchestration layer.
 *
 * FLOW (all deterministic except the optional Phase 7 speech):
 *   1. gather      — canonical business investigation (Phase 3) runs over the
 *                    shared tool registry, in parallel with the existing
 *                    candidate engine (Phase 4, via promotionCandidateService)
 *                    and the ML status reads (Phase 5).
 *   2. normalize   — ML evidence classified with explicit semantics.
 *   3. rank        — Phase 6 deterministic ranking + strategy diversity.
 *   4. explain     — Phase 7 grounded explanation for the top pick (LLM
 *                    optional; always degrades to a deterministic template).
 *
 * The pipeline NEVER writes to the database, NEVER sends campaigns, and NEVER
 * bypasses owner approval. Every step degrades independently: a failure in one
 * stage leaves the others' output intact and is reported honestly.
 */

import { AiError } from '../shared/aiErrors';
import type { AiTenantContext } from '../shared/tenantContext';
import { registerAllTools } from '../tools/registerAllTools';
import { toolRegistry } from '../tools/registry/toolRegistry';
import { executeTool } from '../tools/registry/toolExecutor';
import {
  investigateBusiness,
  businessInvestigationSummary,
  type BusinessDimension,
  type BusinessInvestigation,
} from './businessIntelligenceService';
import type { BusinessSignal } from './businessSignalTypes';
import type { MlEvidence, MlSignalSummary } from './mlTypes';
import {
  basketEvidence,
  forecastEvidence,
  responseEvidence,
  segmentEvidence,
  summarizeMlEvidence,
  upliftEvidence,
  mlDegradationLines,
} from './mlSemantics';
import { rankAndDiversify, memoryTypesForType, type RankingResult, type RankedRecommendation } from './recommendationRanking';
import {
  buildExplanationFacts,
  explainRecommendation,
  type ExplanationResult,
} from './recommendationExplanation';
import {
  generatePromotionCandidates,
  deduplicateCandidates,
  type PromotionCandidate,
} from '../../services/promotionCandidateService';
import { loadMemoryContext } from '../memory/memoryManager';
import type { AgentMemoryContext, MemoryEpisodeRecord, RestaurantMemoryRecord } from '../memory/memoryTypes';
import { recordLlmUsage } from '../observability/agentUsage';
import { auditService } from '../../modules/audit/auditService';

// ─────────────────────────────────────────────────────────────────────────────
// Options / result
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketingIntelligenceOptions {
  tenant: AiTenantContext;
  branchId?: string;
  /** Detailed investigation (Phase 3) is included in the result. */
  includeSignals?: boolean;
  /** Wall-clock budget for the signal fan-out (default 8s, max 20s). */
  signalBudgetMs?: number;
  /** Restrict the Phase 3 investigation to specific dimensions. */
  dimensions?: BusinessDimension[];
  /** Engine analysis window for candidate generation (default 90 days). */
  lookbackDays?: number;
  /** Final shortlist size (default 8). */
  limit?: number;
  /** Minimum candidates to consider (engine thresholds are separate). */
  minimumCandidates?: number;
  /** Explain the top recommendation with the shared LLM (default true). */
  explain?: boolean;
  /** Test seam / offline: never call the LLM. */
  disableLlm?: boolean;
  /** Test seams. */
  loadMemory?: (tenant: AiTenantContext) => Promise<AgentMemoryContext>;
  now?: number;
  /** Correlation id for the observability trail (from x-request-id). */
  requestId?: string;
}

export interface MarketingIntelligenceResult {
  ranking: RankingResult;
  /** Phase 3 investigation (present when includeSignals !== false). */
  investigation?: {
    summary: ReturnType<typeof businessInvestigationSummary>;
    topSignalLines: string[];
    signals: BusinessSignal[];
    dimensions: BusinessInvestigation['dimensions'];
    unavailableDimensions: string[];
    toolErrors: BusinessInvestigation['toolErrors'];
  };
  /** Phase 5 ML semantics summary. */
  ml: {
    summary: MlSignalSummary;
    degradationLines: string[];
  };
  /** Phase 7 explanation of the top recommendation (or null when none). */
  explanation: ExplanationResult | null;
  /** Memory context counts + top statements used for grounding. */
  memory: {
    episodes: number;
    longTerm: number;
    degraded: boolean;
    /** Validated long-term statements shown to the owner (no raw JSON). */
    statements: Array<{ ref: string; memoryType: string; statement: string; confidence: number }>;
  };
  /** Stage-level degradation notes (nothing is hidden). */
  degradations: string[];
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ML_TOOL_NAMES = {
  uplift: 'getUpliftSignals',
  response: 'getOfferResponseBatchScores',
  segment: 'getMLCustomerSegments',
  demand: 'getDemandForecast',
  basket: 'getMarketBasketSignals',
} as const;

/**
 * Owner-readable statement for a long-term memory row. Never emits raw
 * `key=value` internals: the same string is shown to the owner AND fed to the
 * explanation prompt, so it must read as plain English.
 */
export function memoryStatement(m: RestaurantMemoryRecord): string {
  const v = (m.value && typeof m.value === 'object' ? (m.value as Record<string, unknown>) : {}) as Record<string, unknown>;
  const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  const ref = typeof m.entityRef === 'string' ? m.entityRef : '';
  const subject = ref.includes(':') ? ref.split(':').slice(1).join(':') : ref;

  switch (m.memoryType) {
    case 'campaign_performance_pattern': {
      const rate = num(v.redemptionRate);
      const recipients = num(v.recipients);
      const who = subject ? `On ${subject}` : 'In past campaigns';
      const ratePart = rate !== undefined ? `, about ${Math.round(rate * 100)}% of recipients redeemed` : '';
      const sizePart = recipients !== undefined ? ` (${recipients} recipients)` : '';
      return `${who}${ratePart}${sizePart}.`;
    }
    case 'seasonality_pattern': {
      const lift = num(v.festiveLiftPct);
      return lift !== undefined
        ? `Seasonal demand has lifted about ${lift}% during festive periods.`
        : 'Seasonal demand patterns are on record for this restaurant.';
    }
    case 'promotion_fatigue_pattern':
      return 'Customers have shown signs of getting less responsive to frequent promotions.';
    case 'audience_response_pattern':
      return `Past audience response${subject ? ` for ${subject}` : ''} is on record.`;
    default: {
      const label = m.memoryType.replace(/_/g, ' ');
      return `${label}${subject ? ` (${subject})` : ''} is on record.`;
    }
  }
}

/** A memory episode that a recommendation was issued (Phase 8 hook point). */
export function recommendationEpisodeEvidence(rec: RankedRecommendation): string {
  return `recommendation ${rec.id} (${rec.strategyLabel}) rank #${rec.rank}, engine score ${rec.engineScore}`;
}

/**
 * PHASE P: the pipeline must emit the SAME observability as the agent path.
 * Writes one AIUsageLog row for the explanation LLM call (accurate tokens when
 * reported) plus one audit-trail row for the run — counts only, never prompts
 * or customer data. Never throws.
 */
async function persistIntelligenceObservability(input: {
  tenant: AiTenantContext;
  requestId: string;
  durationMs: number;
  result: MarketingIntelligenceResult;
}): Promise<void> {
  const { result } = input;
  const exp = result.explanation;
  if (exp && (exp.source === 'llm' || exp.llmAttempted)) {
    void recordLlmUsage({
      restaurantId: input.tenant.restaurantId,
      requestId: input.requestId,
      promptVersion: 'phase7-explanation-v1',
      promptText: JSON.stringify({
        recommendations: result.ranking.recommendations.length,
        top: result.ranking.recommendations[0]?.title ?? null,
      }),
      model: exp.model ?? 'unknown',
      provider: exp.provider ?? 'unknown',
      latencyMs: exp.latencyMs ?? 0,
      inputTokens: exp.usage?.inputTokens ?? 0,
      outputTokens: exp.usage?.outputTokens ?? 0,
      totalTokens: exp.usage?.totalTokens ?? 0,
      success: exp.source === 'llm',
      errorType: exp.source === 'llm' ? null : exp.degradedReason ?? 'unknown',
      fallbackReason: exp.source === 'llm' ? null : `deterministic explanation (${exp.degradedReason ?? 'unknown'})`,
    });
  }
  try {
    await auditService.log({
      action: 'marketing_intelligence_run',
      entityType: 'agent_run',
      entityId: input.requestId,
      entityLabel: 'marketing_intelligence_pipeline',
      restaurantId: input.tenant.restaurantId,
      branchId: input.tenant.branchId,
      requestId: input.requestId,
      correlationId: input.requestId,
      durationMs: input.durationMs,
      executionTimeMs: input.durationMs,
      success: true,
      status: result.degradations.length > 0 ? 'partial' : 'success',
      comments: 'Phase 3-7 marketing intelligence pipeline — counts only.',
      details: {
        recommendations: result.ranking.recommendations.length,
        strategies: result.ranking.strategies,
        signals: result.investigation?.signals.length ?? 0,
        unavailableDimensions: result.investigation?.unavailableDimensions ?? [],
        toolErrors: result.investigation?.toolErrors?.length ?? 0,
        mlAvailableKinds: result.ml.summary.availableKinds,
        explanationSource: result.explanation?.source ?? 'none',
        degradations: result.degradations,
      },
    } as any);
  } catch {
    // Observability must never break the pipeline.
  }
}

/** Fetch ML statuses through the shared registry — failures degrade, never throw. */
async function fetchMlEvidence(
  tenant: AiTenantContext,
  branchId: string | undefined,
  deadlineAt: number,
): Promise<{ evidence: MlEvidence[]; errors: string[] }> {
  const evidence: MlEvidence[] = [];
  const errors: string[] = [];

  const runOne = async (toolName: string, input: Record<string, unknown>) => {
    const tool = toolRegistry.get(toolName);
    if (!tool) return null;
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return null;
    const res = await executeTool(tool, input, { tenant, deadlineAt, timeoutMs: Math.min(remaining, 4_000) });
    if (!res.ok) {
      errors.push(`${toolName}: ${res.code}`);
      return null;
    }
    return res.data as Record<string, unknown>;
  };

  const [uplift, response, segment, demand, basket] = await Promise.all([
    runOne(ML_TOOL_NAMES.uplift, {}),
    runOne(ML_TOOL_NAMES.response, {}),
    runOne(ML_TOOL_NAMES.segment, branchId ? { branchId } : {}),
    runOne(ML_TOOL_NAMES.demand, branchId ? { branchId } : {}),
    runOne(ML_TOOL_NAMES.basket, branchId ? { branchId } : {}),
  ]);

  evidence.push(upliftEvidence(uplift as never));
  evidence.push(responseEvidence(response as never));
  evidence.push(segmentEvidence(segment as never));
  evidence.push(forecastEvidence(demand as never));
  evidence.push(basketEvidence(basket as never));
  return { evidence, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full marketing-intelligence pipeline for one tenant.
 *
 * NEVER throws for data problems (only for invalid tenant identity).
 * Deterministic except for the optional Phase 7 LLM wording.
 */
export async function runMarketingIntelligence(
  options: MarketingIntelligenceOptions,
): Promise<MarketingIntelligenceResult> {
  const startedAt = Date.now();
  const restaurantId = options.tenant?.restaurantId;
  if (!restaurantId || !/^[a-fA-F0-9]{24}$/.test(restaurantId)) {
    throw new AiError('TOOL_TENANT_MISMATCH', 'runMarketingIntelligence requires an authenticated tenant');
  }

  registerAllTools(); // idempotent — the shared registry is the only tool source

  const degradations: string[] = [];
  const signalBudgetMs = Math.max(1_000, Math.min(options.signalBudgetMs ?? 12_000, 20_000));
  const deadlineAt = startedAt + signalBudgetMs;

  // ── Stage 1: gather (signals + candidates + ML + memory in parallel) ──────
  const signalsPromise: Promise<BusinessInvestigation | null> =
    options.includeSignals === false
      ? Promise.resolve(null)
      : investigateBusiness({
          tenant: options.tenant,
          branchId: options.branchId,
          budgetMs: signalBudgetMs,
          dimensions: options.dimensions,
          // D-16: the requested window reaches the window-aware signal tools.
          lookbackDays: options.lookbackDays,
        }).catch((err) => {
          degradations.push(`business investigation failed: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        });

  const candidatesPromise: Promise<PromotionCandidate[] | null> = (async () => {
    try {
      // Server-side orchestration calls the EXISTING engine directly (the
      // shared registry tool with the same name serves agentic tool-calls;
      // both paths run the same promotionCandidateService — no second engine).
      const raw = await generatePromotionCandidates({
        restaurantId: options.tenant.restaurantId,
        branchId: options.branchId,
        lookbackDays: options.lookbackDays ?? 90,
      });
      const candidates = deduplicateCandidates(raw);
      if (candidates.length === 0) {
        degradations.push('candidate engine produced no candidates above its thresholds');
        return [];
      }
      return candidates;
    } catch (err) {
      degradations.push(`candidate engine error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  })();

  const mlPromise = fetchMlEvidence(options.tenant, options.branchId, deadlineAt);

  const memoryPromise: Promise<AgentMemoryContext> = (async () => {
    try {
      const loader = options.loadMemory ?? ((t: AiTenantContext) => loadMemoryContext(t, { episodeLimit: 5, memoryLimit: 5 }));
      return await loader(options.tenant);
    } catch (err) {
      degradations.push(`memory load failed: ${err instanceof Error ? err.message : String(err)}`);
      return { episodes: [], longTerm: [], priorityStatement: '', loadedAt: new Date().toISOString(), degraded: true } as unknown as AgentMemoryContext;
    }
  })();

  const [investigation, candidates, ml, memory] = await Promise.all([
    signalsPromise,
    candidatesPromise,
    mlPromise,
    memoryPromise,
  ]);

  // ── Stage 2: ML semantics ────────────────────────────────────────────────
  const mlSummary = summarizeMlEvidence(ml.evidence);
  const degradationLines = mlDegradationLines(mlSummary);
  for (const line of degradationLines) degradations.push(line);
  for (const e of ml.errors) degradations.push(`ML tool unavailable: ${e}`);

  // ── Stage 3: ranking + diversity ─────────────────────────────────────────
  const longTermMemory = (memory.longTerm ?? []) as RestaurantMemoryRecord[];
  const memoryHints = longTermMemory.map((m) => ({
    ref: m.id,
    statement: memoryStatement(m),
    confidence: m.confidence,
    memoryType: m.memoryType,
  }));

  const usableCandidates = (candidates ?? []) as PromotionCandidate[];
  const ranking = rankAndDiversify({
    candidates: usableCandidates,
    signals: investigation?.signals ?? [],
    ml: mlSummary,
    memoryHints,
    limit: options.limit ?? 8,
  });
  for (const note of ranking.notes) degradations.push(note);

  // ── Stage 4: grounded explanation of the top pick ─────────────────────────
  // Relevance filter: only memory whose type actually maps to the TOP
  // recommendation's strategy may be quoted as supporting it. Without this a
  // seasonality pattern could be presented as evidence for a promotion.
  const topRec = ranking.recommendations.find((r) => r.rank === 1);
  const relevantTopMemory = topRec
    ? memoryHints.filter((m) => memoryTypesForType(topRec.type).includes(m.memoryType))
    : [];
  const topMemoryStatements = relevantTopMemory.slice(0, 3).map((m) => m.statement);
  // Signals that exist but were not correlated with any picked recommendation
  // (disclosed to the explanation so it can say what was NOT used).
  // Both product-correlated evidence AND dimension-level themes count as
  // "used" — anything else is disclosed as NOT used (D-19).
  const usedSignalCodes = new Set(
    ranking.recommendations.flatMap((r) => [...r.provenance.signalCodes, ...r.provenance.signalThemes]),
  );
  const unusedSignals = (investigation?.signals ?? [])
    .filter((s) => !usedSignalCodes.has(s.code))
    .map((s) => s.code);
  const facts = buildExplanationFacts({
    ranking,
    currency: '₹',
    unusedSignals: [...new Set(unusedSignals)].slice(0, 6),
    mlDegradations: degradationLines,
    // Causal language is only permitted when gated experiment evidence exists.
    hasCausalEvidence: mlSummary.hasCausalEvidence,
  });
  // Attach validated memory statements only to the recommendations they support.
  for (const r of facts.recommendations) {
    if (r.rank === 1 && topMemoryStatements.length) r.memoryStatements = topMemoryStatements;
  }

  let explanation: ExplanationResult | null = null;
  if (ranking.recommendations.length > 0 && options.explain !== false) {
    explanation = await explainRecommendation({
      facts,
      rank: 1,
      disableLlm: options.disableLlm || !process.env.AI_API_KEY,
    });
    if (explanation.source === 'deterministic' && explanation.degradedReason) {
      degradations.push(`explanation degraded: ${explanation.degradedReason}`);
    }
  }

  // ── Assemble ─────────────────────────────────────────────────────────────
  const statements = memoryHints.map((m) => ({
    ref: m.ref,
    memoryType: m.memoryType,
    statement: m.statement,
    confidence: m.confidence,
  }));

  const result: MarketingIntelligenceResult = {
    ranking,
    investigation:
      investigation && options.includeSignals !== false
        ? {
            summary: businessInvestigationSummary(investigation),
            topSignalLines: investigation.topSignals.slice(0, 10).map((s) => s.statement),
            signals: investigation.signals,
            dimensions: investigation.dimensions,
            unavailableDimensions: investigation.unavailableDimensions,
            toolErrors: investigation.toolErrors,
          }
        : undefined,
    ml: { summary: mlSummary, degradationLines },
    explanation,
    memory: {
      episodes: (memory.episodes ?? []).length,
      longTerm: longTermMemory.length,
      degraded: Boolean(memory.degraded),
      statements,
    },
    degradations,
    generatedAt: new Date().toISOString(),
  };

  await persistIntelligenceObservability({
    tenant: options.tenant,
    requestId: options.requestId ?? `intel-${startedAt.toString(36)}`,
    durationMs: Date.now() - startedAt,
    result,
  });

  return result;
}

/** Compact prompt/UI lines for the pipeline result (no raw internals). */
export function marketingIntelligenceLines(result: MarketingIntelligenceResult, limit = 8): string[] {
  const lines: string[] = [];
  for (const rec of result.ranking.recommendations.slice(0, limit)) {
    const why = rec.why[0] ?? '';
    lines.push(`#${rec.rank} [${rec.strategyLabel}] ${rec.title} — ${why}`);
  }
  return lines;
}

// Keep the episode type exported for Phase 8 consumers without a second import path.
export type { MemoryEpisodeRecord };
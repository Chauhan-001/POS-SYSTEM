/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgent.ts — The first ChitKuber agent: a DETERMINISTIC policy
 * orchestrator over the shared tool registry (spec Step 7→8). No LLM is
 * involved in targeting decisions; an LLM can later layer copy generation
 * on top of this agent's structured output, but never its targeting math.
 *
 * Targeting-source honesty ladder (spec §19/§22 — never fabricate precision):
 *   1. CAUSAL    — getUpliftSignals, ONLY when the experiment gate passes.
 *                  Scope label: causal uplift (percentage points).
 *   2. RESPONSE  — getOfferResponsePrediction per customer feature snapshot,
 *                  ONLY when the tenant's response model is trained.
 *                  Scope label: response likelihood (non-causal).
 *   3. SEGMENTS  — getMLCustomerSegments (stored segmentation), with the
 *                  trained/untrained split kept visible.
 *   4. NONE      — honest "insufficient ML signal" with the named reasons
 *                  and next actions. Never a fabricated ranking.
 *
 * The agent NEVER calls write tools: offers are proposed as drafts, not
 * created. Segments referenced by a draft must come from the tools above —
 * membership is resolved at send time by campaignService, not snapshotted
 * here (audit finding #4 kept out of the agent path).
 */

import { executeTool } from '../tools/registry/toolExecutor';
import type { ToolContext } from '../tools/registry/toolTypes';
import { runBoundedAgentLoop, type LoopLlmFn, type LoopMemoryFn } from './loop/agentLoop';
import { marketingAgentPolicy, MARKETING_AGENT_BUDGET, type AgentPolicy } from './policies/marketingAgentPolicy';
import type { AgentRunStatus } from '../shared/agentRunContext';
import { getUpliftSignalsToolDefinition, type UpliftSignalsOutput } from '../tools/ml/getUpliftSignalsTool';
import { getMLCustomerSegmentsToolDefinition, type MLSegmentsOutput } from '../tools/ml/getMLCustomerSegmentsTool';
import {
  getMarketBasketSignalsToolDefinition,
  type MarketBasketSignalsOutput,
  type MarketBasketSignalsUnavailable,
} from '../tools/ml/getMarketBasketSignalsTool';
import { getActiveOffersToolDefinition, type ActiveOffersOutput } from '../tools/marketing/marketingTools';
import {
  getDemandForecastToolDefinition,
  type DemandForecastOutput,
  type DemandForecastUnavailable,
} from '../tools/ml/getDemandForecastTool';
import { getFestivalContextToolDefinition } from '../tools/context/contextTools';
import { getSportsContextToolDefinition, type SportsContextToolOutput } from '../tools/context/getSportsContextTool';
import { getNearbyCompetitionToolDefinition, type NearbyCompetitionToolOutput } from '../tools/context/getNearbyCompetitionTool';
import type { OfferResponsePredictionOutput } from '../tools/ml/getOfferResponsePredictionTool';
import {
  getOfferResponseBatchScoresToolDefinition,
  type OfferResponseBatchScoresOutput,
  type OfferResponseBatchScoresUnavailable,
} from '../tools/ml/getOfferResponseBatchScoresTool';

export type TargetingSource = 'CAUSAL_UPLIFT' | 'RESPONSE_MODEL' | 'ML_SEGMENTS' | 'NONE';

export interface AgentTarget {
  /** Customer or segment reference, depending on the source. */
  refId: string;
  refType: 'customer' | 'segment';
  /** Source-specific score, honestly labelled by targetingScope. */
  score: number | null;
  /** Segment name when refType === 'segment'. */
  label?: string;
  trainedCount?: number;
  untrainedCount?: number;
}

export interface AgentOfferDraft {
  offerId: string | null;
  title: string;
  /** Draft only — the agent never creates the offer itself. */
  status: 'draft';
  rationale: string;
}

export interface MarketingAgentResult {
  targetingSource: TargetingSource;
  /** Why this source (and not a higher one) was used. */
  targetingReason: string;
  targetingScope: string;
  targets: AgentTarget[];
  offerDraft: AgentOfferDraft | null;
  festivalContext: string | null;
  /**
   * Phase 3 (Cricket): one neutral evidence line for the top relevant match,
   * or null. CONTEXT ONLY — never a recommendation to create an offer; the
   * Offer Engine + owner approval remain authoritative for any action.
   */
  sportsContext: string | null;
  /** Canonical signal types of the top relevant match (INDIA_MATCH, …). */
  sportsSignals: string[];
  /**
   * Phase 2 (Competition): one neutral evidence line for the nearby
   * competitive landscape, or null. PROXIMITY CONTEXT ONLY — never a claim
   * about competitor performance and never an offer trigger.
   */
  competitionContext: string | null;
  /** Canonical competition signal types (COMPETITION_DENSITY_HIGH, …). */
  competitionSignals: string[];
  /**
   * Market-basket context: one neutral evidence line about available combo
   * signals, or null. CONTEXT ONLY — never an offer trigger; rule-fallback
   * rows are disclosed, never presented as model predictions (spec §19).
   */
  basketContext: string | null;
  /**
   * Demand-forecast context: one neutral evidence line about stored product
   * demand predictions, or null. CONTEXT ONLY — never an offer trigger.
   */
  demandContext: string | null;
  nextActions: string[];
  generatedAt: string;
  /**
   * Phase 1 — bounded LLM investigation metadata (present only when the run
   * executed with `agentic: true`). Observability/trace only: the
   * deterministic ladder above stays authoritative for targeting output.
   */
  investigation?: MarketingAgentInvestigation;
}

/** Compact trace of the Phase 1 bounded loop attached to the agent result. */
export interface MarketingAgentInvestigation {
  runId: string;
  status: AgentRunStatus;
  stepsUsed: number;
  toolCallsUsed: number;
  toolNames: string[];
  rejected: Array<{ ref: string; stage: string; reason: string }>;
  uncertainties: string[];
  llmCalls: number;
  /**
   * Phase 2 — memory context loaded at run start (observability counts only;
   * memory never changes the deterministic ladder output below).
   * absent = memory load did not complete (degraded or pre-Phase-2 run).
   */
  memory?: { episodes: number; longTerm: number; degraded: boolean };
}

const UPLIFT_SCOPE =
  'causal uplift — estimated additional response in percentage points from a statistically evaluable experiment';
const RESPONSE_SCOPE =
  'response likelihood (non-causal) — p(redeem | offer, pre-treatment features); not proof of incremental effect';
const SEGMENT_SCOPE = 'segment membership — descriptive grouping; no per-customer model score';
const NONE_SCOPE = 'no ML signal available';

/**
 * Build the human-readable festival evidence line from the festival tool's
 * output ({ available, nearest, upcoming }). Exported for the contract test —
 * it previously read a non-existent `festivals` field and NEVER produced a
 * line, silently hiding working festival evidence from the owner.
 */
export function festivalLine(festival: unknown): string | null {
  // Festival tool output shape: { available, nearest: { name, daysAway }, upcoming: [...] }.
  const f = festival as
    | {
        available?: boolean;
        nearest?: { name?: string; daysAway?: number } | null;
        upcoming?: Array<{ name?: string; daysAway?: number }>;
      }
    | null;
  if (!f?.available) return null;
  const first = f.nearest ?? f.upcoming?.[0];
  if (!first?.name) return null;
  const when = typeof first.daysAway === 'number' ? ` in ${first.daysAway} day(s)` : '';
  return `Upcoming festival context: ${first.name}${when}.`;
}

function sportsLine(sports: SportsContextToolOutput | null | undefined): string | null {
  const first = sports?.relevantMatches?.[0];
  if (!sports?.available || !first) return null;
  const when = first.localDateTime ? first.localDateTime.replace('T', ' ') : first.date;
  const live = first.timeWindow === 'currently_live' ? ', live now' : '';
  return `Cricket context: ${first.name} — ${first.competition}, starts ${when}${first.timezone ? ` (${first.timezone})` : ''}, ${first.relevance} relevance${live}.`;
}

function basketLine(
  basket: MarketBasketSignalsOutput | MarketBasketSignalsUnavailable | null | undefined,
): string | null {
  if (!basket?.available || basket.signals.length === 0) return null;
  const n = basket.signals.length;
  const version = basket.modelVersion ? ` (model version ${basket.modelVersion})` : '';
  const heuristicNote =
    basket.predictionSource === 'manager_table' && basket.recommendationMode !== 'model'
      ? ' — rule-based fallback rows, not model predictions'
      : '';
  return `Market-basket context: ${n} product-pair combo signal${n === 1 ? '' : 's'} available${version}${heuristicNote}.`;
}

function demandLine(
  demand: DemandForecastOutput | DemandForecastUnavailable | null | undefined,
): string | null {
  if (!demand?.available || !demand.predictions || demand.predictions.length === 0) return null;
  // Top expected-demand day across the stored rows (honest aggregate of what
  // was pulled — never extrapolated beyond the stored horizon).
  const top = demand.predictions.reduce((a, b) => (b.expected > a.expected ? b : a));
  const version = demand.modelVersion ? ` (model ${demand.modelVersion})` : '';
  return `Demand-forecast context: ${demand.predictions.length} stored product-day forecast${demand.predictions.length === 1 ? '' : 's'} available${version}; peak expected demand ${top.expected} unit(s) on ${top.predictionFor}.`;
}

function competitionLine(comp: NearbyCompetitionToolOutput | null | undefined): string | null {
  if (!comp?.available || !comp.summary || comp.summary.totalCompetitors === 0) return null;
  const s = comp.summary;
  const density = s.density !== 'unknown' ? `, ${s.density} density` : '';
  // Phase 3 §4: stale provider data is disclosed in the evidence line —
  // the agent never presents stale competition data as current.
  const age = comp.signals?.[0]?.freshness;
  const staleNote = age?.status === 'stale' ? ' (provider data stale)' : '';
  return `Competition context: ${s.totalCompetitors} nearby restaurants within ${Math.round((comp.searchRadiusMeters / 1000) * 10) / 10} km, nearest ~${s.nearestDistanceMeters ?? 'unknown'}m${density}${staleNote}.`;
}

function draftFromActiveOffers(active: ActiveOffersOutput | null | undefined): AgentOfferDraft | null {
  const first = active?.offers?.[0];
  if (!first) return null;
  return {
    offerId: first.id ?? null,
    title: first.title,
    status: 'draft',
    rationale: 'Reuse of an already-active offer — cheapest first action before creating anything new.',
  };
}

async function runUplift(ctx: ToolContext, minimumExperimentSize: number) {
  return executeTool(getUpliftSignalsToolDefinition, { limit: 25, minimumExperimentSize }, { tenant: ctx.tenant });
}

/** Rung 2 — batch per-customer response scores (non-causal). */
async function runResponseScores(ctx: ToolContext, limit: number) {
  return executeTool(getOfferResponseBatchScoresToolDefinition, { limit }, { tenant: ctx.tenant });
}

/**
 * Why the CAUSAL_UPLIFT rung was skipped — shared by the lower rungs so
 * every fallback reason names the rung above it (never a silent drop).
 */
function upliftFallthroughNote(
  upliftRes: { ok: boolean; data?: { available?: boolean; gateReasons?: string[] } },
): string {
  if (upliftRes.ok && upliftRes.data && !upliftRes.data.available) {
    const reasons = (upliftRes.data.gateReasons ?? []).join('; ') || 'no evaluable experiment';
    return `Uplift gate not passed: ${reasons}`;
  }
  return 'Uplift service unavailable';
}

/** Why the RESPONSE_MODEL rung was skipped — named reasons, never silent. */
function responseFallthroughNote(responseRes: {
  ok: boolean;
  data?: unknown;
}): string {
  if (!responseRes.ok) return 'offer-response tool failed';
  const d = responseRes.data as
    | { available?: boolean; detail?: string; gateReasons?: string[] }
    | null
    | undefined;
  if (!d) return 'offer-response rung returned no data';
  if (d.available === false) {
    // Named gate reasons first (most actionable), generic detail as fallback.
    return (d.gateReasons ?? []).join('; ') || d.detail || 'offer-response model unavailable';
  }
  return 'offer-response rung produced no scores';
}

async function runSegments(ctx: ToolContext) {
  return executeTool(getMLCustomerSegmentsToolDefinition, {}, { tenant: ctx.tenant });
}

async function runActiveOffers(ctx: ToolContext) {
  return executeTool(getActiveOffersToolDefinition, {}, { tenant: ctx.tenant });
}

async function runFestival(ctx: ToolContext) {
  return executeTool(getFestivalContextToolDefinition, {}, { tenant: ctx.tenant });
}

async function runSportsContext(ctx: ToolContext) {
  return executeTool(getSportsContextToolDefinition, {}, { tenant: ctx.tenant });
}

async function runCompetitionContext(ctx: ToolContext) {
  return executeTool(getNearbyCompetitionToolDefinition, {}, { tenant: ctx.tenant });
}

async function runBasketContext(ctx: ToolContext) {
  return executeTool(getMarketBasketSignalsToolDefinition, { limit: 10 }, { tenant: ctx.tenant });
}

async function runDemandContext(ctx: ToolContext) {
  return executeTool(getDemandForecastToolDefinition, { limit: 60 }, { tenant: ctx.tenant });
}

export async function runMarketingAgentDeterministic(
  ctx: ToolContext,
  options: { minimumExperimentSize?: number } = {},
): Promise<MarketingAgentResult> {
  const generatedAt = new Date().toISOString();
  const minExp = options.minimumExperimentSize ?? 100;

  // Context is fetched once and never gates targeting by itself. Cricket is
  // cheap here (cache-first service — no provider call unless the cache is
  // expired) and runs alongside festival context; neither affects targeting.
  const [festivalRes, activeRes, sportsRes, competitionRes, basketRes, demandRes] = await Promise.all([
    runFestival(ctx),
    runActiveOffers(ctx),
    runSportsContext(ctx),
    runCompetitionContext(ctx),
    runBasketContext(ctx),
    runDemandContext(ctx),
  ]);
  const festivalContext = festivalRes.ok ? festivalLine((festivalRes as { data?: unknown }).data) : null;
  const sportsOut = sportsRes.ok ? (sportsRes as { data: SportsContextToolOutput }).data : null;
  const sportsContext = sportsLine(sportsOut);
  const topMatch = sportsOut?.relevantMatches?.[0] ?? null;
  const sportsSignals = topMatch?.signals ?? [];
  const compOut = competitionRes.ok ? (competitionRes as { data: NearbyCompetitionToolOutput }).data : null;
  const competitionContext = competitionLine(compOut);
  const competitionSignals = (compOut?.signals ?? []).map((s) => s.signalType);
  const basketContext = basketLine(
    basketRes.ok ? (basketRes as { data?: MarketBasketSignalsOutput | MarketBasketSignalsUnavailable }).data : null,
  );
  const demandContext = demandLine(
    demandRes.ok ? (demandRes as { data?: DemandForecastOutput | DemandForecastUnavailable }).data : null,
  );
  // Neutral advisory only — the module never concludes an offer SHOULD exist.
  const sportsActions =
    topMatch && topMatch.relevance === 'high'
      ? ['A high-relevance cricket match is in the window — you may weigh it alongside sales/inventory evidence; it never triggers a campaign by itself.']
      : [];

  const upliftRes = await runUplift(ctx, minExp);
  if (upliftRes.ok) {
    const uplift = (upliftRes as { data: UpliftSignalsOutput | { available: false; gateReasons?: string[] } }).data;
    if (uplift.available && uplift.customers.length > 0) {
      return {
        targetingSource: 'CAUSAL_UPLIFT',
        targetingReason: `Experiment passed the evaluability gate (${uplift.totalEligible} eligible customers).`,
        targetingScope: UPLIFT_SCOPE,
        targets: uplift.customers.map((c) => ({
          refId: c.customerId,
          refType: 'customer' as const,
          score: c.upliftPercentagePoints,
        })),
        offerDraft: draftFromActiveOffers(activeRes.ok ? (activeRes as { data?: ActiveOffersOutput }).data : null),
        festivalContext,
        sportsContext,
        sportsSignals,
        competitionContext,
        competitionSignals,
        basketContext,
        demandContext,
        nextActions: [
          ...sportsActions,
          'Review the ranked customers, then create/confirm an offer in the offers workspace.',
          'Keep assignment through the experiment tracker so future uplift stays measurable.',
        ],
        generatedAt,
      };
    }
  }

  // Rung 2 — RESPONSE MODEL: batch per-customer scoring (non-causal). Only
  // when the tenant has a trained offer-response model AND candidates with
  // pre-treatment features; otherwise fall through with the named reasons.
  // Probabilities come from the service — never fabricated here.
  const responseRes = await runResponseScores(ctx, 50);
  const responseData = responseRes.ok
    ? (responseRes as { data?: OfferResponseBatchScoresOutput | OfferResponseBatchScoresUnavailable }).data
    : null;
  if (responseData?.available && responseData.scores.length > 0) {
    return {
      targetingSource: 'RESPONSE_MODEL',
      targetingReason: `${upliftFallthroughNote(upliftRes)}. Trained offer-response model used: ${responseData.scores.length} of ${responseData.customersConsidered} recent customers ranked by p(redeem | offer) — non-causal.`,
      targetingScope: RESPONSE_SCOPE,
      targets: responseData.scores.map((s) => ({
        refId: s.customerId,
        refType: 'customer' as const,
        score: s.pResponse,
      })),
      offerDraft: draftFromActiveOffers(activeRes.ok ? (activeRes as { data?: ActiveOffersOutput }).data : null),
      festivalContext,
      sportsContext,
      sportsSignals,
      competitionContext,
      competitionSignals,
      basketContext,
      demandContext,
      nextActions: [
        ...sportsActions,
        'Ranked by response likelihood — this estimates who redeems IF offered, not who buys because of the offer.',
        'Review the top customers, then confirm the offer draft in the offers workspace before any send.',
        'Keep assignment through the experiment tracker (treatment AND control) so an experiment can move targeting up to causal uplift.',
      ],
      generatedAt,
    };
  }

  const segmentsRes = await runSegments(ctx);
  if (segmentsRes.ok) {
    const segments = (segmentsRes as { data: MLSegmentsOutput | { available: false } }).data;
    if (segments.available && segments.segments.length > 0) {
      return {
        targetingSource: 'ML_SEGMENTS',
        targetingReason: `${upliftFallthroughNote(upliftRes)}. Offer-response rung unavailable: ${responseFallthroughNote(responseRes)}. Falling back to stored segmentation.`,
        targetingScope: SEGMENT_SCOPE,
        targets: segments.segments.map((s) => ({
          refId: s.segment,
          refType: 'segment' as const,
          score: null,
          label: s.segment,
          trainedCount: s.trainedCount,
          untrainedCount: s.untrainedCount,
        })),
        offerDraft: draftFromActiveOffers(activeRes.ok ? (activeRes as { data?: ActiveOffersOutput }).data : null),
        festivalContext,
        sportsContext,
        sportsSignals,
        competitionContext,
        competitionSignals,
        basketContext,
        demandContext,
        nextActions: [
          ...sportsActions,
          'Segments are descriptive — verify the top segment manually before a send.',
          'Grow the experiment ledger (assign a control group) to unlock causal targeting.',
          segments.untrainedCustomers > 0
            ? `${segments.untrainedCustomers} customers are rule-tiered only; more data will move them to trained segments.`
            : 'All customers have trained segment assignments.',
        ],
        generatedAt,
      };
    }
  }

  return {
    targetingSource: 'NONE',
    targetingReason: 'No evaluable uplift experiment, no response-model batch scoring, and no stored segments.',
    targetingScope: NONE_SCOPE,
    targets: [],
    offerDraft: null,
    festivalContext,
    sportsContext,
    sportsSignals,
    competitionContext,
    competitionSignals,
    basketContext,
    demandContext,
    nextActions: [
      ...sportsActions,
      'Accumulate experiment assignments through the offer experiment tracker (treatment AND control).',
      'Run segmentation sync so customers get stored segment predictions.',
      'Do not send targeted campaigns without a signal — use general broadcasts only.',
    ],
    generatedAt,
  };
}

/** Referenced for the Step-8 batch-scoring hook; keeps the import honest. */
export type { OfferResponsePredictionOutput };

/** Options for the public entry point (Phase 1 adds the bounded loop). */
export interface MarketingAgentOptions {
  minimumExperimentSize?: number;
  /**
   * Phase 1: run the bounded LLM investigation loop BEFORE the deterministic
   * targeting ladder. The loop only gathers evidence + observability — it
   * never changes the ladder's output, and any LLM failure degrades to the
   * exact deterministic behavior (status recorded on `investigation`).
   */
  agentic?: boolean;
  /** Test seam: inject the loop's LLM (defaults to the shared llmClient). */
  llm?: LoopLlmFn;
  /** Override the policy budgets (tests / tighter routes). */
  loopBudget?: Partial<{ maxSteps: number; maxToolCalls: number; durationMs: number; maxTokens: number; maxCostUsd: number }>;
  /** Correlation id from the HTTP request (observability). */
  requestId?: string;
  /**
   * Phase 2 test seam: memory loader used at run start (defaults to the
   * shared memoryManager — tenant-scoped, expired-excluded, never throws).
   */
  loadMemory?: LoopMemoryFn;
}

function toInvestigation(run: Awaited<ReturnType<typeof runBoundedAgentLoop>>): MarketingAgentInvestigation {
  return {
    runId: run.runId,
    status: run.status,
    stepsUsed: run.budget.stepsUsed,
    toolCallsUsed: run.budget.toolCallsUsed,
    toolNames: run.toolCalls.map((t) => t.tool),
    rejected: run.rejections.map((r) => ({ ref: r.ref, stage: r.stage, reason: r.reason })),
    uncertainties: run.uncertainties.map((u) => u.reason),
    llmCalls: run.llm.calls,
    memory: run.memory
      ? {
          episodes: run.memory.episodes.length,
          longTerm: run.memory.longTerm.length,
          degraded: run.memory.degraded ?? false,
        }
      : undefined,
  };
}

/**
 * Public entry point — Phase 1 foundation:
 *   optional bounded LLM investigation (policy + shared executor + budgets)
 *   → EXISTING deterministic targeting ladder (unchanged, authoritative).
 * Preserves the POST /recommend + POST /proposal contracts and the
 * deterministic fallback behavior for every existing caller.
 */
export async function runMarketingAgent(
  ctx: ToolContext,
  options: MarketingAgentOptions = {},
): Promise<MarketingAgentResult> {
  let investigation: MarketingAgentInvestigation | undefined;
  if (options.agentic) {
    const run = await runBoundedAgentLoop({
      policy: marketingAgentPolicy as AgentPolicy,
      objective:
        'Investigate marketing evidence for this restaurant (sales, margins, inventory, offer/campaign history, customer and ML signals) so recommendations rest on facts, not guesses.',
      tenant: ctx.tenant,
      budget: { ...MARKETING_AGENT_BUDGET, ...options.loopBudget },
      requestId: options.requestId,
      llm: options.llm,
      loadMemory: options.loadMemory,
    });
    investigation = toInvestigation(run);
  }
  const result = await runMarketingAgentDeterministic(ctx, {
    minimumExperimentSize: options.minimumExperimentSize,
  });
  return investigation ? { ...result, investigation } : result;
}

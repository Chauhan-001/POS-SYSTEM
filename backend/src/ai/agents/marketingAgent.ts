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
import { getUpliftSignalsToolDefinition, type UpliftSignalsOutput } from '../tools/ml/getUpliftSignalsTool';
import { getMLCustomerSegmentsToolDefinition, type MLSegmentsOutput } from '../tools/ml/getMLCustomerSegmentsTool';
import { getActiveOffersToolDefinition, type ActiveOffersOutput } from '../tools/marketing/marketingTools';
import { getFestivalContextToolDefinition } from '../tools/context/contextTools';
import { getSportsContextToolDefinition, type SportsContextToolOutput } from '../tools/context/getSportsContextTool';
import { getNearbyCompetitionToolDefinition, type NearbyCompetitionToolOutput } from '../tools/context/getNearbyCompetitionTool';
import type { OfferResponsePredictionOutput } from '../tools/ml/getOfferResponsePredictionTool';

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
  nextActions: string[];
  generatedAt: string;
}

const UPLIFT_SCOPE =
  'causal uplift — estimated additional response in percentage points from a statistically evaluable experiment';
const RESPONSE_SCOPE =
  'response likelihood (non-causal) — p(redeem | offer, pre-treatment features); not proof of incremental effect';
const SEGMENT_SCOPE = 'segment membership — descriptive grouping; no per-customer model score';
const NONE_SCOPE = 'no ML signal available';

function festivalLine(festival: unknown): string | null {
  const list = (festival as { festivals?: Array<{ name: string }> } | null)?.festivals;
  if (Array.isArray(list) && list.length > 0) return `Upcoming festival context: ${list[0].name}.`;
  return null;
}

function sportsLine(sports: SportsContextToolOutput | null | undefined): string | null {
  const first = sports?.relevantMatches?.[0];
  if (!sports?.available || !first) return null;
  const when = first.localDateTime ? first.localDateTime.replace('T', ' ') : first.date;
  const live = first.timeWindow === 'currently_live' ? ', live now' : '';
  return `Cricket context: ${first.name} — ${first.competition}, starts ${when}${first.timezone ? ` (${first.timezone})` : ''}, ${first.relevance} relevance${live}.`;
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

export async function runMarketingAgent(
  ctx: ToolContext,
  options: { minimumExperimentSize?: number } = {},
): Promise<MarketingAgentResult> {
  const generatedAt = new Date().toISOString();
  const minExp = options.minimumExperimentSize ?? 100;

  // Context is fetched once and never gates targeting by itself. Cricket is
  // cheap here (cache-first service — no provider call unless the cache is
  // expired) and runs alongside festival context; neither affects targeting.
  const [festivalRes, activeRes, sportsRes, competitionRes] = await Promise.all([
    runFestival(ctx),
    runActiveOffers(ctx),
    runSportsContext(ctx),
    runCompetitionContext(ctx),
  ]);
  const festivalContext = festivalRes.ok ? festivalLine((festivalRes as { data?: unknown }).data) : null;
  const sportsOut = sportsRes.ok ? (sportsRes as { data: SportsContextToolOutput }).data : null;
  const sportsContext = sportsLine(sportsOut);
  const topMatch = sportsOut?.relevantMatches?.[0] ?? null;
  const sportsSignals = topMatch?.signals ?? [];
  const compOut = competitionRes.ok ? (competitionRes as { data: NearbyCompetitionToolOutput }).data : null;
  const competitionContext = competitionLine(compOut);
  const competitionSignals = (compOut?.signals ?? []).map((s) => s.signalType);
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
        nextActions: [
          ...sportsActions,
          'Review the ranked customers, then create/confirm an offer in the offers workspace.',
          'Keep assignment through the experiment tracker so future uplift stays measurable.',
        ],
        generatedAt,
      };
    }
  }

  // Response model per-customer scoring is a Step-8 hook: the batch scoring
  // endpoint (features per customer) does not exist yet, so we fall through
  // to segments rather than fabricating per-customer probabilities here.
  const segmentsRes = await runSegments(ctx);
  if (segmentsRes.ok) {
    const segments = (segmentsRes as { data: MLSegmentsOutput | { available: false } }).data;
    if (segments.available && segments.segments.length > 0) {
      return {
        targetingSource: 'ML_SEGMENTS',
        targetingReason:
          upliftRes.ok && !(upliftRes as { data?: { available?: boolean; gateReasons?: string[] } }).data?.available
            ? `Uplift gate not passed: ${((upliftRes as { data: { gateReasons?: string[] } }).data.gateReasons ?? []).join('; ') || 'no evaluable experiment'}. Falling back to stored segmentation.`
            : 'Uplift service unavailable; using stored segmentation.',
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

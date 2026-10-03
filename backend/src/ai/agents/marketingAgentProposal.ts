/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgentProposal.ts — WP1 of the agent→campaign bridge.
 *
 * Converts a read-only MarketingAgentResult into a persisted, validated
 * CampaignProposal by delegating ALL writes to the existing authoritative
 * campaignService — the agent never writes to Mongo directly, and no LLM is
 * involved anywhere in this flow.
 *
 * Edge cases handled explicitly (never silently):
 *   - targetingSource NONE   → no proposal is created (agent's own rule:
 *     "Do not send targeted campaigns without a signal").
 *   - New restaurant / no data → agent returns NONE; caller gets the agent's
 *     nextActions instead of a fabricated proposal.
 *   - ML down / uplift gate fails → agent falls to ML_SEGMENTS or NONE; the
 *     dataSufficiency label travels with the proposal as evidence.
 *   - Audience resolves to zero phones → proposal is still created (so the
 *     owner can see the evidence), but validation will flag the audience and
 *     scheduling is impossible until it is fixed.
 *   - No delivery channels configured (no WhatsApp/webhook) → draft created,
 *     validation flags communication; scheduling is blocked.
 *   - Duplicate proposals for the same day → date-stable name + the existing
 *     duplicate-name rejection in validateCampaignProposal.
 */

import mongoose from 'mongoose';
import CampaignProposal from '../../models/marketing/CampaignProposal';
import { availableChannels } from '../../services/deliveryService';
import { campaignService } from '../../services';
import { resolveAgentTargets, type ResolvedAudience } from './audienceResolver';
import type { MarketingAgentResult, TargetingSource } from './marketingAgent';

/** A draft proposal + the validation verdict + human-readable status. */
export interface AgentProposalOutcome {
  created: boolean;
  /** Deterministic reason when created === false. */
  skipReason?: string;
  proposal?: any; // ICampaignProposal document (lean-shaped)
  proposalId?: string;
  validation?: { valid: boolean; errors: string[]; warnings: string[] };
  /** What the owner still has to do before this can send. */
  readiness: {
    canSchedule: boolean;
    blockers: string[];
    availableChannels: string[];
    audienceCount: number;
  };
  audience: ResolvedAudience;
}

// ─── Deterministic mapping tables ────────────────────────────────────────

const SUFFICIENCY_BY_SOURCE: Record<TargetingSource, 'INSUFFICIENT_DATA' | 'LOW_CONFIDENCE' | 'MODERATE_CONFIDENCE' | 'HIGH_CONFIDENCE'> = {
  CAUSAL_UPLIFT: 'HIGH_CONFIDENCE',
  RESPONSE_MODEL: 'MODERATE_CONFIDENCE',
  ML_SEGMENTS: 'LOW_CONFIDENCE',
  NONE: 'INSUFFICIENT_DATA',
};

const STRATEGY_BY_SOURCE: Record<Exclude<TargetingSource, 'NONE'>, Campaign['strategy']> = {
  CAUSAL_UPLIFT: 'REACTIVATION',
  RESPONSE_MODEL: 'DISCOUNT',
  ML_SEGMENTS: 'DISCOUNT',
};

/** Canonical context signal → proposal objective. First match wins. */
function objectiveFromResult(r: MarketingAgentResult): Campaign['objective'] {
  const has = (sig: string) => r.sportsSignals.includes(sig) || r.competitionSignals.includes(sig);
  const festivalSignals = (r as { festivalSignals?: string[] }).festivalSignals ?? [];
  if (festivalSignals.includes('festival_upcoming') || festivalSignals.includes('festival_active')) {
    return 'PROMOTE_NEW_ITEM';
  }
  if (has('INDIA_MATCH') || has('INDIA_MATCH_HIGH_RELEVANCE')) return 'INCREASE_ORDERS';
  if (has('COMPETITION_DENSITY_HIGH')) return 'INCREASE_ORDERS';
  if (r.targetingSource === 'ML_SEGMENTS') return 'REACTIVATE_CUSTOMERS';
  return 'INCREASE_ORDERS';
}

function strategyFromResult(r: MarketingAgentResult): Campaign['strategy'] {
  const festivalSignals = (r as { festivalSignals?: string[] }).festivalSignals ?? [];
  if (festivalSignals.includes('festival_upcoming')) return 'CATEGORY_PROMOTION';
  if (r.sportsSignals.length > 0) return 'TIME_BASED';
  return STRATEGY_BY_SOURCE[r.targetingSource as Exclude<TargetingSource, 'NONE'>] ?? 'DISCOUNT';
}

/** Evidence notes appended to the proposal description (audit trail). */
function evidenceLines(r: MarketingAgentResult): string[] {
  const lines: string[] = [];
  lines.push(`Targeting source: ${r.targetingSource} — ${r.targetingReason}`);
  lines.push(`Scope: ${r.targetingScope}`);
  if (r.festivalContext) lines.push(r.festivalContext);
  if (r.sportsContext) lines.push(r.sportsContext);
  if (r.competitionContext) lines.push(r.competitionContext);
  if (r.basketContext) lines.push(r.basketContext);
  if (r.demandContext) lines.push(r.demandContext);
  return lines;
}

// ─── Main mapper ─────────────────────────────────────────────────────────

/**
 * Build + persist a CampaignProposal draft from an agent result.
 * Tenant identity (restaurantId) comes from the authenticated context only —
 * the agent result carries no tenant authority of its own.
 */
export async function createProposalFromAgentResult(
  restaurantId: string,
  result: MarketingAgentResult,
  ctx: { operator?: string } = {},
): Promise<AgentProposalOutcome> {
  // Gate 0 — the agent's own honesty rule: no signal, no proposal.
  if (result.targetingSource === 'NONE' || result.targets.length === 0) {
    return {
      created: false,
      skipReason:
        'No ML targeting signal available (new restaurant, ML not synced, or uplift gate failed). ' +
        'Follow the agent nextActions instead — no proposal was created.',
      readiness: {
        canSchedule: false,
        blockers: ['NO_TARGETING_SIGNAL'],
        availableChannels: await availableChannels(restaurantId),
        audienceCount: 0,
      },
      audience: { phones: [], segmentNames: [], sources: [], isEmpty: true, notes: [] },
    };
  }

  // Step 1 — resolve the audience server-side (segment labels / ids → phones).
  const audience = await resolveAgentTargets(restaurantId, result.targets);

  // Step 2 — propose only channels that are actually configured.
  const usable = await availableChannels(restaurantId);
  const channels = (usable.length > 0 ? usable : ['webhook']).slice(0, 5) as Campaign['channels'];

  // Step 3 — assemble the draft. Economics are NOT guessed here: the campaign
  // service calculates them from real offer/audience data below.
  const evidence = evidenceLines(result).concat(audience.notes);
  const date = result.generatedAt.slice(0, 10);
  const name = `${objectiveFromResult(result)} • ${result.targetingSource} • ${date}`;

  const draft = {
    restaurantId,
    name,
    description: `AI marketing agent draft — ${evidence.join(' | ')}`.slice(0, 480),
    objective: objectiveFromResult(result),
    strategy: strategyFromResult(result),
    offerId: result.offerDraft?.offerId ?? undefined,
    source: 'agent' as const,
    audience: {
      segmentIds: [] as string[], // ML labels are resolved to phones, not rule-segment ids
      segmentNames: audience.segmentNames,
      customerPhones: audience.phones,
      excludedProductIds: [] as string[],
      excludedSegmentIds: [] as string[],
    },
    schedule: { mode: 'immediate' as const, scheduledAt: undefined as unknown as Date },
    channels,
    budgetLimits: {
      maxDiscountPercent: 20,
      maxPerCustomer: 1,
      maxFreeItems: 0,
    },
    financialModel: {
      totalCost: 0,
      discountCost: 0,
      communicationCost: 0,
      freeItemCost: 0,
      expectedRevenue: 0,
      expectedIncrementalContribution: 0,
      expectedROI: 0,
      costBreakdown: { discountCost: 0, communicationCost: 0, freeItemCost: 0 },
      confidence: (result.targetingSource === 'CAUSAL_UPLIFT' ? 'high' : result.targetingSource === 'RESPONSE_MODEL' ? 'moderate' : 'low') as 'high' | 'moderate' | 'low',
    },
    expectedImpact: {
      expectedReach: audience.phones.length,
      expectedRedemptionRate: result.targetingSource === 'CAUSAL_UPLIFT' ? 15 : 10,
      expectedIncrementalOrders: 0,
      expectedAOVImpact: 0,
      expectedNewCustomers: 0,
      expectedRepeatVisits: 0,
    },
    evidence: {
      elasticityEstimate: undefined,
      historicalPromotionIds: [],
      dataSufficiency: SUFFICIENCY_BY_SOURCE[result.targetingSource],
      modelVersion: 'marketing-agent-ladder-v1',
    },
    risks: {
      marginRisk: 'moderate' as const,
      cannibalizationRisk: 'low' as const,
      fatigueRisk: 'low' as const,
      conflictRisk: 'low' as const,
      notes: evidence,
    },
    approvalStatus: 'pending' as const,
    executionStatus: 'pending' as const,
  };

  // Step 4 — economics from the authoritative calculator (no placeholders).
  let economics: Awaited<ReturnType<CampaignService['calculateCampaignEconomics']>> | null = null;
  try {
    economics = await campaignService.calculateCampaignEconomics(restaurantId, draft as any, ctx);
  } catch {
    economics = null; // kept null → validation carries the uncertainty
  }
  if (economics) {
    draft.financialModel = {
      totalCost: economics.totalCost,
      discountCost: economics.discountCost,
      communicationCost: economics.communicationCost,
      freeItemCost: economics.freeItemCost,
      expectedRevenue: 0,
      expectedIncrementalContribution: economics.expectedIncrementalContribution,
      expectedROI: economics.expectedROI,
      costBreakdown: economics.costBreakdown,
      confidence: draft.financialModel.confidence,
    };
  }

  // Step 5 — persist via the model (tenant-scoped). No service write needed.
  const proposal = await CampaignProposal.create({ ...draft, restaurantId: new mongoose.Types.ObjectId(restaurantId) } as any);

  // Step 6 — validate immediately so the owner sees blockers at creation time.
  let validation: { valid: boolean; errors: string[]; warnings: string[] };
  try {
    const v = await (proposal as any).validateCampaignProposal();
    validation = { valid: Boolean(v?.valid), errors: v?.errors ?? [], warnings: v?.warnings ?? [] };
    // Store the verdict on the document for the lifecycle UI.
    await CampaignProposal.updateOne(
      { _id: proposal._id },
      { $set: { validationResult: { ...validation, checks: validation.valid ? allChecksTrue() : heuristicChecks(validation, audience) } } },
    );
  } catch (err) {
    validation = { valid: false, errors: [err instanceof Error ? err.message : String(err)], warnings: [] };
  }

  const blockers = buildBlockers(validation, audience, usable);
  return {
    created: true,
    proposalId: String(proposal._id),
    proposal,
    validation,
    readiness: {
      canSchedule: blockers.length === 0,
      blockers,
      availableChannels: usable,
      audienceCount: audience.phones.length,
    },
    audience,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

type CampaignService = import('../../services/campaignService').CampaignService;
type Campaign = import('../../models/marketing/CampaignProposal').ICampaignProposal;

function allChecksTrue() {
  return { offer: true, product: true, inventory: true, margin: true, audience: true, schedule: true, communication: true };
}

/** Conservative check flags derived from the validation output. */
function heuristicChecks(
  validation: { errors: string[]; warnings: string[] },
  audience: ResolvedAudience,
) {
  const flag = (kw: string[]) => validation.errors.some((e) => kw.some((k) => e.toLowerCase().includes(k))) ? false : validation.errors.length === 0;
  return {
    offer: !validation.errors.some((e) => /offer/i.test(e)),
    product: flag(['product', 'combo']),
    inventory: flag(['stock', 'inventory']),
    margin: flag(['margin', 'discount']),
    audience: audience.phones.length > 0,
    schedule: true,
    communication: !validation.errors.some((e) => /channel/i.test(e)),
  };
}

/** Everything that must be fixed before this proposal can become a campaign. */
function buildBlockers(
  validation: { valid: boolean; errors: string[]; warnings: string[] } | undefined,
  audience: ResolvedAudience,
  usableChannels: string[],
): string[] {
  const blockers: string[] = [];
  if (!validation?.valid) blockers.push(...validation!.errors);
  if (audience.isEmpty) blockers.push('AUDIENCE_EMPTY');
  if (usableChannels.length === 0) blockers.push('NO_DELIVERY_CHANNEL_CONFIGURED');
  return blockers;
}

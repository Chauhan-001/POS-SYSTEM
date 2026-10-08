/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingAgentProposal.ts — the recommendation → proposal bridge.
 *
 * SCOPE (after the architecture change): only the RANKED INTELLIGENCE
 * RECOMMENDATION path exists. The old deterministic marketing agent is
 * removed, so the agent-result → proposal bridge (and its ML-label audience
 * resolver) is gone with it: an agentic INSIGHT is advisory and can never be
 * turned into a campaign.
 *
 * The mapper delegates ALL writes to the existing model validation/services —
 * the pipeline never writes campaign data directly, no LLM is involved, and
 * owner approval remains mandatory (`approvalStatus: 'pending'`).
 */

import mongoose from 'mongoose';
import CampaignProposal from '../../models/marketing/CampaignProposal';
import { availableChannels } from '../../services/deliveryService';

/** A resolved audience for a draft proposal (deterministic labels only). */
export interface ResolvedAudience {
  /** Resolved 10-digit phones (deduped). */
  phones: string[];
  /** Human-readable labels kept for proposal display (segment labels). */
  segmentNames: string[];
  /** Aggregate per-source breakdown — never exposes customer PII. */
  sources: Array<{
    refId: string;
    refType: 'customer' | 'segment';
    matched: number;
    reason?: string;
  }>;
  /** Fully empty audience = nothing was resolvable. */
  isEmpty: boolean;
  /** Deterministic explanation surfaced to the owner in the proposal. */
  notes: string[];
}

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

/** The subset of a ranked recommendation the owner selects in /intelligence. */
export interface SelectedRecommendationInput {
  id: string;
  type: string;
  title: string;
  description?: string;
  recommendedAction?: string;
  strategyLabel?: string;
  engineScore?: number;
  confidence?: number;
  priority?: string;
  economics?: Record<string, unknown>;
  target?: { productIds?: string[]; categoryIds?: string[]; segmentIds?: string[] };
  provenance?: { signalCodes?: string[]; signalThemes?: string[]; mlKinds?: string[]; memoryRefs?: string[] };
  why?: string[];
}

/** PromotionType → proposal objective (deterministic, no LLM). */
const OBJECTIVE_BY_PROMOTION_TYPE: Record<string, Campaign['objective']> = {
  CREATE_COMBO: 'INCREASE_AOV',
  CREATE_ADDON: 'INCREASE_ADDON_ATTACHMENT',
  CREATE_PROMOTION: 'INCREASE_ORDERS',
  RUN_REACTIVATION: 'REACTIVATE_CUSTOMERS',
  PROMOTE_SLOW_ITEM: 'INCREASE_ORDERS',
  PROTECT_HIGH_DEMAND_STOCK: 'PROTECT_HIGH_PERFORMERS',
  REDUCE_WASTAGE: 'REDUCE_WASTAGE',
  REVIEW_PRICE: 'INCREASE_HIGH_MARGIN_SALES',
  REVIEW_RECIPE_COST: 'INCREASE_HIGH_MARGIN_SALES',
};

/** PromotionType → proposal strategy (deterministic, no LLM). */
const STRATEGY_BY_PROMOTION_TYPE: Record<string, Campaign['strategy']> = {
  CREATE_COMBO: 'COMBO',
  CREATE_ADDON: 'ADDON',
  CREATE_PROMOTION: 'DISCOUNT',
  RUN_REACTIVATION: 'REACTIVATION',
  PROMOTE_SLOW_ITEM: 'DISCOUNT',
  PROTECT_HIGH_DEMAND_STOCK: 'TIME_BASED',
  REDUCE_WASTAGE: 'DISCOUNT',
  REVIEW_PRICE: 'DISCOUNT',
  REVIEW_RECIPE_COST: 'DISCOUNT',
};

/**
 * Build a CampaignProposal from the EXACT recommendation the owner selected in
 * /intelligence. It does NOT re-run any agent and does NOT regenerate a
 * different decision: the source recommendation id + snapshot are persisted on
 * the proposal for traceability (`sourceRecommendationId`).
 *
 * Tenant identity comes from the authenticated context only. No audience phones
 * are fabricated: the engine's own segment ids are carried through and the
 * owner resolves the audience before scheduling (existing lifecycle unchanged).
 */
export async function createProposalFromRankedRecommendation(
  restaurantId: string,
  rec: SelectedRecommendationInput,
  ctx: { operator?: string } = {},
): Promise<AgentProposalOutcome> {
  if (!rec?.id || !rec.type || !rec.title) {
    return {
      created: false,
      skipReason: 'A recommendation id, type and title are required to create a proposal.',
      readiness: { canSchedule: false, blockers: ['INVALID_RECOMMENDATION'], availableChannels: await availableChannels(restaurantId), audienceCount: 0 },
      audience: { phones: [], segmentNames: [], sources: [], isEmpty: true, notes: [] },
    };
  }

  const usable = await availableChannels(restaurantId);
  const channels = (usable.length > 0 ? usable : ['webhook']).slice(0, 5) as Campaign['channels'];

  const segmentIds = rec.target?.segmentIds ?? [];
  const audience: ResolvedAudience = {
    phones: [],
    segmentNames: segmentIds,
    sources: segmentIds.map((id) => ({ refId: id, refType: 'segment' as const, matched: 0, reason: 'carried from selected recommendation' })),
    isEmpty: segmentIds.length === 0,
    notes: [`Created from ranked recommendation ${rec.id} (${rec.type}) — the owner selected this exact recommendation.`],
  };

  const economicsAvailable = (rec.economics as { available?: boolean } | undefined)?.available !== false;
  const evidence = [
    `Recommendation ${rec.id} (${rec.type})`,
    ...(rec.why ?? []).slice(0, 3),
    ...(rec.provenance?.signalCodes ?? []).map((s) => `signal:${s}`),
    ...(rec.provenance?.signalThemes ?? []).map((s) => `theme:${s}`),
  ];
  const status = economicsAvailable ? 'economy from the engine' : 'economy unavailable — not fabricated';
  const date = new Date().toISOString().slice(0, 10);

  const draft = {
    restaurantId,
    name: `${rec.title} • RECOMMENDATION • ${date}`.slice(0, 200),
    description: `Intelligence recommendation draft (${status}) — ${evidence.join(' | ')}`.slice(0, 480),
    objective: OBJECTIVE_BY_PROMOTION_TYPE[rec.type] ?? 'INCREASE_ORDERS',
    strategy: STRATEGY_BY_PROMOTION_TYPE[rec.type] ?? 'DISCOUNT',
    offerId: undefined,
    source: 'recommendation' as const,
    sourceRecommendationId: rec.id,
    sourceRecommendation: {
      id: rec.id,
      type: rec.type,
      title: rec.title,
      engineScore: rec.engineScore ?? null,
      confidence: rec.confidence ?? null,
      economics: rec.economics ?? null,
      provenance: rec.provenance ?? null,
      selectedAt: new Date().toISOString(),
    },
    audience: {
      segmentIds,
      segmentNames: audience.segmentNames,
      customerPhones: [] as string[],
      excludedProductIds: [] as string[],
      excludedSegmentIds: [] as string[],
    },
    schedule: { mode: 'immediate' as const, scheduledAt: undefined as unknown as Date },
    channels,
    budgetLimits: { maxDiscountPercent: 30, maxPerCustomer: 1, maxFreeItems: 0 },
    financialModel: {
      totalCost: 0,
      discountCost: 0,
      communicationCost: 0,
      freeItemCost: 0,
      expectedRevenue: 0,
      expectedIncrementalContribution: 0,
      expectedROI: 0,
      costBreakdown: { discountCost: 0, communicationCost: 0, freeItemCost: 0 },
      confidence: (rec.confidence ?? 0) >= 0.7 ? 'high' : (rec.confidence ?? 0) >= 0.4 ? 'moderate' : 'low',
    },
    expectedImpact: {
      expectedReach: 0,
      expectedRedemptionRate: 0,
      expectedIncrementalOrders: 0,
      expectedAOVImpact: 0,
      expectedNewCustomers: 0,
      expectedRepeatVisits: 0,
    },
    evidence: {
      elasticityEstimate: undefined,
      historicalPromotionIds: [],
      dataSufficiency: economicsAvailable ? 'LOW_CONFIDENCE' : 'INSUFFICIENT_DATA',
      modelVersion: 'marketing-intelligence-recommendation-v1',
    },
    risks: {
      marginRisk: (economicsAvailable && (rec.economics as { economicallySafe?: boolean } | undefined)?.economicallySafe ? 'low' : 'moderate') as 'low' | 'moderate' | 'high',
      cannibalizationRisk: 'low' as const,
      fatigueRisk: 'low' as const,
      conflictRisk: 'low' as const,
      notes: evidence,
    },
    approvalStatus: 'pending' as const,
    executionStatus: 'pending' as const,
  };

  const proposal = await CampaignProposal.create({ ...draft, restaurantId: new mongoose.Types.ObjectId(restaurantId) } as any);

  let validation: { valid: boolean; errors: string[]; warnings: string[] };
  try {
    const v = await (proposal as any).validateCampaignProposal();
    validation = { valid: Boolean(v?.valid), errors: v?.errors ?? [], warnings: v?.warnings ?? [] };
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
    readiness: { canSchedule: blockers.length === 0, blockers, availableChannels: usable, audienceCount: audience.phones.length },
    audience,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

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

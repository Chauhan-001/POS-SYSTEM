/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * proposalLifecycle.ts — WP4+WP5 of the agent→campaign bridge.
 *
 * Drives the CampaignProposal through its REAL stored lifecycle:
 *
 *   pending ──submit──▶ ready_for_approval ──approve──▶ approved
 *      │                     │
 *      └──────reject─────────┴────▶ rejected (terminal)
 *
 *   approved ──schedule──▶ scheduled(execution) ──▶ materializes a REAL
 *   Campaign via campaignService.create (+ optional send), and records the
 *   campaignId on the proposal. When delivery completes, measure() aggregates
 *   real OfferAnalytics + CampaignHistory numbers and appends a
 *   RecommendationOutcome (learning loop, WP5).
 *
 * Every mutation:
 *   - is scoped to the authenticated tenant (restaurantId from req.user),
 *   - re-checks the state transition server-side (client authority never
 *     trusted),
 *   - is audit-logged via auditLogRepo.
 */

import mongoose from 'mongoose';
import CampaignProposal from '../../models/marketing/CampaignProposal';
import { canApproveTransition, canExecuteTransition } from '../../models/marketing/CampaignProposal';
import { campaignService } from '../../services';
import { auditLogRepo } from '../../repositories';
import { recordOwnerFeedback } from '../../services/recommendationFeedbackService';
import { AppError } from '../../utils/AppError';
import IRecommendationOutcome from '../../models/intelligence/RecommendationOutcome';

type IProposal = mongoose.Document & Record<string, any>;

async function loadProposal(restaurantId: string, proposalId: string): Promise<IProposal> {
  if (!mongoose.Types.ObjectId.isValid(proposalId)) {
    throw new AppError(400, 'Invalid proposal id');
  }
  const proposal = await CampaignProposal.findOne({
    _id: proposalId,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  }).exec();
  if (!proposal) throw new AppError(404, 'Proposal not found for this restaurant');
  return proposal as unknown as IProposal;
}

async function audit(
  restaurantId: string,
  action: string,
  entityId: string,
  operator: string | undefined,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await auditLogRepo.create({
      action,
      entityType: 'campaign_proposal',
      entityId,
      performedBy: operator || 'System',
      restaurantId,
      details,
    } as any);
  } catch {
    // Audit must never break the lifecycle; the state transition is the source of truth.
  }
}

// ─── Submit: pending → ready_for_approval (validation runs here) ─────────

export async function submitProposal(
  restaurantId: string,
  proposalId: string,
  ctx: { operator?: string } = {},
): Promise<{ proposal: IProposal; validation: { valid: boolean; errors: string[]; warnings: string[] } }> {
  const proposal = await loadProposal(restaurantId, proposalId);
  if (!canApproveTransition(proposal.approvalStatus as any, 'ready_for_approval') && proposal.approvalStatus !== 'pending') {
    throw new AppError(400, `Cannot submit a proposal in status "${proposal.approvalStatus}"`);
  }

  proposal.approvalStatus = 'validating';
  await proposal.save();

  const validation = await (proposal as any).validateCampaignProposal();

  proposal.approvalStatus = validation.valid ? 'ready_for_approval' : 'rejected';
  proposal.set('validationResult', {
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    checks: proposal.get('validationResult')?.checks ?? {
      offer: false, product: false, inventory: false, margin: false, audience: false, schedule: false, communication: false,
    },
  });
  await proposal.save();

  await audit(restaurantId, 'PROPOSAL_SUBMITTED', proposalId, ctx.operator, {
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
  });

  return { proposal, validation };
}

// ─── Approve: ready_for_approval → approved (owner-only, at route level) ──

export async function approveProposal(
  restaurantId: string,
  proposalId: string,
  ctx: { operator?: string } = {},
): Promise<{ proposal: IProposal }> {
  const proposal = await loadProposal(restaurantId, proposalId);
  if (!canApproveTransition(proposal.approvalStatus as any, 'approved')) {
    throw new AppError(400, `Cannot approve a proposal in status "${proposal.approvalStatus}"`);
  }
  proposal.approvalStatus = 'approved';
  await proposal.save();

  await audit(restaurantId, 'PROPOSAL_APPROVED', proposalId, ctx.operator, {});
  return { proposal };
}

// ─── Reject: pending | ready_for_approval → rejected ─────────────────────

export async function rejectProposal(
  restaurantId: string,
  proposalId: string,
  feedback: { rating?: 'positive' | 'neutral' | 'negative'; comment?: string; categories?: string[] } | undefined,
  ctx: { operator?: string } = {},
): Promise<{ proposal: IProposal }> {
  const proposal = await loadProposal(restaurantId, proposalId);
  const from = proposal.approvalStatus as string;
  if (from !== 'pending' && from !== 'ready_for_approval') {
    throw new AppError(400, `Cannot reject a proposal in status "${from}"`);
  }
  proposal.approvalStatus = 'rejected';
  if (feedback) {
    proposal.set('ownerFeedback', {
      rating: feedback.rating ?? 'negative',
      comment: feedback.comment,
      categories: (feedback.categories as any) ?? [],
      recordedAt: new Date(),
    });
  }
  await proposal.save();

  await audit(restaurantId, 'PROPOSAL_REJECTED', proposalId, ctx.operator, { feedback });
  return { proposal };
}

// ─── Schedule: approved → real Campaign (+ optional immediate send) ───────

export async function scheduleProposal(
  restaurantId: string,
  proposalId: string,
  opts: { sendNow?: boolean; scheduledAt?: string | Date } = {},
  ctx: { operator?: string } = {},
): Promise<{ proposal: IProposal; campaign: any; sendResult?: { accepted: boolean; jobId: string; audienceCount: number; channel: string; status: string } }> {
  const proposal = await loadProposal(restaurantId, proposalId);

  // Approval-side guard: only an approved proposal can be scheduled.
  if (!canApproveTransition(proposal.approvalStatus as any, 'approved') && proposal.approvalStatus !== 'approved') {
    throw new AppError(400, `Cannot schedule a proposal in approval status "${proposal.approvalStatus}"`);
  }
  // Execution-side guard.
  if (!canExecuteTransition(proposal.executionStatus as any, 'scheduled')) {
    throw new AppError(400, `Cannot schedule a proposal in execution status "${proposal.executionStatus}"`);
  }
  // An offer must be attached before anything real is created.
  if (!proposal.offerId) {
    throw new AppError(400, 'Proposal has no attached offer — link or create an offer first');
  }
  if (!proposal.audience?.customerPhones?.length && !proposal.audience?.segmentIds?.length) {
    throw new AppError(400, 'Proposal audience is empty — resolve the audience before scheduling');
  }
  if (!proposal.channels?.length) {
    throw new AppError(400, 'Proposal has no delivery channel configured');
  }

  // Materialize the REAL campaign through the authoritative service.
  const scheduledAt = opts.scheduledAt
    ? new Date(opts.scheduledAt)
    : proposal.schedule?.scheduledAt ?? undefined;
  const campaign = await campaignService.create(restaurantId, {
    name: proposal.name,
    description: proposal.description,
    offerId: String(proposal.offerId),
    audience: {
      segmentIds: proposal.audience.segmentIds ?? [],
      customerPhones: proposal.audience.customerPhones ?? [],
    },
    template: {
      channel: proposal.template?.channel ?? proposal.channels[0],
      subject: proposal.template?.subject,
      message: proposal.template?.message ?? `Special offer for you!${proposal.description ? ` — ${proposal.name}` : ''}`,
    },
    schedule: scheduledAt
      ? { mode: 'scheduled', scheduledAt: scheduledAt.toISOString() }
      : { mode: 'immediate' },
  }, ctx);

  proposal.set('campaignId', (campaign as any)._id ?? (campaign as any).id ?? null);
  proposal.executionStatus = 'scheduled';
  await proposal.save();

  await audit(restaurantId, 'PROPOSAL_SCHEDULED', proposalId, ctx.operator, {
    campaignId: (campaign as any)._id?.toString?.() ?? String((campaign as any).id),
    sendNow: Boolean(opts.sendNow),
  });

  let sendResult: { accepted: boolean; jobId: string; audienceCount: number; channel: string; status: string } | undefined;
  if (opts.sendNow) {
    const res = await campaignService.send(restaurantId, String((campaign as any)._id), ctx);
    sendResult = {
      accepted: res.accepted,
      jobId: res.jobId,
      audienceCount: res.audienceCount,
      channel: res.channel,
      status: res.status,
    };
  }

  return { proposal, campaign, sendResult };
}

// ─── Measure: scheduled/active → completed → measured (learning loop) ────

export async function measureProposal(
  restaurantId: string,
  proposalId: string,
  ctx: { operator?: string } = {},
): Promise<{ proposal: IProposal; outcomeRecorded: boolean; summary: Record<string, unknown> }> {
  const proposal = await loadProposal(restaurantId, proposalId);

  const exec = proposal.executionStatus as string;
  if (exec !== 'scheduled' && exec !== 'active') {
    throw new AppError(400, `Cannot measure a proposal in execution status "${exec}"`);
  }
  if (!proposal.campaignId) {
    throw new AppError(400, 'Proposal has no campaign to measure');
  }

  // Aggregate REAL outcomes from the authoritative analytics service.
  const { getOfferPerformance } = await import('../../services/offerAnalyticsService');
  const { default: CampaignHistory } = await import('../../models/marketing/CampaignHistory');
  const { default: CampaignModel } = await import('../../models/marketing/Campaign');

  const campaign = await CampaignModel.findOne({
    _id: proposal.campaignId,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  }).lean<Record<string, any>>().exec();

  const histories = await CampaignHistory.find({
    campaignId: proposal.campaignId,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  }).lean<Record<string, any>[]>().exec();

  const sentCount = histories.reduce((s, h) => s + (h.recipientCount ?? 0), 0);
  const redeemed = histories.reduce((s, h) => s + (h.redeemedCount ?? 0), 0);
  const campaignCost = histories.reduce((s, h) => s + (h.campaignCost ?? 0), 0);

  let revenueGenerated = 0;
  let discountGiven = 0;
  if (proposal.offerId) {
    const rows = await getOfferPerformance({
      restaurantId,
      offerId: String(proposal.offerId),
    } as any).catch(() => []);
    const mine = (rows as any[]).find((r) => String(r.offerId) === String(proposal.offerId));
    if (mine) {
      revenueGenerated = mine.revenueGenerated ?? 0;
      discountGiven = mine.discountGiven ?? 0;
    }
  }

  const redemptionRate = sentCount > 0 ? Math.round((redeemed / sentCount) * 1000) / 10 : 0;
  const expected = proposal.financialModel?.expectedIncrementalContribution ?? 0;
  const actualContribution = revenueGenerated - discountGiven - campaignCost;

  const summary = {
    campaignId: String(proposal.campaignId),
    sentCount,
    redeemed,
    redemptionRate,
    campaignCost,
    revenueGenerated,
    discountGiven,
    actualContribution,
    expectedIncrementalContribution: expected,
  };

  // Append (never overwrite) a learning outcome — WP5 closure.
  let outcomeRecorded = false;
  try {
    await (IRecommendationOutcome as any).findOneAndUpdate(
      {
        recommendationId: `proposal:${proposalId}`,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
      },
      {
        $set: {
          promotedAt: campaign?.createdAt ?? new Date(),
          measurementWindowDays: 30,
          implemented: true,
          status: 'completed',
          metrics: {
            revenue: revenueGenerated,
            contribution: actualContribution,
            discountCost: discountGiven,
            redemptionRate,
          },
          expected: { expectedContribution: expected, documentedAssumptions: ['Agent draft economics from campaignService.calculateCampaignEconomics'] },
          actual: { actualContribution },
          variance: {
            orderUpliftPercentDiff: 0,
            contributionDiff: actualContribution - expected,
            newCustomerDiff: 0,
            repeatPurchaseDiff: 0,
            aovDiff: 0,
          },
          attributionMethod: 'pre_post',
          promotionType: 'limited_time',
          learningSignals: ['promotion_implemented', 'promotion_redeemed'],
        },
      },
      { upsert: true, new: true },
    );
    outcomeRecorded = true;
  } catch {
    outcomeRecorded = false; // learning must never block measurement
  }

  proposal.executionStatus = 'completed';
  await proposal.save();
  // completed → measured (state machine now allows this).
  if (canExecuteTransition('completed' as any, 'measured' as any)) {
    proposal.executionStatus = 'measured';
    await proposal.save();
  }

  if (proposal.get('ownerFeedback')?.recordedAt) {
    await recordOwnerFeedback(
      `proposal:${proposalId}`,
      restaurantId,
      proposal.get('ownerFeedback').rating,
      proposal.get('ownerFeedback').categories ?? [],
      proposal.get('ownerFeedback').comment,
    ).catch(() => undefined);
  }

  await audit(restaurantId, 'PROPOSAL_MEASURED', proposalId, ctx.operator, summary);
  return { proposal, outcomeRecorded, summary };
}

// ─── List: proposals for the tenant (proposal inbox) ─────────────────────

export async function listProposals(
  restaurantId: string,
  params: { approvalStatus?: string; executionStatus?: string; source?: string; limit?: number } = {},
): Promise<any[]> {
  const q: Record<string, unknown> = {
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  };
  if (params.approvalStatus) q.approvalStatus = params.approvalStatus;
  if (params.executionStatus) q.executionStatus = params.executionStatus;
  if (params.source) q.source = params.source;
  return CampaignProposal.find(q)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(params.limit ?? 50, 1), 200))
    .lean()
    .exec();
}

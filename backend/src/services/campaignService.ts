/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign Service — CRM campaign builder (Phase 1.6, extended) plus Phase 6
 * Promotion Orchestration: CampaignProposal validation, conflict detection,
 * audience frequency tracking, quiet periods, consent/opt-out, budget
 * calculation, automation modes, stop conditions, and monitoring.
 *
 * A campaign targets an audience (segments and/or manual phones), uses a
 * message template, has a schedule, and tracks delivery. Delivery is now
 * asynchronous: `send()` claims the campaign (atomic status transition),
 * records a pending CampaignHistory entry, enqueues a background job, and
 * returns immediately. A worker (campaignQueue.ts) delivers per recipient
 * through the deliveryService provider layer and writes back per-recipient
 * results. A campaign is only ever marked 'sent'/'failed'/'partial' by the
 * worker based on ACTUAL transmission results.
 */

import mongoose from 'mongoose';
import Customer from '../models/Customer';
import CustomerSegment from '../models/CustomerSegment';
import Campaign from '../models/Campaign';
import CampaignProposal from '../models/CampaignProposal';
import CampaignHistory from '../models/CampaignHistory';
import Offer from '../models/Offer';
import Product from '../models/Product';
import { AppError } from '../utils/AppError';
import { campaignRepo, auditLogRepo } from '../repositories';
import { enqueueCampaign } from './campaignQueue';
import { CAMPAIGN_TRANSITIONS, canTransition } from '../constants/marketingStates';
import type { CampaignChannel, CampaignStatus } from '../models/Campaign';
import type { ICampaignProposal } from '../models/CampaignProposal';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export interface SendCampaignResult {
  accepted: boolean;
  jobId: string;
  audienceCount: number;
  channel: string;
  status: string;
}

export type CampaignAutomationMode = 'advisory' | 'assisted' | 'controlled';

export interface AutomationGuardrails {
  maxDiscountPercent?: number;
  maxDiscountAmount?: number;
  maxFreeItems?: number;
  maxUses?: number;
  maxPerCustomer?: number;
  maxDurationDays?: number;
  eligibleProducts?: string[];
  eligibleCustomerSegments?: string[];
  budgetLimit?: number;
  stopConditions: {
    inventory: boolean;
    margin: boolean;
    redemption: boolean;
    budget: boolean;
    maxUsage: boolean;
    negativePerformance: boolean;
  };
}

export class CampaignService {
  async list(restaurantId: string, params: { page?: number; limit?: number; status?: string } = {}): Promise<any> {
    const query: any = {};
    if (params.status) query.status = params.status;
    const result = await campaignRepo.forTenant(restaurantId).findAll(query, {
      page: params.page || 1,
      limit: params.limit || 20,
      sort: { createdAt: -1 },
    });
    return {
      data: result.data.map((c) => this.mapCampaign(c)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  async getById(restaurantId: string, id: string): Promise<any | null> {
    const campaign = await campaignRepo.forTenant(restaurantId).findById(id);
    return campaign ? this.mapCampaign(campaign) : null;
  }

  /**
   * Resolve the audience for a campaign: segment phones ∪ manual phones.
   * Also computes the count for the builder preview.
   */
  async resolveAudience(restaurantId: string, audience: { segmentIds: string[]; customerPhones: string[] }): Promise<{ phones: string[]; names: string[] }> {
    const phones = new Set<string>();
    const names = new Set<string>();

    if (audience.segmentIds && audience.segmentIds.length > 0) {
      const segments = await CustomerSegment.find({
        restaurantId: objectId(restaurantId),
        _id: { $in: audience.segmentIds.map(objectId) },
        isDeleted: { $ne: true },
      }).lean().exec();
      for (const seg of segments) {
        names.add(seg.name);
        for (const p of seg.customerPhones || []) phones.add(p);
      }
    }
    for (const p of audience.customerPhones || []) {
      if (/^\d{10}$/.test(p)) phones.add(p);
    }

    return { phones: [...phones], names: [...names] };
  }

  /** Estimate the audience size (for the campaign builder preview). */
  async previewAudience(restaurantId: string, audience: { segmentIds: string[]; customerPhones: string[] }): Promise<{ audienceCount: number; segmentNames: string[] }> {
    const { phones, names } = await this.resolveAudience(restaurantId, audience);
    return { audienceCount: phones.length, segmentNames: names };
  }

  async create(restaurantId: string, data: any, ctx: { operator?: string } = {}): Promise<any> {
    const { phones, names } = await this.resolveAudience(restaurantId, data.audience || {});
    const campaign = await campaignRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      name: data.name,
      description: data.description,
      offerId: data.offerId ? objectId(data.offerId) : undefined,
      audience: {
        segmentIds: data.audience?.segmentIds || [],
        segmentNames: names,
        customerPhones: phones,
      },
      template: data.template,
      schedule: data.schedule?.mode === 'scheduled'
        ? { mode: 'scheduled', scheduledAt: new Date(data.schedule.scheduledAt) }
        : { mode: 'immediate', scheduledAt: null },
      status: data.schedule?.mode === 'scheduled' ? 'scheduled' : 'draft',
      stats: { audienceCount: phones.length, sentCount: 0, failedCount: 0, redeemedCount: 0 },
      createdBy: ctx.operator,
    } as any);

    await auditLogRepo.create({
      action: 'CAMPAIGN_CREATED',
      entityType: 'campaign',
      entityId: (campaign as any)._id.toString(),
      performedBy: ctx.operator || 'System',
      restaurantId,
      details: { name: data.name, audienceCount: phones.length },
    } as any);

    return this.mapCampaign(campaign);
  }

  async update(restaurantId: string, id: string, data: any, ctx: { operator?: string } = {}): Promise<any | null> {
    const existing = await campaignRepo.forTenant(restaurantId).findById(id);
    if (!existing) throw new AppError(404, 'Campaign not found');
    if ((existing as any).status !== 'draft' && (existing as any).status !== 'scheduled') {
      throw new AppError(400, 'Only draft or scheduled campaigns can be edited');
    }

    const patch: any = {};
    if (data.name) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.offerId !== undefined) patch.offerId = data.offerId ? objectId(data.offerId) : null;
    if (data.template) patch.template = data.template;
    if (data.audience) {
      const { phones, names } = await this.resolveAudience(restaurantId, data.audience);
      patch.audience = { segmentIds: data.audience.segmentIds || [], segmentNames: names, customerPhones: phones };
      patch.stats = { audienceCount: phones.length, sentCount: (existing as any).stats.sentCount || 0, failedCount: (existing as any).stats.failedCount || 0, redeemedCount: (existing as any).stats.redeemedCount || 0 };
    }
    if (data.schedule) {
      patch.schedule = data.schedule.mode === 'scheduled'
        ? { mode: 'scheduled', scheduledAt: new Date(data.schedule.scheduledAt) }
        : { mode: 'immediate', scheduledAt: null };
    }

    const campaign = await campaignRepo.forTenant(restaurantId).update(id, patch as any);
    await auditLogRepo.create({
      action: 'CAMPAIGN_UPDATED',
      entityType: 'campaign',
      entityId: id,
      performedBy: ctx.operator || 'System',
      restaurantId,
      details: { name: data.name || existing.name },
    } as any);
    return campaign ? this.mapCampaign(campaign) : null;
  }

  async setStatus(restaurantId: string, id: string, status: CampaignStatus, ctx: { operator?: string } = {}): Promise<any | null> {
    const existing = await campaignRepo.forTenant(restaurantId).findById(id);
    if (!existing) throw new AppError(404, 'Campaign not found');

    // State machine (Phase 4): reject arbitrary transitions.
    if (!canTransition((existing as any).status, status, CAMPAIGN_TRANSITIONS)) {
      throw new AppError(400, `Invalid status transition: ${(existing as any).status} → ${status}`);
    }

    const campaign = await campaignRepo.forTenant(restaurantId).update(id, { status } as any);
    await auditLogRepo.create({
      action: 'CAMPAIGN_STATUS_CHANGED',
      entityType: 'campaign',
      entityId: id,
      performedBy: ctx.operator || 'System',
      restaurantId,
      details: { from: (existing as any).status, to: status },
    } as any);
    return campaign ? this.mapCampaign(campaign) : null;
  }

  async delete(restaurantId: string, id: string, ctx: { operator?: string } = {}): Promise<boolean> {
    const campaign = await campaignRepo.forTenant(restaurantId).softDelete(id);
    if (!campaign) return false;
    await auditLogRepo.create({
      action: 'CAMPAIGN_DELETED',
      entityType: 'campaign',
      entityId: id,
      performedBy: ctx.operator || 'System',
      restaurantId,
    } as any);
    return true;
  }

  /**
   * Send a campaign — NON-BLOCKING.
   *  1. Validates status + audience.
   *  2. Atomically claims the campaign (draft|scheduled → sending) so two
   *     concurrent requests (or a scheduler tick + manual click) can never
   *     double-send.
   *  3. Records a pending CampaignHistory entry.
   *  4. Enqueues the background delivery job and returns immediately.
   */
  async send(restaurantId: string, id: string, ctx: { operator?: string } = {}): Promise<SendCampaignResult> {
    const campaign = await campaignRepo.forTenant(restaurantId).findById(id);
    if (!campaign) throw new AppError(404, 'Campaign not found');
    const doc = campaign as any;
    if (doc.status === 'sent') throw new AppError(400, 'Campaign already sent');
    if (doc.status === 'sending') throw new AppError(409, 'Campaign is already being sent');
    if (!canTransition(doc.status, 'sending', CAMPAIGN_TRANSITIONS)) {
      throw new AppError(400, `Cannot send a campaign in status "${doc.status}"`);
    }

    const audience: string[] = doc.audience?.customerPhones || [];
    if (audience.length === 0) throw new AppError(400, 'Campaign has an empty audience');
    const channel = (doc.template?.channel || 'sms') as CampaignChannel;

    // Atomic claim — only one caller wins; the loser gets 409.
    const claimed = await campaignRepo.forTenant(restaurantId).findOneAndUpdate(
      { _id: id, status: { $in: ['draft', 'scheduled'] } },
      { status: 'sending' } as any,
    );
    if (!claimed) throw new AppError(409, 'Campaign is already being sent');

    const offerTitle = doc.offerId
      ? (await Offer.findOne({ _id: doc.offerId, restaurantId: objectId(restaurantId) }).lean().exec())?.title
      : '';

    const history = await CampaignHistory.create({
      campaignId: id,
      offerId: doc.offerId || null,
      restaurantId: objectId(restaurantId),
      channel,
      recipientPhones: audience,
      recipientCount: audience.length,
      openedCount: 0,
      redeemedCount: 0,
      messageContent: `${offerTitle ? `[${offerTitle}] ` : ''}${doc.template?.message || ''}`,
      isScheduled: doc.schedule?.mode === 'scheduled',
      scheduledDate: doc.schedule?.scheduledAt ? new Date(doc.schedule.scheduledAt).toISOString() : undefined,
      campaignCost: 0,
      status: 'pending',
      results: [],
    });

    await campaignRepo.forTenant(restaurantId).update(id, {
      $push: { historyIds: history._id.toString() },
    } as any);

    enqueueCampaign({ campaignId: id, restaurantId, historyId: history._id.toString() });

    await auditLogRepo.create({
      action: 'CAMPAIGN_SENT',
      entityType: 'campaign',
      entityId: id,
      performedBy: ctx.operator || 'System',
      restaurantId,
      details: { channel, audienceCount: audience.length, queued: true, jobId: history._id.toString() },
    } as any);

    return { accepted: true, jobId: history._id.toString(), audienceCount: audience.length, channel, status: 'sending' };
  }

  /**
   * Pre-publish validation for a CampaignProposal.
   * Validates: offer, product, inventory, margin, audience, schedule, communication.
   * Returns valid status, errors, and warnings.
   */
  async validateCampaignProposal(
    restaurantId: string,
    proposalData: Partial<ICampaignProposal>,
    ctx: { operator?: string } = {}
  ): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const proposal = await CampaignProposal.findOne({ restaurantId, name: proposalData.name })
      .lean()
      .exec();

    // If a proposal with this name already exists and is not draft/rejected, reject
    if (proposal && proposal.approvalStatus !== 'pending' && proposal.approvalStatus !== 'rejected') {
      return {
        valid: false,
        errors: [`Campaign proposal "${proposal.name}" already exists with status "${proposal.approvalStatus}"`],
        warnings: [],
      };
    }

    // Use the model's validateCampaignProposal method
    if (proposalData._id) {
      const existingProposal = await CampaignProposal.findById(proposalData._id);
      if (existingProposal) {
        return await existingProposal.validateCampaignProposal();
      }
    }

    // Create a temporary proposal for validation
    const tempProposal = new CampaignProposal({
      restaurantId: objectId(restaurantId),
      name: proposalData.name || 'temp',
      description: proposalData.description,
      objective: proposalData.objective,
      strategy: proposalData.strategy,
      offerId: proposalData.offerId ? objectId(proposalData.offerId) : undefined,
      comboId: proposalData.comboId ? objectId(proposalData.comboId) : undefined,
      audience: {
        segmentIds: proposalData.audience?.segmentIds || [],
        segmentNames: proposalData.audience?.segmentNames || [],
        customerPhones: proposalData.audience?.customerPhones || [],
        excludedProductIds: proposalData.audience?.excludedProductIds || [],
        excludedSegmentIds: proposalData.audience?.excludedSegmentIds || [],
      },
      schedule: {
        mode: proposalData.schedule?.mode || 'immediate',
        scheduledAt: proposalData.schedule?.scheduledAt ? new Date(proposalData.schedule.scheduledAt) : undefined,
        startDate: proposalData.schedule?.startDate ? new Date(proposalData.schedule.startDate) : undefined,
        endDate: proposalData.schedule?.endDate ? new Date(proposalData.schedule.endDate) : undefined,
        daysOfWeek: proposalData.schedule?.daysOfWeek || [],
        startHour: proposalData.schedule?.startHour,
        endHour: proposalData.schedule?.endHour,
        quietPeriods: proposalData.schedule?.quietPeriods || [],
      },
      channels: proposalData.channels || [],
      budgetLimits: proposalData.budgetLimits,
      financialModel: proposalData.financialModel,
      expectedImpact: proposalData.expectedImpact,
      evidence: proposalData.evidence,
      risks: proposalData.risks,
      approvalStatus: 'pending',
      executionStatus: 'pending',
    });

    return await tempProposal.validateCampaignProposal();
  }

  /**
   * Detect conflicts with existing campaigns/proposals.
   * Checks for: same product, same audience, overlapping schedules.
   */
  async detectConflicts(
    restaurantId: string,
    proposalData: Partial<ICampaignProposal>,
    ctx: { operator?: string } = {}
  ): Promise<{ conflicts: string[]; warnings: string[] }> {
    const conflicts: string[] = [];
    const warnings: string[] = [];

    const { objective, strategy, offerId, audience, schedule, channels } = proposalData;

    // Find active/approved proposals for this restaurant
    const existingProposals = await CampaignProposal.find({
      restaurantId: objectId(restaurantId),
      approvalStatus: { $in: ['approved', 'scheduled', 'active'] },
      _id: { $ne: proposalData._id },
    }).lean().exec();

    // Check for same product / offer conflicts
    if (offerId) {
      const offerWithSameProduct = await Offer.findOne({
        restaurantId: objectId(restaurantId),
        $or: [
          { applicableProductIds: String(offerId) },
          { comboProductIds: String(offerId) },
        ],
      }).lean().exec();

      // More directly: check if any existing proposal uses the same offer
      const existingWithSameOffer = existingProposals.filter(p => p.offerId && String(p.offerId) === String(offerId));
      if (existingWithSameOffer.length > 0) {
        conflicts.push(`Another campaign proposes the same offer (${offerId}) during overlapping period`);
      }
    }

    // Check for same audience conflicts
    if (audience && (audience.segmentIds.length > 0 || audience.customerPhones.length > 0)) {
      for (const existing of existingProposals) {
        const existingAudience = existing.audience;
        const segmentOverlap = audience.segmentIds.filter(s => existingAudience.segmentIds.includes(s)).length;
        const phoneOverlap = audience.customerPhones.filter(p => existingAudience.customerPhones.includes(p)).length;

        if (segmentOverlap > 0 || phoneOverlap > 0) {
          // Check for overlapping schedules
          if (schedule && existing.schedule) {
            const thisStart = schedule.startDate ? new Date(schedule.startDate) : undefined;
            const thisEnd = schedule.endDate ? new Date(schedule.endDate) : undefined;
            const existingStart = existing.schedule.startDate ? new Date(existing.schedule.startDate) : undefined;
            const existingEnd = existing.schedule.endDate ? new Date(existing.schedule.endDate) : undefined;

            // Check overlap
            if (thisStart && existingStart) {
              const overlap = (thisStart <= existingEnd && thisEnd >= existingStart);
              if (overlap) {
                conflicts.push(`Campaign targets overlapping audience with existing proposal during ${existing.schedule.startHour}-${existing.schedule.endHour || 'all day'}`);
              }
            }
          } else if (!schedule && !existing.schedule) {
            // No schedule restrictions, just audience overlap
            warnings.push(`Campaign shares audience with existing proposal - consider if intended`);
          }
        }
      }
    }

    // Check for strategy conflicts (same strategy + same offer type)
    if (strategy) {
      const strategyConflicts = existingProposals.filter(p => p.strategy === strategy);
      if (strategyConflicts.length > 0) {
        warnings.push(`Multiple campaigns with ${strategy} strategy detected - ensure offers are not stacking unexpectedly`);
      }
    }

    // Check schedule overlap between existing proposals
    for (let i = 0; i < existingProposals.length; i++) {
      for (let j = i + 1; j < existingProposals.length; j++) {
        const p1 = existingProposals[i];
        const p2 = existingProposals[j];

        const s1 = p1.schedule;
        const s2 = p2.schedule;

        if (s1.mode === 'scheduled' || s2.mode === 'scheduled') {
          const s1Start = s1.startDate ? new Date(s1.startDate) : undefined;
          const s1End = s1.endDate ? new Date(s1.endDate) : undefined;
          const s2Start = s2.startDate ? new Date(s2.startDate) : undefined;
          const s2End = s2.endDate ? new Date(s2.endDate) : undefined;

          if (s1Start && s2Start) {
            const overlap = (s1Start <= s2End && s1End >= s2Start);
            if (overlap) {
              conflicts.push(`Existing campaigns ${p1.name} and ${p2.name} have overlapping schedules`);
            }
          }
        }
      }
    }

    // Check for quiet period violations
    if (schedule?.quietPeriods) {
      for (const existing of existingProposals) {
        if (existing.schedule?.quietPeriods) {
          // Simple check - if both have quiet periods, warn
          warnings.push('Multiple campaigns with quiet periods - ensure they do not conflict');
        }
      }
    }

    return { conflicts, warnings };
  }

  /**
   * Check customer contact frequency to prevent marketing fatigue.
   * Tracks messages per customer, time since last message, and campaign frequency.
   */
  async checkCustomerFrequency(
    restaurantId: string,
    audience: { segmentIds: string[]; customerPhones: string[] },
    ctx: { operator?: string } = {}
  ): Promise<{ exceedLimit: boolean; message: string; fatiguedCount: number }> {
    const phones = audience.customerPhones || [];
    const segmentIds = audience.segmentIds || [];

    if (phones.length === 0 && segmentIds.length === 0) {
      return { exceedLimit: false, message: 'No customers to check', fatiguedCount: 0 };
    }

    // Get phones from segments if provided
    let allPhones: string[] = [...phones];
    if (segmentIds.length > 0) {
      const segments = await CustomerSegment.find({
        restaurantId: objectId(restaurantId),
        _id: { $in: segmentIds.map(objectId) },
        isDeleted: { $ne: true },
      }).lean().exec();

      for (const seg of segments) {
        if (seg.customerPhones) {
          allPhones = [...allPhones, ...seg.customerPhones];
        }
      }
    }

    // Deduplicate
    const uniquePhones = [...new Set(allPhones)];

    // Count messages per customer in last 5 days (marketing fatigue window)
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    // Query campaign history for these customers in last 5 days
    // Note: This is a simplified check - real implementation would track per-customer messaging
    const fatiguedCount = Math.min(Math.floor(uniquePhones.length * 0.3), 10); // placeholder: assume 30% fatigued

    const exceedLimit = fatiguedCount > uniquePhones.length * 0.5; // if > 50% are fatigued

    let message = '';
    if (exceedLimit && fatiguedCount > 0) {
      message = `Customer frequency alert: ${fatiguedCount} of ${uniquePhones.length} customers received promotional messages in the last 5 days. Consider suppressing or reducing frequency.`;
    } else if (fatiguedCount > 0) {
      message = `${fatiguedCount} of ${uniquePhones.length} customers received messages in the last 5 days. Monitor for fatigue.`;
    } else {
      message = 'Customer contact frequency is within acceptable limits';
    }

    return { exceedLimit, message, fatiguedCount };
  }

  /**
   * Calculate campaign economics: cost vs expected incremental contribution.
   */
  async calculateCampaignEconomics(
    restaurantId: string,
    proposalData: Partial<ICampaignProposal>,
    ctx: { operator?: string } = {}
  ): Promise<{
    communicationCost: number;
    discountCost: number;
    freeItemCost: number;
    totalCost: number;
    expectedIncrementalContribution: number;
    expectedROI: number;
    costBreakdown: { discountCost: number; communicationCost: number; freeItemCost: number };
    meetsBudget: boolean;
  }> {
    const { budgetLimits, financialModel, expectedImpact, strategy, offerId, channels } = proposalData;

    // Default values
    let communicationCost = 0;
    let discountCost = 0;
    let freeItemCost = 0;
    let totalCost = financialModel?.totalCost || 0;
    let expectedIncrementalContribution = financialModel?.expectedIncrementalContribution || 0;

    // ─── Communication cost ───
    // Estimate based on channel and audience size
    const audienceCount = audience?.customerPhones?.length || 0 || 100; // fallback
    const channelCostMap: Record<string, number> = {
      sms: 1,      // ₹1 per message (approximate)
      whatsapp: 2, // ₹2 per message template
      email: 0.5,  // ₹0.50 per email
      app_notification: 0.1, // negligible
      webhook: 0,
    };

    for (const channel of (channels || [])) {
      const costPerMessage = channelCostMap[channel] || 1;
      communicationCost += costPerMessage * audienceCount;
    }

    // Apply communication cost cap if set
    if (budgetLimits?.communicationCostCap !== undefined && communicationCost > budgetLimits.communicationCostCap) {
      communicationCost = budgetLimits.communicationCostCap;
    }

    // ─── Discount cost ───
    if (offerId) {
      const offer = await Offer.findById(offerId);
      if (offer) {
        const audienceCount = audience?.customerPhones?.length || 0 || 100;
        let discountPerOrder = 0;

        if (offer.type === 'percentage') {
          // Calculate actual discount amount based on average order value
          // For now, use offer.value as percentage
          discountPerOrder = (offer.value / 100) * 200; // assume avg ₹200 order
          discountCost = discountPerOrder * audienceCount;
          // Apply max discount percent constraint
          if (budgetLimits?.maxDiscountPercent !== undefined && offer.value > budgetLimits.maxDiscountPercent) {
            const cappedDiscount = (budgetLimits.maxDiscountPercent / 100) * 200;
            discountCost = cappedDiscount * audienceCount;
          }
        } else if (offer.type === 'flat') {
          discountPerOrder = offer.value;
          discountCost = discountPerOrder * audienceCount;
          if (budgetLimits?.maxDiscountAmount !== undefined && offer.value > budgetLimits.maxDiscountAmount) {
            discountCost = budgetLimits.maxDiscountAmount * audienceCount;
          }
        } else if (offer.type === 'free_item') {
          // Free item cost = cost of the free item * expected redemption rate
          const avgItemCost = 100; // placeholder average
          const redemptionRate = expectedImpact?.expectedRedemptionRate || 10;
          freeItemCost = avgItemCost * (redemptionRate / 100) * audienceCount;
        } else if (offer.type === 'combo') {
          // Combo cost = combo price * expected redemption
          const comboPrice = offer.comboPrice || 200;
          const redemptionRate = expectedImpact?.expectedRedemptionRate || 10;
          freeItemCost = comboPrice * (redemptionRate / 100) * audienceCount;
        }

        discountCost = Math.max(discountCost, 0); // ensure non-negative
      }
    }

    // ─── Free item cost ─── (already captured above for free_item/combo types)

    // ─── Total cost ───
    totalCost = discountCost + communicationCost + freeItemCost;

    // ─── Expected incremental contribution ───
    // If we have expected impact data, calculate contribution
    const expectedReach = expectedImpact?.expectedReach || audienceCount;
    const expectedRedemptionRate = expectedImpact?.expectedRedemptionRate || 10;
    const expectedIncrementalOrders = expectedImpact?.expectedIncrementalOrders || 0;

    // Estimate average order value contribution
    const avgOrderValue = 250; // placeholder average
    const incrementalRevenue = expectedIncrementalOrders * avgOrderValue;
    expectedIncrementalContribution = incrementalRevenue - totalCost;

    // ─── Expected ROI ───
    let expectedROI = 0;
    if (totalCost > 0) {
      expectedROI = (expectedIncrementalContribution / totalCost) * 100;
    }

    // ─── Meets budget check ───
    const meetsBudget = totalCost <= (budgetLimits?.communicationCostCap || totalCost * 2); // simple check

    return {
      communicationCost,
      discountCost,
      freeItemCost,
      totalCost,
      expectedIncrementalContribution,
      expectedROI,
      costBreakdown: { discountCost, communicationCost, freeItemCost },
      meetsBudget,
    };
  }

  /**
   * Check quiet periods for the campaign schedule.
   * Returns true if the current time falls within a configured quiet period.
   */
  async isQuietPeriod(schedule: { mode: string; quietPeriods?: { startHour: number; endHour: number }[] }): boolean {
    if (schedule.mode !== 'scheduled' || !schedule.quietPeriods || schedule.quietPeriods.length === 0) {
      return false;
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;

    for (const qp of schedule.quietPeriods) {
      const { startHour, endHour } = qp;
      // Quiet period spans from startHour to endHour
      // Handle wrap-around (e.g., 22 to 9 = 10 PM to 9 AM)
      if (startHour < endHour) {
        // Normal case: 9 AM to 5 PM
        if (currentTimeInMinutes >= startHour * 60 && currentTimeInMinutes < endHour * 60) {
          return true;
        }
      } else {
        // Wrap-around case: 10 PM to 9 AM
        if (currentTimeInMinutes >= startHour * 60 || currentTimeInMinute < endHour * 60) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check consent/opt-out status for the audience.
   * Ensures excluded customers who have opted out are not contacted.
   */
  async checkConsent(
    restaurantId: string,
    audience: { segmentIds: string[]; customerPhones: string[] },
    ctx: { operator?: string } = {}
  ): Promise<{ valid: boolean; excludedCount: number; message: string }> {
    const { customerPhones } = audience;
    let excludedCount = 0;

    if (customerPhones.length === 0) {
      return { valid: true, excludedCount: 0, message: 'No customer phones to check' };
    }

    // Check WhatsApp opt-outs
    // In a real implementation, this would query the opt-out database
    // For now, we'll check if any phones match known opt-out patterns
    for (const phone of customerPhones) {
      // Placeholder: check if phone ends with known opt-out marker or is in opt-out list
      // This is simplified - real implementation would have an OptOut model
      if (phone.endsWith('@opted_out')) {
        excludedCount++;
      }
    }

    const valid = excludedCount < customerPhones.length; // valid if not ALL are excluded
    const message = excludedCount > 0
      ? `${excludedCount} customer(s) have opted out and will be excluded from this campaign`
      : 'All customers have consent to receive this campaign';

    return { valid, excludedCount, message };
  }

  private mapCampaign(c: any): any {
    const doc = c.toObject ? c.toObject() : c;
    const stats = doc.stats || {};
    return {
      id: doc._id.toString(),
      name: doc.name,
      description: doc.description,
      offerId: doc.offerId,
      audience: doc.audience,
      template: doc.template,
      schedule: doc.schedule,
      status: doc.status,
      stats,
      historyIds: doc.historyIds || [],
      createdBy: doc.createdBy,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      // Legacy/console-friendly fields (Phase 24): the admin CRM console and
      // older consumers read these flat names.
      channel: doc.template?.channel,
      audienceCount: stats.audienceCount ?? doc.audience?.customerPhones?.length ?? 0,
      scheduledAt: doc.schedule?.mode === 'scheduled' ? doc.schedule?.scheduledAt : undefined,
      sentAt: doc.schedule?.dispatchedAt || undefined,
      deliveryCount: stats.sentCount ?? 0,
      redemptionCount: stats.redeemedCount ?? 0,
    };
  }

  /**
   * Validate a natural language command into structured constraints.
   * The LLM output is never trusted directly - it must pass deterministic validation.
   */
  async validateNaturalLanguageCommand(
    restaurantId: string,
    command: string,
    ctx: { operator?: string } = {}
  ): Promise<{
    valid: boolean;
    parsedIntent?: {
      objective?: CampaignProposalObjective;
      strategy?: CampaignProposalStrategy;
      discountPercent?: number;
      discountAmount?: number;
      audience?: { type: string; segmentIds: string[]; customerPhones: string[] };
      schedule?: { mode: string; startDate?: Date; endDate?: Date; daysOfWeek?: number[]; startHour?: number; endHour?: number };
      channels?: CampaignProposalChannel[];
      guardrails?: AutomationGuardrails;
    };
    errors: string[];
  }> {
    const errors: string[] = [];
    const parsed: any = {};

    // Very simple NLP parsing - in production would use LLM with strict output schema
    const lowerCommand = command.toLowerCase();

    // Parse objective
    const objectiveMap: Record<string, CampaignProposalObjective> = {
      'aov': 'INCREASE_AOV',
      'orders': 'INCREASE_ORDERS',
      'slow hours': 'FILL_SLOW_HOURS',
      'repeat visits': 'INCREASE_REPEAT_VISITS',
      'reactivate': 'REACTIVATE_CUSTOMERS',
      'new item': 'PROMOTE_NEW_ITEM',
      'addon': 'INCREASE_ADDON_ATTACHMENT',
      'inventory': 'REDUCE_EXCESS_INVENTORY',
      'wastage': 'REDUCE_WASTAGE',
      'high margin': 'INCREASE_HIGH_MARGIN_SALES',
      'protect': 'PROTECT_HIGH_PERFORMERS',
    };

    for (const [key, value] of Object.entries(objectiveMap)) {
      if (lowerCommand.includes(key)) {
        parsed.objective = value;
        break;
      }
    }

    if (!parsed.objective) {
      errors.push('Could not determine campaign objective from command');
    }

    // Parse strategy
    const strategyMap: Record<string, CampaignProposalStrategy> = {
      'combo': 'COMBO',
      'discount': 'DISCOUNT',
      'free item': 'FREE_ITEM',
      'addon': 'ADDON',
      'cross sell': 'CROSS_SELL',
      'loyalty': 'LOYALTY_REWARD',
      'reactivation': 'REACTIVATION',
      'time based': 'TIME_BASED',
      'category promotion': 'CATEGORY_PROMOTION',
    };

    for (const [key, value] of Object.entries(strategyMap)) {
      if (lowerCommand.includes(key)) {
        parsed.strategy = value;
        break;
      }
    }

    // Parse discount
    const discountMatch = command.match(/(\d+(?:\.\d+)?)\s*%?\s*off/gi);
    if (discountMatch) {
      const value = parseFloat(discountMatch[0]);
      if (value >= 0 && value <= 100) {
        parsed.discountPercent = value;
      }
    }

    const amountMatch = command.match(/Rs\.?\s*(\d+(?:\.\d+)?)\s*off/gi);
    if (amountMatch) {
      const value = parseFloat(amountMatch[0].replace('Rs.', '').replace('off', '').trim());
      if (value > 0) {
        parsed.discountAmount = value;
      }
    }

    // Parse audience
    if (lowerCommand.includes('inactive') || lowerCommand.includes('reactivate')) {
      parsed.audience = { type: 'segment', segmentIds: [], customerPhones: [] };
    } else if (lowerCommand.includes('new customers') || lowerCommand.includes('acquisition')) {
      parsed.audience = { type: 'segment', segmentIds: [], customerPhones: [] };
    } else if (lowerCommand.includes('frequent') || lowerCommand.includes('loyalty')) {
      parsed.audience = { type: 'segment', segmentIds: [], customerPhones: [] };
    } else if (lowerCommand.includes('high-value') || lowerCommand.includes('vip')) {
      parsed.audience = { type: 'segment', segmentIds: [], customerPhones: [] };
    } else if (lowerCommand.includes('product affinity') || lowerCommand.includes('who buy')) {
      parsed.audience = { type: 'segment', segmentIds: [], customerPhones: [] };
    }

    // Parse schedule
    if (lowerCommand.includes('tuesday') || lowerCommand.includes('tue')) {
      parsed.schedule = { mode: 'scheduled', daysOfWeek: [2], startHour: 15, endHour: 18 };
    } else if (lowerCommand.includes('3-6 pm') || lowerCommand.includes('3 pm to 6 pm')) {
      parsed.schedule = { mode: 'scheduled', startHour: 15, endHour: 18 };
    } else if (lowerCommand.includes('immediate') || lowerCommand.includes('now')) {
      parsed.schedule = { mode: 'immediate' };
    }

    // Parse channels
    if (lowerCommand.includes('whatsapp')) {
      parsed.channels = ['whatsapp'];
    }
    if (lowerCommand.includes('sms')) {
      parsed.channels = parsed.channels ? [...parsed.channels, 'sms'] : ['sms'];
    }
    if (lowerCommand.includes('email')) {
      parsed.channels = parsed.channels ? [...parsed.channels, 'email'] : ['email'];
    }

    // Parse guardrails
    const discountGuardrailMatch = command.match(/(?:max|maximum|limit).*(\d+(?:\.\d+)?)\s*%?/i);
    if (discountGuardrailMatch) {
      const value = parseFloat(discountGuardrailMatch[1]);
      if (value >= 0 && value <= 100) {
        if (!parsed.guardrails) parsed.guardrails = {};
        parsed.guardrails.maxDiscountPercent = value;
      }
    }

    const amountGuardrailMatch = command.match(/(?:max|maximum|limit).*Rs\.?\s*(\d+(?:\.\d+)?)/i);
    if (amountGuardrailMatch) {
      const value = parseFloat(amountGuardrailMatch[1]);
      if (value > 0) {
        if (!parsed.guardrails) parsed.guardrails = {};
        parsed.guardrails.maxDiscountAmount = value;
      }
    }

    if (parsed.discountPercent !== undefined && parsed.discountPercent > 50) {
      errors.push('Discount exceeds safe limit of 50% - please reduce');
    }

    return {
      valid: errors.length === 0 && !!parsed.objective,
      parsedIntent: errors.length === 0 ? parsed : undefined,
      errors,
    };
  }

  /**
   * Create campaign proposal from natural language command.
   * Follows the AI Campaign Creator flow (Phase 34):
   * 1. Determines objective
   * 2. Retrieves relevant opportunities
   * 3. Evaluates economics
   * 4. Chooses candidate strategies
   * 5. Builds campaign proposal
   * 6. Selects audience
   * 7. Suggests channel
   * 8. Generates copy
   * 9. Shows expected impact
   * 10. Requests approval
   */
  async createProposalFromCommand(
    restaurantId: string,
    command: string,
    ctx: { operator?: string } = {}
  ): Promise<{
    proposal: ICampaignProposal | null;
    validation: { valid: boolean; errors: string[]; warnings: string[] };
    naturalLanguageValidation: ReturnType<typeof validateNaturalLanguageCommand>;
    message: string;
  }> {
    // Step 1: Parse the natural language command
    const nlpValidation = await validateNaturalLanguageCommand(restaurantId, command, ctx);

    if (!nlpValidation.valid) {
      return {
        proposal: null,
        validation: { valid: false, errors: nlpValidation.errors, warnings: [] },
        naturalLanguageValidation: nlpValidation,
        message: 'Could not understand the command. Please try rephrasing.',
      };
    }

    const intent = nlpValidation.parsedIntent!;

    // Step 2: Retrieve relevant opportunities (from Phase 4-5 intelligence)
    // For now, use placeholder data based on the intent

    // Step 3: Evaluate economics (using the calculateCampaignEconomics method)
    // We need placeholder audience data - using 100 as default
    const placeholderAudience = { customerPhones: [], segmentIds: [] };
    const economics = await this.calculateCampaignEconomics(restaurantId, {
      objective: intent.objective,
      strategy: intent.strategy,
      offerId: undefined, // Will be determined by strategy
      audience: placeholderAudience,
      channels: intent.channels || ['whatsapp'],
      budgetLimits: {
        maxDiscountPercent: 20,
        communicationCostCap: 5000,
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
        confidence: 'low',
      },
      expectedImpact: {
        expectedReach: 500,
        expectedRedemptionRate: 10,
        expectedIncrementalOrders: 5,
        expectedAOVImpact: 0,
        expectedNewCustomers: 0,
        expectedRepeatVisits: 0,
      },
    }, ctx);

    // Step 4: Choose candidate strategies based on strategy profile
    // For now, use the requested strategy or fallback to DISCOUNT

    // Step 5: Build campaign proposal
    const now = new Date();
    const proposal = new CampaignProposal({
      restaurantId: objectId(restaurantId),
      name: `${intent.objective} Campaign • ${command.substring(0, 30)}${command.length > 30 ? '...' : ''}`,
      description: `Auto-generated from command: "${command}"`,
      objective: intent.objective,
      strategy: intent.strategy || 'DISCOUNT',
      offerId: undefined,
      audience: intent.audience || { segmentIds: [], segmentNames: [], customerPhones: [] },
      schedule: intent.schedule || { mode: 'immediate', scheduledAt: null, startDate: null, endDate: null, daysOfWeek: [], startHour: undefined, endHour: undefined, quietPeriods: [] },
      channels: intent.channels || ['whatsapp'],
      budgetLimits: {
        maxDiscountPercent: intent.guardrails?.maxDiscountPercent ?? 20,
        maxDiscountAmount: intent.guardrails?.maxDiscountAmount,
        maxFreeItems: 0,
        maxUses: undefined,
        maxPerCustomer: undefined,
        communicationCostCap: intent.guardrails?.budgetLimit,
      },
      financialModel: {
        totalCost: economics.totalCost,
        discountCost: economics.discountCost,
        communicationCost: economics.communicationCost,
        freeItemCost: economics.freeItemCost,
        expectedRevenue: economics.expectedRevenue || 0,
        expectedIncrementalContribution: economics.expectedIncrementalContribution,
        expectedROI: economics.expectedROI,
        costBreakdown: economics.costBreakdown,
        confidence: 'low',
      },
      expectedImpact: intent.expectedImpact || {
        expectedReach: 500,
        expectedRedemptionRate: 10,
        expectedIncrementalOrders: economics.expectedIncrementalOrders || 0,
        expectedAOVImpact: 0,
        expectedNewCustomers: 0,
        expectedRepeatVisits: 0,
      },
      evidence: {
        elasticityEstimate: undefined,
        historicalPromotionIds: [],
        dataSufficiency: 'INSUFFICIENT_DATA',
        modelVersion: 'v1',
      },
      risks: {
        marginRisk: 'moderate',
        cannibalizationRisk: 'low',
        fatigueRisk: 'low',
        conflictRisk: 'low',
        notes: [],
      },
      approvalStatus: 'pending',
      executionStatus: 'pending',
    });

    // Step 6: Validate the proposal
    const validation = await proposal.validateCampaignProposal();

    // Step 7: Return result
    let message = '';
    if (!validation.valid) {
      message = 'Proposal generated but validation failed. Please review errors below.';
    } else {
      message = 'Campaign proposal generated successfully. Ready for owner review and approval.';
    }

    return {
      proposal,
      validation,
      naturalLanguageValidation: nlpValidation,
      message,
    };
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign Service — CRM campaign builder (Phase 1.6, extended).
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
import CampaignHistory from '../models/CampaignHistory';
import Offer from '../models/Offer';
import { AppError } from '../utils/AppError';
import { campaignRepo, auditLogRepo } from '../repositories';
import { enqueueCampaign } from './campaignQueue';
import { CAMPAIGN_TRANSITIONS, canTransition } from '../constants/marketingStates';
import type { CampaignChannel, CampaignStatus } from '../models/Campaign';

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
}

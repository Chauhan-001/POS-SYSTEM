/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Campaign Service — CRM campaign builder (Phase 1.6).
 *
 * A campaign targets an audience (segments and/or manual phones), uses a
 * message template, has a schedule, and tracks delivery. The provider layer
 * (SMS/WhatsApp/Email/Push) is abstracted behind a `sendChannel` hook so real
 * gateways can be plugged in later; today delivery is recorded into
 * CampaignHistory with status 'sent' (best-effort, never fails billing).
 */

import mongoose from 'mongoose';
import Customer from '../models/Customer';
import CustomerSegment from '../models/CustomerSegment';
import Campaign from '../models/Campaign';
import CampaignHistory from '../models/CampaignHistory';
import Offer from '../models/Offer';
import { AppError } from '../utils/AppError';
import { campaignRepo, auditLogRepo } from '../repositories';
import type { CampaignChannel, CampaignStatus } from '../models/Campaign';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export interface SendCampaignResult {
  audienceCount: number;
  sentCount: number;
  failedCount: number;
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
      details: { name: data.name || existing.name },
    } as any);
    return campaign ? this.mapCampaign(campaign) : null;
  }

  async setStatus(restaurantId: string, id: string, status: CampaignStatus, ctx: { operator?: string } = {}): Promise<any | null> {
    const campaign = await campaignRepo.forTenant(restaurantId).update(id, { status } as any);
    await auditLogRepo.create({
      action: 'CAMPAIGN_STATUS_CHANGED',
      entityType: 'campaign',
      entityId: id,
      performedBy: ctx.operator || 'System',
      details: { status },
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
    } as any);
    return true;
  }

  /**
   * Send a campaign. Resolves the audience, records a CampaignHistory entry
   * per channel, marks the campaign sent, and (if linked to an offer) wires
   * the history to the offer for redemption tracking.
   */
  async send(restaurantId: string, id: string, ctx: { operator?: string } = {}): Promise<SendCampaignResult> {
    const campaign = await campaignRepo.forTenant(restaurantId).findById(id);
    if (!campaign) throw new AppError(404, 'Campaign not found');
    const doc = campaign as any;
    if (doc.status === 'sent' || doc.status === 'sending') {
      throw new AppError(400, 'Campaign already sent');
    }

    await campaignRepo.forTenant(restaurantId).update(id, { status: 'sending' } as any);

    const audience = doc.audience?.customerPhones || [];
    const channel = (doc.template?.channel || 'sms') as CampaignChannel;
    const messageContent = doc.template?.message || '';

    // Abstracted provider layer — today records the delivery; plug real
    // SMS/WhatsApp/Email/Push gateways into sendChannel() later.
    let sentCount = 0;
    const failed: string[] = [];
    for (const phone of audience) {
      try {
        await this.sendChannel(channel, phone, messageContent);
        sentCount++;
      } catch (err: any) {
        failed.push(phone);
      }
    }

    // Offer-linked campaign: touch the offer message templates for reference.
    let offerTitle = '';
    if (doc.offerId) {
      const offer = await Offer.findOne({ _id: doc.offerId, restaurantId: objectId(restaurantId) }).lean().exec();
      offerTitle = offer?.title || '';
    }

    const history = await CampaignHistory.create({
      offerId: doc.offerId || objectId(restaurantId),
      restaurantId: objectId(restaurantId),
      channel,
      recipientPhones: audience,
      recipientCount: audience.length,
      openedCount: 0,
      redeemedCount: 0,
      messageContent: `${offerTitle ? `[${offerTitle}] ` : ''}${messageContent}`,
      isScheduled: false,
      sentDate: new Date().toISOString(),
      campaignCost: 0,
      status: failed.length === 0 ? 'sent' : failed.length === audience.length ? 'failed' : 'partial',
      errorLog: failed.length > 0 ? `Failed: ${failed.slice(0, 10).join(', ')}` : undefined,
    });

    await campaignRepo.forTenant(restaurantId).update(id, {
      status: failed.length === audience.length && audience.length > 0 ? 'failed' : 'sent',
      'stats.sentCount': sentCount,
      'stats.failedCount': failed.length,
      $push: { historyIds: history._id.toString() },
    } as any);

    await auditLogRepo.create({
      action: 'CAMPAIGN_SENT',
      entityType: 'campaign',
      entityId: id,
      performedBy: ctx.operator || 'System',
      details: { channel, audienceCount: audience.length, sentCount, failedCount: failed.length },
    } as any);

    return { audienceCount: audience.length, sentCount, failedCount: failed.length };
  }

  /**
   * Abstracted delivery provider. Replace with real gateway integrations
   * (Twilio/SMS, WhatsApp Business API, SMTP, FCM/APNs). Logs delivery to the
   * console; throws on hard failure.
   */
  private async sendChannel(channel: CampaignChannel, phone: string, message: string): Promise<void> {
    const masked = phone.replace(/^(\d{2})\d{6}(\d{2})$/, '$1******$2');
    console.log(`[Campaign] ${channel.toUpperCase()} → ${masked}: ${message.slice(0, 60)}`);
    // Real providers would POST here. Simulated success keeps the flow safe.
  }

  private mapCampaign(c: any): any {
    const doc = c.toObject ? c.toObject() : c;
    return {
      id: doc._id.toString(),
      name: doc.name,
      description: doc.description,
      offerId: doc.offerId,
      audience: doc.audience,
      template: doc.template,
      schedule: doc.schedule,
      status: doc.status,
      stats: doc.stats,
      historyIds: doc.historyIds,
      createdBy: doc.createdBy,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}

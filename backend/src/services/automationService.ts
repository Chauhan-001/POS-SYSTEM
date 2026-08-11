/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * automationService.ts — Predefined marketing automation recipes (Phase 19).
 *
 * Each restaurant gets three recipes on first access (birthday / win_back /
 * vip). The scheduler (`marketingScheduler.ts`) turns each ENABLED recipe into
 * a real Campaign targeting the recipe's segment, at most once per day
 * (idempotency via lastRunAt).
 */

import mongoose from 'mongoose';
import MarketingAutomation from '../models/MarketingAutomation';
import CustomerSegment from '../models/CustomerSegment';
import Campaign from '../models/Campaign';
import CampaignHistory from '../models/CampaignHistory';
import Restaurant from '../models/Restaurant';
import { auditLogRepo } from '../repositories';
import { campaignService } from './index';
import type { MarketingAutomationType } from '../models/MarketingAutomation';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export const AUTOMATION_RECIPES: Array<{
  type: MarketingAutomationType;
  name: string;
  description: string;
  channel: 'whatsapp' | 'sms' | 'email' | 'app_notification' | 'webhook';
  offerTemplate: { type: string; value: number; title: string; minOrderValue?: number };
  segmentType: string;
  daysLookback?: number;
}> = [
  {
    type: 'birthday',
    name: 'Birthday Wishes',
    description: 'Send a birthday offer to customers whose birthday is tomorrow.',
    channel: 'whatsapp',
    offerTemplate: { type: 'percentage', value: 20, title: 'Birthday Treat' },
    segmentType: 'birthday_tomorrow',
  },
  {
    type: 'win_back',
    name: 'Win Back Customers',
    description: 'Re-engage customers who have not visited in 30+ days.',
    channel: 'whatsapp',
    offerTemplate: { type: 'percentage', value: 15, title: 'Welcome Back', minOrderValue: 300 },
    segmentType: 'dormant_30d',
  },
  {
    type: 'vip',
    name: 'VIP Care',
    description: 'Reward your VIP customers with an exclusive offer.',
    channel: 'whatsapp',
    offerTemplate: { type: 'flat', value: 100, title: 'VIP Special', minOrderValue: 500 },
    segmentType: 'vip_customer',
  },
];

/** Ensure the three default recipes exist for the restaurant (idempotent). */
export async function ensureRecipes(restaurantId: string): Promise<void> {
  const oid = objectId(restaurantId);
  for (const recipe of AUTOMATION_RECIPES) {
    const exists = await MarketingAutomation.findOne({ restaurantId: oid, type: recipe.type, isDeleted: { $ne: true } }).lean().exec();
    if (!exists) {
      await MarketingAutomation.create({
        restaurantId: oid,
        type: recipe.type,
        name: recipe.name,
        description: recipe.description,
        enabled: false,
        channel: recipe.channel,
        offerTemplate: recipe.offerTemplate,
        message: '',
      });
    }
  }
}

export async function listAutomations(restaurantId: string): Promise<any[]> {
  await ensureRecipes(restaurantId);
  const docs = await MarketingAutomation.find({ restaurantId: objectId(restaurantId), isDeleted: { $ne: true } })
    .sort({ type: 1 })
    .lean()
    .exec();
  return docs.map((d) => ({
    id: d._id.toString(),
    type: d.type,
    name: d.name,
    description: d.description,
    enabled: d.enabled,
    channel: d.channel,
    offerTemplate: d.offerTemplate,
    message: d.message,
    lastRunAt: d.lastRunAt || null,
  }));
}

export async function updateAutomation(
  restaurantId: string,
  id: string,
  patch: { enabled?: boolean; channel?: string; message?: string; offerTemplate?: any },
  operator?: string,
): Promise<any | null> {
  const doc = await MarketingAutomation.findOneAndUpdate(
    { _id: id, restaurantId: objectId(restaurantId), isDeleted: { $ne: true } },
    {
      $set: {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.channel ? { channel: patch.channel } : {}),
        ...(patch.message !== undefined ? { message: patch.message } : {}),
        ...(patch.offerTemplate ? { offerTemplate: patch.offerTemplate } : {}),
      },
    },
    { new: true },
  ).exec();

  if (doc) {
    await auditLogRepo.create({
      action: 'CAMPAIGN_STATUS_CHANGED',
      entityType: 'automation',
      entityId: id,
      performedBy: operator || 'System',
      restaurantId,
      details: { type: doc.type, enabled: doc.enabled, channel: doc.channel },
    } as any);
  }
  return doc ? { ...doc.toObject(), id: doc._id.toString() } : null;
}

export async function deleteAutomation(restaurantId: string, id: string, operator?: string): Promise<boolean> {
  const res = await MarketingAutomation.updateOne(
    { _id: id, restaurantId: objectId(restaurantId) },
    { $set: { isDeleted: true } },
  ).exec();
  if (res.modifiedCount > 0) {
    await auditLogRepo.create({
      action: 'CAMPAIGN_DELETED',
      entityType: 'automation',
      entityId: id,
      performedBy: operator || 'System',
      restaurantId,
    } as any);
    return true;
  }
  return false;
}

/**
 * Run every enabled recipe at most once per day. Called by the marketing
 * scheduler. Creates a real Campaign (targeting the recipe's segment) and
 * queues it for delivery. Never throws — a recipe failure is logged and the
 * loop continues.
 */
export async function runDueAutomations(): Promise<void> {
  const automations: any[] = await (MarketingAutomation.find({ enabled: true, isDeleted: { $ne: true } }) as any)
    .lean()
    .exec();
  for (const auto of automations) {
    try {
      const restaurantId = String(auto.restaurantId);
      const today = new Date().toISOString().slice(0, 10);
      const last = auto.lastRunAt ? new Date(auto.lastRunAt).toISOString().slice(0, 10) : '';
      if (last === today) continue; // idempotent: at most one run per day

      const recipe = AUTOMATION_RECIPES.find((r) => r.type === auto.type);
      if (!recipe) continue;

      const segment = await CustomerSegment.findOne({
        restaurantId: objectId(restaurantId),
        type: recipe.segmentType as any,
        isDeleted: { $ne: true },
      }).lean().exec();
      const phones = (segment?.customerPhones || []).slice(0, 1000);

      // Mark as run today regardless, so an empty segment doesn't retry every tick.
      await MarketingAutomation.updateOne(
        { _id: auto._id } as any,
        { $set: { lastRunAt: new Date() } } as any,
      ).exec();

      if (phones.length === 0) continue;

      const restaurant = await Restaurant.findById(restaurantId).lean().exec();
      const restaurantName = (restaurant as any)?.name || 'Our Restaurant';

      const value = auto.offerTemplate?.value ?? recipe.offerTemplate.value;
      const offerType = auto.offerTemplate?.type || recipe.offerTemplate.type;
      const title = auto.offerTemplate?.title || recipe.offerTemplate.title;
      const minOrder = auto.offerTemplate?.minOrderValue;

      const message =
        auto.message ||
        `${title ? `${title}! ` : ''}${offerType === 'percentage' ? `${value}% OFF` : offerType === 'flat' ? `Rs.${value} OFF` : `${value}`} on your order${minOrder ? ` above Rs.${minOrder}` : ''} at ${restaurantName}. ${auto.type === 'birthday' ? 'Happy Birthday! 🎂' : auto.type === 'win_back' ? 'We miss you! 💛' : 'You deserve the best! ✨'} Show this message at the counter.`;

      const campaign = await Campaign.create({
        restaurantId: objectId(restaurantId),
        name: `${title || recipe.name} · ${today}`,
        description: recipe.description,
        offerId: null,
        audience: {
          segmentIds: segment ? [String(segment._id)] : [],
          segmentNames: segment ? [segment.name] : [],
          customerPhones: phones,
        },
        template: { channel: auto.channel || recipe.channel, message },
        schedule: { mode: 'immediate', scheduledAt: null },
        status: 'draft',
        stats: { audienceCount: phones.length, sentCount: 0, failedCount: 0, redeemedCount: 0 },
        createdBy: `Automation:${auto.type}`,
      } as any);

      await campaignService.send(restaurantId, String((campaign as any)._id), { operator: `Automation:${auto.type}` });
      console.log(`[Automation] ${auto.type} → campaign ${(campaign as any)._id} queued (${phones.length} recipients)`);
    } catch (err: any) {
      console.warn(`[Automation] ${auto.type} run failed:`, err?.message);
    }
  }
}

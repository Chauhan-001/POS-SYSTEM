/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * marketingTools.ts — Marketing read tools (spec §6): live offers from the
 * Offer model, offer performance from the authoritative OfferAnalytics
 * service, and campaign delivery history from CampaignHistory — the same
 * sources the marketing controllers expose.
 */

import { z } from 'zod';
import mongoose from 'mongoose';
import Offer from '../../../models/marketing/Offer';
import CampaignHistory from '../../../models/marketing/CampaignHistory';
import {
  getOfferPerformance,
  type OfferPerformanceSummary,
} from '../../../services/offerAnalyticsService';
import type { ToolContext, ToolDefinition } from '../registry/toolTypes';

function oid(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

// ─── getActiveOffers ────────────────────────────────────────────────

export const getActiveOffersInputSchema = z.object({}).strict();
export type GetActiveOffersInput = z.infer<typeof getActiveOffersInputSchema>;

export interface ActiveOffersOutput {
  available: boolean;
  reason?: 'NO_ACTIVE_OFFERS';
  offers?: Array<{
    id: string;
    title: string;
    description: string;
    type: string;
    value: number;
    startDate?: string;
    endDate?: string;
    applicableProductIds?: string[];
    applicableCategories?: string[];
  }>;
  generatedAt: string;
}

export async function executeGetActiveOffers(
  _input: GetActiveOffersInput,
  ctx: ToolContext,
): Promise<ActiveOffersOutput> {
  const generatedAt = new Date().toISOString();
  try {
    const offers = await Offer.find({
      restaurantId: oid(ctx.tenant.restaurantId),
      status: 'active',
      isDeleted: { $ne: true },
    })
      .select('title description type value startDate endDate applicableProductIds applicableCategories')
      .limit(50)
      .lean()
      .exec();
    if (offers.length === 0) {
      return { available: false, reason: 'NO_ACTIVE_OFFERS', generatedAt };
    }
    return {
      available: true,
      offers: offers.map((o: any) => ({
        id: String(o._id),
        title: o.title,
        description: o.description,
        type: o.type,
        value: Number(o.value) || 0,
        startDate: o.startDate,
        endDate: o.endDate,
        applicableProductIds: o.applicableProductIds,
        applicableCategories: o.applicableCategories,
      })),
      generatedAt,
    };
  } catch {
    return { available: false, reason: 'NO_ACTIVE_OFFERS', generatedAt };
  }
}

export const getActiveOffersToolDefinition: ToolDefinition<GetActiveOffersInput, ActiveOffersOutput> = {
  name: 'getActiveOffers',
  category: 'marketing',
  access: 'read',
  meta: {
    description:
      'Currently active offers for the restaurant: title, description, type, value, validity dates and applicable products/categories.',
    source: 'models/marketing/Offer (status=active, tenant-scoped)',
  },
  inputSchema: getActiveOffersInputSchema,
  execute: executeGetActiveOffers,
};

// ─── getOfferPerformance ────────────────────────────────────────────

export const getOfferPerformanceInputSchema = z
  .object({
    /** ISO date (YYYY-MM-DD) window start; defaults to the service default. */
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    branchId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  })
  .strict();

export type GetOfferPerformanceInput = z.infer<typeof getOfferPerformanceInputSchema>;

export interface OfferPerformanceOutput {
  available: boolean;
  reason?: 'NO_OFFER_PERFORMANCE_DATA';
  offers?: Array<{
    offerId: string;
    title?: string;
    type?: string;
    redemptions: number;
    revenueGenerated: number;
    discountGiven: number;
    averageOrderValue: number;
    uniqueCustomers: number;
    repeatCustomers: number;
    contribution?: number | null;
    contributionMargin?: number | null;
  }>;
  generatedAt: string;
}

export async function executeGetOfferPerformance(
  input: GetOfferPerformanceInput,
  ctx: ToolContext,
): Promise<OfferPerformanceOutput> {
  const generatedAt = new Date().toISOString();
  try {
    const rows: OfferPerformanceSummary[] = await getOfferPerformance({
      restaurantId: ctx.tenant.restaurantId,
      from: input.from,
      to: input.to,
      branchId: input.branchId,
    });
    if (!rows || rows.length === 0) {
      return { available: false, reason: 'NO_OFFER_PERFORMANCE_DATA', generatedAt };
    }
    return {
      available: true,
      offers: rows.map((r) => ({
        offerId: r.offerId,
        title: r.title,
        type: r.type,
        redemptions: r.redemptions,
        revenueGenerated: r.revenueGenerated,
        discountGiven: r.discountGiven,
        averageOrderValue: r.averageOrderValue,
        uniqueCustomers: r.uniqueCustomers,
        repeatCustomers: r.repeatCustomers,
        contribution: r.contribution ?? null,
        contributionMargin: r.contributionMargin ?? null,
      })),
      generatedAt,
    };
  } catch {
    return { available: false, reason: 'NO_OFFER_PERFORMANCE_DATA', generatedAt };
  }
}

export const getOfferPerformanceToolDefinition: ToolDefinition<GetOfferPerformanceInput, OfferPerformanceOutput> = {
  name: 'getOfferPerformance',
  category: 'marketing',
  access: 'read',
  meta: {
    description:
      'Historical offer performance from real redemption analytics: redemptions, revenue, discounts, AOV, unique/repeat customers and estimated contribution margin per offer.',
    source: 'services/offerAnalyticsService.ts → getOfferPerformance (authoritative OfferAnalytics)',
  },
  inputSchema: getOfferPerformanceInputSchema,
  execute: executeGetOfferPerformance,
};

// ─── getCampaignPerformance ─────────────────────────────────────────

export const getCampaignPerformanceInputSchema = z
  .object({
    /** Optional offer filter — only campaigns for this offer. */
    offerId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type GetCampaignPerformanceInput = z.infer<typeof getCampaignPerformanceInputSchema>;

export interface CampaignPerformanceOutput {
  available: boolean;
  reason?: 'NO_CAMPAIGN_HISTORY';
  campaigns?: Array<{
    id: string;
    offerId?: string | null;
    channel: string;
    recipientCount: number;
    openedCount: number;
    redeemedCount: number;
    campaignCost: number;
    status: string;
    sentDate?: string;
  }>;
  generatedAt: string;
}

export async function executeGetCampaignPerformance(
  input: GetCampaignPerformanceInput,
  ctx: ToolContext,
): Promise<CampaignPerformanceOutput> {
  const generatedAt = new Date().toISOString();
  try {
    const filter: Record<string, unknown> = { restaurantId: oid(ctx.tenant.restaurantId) };
    if (input.offerId) filter.offerId = oid(input.offerId);
    const rows = await CampaignHistory.find(filter)
      .sort({ sentDate: -1, createdAt: -1 })
      .limit(input.limit ?? 25)
      .select('offerId channel recipientCount openedCount redeemedCount campaignCost status sentDate')
      .lean()
      .exec();
    if (rows.length === 0) {
      return { available: false, reason: 'NO_CAMPAIGN_HISTORY', generatedAt };
    }
    return {
      available: true,
      campaigns: rows.map((c: any) => ({
        id: String(c._id),
        offerId: c.offerId ? String(c.offerId) : null,
        channel: c.channel,
        recipientCount: c.recipientCount ?? 0,
        openedCount: c.openedCount ?? 0,
        redeemedCount: c.redeemedCount ?? 0,
        campaignCost: c.campaignCost ?? 0,
        status: c.status,
        sentDate: c.sentDate,
      })),
      generatedAt,
    };
  } catch {
    return { available: false, reason: 'NO_CAMPAIGN_HISTORY', generatedAt };
  }
}

export const getCampaignPerformanceToolDefinition: ToolDefinition<GetCampaignPerformanceInput, CampaignPerformanceOutput> = {
  name: 'getCampaignPerformance',
  category: 'marketing',
  access: 'read',
  meta: {
    description:
      'Past campaign deliveries per channel: recipients, opens, redemptions, cost, status and send date — the real outcome record used for feedback.',
    source: 'models/marketing/CampaignHistory (same query the campaign-history endpoint uses)',
  },
  inputSchema: getCampaignPerformanceInputSchema,
  execute: executeGetCampaignPerformance,
};

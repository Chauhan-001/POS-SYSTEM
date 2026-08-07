/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Admin CRM Controller — Platform-console visibility into a restaurant's
 * Customer Management + Loyalty + CRM data (Phase 1.6).
 *
 * These endpoints are READ-ONLY and admin-authenticated (requireAuth +
 * requireCollectionAccess). They delegate to the same Phase 1.6 services the
 * POS uses, passing the target restaurantId from the URL — so the platform
 * console sees exactly what the restaurant sees, with the same multi-tenant
 * scoping the restaurant's own APIs enforce.
 *
 * Data sources:
 *   - customerReportService.getReport()   → full CRM analytics bundle
 *   - customerService.list()              → paged customer search
 *   - loyaltyService.getSettings()        → loyalty engine config
 *   - loyaltyService.listTiers()          → tier configuration
 *   - campaignService.list()              → campaign list
 *   - referralService.list()              → referral list
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Offer from '../models/Offer';
import Reward from '../models/Reward';
import {
  customerReportService, customerService, loyaltyService,
  campaignService, referralService,
} from '../services';

function handleError(res: Response, error: unknown, label: string): void {
  console.error(`[AdminCrm] ${label} error:`, error);
  res.status(500).json({ message: 'Internal server error' });
}

/**
 * GET /api/admin/restaurants/:id/crm/overview
 * High-level CRM snapshot for the platform console: report bundle + loyalty
 * settings + tiers + campaigns + referrals (all restaurant-scoped).
 */
export async function getCrmOverview(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = req.params.id;
    const [report, settings, tiers, campaigns, referrals] = await Promise.all([
      customerReportService.getReport(restaurantId, { limit: 100 }),
      loyaltyService.getSettings(restaurantId),
      loyaltyService.listTiers(restaurantId),
      campaignService.list(restaurantId, { page: 1, limit: 10 }),
      referralService.list(restaurantId, { page: 1, limit: 10 }),
    ]);

    res.json({
      data: {
        summary: report.summary,
        tierDistribution: report.tierDistribution,
        segmentDistribution: report.segmentDistribution,
        topCustomers: report.topCustomers?.slice(0, 10) || [],
        growth: report.growth,
        settings,
        tiers,
        campaigns: {
          total: campaigns.total,
          recent: campaigns.data?.slice(0, 5) || [],
        },
        referrals: {
          total: referrals.total,
          recent: referrals.data?.slice(0, 5) || [],
        },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) { handleError(res, error, 'getCrmOverview'); }
}

/**
 * GET /api/admin/restaurants/:id/crm/customers?page=&limit=&search=&tier=&status=
 * Paged customer directory for a restaurant (same search semantics as POS).
 */
export async function getCrmCustomers(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = req.params.id;
    const result = await customerService.list(restaurantId, {
      search: req.query.search as string,
      phone: req.query.phone as string,
      email: req.query.email as string,
      gstNumber: req.query.gstNumber as string,
      referralCode: req.query.referralCode as string,
      tag: req.query.tag as string,
      tier: req.query.tier as string,
      status: req.query.status as string,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      sortBy: req.query.sortBy as string,
      sortDir: req.query.sortDir as string,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'getCrmCustomers'); }
}

/** GET /api/admin/restaurants/:id/crm/loyalty-settings */
export async function getCrmLoyaltySettings(req: Request, res: Response): Promise<void> {
  try {
    const settings = await loyaltyService.getSettings(req.params.id);
    res.json({ data: settings });
  } catch (error) { handleError(res, error, 'getCrmLoyaltySettings'); }
}

/** GET /api/admin/restaurants/:id/crm/tiers */
export async function getCrmTiers(req: Request, res: Response): Promise<void> {
  try {
    const tiers = await loyaltyService.listTiers(req.params.id);
    res.json({ data: tiers });
  } catch (error) { handleError(res, error, 'getCrmTiers'); }
}

/** GET /api/admin/restaurants/:id/crm/campaigns?page=&limit= */
export async function getCrmCampaigns(req: Request, res: Response): Promise<void> {
  try {
    const result = await campaignService.list(req.params.id, {
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      status: req.query.status as string,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'getCrmCampaigns'); }
}

/** GET /api/admin/restaurants/:id/crm/referrals?page=&limit= */
export async function getCrmReferrals(req: Request, res: Response): Promise<void> {
  try {
    const result = await referralService.list(req.params.id, {
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      status: req.query.status as string,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'getCrmReferrals'); }
}

/** GET /api/admin/restaurants/:id/crm/report — Full report bundle (JSON). */
export async function getCrmReport(req: Request, res: Response): Promise<void> {
  try {
    const report = await customerReportService.getReport(req.params.id, {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ data: report });
  } catch (error) { handleError(res, error, 'getCrmReport'); }
}

/** GET /api/admin/restaurants/:id/crm/offers — Active offers for a restaurant. */
export async function getCrmOffers(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = req.params.id;
    const offers = await Offer.find({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isDeleted: { $ne: true },
    }).sort({ sortOrder: 1 }).limit(100).lean().exec();
    res.json({
      data: offers.map((o: any) => ({
        id: o._id.toString(),
        title: o.title,
        description: o.description,
        type: o.type,
        value: o.value,
        couponCode: o.couponCode,
        minOrderValue: o.minOrderValue,
        status: o.status,
        startDate: o.startDate,
        endDate: o.endDate,
        currentUses: o.currentUses,
        maxUses: o.maxUses,
      })),
    });
  } catch (error) { handleError(res, error, 'getCrmOffers'); }
}

/** GET /api/admin/restaurants/:id/crm/rewards — Reward catalog for a restaurant. */
export async function getCrmRewards(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = req.params.id;
    const rewards = await Reward.find({
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isDeleted: { $ne: true },
    }).sort({ pointsRequired: 1 }).limit(100).lean().exec();
    res.json({
      data: rewards.map((r: any) => ({
        id: r._id.toString(),
        title: r.title,
        pointsRequired: r.pointsRequired,
        type: r.type,
        value: r.value,
        minBillAmount: r.minBillAmount,
        isLargeReward: r.isLargeReward,
        stock: r.stock,
        isActive: r.isActive,
        redeemedCount: r.redeemedCount,
      })),
    });
  } catch (error) { handleError(res, error, 'getCrmRewards'); }
}

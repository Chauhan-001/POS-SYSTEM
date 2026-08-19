/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offers Controller — Handles CRUD operations for offers,
 * recommendation generation, segment management, and analytics.
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import OfferModel from '../models/Offer';
import OfferAnalyticsModel from '../models/OfferAnalytics';
import CustomerSegmentModel from '../models/CustomerSegment';
import CampaignHistoryModel from '../models/CampaignHistory';
import CustomerModel from '../models/Customer';
import { generateRecommendations } from '../services/offerEngine';
import { updateAllSegments, getSegments, getSegmentById } from '../services/segmentEngine';
import { getUpcomingFestivals, isFestivalSeason } from '../services/festivalService';
import { offerValidationService } from '../services';
import { buildRecommendationContext, resolveBranchScope } from '../services/recommendationContext';
import { getComboHealth } from '../services/comboHealthService';
import {
  aggregateAndBackfill,
  getAnalyticsSummary,
  getAnalyticsTrend,
  getOfferPerformance,
  getComboAnalytics,
  rankCombos,
  assertValidWindow,
} from '../services/offerAnalyticsService';
import { round2 } from '../modules/recipes/services/unitConversion';
import { AppError } from '../utils/AppError';
import { audit } from '../utils/audit';
import { OFFER_TRANSITIONS, canTransition } from '../constants/marketingStates';

// Helper to get restaurant ID from the authenticated user ONLY.
// Tenant identity is always derived server-side from the JWT (req.user), never
// trusted from client-supplied body/query fields.
function getRestaurantId(req: Request): string {
  return String((req as any).user?.restaurantId || '');
}

// ─── OFFER CRUD ───────────────────────────────────────────────

export async function listOffers(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    const { status, type, page = '1', limit = '50' } = req.query;
    const filter: any = { restaurantId: new mongoose.Types.ObjectId(restaurantId), isDeleted: { $ne: true } };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const [offers, total] = await Promise.all([
      OfferModel.find(filter).sort({ sortOrder: 1, createdAt: -1 }).skip(skip).limit(parseInt(limit as string)).lean(),
      OfferModel.countDocuments(filter),
    ]);

    res.json({ offers, total, page: parseInt(page as string), limit: parseInt(limit as string) });
  } catch (error: any) {
    console.error('[Offers] list error:', error.message);
    res.status(500).json({ error: 'Failed to list offers' });
  }
}

export async function getOffer(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    const offer = await OfferModel.findOne({
      _id: req.params.id,
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isDeleted: { $ne: true },
    }).lean();
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return; }
    res.json(offer);
  } catch (error: any) {
    console.error('[Offers] get error:', error.message);
    res.status(500).json({ error: 'Failed to get offer' });
  }
}

export async function createOffer(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    const data = { ...req.body, restaurantId: new mongoose.Types.ObjectId(restaurantId) };
    delete data._id;

    const offer = await OfferModel.create(data);
    await audit(req, {
      action: 'OFFER_CREATED',
      entityType: 'offer',
      entityId: (offer as any)._id.toString(),
      details: { title: offer.title, type: offer.type, status: offer.status },
    });
    res.status(201).json(offer);
  } catch (error: any) {
    console.error('[Offers] create error:', error.message);
    res.status(500).json({ error: 'Failed to create offer' });
  }
}

export async function updateOffer(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    const data = { ...req.body };
    delete data._id;
    delete data.restaurantId;

    const offer = await OfferModel.findOneAndUpdate(
      { _id: req.params.id, restaurantId: new mongoose.Types.ObjectId(restaurantId) },
      { $set: data },
      { new: true }
    );
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return; }
    await audit(req, {
      action: 'OFFER_UPDATED',
      entityType: 'offer',
      entityId: req.params.id,
      details: { title: offer.title, status: offer.status },
    });
    res.json(offer);
  } catch (error: any) {
    console.error('[Offers] update error:', error.message);
    res.status(500).json({ error: 'Failed to update offer' });
  }
}

export async function deleteOffer(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    const offer = await OfferModel.findOneAndUpdate(
      { _id: req.params.id, restaurantId: new mongoose.Types.ObjectId(restaurantId) },
      { $set: { isDeleted: true, deletedAt: new Date(), status: 'cancelled' } },
      { new: true }
    );
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return; }
    await audit(req, {
      action: 'OFFER_DELETED',
      entityType: 'offer',
      entityId: req.params.id,
      details: { title: offer.title },
    });
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Offers] delete error:', error.message);
    res.status(500).json({ error: 'Failed to delete offer' });
  }
}

export async function updateOfferStatus(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    const { status } = req.body;
    const validStatuses = ['draft', 'active', 'scheduled', 'paused', 'expired', 'cancelled'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status' }); return;
    }

    const oid = new mongoose.Types.ObjectId(restaurantId);
    const current = await OfferModel.findOne({ _id: req.params.id, restaurantId: oid, isDeleted: { $ne: true } }).lean();
    if (!current) { res.status(404).json({ error: 'Offer not found' }); return; }

    // State machine (Phase 4): reject nonsensical transitions like expired → active.
    if (!canTransition(current.status, status, OFFER_TRANSITIONS)) {
      res.status(400).json({ error: `Invalid status transition: ${current.status} → ${status}` });
      return;
    }

    const offer = await OfferModel.findOneAndUpdate(
      { _id: req.params.id, restaurantId: oid },
      { $set: { status } },
      { new: true }
    );
    if (!offer) { res.status(404).json({ error: 'Offer not found' }); return; }
    await audit(req, {
      action: 'OFFER_STATUS_CHANGED',
      entityType: 'offer',
      entityId: req.params.id,
      details: { from: current.status, to: status, title: offer.title },
    });
    res.json(offer);
  } catch (error: any) {
    console.error('[Offers] status update error:', error.message);
    res.status(500).json({ error: 'Failed to update offer status' });
  }
}

// ─── RECOMMENDATIONS ──────────────────────────────────────────

/**
 * GET/POST /api/offers/recommendations — deterministic offer suggestions.
 *
 * Phase 1: the canonical RecommendationContext is built server-side by the
 * shared builder (same context the AI path consumes). The client may only
 * contribute WEATHER (advisory) and fallback inventory/sales when the server
 * has nothing to read — never financial truth. Everything is tenant-scoped.
 */
export async function getRecommendations(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    // Recommended-card ceiling: default 10, min 5, max 30. The engine is
    // designed to produce 10+ distinct suggestions when context is available.
    const requested = Number(req.body?.limit ?? req.query?.limit ?? 10);
    const maxSuggestions = Number.isFinite(requested) ? Math.min(30, Math.max(5, Math.round(requested))) : 10;

    // Phase 9 — optional branch scope. A branchId that does not belong to this
    // restaurant is rejected (never silently aggregated, never cross-tenant).
    let branchScope: { branchId?: string; branchName?: string } | null = {};
    if (req.body?.branchId || req.query?.branchId) {
      branchScope = await resolveBranchScope(String(restaurantId), String(req.body?.branchId || req.query?.branchId));
      if (!branchScope) { res.status(400).json({ error: 'Branch not found for this restaurant' }); return; }
    }

    const ctx = await buildRecommendationContext(String(restaurantId), {
      analyticsFrom: req.body.analyticsFrom || undefined,
      analyticsTo: req.body.analyticsTo || undefined,
      branchId: branchScope.branchId,
    });

    // Client-supplied values are ONLY fallbacks when the server has nothing
    // to read — the canonical builder always prefers its own queries.
    if (!ctx.inventory && Array.isArray(req.body.inventory)) ctx.inventory = req.body.inventory;
    if (!ctx.sales && req.body.sales) ctx.sales = req.body.sales;
    if (req.body.weather) ctx.weather = req.body.weather;

    const suggestions = await generateRecommendations(ctx, maxSuggestions);
    res.json({ suggestions, limit: maxSuggestions });
  } catch (error: any) {
    console.error('[Offers] recommendations error:', error.message);
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
}

// ─── SEGMENTS ─────────────────────────────────────────────────

// ─── COMBO HEALTH (Phase 12) ────────────────────────────────

/**
 * GET /api/offers/combo-health — deterministic combo health & rework advisory.
 * Read-only: the owner acts through the existing offer editor. Optional
 * branchId scopes the analytics window (Phase 9). Cross-tenant branch ids are
 * rejected.
 */
export async function comboHealth(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    let branchId: string | undefined;
    if (req.query?.branchId) {
      const scope = await resolveBranchScope(String(restaurantId), String(req.query.branchId));
      if (!scope) { res.status(400).json({ error: 'Branch not found for this restaurant' }); return; }
      branchId = scope.branchId;
    }
    const rows = await getComboHealth(String(restaurantId), { branchId });
    res.json({ combos: rows });
  } catch (error: any) {
    console.error('[Offers] combo-health error:', error.message);
    res.status(500).json({ error: 'Failed to generate combo health' });
  }
}

export async function listSegments(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const oid = new mongoose.Types.ObjectId(restaurantId);
    const segments = await getSegments(restaurantId);

    // Get customer details for the first segment if requested
    const { segmentId } = req.query;
    let customers: any[] = [];
    if (segmentId) {
      const segment = await getSegmentById(segmentId as string, restaurantId);
      if (segment && segment.customerPhones.length > 0) {
        // Phones come from a tenant-scoped segment; still scope the lookup to
        // the restaurant so cross-tenant phone collisions can never leak.
        customers = await CustomerModel.find({
          restaurantId: oid,
          phone: { $in: segment.customerPhones },
          isDeleted: { $ne: true },
        }).limit(50).lean();
      }
    }

    res.json({ segments, customers });
  } catch (error: any) {
    console.error('[Offers] segments error:', error.message);
    res.status(500).json({ error: 'Failed to list segments' });
  }
}

export async function refreshSegments(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    await updateAllSegments(restaurantId);
    const segments = await getSegments(restaurantId);
    res.json({ segments, success: true });
  } catch (error: any) {
    console.error('[Offers] refresh segments error:', error.message);
    res.status(500).json({ error: 'Failed to refresh segments' });
  }
}

// ─── ANALYTICS (Phase B — real performance from OfferAnalytics) ──

/**
 * Build a tenant-scoped analytics window from the request. Every filter is
 * validated; restaurantId ALWAYS comes from the JWT (req.user), never from
 * query/body.
 */
function analyticsWindow(req: Request, offerId?: string) {
  const restaurantId = getRestaurantId(req);
  const { from, to, branchId } = req.query;
  const window: any = { restaurantId };
  if (offerId) window.offerId = offerId;
  if (branchId) window.branchId = String(branchId);
  if (from) window.from = String(from);
  if (to) window.to = String(to);
  return window;
}

/**
 * GET /api/offers/analytics (or /:offerId) — snapshot rows + rolled-up
 * per-offer performance + summary + daily trend. Date range / branch filters
 * supported. Only real OfferAnalytics rows are ever returned; when there is
 * no data the arrays are empty and the summary says so (never fabricated).
 */
export async function getOfferAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const { offerId } = req.params;
    const oid = new mongoose.Types.ObjectId(restaurantId);

    const window = analyticsWindow(req, offerId);
    assertValidWindow(window);

    const [performance, trend, combos, snapshotFilter] = await Promise.all([
      getOfferPerformance(window),
      getAnalyticsTrend(window),
      getComboAnalytics(window),
      (async () => {
        const filter: any = { restaurantId: oid };
        if (offerId) filter.offerId = new mongoose.Types.ObjectId(offerId);
        if (window.branchId) filter.branchId = new mongoose.Types.ObjectId(window.branchId);
        if (window.from || window.to) {
          filter.snapshotDate = {};
          if (window.from) filter.snapshotDate.$gte = window.from;
          if (window.to) filter.snapshotDate.$lte = window.to;
        }
        return OfferAnalyticsModel.find(filter).sort({ snapshotDate: -1 }).limit(90).lean();
      })(),
    ]);

    const summary = await getAnalyticsSummary(window);
    const [totalOffers, activeOffers] = await Promise.all([
      OfferModel.countDocuments({ restaurantId: oid, isDeleted: { $ne: true } }),
      OfferModel.countDocuments({ restaurantId: oid, status: 'active', isDeleted: { $ne: true } }),
    ]);

    // P2 — combo totals + rankings (deterministic; empty array when the tenant
    // has no combo redemptions — never fabricated).
    const comboSummary = combos.reduce(
      (acc, c) => {
        acc.orders += c.orders;
        acc.units += c.units;
        acc.revenue = round2(acc.revenue + c.comboRevenue);
        acc.discount = round2(acc.discount + c.structuralSavings + c.additionalDiscount);
        acc.variableCost = round2(acc.variableCost + c.variableCost);
        acc.contribution = round2(acc.contribution + c.contribution);
        return acc;
      },
      { combos: combos.length, orders: 0, units: 0, revenue: 0, discount: 0, variableCost: 0, contribution: 0 },
    );

    res.json({
      analytics: snapshotFilter as any[],
      performance,
      trend,
      combos,
      comboSummary,
      comboRankings: rankCombos(combos),
      summary: {
        ...summary,
        totalOffers,
        activeOffers,
        // Explicitly null when the deterministic cost engine can't provide it
        // — the UI renders "Data unavailable", never a fake number.
        estimatedContribution: null,
        estimatedContributionAvailable: false,
      },
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[Offers] analytics error:', error.message);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
}

/** GET /api/offers/analytics/trends — daily redemptions/revenue/discount trend. */
export async function getOfferAnalyticsTrends(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const window = analyticsWindow(req);
    assertValidWindow(window);
    const trend = await getAnalyticsTrend(window);
    res.json({ trend });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[Offers] trends error:', error.message);
    res.status(500).json({ error: 'Failed to get analytics trend' });
  }
}

/**
 * GET /api/offers/:id/performance — full performance summary for one offer
 * (redemptions, revenue, discount, AOV, unique customers, trend).
 */
export async function getOfferPerformanceDetail(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const window = analyticsWindow(req, req.params.id);
    assertValidWindow(window);
    const performance = await getOfferPerformance(window);
    if (performance.length === 0) {
      res.json({ offerId: req.params.id, found: false, performance: null, reason: 'No analytics recorded for this offer yet' });
      return;
    }
    res.json({ offerId: req.params.id, found: true, performance: performance[0] });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[Offers] performance error:', error.message);
    res.status(500).json({ error: 'Failed to get offer performance' });
  }
}

/**
 * POST /api/offers/analytics/rebuild — deterministic rebuild of OfferAnalytics
 * snapshots straight from the authoritative CouponRedemption + Bill records.
 * Repeatable and idempotent (upsert semantics); used to populate historical
 * analytics and to re-derive after a data fix. Owner/Manager only.
 */
export async function rebuildOfferAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const { from, to, offerId, branchId } = req.body || {};
    const window: any = { restaurantId };
    if (offerId) window.offerId = offerId;
    if (branchId) window.branchId = branchId;
    if (from) window.from = String(from);
    if (to) window.to = String(to);
    assertValidWindow(window);
    const result = await aggregateAndBackfill(window);
    res.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[Offers] rebuild error:', error.message);
    res.status(500).json({ error: 'Failed to rebuild offer analytics' });
  }
}

// ─── FESTIVALS ────────────────────────────────────────────────

export async function getFestivals(req: Request, res: Response): Promise<void> {
  try {
    const maxDays = parseInt(req.query.days as string) || 30;
    const festivals = getUpcomingFestivals(maxDays);
    const current = isFestivalSeason(7);
    res.json({ festivals, currentFestival: current });
  } catch (error: any) {
    console.error('[Offers] festivals error:', error.message);
    res.status(500).json({ error: 'Failed to get festivals' });
  }
}

// ─── COUPON / OFFER VALIDATION & APPLICATION (Phase 1.6) ──────

/**
 * POST /api/offers/validate — Server-side offer/coupon validation against a
 * customer + bill. Pure validation: never mutates state.
 */
export async function validateOffer(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    const { offerId, couponCode, customerId, customerPhone, billSubtotal, billItems, branchId } = req.body;
    let customer: any;
    if (customerId) {
      customer = await CustomerModel.findOne({
        _id: customerId,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        isDeleted: { $ne: true },
      }).lean();
    } else if (customerPhone) {
      customer = await CustomerModel.findOne({
        phone: customerPhone,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        isDeleted: { $ne: true },
      }).lean();
    }

    // ── PHASE B SECURITY FIX ────────────────────────────────────────
    // Derive the authoritative subtotal from the bill's line items using
    // current server-side prices. The client's billSubtotal is only a fallback
    // when no line items are supplied (legacy callers) — with items present it
    // is IGNORED so a client can never inflate it to raise a % discount.
    let effectiveItems = Array.isArray(billItems) ? billItems : undefined;
    let effectiveSubtotal = Number(billSubtotal) || 0;
    if (Array.isArray(billItems) && billItems.length > 0) {
      const derived = await offerValidationService.deriveSubtotal(restaurantId, billItems, branchId);
      if (derived.subtotal > 0) {
        effectiveSubtotal = derived.subtotal;
        effectiveItems = derived.items;
      }
    }

    const result = await offerValidationService.validate(restaurantId, {
      offerId,
      couponCode,
      customer,
      customerPhone,
      billSubtotal: effectiveSubtotal,
      billItems: effectiveItems,
      branchId,
    });
    res.json({ ...result, subtotal: effectiveSubtotal });
  } catch (error: any) {
    console.error('[Offers] validate error:', error.message);
    res.status(500).json({ error: 'Failed to validate offer' });
  }
}

/**
 * POST /api/offers/apply — Validate AND record the application (usage ledger).
 * Returns the computed discount and the recorded redemption.
 */
export async function applyOffer(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    const { offerId, couponCode, customerId, customerPhone, billSubtotal, billItems, billId, branchId } = req.body;
    let customer: any;
    if (customerId) {
      customer = await CustomerModel.findOne({
        _id: customerId,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        isDeleted: { $ne: true },
      }).lean();
    } else if (customerPhone) {
      customer = await CustomerModel.findOne({
        phone: customerPhone,
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        isDeleted: { $ne: true },
      }).lean();
    }

    // ── PHASE B SECURITY FIX ────────────────────────────────────────
    // Same authoritative derivation as validate: with line items present the
    // client billSubtotal is ignored. The derived subtotal also feeds
    // analytics (salesAmount) so revenue is attributed from server prices.
    let effectiveItems = Array.isArray(billItems) ? billItems : undefined;
    let effectiveSubtotal = Number(billSubtotal) || 0;
    if (Array.isArray(billItems) && billItems.length > 0) {
      const derived = await offerValidationService.deriveSubtotal(restaurantId, billItems, branchId);
      if (derived.subtotal > 0) {
        effectiveSubtotal = derived.subtotal;
        effectiveItems = derived.items;
      }
    }

    const result = await offerValidationService.validate(restaurantId, {
      offerId,
      couponCode,
      customer,
      customerPhone,
      billSubtotal: effectiveSubtotal,
      billItems: effectiveItems,
      branchId,
    });
    if (!result.valid) {
      res.status(400).json({ error: result.reason || 'Offer not applicable', ...result, subtotal: effectiveSubtotal });
      return;
    }

    const redemption = await offerValidationService.recordApplication(restaurantId, {
      offerId: result.offer.id,
      code: result.offer.couponCode,
      customerId: customer?._id?.toString?.(),
      customerPhone: customer?.phone || customerPhone,
      billId,
      branchId,
      discountAmount: result.discount || 0,
      salesAmount: effectiveSubtotal,
      redeemedBy: (req as any).user?.name || 'System',
    });

    res.json({ ...result, redemption, subtotal: effectiveSubtotal });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[Offers] apply error:', error.message);
    res.status(500).json({ error: 'Failed to apply offer' });
  }
}

/**
 * GET /api/offers/lookup/:code — Resolve a coupon/promo code to its offer.
 */
export async function lookupOfferByCode(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    const offer = await offerValidationService.findOfferByCode(restaurantId, req.params.code);
    if (!offer) {
      res.status(404).json({ error: 'Coupon code not found', valid: false });
      return;
    }
    res.json({ data: offer, valid: true });
  } catch (error: any) {
    console.error('[Offers] lookup error:', error.message);
    res.status(500).json({ error: 'Failed to look up coupon code' });
  }
}

// ─── CAMPAIGN HISTORY ─────────────────────────────────────────

export async function getCampaignHistory(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    const { offerId } = req.query;
    const filter: any = { restaurantId: new mongoose.Types.ObjectId(restaurantId) };
    if (offerId) filter.offerId = new mongoose.Types.ObjectId(offerId as string);

    const history = await CampaignHistoryModel.find(filter)
      .sort({ sentDate: -1 })
      .limit(50)
      .lean();
    res.json({ history });
  } catch (error: any) {
    console.error('[Offers] campaign error:', error.message);
    res.status(500).json({ error: 'Failed to get campaign history' });
  }
}

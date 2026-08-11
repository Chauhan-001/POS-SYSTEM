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
import ProductModel from '../models/Product';
import { generateRecommendations, type RecommendationContext } from '../services/offerEngine';
import { updateAllSegments, getSegments, getSegmentById } from '../services/segmentEngine';
import { getUpcomingFestivals, isFestivalSeason } from '../services/festivalService';
import { offerValidationService } from '../services';
import { resolveMenuProductScope } from '../services/productService';
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

export async function getRecommendations(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    // Gather context data
    const oid = new mongoose.Types.ObjectId(restaurantId);

    // TENANT ISOLATION (Phase 1): every query is scoped to the authenticated
    // restaurant. Products are this restaurant's own menu only (shared/global
    // catalog only as a fresh-account fallback), so recommendations never
    // suggest items the restaurant doesn't sell. Customers are strictly
    // scoped — cross-tenant customer data must never reach a recommendation.
    const productScope = await resolveMenuProductScope(String(restaurantId));
    const [products, customerCount, activeCustomers] = await Promise.all([
      ProductModel.find({ $or: productScope, isDeleted: { $ne: true } }).lean(),
      CustomerModel.countDocuments({ restaurantId: oid, isDeleted: { $ne: true } }),
      CustomerModel.countDocuments({ restaurantId: oid, isDeleted: { $ne: true }, visits: { $gte: 1 } }),
    ]);

    // Get today's new customers
    const today = new Date().toISOString().split('T')[0];
    const newCustomersToday = await CustomerModel.countDocuments({
      restaurantId: oid,
      isDeleted: { $ne: true },
      createdAt: { $gte: new Date(today) },
    });

    const ctx: RecommendationContext = {
      restaurantId,
      products: products.map(p => ({
        id: p._id.toString(),
        name: p.name,
        category: p.category,
        price: p.price,
        gstPercent: p.gstPercent,
      })),
      customerCount,
      activeCustomers,
      newCustomersToday,
      repeatCustomersToday: activeCustomers - newCustomersToday,
      // Weather from request body (or fetch from weather service)
      weather: req.body.weather || undefined,
      inventory: req.body.inventory || undefined,
      sales: req.body.sales || undefined,
    };

    const suggestions = await generateRecommendations(ctx);
    res.json({ suggestions });
  } catch (error: any) {
    console.error('[Offers] recommendations error:', error.message);
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
}

// ─── SEGMENTS ─────────────────────────────────────────────────

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

// ─── ANALYTICS ────────────────────────────────────────────────

export async function getOfferAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    const { offerId } = req.params;
    const oid = new mongoose.Types.ObjectId(restaurantId);

    const analytics = await OfferAnalyticsModel.find({
      ...(offerId ? { offerId: new mongoose.Types.ObjectId(offerId) } : {}),
      restaurantId: oid,
    }).sort({ snapshotDate: -1 }).limit(30).lean();

    // Get summary stats
    const totalOffers = await OfferModel.countDocuments({
      restaurantId: oid,
      isDeleted: { $ne: true },
    });
    const activeOffers = await OfferModel.countDocuments({
      restaurantId: oid,
      status: 'active',
      isDeleted: { $ne: true },
    });
    const totalRedeemed = analytics.reduce((sum, a) => sum + a.redeemed, 0);
    const totalRevenue = analytics.reduce((sum, a) => sum + a.revenueGenerated, 0);

    res.json({
      analytics,
      summary: {
        totalOffers,
        activeOffers,
        totalRedeemed,
        totalRevenue,
      },
    });
  } catch (error: any) {
    console.error('[Offers] analytics error:', error.message);
    res.status(500).json({ error: 'Failed to get analytics' });
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

    const result = await offerValidationService.validate(restaurantId, {
      offerId,
      couponCode,
      customer,
      customerPhone,
      billSubtotal,
      billItems,
      branchId,
    });
    res.json(result);
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

    const result = await offerValidationService.validate(restaurantId, {
      offerId,
      couponCode,
      customer,
      customerPhone,
      billSubtotal,
      billItems,
      branchId,
    });
    if (!result.valid) {
      res.status(400).json({ error: result.reason || 'Offer not applicable', ...result });
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
      redeemedBy: (req as any).user?.name || 'System',
    });

    res.json({ ...result, redemption });
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

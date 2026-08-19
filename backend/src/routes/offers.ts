/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offers API Routes — Full Offer Management System endpoints.
 * All routes require authentication.
 * Offer CRUD requires Owner/Manager role.
 * Read-only operations accessible to all staff with offers permission.
 */

import { Router } from 'express';
import {
  listOffers,
  getOffer,
  createOffer,
  updateOffer,
  deleteOffer,
  updateOfferStatus,
  getRecommendations,
  comboHealth,
  listSegments,
  refreshSegments,
  getOfferAnalytics,
  getOfferAnalyticsTrends,
  getOfferPerformanceDetail,
  rebuildOfferAnalytics,
  getFestivals,
  getCampaignHistory,
  validateOffer,
  applyOffer,
  lookupOfferByCode,
} from '../controllers/offersController';
import responseCache, { cached } from '../utils/ResponseCache';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import {
  createOfferSchema,
  updateOfferSchema,
  offerQuerySchema,
  offerParamsSchema,
  updateOfferStatusSchema,
} from '../validation/offer';

const router = Router();

// ─── Coupon / offer validation (Phase 1.6, all staff) ────────
router.post('/offers/validate', requireAuth, requireFeature('loyalty'), validateOffer);
router.post('/offers/apply', requireAuth, requireFeature('loyalty'), applyOffer);
router.get('/offers/lookup/:code', requireAuth, requireFeature('loyalty'), lookupOfferByCode);

// ─── Recommendations (read-only, all staff) ──────────────────
router.post('/offers/recommendations',
  requireAuth,
  requireFeature('loyalty'),
  getRecommendations,
);

// ─── Combo health (Phase 12, read-only advisory) ─────────────
router.get('/offers/combo-health',
  requireAuth,
  requireFeature('loyalty'),
  comboHealth,
);

// ─── Segments (read-only + refresh) ──────────────────────────
router.get('/offers/segments',
  requireAuth,
  requireFeature('loyalty'),
  listSegments,
);

router.post('/offers/segments/refresh',
  requireAuth,
  requireFeature('loyalty'),
  refreshSegments,
);

// ─── Festivals (read-only, same for all users, changes rarely) ─────
router.get('/offers/festivals',
  requireAuth,
  requireFeature('loyalty'),
  cached({ ttlMs: 3600_000, tags: ['festivals'] }),
  getFestivals,
);

// ─── Campaign History ────────────────────────────────────────
router.get('/offers/campaigns',
  requireAuth,
  requireFeature('loyalty'),
  getCampaignHistory,
);

// ─── Analytics (Phase B — real performance; trends + rebuild) ──
router.get('/offers/analytics',
  requireAuth,
  requireFeature('loyalty'),
  getOfferAnalytics,
);

// MUST be registered before /offers/analytics/:offerId (Express matches in order).
router.get('/offers/analytics/trends',
  requireAuth,
  requireFeature('loyalty'),
  getOfferAnalyticsTrends,
);

// Deterministic rebuild from CouponRedemption + Bill (historical backfill).
router.post('/offers/analytics/rebuild',
  requireRole('Owner', 'Manager'),
  requireFeature('loyalty'),
  rebuildOfferAnalytics,
);

router.get('/offers/analytics/:offerId',
  requireAuth,
  requireFeature('loyalty'),
  getOfferAnalytics,
);

// Per-offer performance detail.
router.get('/offers/:id/performance',
  requireAuth,
  requireFeature('loyalty'),
  getOfferPerformanceDetail,
);

// ─── Offer CRUD (write requires Owner/Manager) ───────────────
router.get('/offers',
  requireAuth,
  requireFeature('loyalty'),
  validate({ query: offerQuerySchema }),
  listOffers,
);

router.get('/offers/:id',
  requireAuth,
  requireFeature('loyalty'),
  validate({ params: offerParamsSchema }),
  getOffer,
);

router.post('/offers',
  requireRole('Owner', 'Manager'),
  requireFeature('loyalty'),
  validate({ body: createOfferSchema }),
  // Public offer discovery cache must not serve stale/leaked offers.
  (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void responseCache.invalidateByTags(['public-offers']);
      }
    });
    next();
  },
  createOffer,
);

router.put('/offers/:id',
  requireRole('Owner', 'Manager'),
  requireFeature('loyalty'),
  validate({ body: updateOfferSchema, params: offerParamsSchema }),
  (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void responseCache.invalidateByTags(['public-offers']);
      }
    });
    next();
  },
  updateOffer,
);

router.delete('/offers/:id',
  requireRole('Owner', 'Manager'),
  requireFeature('loyalty'),
  validate({ params: offerParamsSchema }),
  (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void responseCache.invalidateByTags(['public-offers']);
      }
    });
    next();
  },
  deleteOffer,
);

// ─── Status Transitions (Owner/Manager only) ─────────────────
router.patch('/offers/:id/status',
  requireRole('Owner', 'Manager'),
  requireFeature('loyalty'),
  validate({ body: updateOfferStatusSchema, params: offerParamsSchema }),
  (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void responseCache.invalidateByTags(['public-offers']);
      }
    });
    next();
  },
  updateOfferStatus,
);

export default router;

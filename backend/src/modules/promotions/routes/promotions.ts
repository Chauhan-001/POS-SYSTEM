/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Promotion Routes — Promotion Studio API. All routes require authentication;
 * tenant scope always comes from the JWT.
 *
 *   POST   /api/promotions                    — create a promotion (draft)
 *   GET    /api/promotions                    — list (status filter, paginated)
 *   GET    /api/promotions/:id                — single promotion + linked offer
 *   PATCH  /api/promotions/:id                — update creative/config
 *   POST   /api/promotions/:id/publish        — publish (requires live offer)
 *   POST   /api/promotions/:id/archive        — archive
 *   POST   /api/promotions/:id/restore        — restore archived → draft
 *   POST   /api/promotions/:id/duplicate      — duplicate creative config
 *   GET    /api/promotions/:id/mismatch       — offer/creative consistency check
 *   POST   /api/promotions/ai/copy            — AI creative copy (sanitized)
 *   POST   /api/promotions/media              — image upload (existing media module)
 *   GET    /api/promotions/offers/:offerId/images — product images for an offer
 */

import { Router } from 'express';
import { requireAuth } from '../../../middleware/authMiddleware';
import { validate } from '../../../middleware/validate';
import { restaurantImageUpload } from '../../media/multerConfig';
import {
  listPromotions, getPromotion, createPromotion, updatePromotion,
  publishPromotion, archivePromotion, restorePromotion, duplicatePromotion,
  checkPromotionMismatch, generateCopy, getOfferProductImages, uploadPromotionMedia,
  getRestaurantBranding,
} from '../controllers/promotionsController';
import {
  createPromotionSchema, updatePromotionSchema, promotionParamsSchema,
  promotionQuerySchema, promotionAiCopySchema, promotionMediaSchema,
} from '../validators/promotions';

const router = Router();

// Route order matters: static paths BEFORE :id params.
router.get('/promotions/branding', requireAuth, getRestaurantBranding);
router.post('/promotions/ai/copy', requireAuth, validate({ body: promotionAiCopySchema }), generateCopy);
router.post('/promotions/media', requireAuth, validate({ body: promotionMediaSchema }), restaurantImageUpload.single('file'), uploadPromotionMedia);
router.get('/promotions/offers/:offerId/images', requireAuth, getOfferProductImages);

router.get('/promotions', requireAuth, validate({ query: promotionQuerySchema }), listPromotions);
router.post('/promotions', requireAuth, validate({ body: createPromotionSchema }), createPromotion);
router.get('/promotions/:id', requireAuth, validate({ params: promotionParamsSchema }), getPromotion);
router.patch('/promotions/:id', requireAuth, validate({ params: promotionParamsSchema, body: updatePromotionSchema }), updatePromotion);
router.post('/promotions/:id/publish', requireAuth, validate({ params: promotionParamsSchema }), publishPromotion);
router.post('/promotions/:id/archive', requireAuth, validate({ params: promotionParamsSchema }), archivePromotion);
router.post('/promotions/:id/restore', requireAuth, validate({ params: promotionParamsSchema }), restorePromotion);
router.post('/promotions/:id/duplicate', requireAuth, validate({ params: promotionParamsSchema }), duplicatePromotion);
router.get('/promotions/:id/mismatch', requireAuth, validate({ params: promotionParamsSchema }), checkPromotionMismatch);

export default router;

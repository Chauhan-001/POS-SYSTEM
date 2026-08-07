/**
 * =============================================================================
 *  referrals.ts — Referral API Routes (Phase 1.6)
 * =============================================================================
 *
 * Routes: Referral registration, validation, completion and analytics.
 * Access: All staff (validate/register), Owner/Manager (complete).
 * Path:   /api/referrals
 */

import { Router } from 'express';
import {
  listReferrals, validateReferral, createReferral, completeReferral, getReferralAnalytics,
} from '../controllers/referralController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { createReferralSchema, referralQuerySchema, referralParamsSchema } from '../validation';

const router = Router();

// Analytics (all staff) — declared before :id routes
router.get('/analytics', requireAuth, requireFeature('loyalty'), getReferralAnalytics);

// Validate a code (all staff)
router.get('/validate', requireAuth, requireFeature('loyalty'), validateReferral);

// List (all staff, paged)
router.get('/', requireAuth, requireFeature('loyalty'), validate({ query: referralQuerySchema }), listReferrals);

// Register a referral (all staff)
router.post('/', requireAuth, requireFeature('loyalty'), validate({ body: createReferralSchema }), createReferral);

// Complete + issue rewards (Owner/Manager)
router.post('/:id/complete', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ params: referralParamsSchema }), completeReferral);

export default router;

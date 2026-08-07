/**
 * =============================================================================
 *  loyalty.ts — Loyalty Engine API Routes (Phase 1.6)
 * =============================================================================
 *
 * Routes: Settings, tier configuration, point redemption (OTP-verified for
 *         large rewards), wallet, adjustments and the expiry engine.
 * Access: Settings/tiers — Owner/Manager. Redemption — all staff.
 * Path:   /api/loyalty
 * Server-authoritative: every mutation is validated and recorded server-side.
 */

import { Router } from 'express';
import {
  getSettings, updateSettings,
  listTiers, createTier, updateTier, deleteTier,
  redeemPoints, redeemReward, adjustPoints,
  creditWallet, debitWallet, runExpiry, getTransactions,
} from '../controllers/loyaltyController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import {
  updateLoyaltySettingsSchema, createLoyaltyTierSchema, updateLoyaltyTierSchema,
  loyaltyParamsSchema, redeemPointsSchema, redeemRewardSchema, adjustPointsSchema,
  walletCreditSchema,
} from '../validation';

const router = Router();

// ─── Settings (Owner/Manager) ─────────────────────────────────
router.get('/settings', requireAuth, requireFeature('loyalty'), getSettings);
router.put('/settings', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: updateLoyaltySettingsSchema }), updateSettings);

// ─── Tiers (Owner/Manager) ────────────────────────────────────
router.get('/tiers', requireAuth, requireFeature('loyalty'), listTiers);
router.post('/tiers', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: createLoyaltyTierSchema }), createTier);
router.put('/tiers/:id', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: updateLoyaltyTierSchema, params: loyaltyParamsSchema }), updateTier);
router.delete('/tiers/:id', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ params: loyaltyParamsSchema }), deleteTier);

// ─── Expiry engine (Owner/Manager) ────────────────────────────
router.post('/expiry/run', requireRole('Owner', 'Manager'), requireFeature('loyalty'), runExpiry);

// ─── Customer loyalty operations (all staff) ──────────────────
router.get('/customers/:id/transactions', requireAuth, requireFeature('loyalty'), validate({ params: loyaltyParamsSchema }), getTransactions);
router.post('/customers/:id/redeem', requireAuth, requireFeature('loyalty'), validate({ body: redeemPointsSchema, params: loyaltyParamsSchema }), redeemPoints);
router.post('/customers/:id/redeem-reward', requireAuth, requireFeature('loyalty'), validate({ body: redeemRewardSchema, params: loyaltyParamsSchema }), redeemReward);
router.post('/customers/:id/adjust', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: adjustPointsSchema, params: loyaltyParamsSchema }), adjustPoints);
router.post('/customers/:id/wallet/credit', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: walletCreditSchema, params: loyaltyParamsSchema }), creditWallet);
router.post('/customers/:id/wallet/debit', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: walletCreditSchema, params: loyaltyParamsSchema }), debitWallet);

export default router;

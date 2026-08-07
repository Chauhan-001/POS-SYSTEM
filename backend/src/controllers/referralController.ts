/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Referral Controller — Referral program endpoints (Phase 1.6).
 */

import { Request, Response } from 'express';
import { referralService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../utils/AppError';

function userOf(req: Request): AuthenticatedRequest['user'] {
  return (req as AuthenticatedRequest).user;
}

/** GET /api/referrals — List referrals (paged). */
export async function listReferrals(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { page, limit, status } = req.query;
    const result = await referralService.list(auth?.restaurantId || '', {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status: status as string,
    });
    res.json(result);
  } catch (error) {
    console.error('[ReferralController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/referrals/validate?code= — Resolve a referral code. */
export async function validateReferral(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const code = req.query.code as string;
    if (!code) {
      res.status(400).json({ error: 'code query parameter required' });
      return;
    }
    const referrer = await referralService.resolveCode(auth?.restaurantId || '', code);
    if (!referrer) {
      res.status(404).json({ error: 'Referral code not found', valid: false });
      return;
    }
    res.json({ data: referrer, valid: true });
  } catch (error) {
    console.error('[ReferralController] validate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/referrals — Register a referral (referee claims a code). */
export async function createReferral(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await referralService.createReferral(auth?.restaurantId || '', req.body, { operator: auth?.name });
    res.status(201).json({ data: result });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[ReferralController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/referrals/:id/complete — Mark complete + issue rewards (idempotent). */
export async function completeReferral(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await referralService.completeReferral(auth?.restaurantId || '', req.params.id, { operator: auth?.name });
    if (!result) {
      res.status(404).json({ error: 'Referral not found' });
      return;
    }
    res.json({ data: result });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[ReferralController] complete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/referrals/analytics — Referral performance summary. */
export async function getReferralAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const analytics = await referralService.getAnalytics(auth?.restaurantId || '');
    res.json({ data: analytics });
  } catch (error) {
    console.error('[ReferralController] analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

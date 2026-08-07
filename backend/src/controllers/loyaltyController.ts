/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Loyalty Controller — Server-authoritative loyalty endpoints (Phase 1.6).
 * Settings, tiers, point redemption (OTP-verified for large rewards), wallet,
 * adjustments and the expiry engine. All numbers are computed server-side.
 */

import { Request, Response } from 'express';
import { loyaltyService, otpService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../utils/AppError';
import Reward from '../models/Reward';
import Customer from '../models/Customer';

function userOf(req: Request): AuthenticatedRequest['user'] {
  return (req as AuthenticatedRequest).user;
}

function handleError(res: Response, error: unknown, label: string): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error(`[LoyaltyController] ${label} error:`, error);
  res.status(500).json({ error: 'Internal server error' });
}

// ─── Settings ─────────────────────────────────────────────────

export async function getSettings(req: Request, res: Response): Promise<void> {
  try {
    const settings = await loyaltyService.getSettings(userOf(req)?.restaurantId || '');
    res.json({ data: settings });
  } catch (error) { handleError(res, error, 'getSettings'); }
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  try {
    const settings = await loyaltyService.updateSettings(userOf(req)?.restaurantId || '', req.body, { operator: userOf(req)?.name });
    res.json({ data: settings });
  } catch (error) { handleError(res, error, 'updateSettings'); }
}

// ─── Tiers ────────────────────────────────────────────────────

export async function listTiers(req: Request, res: Response): Promise<void> {
  try {
    const tiers = await loyaltyService.listTiers(userOf(req)?.restaurantId || '');
    res.json({ data: tiers });
  } catch (error) { handleError(res, error, 'listTiers'); }
}

export async function createTier(req: Request, res: Response): Promise<void> {
  try {
    const tier = await loyaltyService.createTier(userOf(req)?.restaurantId || '', req.body, { operator: userOf(req)?.name });
    res.status(201).json({ data: tier });
  } catch (error) { handleError(res, error, 'createTier'); }
}

export async function updateTier(req: Request, res: Response): Promise<void> {
  try {
    const tier = await loyaltyService.updateTier(userOf(req)?.restaurantId || '', req.params.id, req.body, { operator: userOf(req)?.name });
    res.json({ data: tier });
  } catch (error) { handleError(res, error, 'updateTier'); }
}

export async function deleteTier(req: Request, res: Response): Promise<void> {
  try {
    await loyaltyService.deleteTier(userOf(req)?.restaurantId || '', req.params.id, { operator: userOf(req)?.name });
    res.json({ success: true });
  } catch (error) { handleError(res, error, 'deleteTier'); }
}

// ─── Redemption ───────────────────────────────────────────────

/** POST /api/loyalty/customers/:id/redeem — Redeem N points (legacy flow). */
export async function redeemPoints(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { points, description, refType, refId } = req.body;
    const result = await loyaltyService.redeemPoints(auth?.restaurantId || '', req.params.id, Number(points), {
      description,
      refType,
      refId,
      branchId: auth?.branchIds?.[0],
      createdBy: auth?.name,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'redeemPoints'); }
}

/**
 * POST /api/loyalty/customers/:id/redeem-reward
 * Redeem a catalog reward. Large rewards require a verified OTP (the client
 * requests + verifies via /api/otp first and passes the code here).
 */
export async function redeemReward(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const restaurantId = auth?.restaurantId || '';
    const { rewardId, otpCode } = req.body;

    const reward = await Reward.findOne({ _id: rewardId, isDeleted: { $ne: true } }).lean().exec();
    if (!reward) throw new AppError(404, 'Reward not found');

    // Resolve the customer phone for OTP verification.
    const cust = await Customer.findOne({ _id: req.params.id, restaurantId }).exec();
    if (!cust) throw new AppError(404, 'Customer not found');

    let otpVerified = false;
    const isLarge = reward.isLargeReward || (reward.value || 0) >= 500;
    if (isLarge) {
      if (!otpCode) throw new AppError(400, 'OTP code required for large reward redemption');
      otpVerified = await otpService.verifyOtp(restaurantId, cust.phone, String(otpCode), 'reward_redemption');
    }

    const result = await loyaltyService.redeemReward(restaurantId, req.params.id, reward, {
      otpVerified,
      branchId: auth?.branchIds?.[0],
      createdBy: auth?.name,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'redeemReward'); }
}

// ─── Adjustments (Owner/Manager only) ────────────────────────

export async function adjustPoints(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { points, reason } = req.body;
    if (points >= 0) {
      const result = await loyaltyService.earnPoints(auth?.restaurantId || '', req.params.id, {
        amount: points,
        type: 'adjustment',
        description: reason,
        createdBy: auth?.name,
      });
      res.json({ data: result });
    } else {
      const result = await loyaltyService.redeemPoints(auth?.restaurantId || '', req.params.id, Math.abs(points), {
        description: reason,
        createdBy: auth?.name,
      });
      res.json({ data: result });
    }
  } catch (error) { handleError(res, error, 'adjustPoints'); }
}

// ─── Wallet ───────────────────────────────────────────────────

export async function creditWallet(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await loyaltyService.creditWallet(auth?.restaurantId || '', req.params.id, Number(req.body.amount), {
      description: req.body.description,
      createdBy: auth?.name,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'creditWallet'); }
}

export async function debitWallet(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await loyaltyService.debitWallet(auth?.restaurantId || '', req.params.id, Number(req.body.amount), {
      description: req.body.description,
      createdBy: auth?.name,
    });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'debitWallet'); }
}

// ─── Expiry engine ────────────────────────────────────────────

export async function runExpiry(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const result = await loyaltyService.expirePoints(auth?.restaurantId || '', { operator: auth?.name });
    res.json({ data: result });
  } catch (error) { handleError(res, error, 'runExpiry'); }
}

// ─── Transactions ─────────────────────────────────────────────

export async function getTransactions(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { page, limit, type } = req.query;
    const result = await loyaltyService.getTransactions(auth?.restaurantId || '', req.params.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      type: type as string,
    });
    res.json(result);
  } catch (error) { handleError(res, error, 'getTransactions'); }
}

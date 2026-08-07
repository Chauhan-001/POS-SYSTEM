/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OTP Controller — Server-generated OTP request/verify (Phase 1.6).
 * Replaces the fake client-side OTP with a real server flow:
 * request → (rate-limited, hashed, expiring) → verify (single-use).
 */

import { Request, Response } from 'express';
import { otpService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../utils/AppError';

function userOf(req: Request): AuthenticatedRequest['user'] {
  return (req as AuthenticatedRequest).user;
}

/** POST /api/otp/request — Generate an OTP for a phone (rate-limited). */
export async function requestOtp(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { phone, purpose } = req.body;
    const result = await otpService.requestOtp(auth?.restaurantId || '', phone, purpose);
    res.json({ data: result });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[OtpController] request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/otp/verify — Verify an OTP (single-use, attempt-bounded). */
export async function verifyOtp(req: Request, res: Response): Promise<void> {
  try {
    const auth = userOf(req);
    const { phone, code, purpose } = req.body;
    const valid = await otpService.verifyOtp(auth?.restaurantId || '', phone, code, purpose);
    res.json({ data: { valid } });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[OtpController] verify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

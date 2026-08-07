/**
 * =============================================================================
 *  otp.ts — OTP API Routes (Phase 1.6)
 * =============================================================================
 *
 * Routes: Server-generated OTP request + verification.
 * Access: All staff.
 * Path:   /api/otp
 * Security: rate-limited per phone+purpose, hashed storage, expiry, attempts,
 *           single-use consumption.
 */

import { Router } from 'express';
import { requestOtp, verifyOtp } from '../controllers/otpController';
import { requireAuth } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { requestOtpSchema, verifyOtpSchema } from '../validation';

const router = Router();

router.post('/request', requireAuth, requireFeature('loyalty'), validate({ body: requestOtpSchema }), requestOtp);
router.post('/verify', requireAuth, requireFeature('loyalty'), validate({ body: verifyOtpSchema }), verifyOtp);

export default router;

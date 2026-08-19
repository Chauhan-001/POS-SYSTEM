/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReceiptController — public (no-auth) handlers for the receipt-QR landing page.
 * Mounted at /api/public-store/receipt. All handlers resolve the bill strictly
 * by the opaque 12h-expiring receipt token and return ONLY sanitized data.
 */

import { Request, Response } from 'express';
import { AppError } from '../../../utils/AppError';
import { otpService } from '../../../services';
import {
  resolveBillByReceiptToken,
  buildPublicReceipt,
  buildDemoReceipt,
  saveFeedback,
  verifyReceiptOtp,
} from '../services/receiptService';

function sendError(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message, code: (error as any).code });
    return;
  }
  console.error('[Receipt] error:', error);
  res.status(500).json({ error: 'Internal server error' });
}

/** GET /api/public-store/receipt/:token — sanitized bill summary (no PII). */
export async function getPublicReceipt(req: Request, res: Response): Promise<void> {
  try {
    const token = String(req.params.receiptToken || '');
    const { bill } = await resolveBillByReceiptToken(token);
    const payload = bill ? await buildPublicReceipt(bill) : buildDemoReceipt();
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, receipt: payload });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/public-store/receipt/:token/feedback — anonymous star rating + comment. */
export async function postReceiptFeedback(req: Request, res: Response): Promise<void> {
  try {
    const token = String(req.params.receiptToken || '');
    const { bill } = await resolveBillByReceiptToken(token);
    if (!bill) throw new AppError(400, 'Feedback is not available on this preview receipt.');

    const rating = Math.round(Number(req.body?.rating));
    const comment = String(req.body?.comment || '').trim().slice(0, 1000);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new AppError(400, 'Please pick a rating between 1 and 5 stars.');
    }

    await saveFeedback(bill, { rating, comment: comment || undefined });
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/public-store/receipt/:token/otp/request — send OTP to a phone (rate-limited). */
export async function requestReceiptOtp(req: Request, res: Response): Promise<void> {
  try {
    const token = String(req.params.receiptToken || '');
    const { bill } = await resolveBillByReceiptToken(token);
    if (!bill) throw new AppError(400, 'Login is not available on this preview receipt.');

    const phone = String(req.body?.phone || '').trim();
    if (!/^[0-9+\-\s]{7,20}$/.test(phone)) {
      throw new AppError(400, 'Please enter a valid phone number.');
    }
    const restaurantId = (bill as any).restaurantId ? String((bill as any).restaurantId) : '';
    if (!restaurantId) throw new AppError(400, 'Loyalty login is unavailable for this receipt.');

    const result = await otpService.requestOtp(restaurantId, phone, 'login');
    res.json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
}

/** POST /api/public-store/receipt/:token/otp/verify — verify OTP, unlock "see more". */
export async function verifyReceiptOtpHandler(req: Request, res: Response): Promise<void> {
  try {
    const token = String(req.params.receiptToken || '');
    const { bill } = await resolveBillByReceiptToken(token);
    if (!bill) throw new AppError(400, 'Login is not available on this preview receipt.');

    const phone = String(req.body?.phone || '').trim();
    const code = String(req.body?.code || '').trim();
    if (!phone || !code) throw new AppError(400, 'Phone and code are required.');

    const result = await verifyReceiptOtp(bill, phone, code, (rid, ph, cd, purpose) =>
      otpService.verifyOtp(rid, ph, cd, purpose as any)
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
}

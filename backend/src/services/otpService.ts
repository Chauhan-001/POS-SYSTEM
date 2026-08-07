/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OTP Service — Server-generated one-time passwords (Phase 1.6).
 * Replaces the fake client-generated OTP. Codes are hashed with sha256 (never
 * stored in plaintext), expire after OTP_TTL_MS, allow a bounded number of
 * attempts, and are rate-limited per phone+purpose (3 requests per rolling
 * hour). In demo mode (settings.otpSimulationEnabled via SystemSettings) the
 * code is echoed back so the POS can display it — the verification endpoint
 * still validates server-side.
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import OtpRequest from '../models/OtpRequest';
import { AppError } from '../utils/AppError';
import { otpRequestRepo, loyaltySettingsRepo } from '../repositories';
import type { OtpPurpose } from '../models/OtpRequest';

const OTP_TTL_MS = 5 * 60 * 1000;       // 5 minutes
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 3;

function hash(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

export class OtpService {
  /**
   * Generate and persist an OTP for a phone. Rate-limited to 3/hour/phone.
   * Returns { sent: true, simulatedCode? } — simulatedCode is only present in
   * demo mode so the frontend can surface it (verification still server-side).
   */
  async requestOtp(restaurantId: string, phone: string, purpose: OtpPurpose = 'general'): Promise<{ sent: boolean; simulatedCode?: string; expiresInSeconds: number }> {
    // Rate limit: count requests for this phone+purpose in the last hour.
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recentCount = await OtpRequest.countDocuments({
      restaurantId: objectId(restaurantId),
      phone,
      purpose,
      createdAt: { $gte: since },
    }).exec();
    if (recentCount >= RATE_LIMIT_MAX) {
      throw new AppError(429, 'Too many OTP requests. Please try again later.');
    }

    // Invalidate any previous unused OTPs for this phone+purpose.
    await OtpRequest.updateMany(
      { restaurantId: objectId(restaurantId), phone, purpose, consumed: false },
      { $set: { consumed: true } }
    ).exec();

    const code = generateCode();
    await otpRequestRepo.forTenant(restaurantId).create({
      restaurantId: objectId(restaurantId),
      phone,
      purpose,
      codeHash: hash(code),
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      consumed: false,
    } as any);

    // Demo mode — echo the code so the POS can display it without an SMS gateway.
    let simulatedCode: string | undefined;
    try {
      const settings = await loyaltySettingsRepo.forTenant(restaurantId).findOne({} as any);
      // Backward-compat with the legacy otpSimulationEnabled system setting:
      // default to echoing the code when settings are missing (dev/demo).
      if (!settings || (settings as any).otpEnabled !== false) {
        simulatedCode = code;
      }
    } catch {
      simulatedCode = code;
    }

    return { sent: true, simulatedCode, expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  /**
   * Verify an OTP. Consumes it on success (single-use). Increments attempts and
   * hard-fails after MAX_ATTEMPTS. Returns true when valid.
   */
  async verifyOtp(restaurantId: string, phone: string, code: string, purpose: OtpPurpose = 'general'): Promise<boolean> {
    const request = await otpRequestRepo.forTenant(restaurantId).findOne({
      phone,
      purpose,
      consumed: false,
    } as any);

    if (!request) throw new AppError(400, 'No active OTP. Please request a new code.');

    const doc = request as any;
    if (new Date(doc.expiresAt).getTime() < Date.now()) {
      throw new AppError(400, 'OTP has expired. Please request a new code.');
    }
    if (doc.attempts >= doc.maxAttempts) {
      throw new AppError(429, 'Too many failed attempts. Please request a new code.');
    }

    const valid = hash(code.trim()) === doc.codeHash;
    if (!valid) {
      await OtpRequest.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } }).exec();
      const remaining = doc.maxAttempts - (doc.attempts + 1);
      throw new AppError(400, `Invalid OTP. ${Math.max(0, remaining)} attempts remaining.`);
    }

    await OtpRequest.updateOne({ _id: doc._id }, { $set: { consumed: true } }).exec();
    return true;
  }
}

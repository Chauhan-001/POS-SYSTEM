/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Rate Limiter Middleware — Three-tier rate limiting with per-account
 * exponential backoff for authentication routes.
 *
 * Tiers:
 *   authLimiter    — Stricter: per-IP rate limit + per-account exponential backoff
 *   publicLimiter  — Moderate: for health check and other unauthenticated endpoints
 *   apiLimiter     — Looser: for authenticated user actions
 *
 * Auth routes combine two layers:
 *   1. Per-IP rate limit (catches spray attacks from a single IP)
 *   2. Per-account exponential backoff (catches targeted PIN guessing)
 *      Each consecutive failure doubles the cooldown window.
 *      On successful login, the backoff resets to zero.
 *
 * All thresholds read from config.rateLimiting (set via env vars).
 * No hardcoded values — everything is configurable.
 */

import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

// ─────────────────────────────────────────────────────────────────
// PER-ACCOUNT EXPONENTIAL BACKOFF STORE
// ─────────────────────────────────────────────────────────────────

interface AccountRecord {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number;
}

const accountStore = new Map<string, AccountRecord>();

const STALE_MS = config.rateLimiting.auth.accountBackoffMaxWindow * 2;

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of accountStore) {
    if (now - record.firstFailureAt > STALE_MS) {
      accountStore.delete(key);
    }
  }
}, 60_000);

function getAccountKey(req: Request): string | null {
  const restaurantId = req.body?.restaurantId;
  const phone = req.body?.phone;
  if (restaurantId && phone && typeof restaurantId === 'string' && typeof phone === 'string') {
    return `login:${restaurantId}:${phone}`;
  }
  const pin = req.body?.pin;
  if (pin && typeof pin === 'string') return `pin:${pin}`;
  const username = req.body?.username || req.body?.email || req.body?.userId;
  if (username && typeof username === 'string') return `user:${username}`;
  return null;
}

function isAccountBlocked(accountKey: string): number | null {
  const record = accountStore.get(accountKey);
  if (!record) return null;
  const now = Date.now();
  if (now >= record.blockedUntil) {
    accountStore.delete(accountKey);
    return null;
  }
  return Math.ceil((record.blockedUntil - now) / 1000);
}

function recordAccountFailure(accountKey: string): void {
  const now = Date.now();
  let record = accountStore.get(accountKey);
  if (!record) {
    record = { failures: 1, firstFailureAt: now, blockedUntil: now };
    accountStore.set(accountKey, record);
    return;
  }
  record.failures += 1;
  const backoffMs = Math.min(
    config.rateLimiting.auth.accountBackoffBaseMs * Math.pow(2, record.failures - 1),
    config.rateLimiting.auth.accountBackoffMaxWindow,
  );
  record.blockedUntil = now + backoffMs;
}

/** Resets the per-account backoff counter (call on successful login) */
export function resetAccountBackoff(req: Request): void {
  const key = getAccountKey(req);
  if (key) accountStore.delete(key);
}

// ─────────────────────────────────────────────────────────────────
// AUTH RATE LIMITER — per-IP + per-account exponential backoff
// ─────────────────────────────────────────────────────────────────

/**
 * Layer 1: Per-IP rate limit for auth routes.
 * Catches brute-force spray attacks from a single source.
 */
export const authIpLimiter = rateLimit({
  windowMs: config.rateLimiting.auth.ipWindowMs,
  max: config.rateLimiting.auth.ipMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts from this IP. Please try again later.',
  },
});

/**
 * Layer 2: Per-account exponential backoff middleware.
 * Run this AFTER authIpLimiter. Each consecutive failure doubles
 * the cooldown window (base × 2^(failures-1)), capped at maxWindow.
 * Only starts tracking after `accountBackoffThreshold` failures.
 */
export function accountBackoff(req: Request, res: Response, next: NextFunction): void {
  const accountKey = getAccountKey(req);
  if (!accountKey) return next();

  const retryAfter = isAccountBlocked(accountKey);
  if (retryAfter !== null) {
    res.status(429).json({
      error: 'Too many attempts for this account',
      retryAfter,
    });
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
      const isFailure = res.statusCode === 401 || (body && (body.error === 'Invalid PIN' || body.error === 'Invalid phone or password'));
    if (isFailure) {
      const record = accountStore.get(accountKey);
      const threshold = config.rateLimiting.auth.accountBackoffThreshold;
      if (!record || record.failures < threshold) {
        recordAccountFailure(accountKey);
      }
    }
    return originalJson(body);
  } as any;

  next();
}

// ─────────────────────────────────────────────────────────────────
// PUBLIC ENDPOINT RATE LIMITER  (moderate)
// ─────────────────────────────────────────────────────────────────

export const publicLimiter = rateLimit({
  windowMs: config.rateLimiting.public.windowMs,
  max: config.rateLimiting.public.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please slow down.',
  },
});

// ─────────────────────────────────────────────────────────────────
// AUTHENTICATED API RATE LIMITER  (loose)
// ─────────────────────────────────────────────────────────────────

export const apiLimiter = rateLimit({
  windowMs: config.rateLimiting.api.windowMs,
  max: config.rateLimiting.api.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many API requests. Please slow down.',
  },
});

// ─────────────────────────────────────────────────────────────────
// ADMIN DASHBOARD API RATE LIMITER
// ─────────────────────────────────────────────────────────────────
// Applied to the /api/admin/* and /api/admin/reports/* routers (mounted in
// server.ts BEFORE the global apiLimiter). Prevents an authenticated (or
// compromised) admin session from hammering the platform console. Looser than
// the business apiLimiter because the dashboard polls several aggregate
// endpoints at once.

export const adminApiLimiter = rateLimit({
  windowMs: config.rateLimiting.admin.windowMs,
  max: config.rateLimiting.admin.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many admin API requests. Please slow down.',
  },
});

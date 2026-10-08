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

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
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

// ══════════════════════════════════════════════════════════════════════
// VOICE API RATE LIMITER (per-restaurant)
// ══════════════════════════════════════════════════════════════════════
// Applied to /api/voice-inventory/* (parse, transcribe, confirm, converse).
// Unlike `apiLimiter` (per-IP), this keys on the authenticated restaurantId
// so one noisy terminal can't exhaust another tenant's quota. Falls back to
// the client IP for unauthenticated requests (e.g. /status).

// ══════════════════════════════════════════════════════════════════════
// MARKETING INTELLIGENCE RATE LIMITER (per-restaurant) + CONCURRENCY GUARD
// ══════════════════════════════════════════════════════════════════════
// POST /api/ai/marketing-agent/intelligence runs a tool fan-out plus an
// optional LLM call; without a guard a frontend retry loop can trigger a tool
// storm. Keyed on the authenticated restaurantId (falls back to IP), tighter
// than apiLimiter, and paired with a per-tenant concurrency cap so one tenant
// can never run two expensive pipelines at once.

export const intelligenceLimiter = rateLimit({
  windowMs: config.rateLimiting.intelligence.windowMs,
  max: config.rateLimiting.intelligence.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const restaurantId = (req as any).user?.restaurantId;
    if (typeof restaurantId === 'string' && restaurantId) {
      return `intel:tenant:${restaurantId}`;
    }
    return `intel:ip:${ipKeyGenerator(req.ip || 'unknown')}`;
  },
  message: {
    error: 'Too many intelligence requests for this restaurant. Please slow down.',
    code: 'RATE_LIMITED',
  },
});

/**
 * In-process count of in-flight runs, keyed by AGENT and tenant.
 *
 * Keyed per agent on purpose. The three expensive AI pipelines (marketing
 * intelligence, deep analysis, the inventory agent) are independent, but a
 * single tenant-wide counter made them mutually exclusive: a marketing page
 * load holds the "/intelligence" slot for as long as that pipeline runs, so an
 * owner clicking "Run deep analysis" — or any inventory-agent run — got a 429
 * for the whole duration with no way to make progress. The guard exists to
 * stop a retry loop stacking the SAME costly pipeline on one tenant, not to
 * serialise unrelated agents.
 */
const intelligenceInFlight = new Map<string, number>();

/**
 * Build a per-tenant concurrency guard for ONE agent.
 *
 * Rejects a new run while the same tenant already has `maxConcurrent` runs of
 * `agent` in flight, with a structured 429 carrying a retryable code. The slot
 * is released on both `finish` and `close` so a dropped connection cannot leak
 * it — released EXACTLY once, because both events fire for a normal response.
 */
export function concurrencyGuardFor(agent: string): (req: Request, res: Response, next: NextFunction) => void {
  return function agentConcurrencyGuard(req: Request, res: Response, next: NextFunction): void {
    const restaurantId = (req as any).user?.restaurantId;
    if (typeof restaurantId !== 'string' || !restaurantId) return next();
    const key = `${agent}:${restaurantId}`;
    const max = Math.max(1, config.rateLimiting.intelligence.maxConcurrent);
    const current = intelligenceInFlight.get(key) ?? 0;
    if (current >= max) {
      res.status(429).json({
        error: 'An intelligence run is already in progress for this restaurant. Please wait for it to finish.',
        code: 'CONCURRENCY_LIMIT',
        retryAfter: 5,
      });
      return;
    }
    intelligenceInFlight.set(key, current + 1);
    // `finish` and `close` BOTH fire for a normal response, so an unguarded
    // release decremented the in-flight count twice per run. That under-counted
    // concurrent runs: a second run's slot was freed while it was still
    // executing, letting a third in — exactly the tool storm this guard exists
    // to prevent. Release exactly once.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const n = (intelligenceInFlight.get(key) ?? 1) - 1;
      if (n <= 0) intelligenceInFlight.delete(key);
      else intelligenceInFlight.set(key, n);
    };
    res.on('finish', release);
    res.on('close', release);
    next();
  };
}

/**
 * The marketing INTELLIGENCE pipeline's guard (`POST /intelligence`).
 * Deep analysis and the inventory agent have their own counters — see
 * `concurrencyGuardFor` at their route definitions.
 */
export const intelligenceConcurrencyGuard = concurrencyGuardFor('marketing_intelligence');

// Express-rate-limit v7+ requires the official ipKeyGenerator helper when a
// custom keyGenerator reads the request IP (handles IPv6 / X-Forwarded-For).
export const voiceApiLimiter = rateLimit({
  windowMs: config.rateLimiting.voice.windowMs,
  max: config.rateLimiting.voice.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const restaurantId = (req as any).user?.restaurantId;
    if (typeof restaurantId === 'string' && restaurantId) {
      return `voice:tenant:${restaurantId}`;
    }
    return `voice:ip:${ipKeyGenerator(req.ip || 'unknown')}`;
  },
  message: {
    error: 'Too many voice requests for this restaurant. Please slow down.',
  },
});

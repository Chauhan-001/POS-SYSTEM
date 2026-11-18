/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * =============================================================================
 *  config.ts — Centralized Environment Configuration
 * =============================================================================
 *
 * Purpose:
 *   All config values are read from process.env with sensible defaults.
 *   This is the single source of truth for all environment variables.
 *
 * Environment Variables (all optional in dev, required in production):
 *   MONGODB_URI        - MongoDB connection string
 *   PORT               - HTTP server port (default: 3001)
 *   CORS_ORIGIN        - Allowed frontend origin (default: http://localhost:5173)
 *   JWT_SECRET         - JWT signing secret (REQUIRED in production)
 *   REFRESH_SECRET     - Refresh token secret (REQUIRED in production)
 *   AI_PROVIDER        - LLM provider (openai|anthropic|ollama|custom)
 *   RAZORPAY_KEY_ID    - Razorpay payment gateway key
 *
 * Sections:
 *   1. Server settings (port, CORS, env)
 *   2. JWT secrets & tokens
 *   3. AI / LLM configuration
 *   4. Razorpay payment gateway
 *   5. Rate limiting thresholds
 *   6. Media uploads (directory, size limits, allowed types)
 */

import dotenv from 'dotenv';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

// Dual-environment module dir: under tsx (ESM) import.meta.url is valid; in
// the esbuild CJS bundle it is undefined. Reference the CJS `__filename`
// global as a FREE variable (never declare a same-named const — esbuild would
// rename the declaration and defeat the typeof check), falling back to
// import.meta.url when it doesn't exist (ESM). Without this the production
// bundle crashes on startup.
const __dirname = path.dirname(
  typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
);

/**
 * First non-internal IPv4 address — the machine's current LAN IP. Prefers
 * private-range addresses (home/office Wi-Fi & Ethernet) and skips VPN/VM
 * virtual adapters when a private address is present. Falls back to
 * 'localhost' when no suitable address exists.
 */
export function getLanIp(): string {
  const nets = os.networkInterfaces();
  const candidates: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const addr = net.address;
      // Private LAN ranges first — virtual adapters (VPN/VM) usually sit outside these.
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(addr)) return addr;
      candidates.push(addr);
    }
  }
  return candidates[0] || 'localhost';
}

export const config = {

  // ===========================================================================
  // SECTION 1: SERVER SETTINGS
  // ===========================================================================

  /** MongoDB connection string */
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/pos',

  /** HTTP server port (default: 3002). A host env like PORT=0 (common with
   *  process managers / spawned shells) must never bind the API to an
   *  ephemeral port — fall back to the documented default instead. */
  port: (() => {
    const p = parseInt(process.env.PORT || '3002', 10);
    return Number.isFinite(p) && p > 0 ? p : 3002;
  })(),

  /** CORS allowed origin(s) — comma-separated for multiple origins */
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  /** Environment mode */
  nodeEnv: process.env.NODE_ENV || 'development',

  /** Admin dashboard CORS origin */
  adminCorsOrigins: (process.env.ADMIN_CORS_ORIGINS || '').split(',').filter(Boolean),

  // ===========================================================================
  // SECTION 2: JWT AUTHENTICATION
  // ===========================================================================

  /** JWT secret for auth tokens — required in production */
  jwtSecret: (() => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET environment variable is required in production');
      }
      return 'pos-dev-secret-change-in-production';
    }
    return secret;
  })(),

  /** JWT token issuer claim */
  jwtIssuer: process.env.JWT_ISSUER || 'restaurant-pos',

  /** Refresh token secret — required in production */
  refreshSecret: (() => {
    const secret = process.env.REFRESH_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('REFRESH_SECRET environment variable is required in production');
      }
      return 'pos-dev-refresh-secret-change-in-production';
    }
    return secret;
  })(),

  // ===========================================================================
  // SECTION 3: RESPONSE CACHE (Redis)
  // ===========================================================================

  /** Redis URL for shared response cache. Falls back to in-memory if unset. */
  redisUrl: process.env.REDIS_URL || '',

  // ===========================================================================
  // SECTION 4: AI / LLM CONFIGURATION
  // ===========================================================================

  ai: {
    /** LLM provider: gemini | openai | anthropic | ollama | custom */
    provider: (process.env.AI_PROVIDER || 'openai') as 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'custom',
    /** API key for the LLM provider */
    apiKey: process.env.AI_API_KEY || '',
    /**
     * Fallback keys (BACKEND ONLY, comma-separated; AI_API_KEY_FALLBACK is
     * accepted as a single first fallback). When the primary key is
     * rate-limited (HTTP 429), times out, or the provider returns a 5xx, the
     * shared LLM client rotates to the next key in the pool. Keys that hit a
     * rate limit are cooled down briefly so the pool skips them. Values are
     * never logged or surfaced in errors.
     */
    fallbackApiKeys: [process.env.AI_API_KEY_FALLBACK || '', ...(process.env.AI_API_KEY_FALLBACKS || '').split(',')]
      .map((k) => k.trim())
      .filter(Boolean),
    /** Model identifier (provider-specific default) */
    model: process.env.AI_MODEL || 'openai/gpt-oss-20b',
    /** Custom base URL (for Ollama or proxy) */
    baseUrl: process.env.AI_BASE_URL || '',
    /** Request timeout in ms */
    timeout: parseInt(process.env.AI_TIMEOUT || '15000', 10),
    /** Max tokens per response */
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '1024', 10),
    /** LLM temperature */
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.3'),
    /**
     * Startup key-pool health check (AI_KEY_HEALTHCHECK, default ON).
     *
     * A pool can quietly rot: keys get rotated/revoked and every request then
     * wastes its failover attempts on dead credentials. At startup the shared
     * LLM client probes each pooled key once (token-free), logs how many
     * actually authenticate, and quarantines the rejected ones for this
     * process so an agent run never aborts because of a stale key. Set to
     * 'false' to skip the probe (for example in CI or with a metered endpoint).
     */
    keyHealthCheckEnabled: (process.env.AI_KEY_HEALTHCHECK || 'true').trim().toLowerCase() !== 'false',
    /** Weather API key (optional, demo mode if not set) */
    weatherApiKey: process.env.WEATHER_API_KEY || '',
  },

  // ===========================================================================
  // SECTION 5: PAYMENT GATEWAY (Razorpay)
  // ===========================================================================

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  // ===========================================================================
  // SECTION 5a-bis: ML PIPELINE (P0 data bridge)
  // ===========================================================================

  // ===========================================================================
  // SECTION 5a-ter: CRICKET CONTEXT PROVIDER (CricAPI)
  // ===========================================================================

  /**
   * Cricket context (Phase 1) — backend-only CricAPI integration feeding the
   * shared Sports Context service / getSportsContext AI tool. The API key is
   * server-only: never sent to any client surface and never logged.
   * Unset CRICKET_API_KEY or CRICKET_CONTEXT_ENABLED=false disables all
   * outbound provider calls (the tool then reports unavailable honestly).
   */
  cricket: {
    /** Master switch (default true, but requires an API key to run). */
    enabled: (process.env.CRICKET_CONTEXT_ENABLED || 'true').trim().toLowerCase() !== 'false',
    /** CricAPI key — BACKEND ONLY. Never expose to clients or logs. */
    apiKey: (process.env.CRICKET_API_KEY || '').trim(),
    /**
     * Fallback keys (comma-separated, BACKEND ONLY). When the primary key is
     * quota-blocked (CricAPI signals HTTP 200 + reason), the pool rotates to
     * the next key; exhausted keys are cooled down before reuse.
     */
    fallbackApiKeys: (process.env.CRICKET_FALLBACK_API_KEYS || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
    /** Provider base URL (v1 matches API). */
    baseUrl: (process.env.CRICKET_API_BASE_URL || 'https://api.cricapi.com/v1').trim(),
    /** Cache refresh interval in hours. */
    refreshHours: parseInt(process.env.CRICKET_REFRESH_HOURS || '12', 10),
    /** Hard cap on matches fetched per refresh (pagination guard). */
    maxMatches: parseInt(process.env.CRICKET_MAX_MATCHES || '50', 10),
    /**
     * Hard cap on provider PAGES fetched per refresh. CricAPI slices by row
     * offset, so reaching fixtures near "now" needs several pages; this keeps
     * a refresh inside the free-tier daily hit budget (12 pages x 4 refreshes
     * = 48 hits/day against a 100/day limit).
     */
    maxPages: parseInt(process.env.CRICKET_MAX_PAGES || '12', 10),
    /** Per-request timeout (ms). */
    timeoutMs: parseInt(process.env.CRICKET_TIMEOUT_MS || '10000', 10),
    /** Relevance look-ahead window (days) — Phase 2 configurable. */
    contextDaysAhead: parseInt(process.env.CRICKET_CONTEXT_DAYS_AHEAD || '7', 10),
    /** Marketing hot-window (hours) — matches within this get a relevance boost. */
    marketingWindowHours: parseInt(process.env.CRICKET_MARKETING_WINDOW_HOURS || '24', 10),
    /** Preparation-window look-ahead (hours) — CRICKET_PREPARATION_WINDOW_HOURS=36 → MATCH_PREPARATION_WINDOW fires 24–36h ahead. */
    preparationWindowHours: parseInt(process.env.CRICKET_PREPARATION_WINDOW_HOURS || '36', 10),
  },

  // ===========================================================================
  // SECTION 5b: SUBSCRIPTION
  // ===========================================================================

  subscription: {
    /** Free-trial duration in days (single source of truth for 7-day trial) */
    trialDays: parseInt(process.env.TRIAL_DAYS || '14', 10),
  },

  // ===========================================================================
  // SECTION 5c: MEDIA UPLOADS
  // ===========================================================================

  uploads: {
    /** Absolute directory where uploaded media is persisted (survives restarts). */
    dir: process.env.UPLOADS_DIR || path.join(__dirname, '../uploads'),

    /** Maximum upload size in MB (per file). */
    maxFileSizeMB: parseInt(process.env.UPLOAD_MAX_FILE_SIZE_MB || '5', 10),

    /** Allowed image MIME types for restaurant media. */
    allowedMimeTypes: (process.env.UPLOAD_ALLOWED_MIME_TYPES || 'image/jpeg,image/png,image/webp,image/gif')
      .split(',').map((s) => s.trim()).filter(Boolean),

    /**
     * Optional public base URL used to build absolute media URLs in API
     * responses (e.g. https://api.example.com). When empty, responses carry
     * relative paths (/uploads/...) which clients resolve against their own
     * API origin.
     */
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  },

  // ===========================================================================
  // SECTION 5d: FRONTEND STATIC BUILD
  // ===========================================================================

  /**
   * Absolute directory of the built POS frontend, served at / in production
   * (same-origin /api so the SPA needs no proxy). Defaults to the monorepo
   * layout <repo>/restaurant-pos/Frontend/dist and resolves correctly from
   * both the dev tree (backend/src) and the compiled bundle (backend/dist).
   * Deployments that host the build elsewhere can override via FRONTEND_DIST.
   */
  frontendDist: process.env.FRONTEND_DIST || path.join(__dirname, '../../restaurant-pos/Frontend/dist'),

  /**
   * Public base URL of the customer QR ordering site. QR Studio bakes this
   * into every printed QR sticker. In development this auto-detects the
   * machine's current LAN IP so phone-scanned stickers work on the local
   * network — localhost would resolve to the phone itself. Override with
   * QR_BASE_URL to force a specific address (e.g. a static LAN IP) or when
   * the site is hosted elsewhere.
   */
  qrBaseUrl: (() => {
    const override = process.env.QR_BASE_URL;
    if (override) return override.replace(/\/$/, '');
    return `http://${getLanIp()}:5177`;
  })(),

  // ===========================================================================
  // SECTION 7: WHATSAPP BUSINESS INTEGRATION (META)
  // ===========================================================================

  whatsapp: {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || '',
    graphApiVersion: process.env.META_GRAPH_API_VERSION || 'v18.0',
    encryptionKey: (() => {
      const key = process.env.WHATSAPP_ENCRYPTION_KEY;
      if (!key) {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('WHATSAPP_ENCRYPTION_KEY must be set in production');
        }
        return 'pos-whatsapp-dev-key-change-in-production';
      }
      if (key === 'pos-whatsapp-dev-key-change-in-production' && process.env.NODE_ENV === 'production') {
        throw new Error('WHATSAPP_ENCRYPTION_KEY must not be the default dev value in production');
      }
      return key;
    })(),
  },

  // ===========================================================================
  // SECTION 6: RATE LIMITING
  // ===========================================================================

  rateLimiting: {
    auth: {
      /** Per-IP window in milliseconds (default: 15 minutes) */
      ipWindowMs: parseInt(process.env.RL_AUTH_IP_WINDOW_MS || (15 * 60 * 1000).toString(), 10),
      /** Max requests per IP per window (default: 10) */
      ipMaxRequests: parseInt(process.env.RL_AUTH_IP_MAX || '10', 10),
      /** Per-account exponential backoff base window in ms (default: 1 second) */
      accountBackoffBaseMs: parseInt(process.env.RL_AUTH_ACCOUNT_BACKOFF_BASE_MS || '1000', 10),
      /** Per-account max backoff window in ms (default: 1 hour) */
      accountBackoffMaxWindow: parseInt(process.env.RL_AUTH_ACCOUNT_BACKOFF_MAX_MS || (60 * 60 * 1000).toString(), 10),
      /** Consecutive failures before per-account backoff starts (default: 3) */
      accountBackoffThreshold: parseInt(process.env.RL_AUTH_ACCOUNT_BACKOFF_THRESHOLD || '3', 10),
    },
    public: {
      /** Window in milliseconds (default: 1 minute) */
      windowMs: parseInt(process.env.RL_PUBLIC_WINDOW_MS || (60 * 1000).toString(), 10),
      /** Max requests per window (default: 60) */
      maxRequests: parseInt(process.env.RL_PUBLIC_MAX || '60', 10),
    },
    api: {
      /** Window in milliseconds (default: 1 minute) */
      windowMs: parseInt(process.env.RL_API_WINDOW_MS || (60 * 1000).toString(), 10),
      /** Max requests per authenticated user per window (default: 120) */
      maxRequests: parseInt(process.env.RL_API_MAX || '120', 10),
    },
    admin: {
      /** Window in milliseconds (default: 1 minute) */
      windowMs: parseInt(process.env.RL_ADMIN_WINDOW_MS || (60 * 1000).toString(), 10),
      /** Max requests per IP per window (default: 300) — admin dashboard traffic */
      maxRequests: parseInt(process.env.RL_ADMIN_MAX || '300', 10),
    },
     voice: {
      /** Window in milliseconds (default: 1 minute) */
      windowMs: parseInt(process.env.RL_VOICE_WINDOW_MS || (60 * 1000).toString(), 10),
      /** Max requests per restaurant per window (default: 90) — voice parse/transcribe/confirm */
      maxRequests: parseInt(process.env.RL_VOICE_MAX || '90', 10),
    },
    intelligence: {
      /** Window in milliseconds (default: 1 minute) */
      windowMs: parseInt(process.env.RL_INTELLIGENCE_WINDOW_MS || (60 * 1000).toString(), 10),
      /** Max intelligence runs per restaurant per window (default: 20) — each run
       * fans out to many tools + an optional LLM call, so this is deliberately
       * tighter than apiLimiter. Sized against real page usage: one Marketing
       * page load spends 2 (`/recommend` + `/intelligence`) and the owner's
       * "Run deep analysis" click spends 1 more, so the previous 6/min was
       * exhausted by three navigations in a minute — every further AI call then
       * 429'd for the rest of the window, and the Retry buttons burned the same
       * budget. 20 allows normal navigation and a retry without a dead minute. */
      maxRequests: parseInt(process.env.RL_INTELLIGENCE_MAX || '20', 10),
      /** Max CONCURRENT intelligence runs per restaurant (default: 1) */
      maxConcurrent: parseInt(process.env.RL_INTELLIGENCE_MAX_CONCURRENT || '1', 10),
    },
  },
};

// Validate WhatsApp production requirements after config is fully constructed.
if (process.env.NODE_ENV === 'production') {
  if (!config.whatsapp.appSecret) {
    throw new Error('META_APP_SECRET must be set in production');
  }
}

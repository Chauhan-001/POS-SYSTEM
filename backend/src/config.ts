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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  /** HTTP server port (default: 3002) */
  port: parseInt(process.env.PORT || '3002', 10),

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
    /** LLM provider: openai | anthropic | ollama | custom */
    provider: (process.env.AI_PROVIDER || 'openai') as 'openai' | 'anthropic' | 'ollama' | 'custom',
    /** API key for the LLM provider */
    apiKey: process.env.AI_API_KEY || '',
    /** Model identifier (provider-specific default) */
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    /** Custom base URL (for Ollama or proxy) */
    baseUrl: process.env.AI_BASE_URL || '',
    /** Request timeout in ms */
    timeout: parseInt(process.env.AI_TIMEOUT || '15000', 10),
    /** Max tokens per response */
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '1024', 10),
    /** LLM temperature */
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.3'),
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
  // SECTION 5b: SUBSCRIPTION
  // ===========================================================================

  subscription: {
    /** Free-trial duration in days (single source of truth for 7-day trial) */
    trialDays: parseInt(process.env.TRIAL_DAYS || '7', 10),
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
  },
};

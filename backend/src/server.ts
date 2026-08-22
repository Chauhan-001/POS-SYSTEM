/**
 * ============================================================================
 * MODULE: POS Backend Server Lifecycle (server.ts)
 * ============================================================================
 * Purpose:
 * Entry point for the Node.js Express REST API server. Manages CORS security,
 * MongoDB connection initialization, API route mounting, and error middleware.
 *
 * Key Responsibilities:
 * - Express application configuration & JSON middleware mounting
 * - MongoDB database connection via db.ts
 * - Mounting REST endpoints (/api/auth, /api/bills, /api/products, etc.)
 * - Global error handler middleware attachment
 *
 * Related Files:
 * - backend/src/config.ts
 * - backend/src/db.ts
 * - backend/src/routes/*
 *
 * Developer Notes:
 * - SAFE TO EXTEND: Mount new sub-routers under /api route group
 * - DO NOT MODIFY: Global error handling middleware response format
 *
 * Route Mount Order (important):
 *   1. Auth routes   (/api/auth)     — BEFORE global rate limiter (own strict limiters)
 *   2. Admin routes  (/api/auth/admin) — BEFORE global rate limiter
 *   3. Health check  (/api/health)   — PUBLIC, moderate rate limiter
 *   4. AI routes     (/api/ai)       — BEFORE global rate limiter (own strict limiters)
 *   5. Voice routes  (/api/voice-inventory) — BEFORE global rate limiter
 * Navigation:
 *   - /api/auth/*           → routes/auth.ts
 *   - /api/auth/admin/*     → routes/admin.ts
 *   - /api/products/*       → routes/products.ts
 *   - /api/orders/*         → routes/orders.ts
 *   - /api/employees/*      → routes/employees.ts
 *   - /api/branches/*       → routes/branches.ts
 *   - /api/expenses/*       → routes/expenses.ts
 *   - /api/sync/*           → routes/sync.ts
 *   - /api/rewards/*        → routes/rewards.ts
 *   - /api/tables/*         → routes/tables.ts
 *   - /api/takeaway-orders/* → routes/takeawayOrders.ts
 *   - /api/reservations/*   → routes/reservations.ts
 * ============================================================================
 */

// =============================================================================
// IMPORTS
// =============================================================================

import express from 'express';
import http from 'http';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config';
import { connectDB, isConnected } from './db';
import { apiLimiter, publicLimiter, adminApiLimiter } from './middleware/rateLimiter';
import { securityHeaders } from './middleware/securityHeaders';
import { ipBlocklist, refreshIpBlocklist } from './middleware/ipBlocklist';
import { errorHandler } from './middleware/errorHandler';
import { responseCache } from './utils/ResponseCache';
import { RedisAdapter } from './cache/adapters';

// Dual-environment module dir: works under tsx (ESM) and the esbuild CJS
// bundle (where import.meta.url is undefined). `__filename` is referenced as
// a free CJS global (never declared — esbuild would rename it and break the
// check). Without this the production bundle crashes on startup.
const __dirname = path.dirname(
  typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
);

/**
 * Server version reported by /api/health — read from backend/package.json
 * (resolves identically from src/ in dev and dist/ in the esbuild bundle;
 * esbuild inlines the JSON). Non-fatal: an unreadable package.json yields
 * 'unknown' rather than preventing startup.
 */
const SERVER_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();

// Route imports
import authRouter from './routes/auth';
import sessionsRouter from './routes/sessions';
import adminRouter from './routes/admin';
import adminReportsRouter from './routes/adminReports';
import productsRouter from './routes/products';
import ordersRouter from './routes/orders';
import availabilityRouter from './routes/availability';
import billsRouter from './routes/bills';
import customersRouter from './routes/customers';
import employeesRouter from './routes/employees';
import branchesRouter from './routes/branches';
import expensesRouter from './routes/expenses';
import syncRouter from './routes/sync';
import rewardsRouter from './routes/rewards';
import tablesRouter from './routes/tables';
import floorsRouter from './routes/floors';
import takeawayOrdersRouter from './routes/takeawayOrders';
import heldOrdersRouter from './routes/heldOrders';
import reservationsRouter from './routes/reservations';
import devicesRouter from './routes/devices';
import aiRouter from './modules/ai/routes/ai';
import voiceInventoryRouter from './modules/voice-inventory/routes/voiceInventory';
import subscriptionRouter from './modules/subscription/subscriptionRoutes';
import qrOrderingRouter from './modules/qr-ordering/routes/qrOrdering';
import qrTokensRouter from './modules/qr-ordering/routes/qrTokens';
import offersRouter from './routes/offers';
import advisorRouter from './routes/advisor';
import forecastRouter from './routes/forecast';
import inventoryDemandRouter from './routes/inventoryDemand';
import scenarioRouter from './routes/scenario';
import intelligenceRouter from './routes/intelligence';
import loyaltyRouter from './routes/loyalty';
import otpRouter from './routes/otp';
import referralsRouter from './routes/referrals';
import campaignsRouter from './routes/campaigns';
import automationsRouter from './routes/automations';
import customerReportsRouter from './routes/customerReports';
import recipesRouter from './modules/recipes/routes/recipes';
import menuConfigRouter from './modules/menu-config/routes/menuConfig';
import promotionsRouter from './modules/promotions/routes/promotions';
import mediaRouter from './routes/media';
import purchasesRouter from './routes/purchases';
import inventoryEventsRouter from './routes/inventoryEvents';
import suppliersRouter from './routes/suppliers';
import expenseCategoriesRouter from './routes/expenseCategories';
import vendorsRouter from './routes/vendors';
import recurringExpensesRouter from './routes/recurringExpenses';
import cashLedgerRouter from './routes/cashLedger';
import financeRouter from './routes/finance';
import reportsRouter from './modules/reports/routes/reports';
import settingsRouter from './modules/settings/routes/settings';
import publicStoreRouter from './modules/public-store/routes/publicStore';
import receiptRouter from './modules/public-store/routes/receipt';
import legalRouter from './modules/legal/routes/legal';
import helpAnalyticsRouter from './modules/help-analytics/routes/helpAnalytics';
import marketingRouter from './routes/marketing';

import { renderPublicStorePage } from './modules/public-store/publicStorePage';
import { initSocket } from './socket';
import { startSubscriptionScheduler } from './modules/subscription/subscriptionScheduler';
import { subscriptionService } from './modules/subscription/subscriptionService';
import { getSTTConfig } from './modules/voice-inventory/services/SpeechService';
import { aiConfig } from './modules/ai/config';
import { hydrateQuotaFromDb } from './modules/ai/services/aiQuotaTracker';
import { startCampaignWorker } from './services/campaignQueue';
import { startMarketingScheduler } from './services/marketingScheduler';

// =============================================================================
// APP SETUP — Middleware stack
// =============================================================================

const app = express();

// ─── Security Headers (helmet) ───────────────────────────────────
// Sets X-Content-Type-Options (nosniff), X-Frame-Options / CSP
// frame-ancestors (clickjacking), Referrer-Policy, and more.
// Config lives in middleware/securityHeaders.ts (unit-tested); CSP is tuned
// for the Vite-built SPA and LAN/HTTP POS deployments.
app.use(securityHeaders());

// ─── CORS Configuration ──────────────────────────────────────────
// Allow multiple origins for POS frontend + admin dashboard
const corsOrigins = [
  config.corsOrigin,
  ...(config.adminCorsOrigins.length > 0 ? config.adminCorsOrigins : []),
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    // In development, allow all origins
    if (config.nodeEnv === 'development') return callback(null, true);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Razorpay payment webhook signature verification needs the EXACT raw request
// body that was signed. express.json() above re-serializes and would break the
// HMAC, so capture the raw bytes for the webhook route before JSON parsing.
app.use((req, res, next) => {
  if (req.originalUrl.split('?')[0] === '/api/payment/webhook') {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      (req as any).razorpayRawBody = Buffer.concat(chunks).toString('utf8');
      next();
    });
    return;
  }
  next();
});

// ─── Response Compression (gzip / deflate) ──────────────────────
// Compresses JSON, text, and other responses above threshold.
// Auto-negotiates via Accept-Encoding header; skips already-compressed payloads.
// Threshold = 1KB — don't waste cycles on tiny responses.
app.use(compression({
  threshold: 1024,          // minimum response size in bytes to compress
  level: 6,                 // zlib level 6 = good balance of speed vs ratio
  // The built-in filter compresses: text/*, application/json, application/javascript, etc.
  // and avoids double-compressing already-encoded payloads.
}));

// ─── JSON Parse Error Handler — catch malformed request bodies ────
app.use((err: SyntaxError & { status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err && err.status === 400) {
    res.status(400).json({ error: 'Invalid JSON in request body' });
    return;
  }
  next(err);
});

// ─── Manual IP Blocklist (attack response) ────────────────────
// Global gate — every request from a blocked IP/range is rejected with 403
// BEFORE it reaches any route (auth, admin, business, static). Fail-open:
// a transient DB issue allows traffic through rather than taking the whole
// platform offline. Cache is invalidated automatically on block/unblock.
app.use(ipBlocklist);

// ─── Request Logger + Mutation Audit (Phase 1.10) ───────────────
// Structured per-request JSON logging (user/restaurant/branch/device/status/
// latency) + append-only AuditLog entries for every attributable mutation.
// Non-blocking by design — logging failures never fail a request.
import { auditContextMiddleware } from './modules/audit/auditContextMiddleware';
// Seed AsyncLocalStorage (requestId / correlationId / live req) BEFORE the
// request logger so every downstream audit write can auto-collect context.
app.use(auditContextMiddleware);
import { requestLogger } from './middleware/requestLogger';
app.use(requestLogger());

// =============================================================================
// ROUTE MOUNTING
// =============================================================================

// ─── Group A: Routes BEFORE global rate limiter ──────────────────
// These have their own stricter rate limiters.

// Auth routes (login, register, refresh tokens)
app.use('/api/auth', authRouter);

// Session & refresh-token management — authenticated; own rate limiting
app.use('/api/sessions', sessionsRouter);

// Admin routes (dashboard management) — own rate limiter, mounted BEFORE the
// global apiLimiter so the platform console is never left uncapped.
// Chained in ONE app.use so the limiter runs exactly once per request (two
// separate mounts would double-count every /api/admin/reports/* request).
// CRITICAL: the limiter is only applied to /api/admin/* paths — mounting it
// on the bare '/api' prefix would count EVERY business request (POS polling,
// settings sync, etc.) against the admin window and 429 legit traffic when
// several terminals share one IP (e.g. 127.0.0.1 in dev / NAT in production).
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/admin')) return adminApiLimiter(req, res, next);
  return next();
}, adminRouter, adminReportsRouter);

// Health check — public endpoint
// Not cached because dbConnected must always be fresh per-request
// Includes the server version so ops can identify the running build.
app.get('/api/health', publicLimiter, (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dbConnected: isConnected(),
    version: SERVER_VERSION,
  });
});

// AI assistant routes
app.use('/api/ai', aiRouter);

// Voice inventory routes
app.use('/api/voice-inventory', voiceInventoryRouter);

// Subscription & payment routes — mounted BEFORE the global apiLimiter (Group B)
// so the shared per-IP business-request budget (consumed heavily by the running
// POS polling) can never throttle the public /plans catalog or the subscription /
// payment calls, which would otherwise silently blank the Subscription page.
// Routes requiring payment still use the dedicated PaymentGateway circuit breaker.
app.use('/api', subscriptionRouter);

// Public storefront (customer QR page) — mounted BEFORE the global apiLimiter so
// a customer's phone scanning the loyalty QR (unauthenticated, public) never
// consumes the shared business-API budget shared by all POS terminals behind the
// same LAN/NAT IP. publicLimiter is moderate and per-IP.
app.use('/api/public-store', publicLimiter, publicStoreRouter);

// Public receipt-QR landing (printed on bills) — same public limiter, no auth.
// Mounted AFTER publicStoreRouter so /:token catch-alls can't shadow it.
app.use('/api/public-store/receipt', publicLimiter, receiptRouter);

// Legal & Compliance — public document reads + authenticated acceptance/consent
// + owner stats + admin document lifecycle. Public reads never consume the
// business budget; admin endpoints self-gate on super_admin surface tokens.
app.use('/api/legal', legalRouter);
app.use('/api/help-analytics', helpAnalyticsRouter);
app.use('/api/marketing', marketingRouter);

// ─── Group B: Apply global rate limiter ─────────────────────────
app.use('/api', apiLimiter);

// ─── Group C: Business routes (behind rate limiter) ─────────────
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/availability', availabilityRouter);
app.use('/api/bills', billsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/expense-categories', expenseCategoriesRouter);
app.use('/api/vendors', vendorsRouter);
app.use('/api/recurring-expenses', recurringExpensesRouter);
app.use('/api/cash-ledger', cashLedgerRouter);
app.use('/api/finance', financeRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/menu-config', menuConfigRouter);
app.use('/api/sync', syncRouter);
app.use('/api/qr-ordering', qrOrderingRouter);
app.use('/api/qr-tokens', qrTokensRouter);
app.use('/api/rewards', rewardsRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/floors', floorsRouter);
app.use('/api/takeaway-orders', takeawayOrdersRouter);
app.use('/api/held-orders', heldOrdersRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/inventory-events', inventoryEventsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api', offersRouter);
app.use('/api', advisorRouter);
app.use('/api/forecast', forecastRouter);
app.use('/api/inventory-demand', inventoryDemandRouter);
app.use('/api/scenario', scenarioRouter);
app.use('/api/intelligence', intelligenceRouter);
app.use('/api/loyalty', loyaltyRouter);
app.use('/api/otp', otpRouter);
app.use('/api/referrals', referralsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/automations', automationsRouter);
app.use('/api/customer-reports', customerReportsRouter);
app.use('/api', recipesRouter);
app.use('/api', promotionsRouter);
app.use('/api', mediaRouter);

// =============================================================================
// ERROR HANDLING
// =============================================================================

// ─── Global Express Error Handler — MUST be registered AFTER all routes ──
app.use(errorHandler);

// ─── Process-level Error Handlers — prevent silent crashes ──────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  process.exit(1);
});

// =============================================================================
// STATIC FILE SERVING (Production Only)
// =============================================================================

// Uploaded media (logos / covers) — persisted on disk, survives restarts.
// Registered BEFORE the SPA catch-all so image URLs resolve to real files.
app.use('/uploads', express.static(config.uploads.dir));

// Public store page (the URL baked into the loyalty QR codes). Served by this
// server so the QR works on LAN/HTTP deployments without a CDN. Must be
// registered BEFORE the SPA catch-all below.
app.get('/public/:token', renderPublicStorePage);

const distPath = config.frontendDist;
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function start() {
  // ─── 0. Ensure the uploads directory exists before serving ────
  try {
    await fs.mkdir(config.uploads.dir, { recursive: true });
    console.log(`[Server] Uploads directory ready: ${config.uploads.dir}`);
  } catch (error) {
    console.error('[Server] Failed to create uploads directory:', error);
  }

  // ─── 1. Connect to MongoDB & run seed ─────────────────────────
  await connectDB();

  // ─── 1.0. Ensure the Free tier plan exists (core POS only). ───
  // Restaurants whose subscription period expires fall back to this plan
  // after the 2-day warning window instead of being suspended.
  await subscriptionService.ensureFreePlan();

  // ─── 1.1. Legal documents are NOT auto-seeded ────────────────
  // Legal content was historically seeded as drafts at startup. Per product
  // decision, the database starts clean — the platform ships with NO seeded
  // documents and the admin creates/publishes them through the legal admin
  // flow (POST /api/legal/admin/documents) when actually needed. Keeping this
  // empty means a fresh deployment never shows boilerplate legal text and the
  // removal of previously seeded documents stays durable across restarts.

  // ─── 1.5. Warm the IP blocklist cache ────────────────────────
  await refreshIpBlocklist();

  // ─── 2. Initialize Response Cache backend (Redis preferred, fallback to in-memory) ─
  if (config.redisUrl) {
    const redisAdapter = new RedisAdapter(config.redisUrl);
    const connected = await redisAdapter.connect();
    if (connected) {
      responseCache.setAdapter(redisAdapter);
      console.log('[Cache] Using Redis backend');
    } else {
      console.log('[Cache] Redis unavailable; using in-memory backend');
    }
  } else {
    console.log('[Cache] No REDIS_URL configured; using in-memory backend');
  }
  responseCache.startCleanup(2 * 60_000);
  // ─── 3. Start subscription state transition scheduler ─────────
  startSubscriptionScheduler();

  // ─── 3.1. Start the marketing delivery worker + scheduler ─────
  // Campaign delivery is queued in-process and drained by a background worker
  // (never inside an HTTP request). The marketing scheduler auto-activates/
  // expires offers, dispatches due scheduled campaigns, recovers stuck sends
  // and runs enabled automations — all idempotent across restarts.
  startCampaignWorker();
  startMarketingScheduler();

  // ─── 3.5. QR ordering seat-session sweeper ───────────────────
  // A table QR scan claims the table (Occupied) with a 10-minute TTL. If the
  // guest never orders and stops interacting, this sweeper expires the claim
  // and frees the table — it is never left Occupied for no reason. Once an
  // order is placed, occupancy is owned by the order and never expires here.
  try {
    const { startSessionSweeper } = await import('./modules/qr-ordering/services/sessionSweeper');
    startSessionSweeper();
    console.log('[QR] seat-session sweeper started (10-min claim TTL)');
  } catch (err) {
    console.warn('[QR] seat-session sweeper startup failed:', (err as Error)?.message);
  }

  // ─── 3.6. Log resolved AI/STT configuration for quick misconfiguration detection ─
  // Values here are the ones ACTUALLY used at runtime (auto-detection included),
  // so a wrong model/provider is visible in the boot logs immediately.
  const stt = getSTTConfig();
  console.log(`[Config] LLM provider=${aiConfig.provider}, model=${aiConfig.model}`);
  console.log(`[Config] STT provider=${stt.provider}, model=${stt.model || 'default'}`);

  // ─── 3.6. Hydrate AI quota snapshots from MongoDB so the admin dashboard's
  // per-key quota cards keep their rate-limit history across restarts. Best-
  // effort: a failure here only means quota history starts empty this boot.
  await hydrateQuotaFromDb().catch((err) =>
    console.warn('[AiQuotaTracker] startup hydration failed:', err?.message || err),
  );

  // ─── 4. Start HTTP server (with Socket.IO live layer) ─────────
  const server = http.createServer(app);
  initSocket(server);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`POS Backend running on http://localhost:${config.port}`);
    console.log(`API available at http://localhost:${config.port}/api`);
    console.log(`Live events (Socket.IO) attached on ws://localhost:${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
  });

  // ─── 5. Audit subsystem background tasks ──────────────────────
  try {
    const { startRetentionScheduler, ensureGlobalTtlIndex } = await import('./modules/audit');
    await ensureGlobalTtlIndex();
    startRetentionScheduler();
  } catch (err) {
    console.warn('[Audit] background scheduler startup failed:', (err as Error)?.message);
  }

  // ─── 6. Admin Reports nightly snapshot + inactive jobs ─────────
  try {
    const { startReportScheduler } = await import('./modules/adminReports');
    startReportScheduler();
    console.log('[Reports] nightly snapshot scheduler started');
  } catch (err) {
    console.warn('[Reports] background scheduler startup failed:', (err as Error)?.message);
  }
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

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
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { config } from './config';
import { connectDB, isConnected } from './db';
import { apiLimiter, publicLimiter, adminApiLimiter } from './middleware/rateLimiter';
import { securityHeaders } from './middleware/securityHeaders';
import { ipBlocklist, refreshIpBlocklist } from './middleware/ipBlocklist';
import { errorHandler } from './middleware/errorHandler';
import { responseCache } from './utils/ResponseCache';
import { RedisAdapter } from './cache/adapters';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Route imports
import authRouter from './routes/auth';
import sessionsRouter from './routes/sessions';
import adminRouter from './routes/admin';
import adminReportsRouter from './routes/adminReports';
import productsRouter from './routes/products';
import ordersRouter from './routes/orders';
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
import offersRouter from './routes/offers';
import loyaltyRouter from './routes/loyalty';
import otpRouter from './routes/otp';
import referralsRouter from './routes/referrals';
import campaignsRouter from './routes/campaigns';
import customerReportsRouter from './routes/customerReports';
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
import { startSubscriptionScheduler } from './modules/subscription/subscriptionScheduler';
import { getSTTConfig } from './modules/voice-inventory/services/SpeechService';
import { aiConfig } from './modules/ai/config';

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
app.get('/api/health', publicLimiter, (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dbConnected: isConnected(),
  });
});

// AI assistant routes
app.use('/api/ai', aiRouter);

// Voice inventory routes
app.use('/api/voice-inventory', voiceInventoryRouter);

// ─── Group B: Apply global rate limiter ─────────────────────────
app.use('/api', apiLimiter);

// ─── Group C: Business routes (behind rate limiter) ─────────────
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
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
app.use('/api/sync', syncRouter);
app.use('/api/qr-ordering', qrOrderingRouter);
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
app.use('/api', subscriptionRouter);
app.use('/api', offersRouter);
app.use('/api/loyalty', loyaltyRouter);
app.use('/api/otp', otpRouter);
app.use('/api/referrals', referralsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/customer-reports', customerReportsRouter);

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

const distPath = path.join(__dirname, '../../Frontend/dist');
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

  // ─── 3.5. Log resolved AI/STT configuration for quick misconfiguration detection ─
  // Values here are the ones ACTUALLY used at runtime (auto-detection included),
  // so a wrong model/provider is visible in the boot logs immediately.
  const stt = getSTTConfig();
  console.log(`[Config] LLM provider=${aiConfig.provider}, model=${aiConfig.model}`);
  console.log(`[Config] STT provider=${stt.provider}, model=${stt.model || 'default'}`);

  // ─── 4. Start HTTP server ─────────────────────────────────────
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`POS Backend running on http://localhost:${config.port}`);
    console.log(`API available at http://localhost:${config.port}/api`);
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

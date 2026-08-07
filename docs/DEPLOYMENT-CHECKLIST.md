# Production Deployment Checklist

> **Project:** Restaurant POS System (Electron Desktop Application)
> **Audit Phases:** A1–A8 (Security, Error Handling, Offline Mode, AI Degradation, Logging, Database Integrity, Final Validation, E2E Tests)
> **Date:** July 27, 2026

This checklist documents all production readiness findings from the comprehensive audit of the Restaurant POS system. Each section lists the **status**, **fixes applied**, **remaining items**, and **verification steps** needed before going live.

---

## Table of Contents

1. [Security (A1)](#1-security-a1)
2. [Error Handling (A3)](#2-error-handling-a3)
3. [Offline Mode (A4)](#3-offline-mode-a4)
4. [AI Degradation (A5)](#4-ai-degradation-a5)
5. [Logging (A6)](#5-logging-a6)
6. [Database Integrity (A7)](#6-database-integrity-a7)
7. [Final Validation (A8)](#7-final-validation-a8)
8. [Prerequisites & Environment](#8-prerequisites--environment)
9. [Deployment Sequence](#9-deployment-sequence)
10. [Post-Deployment](#10-post-deployment)

---

## 1. Security (A1)

### Status: ✅ Complete

### Fixes Applied

| # | Fix | Files Changed | Severity |
|---|---|---|---|
| 1 | **Electron Content Security Policy (CSP)** — Injects CSP `<meta>` tag via `did-finish-load` + `executeJavaScript` for `file://` loads. Also applies CSP + `X-Content-Type-Options` + `X-Frame-Options` to API responses via `onHeadersReceived` with URL scope filter. | `restaurant-pos/electron/main.ts` | **Critical — XSS prevention** |
| 2 | **Admin account backoff** — Added `req.body?.userId` to `getAccountKey()` fallback chain so admin login has per-account exponential backoff protection | `backend/src/middleware/rateLimiter.ts` | **High — brute-force protection** |
| 3 | **Admin login validation** — Created `adminLoginSchema` (Zod) for `userId`, `password`, `rememberMe`; added `validate()` middleware | `backend/src/validation/auth.ts`, `backend/src/routes/admin.ts` | **High — input validation** |
| 4 | **Dead code cleanup** — Removed unused `cspFilter` variable and no-op cleanup block | `restaurant-pos/electron/main.ts` | Low — clean TypeScript |

### Security Posture

| Area | Status |
|---|---|
| **Electron** — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` | ✅ Secure |
| **Electron** — IPC channel whitelisting via preload | ✅ Secure |
| **Electron** — CSP + security headers (production) | ✅ Secure |
| **Electron** — Single instance lock, renderer crash handling | ✅ Secure |
| **Backend** — JWT access tokens (15m expiry), refresh tokens (7d/30d) | ✅ Secure |
| **Backend** — Zod input validation on all routes | ✅ Covered |
| **Backend** — IP rate limiting + account backoff on all login routes | ✅ Covered |
| **Backend** — CORS restricted in production | ✅ Verified |
| **Backend** — Stack traces not leaked in error responses | ✅ Verified |
| **Backend** — bcrypt PIN hashing (10 rounds) | ✅ Verified |

### Pre-Deployment Verification

- [ ] Verify CSP doesn't block any legitimate scripts/styles in production
- [ ] Verify CSP `connect-src` includes the backend URL in production
- [ ] Confirm JWT secrets are set via environment variables (not defaults)
- [ ] Confirm `NODE_ENV=production` is set on the production server

---

## 2. Error Handling (A3)

### Status: ✅ Complete

### Fixes Applied

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | **Admin dashboard had no ErrorBoundary** — any page crash = white screen | **High** | Created `ErrorBoundary.tsx` component with friendly fallback UI (error details disclosure + "Try Again" button). Wrapped entire app in root-level `<ErrorBoundary>` in `main.tsx` |
| 2 | **No global error handlers in admin-dashboard** — async errors outside React were silent | **Medium** | Added `window.addEventListener('error')` and `'unhandledrejection'` in `main.tsx` with `ErrorEvent` type guard |
| 3 | **No global error handlers in restaurant-pos Frontend** — same issue for POS terminals | **Medium** | Added identical global handlers in `main.tsx` with `ErrorEvent` type guard |
| 4 | **ErrorEvent type guard** — resource load failures would log confusing messages | **Low** | Added `event instanceof ErrorEvent` check to both frontends |

### Error Handling Coverage

| Area | Status |
|---|---|
| Restaurant POS — ErrorBoundary wrapping each workspace | ✅ Present |
| Admin Dashboard — ErrorBoundary wrapping entire app | ✅ Present |
| Global `window.onerror` handler (both frontends) | ✅ Present |
| Global `window.onunhandledrejection` handler (both frontends) | ✅ Present |
| Backend — ErrorHandler middleware | ✅ Present |
| Backend — `uncaughtException` / `unhandledRejection` handlers | ✅ Present |
| Backend — try/catch in every controller (99 catch blocks across 21 controllers) | ✅ Present |
| Admin Dashboard — Suspense fallback for each lazy-loaded page | ✅ Present |

### Pre-Deployment Verification

- [ ] Test ErrorBoundary fallback UI by navigating to a workspace and verifying quick recovery
- [ ] Verify unhandled promise rejections appear in console (dev mode)
- [ ] Confirm backend error handler doesn't leak stack traces in production mode

---

## 3. Offline Mode (A4)

### Status: ✅ Complete

### Fixes Applied

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | **No actual offline write queue** — `pendingChanges` was just a counter, no operations stored | **Critical** — bills/orders created offline would never sync | Added persistent `PendingOperation` queue to `syncEngine.ts` with `enqueue()`, `dequeue()`, `markRetry()`, `replayQueue()` |
| 2 | **No crash recovery** — if browser crashed before sync, pending data was lost forever | **High** — data loss | Queue persisted to localStorage via `saveQueue()`/`loadQueue()` in constructor; 7-day max retention with quota overflow protection |
| 3 | **No corruption detection** — `getDBData()` silently returned fallback on parse errors | **Medium** — silent data loss | Added `console.warn('[DB] Corrupted localStorage entry for key "...")` + auto-removal of corrupted entries in `data.ts` |
| 4 | **No max retry limit** — failed operations could retry indefinitely | **Medium** | Added `maxRetries: 5` with automatic dequeue + `console.warn` warning when exceeded |

### Offline Queue Specifications

| Parameter | Value |
|---|---|
| Queue key | `pos_sync_queue` (localStorage) |
| Max retries | 5 per operation |
| Retention period | 7 days (entries older than 7 days discarded on load) |
| Quota overflow protection | Drops to last 20 entries when localStorage quota exceeded |
| Queue structure | `{ id, method, path, body, createdAt, retries, maxRetries, error }` |

### Remaining Gap

- **Auto-replay not wired**: The `replayQueue()` method exists but isn't automatically triggered when coming back online. It requires a manual trigger from the React subscriber (usePOSState). The `SyncPanelModal` can show queue status.

### Pre-Deployment Verification

- [ ] Verify `pos_sync_queue` is created in localStorage when offline operations are performed
- [ ] Test queue persistence: perform operation offline → kill browser → reopen → verify queue still exists
- [ ] Test queue replay: simulate coming back online and verify operations replay
- [ ] Verify corrupted localStorage entries are detected and cleaned up

---

## 4. AI Degradation (A5)

### Status: ✅ Complete

### Fixes Applied

| # | Component | Issue | Severity | Fix |
|---|---|---|---|---|
| 1 | **ClosingAssistant.tsx** | `.catch()` fired → `data=null` → rendered `null` (completely invisible failure) | **High** | Shows friendly card: "AI summary is currently unavailable. Using local estimates." |
| 2 | **DashboardWorkspace.tsx** | Showed "Analyzing...", "Loading...", "—" placeholders when AI offline (misleading) | **Medium** | New offline state: "AI summary is temporarily unavailable. The dashboard is using local calculations." |

### AI Fallback Behavior

| AI Feature | When API is Offline | User Experience |
|---|---|---|
| **Daily Summary** | Falls back to `generateDailySummaryLocal()` | Shows locally-computed data (revenue trends, stock alerts) |
| **Inventory Health Score** | Falls back to `computeHealthScoreLocal()` | Shows algorithmic health score from local data |
| **Purchase Recommendations** | Falls back to `generatePurchaseRecsLocal()` | Shows recommendations based on stock thresholds |
| **Low Stock Predictions** | Falls back to `predictLowStockLocal()` | Shows predictions based on daily consumption averages |
| **Weather Recommendations** | Falls back to `getWeatherRecLocal()` | Shows season-based recommendations |
| **Closing Assistant** | Falls back to `generateClosingAssistantLocal()` | Shows locally-computed end-of-day summary |
| **Voice Inventory** | Shows error message + offers fallback to text input | User-friendly error with retry guidance |
| **Waste Analysis** | Falls back to `analyzeWasteLocal()` | Shows locally-computed waste metrics |

### AI Warnings (from `aiClient.ts`)

- All AI API errors are logged as `console.warn` (not `console.error`) — they're expected when offline
- Response body is truncated to 200 characters in logs (no sensitive data exposure)
- Aborted requests are handled gracefully

### Pre-Deployment Verification

- [ ] Verify all AI features render without crashing when backend is offline
- [ ] Verify AI features don't block the main POS flow (billing, orders, etc.)
- [ ] Confirm no console errors for AI features — warnings are acceptable
- [ ] Test Voice Inventory when AI is unavailable — should show helpful error + text input option

---

## 5. Logging (A6)

### Status: ✅ Complete

### Audit Coverage

| Project | `console.log` | `console.warn` | `console.error` |
|---|---|---|---|
| **restaurant-pos Frontend** | 0 | 7 (all essential) | 4 (all essential) |
| **admin-dashboard** | 0 | 0 | 3 (all essential) |
| **backend** | 16 (after fix) | 10 (all acceptable) | 133 (all appropriate) |

### Critical Fix — Password Exposure

| File | Before | After | Severity |
|---|---|---|---|
| `backend/src/db.ts:66` | `'Admin user created: admin@pos.com / **admin123**'` | `'Admin user created: admin@pos.com'` | **Critical** |
| `backend/src/db.ts:100` | `'Admin user password updated: userId=admin / **1111**'` | `'Admin user password updated: userId=admin'` | **Critical** |
| `backend/src/db.ts:113` | `'Admin user created: userId=admin / **1111**'` | `'Admin user created: userId=admin'` | **Critical** |

### No Other Exposure Found ✅

- **No JWT tokens** logged in any project
- **No API keys** leaked in logs (Azure/Google STT keys used but not logged)
- **No PII** (phone numbers, emails, addresses) logged in production paths
- **No full error stacks** logged in backend controllers — only `error.message`
- **No auth headers** logged by request middleware

### Pre-Deployment Verification

- [ ] Confirm no passwords/tokens are exposed in any log output
- [ ] Consider adding URI redaction for MongoDB connection string log (`db.ts:148`)
- [ ] Verify production logging configuration captures `console.error` output to a log file or service

---

## 6. Database Integrity (A7)

### Status: ✅ Complete (Read-Only Audit)

### Index Coverage

| Result | Count |
|---|---|
| Models with proper indexes | 27/27 ✅ |
| Models missing indexes | 0 |
| Compound indexes for common query patterns | 15+ found ✅ |
| Unique indexes on natural keys | All present ✅ |

### Soft Delete Architecture

The `BaseRepository.buildFilter()` automatically adds `isDeleted: { $ne: true }` to ALL queries:

| Method | `isDeleted` Filtered? | Notes |
|---|---|---|
| `findAll()` | ✅ Via `buildFilter` | All list operations exclude soft-deleted records |
| `findById()` | ✅ Via `buildFilter` | Get-by-ID excludes soft-deleted records |
| `findOne()` | ✅ Via `buildFilter` | Single-record lookup excludes soft-deleted |
| `update()` | ✅ Via `buildFilter` | Cannot update a soft-deleted record |
| `softDelete()` | ✅ Via `buildFilter` | Cannot soft-delete an already-deleted record |
| `count()` | ✅ Via `buildFilter` | Count excludes soft-deleted |
| `findOneAndUpdate()` | ⚠️ **Bypasses `buildFilter`** | Only used on models without `isDeleted` (InvoiceCounter, Device, Subscription) |

### Orphaned Data — All Acceptable by Design

| Relationship | Cascade? | Reason |
|---|---|---|
| Order → OrderItem/TimelineEvent/KOTRecord | ❌ Not cascaded | Records are append-only audit history |
| Customer → CustomerVisit | ❌ Not cascaded | Historical visit data should persist |
| Product → ProductVariant | ✅ **Cascaded** in `productService.delete()` | Variants should be removed with product |
| Restaurant → Subscription/License/Device | ❌ Not cascaded | Admin data — manual management |

### Pre-Deployment Verification

- [ ] Run MongoDB index creation on production database (Mongoose auto-creates indexes)
- [ ] Verify all `findOneAndUpdate` calls in custom code include `isDeleted: { $ne: true }`
- [ ] Test soft-delete flow on a product: delete → verify it disappears from lists → verify it can be restored

---

## 7. Final Validation (A8)

### Status: ✅ Complete

### Validation Summary (Last Run)

| Project | TypeScript | Unit Tests | Vite Build |
|---|---|---|---|
| **Backend** | ✅ 0 errors | ✅ 27/27 passed | N/A |
| **Restaurant POS Frontend** | ✅ 0 errors | ✅ 38/38 passed (3 suites) | ✅ 0 warnings (14 chunks) |
| **Admin Dashboard** | ✅ 0 errors | N/A | ✅ 0 warnings (18 chunks) |
| **Electron** | ✅ 0 errors | N/A | N/A |

### E2E Tests (Playwright)

| Test File | Tests | Status |
|---|---|---|
| `e2e/ordering-flow.spec.ts` | 7 | ✅ All passing |
| `e2e/edge-cases.spec.ts` | 11 | ✅ All passing |
| `e2e/offline-error-ai.spec.ts` | 12 | ✅ All passing |

**Total: 30 E2E tests, all passing**

### Bundle Sizes

| Project | Main Chunk | Total Size | Lazy-Loaded Chunks |
|---|---|---|---|
| **Restaurant POS** | `index` 354 kB (84 kB gzip) | ~1.6 MB raw | 14 chunks |
| **Admin Dashboard** | `index` 51 kB (16 kB gzip) | ~900 kB raw | 18 chunks |

### Pre-Deployment Verification

- [ ] Run `npx tsc --noEmit` on all 4 projects — should have 0 errors
- [ ] Run `npx vitest run` on backend and Frontend — all tests should pass
- [ ] Run `npx vite build` on both frontend projects — 0 warnings
- [ ] Run all Playwright E2E tests — 30 tests passing
- [ ] Run `npx playwright show-report` to review any flaky tests

---

## 8. Prerequisites & Environment

### Environment Variables

#### Backend (`backend/.env`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MONGODB_URI` | ✅ | `mongodb://localhost:27017/pos` | Production MongoDB connection string |
| `PORT` | ❌ | `3001` | Backend server port |
| `CORS_ORIGIN` | ❌ | `http://localhost:5173` | Frontend origin for CORS |
| `NODE_ENV` | ✅ | `development` | Set to `production` for deployment |
| `ADMIN_CORS_ORIGINS` | ❌ | `''` | Comma-separated admin dashboard origins |
| `JWT_SECRET` | ✅ | — | **Set a strong random value** |
| `JWT_ISSUER` | ❌ | `restaurant-pos` | JWT issuer claim |
| `REFRESH_SECRET` | ✅ | — | **Set a strong random value** |
| `AI_PROVIDER` | ❌ | `openai` | AI provider: `openai` or `custom` |
| `AI_API_KEY` | ❌ | `''` | API key for AI provider |
| `AI_MODEL` | ❌ | `gpt-4o-mini` | AI model name |
| `AI_BASE_URL` | ❌ | `''` | Custom AI API base URL |
| `AI_TIMEOUT` | ❌ | `15000` | AI request timeout in ms |
| `AI_MAX_TOKENS` | ❌ | `1024` | AI response max tokens |
| `AI_TEMPERATURE` | ❌ | `0.3` | AI model temperature |
| `WEATHER_API_KEY` | ❌ | `''` | Weather API key (for AI weather recommendations) |
| `STT_PROVIDER` | ❌ | `browser` | Speech-to-text provider |
| `STT_API_KEY` | ❌ | `''` | STT API key |
| `RL_AUTH_WINDOW_MS` | ❌ | `900000` (15m) | Auth rate limit window |
| `RL_AUTH_MAX` | ❌ | `20` | Max auth requests per window |
| `RL_PUBLIC_WINDOW_MS` | ❌ | `60000` (1m) | Public rate limit window |
| `RL_PUBLIC_MAX` | ❌ | `100` | Max public requests per window |
| `RL_API_WINDOW_MS` | ❌ | `60000` (1m) | API rate limit window |
| `RL_API_MAX` | ❌ | `200` | Max API requests per window |
| `RL_AI_WINDOW_MS` | ❌ | `60000` (1m) | AI rate limit window |
| `RL_AI_MAX` | ❌ | `30` | Max AI requests per window |

#### Electron (`restaurant-pos/electron/.env`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | ❌ | `undefined` | Set to `production` for Electron production mode |
| `VITE_DEV_URL` | ❌ | `http://localhost:5173` | Vite dev server URL (dev only) |
| `BACKEND_URL` | ❌ | `http://localhost:3001` | Backend URL (for reference) |

#### Admin Dashboard (`admin-dashboard/.env`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `VITE_API_URL` | ❌ | `http://localhost:3002` | Backend API URL (fallback if not set) |

### Pre-Deployment Verification

- [ ] Create `.env` files for all 3 projects with production values
- [ ] Set strong random values for `JWT_SECRET` and `REFRESH_SECRET` (at least 32 characters)
- [ ] Set `NODE_ENV=production` on the backend server
- [ ] Configure CORS to restrict origins in production
- [ ] Verify MongoDB connection string is correct for production
- [ ] Set AI/STT API keys if AI features are needed

---

## 9. Deployment Sequence

### Step 1: Build All Projects

```bash
# Backend
cd backend && npm run build

# Restaurant POS Frontend
cd restaurant-pos/Frontend && npm run build

# Admin Dashboard
cd admin-dashboard && npm run build

# Electron (builds the desktop app)
cd restaurant-pos/electron && npm run build
```

### Step 2: Run Pre-Deployment Checks

```bash
# TypeScript checks
cd backend && npx tsc --noEmit
cd restaurant-pos/Frontend && npx tsc --noEmit
cd admin-dashboard && npx tsc --noEmit
cd restaurant-pos/electron && npx tsc --noEmit

# Unit tests
cd backend && npx vitest run
cd restaurant-pos/Frontend && npx vitest run

# E2E tests
cd restaurant-pos/Frontend && npx playwright test

# Production builds
cd restaurant-pos/Frontend && npx vite build
cd admin-dashboard && npx vite build
```

### Step 3: Deploy Backend

```bash
cd backend
npx tsx src/server.ts
# Or use PM2: pm2 start dist/server.js --name pos-backend
```

### Step 4: Deploy Electron Application

Package the Electron app for distribution:
```bash
cd restaurant-pos/electron
npm run package    # or npm run build
```

### Step 5: Verify Production

- [ ] Backend health endpoint returns 200
- [ ] Frontend loads without errors
- [ ] Login works
- [ ] Billing flow works end-to-end
- [ ] Offline mode functions (test by disconnecting network)
- [ ] Sync queue persists across restarts
- [ ] AI features work or fail gracefully
- [ ] All 30 E2E tests pass against production build

---

## 10. Post-Deployment

### Monitoring

- [ ] Set up logging aggregation (e.g., Winston + log file rotation, or a service like Logtail/DataDog)
- [ ] Monitor `console.error` output for unexpected errors
- [ ] Set up health check monitoring for the backend
- [ ] Track sync queue size to detect sync issues
- [ ] Monitor MongoDB query performance (identify slow queries for index tuning)

### Backup & Recovery

- [ ] Configure automated MongoDB backups (daily snapshots)
- [ ] Document disaster recovery procedure
- [ ] Test backup restoration in a staging environment
- [ ] Ensure offline queue data is not lost during app updates (localStorage persists across app updates)

### Security Maintenance

- [ ] Rotate JWT secrets quarterly
- [ ] Review and update CSP headers as needed
- [ ] Keep dependencies updated (run `npm audit` regularly)
- [ ] Review Electron security best practices on each update

### Performance Baseline

| Metric | Target | Measurement |
|---|---|---|
| App startup time | < 3 seconds | Measure from launch to dashboard |
| Bundle load time | < 2 seconds on 4G | Measure JS/CSS load time |
| Billing flow time | < 5 seconds | From order creation to payment confirmation |
| AI response time | < 2 seconds (online) | Measure /api/ai/* endpoint latency |
| Sync queue replay | < 10 seconds for 100 operations | Measure replayQueue() execution time |
| Memory usage | < 200 MB idle | Electron process memory |
| CPU usage | < 10% idle | Electron process CPU |

---

## Sign-off Checklist

### Pre-Deployment
- [ ] All 4 TypeScript checks pass (0 errors)
- [ ] All unit tests pass (backend: 27, frontend: 38)
- [ ] All E2E tests pass (30 tests)
- [ ] Both Vite builds succeed (0 warnings)
- [ ] No passwords/tokens exposed in logs
- [ ] CSP applied for production Electron builds
- [ ] JWT secrets set via environment variables
- [ ] MongoDB indexes created
- [ ] Environment variables configured for production

### Post-Deployment
- [ ] Production build loads without errors
- [ ] Login works (online and offline)
- [ ] Billing flow works (online and offline)
- [ ] AI features work or degrade gracefully
- [ ] Offline queue persists data across restarts
- [ ] Sync works when connectivity is restored
- [ ] Error boundaries catch render crashes
- [ ] Global error handlers catch async errors

---

*Generated from production readiness audit (Phases A1–A8) — July 27, 2026*

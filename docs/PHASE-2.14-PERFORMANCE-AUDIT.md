# PHASE 2.14 — PERFORMANCE AUDIT (READ-ONLY)

**Date:** 06 Aug 2026
**Repo root:** `C:\Loyalty_POS system` (git `master`)
**Audit mode:** READ-ONLY. No source files modified. All findings verified against actual source/config files by 7 parallel inspection passes.

---

## 1. Executive Summary

The platform has a **sound performance foundation** — index-aware Mongo schemas, a Redis-capable response cache with tag invalidation, gzip compression, non-blocking request logging, correct code-splitting (admin), a cursor-paginated audit module, and a proper async export-job pattern in the admin-reports module. These are genuinely good building blocks.

However, there are **three systemic performance risks** that will dominate at scale:

1. **The POS `/api/sync` is a full, unbounded, cross-tenant replay** — it dumps the entire platform dataset on every terminal pull (`syncService.ts:23-56`), through unscoped repositories, with no watermark/cursor.
2. **The AI path blocks the HTTP response for up to 15s inline** with **no slow-request alerting** (`aiController.ts` awaits every LLM call; `analyticsService.slowEndpoints` is a hardcoded stub returning `[]`), and per-call cost/model tracking is broken (tokens discarded at `aiController.ts:40`).
3. **The POS frontend re-renders the entire App tree on every cart tap / keystroke**, and the custom memoization on `CartItemRow`/`ProductCard` is defeated because callbacks depend on `cartItems` (`useBilling.ts:148-173`).

Secondary but important: no TTL indexes anywhere (RefreshToken/OtpRequest/AIUsageLog/AuditLog/WebhookEvent accumulate forever), `match-after-$lookup` pipelines in `planService.ts:778-827`, an uncached `Subscription.findOne` on every feature-gated request, offset pagination without caps in the base repository (`limit || 0` = **unlimited**), several unbounded in-memory `Map` caches with no TTL sweep, no graceful shutdown, and a **critical cross-tenant cache-key collision** in `ResponseCache.ts` (cache key omits tenant identity → Restaurant A can receive Restaurant B's cached report data).

**Score: 62/100 — "Solid foundations, systemic scaling risks."**

---

## 2. Performance Score

| # | Dimension | Score | Verdict |
|---|---|---|---|
| 1 | Database Indexes | 70/100 | Good tenant-scoped coverage; no TTL, few createdAt gaps |
| 2 | Aggregation Pipelines | 55/100 | 3 HIGH-risk pipelines; no `allowDiskUse` anywhere |
| 3 | Query Plans & Profiling | 25/100 | Zero `.explain()`, `.hint()`, `.maxTimeMS()` |
| 4 | N+1 Queries | 50/100 | 6 confirmed N+1 loops, worst ≈300 trips/request |
| 5 | Pagination | 45/100 | Offset everywhere; audit cursor is the exception; `limit||0` footgun |
| 6 | Sorting | 50/100 | Good whitelists; 8 unindexed sorts |
| 7 | Filtering | 45/100 | Regex `$or` COLLSCANs over largest collections |
| 8 | Redis | 55/100 | Capable but optional; in-memory default; no runtime fallback |
| 9 | Caching | 55/100 | Tag invalidation good; **cross-tenant key bug**; 3 ad-hoc in-memory caches |
| 10 | Compression | 90/100 | gzip level 6, 1KB threshold — no changes needed |
| 11 | Rate Limiting Impact | 60/100 | No hot-path blocking, but per-process store + 120/min shared per IP |
| 12 | Background Jobs | 50/100 | Fire-and-forget setInterval; no overlap guards |
| 13 | Workers / Queues | 20/100 | None. All work on one event loop |
| 14 | Memory Usage | 55/100 | 3 unbounded Maps; whole-file Buffers on export |
| 15 | CPU / Event Loop | 45/100 | Inline PDF/XLSX, serial bcrypt, sequential snapshots |
| 16 | Large Collections | 55/100 | Append-only ledgers grow unbounded (no TTL) |
| 17 | API Latency | 60/100 | ~3-7ms middleware overhead; 15s AI outliers unlogged |
| 18 | AI Performance | 50/100 | Inline blocking, no streaming, broken cost tracking |
| 19 | Bundle Size | 60/100 | Admin excellent; POS 459KB eager entry + 936KB eager JS |
| 20 | Lazy Loading / Dynamic Imports | 75/100 | Admin 24/24 lazy; POS ~14/30 workspaces lazy |
| 21 | Frontend Rendering / React | 55/100 | Root-level state, memoization defeated on hot path |
| 22 | Virtualization | 30/100 | None anywhere; ReceiptHistory unbounded |
| 23 | Image Optimization | 60/100 | Lazy+sized product cards; no srcset/webp; remote host |
| 24 | Static Assets / CDN | 50/100 | No CDN, no max-age on express.static, ETag only |
| 25 | HTTP Transport | 65/100 | HTTP/1.1 only, no keepalive tuning, no HTTP/2 |
| | **WEIGHTED OVERALL** | **62/100** | **Solid foundations, systemic scaling risks** |

---

## 3. Scope & Method

- **Backend:** `backend/src` — 65 models, repositories, services, middleware, controllers, routes, `modules/{audit,adminReports,qr-ordering,voice-inventory,settings,subscription,ai}`, `server.ts`, `db.ts`.
- **POS frontend:** `restaurant-pos/Frontend` (React 19 + Vite 6).
- **Admin dashboard:** `admin-dashboard` (React 19 + Vite 8).
- **Method:** 7 parallel inspection passes (indexes, pipelines/N+1, caching/Redis/compression/rate-limit, background jobs/memory/CPU, API-latency/AI, pagination/sort/filter, frontend bundle/rendering) + direct reads of `server.ts`, `db.ts`, vite configs, and existing `dist/` artifacts.
- **Constraints:** Read-only. No code changed. No load testing performed (would require a running environment).

---

## 4. Database Indexes

### Strengths
- Tenant-scoped CRUD is **index-aware**: most schemas lead with `restaurantId` + `,createdAt` desc. Customer (13+ idx incl. text), Bill (12), AuditLog (26), AIUsageLog (17), Device (excellent isDeleted coverage), CashLedger — all carry targeted compound indexes for dashboard queries.
- Idempotency idioms are correct: `Bill.clientRef` partial unique per-restaurant, `Offer.couponCode` sparse unique, `Table.number` unique, `ItemAlias.canonicalName`.
- FIFO pool index `{customerId, remaining, expiresAt}` on LoyaltyTransaction is well-designed.

### Gaps (file:line)
| Issue | Location |
|---|---|
| **No TTL indexes anywhere** (0 `expireAfterSeconds` matches) — RefreshToken, OtpRequest, AIUsageLog, AuditLog, WebhookEvent, VoiceAuditLog, QROrderingSession, AuditExportJob all accumulate unbounded | `RefreshToken.ts:34`, `OtpRequest.ts:37`, `AIUsageLog.ts:143-151`, `AuditLog.ts:123-138`, `WebhookEvent.ts:35` |
| **`Order` has no `restaurantId` field/index at all** (multi-tenant gap); `TakeawayOrder` same | `Order.ts:78-82`, `TakeawayOrder.ts:53` |
| Restaurant has **no `createdAt` index** though growth aggregations query it | `Restaurant.ts:193-194` |
| **Dead index** `{happenedAt:1}` on a non-existent field (real field is `occurredAt`) | `modules/adminReports/models.ts:170` |
| Global uniques not tenant-scoped → cross-restaurant collision: `HeldOrder.clientId`, `Employee.username` | `HeldOrder.ts:29`, `Employee.ts:35` |
| `AuditLog.minimize:false` inflates append-only writes with `{}` Mixed objects | `AuditLog.ts:119` |
| Repository returns **full hydrated docs, no `.lean()`/`.select()`** — WebhookEvent `payload`, AuditLog Mixed fields | `baseRepository.ts:63-69` |
| No `syncIndexes()`/index migration path for existing large DBs | `db.ts:129` (bare `mongoose.connect`) |
| Product multikey array indexes on up-to-200-element alias arrays; `branchPrice` Map unindexable | `Product.ts:151-153` |

---

## 5. Aggregation Pipelines

### Critical
| # | Pipeline | Location | Risk |
|---|---|---|---|
| 1 | AI latency histogram — `$sort {latencyMs:1}` → `$group {$push}` over all-time data, **no `allowDiskUse`** | `aiAnalyticsService.ts:551` | HIGH — unbounded memory sort + giant `$push` |
| 2 | `planService` subscription stats — **`$lookup` FIRST → `$match` after** across Payment/Device/Branch/AIUsageLog | `planService.ts:778-827` | HIGH — scans 4 collections, joins everything to subscriptions |
| 3 | `searchAnalytics` — `$or` of case-insensitive regexes defeats `{feature,createdAt}` compound | `aiAnalyticsService.ts:1101-1148` | MEDIUM-HIGH |

### Moderate
| # | Pipeline | Location | Risk |
|---|---|---|---|
| 4 | Dashboard — Subscription `$group` with **no match** (full scan) | `analyticsService.ts:246` | Full sub collection per load |
| 5 | All-time revenue — Payment `$group` no date filter | `analyticsService.ts:447` | Whole success-payment history |
| 6 | Growth charts — Restaurant `$group` on `createdAt` with **no index** | `analyticsService.ts:351-485` | Full scan |
| 7 | DAU-login chart — regex `/LOGIN/` on `action` | `analyticsService.ts:315` | Kills `action` index |
| 8 | Voice analytics — **7 sequential aggregates** per call, no caching | `voice-inventory/services/AnalyticsService.ts:79-213` | Query amplification |

**Global:** No `allowDiskUse` anywhere (0 matches). No `.explain()`, `.hint()`, `.maxTimeMS()` anywhere. Deprecated `.count()` in `sessionService.ts:79`.

---

## 6. Query Plans & Profiling

- **No query-plan tooling exists**: zero `.explain()`, `.hint()`, or `.maxTimeMS()` in the entire backend.
- Slow-query logging is absent (MongoDB profiling never enabled).
- **API latency analytics are a stub**: `slowEndpoints` is hardcoded `[]` at `analyticsService.ts:989`; the admin "API latency" panel actually reports **AI** latency (`AIUsageLog.latencyMs`) as `averageLatency` at `analyticsService.ts:966-971`.

---

## 7. N+1 Queries

| # | Location | Loop | Round-trips |
|---|---|---|---|
| 1 | `adminSubscriptionsController.ts:63-94` | `subscriptions.map` → Restaurant.findById + Branch.count + plan | **~300/request** (worst) |
| 2 | `modules/adminReports/aggregations/owners.ts:66-91` | `for owner` → 4 queries each | ~200-250 |
| 3 | `modules/adminReports/aggregations/inactive.ts:116-146` | `for ALL restaurants` → 3-4 queries each | 3-4×N |
| 4 | `controllers/adminSupportController.ts:46-63` | `restaurants.map` → findOne×3 + count | ~60-120 |
| 5 | `services/campaignService.ts:202-209` | `for phone of audience` → sendChannel | per recipient, unbounded |
| 6 | `services/customerReportService.ts:37-44` | loads **all** customers+bills+referrals+coupons+rewards (`Reward.find` unfiltered global scan), then JS sort/slice | whole collections in RAM |

**Positive model:** `deviceService.ts:370-406` uses grouped `$in` lookups — the anti-N+1 pattern to replicate.

---

## 8. Pagination

- **Offset pagination everywhere** (`skip=(page-1)*limit`) — O(offset) deep pages. Only the audit module uses **cursor** pagination (`queryService.ts:224-280`, `{createdAt,_id}` base64url cursor, cap 200).
- **FOOTGUN:** `const limit = pagination?.limit || 0` at `baseRepository.ts:59` — limit `0` in Mongoose means **no limit → returns the entire collection**. No max cap in the repo layer.
- `findAll` runs a duplicate `countDocuments` on every page (`baseRepository.ts:70`).
- Uncapped client-controlled `limit`: `offersController.ts:40-42`, `expenseService.ts:69-77`, `customerService.ts:107`, `loyaltyService.ts:853`, `voiceInventoryController.ts:666`, `aiAnalyticsController.ts:46`.

### Unbounded full-collection endpoints
| # | Endpoint | Location | Risk |
|---|---|---|---|
| 1 | `GET /api/sync` — full replay of 10 collections, no since/limit, 6 via **unscoped** BaseRepository (cross-tenant dump) | `syncService.ts:23-56` | **CRITICAL** |
| 2 | `GET /api/bills` — full append-only ledger, no page/limit | `billService.ts:107-120` | HIGH |
| 3 | `GET /api/products` — full catalog, sort `name` unindexed | `productService.ts:64-68` | MEDIUM |
| 4 | `GET /api/employees` — unscoped repo → all restaurants' staff | `employeeService.ts:19-29` | HIGH (tenant) |
| 5 | `GET /api/branches` — no pagination | `branchService.ts:23-29` | LOW |
| 6 | Subscription Payment/Invoice history — full fetch | `subscriptionService.ts:447-448` | MEDIUM |

---

## 9. Sorting

- **Good pattern:** whitelist-based `parseSort` (`utils/queryParser.ts:50-67`), audit `buildAuditSort` (`queryService.ts:138-143`), customer sortKey all index-backed.
- **Unindexed sorts:** `expenseService.ts:71` (arbitrary client `sortBy` — injection), `offersController.ts:42` (`sortOrder`), `productService.ts:68` (`name`), `billService.ts:119` (`createdAt` with no `{restaurantId,createdAt}` index), `adminSubscriptionsController.ts:34` (Subscription has **no createdAt index**), `restaurantService.ts:256` / `ownerService.ts:172` (name/lastLogin unindexed), `subscriptionService.ts:447`.
- Audit `durationMs`/`executionTimeMs` sorts unindexed.

---

## 10. Filtering

Index-defeating filters on the **largest collections**:
| # | Location | Construct | Impact |
|---|---|---|---|
| 1 | `audit/queryService.ts:69-83` | `$or` of **10 case-insensitive regexes** over AuditLog (incl. `details.*` subdocs) | COLLSCAN of biggest collection; repeated per page + export |
| 2 | `analyticsService.ts:240,316,796-811,960` | `/LOGIN|FAIL|DENIED/i` regex on `action` | kills action index |
| 3 | `customerService.ts:80-91` | `$regex` on name/email/gst — though model has an **unused `$text` index** | COLLSCAN |
| 4 | `expenseService.ts:58-61` | `$regex` on description/vendor/notes | COLLSCAN |
| 5 | `restaurantService.ts:190` | `$or` regex over 11 fields, no text index | COLLSCAN |
| 6 | `billService.ts:117` | `restaurantId:{$in:[restaurantId,null]}` | weak index usage |

---

## 11. Redis

- **Optional and off by default.** `server.ts:286-297`: `RedisAdapter` only if `REDIS_URL` set AND `ping()` succeeds; else `InMemoryAdapter` forever (single boot-time decision, no runtime downgrade — Redis outage after boot degrades to full cache-miss/DB).
- Retry: `lazyConnect` + explicit connect, 5 attempts, `maxRetriesPerRequest:3` (fails fast).
- **Not used for** rate-limit stores, subscription caching, or job queues.
- No `shutdown()` wired into process exit.

---

## 12. Caching

| Cache | Location | Type | TTL | Eviction |
|---|---|---|---|---|
| ResponseCache | `utils/ResponseCache.ts` | Redis or in-memory | per-route (15s-1h) | tag invalidation + TTL sweep (2min, unref) |
| cacheService (AI aggregates) | `services/cacheService.ts:19` | **Map** | 300s | **none** — expired keys never swept (leak) |
| LLM response cache | `modules/ai/services/aiService.ts:42` | **Map** | 60-300s | only if `size>500` (grows unbounded beyond) |
| reportCache | `modules/adminReports/cache/reportCache.ts:21` | **Map** | none | **only on explicit invalidation** (leak) |
| defaultPlan | `adminSettingsController.ts:49` | module var | forever | none |
| ContextManager | `voice-inventory/services/ContextManager.ts` | Map | 5min | ✅ proper sweep + MAX 1000 cap (**best-behaved**) |

### 🔴 CRITICAL — cross-tenant cache-key collision
`ResponseCache.generateKey` (`utils/ResponseCache.ts:103-129`) builds the key from `method:path?sortedQuery` **only — no tenant/restaurant/branch identity**. POS `/api/reports/*` are tenant-scoped but `reportQuerySchema` has no `restaurantId` field and branchId/dates are optional. **Restaurant A's `/api/reports/sales/summary` cache entry is returned to Restaurant B** — cross-tenant data leak. `cached` middleware returns the stored body with no tenant check.

### Invalidation gaps
`reports`, `admin-reports`, and `festivals` tags have **NO invalidators** — they decay only by TTL (30-120s / 1h), so dashboards show stale data. `restaurants` tag partially invalidated.

---

## 13. Compression & HTTP Transport

- **Compression: excellent.** `compression({ threshold: 1024, level: 6 })` at `server.ts:139-144`, correctly mounted after body parsing, before routes. Gzip only (no Brotli) — acceptable.
- `express.static` emits ETag/Last-Modified but **no `max-age`** (`server.ts:261-264`) → clients revalidate every asset.
- No HTTP/2, no `keepAliveTimeout`/`serverTimeout`/`headersTimeout` tuning (`server.ts:310`).
- No `Cache-Control` on API JSON (server-side value cache only, not HTTP cache).

---

## 14. Rate Limiting Impact

| Limiter | Window | Max | Key | Store |
|---|---|---|---|---|
| `authIpLimiter` | 15min | **10** | IP | in-memory MemoryStore |
| `accountBackoff` | dynamic (1s→1h exp) | fail≥3 | restaurant+phone/pin/username | custom Map |
| `publicLimiter` | 1min | 60 | IP | in-memory |
| `apiLimiter` | 1min | **120** | **IP (shared across all tenants)** | in-memory |

- **No hot-path blocking** — all sync Map operations. ✅
- **Per-process only** (no Redis store even when Redis configured) → multi-instance bypass + inconsistent windows.
- `apiLimiter` 120/min **per IP shared across all tenants behind a NAT** → a busy branch POS polling burst can hit legitimate 429s.
- `authIpLimiter` 10/15min per IP is very strict for shared-office login.

---

## 15. Background Jobs & Schedulers

| Job | Interval | File:line | unref | Overlap guard |
|---|---|---|---|---|
| Audit retention cleanup | 6h | `modules/audit/retentionService.ts:201-216` | ✅ | ❌ (serial per-row find+hold-check+create+delete) |
| Nightly report snapshots | 24h (+60s init) | `modules/adminReports/jobs/reportJobs.ts:81-84` | ✅ | ❌ (6 heavy aggs run **sequentially**, `for…of await`) |
| Subscription state transitions | 60s | `subscriptionScheduler.ts:10` | ❌ | ❌ |
| Rate-limiter account sweep | 60s | `middleware/rateLimiter.ts:41` | ❌ | ✅ (sync, cheap) |
| ContextManager cleanup | 5min | `ContextManager.ts:62` | ✅ | ✅ |
| ResponseCache cleanup | 2min | `server.ts:298` | ✅ | ✅ |

**Gap:** `loyaltyService.expirePoints` (`:796`) says "safe to run on a cron" — **no cron exists**; it only runs when an admin calls it (`loyaltyController.ts:181`). Points expiry is effectively manual.

---

## 16. Workers & Queues

- **None.** Confirmed absent: `worker_threads`, `child_process`, `cluster`, Bull/BullMQ/Agenda. Only `setInterval`/`setTimeout`/`setImmediate` on the single event loop.
- All CPU-heavy work (PDF/Excel generation, retention archiving, nightly snapshots, exports) **blocks the main thread** and is not crash-safe, replay-safe, or horizontally scalable.
- The admin-reports **async export job pattern** (`adminReports.ts:78-83` → poll → download, `setImmediate` at `reportExportService.ts:238`) is the correct model to generalize.

---

## 17. Memory Usage

- **Unbounded Maps:** `cacheService.ts:19` (no sweep), `aiService.ts:42` (only `size>500` check), `reportCache.ts:21` (no TTL sweep at all) — grow on long-lived processes.
- **Whole-file Buffers on export:** `fs.readFileSync` of entire files + `Buffer.concat` for XLSX/PDF/encrypted outputs — `reportExportService.ts:268,82,96,111-121`, `audit/exportService.ts:285,174-176`.
- **Bounded/correct:** ContextManager (MAX 1000), InMemoryAdapter (TTL sweep), accountStore (60s sweeper).
- `AuditLog.minimize:false` persists empty `{}` objects per write on a very-high-growth collection.

---

## 18. CPU / Event Loop

- **Inline PDF/XLSX export generation** (uncached, buffered, main thread): `analyticsExportService.ts:159,279` runs **8 heavy analytics functions in parallel** then builds multi-sheet workbook/PDF in the request. `reportsController.ts:243,246` same.
- **Serial bcrypt** (cost 10) over all Owner/Manager employees on refund/void verification — `billService.ts:225-236`.
- **Sequential awaited DB loops**: nightly snapshots `reportJobs.ts:44-53` (should be `Promise.all`), retention `retentionService.ts:93-123`, `loyaltyService.expirePoints:809-839`.
- Server: `app.listen` return value never captured → `server.close()` can never be called; **no SIGTERM/SIGINT handler**; `process.exit(1)` at `server.ts:247,252,337` without flush/disconnect; `disconnectDB()` exists but never wired.

---

## 19. Large Collections & Retention

| Collection | Growth | TTL | Notes |
|---|---|---|---|
| Bill | Very High | ❌ | append-only ledger |
| Order / OrderItem / BillItem | Very High | ❌ | no restaurantId index |
| AuditLog | Very High | ❌ | 26 indexes, 10-field regex COLLSCAN |
| AIUsageLog | Very High | ❌ | 17 indexes, unbounded |
| WebhookEvent | Very High | ❌ | big `payload` String returned in full |
| RefreshToken | High | ❌ | revoked/expired tokens never cleaned |
| VoiceAuditLog | High | ❌ | large transcript/parsedJson |
| LoyaltyTransaction | Very High | ❌ | (correctly retained — pool) |
| OtpRequest | Low | ❌ | minor |
| QROrderingSession | Low-Med | ❌ | should auto-expire |
| Customer | Med | — | has unused text index |

---

## 20. API Latency

- **Middleware overhead is low:** `requireAuth` ≈0.1ms (JWT sync), no blacklist/user DB read on normal requests (stateless). ✅
- **Uncached subscription/entitlement DB reads on every feature-gated request** (`subscriptionMiddleware.ts:34,77`, `entitlementService.canUseFeature:39`) — 1-2 `Subscription.findOne` per request ≈ **3-7ms added** on all AI/reports/customers/branches/expenses/finance routes. Admin adds `Authorization.findOne` per request (`authorizationMiddleware.ts:34`).
- `requestLogger` measures `durationMs` but **no slow-request threshold/alert exists** (`requestLogger.ts:101`).
- **Worst single request:** `adminSubscriptionsController` ≈300 DB round-trips; dashboard analytics ≈10-20 aggregates.

---

## 21. AI Performance

- **Inline blocking:** every AI controller awaits the full LLM round-trip (up to 15s) before responding — `aiController.ts:58,74,90,112,128,145,161,185,214`; voice `AIParser.ts:124,159`.
- No streaming (full `response.json()` buffering), `maxConcurrency 5`, circuit breaker 3 failures/30s cooldown.
- **Cost/model tracking broken:** `aiController.trackUsage` (`:40`) passes only `{restaurantId, feature, spelling, latency}` — tokens/model/provider are discarded → `AIUsageLog` stores `totalTokens=0, cost=0, model='', provider=''`. Voice `complete()` calls not recorded at all.
- Cache hit returns `latency 0` (per-process Map, TTL 60-300s).
- CircuitBreaker `Promise.race` timeout rejects but does **not** abort the underlying fetch (`CircuitBreaker.ts:188`) — connection released late.

---

## 22. Bundle Size

| | POS | Admin |
|---|---|---|
| Entry `index-*.js` | **459 KB (eager)** | 55 KB (eager) |
| Total eager JS | **~936 KB** | ~470 KB |
| CSS | 119 KB | 68 KB |
| Gzip est. | ~330-360 KB | ~150-170 KB |
| vendor-motion | **126 KB eager** (via DashboardWorkspace) | n/a |
| recharts | 403 KB (lazy ✅) | 429 KB (lazy ✅) |

- POS eagerly imports the entire core flow: `DashboardWorkspace` (791 lines), `OrderManager` (906), `KitchenDisplay` (501), 15 modals, `api/client.ts` (2182), `usePOSState.ts` (1449), sync engine → 459KB entry.
- Admin: 24/24 routes lazy, lean shell — **excellent**.
- Vite version skew: POS Vite 6 vs Admin Vite 8.

---

## 23. Lazy Loading / Dynamic Imports

- **Admin: perfect** — all 24 routes `React.lazy` + per-route Suspense (`routes/index.tsx:32-55`).
- **POS: partial** — `safeLazy` around ~14 secondary workspaces (`App.tsx:81-94`); the core POS flow (billing grid, cart, kitchen, order manager, dashboard, modals) is **eager** for offline-first reasons. Splitting is by workspace switch, not router.
- Single `<Suspense>` + `<ErrorBoundary key={activeWorkspace}>` at `App.tsx:1209-1215`.

---

## 24. Frontend Rendering / React Performance

### Hot-path failures (POS)
1. **Every cart tap / keystroke re-renders the ENTIRE App tree** — `usePOSState` holds all ~60 `useState` slices at root (`usePOSState.ts:390-511`); its `return useMemo(...)` lists every var as a dep (`:1261`), defeating its own "stable reference" purpose.
2. **Memoization defeated on the hot path:** `CartItemRow.areEqual`/`ProductCard.areEqual` compare callback identity, but `handleAdjustQuantity`/`handleAddProductToCart` deps include `cartItems` (`useBilling.ts:148-173`) → every cart mutation recreates callbacks → every row + every card re-renders. Fix: functional updaters `setCartItems(prev=>…)` + `[]` deps.
3. **Totals recomputed 3-6× per render** without `useMemo` — `CartPanel.tsx:194-211` + `useBilling.ts:88-131` chain (subtotal→discount→taxes→grand-total, each re-reducing all items).
4. **1Hz re-renders:** `RestaurantFloorPlan.tsx:228` and `OrderManager.tsx:167` call `useCurrentTime()` at parent → whole tree re-renders every second.
5. `BillingProductGrid.tsx:43-58` recomputes `filteredProducts` + per-category filter on every render (O(categories×products)).
6. No `useDeferredValue`/`useTransition` anywhere (search filters sync on every keystroke).
7. Inline closures in `App.tsx:1276-1344` defeat remaining memoization.
8. Admin contexts not value-memoized (`AuthContext.tsx:105`, `SidebarContext.tsx:17`) — minor.

**Good:** `useCurrentTime` correctly scoped in leaf `TableCard`/`TakeawayCard`/`AppTitleBar`; heavy `useMemo`/`useCallback` in `usePOSState` filtering; `React.memo` on 10+ leaf components.

---

## 25. Virtualization, Images & Static Assets

### Virtualization — none anywhere
- No `react-window`/`@tanstack/react-virtual` in either frontend (0 matches).
- **`ReceiptHistory.tsx:258` renders the entire unbounded bills array** — the real exposure (thousands of `<tr>`).
- `ProductManager:595`, `KitchenDisplay:271-317`, `OrderManager:497`, `RestaurantFloorPlan:645`, `inventory/ItemsPage:219` render-all — bounded by menu/floor size (acceptable).
- `CustomerManager:350` (20/page) and `ReportsManager:190` (15/page) are client-paginated ✅; admin `Table.tsx:88` server-paginated ✅.

### Images
- Product images lazy + container-sized + `onError` hide (`ProductCard.tsx:133`) ✅; `ReceiptModal.tsx:264` has lazy+decoding+referrerPolicy ✅.
- **Unlazy:** `CartItemRow.tsx:79`, `AddOnModal.tsx:173`, `OffersManager:694,1238`, `ProductManager:605`, `ItemsPage:231,383`, `RecipeModal:595`.
- **No srcset / webp / dpr variants anywhere.** Product images are remote Unsplash URLs (`usePOSState.ts:174`).
- **No CDN**; no hashed asset pipeline for product images.

### Static assets
- POS has **no `public/` dir** (all remote/Tailwind); admin `public/` = favicon + icons only (tiny).
- Google Fonts preconnect/preload ✅ (`index.html:8-11`), CSP font whitelist ✅.
- No `max-age` on static serving; no Brotli; no HTTP/2.

---

## 26. Bottlenecks (ranked)

1. **`/api/sync` full cross-tenant replay** — unbounded payload, scales with whole platform, not per-restaurant. (`syncService.ts:23-56`)
2. **Cross-tenant cache-key collision** — correctness/security failure that also undermines cache trust. (`ResponseCache.ts:103-129`)
3. **POS frontend re-render storm on cart/search input** — full-tree re-render + defeated memoization on the highest-frequency interactions.
4. **AI inline 15s blocking with no slow-request detection** + broken usage tracking.
5. **No TTL/retention** — every append-only ledger and session store grows forever; refresh tokens/OTPs/webhooks never expire.
6. **In-memory offset pagination with `limit||0` footgun** — unlimited full-collection responses on sync/bills/products/employees.
7. **Heavy aggregation pipelines** — match-after-$lookup, all-time scans, unbounded latency `$push`, no `allowDiskUse`.
8. **All background work on one event loop** — exports/snapshots/retention block requests; no workers/queue; no graceful shutdown.
9. **Uncached per-request subscription/authorization DB reads**.
10. **Unbounded in-memory Map caches** (cacheService, aiService, reportCache).

---

## 27. Critical Slow Paths

| Path | Expected cost | Why |
|---|---|---|
| `adminSubscriptionsController.list` | ~300 DB round-trips | N+1 loop |
| `GET /api/sync` | platform-wide data dump | full replay, unscoped repos |
| `exportDashboardExcel/PDF` | 8 analytics functions + full in-memory workbook | sync, uncached, buffered |
| `POST /api/ai/...` (all features) | up to 15s | inline LLM await |
| `analyticsService.getDashboardStats` | ~16+ aggregates + counts | uncached at first hit, full scans on Payment/Restaurant/Subscription |
| `GET /admin/audit-logs?q=…` | COLLSCAN of largest collection | 10-field `$or` regex |
| `customerReportService.getReport` | all customers+bills+rewards in RAM + JS sort/slice | no DB-side aggregation |
| `aiAnalyticsService` p95/p99 | unbounded `$sort`+`$push` memory | no allowDiskUse |
| POS login → App mount | 936 KB eager JS parse/exec | eager imports, motion in critical path |

---

## 28. Files Inspected (key set)

**Backend:**
`server.ts`, `db.ts`, `config.ts`, `middleware/{requestLogger,rateLimiter,authMiddleware,authorizationMiddleware,subscriptionMiddleware,auditContextMiddleware}.ts`, `repositories/{baseRepository,tenantRepository}.ts`, `utils/{ResponseCache,queryParser,CircuitBreaker}.ts`, `cache/adapters.ts`, `services/{cacheService,analyticsService,aiAnalyticsService,aiCostConfig,planService,ownerService,restaurantService,syncService,billService,productService,employeeService,branchService,customerService,customerReportService,expenseService,loyaltyService,sessionService,deviceService}.ts`, `controllers/{authController,aiController,billsController,offersController,expensesController,adminSubscriptionsController,adminSupportController,adminSettingsController}.ts`, `modules/audit/{queryService,retentionService,exportService,models}.ts`, `modules/adminReports/{jobs/reportJobs,aggregations/{owners,inactive,ai},cache/reportCache,exporters/reportExportService,models}.ts`, `modules/voice-inventory/{services/{AnalyticsService,ContextManager,subscriptionScheduler},controllers/voiceInventoryController}.ts`, `modules/ai/{services/{aiService,aiUsageLogger,llmProvider},config}.ts`, `modules/subscription/{subscriptionService,subscriptionScheduler}.ts`, all 65 model files.

**Frontend:**
`restaurant-pos/Frontend/src/{App.tsx,main.tsx,index.css,types.ts,routes.ts}`, `hooks/{usePOSState,useBilling,useOrders}.ts`, `api/client.ts`, `components/{BillingProductGrid,CartPanel,CartItemRow,ProductCard,TableCard,OrderManager,KitchenDisplay,ReceiptHistory,RestaurantFloorPlan,DashboardWorkspace,CustomerManager,ReportsManager,AddOnModal,ReceiptModal}.tsx`, `dist/` artifacts, `vite.config.ts`, `package.json`, `index.html`.
`admin-dashboard/src/{main.tsx,routes/index.tsx,context/{AuthContext,SidebarContext}.tsx,components/ui/Table.tsx}`, `vite.config.ts`, `package.json`, `index.html`.

---

## 29. Implementation Matrix

> Read-only audit — recommendations only. Priority = impact × effort.

| Priority | Action | Area | Effort | Impact |
|---|---|---|---|---|
| **P0** | Fix cross-tenant cache key — include restaurantId/branchId/role in `generateKey` (or per-tenant cache namespace) | Caching | S | Critical (data leak) |
| **P0** | Make `/api/sync` incremental: tenant-scoped, `since` watermark / cursor / `updatedAt` index, per-collection limits | Sync/Pagination | M | Very High |
| **P0** | Add TTL indexes (`expireAfterSeconds`) on RefreshToken, OtpRequest, QROrderingSession, AuditExportJob, WebhookEvent, AIUsageLog (retention window) | DB | S | High |
| **P1** | Move AI off the request path: async/streaming or job-based; add slow-request threshold in requestLogger; fix `slowEndpoints` to real latency aggregation | AI/API | M | High |
| **P1** | Fix AI usage tracking — surface provider `usage`/`model` in `trackUsage`; record voice `complete()` calls | AI | S | High |
| **P1** | POS re-render: functional `setCartItems` updaters + `[]` deps (restore memoization); `useDeferredValue` on searches; `useMemo` totals | Frontend | M | High |
| **P1** | Cap pagination: enforce max limit in `baseRepository` (fix `limit||0`); server-paginate bills/products; cursor for sync | Pagination | S-M | High |
| **P1** | Reorder `planService` pipelines: `$match` before `$lookup`; add `allowDiskUse:true` to heavy aggregations | Aggregations | M | High |
| **P1** | Cache subscription/authorization lookups short-TTL keyed by restaurantId | Auth | S | Medium-High |
| **P1** | Graceful shutdown: capture `server`, wire SIGTERM/SIGINT → `server.close()` + `disconnectDB()` + clear intervals | Ops | S | Medium-High |
| **P1** | Replace N+1 admin lists (subscriptions/owners/support/inactive) with grouped `$in` queries (replicate deviceService pattern) | N+1 | M | High |
| **P2** | Audit free-text search → `$text` index or anchored regex; reuse Customer text index | Filtering | M | Medium-High |
| **P2** | Add TTL sweeps to cacheService/aiService/reportCache Maps | Memory | S | Medium |
| **P2** | Offload PDF/XLSX exports to the async job pattern (like adminReports) | CPU | M | Medium-High |
| **P2** | Add missing indexes: Restaurant `{createdAt}`, Subscription `{createdAt}`, Order `{restaurantId}`, Bill `{restaurantId,createdAt}`, fix dead `happenedAt` → `occurredAt` | DB | S | Medium-High |
| **P2** | POS bundle: lazy-load OrderManager/KitchenDisplay/modals; remove motion from eager DashboardWorkspace path; align Vite versions | Bundle | M | Medium |
| **P2** | Virtualize/paginate ReceiptHistory; scope 1Hz `useCurrentTime` re-renders to leaves | Frontend | M | Medium |
| **P2** | Add `max-age`/immutable on static assets; consider CDN for product images; add `srcset`/webp | Assets | S | Medium |
| **P3** | Rate limiting: Redis store, tenant-aware budgets, raise `apiLimiter` for POS bursts | Rate limit | M | Medium |
| **P3** | Move nightly snapshot/report chains to `Promise.all` + overlap guards; schedule `expirePoints` cron | Jobs | S | Medium |
| **P3** | HTTP/2, keepalive tuning, `serverTimeout`/`headersTimeout` | Transport | S | Low |
| **P3** | Brotli for static, cache-control headers on API | Compression | S | Low |

---

## 30. Bottom Line

**Performance score: 62/100.** The architecture is genuinely index-aware and caching-aware, compression is right, the admin frontend is excellently code-split, and the audit module sets the standard for cursor pagination and async exports. The gaps that will bite in production are **the unbounded/cross-tenant sync path, the cross-tenant cache-key bug, the POS re-render storm, inline blocking AI, missing TTL retention, and the absence of any worker/queue layer** — plus a complete lack of query-plan and slow-request observability. The single highest-leverage bundle of fixes is **P0 (cache-key identity + incremental sync) + P1 (AI off the hot path + POS functional updaters + pagination caps)**.

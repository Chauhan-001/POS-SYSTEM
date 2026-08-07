# PHASE 2.10 — ADMIN REPORTS (PLATFORM-LEVEL)
## ENTERPRISE IMPLEMENTATION AUDIT

Audit type: **Read-only**. No code was modified.

Scope: `C:\Loyalty_POS system\backend` and `C:\Loyalty_POS system\admin-dashboard`.

**Important framing:** this is the ADMIN (platform-level / SaaS-operator) reporting
system — *not* the per-restaurant, customer-facing Reports module (Phase 1.8,
`restaurant-pos` / `modules/reports`). All findings below concern platform-wide
aggregates for SaaS administration.

Every finding was verified against the actual source. Where a metric "exists", it
is implemented somewhere on the platform; where it is marked "missing", no code or
data source produces it.

---

## SECTION 1 — EXECUTIVE SUMMARY

**Overall completion: ≈ 42 %** (for a complete enterprise Admin Reporting system)

**Production readiness: 4 / 10**

The platform has a solid, real, backend-driven **analytics fragment layer**
(dashboard stats, subscription revenue, AI usage/cost, device analytics, growth,
churn, API requests, enterprise audit) but it is **not a unified Admin Reporting
system**. There is **no platform-level revenue engine** (no MRR/ARR/refunds/
forecast/segmentation), **no AI revenue/profit**, **no inactive-restaurant report**,
**no feature-adoption report**, **no platform owner-activity rollup**, and **no
central reporting hub page** — the `/reports` route is a restaurant deep-link
landing, not an admin reports console. The dedicated AI dashboard pages **do not
compile/build** (missing MUI dependency + a bad module import), leaving the 
"AI Revenue" domain non-functional in the UI.

### Implemented modules (real, backend-driven)
- Dashboard KPIs + growth/churn/device/API/activity analytics (`analyticsService.ts`).
- Subscription revenue (payment aggregation, gateway split, date filter).
- AI usage/cost/token/latency analytics (Phase 2.7) — backend extensive, frontend broken.
- Device statistics & trends.
- Subscription / plan statistics.
- Support ticket counts (status/priority only).
- Enterprise Audit Log (Phase 2.9) + its own CSV/JSON/XLSX/PDF async signed/encrypted export.

### Missing modules (no implementation)
- **MRR / ARR / recurring-revenue recognition** (zero matches in backend).
- **Revenue segmentation** (subscription vs AI vs add-on vs merchant sales).
- **Refunds / failed-payment nuance** (Payment model has no refund, and failed count only via one query).
- **Revenue forecast**.
- **AI revenue / profit** (cost-only; no billing model).
- **Inactive-restaurant bucketed report** (never-activated / 7 / 30 / 90 / no-login / no-billing / no-POS / no-inventory).
- **Feature-adoption rollup** (cross-tenant).
- **Platform-wide owner-activity report** (only per-owner statistics).
- **Support SLAs / response-time / resolution-time / agent-performance / category rollups**.
- **DAU/MAU / login-frequency-per-feature**.
- **Region / plan / owner growth rollups**.
- **Report/analytics generation audit trail** (`report.exported`/`analytics.exported` declared but never emitted).

### Strongest areas
- AI usage analytics backend (`aiAnalyticsService.ts`, `AIUsageLog` — real tokens/cost/model/latency).
- Enterprise Audit Log with tamper-proof chain, integrity verification, async signed+encrypted export (Phase 2.9).
- RBAC: **every** admin analytics route sits behind `requireAuth` + `requireCollectionAccess(...)`.
- Response caching (in-memory/Redis) + TTL invalidation on analytics.
- Device analytics (`deviceService.statistics()`, 6-month trends).

### Weakest areas
- Revenue intelligence (MRR/ARR/forecast/refunds/segmentation) — **entirely absent**.
- Frontend: broken AI pages block the build; no unified admin-reports hub.
- Support analytics (thin), inactive-restaurant churn, feature adoption — absent.
- Data accuracy: churn "cancelled/expired" matches a status set that **does not exist** on `Subscription`.

### Enterprise readiness: **Not ready.** Functional as a monitoring dashboard, not as an
analytics/reporting platform (no warehouse, no materialized store, no global sales rollup, no revenue engine, live multi-collection aggregations at request time).

### Critical blockers
1. Frontend production build **fails** on `AIUsage.tsx`/`AiUsageDashboard.tsx` (MUI not installed) and `aiUsageAnalytics.ts` (`import api from './api'`, no such module) — `/ai-usage` is dead and blocks the whole dashboard build.
2. **No revenue engine** (MRR/ARR/refunds/forecast/segmentation) — the core of enterprise admin reporting.
3. **No AI revenue** — can only report cost, not monetization.
4. **Churn/expired data-accuracy bug** — `Subscription` has no `expired`/`cancelled` status enum values, yet churn queries filter on them (matches nothing → silently wrong totals).

---

## SECTION 2 — REPORTING ARCHITECTURE

### Findings
- **No centralized reporting engine.** There are dispersed services:
  - `backend/src/services/analyticsService.ts` (platform live-aggregates: dashboard, growth, churn, activity, api-requests, devices, AI)
  - `backend/src/services/aiAnalyticsService.ts` (AI usage/cost/token/latency)
  - `backend/src/services/analyticsExportService.ts` (CSV/XLSX/PDF of dashboard)
  - `backend/src/services/planService.ts` (`statistics()` — plan-scoped)
  - `backend/src/services/supportTicketService.ts` (`getTicketStats()`)
  - `backend/src/services/deviceService.ts` (`statistics()`)
  - `backend/src/services/ownerService.ts` (`getStatistics()`)
  - `backend/src/modules/audit/statsService.ts` (audit stats)
  - `backend/src/modules/reports/*` (restaurant-scoped, Phase 1.8 — not platform)
- **No `modules/analytics` directory** — the "analytics module" is these disjoint services.
- **Data aggregation layer:** MongoDB aggregation pipelines executed **live per request**. No warehouse, no OLAP, no dedicated analytics DB.
- **Materialized snapshots:** only restaurant-scoped `DailySummary` / `MonthlySummary` / `YearlySummary` exist (`backend/src/models/`), rebuilt via `POST /api/reports/summaries/rebuild` (`modules/reports/controllers/reportsController.ts:208`). **They are not consumed by any platform analytics endpoint** — so all platform numbers recompute over transactional tables each call.
- **Background jobs:** `setInterval` only — no cron/Agenda/Bull:
  - Subscription scheduler (60 min) — `modules/subscription/subscriptionScheduler.ts:299`
  - Audit retention scheduler (6 h) — `modules/audit/retentionService.ts:201`
  - Audit export job queue — in-process `setImmediate` (`modules/audit/exportService.ts:256`)
  - Rate-limiter reset, cache cleanup, voice context timers.
  - **No scheduled report/materialization/pre-aggregation job.**
- **Caching:** `utils/ResponseCache` with `InMemoryAdapter` (D) or `RedisAdapter` (`cache/adapters.ts`); all `/admin/analytics/*` GETs use `cached({ttlMs})` (30s–5min) with tag invalidation. AI analytics additionally use a 5-min in-memory `Map` (`services/cacheService.ts`) that is **not shared across instances** despite a Redis comment.

### Answers
- Centralized reporting engine? **No.**
- Reports generated consistently? **No** — each service aggregates independently; restaurant-scoped summaries are not rolled up.
- Calculations duplicated? **Yes** — revenue/churn computed in at least `analyticsService`, `planService`, and `financeService` (per-restaurant), plus the dashboard, all separately.
- Real-time or batch? **Real-time (live aggregation on every request), with short TTL cache.** No batch/warehouse layer.

---

## SECTION 3 — ADMIN DASHBOARD

Page: `admin-dashboard/src/pages/Dashboard.tsx` (627 lines, auto-refresh 60s), data from `GET /admin/analytics/dashboard` → `getDashboardStats()`.

- **Exists:** 8 stat cards (Total Restaurants, Active Restaurants, Total Owners, Active Devices, Active Subscriptions, Subscriptions Expiring, Today's Logins, AI Requests — lines 206–213), Growth Metrics table (216–256), AI analytics 7-day (258–296), Device analytics (298–351), API request analytics (353–383), Churn & Retention (385–417), Activity metrics (419–449), Recent activity + latest restaurants (451–555), Subscription overview (557–606), Quick actions (608–624).
- **Charts:** recharts (area/bar/line) — real data, no mock.
- **Filters / date selection / comparison periods / drill-down:** **None** on the dashboard.
- **Export buttons:** **None** on the dashboard page (exports accessible only via the analytics `/export/*` routes and audit export).
- **Loading / empty / error states:** loading skeletons present; the page is generally robust.

### Metric checklist
| Metric | Status |
|---|---|
| Total Restaurants | ✅ | 
| Active Restaurants | ✅ |
| Inactive Restaurants | 🟡 computed as `total - active`; no bucketed report |
| Revenue | 🟡 only subscription payments; no general platform revenue |
| Subscriptions | ✅ counts + expiring |
| AI Revenue | 🔴 **Missing** (nothing; cost-only in AI panel) |
| Support Tickets | 🔴 not on dashboard (only separate `/support`) |
| Device Count | ✅ active devices + device block |
| Platform Usage | 🟡 logins/API-requests/activity; no DAU/MAU |
| Feature Adoption | 🔴 **Missing** |

**Verdict: dashboard = a KPI/monitoring wall, not an Admin Reports system.**

---

## SECTION 4 — RESTAURANT GROWTH REPORTS

Backend: `analyticsService.getGrowthMetrics()` (`services/analyticsService.ts:624`) + `server.ts` routes.

| Metric | Status | Evidence |
|---|---|---|
| New restaurants (daily/weekly/monthly/yearly) | ✅ | `GET /admin/analytics/growth`; `getAnalyticsData()` growthDaily/Weekly/Monthly/Yearly (`analyticsService.ts:456–485`) |
| Total/active/suspended counts | ✅ | `getDashboardStats()` |
| Churn (suspended, churn rate, churnByMonth) | ✅ (partial accuracy) | `getChurnMetrics()` (`:735`) |
| Latest restaurants | ✅ | `GET /admin/analytics/latest-restaurants` |
| Trial conversion | ✅ (subscription-derived) | `getChurnMetrics().trialConversions` |
| **Growth by region/city/state** | 🔴 Missing | `Restaurant` has `city/state/country` (`models/Restaurant.ts:50–54`) but **no aggregation groups by them** |
| **Growth by plan** | 🔴 Missing (per-plan only) | `planService.statistics()` groups by plan per-plan, no global mix |
| **Growth by owner** | 🔴 Missing | no platform query of restaurant creation by owner |
| **Activation** (activation-date time-series) | 🔴 Missing | only inferred `isActive` boolean |
| **Deletion trend** | 🔴 Missing | counts exclude deleted; no deletions-over-time endpoint |

**Data source:** `Restaurant`, `Subscription` collections — live aggregation. **History:** only from existing document `createdAt`. **Exports:** via `analyticsExportService` dashboard export (limited).

---

## SECTION 5 — REVENUE REPORTS

- **Total revenue (all-time/period):** 🟡 `getSubscriptionRevenue()` (`analyticsService.ts:831`) groups by gateway (cash vs razorpay). Dashboard revenue charts (daily/weekly/monthly/yearly) exist.
- **MRR / ARR:** 🔴 **Missing.** Grep for `MRR|ARR|monthlyRecurring|annualRecurring|recurringRevenue` in `backend/src` → **zero matches**.
- **Subscription revenue:** 🟡 payments only.
- **AI revenue:** 🔴 Missing (see §7).
- **Add-on revenue:** 🔴 Missing (no add-on pricing model aggregated).
- **Payment revenue:** 🟡 via `Payment{status:'success'}`.
- **Refunds:** 🔴 **Missing** — `Payment` model (`models/Payment.ts:13`) has status enum `created|success|failed` only; **no refund concept/model anywhere**.
- **Failed payments:** 🟡 `getChurnMetrics().failedRenewals` counts `Payment{status:'failed'}` (30d) — count only.
- **Revenue growth %:** ✅ `getGrowthMetrics().revenueGrowth`.
- **Revenue forecast:** 🔴 Missing (only a code comment in `DailySummary.ts:8` mentions future AI forecasting).
- **Billing / payment / invoice / subscription data:** transactional collections only (`Payment`, `Invoice`, `Subscription`); merchant-level sales live per-restaurant in Daily/Monthly/Yearly Summary and are **not rolled up platform-wide**.
- **Currency / tax handling:** `Payment.currency` default `'INR'`; **no multi-currency normalization, no tax aggregation** in revenue analytics.

**Verdict: revenue reporting is payment-counting, not recurring-revenue analytics. Missing the core financial KPIs (MRR, ARR, refunds, forecast, segmentation).**

---

## SECTION 6 — SUBSCRIPTION REPORTS

Backend: `getDashboardStats().subscriptionCounts`, `getSubscriptionRevenue()`, `planService.statistics()`.

| Metric | Status | Evidence |
|---|---|---|
| Active subscriptions | ✅ | `subscriptionCounts` aggregation (`analyticsService.ts:246–299`) |
| Expired | 🔴 **Not a real status** | `Subscription.status` enum = `trial|active|grace|suspended` (`models/Subscription.ts:3,65`); **`expired`/`cancelled` are NOT enum values** |
| Cancelled | 🔴 Not a real status | same |
| Upcoming renewals (expiring 7d) | ✅ | `getDashboardStats().subscriptionsExpiring` |
| Plan distribution (global) | 🔴 Missing | only per-plan stats; no all-tenant plan-mix endpoint |
| Upgrade / downgrade counts | 🔴 Missing | routes `PUT /admin/subscriptions/:id/upgrade|downgrade` exist, but **no aggregation of change events** |
| Trial conversion | ✅ | `getChurnMetrics().trialConversions`; route `POST /admin/subscription-plans/trial-convert` |
| Subscription churn | 🟡 **BUG** | `getChurnMetrics()` filters `Subscription.countDocuments({status:{$in:['cancelled','expired']}})` (`:751,757`) — **matches nothing** because those statuses don't exist. Churn totals/rate/`churnByMonth` are effectively **zeroed/incorrect**. |
| Revenue by plan | 🟡 | `planService.statistics().revenue` (per-plan, `$lookup` on payments) |
| Pause/resume counts | 🔴 Missing | routes exist; no aggregation |

**Data-accuracy issue (§1, Critical blocker 4):** the churn pipeline queries a status set absent from the enum → platform churn is misreported.

---

## SECTION 7 — AI REVENUE REPORTS

**This is the most complete *usage* domain (Phase 2.7).** Source: `AIUsageLog` (`models/AIUsageLog.ts`) + `VoiceAuditLog`. Routes under `/admin/analytics/ai/*` (`admin.ts:310–358`): dashboard, tokens, requests, **cost**, latency, errors, models, restaurants, owners, features, voice, search, filters.

| Metric | Status | Evidence |
|---|---|---|
| AI requests | ✅ | `/ai/requests/*` |
| AI **cost** | ✅ | `/ai/cost/*` — USD cost from `aiCostConfig.ts`; per model/feature/restaurant/owner |
| AI usage / features / models / restaurants / owners | ✅ | `/ai/features`, `/ai/models`, `/ai/restaurants`, `/ai/owners`, `/ai/voice` |
| Voice / inventory / report / recommendation AI usage | 🟡 | these are `feature` string values; voice is a dedicated pipeline |
| AI cost per restaurant / per owner | ✅ | `/ai/cost/by-restaurant`, `/ai/cost/by-owner` |
| **AI revenue** | 🔴 **Missing** | `AIUsageLog` tracks **cost only** (`:47,105–108`); **no revenue/profit field, no AI billing, no per-restaurant price/margin**. `getCostSummary()` (`aiAnalyticsService.ts:446–478`) has no revenue. |
| **AI profit** | 🔴 **Missing** | cannot be derived (no revenue) |
| Token / model tracking | ✅ | input/output/total tokens; model & provider columns (`AIUsageLog.ts:44–46,50`) |

**Verdict: full usage/cost analytics; zero monetization analytics.**

---

## SECTION 8 — SUPPORT METRICS REPORTS

Backend: `GET /admin/support/tickets/stats` → `getTicketStats()` (`supportTicketService.ts:228`).

| Metric | Status |
|---|---|
| Total tickets | ✅ |
| By status | ✅ (byStatus map) |
| By priority | ✅ |
| Filter by restaurant / assignee | ✅ (query params) |
| Open / closed / resolved breakouts | 🟡 only byStatus; no semantic open/closed |
| **Average response time** | 🔴 Missing — `SupportTicket` has no `firstResponseAt` (only `closedAt`, `:78`) |
| **Average resolution time** | 🔴 Missing |
| **Tickets by owner** | 🔴 Missing |
| **Support agent performance** | 🔴 Missing |
| **SLA violations** | 🔴 Missing — no SLA fields |
| **Ticket categories rollup** | 🔴 Missing — only priority/status |
| **Satisfaction rollup** | 🔴 Missing (per-ticket field only) |

Integration with Support Center (Phase 2.8): **data exists**, but the reporting surface is a single counts endpoint.

---

## SECTION 9 — DEVICE REPORTS

Backend: `GET /admin/devices/statistics` → `deviceService.statistics()` (`deviceService.ts:908`); `GET /admin/analytics/devices` → `getDeviceAnalytics()` (`analyticsService.ts:574`, 6-month trends). Frontend `Devices.tsx`.

| Metric | Status |
|---|---|
| Registered devices | ✅ |
| Active/inactive (online/offline/pending/blocked) | ✅ `byStatus`, `byPlatform`, `byOs` |
| Device types / OS distribution | ✅ |
| Last activity | 🟡 stale-offline via `deviceService`; no age-bucketed inactive report |
| Restaurant device count | ✅ per-restaurant `statistics()` |
| **Failed / disconnected device aggregation** | 🔴 Missing — `deviceService` has `failedSyncCount`/`dbSyncStatus` but the analytics endpoint does not surface them |

**Verdict: solid device reporting.**

---

## SECTION 10 — PLATFORM USAGE REPORTS

Backend: `getActivityMetrics()` (`analyticsService.ts:786`), `getApiRequestAnalytics()` (`:946`), `getDashboardStats().todayLogins`, Audit+AI stats.

| Metric | Status | Evidence |
|---|---|---|
| Daily active restaurants | 🟡 proxy | `getAnalyticsData().dailyActiveRestaurants` — **AuditLog `entityType==='Restaurant'` proxy**, not true DAU |
| Monthly active restaurants (MAU) | 🔴 Missing | no unique-restaurant MAU |
| Login frequency | 🟡 totals only | `dailyLogins`, todayLogins; no per-module login frequency |
| Feature usage (POS/inventory/report/mobile) | 🔴 Missing | no platform per-feature event pipeline (per-restaurant `statistics()` only) |
| API usage | ✅ | `getApiRequestAnalytics()` |
| POS usage | 🔴 Missing platform-wide (per-restaurant only) |
| Inventory usage | 🔴 Missing platform-wide |
| AI usage | ✅ | AI analytics |
| Report usage | 🔴 Missing | no `report.exported` emission |
| Mobile app usage | 🔴 Missing | no mobile event collection surfaced |

**Event tracking:** the only real append-only usage/event stores are `AIUsageLog`, `VoiceAuditLog`, `AuditLog`, `DeviceActivity`, `CustomerActivity/Visit`, `InventoryEvent`, `WebhookEvent`. There is **no generic platform event/usage store** feeding a usage report.

---

## SECTION 11 — OWNER ACTIVITY REPORTS

Backend: `ownerService.getStatistics()` (`ownerService.ts:1138`), `loginHistory()`, `getActivityMetrics().ownerActivity` (AuditLog login regex, `:803`).

| Metric | Status |
|---|---|
| Owner logins | 🟡 counted (AuditLog regex) + per-owner login-history |
| Last active | ✅ per-owner statistics |
| Actions performed | 🔴 Missing — no per-owner action/settings-change audit rollup |
| Restaurants managed | ✅ |
| Feature usage | 🔴 Missing rollup (per-owner AI cost only via `/ai/owners`) |
| Support requests | 🔴 Missing |
| Subscription changes | 🔴 Missing |
| Settings changes | 🔴 Missing |

Integration: auth (`User`/Login), audit (`AuditLog.performedBy`), restaurant ownership (`restaurantService`) — **data exists but is not assembled into a per-owner activity report.** Analytics `ownerActivity` is a login-count proxy, not an action ledger.

---

## SECTION 12 — INACTIVE RESTAURANT REPORTS

**Effectively missing as a first-class report.**

- `getDashboardStats().inactiveRestaurants = total − active` (`:275`).
- `getChurnMetrics().inactiveRestaurants` uses `{isActive:false, updatedAt:{$gte: thirtyDaysAgo}}` (`:755`) — **logic is questionable**: counts inactive restaurants that were *updated recently* (arguably opposite of inactive).

| Metric | Status |
|---|---|
| Never activated | 🔴 Missing |
| Inactive 7 days | 🔴 Missing |
| Inactive 30 days | 🔴 Missing |
| Inactive 90 days | 🔴 Missing |
| No login | 🔴 Missing |
| No billing activity | 🔴 Missing |
| No POS activity | 🔴 Missing |
| No inventory activity | 🔴 Missing |
| Automation / alerts | 🔴 Missing (no inactivity-threshold job) |

The underlying data exists (`Restaurant.isActive`, `Device.lastActivityAt`, `Payment` existence, `Order`/`Bill`/`InventoryEvent` counts) but is **not assembled** into any inactivity report or alert job. **Definition of "inactive" is not established anywhere.**

---

## SECTION 13 — FEATURE ADOPTION REPORTS

**Missing as a platform-level report.**

- Per-restaurant feature counts exist in `restaurantService.statistics()` (`:1000–1039`: aiRequests, voiceRequests, bills, customers, loyaltyMembers, etc.).
- AI/voice have cross-tenant adoption signal (`/ai/features`, `/ai/voice`).
- **No cross-tenant feature-adoption database**, no aggregation of enabled features (`Subscription.features`) into adoption percentages, no tracking of inventory/voice/reports/loyalty/campaign/mobile adoption across tenants.
- **No adoption-percentage calculation** anywhere at platform scope.

| Track | Status |
|---|---|
| Inventory / AI / Voice / Reports / Loyalty / Campaign / Mobile adoption | 🔴 Missing (platform-wide) |

---

## SECTION 14 — FILTERING

- **Realized filter surfaces:**
  - `analytics.ts` filters — restaurants search/status, subscriptions filters, devices filters, AI dashboard **date range + search + feature/model filters** (`/ai/filters`, `/ai/search`).
  - `SubscriptionRevenue.tsx` — **date-range (start/end) filter**.
  - Audit log — rich filters (search/action/module/severity/entity/performer/date).
- **Missing/inconsistent across report domains:** no unified comparison periods, no region/plan/owner/revenue-range/feature filters on growth/revenue/adoption reports. Each screen implements its own filters ad hoc; there is **no shared report filter model/queryParser** reused platform-wide.

---

## SECTION 15 — SEARCH

- AI analytics: `GET /admin/analytics/ai/search` + `filters` — ✅ restaurant/owner/feature/model search.
- Restaurants/owners/subscriptions/support: per-list search (admin controllers use `queryParser` + regex).
- **No unified report-type search; no cross-domain search; no transaction/feature search.** "Search" is per-list, not a report capability.

---

## SECTION 16 — EXPORT SYSTEM

**Platform analytics exports** (`admin.ts:305–307`):
- `GET /admin/analytics/export/csv` → `exportDashboardCSV`
- `GET /admin/analytics/export/excel` → `exportDashboardExcel`
- `GET /admin/analytics/export/pdf` → `exportDashboardPDF`
- Implemented in `analyticsExportService.ts` (CSV via `exportToCSV`, XLSX via ExcelJS, PDF via PDFKit).
- **JSON export for platform analytics: 🔴 Missing** (JSON only via audit export, not the analytics dashboard).
- **Restaurant-scoped reports** (`modules/reports/services/exportService.ts`): `buildCsv`/`streamCsv`/`buildXlsx`/`buildPdf` (Phase 1.8).
- **Audit export (async, production-grade):** `modules/audit/exportService.ts` — CSV/JSON/XLSX/PDF, **SHA-256 signed**, optional **AES-256-GCM + scrypt encryption**, background in-process queue, status polling, signed download URL (`X-Audit-Signature`).

### Checklist
- Formats CSV ✅ / Excel ✅ / PDF ✅ / JSON 🟡 (audit only, not platform reports)
- Large datasets 🟡 (audit export streams; analytics exports synchronous — no pagination/streaming for large tenant counts)
- Background jobs 🟡 (only audit exports; platform analytics exports are synchronous request-time)
- Download security ✅ (signed URLs + signature header, audit export)
- Export history 🟡 (yes for audit `AuditExportJob`; none for analytics/report exports)
- **Report audit logging 🔴** — `actionRegistry.ts:205–206` registers `report.exported` / `analytics.exported`, but **no analytics/export call site emits them**. Analytics export is **not audited** (only the audit module's own `exportService` writes `audit.exported`). Violates §16 "Verify Report Exported event exists in Audit Logs".

---

## SECTION 17 — DATABASE

- **64 mongoose models** (`backend/src/models/`). Transactional/current-state collections dominate (`Restaurant`, `Branch`, `User`, `Device`, `Subscription`, `SubscriptionPlan`, `Payment`, `Invoice`, `Order`, `Product`, `Customer`, `SupportTicket`, etc.).
- **Event/time-series (append-only):** `AIUsageLog`, `VoiceAuditLog`, `AuditLog` (+`AuditChainMeta`, `AuditLogArchive`, `AuditExportJob`, `AuditAlert`, `AuditLegalHold`, `AuditSavedSearch`), `DeviceActivity`, `CustomerActivity`, `CustomerVisit`, `InventoryEvent`, `WebhookEvent`, `TimelineEvent`, `OfferAnalytics`, `CashLedger`, `LoyaltyTransaction`, `CouponRedemption`, `CampaignHistory`.
- **Materialized analytics store:** only `DailySummary` / `MonthlySummary` / `YearlySummary` (restaurant-scoped; **not used by platform analytics**).
- **No reporting database, no data warehouse, no OLAP store.** All platform reports are live aggregation over transactional/event tables.
- **Indexes:** good compound indexes on `AIUsageLog` (`createdAt`, `restaurantId+createdAt`, `ownerId+createdAt`, `feature+createdAt`, `model+provider+createdAt`, etc.); AuditLog has legacy + enterprise indexes. Others rely on per-field defaults.
- **Queries optimized?** 🟡 — aggregation over lived tables is indexed for the main axes, but there is no pre-aggregation; large-collection scans at request time are a scalability risk (§20).

---

## SECTION 18 — API QUALITY

- **Auth:** every route is behind `requireAuth`.
- **Authorization:** every route is behind `requireCollectionAccess(collection, action)` — **admin-only protection is present and consistent** (`admin.ts`, e.g. analytics uses `'Restaurant','read'`, `subscription-revenue` uses `'Subscription','read'`, owner analytics use `'User','read'`).
- **Validation:** strict Zod (`validation/*`), incl. audit schemas.
- **Caching:** `cached({ttlMs})` on analytics GETs + invalidation.
- **Pagination/sorting/filtering:** present on list endpoints (queryParser/audit cursor); aggregation endpoints return paginated/limited result sets.
- **Error handling / response format:** consistent `fail`/`ok`/`okWithMeta` (`utils/apiResponse`).
- **Rate limiting:** middleware + scheduler reset.

**Overall: API layer is high quality and correctly secured.**

---

## SECTION 19 — SECURITY

- **RBAC: ✅** — collection-level `Authorization` records; `admin` action grants all; seeded for bootstrap super_admin; Phase 2.9 added `AuditLog` collection.
- **Admin permission checks: ✅** every report/analytics route gated by `requireCollectionAccess`.
- **Sensitive financial data: 🟡** — revenue data is reachable via API but only through admin RBAC; **no extra field-level masking** for amounts.
- **Revenue access:** gated by `Subscription`/`Restaurant` read perms.
- **Owner data protection:** gating via `User` collection access.
- **Export permissions:** same RBAC gates the export routes.
- **Tenant isolation:** ⚠️ admin analytics return **cross-tenant aggregates by design** (that is the platform report). The concern is whether the `requireCollectionAccess('Restaurant','read')` requirement is strong enough — it is, for an admin-only surface. No role can reach these routes without an `Authorization` record granting it.
- **Audit logging: 🔴 (for reports)** — mutation endpoints are audited, but **report/analytics generation and analytics exports are NOT audited** (actions declared in `actionRegistry` but never emitted).
- **Data masking:** restricted to the audit read layer (`maskPii`, `[REDACTED]`); not applied to financial report payloads.

**Can unauthorized users access platform reports? No.** RBAC is consistently enforced at every analytics route.

---

## SECTION 20 — PERFORMANCE

- **Live aggregation over transactional tables** at request time (with 30s–5min TTL cache).
- **Caching:** ResponseCache + AI in-memory cache (5 min, non-shared across nodes).
- **Indexes:** good on AIUsageLog and AuditLog; analytical axes on other collections are partial.
- **Scalability:**
  - **100 restaurants:** ✅ fine.
  - **10,000 restaurants:** ⚠️ dashboard/aggregations still OK with indexes + cache, but synchronous analytics exports and no pre-aggregation will strain request time.
  - **100,000 restaurants:** 🔴 **Not viable** — per-request aggregations over `Payment`/`Subscription`/`AuditLog`/`AIUsageLog` and synchronous CSV/PDF generation would be slow and memory-heavy; no warehouse, no nightly materialization, no async report pipeline for platform reports.
- **Report generation time:** synchronous for analytics (except audit exports); memory usage for Excel/PDF scales with dataset size.
- **Database load:** aggregation-heavy; the 6h audit retention + 60m subscription schedulers are light.

---

## SECTION 21 — FRONTEND IMPLEMENTATION

- **Reporting pages:** Dashboard (KPI wall), Analytics.tsx (4 charts + most-active restaurants, `getAnalytics()`), SubscriptionRevenue.tsx (date filter, KPI cards, bar/pie, recent payments), Devices.tsx (stat cards), AuditLog.tsx (stats + integrity + alerts + export), AiUsage (broken page), ReportsConsole.tsx (restaurant deep-link, **not an admin reports hub**).
- **Charts:** **recharts ^3.10.1** (only chart lib). **MUI is NOT installed**, yet `AIUsage.tsx`/`AiUsageDashboard.tsx` import `@mui/material` → **build failure**.
- **Routing (`routes/index.tsx`):** `/reports` → ReportsConsole (restaurant landing); `/ai-usage` → `AIUsage` (broken); `AiUsageDashboard.tsx` is **unrouted/dead**. `/support`, `/settings` exist as routes but are **not in the sidebar**.
- **Filters:** SubscriptionRevenue (date), AI (intended, dead), Audit (rich). No unified report filters/comparison.
- **Export buttons:** only AuditLog has a real export system; `AIUsage`/`AiUsageDashboard` export buttons are **inert (no onClick) and on non-compiling pages**.
- **Responsive/loading/empty/error:** in-house `components/ui/*` (Card, Skeleton, EmptyState, ErrorPage) used across the working pages; **no loading/empty/error states on the broken AI pages** (they can't compile).
- **Permissions:** frontend relies on backend RBAC (routes redirect if 403); no role-based menu hiding implemented.
- **Types (`types/index.ts`):** no platform-level report/feature-adoption/inactive-restaurant/revenue-report interfaces.

**Critical:** the frontend does not currently **build** (`vite build` fails on AIUsage module graph). Any Phase 2.10 frontend work is blocked until AI pages are fixed or removed.

---

## SECTION 22 — TESTING

Existing suite: `backend/` — **33 files / 505 tests** (vitest). Coverage relates to the **audit module, support, media, services** — but:

- **No tests for `analyticsService`**, `aiAnalyticsService`, `analyticsExportService`, `getRevenue`, churn, growth, dashboard stats (grep: analytics service files are not under `__tests__`).
- **No permission/API tests** asserting admin-only analytics RBAC (only the audit/authorization middleware suites).
- **No calculation tests** for revenue/churn/MRR/adoption.
- **No export-content tests** for analytics CSV/Excel/PDF (audit export has round-trip tests; analytics export does not).
- **No performance/load tests.**
- **No frontend tests** for any report page.

| Type | Status |
|---|---|
| Unit | 🟡 (services, not analytics) |
| API | 🔴 |
| Permission | 🔴 (no analytics-RBAC assertions) |
| Calculation | 🔴 |
| Export | 🔴 (analytics), 🟡 (audit) |
| Performance | 🔴 |
| Regression | 🟡 (general 505 suite) |

---

## SECTION 23 — MOCK / HARDCODED DATA

- **Working pages (Dashboard, Analytics, SubscriptionRevenue, Devices, AuditLog):** all values come from backend API aggregation; **no hardcoded metrics, no dummy charts** (verified — `queryFn` from real clients).
- **AI pages:** authored to use the real API but **cannot compile** and the API client `aiUsageAnalytics.ts` imports a nonexistent module (`./api`), so the pipeline is broken — effectively **no functioning AI UI**.
- **No placeholder exports** found in code (analytics export service generates real files).
- **Risk:** the marketing/branding files (`CUSTOMER_WEBSITE.md`, docs) contain aspirational feature descriptions, but no production code path emits fake numbers.

**Verdict: no hardcoded/fake analytics in shipping code paths.**

---

## SECTION 24 — IMPLEMENTATION MATRIX

Legend: ✅ Full · 🟡 Partial · 🔴 Missing
Backend=API/services; Frontend=UI; Database=model/store; Security=RBAC/masking/audit; Testing=tests.

| Feature | Backend | Frontend | Database | Security | Testing | Status |
|---|---|---|---|---|---|---|
| Dashboard KPIs | ✅ | ✅ | 🟡 | ✅ | 🔴 | 🟡 |
| Restaurant growth (counts/trends) | ✅ | ✅ | 🟡 | ✅ | 🔴 | 🟡 |
| Growth by region/plan/owner | 🔴 | 🔴 | 🟡 | ✅ | 🔴 | 🔴 |
| Revenue (total) | 🟡 | ✅ | 🟡 | ✅ | 🔴 | 🟡 |
| **MRR / ARR** | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| **Revenue forecast** | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| **Refunds** | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| Revenue segmentation | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| Subscription analytics | 🟡 | ✅ | 🟡 | ✅ | 🔴 | 🟡 |
| Subscription churn (accuracy) | 🔴 (bug) | 🟡 | 🟡 | ✅ | 🔴 | 🔴 |
| **AI usage/cost** | ✅ | 🔴 (broken) | ✅ | ✅ | 🔴 | 🔴 |
| **AI revenue/profit** | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| Support metrics | 🟡 | 🟡 | 🟡 | ✅ | 🔴 | 🟡 |
| Support SLA/agent/category | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| Device analytics | ✅ | ✅ | ✅ | ✅ | 🔴 | 🟡 |
| Platform usage (DAU/MAU) | 🔴 | 🔴 | 🔴 | ✅ | 🔴 | 🔴 |
| Owner activity (platform) | 🔴 | 🔴 | 🔴 | ✅ | 🔴 | 🔴 |
| Inactive-restaurant report | 🔴 | 🔴 | 🟡 | ✅ | 🔴 | 🔴 |
| Feature adoption | 🔴 | 🔴 | 🔴 | ✅ | 🔴 | 🔴 |
| Filters (unified) | 🔴 | 🟡 | 🟡 | ✅ | 🔴 | 🔴 |
| Search (report) | 🟡 | 🟡 | 🔴 | ✅ | 🔴 | 🔴 |
| Exports CSV/Excel/PDF (admin) | ✅ | 🟡 | 🟡 | 🟡 | 🔴 | 🟡 |
| Exports JSON (admin) | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 |
| Async export jobs | 🟡 (audit only) | 🟡 | 🟡 | ✅ | 🟡 | 🟡 |
| **Report audit logging** | 🔴 | 🔴 | 🟡 | 🔴 | 🔴 | 🔴 |
| Data warehouse / materialization | 🔴 | — | 🔴 | — | — | 🔴 |
| Admin Reports hub page | 🔴 | 🔴 | — | — | — | 🔴 |

---

## SECTION 25 — PRODUCTION READINESS

| Context | Score | Rationale |
|---|---|---|
| **Single Restaurant** | 8 / 10 | per-restaurant Reports (Phase 1.8) are mature; merchant analytics via `statistics()`. |
| **Multi Restaurant (owner)** | 6 / 10 | per-owner stats, AI cost, support; but no owner-level finance/adoption/activity rollups. |
| **Enterprise SaaS (admin)** | 3 / 10 | no revenue engine, no warehouse, no inactive/churn/feature-adoption reports, broken AI UI, un-audited report generation, synchronous exports at scale. |

---

## SECTION 26 — FINAL VERDICT

**Overall completion: ≈ 42 %**
**Production readiness: 4 / 10 (not production-ready as an Admin Reporting system)**

### Critical missing features (priority order to implement)
1. **Fix the frontend build** — remove/replace MUI `AIUsage.tsx` + `AiUsageDashboard.tsx` (or port to the Tailwind kit) and fix `aiUsageAnalytics.ts` (`import api from './api'` → `./client`). This is the #1 blocker: it breaks the entire dashboard bundle.
2. **Revenue engine** — MRR, ARR, refunds, payment failure breakdown, revenue segmentation (subscription / AI / add-on / merchant sales), and forecast. Needs an `AddonOrder`/`Refund` concept (Payment has neither) or an analytics table.
3. **AI monetization** — add a billing/price/margin layer to `AIUsageLog` so revenue & profit can be computed (currently cost-only).
4. **Fix subscription churn** — align churn queries with the real `Subscription` status enum (`trial|active|grace|suspended`) or add `expired`/`cancelled` states; otherwise churn/churnByMonth are wrong.
5. **Inactive-restaurant report** — define "inactive" (no-login/no-billing/no-POS/no-inventory thresholds) and build 7/30/90-day + never-activated buckets, with a threshold job for alerts.
6. **Feature-adoption report** — adopt a platform event/usage store and aggregation of enabled/used features → adoption %s.
7. **Platform-wide owner-activity and support-SLA reports** — assemble existing audit + support data (add `firstResponseAt`/SLA fields).
8. **Audit report generation** — emit `analytics.exported`/`report.exported` from analytics/export services (actionRegistry already declares them).
9. **Admin Reports hub** — rebuild `/reports` (currently a restaurant deep-link console) as the platform reporting dashboard.

### Major bugs
- Subscription churn queries on non-existent status values (`expired`/`cancelled`) → silently wrong churn (§6, §12).
- `getChurnMetrics().inactiveRestaurants` uses `updatedAt >= 30d & isActive=false` → misidentifies active-inactive (§12).
- Frontend AI pages don't compile (MUI + `./api`) → `/ai-usage` dead and build broken (§21, §26).
- Merchant-level sales (`DailySummary`/`MonthlySummary`) are never rolled up platform-wide, so "revenue" ≠ total ecosystem revenue (§5, §17).

### Security risks
- Report/analytics generation and analytics exports are **not audited** (`report.exported`/`analytics.exported` unused) — sensitive financial report access has no trail (§19, §16).
- No field-level masking on financial report payloads (amounts, owner PII reachable in raw aggregate responses — RBAC gates access but there is no defense-in-depth redaction) (§19).

### Performance risks
- Live multi-collection aggregations at request time without a warehouse/nightly materialization; synchronous CSV/Excel/PDF generation; AI in-memory cache not shared across instances (§20).
- **At 100k restaurants this is not viable** without a reporting database and async export pipeline (§20).

### Recommended implementation order
1. Unblock the build (fix AI pages + module).
2. Fix churn/inactive data-accuracy bugs.
3. Ship the Admin Reports hub on top of existing analytics + add report audit logging.
4. Build the revenue engine (MRR/ARR/refunds/segmentation) + JSON export + async job pipeline.
5. Add AI monetization, inactive-restaurant, feature-adoption, owner-activity, and support-SLA reports.
6. Introduce a materialized/warehouse layer (nightly summaries) + Redis cache for scale.

---

### References (all verified)
- Backend services: `analyticsService.ts`, `aiAnalyticsService.ts`, `analyticsExportService.ts`, `planService.ts`, `supportTicketService.ts`, `deviceService.ts`, `ownerService.ts`, `financeService.ts` (per-restaurant).
- Models: `AIUsageLog.ts`, `Subscription.ts`, `Payment.ts`, `SupportTicket.ts`, `Restaurant.ts`, `DailySummary/MonthlySummary/YearlySummary.ts`, `audit/models.ts`.
- Routes: `backend/src/routes/admin.ts` (`/admin/analytics*`, `/admin/analytics/export/*`, `/admin/analytics/ai/*`, `/admin/support/tickets/stats`, `/admin/devices/statistics`).
- Audit: `modules/audit/exportService.ts`, `modules/audit/actionRegistry.ts`.
- Frontend: `pages/Dashboard.tsx`, `Analytics.tsx`, `SubscriptionRevenue.tsx`, `AIUsage.tsx` (broken), `AiUsageDashboard.tsx` (dead/broken), `ReportsConsole.tsx`, `Devices.tsx`, `AuditLog.tsx`, `routes/index.tsx`, `layouts/Sidebar.tsx`, `api/analytics.ts`, `api/aiUsageAnalytics.ts` (broken), `package.json` (recharts, no MUI), `types/index.ts`.
# PHASE 2.2 — RESTAURANT MANAGEMENT: Read-Only Implementation Audit

Date: 2026-08-03 · Scope: `backend/src` (adminRestaurantsController, adminSubscriptionsController,
adminOwnersController, adminDevicesController, adminPlansController, adminAnalyticsController,
adminReportsController, branchesController, subscription module, settings module, models, services),
`admin-dashboard/src`, `restaurant-pos/Frontend/src`, `backend/scripts`.
Method: Read-only inspection. Every claim cites file:line evidence. No code was modified.

Markers: ✅ Fully implemented · 🟡 Partially implemented · 🔴 Missing · ⚪ Mock/Fake/UI-only/Disconnected

---

## SECTION 1 — EXECUTIVE SUMMARY

- **Overall completion %: ~62/100**
- **Production readiness (/10): 6/10** (single restaurant) · 4/10 (multi-branch chain) · 3/10 (cloud SaaS scale)
- **Strongest areas:** Subscription lifecycle engine & scheduler, feature entitlement enforcement,
  settings module (versioned/rollback/audit), per-restaurant report/CRM/Finance consoles, real analytics
  aggregation (no fabricated stats).
- **Weakest areas:** Restaurant CRUD (no transaction/rollback, no validation layer, N+1 queries,
  no permanent/restore realisations), onboarding (no default branch/employee/settings, no rollback,
  no atomicity), owner identity inconsistency (owners dashboard vs createRestaurant), disconnected UI controls.
- **Architectural strengths:** Central `entitlementService`, `subscriptionMiddleware` (requireSubscription/
  requireFeature) used across 20+ routes, tenant-scoped `TenantRepository`, materialized summary rollups,
  subscription scheduler (trial→grace→suspended), audit logging (requestLogger + AuditLog).
- **Architectural weaknesses:** Business logic co-located in large controllers (adminRestaurantsController.ts
  is 768 lines of direct model calls — no service/repository separation), N+1 query patterns in list endpoints,
  no schema validation on admin mutation routes, multi-source feature-flag storage drift (Restaurant.feature
  flags vs Subscription.features vs plan.features), no server-side permanent-delete/restore, no Onboarding transaction.
- **Mock / Fake / UI-only / Disconnected:** 4 toast-only buttons in RestaurantDetails UI (Reset Password,
  Restart Sync, Regenerate Credentials), Settings tab is a hardcoded read-only badge display, Analytics tab is a
  static placeholder, standalone Subscriptions page is written but routed to `null` (unreachable), `qrOrderingRouter`
  imported in server.ts but never mounted. No hardcoded/fake backend statistics.
- **Disconnected modules:** `qrOrdering` (imported, not mounted — dead). Redis cache falls back to in-memory
  silently (acceptable). Owners dashboard is disconnected from `createRestaurant` path.
- **Security concerns:** `resetRestaurantPassword` returns the new PIN plaintext in the HTTP response; owner
  PIN stored on Restaurant doc (hashed, OK); admin mutation routes lack a validation layer; CORS wide-open in dev.
- **Multi-tenant readiness:** 🟡 strong tenant scoping (restaurantId) in repos/middleware/settings, but device
  objects are restaurant-only (no branch), user login model ambiguous, plan-limit enforcement is best-effort
  (list N+1, per-restaurant validation), no cross-tenant leak tests found.
- **Overall verdict:** Solid, real foundation for a single-to-few restaurant SaaS with working billing,
  entitlements and settings. It is NOT yet production-grade for multi-branch/chain/enterprise because critical
  lifecycle operations (delete/restore/permanent-delete, atomic onboarding, owner consistency, transaction
  safety, list scalability, route validation) are partial, untested, or missing.

---

## SECTION 2 — RESTAURANT CRUD

| Item | Status | Evidence |
|---|---|---|
| Create Restaurant | ✅ | `adminRestaurantsController.createRestaurant` :213–434; REST `POST /admin/restaurants` (admin.ts:100) |
| Read Restaurant | ✅ | `getRestaurant` :134–211, route admin.ts:95 |
| List Restaurants | ✅ | `getRestaurants` :19–132, route admin.ts:92 (search/sort/page/status/plan) |
| Update Restaurant | 🟡 | :441–496 — `$set: body` (no whitelist, no per-field validation) |
| Delete (soft) | 🟡 | :498–516 — sets isDeleted + cancels sub + deactives licenses; but **no Device/Employee/Branch handling**, **no audit entry**, **no restore** |
| Restore | 🔴 | No controller/route found |
| Permanent Delete | 🔴 | No hard-delete endpoint |
| Duplicate prevention | 🟡 | `restaurantId` unique index (Restaurant.ts:64); name not unique — only owner handles; no friendly conflict on create |
| Validation | 🔴 | No `validate()` middleware on any admin restaurant route; body via `adminRestaurantsController` manual checks |
| Uniqueness constraints | 🟡 | Only `restaurantId` unique (Restaurant.ts:64); email/GST/PAN/phone not unique |
| Business rules | 🔴 | None: e.g. cannot delete last branch not handled at restaurant level |
| Error handling | 🟡 | try/catch → 500 generic; no business-level error mapping except branch 403 |
| API consistency | 🔴 | Mixed shapes: `{data,total}` list vs `{id,...}` single vs `{message}` for mutations; mixed error key `{message}` vs `{error}` vs `{error,message}` |
| Tenant isolation | ✅ | CRUD always scoped by restaurantId on the Restaurant object (list filter :29) |
| Authorization | ✅ | All CRUD routes behind `requireAuth` + `requireCollectionAccess('Restaurant', …)` (admin.ts:92–102) |
| Audit logging | 🟡 | requestLogger writes mutation entries globally; Restaurant `auditTrail` used at create only; `invalidateCache` used |
| E2E wiring | ✅ | Admin UI fully calls `createRestaurant`/`update/delete/suspend/activate` (api/restaurants.ts:50–68; Restaurants.tsx:122–186) |

---

## SECTION 3 — RESTAURANT ONBOARDING

| Item | Status | Evidence |
|---|---|---|
| Owner creation | 🟡 | `createRestaurant` sets `ownerUserId`/`ownerPin` on the **Restaurant doc** (:271–272) but **creates NO `User` doc, NO `Employee` doc**. Verify: `adminRestaurantsController.ts` imports (1–17) exclude User/Employee; owners dashboard reads `User` role `owner` (adminOwnersController:24) |
| Restaurant creation | ✅ | Restaurant.create (:226) |
| Default configuration | 🟡 | Feature flags set from subscription mode (:339–345); but no default branch/device/floor/settings created |
| Default settings | 🟡 | Restaurant fields default in schema (Restaurant.ts:96–106); no `RestaurantSettings` doc auto-created at onboarding |
| Initial subscription | ✅ | createRestaurant creates Subscription (:370); modes cash/trial/create_only (:308–336) |
| Initial branch | 🔴 | **No head branch auto-created**. Branch creation is a separate explicit call (`POST /restaurants/:id/branches`, admin.ts:99) |
| Initial employee | 🔴 | No default owner Employee created (would be needed for POS employee login) |
| Initial permissions / RBAC | 🟡 | Owner inherits entitlement by plan; no explicit RBAC init row created at onboarding |
| Default feature flags | ✅ | driven by plan features (:339–345) |
| First login | ✅ | POS `FirstTimeSetup` when `ownerExists` table false (App.tsx:150); owner logs in via ownerUserId+PIN (authService:39–56) |
| Verification | ✅ | cash mode: real Payment + Invoice + counter (:376–408) |
| Rollback on failure | 🔴 | No transaction; `Restaurant.create` runs before subscription/payment — partial records left if planned later step throws |
| Partial-creation handling | 🔴 | No compensation/cleanup for partial onboarding |

---

## SECTION 4 — RESTAURANT STATUS MANAGEMENT

| Item | Status | Evidence |
|---|---|---|
| Activate | ✅ | `activateRestaurant` :529–538, route admin.ts:104 |
| Suspend | ✅ | `suspendRestaurant` :518–527, route admin.ts:103 |
| Deactivate | 🟡 | Only `isActive:false` (admin acts as pause); no explicit status enum to "deactivated" |
| Disable login | 🟡 | `suspended` sub → subscriptionMiddleware 403 (subscriptionMiddleware:41–48) blocks protected ops; login returns 403 IS AT auth (devicePolicy) |
| Subscription expiry handling | ✅ | Scheduler transitions trial/active→grace→suspended (subscriptionScheduler.ts:13–45) |
| Grace period | ✅ | `graceEnd` default +10d (Subscription.ts:50); used in scheduler |
| Trial handling | ✅ | `trial`→`grace`→`suspended` transitions |
| Grace landing | 🟡 | after suspended, `suspendRestaurant` sets sub `paused` (not a distinct state); no step to reopen |
| Blocked restaurants | ✅ | 403 bodies + `subscriptionMiddleware` |
| Reactivation | 🟡 | `activateRestaurant` flips `isActive` + sub `active` only (no re-check of expired/grace) |
| Status propagation | 🟡 | Restaurant `isActive` + Subscription status are independent; no single source; dev can drift (e.g., suspend sets sub paused, activate sets active) |

---

## SECTION 5 — RESTAURANT DELETION

| Item | Status | Evidence |
|---|---|---|
| Soft delete | ✅ | `deleteRestaurant` :498–516 (isDeleted true + deletedAt + isActive false) |
| Restore | ❌ | No endpoint/route |
| Permanent delete | ❌ | No endpoint |
| Cascade rules | 🟡 | flags sub cancelled + deactivates License; **no Device/Branch/BranchSettings/Employee/Data cleanup** |
| Referenced data | 🔴 | No sweep of branches, devices, products, bills, employees, settings |
| Historical record preservation | 🟡 | DB-Privacy best effort via soft-delete flag only |
| Audit preservation | 🟡 | Restaurant auditTrail kept; no dedicated deletion audit log |
| Subscription cleanup | ✅ | cancelled + endDate (deleteRestaurant :508) |
| Device cleanup | 🔴 | Devices not revoked on delete |
| Employee/User handling | 🔴 | User/Employee docs not disabled on delete |

---

## SECTION 6 — RESTAURANT SETTINGS

| Item | Status | Evidence |
|---|---|---|
| Restaurant profile | ✅ | model fields (Restaurant.ts:3–60) + display |
| Business info | ✅ | legalName/brand/cuisine/etc. surfaced in getRestaurant |
| GST | ✅ | `gst`/`gstEnabled` fields + finance consoles |
| Tax settings | 🟡 | `taxMode` field only; no full tax config |
| Currency | ✅ | `currency` default INR (Restaurant.ts:97) |
| Timezone | ✅ | `timezone` default UTC |
| Receipt settings | 🟡 | `printerType`,`receiptWidth` fields only |
| Printer settings | ✅ | real module settings = (printerController + Printer model) with test/CRUD |
| AI settings | ✅ | getAISettings/updateAISSettings (settings.ts admin) + AI module config |
| Loyalty settings | 🟡 | `loyaltyEnabled` flag + real loyalty module |
| Offline settings | ✅ | settingsService supports offlineMode/volume; `usePOSState` populates offline |
| Feature flags | 🟡 | `aiEnabled`,`loyaltyEnabled`,`weatherEnabled` on Restaurant; occasional plan-overridden |
| Persistence | ✅ | `RestaurantSettings` model (settings module) with device/branch/restaurant scope |
| Validation | 🔴 | no zod validation on restaurant-body changes; settings module uses `validate` |

---

## SECTION 7 — SUBSCRIPTION ASSIGNMENT

| Item | Status | Evidence |
|---|---|---|
| Subscription assignment | ✅ | createRestaurant assigns sub (:346–370); getStatus auto-creates (subscriptionService:61–75) |
| Upgrade | ✅ | adminSubscriptionsController:234–244 + POS changePlan; validateFeature? plan-only |
| Downgrade | 🟡 | admin:235–244 (plan swap, no usage check) — full validation lives in subscriptionService.changePlan (subscriptionService:535–589) + floor usage check |
| Renewal | ✅ | renewSubscription (adminSubscriptionsController:132–231) cash/invoice + extend 30d |
| Expiration | ✅ | scheduler + getStatus evaluation |
| Trial | ✅ | trial modes + ALL_TRIAL_FEATURES |
| Feature limits | ✅ | entitlementService + Router requireFeature-series |
| Usage enforcement | 🟡 | `currentDevices: 1 // TODO` hardcoded in subscriptionService.getStatus (line:143) — **placeholder**; enforce at device policy though |
| Plan synchronization | 🟡 | updateRestaurant re-syncs features/limits on plan change (adminRestaurantsController:450–488); but relies on caller |

---

## SECTION 8 — BRANCH MANAGEMENT

| Item | Status | Evidence |
|---|---|---|
| Branch count | ✅ | getSubscriptionUsage / getRestaurants |
| Branch statistics | ✅ | getBranchUsage/entitlementService.getBranchUsage |
| Default branch | 🔴 | No auto-created head branch at restaurant creation |
| Branch creation | ✅ | branchService.create (git + entitlement check) + admin/branches API |
| Branch deletion | ✅ | softDelete branchService.delete (cannot delete last) |
| Branch limits | ✅ | entitlementService.canCreateBranch |
| Multi-branch support | ✅ | POS branch selector + per-branch gating |
| Isolation | 🟡 | branch scoping enforced in queries, but device is restaurant-only (no branchId) — mixed isolation |

---

## SECTION 9 — DEVICE MANAGEMENT

| Item | Status | Evidence |
|---|---|---|
| Registered devices | ✅ | Device model + registerDevice (deviceRegistrationController:20–76) |
| Device limits | ✅ | devicePolicyService.getMaxDevices/enforceDevicePolicy (devicePolicyService:71–136) |
| Active devices | ✅ | count by isActive |
| Revocation | ✅ | admin block/unblock (adminDevicesController) |
| Device statistics | 🟡 | getDeviceActivitySummary counts events; no device rev-by-branch |
| Offline devices | 🟡 | activity log/status only |
| Sync | 🟡 | syncQueue localStorage-based (Frontend) exists |

---

## SECTION 10 — USAGE METRICS

All figures are real collection aggregations. ✅ for correctness.

| Metric | Status | Evidence |
|---|---|---|
| Revenue | ✅ | getSubscriptionRevenue (adminAnalyticsController:211) |
| Orders/Bills | ✅ | from reports services then aggregated → sales summary |
| Customers | ✅ | CRM customers real |
| Employees | ✅ | count in getSubscriptionUsage |
| Inventory | ✅ | admin inventory reports real |
| Storage | ❌ | no disk/storage metric found |
| API usage | 🟡 | Rate-limit + AI usage logged; no per-plan API quota enforcement/display |
| AI usage | ✅ | AIUsageLog + VoiceAuditLog counted (adminAnalyticsController:39–43) |
| Daily activity | ✅ | DailySummary bumped by billService (dailySummaryRepo) |
| Monthly/Yearly | ✅ | MonthlySummary/YearlySummary materialized (billService:183–210) |
| Aggregation accuracy | ✅ | aggregates from real bills/Daily/Monthly/Yearly, no fakes |

---

## SECTION 11 — SEARCH

| Item | Status | Evidence |
|---|---|---|
| Partial search | ✅ | regex `$options:'i'` on getRestaurants (adminRestaurantsController:31–38) |
| Case-insensitive | ✅ | `'i'` |
| Multiple fields | ✅ | name/legalName/brand/phone/email/gst/city/ownerName |
| Indexed search | 🟡 | relies on regex; indexes on base fields only, no text index |
| Safe query handling | ✅ | listers whitelist search to known fields; queryParser (utils/queryParser) used in owners |

---

## SECTION 12 — FILTERING

| Item | Status | Evidence |
|---|---|---|
| Status | ✅ | filter isActive |
| Subscription | ✅ | planFilter in getRestaurants (:24,61) |
| Owner | ❌ | no owner filter param on restaurants |
| Date range | ✅ | getSubscriptionUsage / getSubscriptionPayments start/end |
| RestaurantType | ✅ | model field |
| Plan | ✅ | filter.plan on listSubscriptions |
| Feature | ❌ | no feature filter |
| Branch | 🟡 | branch scoping per-view, not a list filter param |
| Active/Inactive | ✅ | status param |

---

## SECTION 13 — SORTING

| Item | Status | Evidence |
|---|---|---|
| Ascending | ✅ | sortOrder asc/1 sortBy |
| Descending | 🟡 | default -1 |
| Multiple fields | ❌ | only single sortBy |
| Default ordering | ✅ | createdAt default (getRestaurants :26) |

---

## SECTION 14 — PAGINATION

| Item | Status | Evidence |
|---|---|---|
| Page | ✅ | page param |
| Limit | ✅ | limit param capped 100 |
| Total | 🟡 | total computed from filtered `data.length` after planFilter skip (getRestaurants :126-127) — **not a true countDocuments total** |
| Total pages | 🟡 | computed from `validData.length / limit` not global total |
| Previous/Next | ✅ | frontend |
| Large dataset | 🟡 | skip/limit only + N+1 subqueries per row slow on large sets |

---

## SECTION 15 — RESTAURANT PROFILE

Profile is read-only display; brand/contact/address/legal info all modeled and surfaced (Restaurant.ts:66-128). Logo/cover: no upload endpoint found — ❌ logo/cover. Configuration completeness 🟡 (restaurant fields, no image/media).

---

## SECTION 16 — RESTAURANT STATISTICS

Backend aggregations are **all real** (no fakes — adminAnalyticsController). Revenue/Orders/Customers/Employees/Branches/Devices/Subscriptions covered; **Growth** (restaurant growth) ✅; **Activity** ✅; **Performance** 🟡 via report consoles. Frontend Analytics tab is a placeholder.

---

## SECTION 17 — BACKEND ARCHITECTURE

| Layer | Status | Evidence |
|---|---|---|
| Models | ✅ | dedicated models/Restaurant/Subscription/... |
| Controllers | 🟡 | over-fat (adminRestaurantsController 768 lines) — many direct model calls |
| Services | ✅ | entitlementService, branchService, subscriptionService, devicePolicyService, settingsService |
| Repositories | ✅ | baseRepository + tenantRepository (auth ) |
| Validation | 🔴 | no zod on admin rest assignment via adminRestaurants; only employees/auth/billing have validate |
| Middleware | ✅ | requireAuth, requireRole, requireCollectionAccess, requireSubscription, requireFeature |
| Caching | ✅ | `cached()` + responseCache (Redis/in-memory) |
| Indexes | 🟡 | Restaurant has 2 indexes, plus unique restaurantId; many refs lack indexes but have Schema index: 1 |
| Aggregation | ✅ | adminAnalytics + Daily/Monthly/Yearly |
| Transactions | ❌ | none found (createRestaurant not wrapped in session/transaction) |

---

## SECTION 18 — FRONTEND INTEGRATION

| Area | Status | Evidence |
|---|---|---|
| Restaurant list | ✅ | Restaurants.tsx (:122) |
| CRUD screens | ✅ | create/edit/delete wired |
| Forms | ✅ | wired |
| Validation | 🟡 | client-side form validation only; server no schema |
| Loading/Error | ✅ | present |
| Optimistic updates | 🟡 | some (delete) but but unscoped; no consistent optimistic pattern |
| Search/filter/pagination | ✅ | list |
| Statistics | 🟡 | Analytics tab placeholder (RestaurantDetails: as Placeholder) |

---

## SECTION 19 — SECURITY

| Item | Status | Evidence |
|---|---|---|
| Authentication | ✅ | JWT + refresh with session service; owner PIN login |
| Authorization | ✅ | requireAuth+requireCollectionAccess on admin |
| RBAC | ✅ | requireRole/requireFeature |
| Tenant isolation | ✅ | major repos scoped by restaurantId |
| Branch isolation | 🟡 | Device not branch-scoped; some branch objects click scoped |
| Sensitive data exposure | ❌ | `resetOwnerPassword` returns `newPin` in response (adminRestaurantsController:549); shell expose secretKey/apiKey in model (stored) |
| Ownership validation | 🟡 | owner owns doc; some could read via restaurantId (weak) |
| Audit logging | 🟡 | requestLogger audit now; Restaurant auditTrail sparse (create-only); admin updates don't append to auditTrail for restaurant |

---

## SECTION 20 — PERFORMANCE

- Indexes 🟡 (some compound only in RestaurantStatus/FullType; many `index:true` only)
- Aggregation ✅ (reports)
- Pagination 🟡 (count gap)
- Caching ✅ (ResponseCache for list/chart/analytics)
- **N+1 queries 🔴**: each restaurant row runs `Subscription.findOne`, `Device.count`, `Branch.count` (getRestaurants :59-64) — O(R) queries per page.
- Large datasets 🟡
- Scalability 🟡

---

## SECTION 21 — OFFLINE SUPPORT

- **Offline behavior:** ✅ localStorage cache; write-queue persisted (`pos_sync_queue` syncEngine).
- **Caching:** ✅ localStorage TTL cache.
- **Sync:** ✅ replay on re-connect + writes queue.
- **Conflict handling:** 🔴 no conflict resolution/versioning server-side.
- **Recovery:** 🟡 rehydration on network/restore only.

---

## SECTION 22 — TESTING

Backend vitest passes: **25 files / 252 tests** (from git-run earlier in this session). Frontend 51 tests.

| Type | Status | Notes |
|---|---|---|
| Unit test | ✅ | services/utils (session, queryParser, entitlement? check) |
| Integration | 🟡 | subscription tests present (subscription/__tests__/) |
| API tests | ❌ | no supertest of admin restaurant routes found |
| Authorization tests | ❌ | no authz tests for restaurant endpoints found |
| Validation tests | 🟡 | some utils; no body validation |
| CRUD tests | ❌ | no restaurant CRUD route test |
| Search/pagination tests | 🟡 | queryParser util test only |
| Statistics tests | ✅ | reports/closingSummaryExport tests present |

---

## SECTION 23 — MOCK / DEAD CODE

- **Hardcoded data:** `currentDevices: 1 // TODO` (subscriptionService:143); feature-catalog/doc `featureCatalog` in getSubscriptionUsage (admin restaurant) is a static map (not data-drift — UI labels) ✅ real.
- **Unused service:** 🟡 `qrOrderingRouter` imported but not mounted (server.ts:87) — dead module.
- **Disconnected API:** `Pages/Subscriptions.tsx` routed to `null` (routes/index.tsx:43) — unreachable global Subscriptions page.
- **Unused models:** DailySummary/Monthly/Yearly used for reports ✅ (not dead); License used. No obviously unused models.
- **Fake statistics:** ❌ none (all real aggregations).
- **Placeholder:** Analytics tab text (RestaurantDetails), Settings tab hardcoded badges.

---

## SECTION 24 — WORKFLOW VERIFICATION

| Step | Status |
|---|---|
| Restaurant creation | ✅ |
| Subscription assignment | ✅ |
| Owner creation | 🟡 (no User doc, only owner pin on doc) |
| Default configuration | 🟡 (feature flags; no default branch/settings) |
| Branch creation | 🟡 (must be explicitly created — not automatic) |
| Device registration | ✅ (policy enforcement) |
| Login | ✅ |
| Activation | ✅ |
| Daily usage | ✅ (bumping summaries) |
| Suspension | ✅ |
| Restore | ❌ (no restore endpoint) |
| Deletion | 🟡 soft-only, no full cascade |

---

## SECTION 25 — IMPLEMENTATION MATRIX

| Feature | Backend | Frontend | API | Validation | Authorization | Audit | Testing |
|---|---|---|---|---|---|---|---|
| CRUD | ✅ | ✅ | ✅ | 🔴 | ✅ | 🟡 | 🔴 |
| Onboarding | ✅ | ✅ | ✅ | 🔴 | ✅ | 🟡 | 🔴 |
| Status | ✅ | ✅ | ✅ | 🔴 | ✅ | 🟡 | 🔴 |
| Deletion | 🟡 | ✅ | 🟡 | 🔴 | ✅ | 🟡 | 🔴 |
| Settings | ✅ | ✅ | ✅ | ✅(zod module) | ✅ | ✅ | 🟢 |
| Subscription | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | 🟢 |
| Branches | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 |
| Devices | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 |
| Usage metrics | ✅ | 🟡(placeholder tab) | ✅ | — | ✅ | ✅ | ✅ |
| Search/Filter/Sort/Pagination | ✅ | ✅ | ✅ | 🔴 | ✅ | — | 🟡 |

---

## SECTION 26 — CRITICAL ISSUES (RANKED)

- 🟠 **P1 — Onboarding is not atomic.** `createRestaurant` writes restaurant → subscription → payment/invoice without a transaction; a failure mid-way leaves partial records and no cleanup. Impact: orphan data, inconsistent billing.
- 🟠 **P1 — No transactional/restore/permanent-delete.** Only soft-delete; no restore/permanent; delete doesn't cascade devices/employees/settings. Impact: no data lifecycle management, accidental permanent loss.
- 🟠 **P1 — Owner identity inconsistency.** `createRestaurant` never creates a `User` role `owner`; owners dashboard & `totalOwners` read `User` → admin-created restaurants never appear as owners. Impact: broken owner list, broken reset (adminOwnersController can't reset a restaurant doc's owner pin — it operates on User).
- 🟠 **P2 — No response validation on admin mutation routes.** Missing `validate()` → free-form `$set: body` → mass assignment risk (admin updating `apiKey`,`secretKey` etc.).
- 🟠 **P2 — N+1 query in getRestaurants/getSubscriptions.** Impact: list latency O(page).
- 🟠 **P2 — `validatePlanDowngrade`/`downgradeSubscription` do in-list plan-only check; plan limit not enforced at every write.** (some writes bypass).
- 🟡 **P2 — `resetRestaurantPassword` returns plaintext PIN** (adminRestaurantsController:549) and `adminOwnersController.resetOwnerPassword`.
- 🟡 **P3 — pagination total computed from post-filter `data.length`** not DB `total`.

---

## SECTION 27 — MISSING FEATURES (production-grade)

- Atomic onboarding + rollback (transaction).
- Permanent-delete + restore endpoints.
- Cascade deletion (devices, employees, base = cascade data, settings, licenses) & preservation strategy.
- Creates `User` owner doc on restaurant create (and sync owners dashboard).
- Zod/schema validation on every admin mutation; field whitelist.
- True automatic head-branch and default settings on restaurant creation.
- Enable br page: ws # (logo/cover upload).
- Usage quota + `currentDevices` real count (replace TODO).
- Point-in-time conflict resolution/server sync versioning.
- Branch scoping for devices/online.
- API/schema, authorization, CRUD integration test suites.
- Owner list filter + correct DB total.

---

## SECTION 28 — PRODUCTION READINESS

- **Single restaurant:** ⚡ **7/10** — works; but no restore/validation/Owner consistency; still usable.
- **Multi-branch:** 🟡 **4/10** — branch support present; isolation incomplete (device), no default branch, limits best-effort.
- **Restaurant chain:** 🟡 **3/10** — persisted customer/owner data risks; no chain-level grouping.
- **Cloud SaaS:** 🟡 **3/10** — N+1, no soft/hard delete management, tenant isolation okay; missing quota.
- **Enterprise:** 🟡 **2/10** — needs multi-admin RBAC, audit completeness, financial report audit.
- **Overall:** **4.4/10**

Each is capped by CRUD deletion model, owner/doc consistency, transaction, validation, correctness of totals.

---

## 29 — PRIORITY FIX LIST

**Tier 1 — Critical**
1. Transaction-guard + rollback across restaurant→sub→payment, with owner/User doc creation.
2. Add schema validation (Zod) + per-field whitelist on all admin restaurant/subscription mutation routes; reduce mass `$set`.
3. Real `currentDevices` count (remove TODO); verify device limit enforcement across all POS writes.

**Tier 2 — Architecture**
4. Introduce restaurant `service`/`repository` + `.populate`-avoiding aggregation queries (fix N+1).
5. Add `restore` + `permanent delete` (cascade defined per entity), and standardize process with collected/contains archives.
6. Implement transaction session for status/settings mutations and sync plan/flag into single source of truth.
7. Owner user provisioning on create + business-rule owner-list consistency.

**Tier 3 — Features**
8. Product-media (logo/cover) upload; real Analytics dashboard data (was a placeholder).
9. Route & enable Subscriptions page (currently unreachable) exposing revenue + CrowdGate.
10. Branch default bootstrapping + Branch→Device scoping.

**Tier 4 — RO / Optimization**
11. Pagination totals from real DB count; cache invalidation for invalidateCache('analytics') on per-rows.
12. Add integration tests: restaurant CRUD, authorization matrix, downgrade enforcement, soft-delete→restore, onboarding rollback.
13. Retire dead `qrOrdering` imported-but-unmounted; remove Placeholder analytics; remove plain-PIN response exposure for password reset.
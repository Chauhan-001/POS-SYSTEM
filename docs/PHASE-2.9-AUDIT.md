PHASE 2.9 — AUDIT LOGS: READ-ONLY IMPLEMENTATION AUDIT
(Enterprise Activity Logging)

This is a READ-ONLY audit. No code was modified.

=======================================================================
STATUS KEY
=======================================================================
✅ Full    — implemented and wired end-to-end
🟡 Partial — implemented with gaps (semantic, coverage, or data gaps)
🔴 Missing — not implemented
⚪ N/A     — feature/abstraction does not exist to be audited

=======================================================================
1. AUDIT ARCHITECTURE
=======================================================================

Centralized audit service          🟡 — helper exists, partial adoption.
- `backend/src/utils/audit.ts` provides `audit(req, input)` that centralizes
  actor/tenant/IP/device context and writes via `auditLogRepo.create`
  (fire-and-forget, never throws; logs a warning on failure). Doc comment says
  "mutations never bypass the audit trail," but the helper is NOT widely used:
  only a handful of services call it on the actor/request path; most writes
  bypass it and instantiate entries inline.

Middleware integration            ✅ — global, automatic.
- `middleware/requestLogger.ts` is mounted globally in `server.ts`
  (`app.use(requestLogger())`). Every mutating request (POST/PUT/PATCH/DELETE)
  with an authenticated tenant context writes an append-only AuditLog entry
  (action `` `${method}_${entityTypeFromPath(path).toUpperCase()}` ``).
  Non-mutating requests are logged to console only.
- Opt-out prefixes: `/api/auth/refresh`, `/api/health`, `/api/otp/verify`.
- Failure is always non-blocking (`.catch`).

Service integration                🟡 — extensive but inconsistent.
- 100+ direct `auditLogRepo.create(...)` / `AuditLog.create(...)` calls across
  services and controllers (restaurant, owner, device, plan, customer, loyalty,
  campaign, expense, cash ledger, bill, support, session, settings, printer,
  subscription, stock movement, referral, vendor, table, floor, reservation,
  media, offer validation, recurring expense, table-state). See Section 17.
- Naming is inconsistent: uppercase (RESTAURANT_CREATED), dot-notation
  (`payment.verified`, `subscription.renewed.cash`, `plan.scheduled_change.applied`),
  and free-text embedded-style actions (Restaurant.auditTrail).

Controller integration            🟡 — read endpoints exist; entries mostly
  written from services, not controllers. Auth uses `recordFailedLogin`
  (LOGIN_FAILED) and admin controllers delegate to services.

Automatic logging                 ✅ — the global requestLogger is the base
  safety net (every mutating request), and `server.ts` mounts it early.

Manual logging                    ✅ — many domain actions write semantic
  entries (LOGIN, support tickets, owners, devices, bills, campaigns, etc.).

 Event-driven logging              ⚪ — no event bus / domain-event emitter
  exists; audit calls are synchronous side-effects inside handlers.

Database model                    ✅
- `models/AuditLog.ts` — action, entityType, entityId, performedBy,
  performedById, details (Mixed), restaurantId, branchId, ipAddress, createdAt.
- `models/VoiceAuditLog.ts` — dedicated voice-inventory trail (intent,
  transcript, parsedJson, confidence, confirmationStatus, items, matchingMethod,
  pipelineCandidates, latencyMs, ipAddress).
- Embedded trails: `Restaurant.auditTrail[]` (media + restaurant status actions),
  `User.activityHistory[]` (referenced by owner login feed).

Storage strategy                   🟡 — single MongoDB collection (AuditLog),
  one dedicated voice collection, plus two embedded trails. No external/
  cold storage, no sharding.

Log retention                      🔴 — none.
Log indexing                       🟡 — see Section 4.

=======================================================================
2. ACTION COVERAGE
=======================================================================
(action ⇒ observed audit event / source)

Restaurant Created                ✅ RESTAURANT_CREATED (restaurantService)
Restaurant Updated                ✅ RESTAURANT_UPDATED
Restaurant Suspended              ✅ RESTAURANT_SUSPENDED (+ Restaurant.auditTrail)
Restaurant Activated              ✅ RESTAURANT_ACTIVATED (+ auditTrail)
Restaurant Deleted                ✅ RESTAURANT_DELETED (+ RESTAURANT_PERMANENT_DELETED)
Restaurant Restored               ✅ RESTAURANT_RESTORED
Restaurant Settings Updated       ✅ SETTINGS_UPDATED / SETTINGS_ROLLED_BACK (scoped: restaurant/branch/device)
Owner Created                     ✅ ADMIN_OWNER_CREATE
Owner Updated                     ✅ ADMIN_OWNER_UPDATE
Owner Deleted                     ✅ ADMIN_OWNER_DELETE (+ PERMANENT_DELETE)
Owner Login                       ✅ LOGIN (authService; all roles)
Owner Logout                      🟡 logout revokes the refresh token; only the
                                     generic POST route entry is written — no
                                     semantic LOGOUT event
Password Reset                    ✅ ADMIN_OWNER_RESET_PIN / RESTAURANT_PIN_RESET
                                     (PIN generated; no plaintext logged)
Session Revoked                   ✅ SESSION_REVOKE / SESSION_REVOKE_ALL /
                                     ADMIN_OWNER_SESSION_REVOKE(_ALL) / TOKEN_REUSE
Role Changed                      🔴 only generic middleware entry (no semantic;
                                     no old/new role)
Permission Changed                🔴/⚪ no per-user permission mutation API exists
                                     (Authorization is seed-only) → no audit path
Subscription Created              🟡 implicit at registration; no explicit action
Subscription Updated              🟡 only plan.scheduled_change.applied surfaced
Subscription Assigned             🔴 no event
Subscription Cancelled            🔴/🟡 no distinct cancellation event
Plan Created                      ✅ ADMIN_PLAN_CREATE
Plan Updated                      ✅ ADMIN_PLAN_UPDATE
Plan Deleted                      🟡 archive → ADMIN_PLAN_STATUS; permanent delete
                                     not distinguished
Plan Restored                     🟡 no distinct restore action (shares status)
Plan Assigned                     🔴 no event
Device Registered                 🟡 DeviceActivity `device_registered` only —
                                     NOT written to AuditLog
Device Approved                   ✅ ADMIN_DEVICE_APPROVE
Device Removed                    ✅ ADMIN_DEVICE_REMOVE (+ ADMIN_OWNER_DEVICE_REMOVE)
Device Blocked                    ✅ ADMIN_DEVICE_BLOCK
Device Unblocked                  ✅ ADMIN_DEVICE_UNBLOCK
Device Force Logout               ✅ ADMIN_DEVICE_SESSION_REVOKE + deviceService
                                     forceLogout audit
Branch Created                    🔴 generic middleware only
Branch Updated                    🔴 generic middleware only
Branch Deleted                    🔴 generic middleware only
Inventory Adjustments             ✅ INVENTORY_${type} (stockMovementService) +
                                     VoiceAuditLog for voice/mobile
Product Created                   🔴 generic middleware only
Product Updated                   🔴 generic middleware only
Product Deleted                   🔴 generic middleware only
Offer Created                     🔴 generic middleware only
Offer Updated                     🔴 generic middleware only
Offer Deleted                     🔴 generic middleware only
Campaign Changes                  ✅ CAMPAIGN_CREATED/UPDATED/STATUS_CHANGED/DELETED/SENT
Billing Actions                   🟡 partial (renewals, scheduled change)
Payment Actions                   ✅ payment.verified
Refunds                           ✅ BILL_REFUNDED (+ BILL_VOIDED)
Invoice Actions                   🟡 invoices generated during renewal are
                                     captured in `details`; no dedicated event
AI Configuration Updated          🟡 via SETTINGS_UPDATED; no AI-specific event
AI Provider Changed               🔴 no event
AI Model Changed                  🔴 no event
AI Usage Limits Updated           🔴 no event
Support Ticket Created            ✅ SUPPORT_TICKET_CREATED
Support Ticket Assigned           ✅ SUPPORT_TICKET_ASSIGNED
Support Ticket Closed             🟡 SUPPORT_TICKET_STATUS_CHANGED (status→closed
                                     is semantic across transitions, not a
                                     dedicated CLOSED event)
Support Ticket Deleted            ✅ SUPPORT_TICKET_DELETED (soft)
Support Reply Added               ✅ SUPPORT_TICKET_REPLIED
System Settings Changed           ✅ SETTINGS_UPDATED / SETTINGS_ROLLED_BACK
Security Settings Changed         🟡 folded into general settings; no dedicated
                                     security-action events
Feature Flag Changes              ⚪ no feature-flag toggling infrastructure
                                     exists (only plan `requireFeature` gates) → no
                                     audit path; plan changes cover feature gating
Report Exported                   🟡 CUSTOMER_EXPORT only; finance/expense/
                                     sales report exports write no audit
Analytics Exported                🔴 /admin/analytics/export/{csv,excel,pdf}
                                     write no audit (controller has no write)
Admin Login                       ✅ via LOGIN (same auth path, role-gated)
Admin Logout                      🟡 generic middleware only
Admin Password Reset              🟡 owner/admin resets audited via PIN reset;
                                     self reset flows unaudited
User Invitation                   ⚪ no invite feature exists
User Removal                      🔴 no semantic event (employee delete via
                                     generic middleware only)

=======================================================================
3. AUDIT DATA QUALITY
=======================================================================
The AuditLog schema stores: action, entityType, entityId, performedBy,
performedById, restaurantId, branchId, ipAddress, details, createdAt.

User            ✅ performedBy (+ performedById)
Role            🔴 not stored on AuditLog (only inferred; role is on console
                     JSON log line, not the persisted entry)
Restaurant      ✅ restaurantId (ObjectId)
Branch          ✅ branchId (ObjectId; optional)
Action          ✅ action
Resource        🟡 entityType + entityId present, but entityId is free-form
                     string and not consistently populated on auto entries
Resource ID     🟡 as above
Timestamp       ✅ createdAt (schema only, no updatedAt)
IP Address      ✅ ipAddress (x-forwarded-for first hop, else req.ip)
Device Info     🟡 only via `details.deviceId` from x-device-id / x-client-id
                     header; no OS/version/app captured in AuditLog
Session ID      🔴 not stored (session id present only in SESSION_REVOKE
                     details.deviceId/deviceName)
Old Value       🟡 present for some writes (device `before`, settings
                     `changedKeys`/managed), absent for most domain actions
New Value       🟡 as above (device `after`, settings scope/version)
Metadata        ✅ details (Mixed) on most writes
Success/Failure 🔴 no result/status field (auto entries embed response
                     `status` in details; manual entries do not)
Reason          🟡 optional, present for device/settings/branch actions only

=======================================================================
4. DATABASE
=======================================================================
Indexes        🟡 AuditLog: single-field + compound (action; entityType;
                   performedById; restaurantId; restaurantId+entityType+
                   createdAt; createdAt:-1). VoiceAuditLog: 5 compound indexes.
TTL            🔴 none (collections grow unbounded)
Archiving      🔴 none
Soft delete    ⚪ N/A — audit rows are not soft-deleted; no delete path for
                   AuditLog. VoiceAuditLog is HARD-deleted during restaurant
                   permanent deletion (cascade purge).
Retention policy 🔴 none
Compression    🔴 none (not configured)
Partitioning   🔴 none (no sharding; single shared DB)
Search opt.    🟡 indexes support date/action/user/restaurant queries; the
                   list endpoint also uses `$regex` on performedBy/action/
                   entityType/details.plan which precludes index use.

=======================================================================
5. SEARCH
=======================================================================
Keyword search     ✅ $regex `i` over performedBy, action, entityType, details.plan
Action search      ✅ `action` query → $regex `i`
User search        🟡 only via keyword (no dedicated performedBy filter)
Restaurant search  🔴 no filter; restaurantId not even returned on list rows
Owner search       🟡 via keyword only
Branch search      🔴 no filter
Date search        ✅ startDate / endDate on createdAt
Resource search    ✅ entityType filter ($regex)
Resource ID search 🔴 no entityId filter
Partial search     ✅ regex is substring-capable
Case-insensitive   ✅ `$options: 'i'`

=======================================================================
6. FILTERING
=======================================================================
Action        ✅ action ($regex)
User          🔴 no performedBy/performedById filter param
Role          🔴 not storable/selectable
Restaurant    🔴 no restaurantId filter
Branch        🔴 no branchId filter
Date Range    ✅ startDate/endDate
Resource      ✅ entityType (regex)
Status        ⚪ auto-entry status used only as details, not filterable
Result        🔴 not filterable (success/failure not a field)

=======================================================================
7. SORTING
=======================================================================
Newest        ✅ hard-coded sort({ createdAt: -1 })
Oldest        🔴 cannot request
Action        🔴 not sortable
User          🔴 not sortable
Restaurant    🔴 not sortable
No `sortBy`/`sortOrder` parameter supported (controller ignores unknown params).

=======================================================================
8. PAGINATION
=======================================================================
page      ✅ Math.max(1, page)
limit     ✅ clamped to [1..100], default 20
total     ✅ countDocuments
totalPages ✅ Math.ceil(total/limit)
next      🔴 not returned
previous  🔴 not returned
Frontend PaginatedResponse<T> matches the response shape.

=======================================================================
9. SECURITY
=======================================================================
RBAC protection     ✅ every admin route uses requireAuth + requireCollectionAccess
Tenant isolation    🟡 — platform console is intentionally cross-tenant data
                        (Restaurant 'read' grants a global list). Tenant-scoped
                        views (settings `/audit`, voice `/history`) DO filter by
                        req.user.restaurantId. But the global AuditLog list is not
                        tenant-isolated BY DESIGN (admin tool).
Admin-only access   🟡 — gated by Authorization on collection "Restaurant",
                        not a hard super_admin role; any principal holding
                        Restaurant:read can read the trail. Seed grants admin.
Sensitive masking   🟡 write-side only
PII masking         🔴 return rows include details raw (phone/username can
                        appear, e.g., LOGIN_FAILED details)
Password masking    🟡 written-side redaction of keys: password, pin, token,
                        secret, key, authorization, refreshToken, managerPin,
                        otp, otpCode, cvv → [REDACTED] (requestLogger only)
Token masking       🟡 same write-path redaction (token hash stored in
                        refresh-token; audit never stores raw token)
API key masking     🟡 key matched by SENSITIVE_KEYS at write time
Secret masking      🟡 same write-time mechanism
Read-side masking   🔴 adminAuditLogsController and settings/voice readers
                        return `details`/`parsedJson` unmasked.

=======================================================================
10. IMMUTABILITY
=======================================================================
Cannot edit          ✅ no update API for AuditLog
Cannot overwrite     ✅ single `_id`; no update endpoints; schema has no
                         updatedAt to overwrite
Cannot silently delete ✅ no delete API for AuditLog
Tamper detection     🔴 no hash-chaining, checksum, or integrity marker at all
Integrity validation 🔴 none (no compare/verify endpoint)
Note: VoiceAuditLog is NOT strictly immutable — `AuditLogger.updateConfirmationStatus`
uses `findByIdAndUpdate` (confirmationStatus, items). Restaurant permanent
deletion hard-deletes VoiceAuditLog rows (tenant purge). Global AuditLog is
never deleted on restaurant purge (survives as an immutable record).

=======================================================================
11. API
=======================================================================
List         ✅ GET /admin/audit-logs (paginated)
Search       ✅ search param
Filter       🟡 action/entityType/date only
Pagination   🟡 page/limit/total/totalPages (no next/previous)
Export       🔴 no audit export endpoint
Detail endpoint 🔴 none
Second surface: GET /api/settings/audit (Owner/Manager, tenant-scoped,
paginated, missing createdAt-based sort control acceptable). Voice:
GET /api/voice-inventory/history (tenant-scoped, intent/status/date filter,
offset/limit).

=======================================================================
12. EXPORTS
=======================================================================
CSV     🔴 no audit-log export
Excel   🔴 no audit-log export
PDF     🔴 no audit-log export
JSON    🔴 no dedicated JSON export (API returns JSON only)
(The dashboard/analytics export endpoints at /admin/analytics/export/* exist
but are for analytics, not audit logs, and write no audit event.)

=======================================================================
13. PERFORMANCE
=======================================================================
Indexes            🟡 decent compound coverage but the `$regex` search + the
                       `$or` across details.plan cannot use indexes.
Query performance 🟡 full-collection scans avoided on default path; search path
                       scans via regex.
Pagination efficiency ✅ skip/limit with countDocuments in parallel.
Large datasets    🔴 no TTL/archive; `details` can be large (Mixed, leans
                       against server-side; auto body truncated to 20 items).
Archive strategy  🔴 none.
30s response cache on the list route reduces repeated cost; mutations do not
invalidate it (stale up to 30s).

=======================================================================
14. FRONTEND
=======================================================================
Page row: `admin-dashboard/src/pages/AuditLog.tsx` at route /admin/... (lazy).
Table       ✅ Table with columns Action/Entity/PerformedBy/Details/Timestamp
Filters     🟡 action + entity dropdowns + date range (no user/restaurant)
Search      ✅ SearchInput (action/users/entities)
Pagination  ✅ Table pagination (page + totalPages)
Detail modal 🔴 none (details shown as a truncated tooltip string only)
Timeline    🔴 none
Export      🔴 no export button
Loading     ✅ Table loading flag
Error state ✅ ErrorPage with retry
Empty state ✅ emptyMessage
Supplementary voices: `pages/VoiceInventoryDashboard.tsx` renders voice history
(confidence/intent/status). Settings audit history is API-only (no dedicated
admin UI tab found for settings audit).

=======================================================================
15. TESTING
=======================================================================
Audit middleware  🟡 requestLogger.test.ts (entry shape, skip GET, redaction,
                       DB-down resilience). ✅ 84/85/98/101-114 assert behavior.
Audit service      ✅ service tests assert audit rows exist after mutations
                       (ownerService, planService, deviceService, sessionService,
                       supportTicketService, settingsService, restaurantMedia).
Audit APIs         🔴 NO test file for adminAuditLogsController (GET /admin/audit-logs)
RBAC               🔴 no test for audit-list RBAC/tenancy
Filtering          🔴 no test
Pagination         🔴 no test
Search             🔴 no test
Masking            🟡 write-side redaction tested via requestLogger only; read-
                       side masking untested (absent)
Exports            🔴 no audit-export tests (feature absent)

=======================================================================
16. CRITICAL GAPS
=======================================================================
Missing audit events: role change, permission change, plan assignment,
subscription assign/cancel, branch CRUD (semantic), product CRUD (semantic),
offer CRUD (semantic), device registration in AuditLog, AI config/provider/
model/limits, analytics/report exports, admin/user removal, feature flags.
Missing API protection: audit list gated only by Restaurant:read (broad);
audit detail/export absent.
Missing masking: read-side masking of PII/secrets on the global list.
Performance risks: unbounded growth (no TTL/archive); regex `$or` scan;
large `details` blobs; `details.plan` regex.
Security risks: no tamper detection/integrity validation; role field missing;
per-row IP/device/agent attribution incomplete.
Broken logging:  none observed (all writes non-blocking).
Duplicate logging: RESTAURANT status writes to both embedded auditTrail AND
AuditLog (acceptable redundancy); login writes both AuditLog and DeviceActivity/
refresh-token session — could double-record the same event.
Dead logging: `utils/audit.ts` helper is largely unused (most writers bypass it);
`VoiceDashboard` audit history overlaps with AnalyticsService reads (utility, not
duplicate writes).
Unused audit code: utils/audit.ts (sparse call sites); Restaurant.auditTrail and
User.activityHistory are populated but surfaced only in a few detail views.

=======================================================================
17. IMPLEMENTATION MATRIX
=======================================================================
Feature            Backend  Frontend  DB    Sec   Testing  Status
Global middleware  ✅       ⚪        ✅    ✅     🟡      ✅ Full
System list API    ✅       ✅        ✅    🟡     🔴      🟡 Partial
Filters (action/ent/date) ✅ ✅  🟡  🟡  🔴  🟡 Partial
Search (keyword)   ✅       ✅        🟡    ✅     🔴      🟡 Partial
Pagination         ✅       ✅        🟡    —      🔴      🟡 Partial
Sort control       🔴       🔴        —     —      🔴      🔴 Missing
Export (CSV/XLS/PDF/JSON) 🔴  🔴      —     —      🔴      🔴 Missing
Detail endpoint    🔴       🔴        —     —      🔴      🔴 Missing
Tenant list view   ✅(/settings,/voice) 🟡(voice) 🟡 ✅    🔴  🟡 Partial
Voice audit        ✅       ✅        ✅    ✅     🟡      ✅ Full (scoped)
RBAC protection    ✅       —         ✅    ✅     🔴      ✅ Full
Write-side masking 🟡       —         ✅    🟡     🟡      🟡 Partial
Read-side masking  🔴       —         🔴    🔴     🔴      🔴 Missing
Immutability       🟡       —         ✅    🟡     🔴      🟡 Partial
Tamper detection   🔴       —         🔴    🔴     🔴      🔴 Missing
Retention/TTL      🔴       —         🔴    —      🔴      🔴 Missing
Admin-detail UI    🔴       🔴        —     —      🔴      🔴 Missing

=======================================================================
18. PRODUCTION READINESS
=======================================================================
Single Restaurant  ✅ — per-tenant settings/voice audit work and global trail
                       captures mutations; good for troubleshooting.
Multi Restaurant   🟡 — global trail useful to the platform operator, but the
                       trail lacks role/session/result, has no sort, no export,
                       no tenant filter, and read masking is absent.
Enterprise SaaS    🔴 — fails compliance expectations: no retention/TTL/archive,
                       no tamper detection, no read-side PII/secret masking,
                       no export, incomplete per-domain event coverage, no
                       dedicated audit testing.

=======================================================================
19. FINAL SCORE
=======================================================================
Overall completion : ~45%
Production readiness: 5 / 10 (single/light multi-tenant operator tool; not
compliance-grade).

Critical blockers:
1. No retention/archiving/TTL → unbounded, non-indexed growth.
2. No tamper detection / integrity validation on an append-only claim.
3. Read-side entries expose unmasked details (PII/secrets).
4. Major domain events unaudited (semantic product/offer/branch/role/
   permission/AI-config/export).

Major gaps:
- Audit list API untested; sorting/export/detail endpoints absent.
- Role, session id, success/failure, result, reason not captured.
- `utils/audit.ts` helper not consistently adopted (inline writes prevail).

Minor gaps:
- Inconsistent action naming (uppercase vs. dot-notation vs. free-text).
- 30s response cache not invalidated on audit writes (stale list).
- Duplicate writes for restaurant status (embedded + AuditLog).
- frontend lacks detail modal / timeline / export.

=======================================================================
20. DELIVERABLE
=======================================================================

1. Architecture overview
   Two-tier logging: (a) a global Express mutation logger that auto-writes an
   AuditLog for every authenticated mutating request; (b) 100+ manual semantic
   writes scattered through services/controllers. A helper (`utils/audit.ts`)
   exists to centralize this but is underused. Separate streams cover voice
   (VoiceAuditLog) and embedded trails (Restaurant.auditTrail,
   User.activityHistory).

2. Files inspected
   - models/AuditLog.ts, models/VoiceAuditLog.ts, models/Restaurant.ts,
     models/User.ts, models/DeviceActivity.ts
   - middleware/requestLogger.ts, middleware/authMiddleware.ts,
     middleware/authorizationMiddleware.ts, middleware/subscriptionMiddleware.ts
   - utils/audit.ts
   - controllers/adminAuditLogsController.ts, authController.ts,
     adminSubscriptionsController.ts, adminAnalyticsExportController.ts,
     adminDevicesController.ts, productsController.ts, offersController.ts,
     branchesController.ts, voiceInventoryController.ts
   - services: restaurantService, ownerService, deviceService, planService,
     customerService, loyaltyService, campaignService, expenseService,
     cashLedgerService, billService, stockMovementService, referralService,
     vendorService, sessionService, authService, analyticsService,
     analyticsExportService, supportTicketService, subscriptionService,
     settingsService, printerService, offerValidationService, recurringExpense,
     tableState, floor, reservation, table, media
   - routes: admin.ts, auth.ts, branches.ts, employees.ts, campaigns.ts,
     expenses.ts, finance.ts, cashLedger.ts, floors.ts, bills.ts,
     voice-inventory/routes/voiceInventory.ts, settings/routes/settings.ts
   - tests: requestLogger.test.ts, ownerService.test.ts, planService.test.ts,
     deviceService.test.ts, sessionService.test.ts, supportTicketService.test.ts,
     settingsService.test.ts, restaurantMedia.test.ts, subscription.test.ts
   - frontend: pages/AuditLog.tsx, api/auditLogs.ts, pages/VoiceInventoryDashboard.tsx,
     api/voiceInventory.ts, types/index.ts, routes/index.tsx

3. Database findings
   AuditLog: 5 indexes, createdAt-only timestamps, no TTL/archive/retention,
   immutability by convention (no update/delete API). VoiceAuditLog: dedicated
   collection, 5 compound indexes, not strictly immutable (confirmation update),
   hard-deleted on permanent restaurant purge.

4. API findings
   Single list endpoint (GET /admin/audit-logs) with keyword/action/entityType/
   date filters and pagination (page/limit/total/totalPages). No sort control,
   no export, no detail endpoint. Scoped secondary APIs: /settings/audit and
   /voice-inventory/history.

5. Frontend findings
   AuditLog page (table, search, action/entity dropdowns, date range,
   pagination, loading/error/empty) with details-as-tooltip. No detail modal,
   timeline, export, or user/restaurant filter. Voice dashboard renders voice
   history analytics.

6. Security findings
   All admin routes behind requireAuth + requireCollectionAccess; global list is
   intentionally cross-tenant behind Restaurant:read (broad). Write-side secret
   redaction exists (requestLogger only); no read-side masking of PII/secrets;
   no per-row role/session/result data; no tenant filter on global list.

7. Performance findings
   Indexed default path; regex `$or` search is non-indexed; unbounded growth;
   large Mixed details; 30s cached list not invalidated on writes.

8. Test coverage
   Middleware write-path + redaction tested; service-level "row exists" tests for
   several domains; NO tests for the audit list API, RBAC, filtering,
   pagination, search, read masking, or exports.

9. Missing audit events
   Role change, permission change, plan assignment, subscription assign/cancel,
   semantic branch/product/offer changes, device registration in AuditLog,
   AI config/provider/model/usage-limit changes, analytics/report export,
   admin self-password reset, user removal.

10. Critical issues
   No retention/archiving; no tamper detection; unmasked read-side data; broad
   audit-list authorization; semantic coverage gaps for high-blast-radius
   changes (products/offers/role/permission).

11. Implementation matrix
   See Section 17.

12. Production readiness
   ✅ Single restaurant; 🟡 multi-restaurant; 🔴 enterprise SaaS.

13. Overall completion percentage
   ~45% (core logging + list UI work; enterprise retention, immutability,
   masking, export, and validation/coverage are the missing majority).
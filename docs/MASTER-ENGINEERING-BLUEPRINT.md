# MASTER ENGINEERING BLUEPRINT
### FINAL CONSOLIDATED IMPLEMENTATION ROADMAP — SINGLE SOURCE OF TRUTH
### Loyalty POS System (`C:\Loyalty_POS system`)

**Version:** 1.0 (final, post-Phase-2.18)
**Type:** READ-ONLY ANALYSIS / ARCHITECTURE / PLANNING — **no code, no file modifications**
**Author role:** Lead Enterprise Software Architect
**Status:** This blueprint supersedes all individual audit reports (2.1–2.18). Future implementation phases should read ONLY this document.

---

# DOCUMENT MAP (how to use this blueprint)

| Section | Purpose | Used by |
|---|---|---|
| 1 | Project status — numeric completion per domain | Stakeholders |
| 2 | Global architecture — current vs desired | All engineers |
| 3 | Phase consolidation — 2.1→2.18 final state | Product managers |
| 4 | Duplicate implementations — merge decisions | Backend leads |
| 5 | Shared infrastructure — build-once services | Architects |
| 6 | Dependency graph — order + blockers | Tech leads |
| 7 | Implementation waves | Planning |
| 8 | File-level implementation plan | Implementers |
| 9 | Database roadmap | Data engineers |
| 10 | API roadmap | Backend engineers |
| 11 | Frontend roadmap | Frontend engineers |
| 12 | Security roadmap | Security engineers |
| 13 | Performance roadmap | Performance engineers |
| 14 | Testing roadmap | QA engineers |
| 15 | Production roadmap | DevOps/SRE |
| 16 | Priority matrix | All |
| 17 | Effort estimation | Program managers |
| 18 | Master checklist | QA/release gate |
| 19 | Final execution plan (sprints) | Dev teams |
| 20 | Final verdict | CTO |

---

# SECTION 1 — PROJECT STATUS

## 1.1 Overall completion %

**≈ 34%** (weighted across the 12 readiness dimensions audited in Phase 2.18).

Method: each domain was scored 0–100 in Phases 2.11–2.18, then weighted by business risk:
architecture 10%, security 15%, performance 10%, testing 12%, monitoring 8%, DevOps 10%, documentation 5%, scalability 10%, compliance 15%, backup/DR 5%.

| Dimension | Score | Reasoning |
|---|---|---|
| Architecture | 55/100 | Layered backend (48 svc/47 ctl/64 models/33 routes/10 modules), tenant repos, audit subsystem, offline-first POS. Deductions: 5 unbound resources, no queue layer, POS App monolith, god-modules, no warehouse. |
| Security | 35/100 | Strong authN (JWT rotation, reuse detection, bcrypt, device policy), RBAC near-total (220/219 admin routes). Deductions: 2 cross-tenant leaks, hardcoded re-seeded admin, dev secret fallbacks, no MFA, localStorage tokens, no at-rest encryption, no secret scanning. |
| Performance | 62/100 | Index-aware schema, gzip, admin lazy-loading. Deductions: cross-tenant cache bug, N+1, inline AI, no virtualization, unbounded caches/collections, no query profiling. |
| Testing | 35/100 | Backend 37 files/539 tests good; HTTP layer 0%, admin 0%, coverage only `ai/**`, no CI, 1 failing + 6 skipped + 2 no-op E2E. |
| Monitoring | 30/100 | Business telemetry strong (AI/audit/webhook/device); operational stack absent (no metrics/tracing/Sentry/alerting/structured logs). |
| DevOps | 24/100 | No CI, no release automation, no Docker/k8s, git disaster (node_modules committed, real source uncommitted), hardcoded seed. |
| Documentation | 30/100 | API 1.3%, DB 4.9%, no OpenAPI/runbook/prereqs, accuracy errors, license contradiction. |
| Scalability | 20/100 | No queues/workers, single event loop, in-memory rate store, optional Redis, single Mongo node, unbounded collections. |
| Compliance | 15/100 | GDPR non-compliant (no consent/erasure/legal docs/encryption), SOC2 fails (no backups/MFA/vuln-mgmt), PCI low-scope-by-design but unevidenced. |
| Backup/DR | 4/100 | Zero mongodump/restore/replication/off-site/drill; RPO/RTO undefined. |
| **Overall** | **≈34%** | — |

## 1.2 Backend completion %

**≈ 70%.** Strong domain coverage (billing, inventory, orders, loyalty, offers, subscriptions, settings, support, audit, AI, voice, reports). Missing: tenant isolation on 5 services, error taxonomy adoption (277 inline 500s), type-check build gate, job queue/scheduler, notification delivery, report audit logging, JSON export, revenue segmentation, warehouse. HTTP layer untested.

## 1.3 Frontend completion %

**≈ 55%.** Admin dashboard is polished (React Query, lazy, design system) but **zero tests**. POS is functional offline-first but a 1,829-line App monolith with re-render storm, no virtualization, no splitting, thin a11y. **Customer website: 0% (not built; only docs).**

## 1.4 Database completion %

**≈ 60%.** 82+ models covering all domains; 160+ indexes; good tenant-scoped design. Missing: TTL/retention, migrations tooling, replica-set/replication, backups, at-rest encryption, ER documentation, warehouse/materialized layer.

## 1.5 API completion %

**≈ 70%** (breadth) / **≈ 5%** (documentation). ~548 endpoints registered and RBAC-guarded; docs cover 7 (1.3%), 2 fabricated. No OpenAPI. Admin(219), reports(38), voice(19) APIs undocumented.

## 1.6 Security completion %

**≈ 35%.** Strong primitives; existential gaps (isolation, secrets, MFA, encryption, compliance). 

## 1.7 AI completion %

**≈ 50%.** Voice-inventory + usage metering + graceful fallback implemented. Gaps: inline blocking calls, no streaming, cost-accuracy broken, most AI E2E skipped, no AI revenue layer.

## 1.8 Reporting completion %

**≈ 60%.** Per-restaurant reports (38 routes) + adminReports (MRR/ARR/forecast/refunds/churn fixed, feature-adoption) implemented. Gaps: no hub page, no segmentation, no SLA/activity/inactive buckets fully, no JSON export, no warehouse, exports main-thread.

## 1.9 Billing completion %

**≈ 75%.** Subscriptions lifecycle (trial→grace→suspended), Razorpay hosted checkout, invoices, entitlements, plan CRUD. Gaps: no refunds model, no add-ons, no revenue segmentation, webhook secret disabled, no auto-retry, no dunning flow.

## 1.10 Testing completion %

**≈ 35%.** Backend service/module tests strong; HTTP 0%; admin 0%; no CI; coverage misleading; E2E partially green (83/91 real).

## 1.11 Deployment readiness %

**≈ 20%.** Manual-only single-host deployment; no CI/CD, containers, rollback, monitoring, secrets management, TLS config, auto-update. Windows-only POS installer.

---

# SECTION 2 — GLOBAL ARCHITECTURE

## 2.1 Current architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT TIER                                     │
│  ┌────────────────────┐  ┌────────────────────┐  ┌───────────────────────┐  │
│  │ POS Terminal       │  │ Admin Dashboard    │  │ (Customer Website —   │  │
│  │ Electron + React   │  │ React + Electron   │  │  NOT BUILT, docs only)│  │
│  │ offline-first      │  │ online-only        │  └───────────────────────┘  │
│  │ usePOSState+sync   │  │ React Query        │                              │
│  └─────────┬──────────┘  └─────────┬──────────┘                              │
│            │ HTTP/JSON+Bearer      │ HTTP/JSON+Bearer                        │
└────────────┼───────────────────────┼─────────────────────────────────────────┘
             ▼                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                             API TIER  (Express)                             │
│  middleware: requestLogger · authMiddleware · authorizationMiddleware       │
│              subscriptionMiddleware · rateLimiter · validate(Zod) · auditCtx│
│  routes: auth sessions restaurants branches devices employees products      │
│          bills orders tables floors heldOrders takeawayOrders customers     │
│          loyalty rewards offers campaigns referrals reservations expenses   │
│          finance cashLedger purchases suppliers vendors inventoryEvents     │
│          recurringExpenses otp sync admin(219) adminReports + modules       │
│            (reports 38, settings 11, subscription 12, qr-ordering 13,       │
│             voice-inventory 19, ai 15)                                       │
└──────────────────────┬───────────────────────────────────────────────────────┘
                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                        SERVICE TIER (48 services)                           │
│  tenant-scoped repos (TenantRepository.forTenant) : 15 services             │
│  UNBOUND (orders, employees, tables, held, takeaway) : 5 services ⚠P0      │
│  entitlementService · subscriptionScheduler · auditService · offerEngine    │
│  segmentEngine · loyaltyService · syncService · aiUsageLogger · deviceSvc   │
└──────────────────────┬───────────────────────────────────────────────────────┘
                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                        DATA TIER  (MongoDB single node)                     │
│  82+ models · 160+ indexes · audit hash-chain + archive + legal holds       │
│  ⚠ no backups · no replication · no encryption at rest · no TTL on ledgers  │
│  ⚠ 3 in-memory unbounded Map caches · Redis optional (not configured)       │
└────────────────────────────────────────────────────────────────────────────┘
```

**Current runtime facts**
- Backend: Express + Mongoose 9, esbuild `dist/server.cjs` (does NOT type-check), in-memory/optional-Redis response cache, `setInterval` schedulers (no queue), HTTP-only (TLS via future proxy).
- POS: Electron 35 + React 19 + Vite (port 5175), offline queue with `clientRef` idempotency (bills only), localStorage-first.
- Admin: React 19 + Vite 8 + React Query + Tailwind v4 + recharts; lazy routes; zero tests.
- Git: 2 commits; 1,313 tracked files are node_modules; real source uncommitted.

## 2.2 Desired architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT TIER                                     │
│  POS Terminal (split, virtualized, tested)   Admin Dashboard (tested, a11y) │
│  Customer Website (build or explicitly Planned)   Mobile/PWA (future)      │
└────────────┬───────────────────────────────────┬────────────────────────────┘
             ▼                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (reverse proxy + TLS + rate limit)         │
│   /api/* → backend replicas (stateless, horizontal)    /docs → OpenAPI      │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                        API TIER (Express, type-checked)                     │
│  Uniform: validate(Zod) · authZ · rateLimit · cache(tenant-key) · audit     │
│  OpenAPI generated from Zod · response builder · correlation-ID            │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                     SERVICE TIER + SHARED INFRASTRUCTURE                    │
│  Audit Engine (single writer)      Notification Service (email/SMS/push)    │
│  Export Engine (async, off-main)   Reporting Engine (async jobs)            │
│  AI Gateway (streaming, timeout)   Feature-Flag/Config Service              │
│  Media/Storage Service (object)    Scheduler + Queue System (BullMQ)        │
│  Permission Engine (RBAC)          Caching Layer (Redis, tenant-key)        │
│  Logging Service (pino+requestID)  Metrics (prom-client)                    │
└──────────────┬───────────────────────────────┬──────────────────────────────┘
               ▼                               ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│   MongoDB replica set        │  │   Redis 7 (cache/queue/rate)  │
│   encrypted at rest          │  │   failover                     │
│   TTL + archives + backups   │  │                                │
│   object storage (media/DR)  │  └──────────────────────────────┘
└──────────────────────────────┘
```

## 2.3 Missing architecture

1. **Queue system / worker processes** (BullMQ) — currently `setInterval` only.
2. **Notification service** — outbound delivery (email/SMS/push) entirely absent.
3. **Object storage layer** — media/backups/exports on local disk.
4. **Replica set + backups + DR** — single node today.
5. **Observability stack** — metrics, tracing, crash reporting, alerting.
6. **CI/CD + container + IaC** — none.
7. **Data warehouse / materialized analytics** — live aggregations only.
8. **Secrets management** — dotenv only.
9. **Customer website** — not built.
10. **Migrations tooling** — schema drifts in code only.
11. **API gateway / TLS termination** — none.
12. **Feature-flag engine** — plan-based gating only, multi-source drift.

## 2.4 Technical debt

- Repo history worthless (node_modules committed; source uncommitted; dead trees `react-app`, `remix_-restaurant-pos-terminal`).
- ~1,983 `any` in backend; 277 inline `res.status(500)`; 0 `next(err)`.
- 5 unbound tenant services (security debt).
- God-modules: `ownerService` 1,070, `aiAnalyticsService` 1,052, `RestaurantDetails.tsx` 1,957, POS `App.tsx` 1,829, `client.ts` 1,910.
- Stale `@types` (mongoose 5 vs 9, ioredis 4 vs 5, express-rate-limit 5 vs 8).
- Contradictory Electron tsconfig (`strict:true` + `strictNullChecks:false`, `outDir:"."` clobbers source).
- `react-example@0.0.0` scaffold identity; 7 package trees, 5 duplicate node_modules, no workspaces.
- 20 audit-writer bypasses (tamper guarantee incomplete).
- `config.ts` port comment 3001 vs default 3002 drift.

## 2.5 Weaknesses

- Tenant isolation incomplete (P0).
- No data durability (P0).
- No production discipline (CI, git, secrets, runbook).
- Error taxonomy defeated by inline catches.
- POS UI monolith + re-render storm.
- Documentation deeply stale.
- Compliance absent.

## 2.6 Scalability concerns

- Single event loop executes all schedulers + exports + snapshots.
- In-memory per-process rate store (multi-instance bypass).
- Optional Redis (not configured), no failover.
- Unbounded append-only collections (no TTL).
- Live aggregations over large collections at request time (100k restaurants not viable).
- Single Mongo node (no read replicas/sharding path).

## 2.7 Performance concerns

- N+1 loops (6, worst ~300 trips).
- 3 HIGH aggregation pipelines without `allowDiskUse`.
- Inline blocking AI (15s outliers).
- POS re-render storm; no virtualization; 459KB+936KB eager JS.
- Whole-file PDF/XLSX buffers; main-thread export.
- Zero query planning (`explain`/`hint`/`maxTimeMS`).

## 2.8 Security concerns

- Cross-tenant cache collision (P0).
- Unbound resources (P0).
- Hardcoded `admin/1008` re-seeded per boot.
- Dev JWT fallbacks; admin shares jwtSecret, 24h no refresh.
- No MFA; localStorage tokens; OTP unsalted sha256 + simulatedCode echo.
- Subscription middleware fails open.
- No at-rest encryption, no secret scanning, no SAST.
- PCI unevidenced; PAN/tax identity plaintext.

## 2.9 Maintainability

- Good module boundaries, centralized config, strong backend test culture, documented conventions.
- Poor: no lint, no strict TS (3 of 4 packages), no build type-check on backend, god-modules, version inconsistency, orphaned trees.

## 2.10 Future expansion

- Customer website/PWA, marketplace add-ons, per-tenant data export, multi-region deployment, mobile POS, offline-first for admin, white-label theming, plugin API. **All blocked until the P0 foundation (Section 7 Wave 1–2) is in place.**

---

# SECTION 3 — PHASE CONSOLIDATION

Legend: 🟢 complete · 🟡 partial · 🔴 missing/blocking.

## 3.1 Phase 2.1 — Backend Foundation
- **Purpose:** response envelope, query parser, session management, error mapping, reuse detection.
- **Current completion:** ~85% (implemented).
- **Missing:** `qr-ordering` broken import paths (`'../../middleware/'`); mongoose duplicate-index warnings cleanup.
- **Critical blockers:** none.
- **Dependencies:** none.
- **Priority:** P3.
- **Effort/complexity/risk:** S / XS / Low.
- **Acceptance:** qr-ordering tsc-clean; no duplicate index warnings.
- **Production readiness:** N/A (foundation).

## 3.2 Phase 2.2 — Restaurant Management
- **Purpose:** restaurant CRUD, onboarding, status, subscription, branches, devices.
- **Current completion:** ~62/100.
- **Missing:** atomic onboarding + rollback; restore/permanent-delete/cascade; owner `User` creation on create; Zod validation/whitelist on admin mutations; N+1 list fixes; real DB-count pagination; plaintext-PIN removal; dead-code removal (qrOrdering mount, unrouted Subscriptions page, placeholder Analytics, toast-only buttons); branch→device scoping; default branch bootstrap; usage quota.
- **Critical blockers:** owner identity inconsistency; non-atomic onboarding; mass-assignment risk.
- **Dependencies:** Wave 1 repo re-base (to safely refactor).
- **Priority:** P1.
- **Effort/complexity/risk:** L / M / High (destructive delete + onboarding change).
- **Acceptance:** createRestaurant creates User owner atomically with rollback test; restore + permanent-delete with cascade audited; all admin mutation routes validate.

## 3.3 Phase 2.3 — Owners Management (INCOMPLETE AUDIT)
- **Purpose:** was to audit owner CRUD.
- **Current completion:** **0% — PHASE-2.3-AUDIT.md is an unfilled prompt template (no findings).**
- **Missing:** actual audit findings. (Owner management overlaps 2.2; owner CRUD/restore/restaurant-mapping exists per 2.1/2.2 work; needs a re-run or closure.)
- **Critical blockers:** none (documentation gap).
- **Dependencies:** none.
- **Priority:** P3 (closure task — complete or annotate the audit).
- **Effort/complexity/risk:** S / S / Low.
- **Acceptance:** PHASE-2.3 either filled or explicitly superseded by 2.2/2.18.

## 3.4 Phase 2.8 — Support Center
- **Purpose:** tickets, replies, state machine, counters, media, audit.
- **Current completion:** ~100% (implemented).
- **Missing:** external notification delivery (documented as future abstraction); admin-only assignee validation; optional text-index.
- **Critical blockers:** none.
- **Dependencies:** Notification Service (Wave 6).
- **Priority:** P2 (notification hook), P3 (assignee scope).
- **Effort/complexity/risk:** S–M / S / Low.
- **Acceptance:** ticket create triggers notification once N1 lands.

## 3.5 Phase 2.9 — Audit Subsystem
- **Purpose:** hash-chained tamper-evident audit, retention, masking, exports, alerts, saved searches.
- **Current completion:** ~78/100.
- **Missing:** 20 direct `AuditLog.create()` bypasses (requestLogger, failed-login, subscriptionService ×3); dual-write dedupe; canonicalization of middleware rows; report/export audit events.
- **Critical blockers:** tamper guarantee incomplete (bypasses).
- **Dependencies:** none.
- **Priority:** P1.
- **Effort/complexity/risk:** M / M / Low-Medium.
- **Acceptance:** 0 bypass sites; every audit row hash-chained + masked; integrity verify clean.

## 3.6 Phase 2.10 — Admin Reports
- **Purpose:** platform analytics/reporting.
- **Current completion:** ~75% (superseded — much implemented post-audit: MRR/ARR/forecast/refunds, churn fix, feature-adoption, async ReportExportJob).
- **Missing:** Admin Reports hub page; revenue segmentation + AI revenue; owner-activity/support-SLA/inactive-restaurant reports; JSON export; unified filters; report-generation audit logging; field masking on financial payloads; warehouse/materialization; async all exports.
- **Critical blockers:** report audit logging (compliance), sync exports at scale.
- **Dependencies:** Queue system (Wave 6).
- **Priority:** P2.
- **Effort/complexity/risk:** XL / XL / Medium.
- **Acceptance:** admin reports hub functional; exports async; report access audited.

## 3.7 Phase 2.11 — Testing
- **Purpose:** comprehensive test audit.
- **Current completion:** 35/100 (execution state).
- **Missing:** HTTP-layer tests (0%); 29 services; admin tests (0%); coverage `src/**` + thresholds; CI wiring; RBAC API tests; repair/remove broken E2E (tour, 6 skipped AI, 2 no-op); performance/load.
- **Critical blockers:** none (but every refactor in this blueprint requires CI first).
- **Dependencies:** CI (Wave 4).
- **Priority:** P1.
- **Effort/complexity/risk:** L / M / Medium.
- **Acceptance:** coverage ≥70% backend (threshold enforced); HTTP+RBAC suites green; admin smoke tests.

## 3.8 Phase 2.12 — Monitoring
- **Purpose:** observability audit.
- **Current completion:** 30/100.
- **Missing:** `/metrics`, Prometheus, OTEL, Sentry, pino structured logging, request-ID in logs, external alerting, deep health, slow-query reporting.
- **Critical blockers:** no operational observability.
- **Dependencies:** Wave 5.
- **Priority:** P1.
- **Effort/complexity/risk:** M / M / Low.
- **Acceptance:** `/metrics` scrapeable; Sentry captures; alerts fire on health/tamper/error spikes.

## 3.9 Phase 2.14 — Performance
- **Purpose:** performance audit.
- **Current completion:** 62/100.
- **Missing:** P0 cache-key fix; P0 unbounded `/api/sync` replay; P0 `limit||0`; P1 POS re-render; N+1; allowDiskUse; TTL; virtualization; Redis failover; Map sweeps; invalidation gaps.
- **Critical blockers:** cache-key + sync P0s.
- **Dependencies:** Wave 2 (cache-key) + Wave 11 (re-render).
- **Priority:** P0 (cache/sync/limit) / P1.
- **Effort/complexity/risk:** M / M / Medium.
- **Acceptance:** cross-tenant cache test passes; sync capped; re-render storm resolved.

## 3.10 Phase 2.15 — Backup & DR
- **Purpose:** backup/disaster-recovery audit.
- **Current completion:** 4/100.
- **Missing:** mongodump schedule, off-site encrypted storage, retention, restore path + drill, replication/failover, RPO/RTO, DR runbook, backup monitoring.
- **Critical blockers:** complete data-loss exposure.
- **Dependencies:** Wave 3.
- **Priority:** P0.
- **Effort/complexity/risk:** M / M / Medium.
- **Acceptance:** automated backups off-site; quarterly restore drill within RPO/RTO; DR runbook published.

## 3.11 Phase 2.16 — DevOps / CI-CD
- **Purpose:** CI/CD, release, infra, git hygiene.
- **Current completion:** 24/100.
- **Missing:** git re-base (P0); GitHub Actions (P0); root test orchestration; lint; coverage thresholds; release automation/tags; Docker/k8s; secrets manager; Node pinning; auto-update.
- **Critical blockers:** repo history; no CI; hardcoded seed.
- **Dependencies:** Wave 1 + Wave 4.
- **Priority:** P0.
- **Effort/complexity/risk:** M–L / M / High (git history change).
- **Acceptance:** clean repo, source committed, PRs gated by CI, tagged releases.

## 3.12 Phase 2.17 — Documentation
- **Purpose:** documentation audit.
- **Current completion:** 30/100.
- **Missing:** OpenAPI; API_REFERENCE fix (2 fabricated endpoints); DB schema + ER; runbook; prerequisites; `.env.example`; accuracy pass; license resolution; ADRs.
- **Critical blockers:** misleading docs (fabricated endpoints, wrong ports, wrong license).
- **Dependencies:** Wave 13 (after features settle).
- **Priority:** P2 (accuracy P1).
- **Effort/complexity/risk:** M / S / Low.
- **Acceptance:** OpenAPI served; docs accurate; license consistent; runbook exists.

## 3.13 Phase 2.18 — Enterprise Readiness
- **Purpose:** final consolidated audit.
- **Current completion:** 34% overall; **NO-GO**.
- **Missing:** everything consolidated here (the whole blueprint).
- **Critical blockers:** source-control, backups, isolation, compliance.
- **Dependencies:** all.
- **Priority:** P0.
- **Effort/complexity/risk:** overall project.
- **Acceptance:** GO gate met (§15.9).

---

# SECTION 4 — DUPLICATE IMPLEMENTATIONS (merge decisions)

> Merged duplicates from multiple phases → **one shared implementation**.

| Concern | Current duplication | Recommended shared impl | Files affected | Benefit |
|---|---|---|---|---|
| Export engine | audit CSV/JSON/XLSX/PDF (`modules/audit/exportService.ts`), analytics export (`analyticsExportService.ts`), reports export (`modules/reports/exportService.ts`) — 3 separate engines | **One `ExportEngine`** (async jobs, signed + optional encrypted artifacts, format adapters CSV/JSON/XLSX/PDF) on top of queue | audit/exportService, analyticsExportService, reports export, adminReports export | One format pipeline, one audit hook, one async path |
| Audit logging | `auditService` (canonical) + 20 direct `AuditLog.create()` call sites | **Audit Engine = only writer**; remove bypasses; `auditLogRepo` legacy adapter routes all | requestLogger, authController, subscriptionService, all services | Complete tamper chain + masking |
| Permission checking | `requireAuth`, `requireRole`, `requireCollectionAccess`, `requireSubscription`, `requireFeature` across middleware; per-controller `canAccess` | **Permission Engine** (single `requireAccess(policy)` composing authn+role+collection+subscription) | authMiddleware, authorizationMiddleware, subscriptionMiddleware, controllers | One policy model, no gaps |
| Pagination | `queryParser`, audit cursor, admin list, reports limit — 4+ implementations | **Pagination Helper** (offset + cursor adapters, cap enforcement) | queryParser, audit queryService, admin controllers | Consistent caps + cursor |
| Filtering/search | regex search in queryParser, support, admin, reports | **Filtering Helper** (whitelist + regex-escape, param schema) | queryParser + consumers | Safe + consistent |
| Validation | 37 Zod schemas but missing on admin mutations | **Validation Layer** — enforce `validate()` on every mutation route (audit gaps) | all admin routes | No mass-assignment |
| Rate limiting | `rateLimiter.ts` (3 tiers) + missing on admin | **Rate Limiter** shared with Redis store + admin tiers | server.ts, admin.ts | Per-tenant + multi-instance |
| Caching | ResponseCache + 3 ad-hoc Map caches (reportCache, cacheService, AI) | **Caching Layer** (one adapter, tenant-keyed, TTL+sweep) | ResponseCache, reportCache, cacheService | No cross-tenant leak, bounded |
| Notifications | none (stub `sendChannel`, in-app feed, timeline) | **Notification Service** | campaigns, support, loyalty, qr-ordering | Real delivery |
| Uploads/media | `mediaService` (images), `mediaService.saveAttachment` (docs), uploads dir | **Storage Service** (object store, type/size policy, malware scan hook) | media module | One policy + backup |
| RBAC seed | `db.ts` Authorization wipe/regrant per boot | **Permission Engine + env-seeded bootstrap** | db.ts | No per-boot reset |
| Logging | `console.log(JSON.stringify)` requestLogger + free-form boot logs | **Logging Service** (pino, request-id, redaction, rotation) | requestLogger, server, services | Structured + traceable |
| Response formatting | `apiResponse` ok/fail + legacy `{message}`/`{error}` mixes | **Response Builder** enforced everywhere | apiResponse + legacy controllers | Uniform contract |
| Repository patterns | `TenantRepository` + unbound `BaseRepository` + per-service model calls | **TenantRepository for ALL tenant resources** | 5 unbound services | Isolation |
| Reporting | reports module (restaurant) + adminReports (platform) + analytics | **Reporting Engine** (async jobs + materialized) | reports, adminReports, analytics | Scale + consistency |
| Analytics | analyticsService + aiAnalyticsService + financeService stats | **Analytics Engine** (shared agg primitives + warehouse) | analytics services | DRY + warehouse |
| Charts | recharts only (good) — no duplication | keep recharts as the single chart lib | — | n/a |
| Scheduling | 5 `setInterval` schedulers | **Scheduler + Queue System** | subscriptionScheduler, retention, reportJobs, rateLimiter, cache sweep | Overlap-safe, crash-safe |

---

# SECTION 5 — SHARED INFRASTRUCTURE (build-once services)

## 5.1 Audit Engine
- **Responsibilities:** single writer; hash-chain CAS; canonical action registry; PII/secrets masking; integrity verify; retention/archive; export jobs; alerts.
- **Consumers:** all services (via `auditService.log`), requestLogger, controllers, reports, exports.
- **Interfaces:** `auditService.log(event)`, `logMany`, `verifyIntegrity()`, `runRetention()`, `createExportJob()`, `queryAuditLogs(filter)`, `toReadSafe()`.
- **Reuse:** exports, alerts, saved searches, legal holds, stats (all exist — consume, don't duplicate).

## 5.2 Notification Service
- **Responsibilities:** outbound delivery (email/SMS/push/in-app); templates; preferences; retry; delivery receipts; webhook dispatch.
- **Consumers:** campaigns, support tickets, loyalty tier changes, qr-ordering ORDER_READY, subscription expiry/dunning, audit alerts (external).
- **Interfaces:** `notify({channel, to, template, data, tenantId, userId})`, `notifyBatch`, `getDeliveryStatus(id)`, `subscribePrefs(userId)`.
- **Reuse:** replaces `CampaignService.sendChannel()` stub; hooks support/loyalty/QR lifecycle points.

## 5.3 Permission Engine
- **Responsibilities:** single policy composition (authn + role + collection + subscription + feature); deny-by-default; policy audit.
- **Consumers:** every route.
- **Interfaces:** `requireAccess('restaurant:update')`, `hasAccess(user, resource, action)`, `roleHierarchy`, `planFeatures(user)`.
- **Reuse:** replaces per-middleware checks; unifies `Subscription.feature` vs plan vs `Restaurant.flags` (removes multi-source drift).

## 5.4 Caching Layer
- **Responsibilities:** tenant/user-scoped keys; TTL; tag invalidation; bounded memory; Redis/in-memory adapters with failover; per-instance + shared.
- **Consumers:** reports, admin analytics, AI prompts, products, cacheService.
- **Interfaces:** `cache.get(key, scope)`, `cache.set(key, scope, ttl)`, `cache.invalidateTags(tags)`, `cache.sweep()`.
- **Reuse:** absorbs 3 ad-hoc Maps; fixes P0 key collision.

## 5.5 Logging Service
- **Responsibilities:** structured JSON (pino); request-ID/correlation-ID; levels; redaction; rotation; stdio/file; metric hooks.
- **Consumers:** all.
- **Interfaces:** `logger.info({req, meta})`, `logger.error(err, meta)`, `req.log`, `redact(sensitive)`.
- **Reuse:** requestLogger rewritten on it; errorHandler uses it.

## 5.6 Storage Service
- **Responsibilities:** object storage abstraction (S3-compatible); media/uploads/attachments/exports/backups; magic-byte validation; size policy; scan hook; signed URLs; backup/DR integration.
- **Consumers:** media module, support attachments, audit exports, reports exports, backup jobs.
- **Interfaces:** `put(namespace, buffer, opts)`, `get(key)`, `delete(key)`, `signedUrl(key, ttl)`, `list(namespace)`.
- **Reuse:** one media path; DR off-site target.

## 5.7 AI Gateway
- **Responsibilities:** provider abstraction (Groq etc.); streaming; timeout/circuit-breaker; token/cost metering; fallback to local; prompt caching; model selection.
- **Consumers:** voice-inventory, ai module, WeatherWidget, ClosingAssistant, AICard.
- **Interfaces:** `ai.complete({prompt, feature, stream})`, `ai.embed()`, `ai.costUsage(feature)`.
- **Reuse:** fixes inline-blocking; unifies metering.

## 5.8 Search Engine
- **Responsibilities:** global admin search (restaurants, owners, tickets, users, audits); whitelisted regex + text index; cursor pagination; highlight.
- **Consumers:** admin dashboard unified search, support search, audit search.
- **Interfaces:** `search(query, {scopes, filters})`, `searchScopes`.
- **Reuse:** consolidates per-module regex searches.

## 5.9 Analytics Engine
- **Responsibilities:** shared aggregation primitives; time-bucketing; materialized snapshots; tenant-scoped; cache-aware.
- **Consumers:** analyticsService, aiAnalyticsService, adminReports, financeService.
- **Interfaces:** `aggregate(spec)`, `snapshot(kind, tenantId, window)`, `rollup(tenantId)`.
- **Reuse:** warehouse foundation (R6).

## 5.10 Reporting Engine
- **Responsibilities:** report registry; async generation via queue; format adapters; materialized reads; permission-aware; audited.
- **Consumers:** admin reports, POS reports, exports.
- **Interfaces:** `report.register(id, spec)`, `report.generate(id, filters) → jobId`, `report.get(jobId)`, `report.download(jobId)`.
- **Reuse:** replaces sync POS exports + duplicate admin export path.

## 5.11 Validation Layer
- **Responsibilities:** Zod schemas; body/query/params; field whitelists; error→400; schema registry for OpenAPI generation.
- **Consumers:** every mutation route (including all admin routes).
- **Interfaces:** `validate(schema)`, `validateBody`, `schemaRegistry`.
- **Reuse:** removes mass-assignment; feeds OpenAPI.

## 5.12 Response Builder
- **Responsibilities:** uniform `{ok|fail, data, meta}` envelope; error mapping; pagination meta; no raw leaks.
- **Consumers:** all controllers.
- **Interfaces:** `ok(data, meta)`, `fail(error)`, `paginated(data, meta)`.
- **Reuse:** retires legacy `{message}`/`{error}` mixes.

## 5.13 Pagination & Filtering Helpers
- **Responsibilities:** cap enforcement; offset + cursor; sort whitelist; regex-escape; param validation.
- **Consumers:** all list endpoints.
- **Interfaces:** `parsePage(query)`, `parseFilter(query, whitelist)`, `parseSort(query, whitelist)`, `encodeCursor/decodeCursor`.
- **Reuse:** absorbs queryParser + audit cursor.

## 5.14 Rate Limiter
- **Responsibilities:** tiered limits; per-tenant + per-IP + per-account; Redis store; distributed-safe.
- **Consumers:** auth, public, api, admin, exports.
- **Interfaces:** `rateLimit({key, limit, window})`, `accountBackoff(accountId)`.
- **Reuse:** closes admin/analytics bypass; multi-instance safe.

## 5.15 Media Service (hardened, reused)
- **Responsibilities:** (exists) image/doc persistence, magic bytes, path-bounds, tenant namespaces.
- **Consumers:** restaurants, support, customers, exports.
- **Interface note:** refactor onto Storage Service; no new duplicate media paths.

## 5.16 Scheduler + Queue System
- **Responsibilities:** BullMQ queue; worker process; cron registry; overlap/run guards; retry; dead-letter; job status API; metrics.
- **Consumers:** recurring expenses, loyalty expiry, campaigns, exports, snapshots, retention, subscription transitions, rate-cleanup.
- **Interfaces:** `enqueue(job, payload, opts)`, `schedule(cron, job)`, `worker.register(job, handler)`, `jobStatus(id)`.
- **Reuse:** replaces all `setInterval`.

## 5.17 Email / SMS Services
- **Responsibilities:** providers (SES/SMTP; Twilio/WhatsApp); templates; retry; bounce handling.
- **Consumers:** Notification Service, support, invoices, receipts, campaigns.
- **Interfaces:** `email.send(...)`, `sms.send(...)`, `provider.status()`.

## 5.18 Feature-Flag Engine
- **Responsibilities:** single source of truth for plan features + runtime flags; env + DB-backed; kill-switch; per-tenant evaluation; audit of flips.
- **Consumers:** subscriptionMiddleware, UI toggles, release rollback.
- **Interfaces:** `features.isEnabled(tenantId, feature)`, `flags.set(key, val)`, `flags.killSwitch(svc)`.
- **Reuse:** removes Restaurant/Subscription/plan drift; adds release kill-switch.

## 5.19 Configuration Service
- **Responsibilities:** extend `config.ts` (env, validated) + `.env.example` + secrets delegation; per-env presets; secrets validation.
- **Consumers:** all.
- **Interfaces:** `config.get(key)`, `config.require(key, envs)`, `config.validateAll()`.
- **Reuse:** fail-fast validation for AI/Razorpay/Weather keys.

---

# SECTION 6 — DEPENDENCY GRAPH

## 6.1 Backend domain graph

```
                ┌─────────────────────────────┐
                │  Repository Re-base (C1)    │  ← no dependency
                └──────────────┬──────────────┘
                               ▼
   ┌───────────────────────────────────────────────────┐
   │  Foundation: config, response, queryParser,       │
   │  logging, validation, permission engine, caching,  │
   │  rate limiter, audit engine, error taxonomy        │
   └───────────────┬───────────────────────────────────┘
                   ▼
   ┌───────────────────────────────────────────────┐
   │  Security & Isolation: tenant-bind (S2),      │
   │  cache-key (S1), secrets (S3/S4), MFA (S6),   │
   │  httpOnly (S7), OTP (S8), admin auth (S5),    │
   │  rate-limit admin (S11), masking (S12)        │
   └───────────────┬───────────────────────────────┘
                   ▼
   ┌───────────────────────────────────────────────┐
   │  Durability: backups (D1-D2), replication (D3),│
   │  TTL (D5), DR runbook (D4)                     │
   └───────────────┬───────────────────────────────┘
                   ▼
   ┌───────────────────────────────────────────────┐
   │  CI/CD + Observability: Actions (C2), metrics  │
   │  (M1), Sentry (M2), logging (M3), alert (M4)   │
   └───────────────┬───────────────────────────────┘
                   ▼
   ┌───────────────────────────────────────────────┐
   │  Queue + Worker (Q1-Q6) ──▶ Notifications (N)  │
   └───────────────┬───────────────────────────────┘
                   ▼
   ┌───────────────────────────────────────────────┐
   │  Core Platform: onboarding (P1), delete/restore │
   │  (P2), validation (P3), N+1 (P4), owners (P5)   │
   └───────────────┬───────────────────────────────┘
                   ▼
   ┌───────────────────────────────────────────────┐
   │  Reports (R1-R6) ──▶ Exports ──▶ AI (AI1-3)    │
   └───────────────┬───────────────────────────────┘
                   ▼
   ┌───────────────────────────────────────────────┐
   │  Frontend (F1-F9) ──▶ Testing (T5-T8)          │
   └───────────────┬───────────────────────────────┘
                   ▼
   ┌───────────────────────────────────────────────┐
   │  Documentation (DOC1-DOC7)                     │
   └───────────────────────────────────────────────┘
```

## 6.2 Critical-path detail

| Task | Requires | Blocks | Parallel | Optional | Must-finish-first |
|---|---|---|---|---|---|
| C1 git re-base | — | all refactors | — | — | everything |
| S1 cache-key | C1 | perf, reports | S2 | — | C1 |
| S2 tenant-bind | C1 | compliance, scale | S1 | — | C1 |
| S3 secrets/seed | C1 | security | S1/S2 | — | C1 |
| D1-D4 backups | C1 | compliance, GO | — | — | C1 |
| C2 CI/CD | C1 | testing, refactors safety | D | — | C1 |
| M1-M6 | C2 | alerts, tuning | — | — | C2 |
| Q1-Q6 | M (metrics) | exports, campaigns, recurring | — | — | C2 |
| N1-N4 | Q | notifications | — | — | Q |
| P1-P8 | S (isolation) | reports, frontend | Q | — | S |
| R1-R6 | P + Q | exports, admin hub | — | warehouse | P |
| AI1-AI3 | R | AI UI | — | — | R |
| F1-F9 | P/R APIs | UI | T | customer site | APIs |
| T5-T8 | C2 + features | GO gate | — | — | features |
| DOC1-DOC7 | all | GO gate | — | — | features settle |
| G1-G6 (compliance) | S + D | GO gate | — | — | S3, D |

---

# SECTION 7 — IMPLEMENTATION WAVES

## Wave 1 — Infrastructure & Foundation
- **Purpose:** make the repo trustworthy and the codebase maintainable before any change.
- **Tasks:** C1 git re-base (.gitignore, un-track node_modules, commit source, remove dead trees, root LICENSE); C3 version pinning + rename `react-example`; C4 backend type-check build + drop stale @types; C5 lint + strict TS; FE-10 note: remove `dist-electron`/`test-results` leftovers; logging + response + config foundation (5.5/5.12/5.19).
- **Dependencies:** none.
- **Effort:** ~1 week (2 eng).
- **Expected completion:** Week 1.
- **Exit criteria:** clean repo; `git status` sane; `tsc --noEmit` green on backend; lint runs; CI scaffold present (later wave, but repo clean).

## Wave 2 — Security & Tenant Isolation
- **Purpose:** close existential security holes before touching feature code.
- **Tasks:** S1 cache-key; S2 tenant-bind 5 resources + controller checks; S3 seed refactor; S4 hard-fail secrets; S5 admin auth; S6 MFA (TOTP); S7 httpOnly cookies; S8 OTP HMAC + simulatedCode gate; S9 fail-closed subscription; S10 no plaintext PIN; S11 admin rate limits; S12 financial masking; T7 isolation tests.
- **Dependencies:** Wave 1.
- **Effort:** ~2 weeks.
- **Expected completion:** Week 3.
- **Exit criteria:** cross-tenant cache test + 5 isolation tests green; no hardcoded seed; secret validation fails startup when missing; MFA enrolled for super_admin; admin endpoints throttled.

## Wave 3 — Durability, Backups & DR
- **Purpose:** stop risking total data loss.
- **Tasks:** D1 mongodump+off-site+encryption+retention; D2 restore path + drill; D3 replication + media backup; D4 DR runbook; D5 TTL/retention indexes.
- **Dependencies:** Wave 1.
- **Effort:** ~1 week.
- **Expected completion:** Week 4.
- **Exit criteria:** automated nightly backups verified off-site; one successful restore drill; replica set configured; RPO/RTO documented.

## Wave 4 — CI/CD & DevOps
- **Purpose:** automate verification and release.
- **Tasks:** C2 GitHub Actions (backend tsc+vitest w/ coverage→src/**, thresholds; POS lint+unit+Playwright CI=true + playwright install; admin tsc+build); C6 release automation + tags + electron publish + pm2/systemd; C7 Docker + compose + TLS proxy; C8 `.env.example` + secrets manager.
- **Dependencies:** Waves 1–3 (restore-test + gates).
- **Effort:** ~2 weeks.
- **Expected completion:** Week 6.
- **Exit criteria:** PR gated by full suite; coverage threshold enforced; tagged release; backend container builds.

## Wave 5 — Observability & Audit Completeness
- **Purpose:** make the system measurable and trustworthy.
- **Tasks:** M1 `/metrics`; M2 Sentry (backend + 2 frontends); M3 pino + request-ID + rotation; M4 external alerting; M5 deep health; M6 slow-query + slowEndpoints; A1 route 20 audit bypasses; A2 report/export audit events; AUD-3 dedupe dual-write.
- **Dependencies:** Wave 4 (CI hosts checks).
- **Effort:** ~2 weeks.
- **Expected completion:** Week 8.
- **Exit criteria:** metrics scrape; alerts fire; 100% audit writes chained; report access audited.

## Wave 6 — Queues, Workers & Notifications
- **Purpose:** enable scheduled work and real communication.
- **Tasks:** Q1 BullMQ + worker; Q2 recurring expenses scheduler; Q3 loyalty expiry scheduler; Q4 campaign scheduler; Q5 async exports/snapshots; Q6 overlap/replay guards; N1 outbound delivery; N2 ORDER_READY push; N3 preferences; N4 Razorpay webhook secret.
- **Dependencies:** Wave 5.
- **Effort:** ~2 weeks.
- **Expected completion:** Week 10.
- **Exit criteria:** recurring expenses/points/campaigns auto-fire; exports non-blocking; emails/SMS deliver; webhook verified.

## Wave 7 — Compliance & Data Rights
- **Purpose:** satisfy GDPR/SOC2/PCI prerequisites.
- **Tasks:** G1 legal/trust docs; G2 consent lifecycle; G3 SAR + erasure; G4 at-rest encryption + HTTPS/HSTS; G5 cookie tokens (with S7); G6 Razorpay assessment + 3DS + SAQ-A.
- **Dependencies:** Waves 2–3 (MFA/encryption/backups prerequisite).
- **Effort:** ~2 weeks.
- **Expected completion:** Week 12.
- **Exit criteria:** privacy policy/ToS/DPA live; consent captured with provenance; SAR + erasure flows; at-rest encryption enabled; PCI SAQ-A evidenced.

## Wave 8 — Core Platform
- **Purpose:** fix lifecycle gaps in restaurant/owner/subscription.
- **Tasks:** P1 atomic onboarding; P2 restore/permanent-delete/cascade; P3 admin mutation validation/whitelist; P4 N+1 + DB totals; P5 owner consistency + unified status; P6 dead-code removal; P7 quotas + device count; P8 branch/device scoping.
- **Dependencies:** Wave 6 (schedulers) + Wave 2 (isolation).
- **Effort:** ~3 weeks.
- **Expected completion:** Week 15.
- **Exit criteria:** onboarding atomic + tested; delete/restore audited; admin routes all validated; owner list consistent.

## Wave 9 — Reports, Analytics & Exports
- **Purpose:** complete the enterprise reporting surface.
- **Tasks:** R1 admin reports hub; R2 revenue segmentation + AI revenue; R3 SLA/activity/inactive reports; R4 JSON export + async all; R5 unified filters; R6 warehouse/materialization.
- **Dependencies:** Wave 8 + Queue.
- **Effort:** ~3 weeks.
- **Expected completion:** Week 18.
- **Exit criteria:** hub live; exports async; report access audited; warehouse snapshots nightly.

## Wave 10 — AI
- **Purpose:** make AI production-safe.
- **Tasks:** AI1 async/streaming + timeouts; AI2 cost accuracy; AI3 env fail-fast; AI4 repair E2E + export UI; AI5 AI-revenue layer.
- **Dependencies:** Wave 9.
- **Effort:** ~2 weeks.
- **Expected completion:** Week 20.
- **Exit criteria:** AI calls non-blocking with timeout; cost meters accurate; AI E2E green.

## Wave 11 — Frontend & UI
- **Purpose:** fix POS performance/monolith + finish admin UX + a11y.
- **Tasks:** F1 re-render storm; F2 App.tsx split/lazy; F3 virtualization; F4 admin tests; F5 E2E repair; F6 a11y; F7 POS design system + dark mode; F8 shells/offline banner; F9 customer website (or mark Planned).
- **Dependencies:** Waves 8–9 (stable APIs).
- **Effort:** ~4 weeks.
- **Expected completion:** Week 24.
- **Exit criteria:** POS 60fps interactions; App split into routes; admin tests green; a11y pass on key flows.

## Wave 12 — Testing & Hardening
- **Purpose:** reach quality gates.
- **Tasks:** T1 coverage config; T2 HTTP integration; T3 29 services; T4 RBAC API tests; T5 admin tests (with F4); T6 report/export/perf; T7 isolation; T8 restore-drill; T9 CI wiring.
- **Dependencies:** Wave 11.
- **Effort:** ~3 weeks.
- **Expected completion:** Week 27.
- **Exit criteria:** coverage ≥70% backend; HTTP+RBAC green; admin smoke; E2E all green; perf smoke pass.

## Wave 13 — Documentation & Release
- **Purpose:** finish the source of truth and ship.
- **Tasks:** DOC1 OpenAPI; DOC2 schema+ER; DOC3 runbooks; DOC4 README+`.env.example`; DOC5 accuracy; DOC6 license; DOC7 ADRs + close 2.3.
- **Dependencies:** Wave 12.
- **Effort:** ~2 weeks.
- **Expected completion:** Week 29.
- **Exit criteria:** OpenAPI served; docs accurate; runbook complete; GO gate review.

---

# SECTION 8 — FILE-LEVEL IMPLEMENTATION PLAN

> No code. New (N), Modify (M), Delete (D), Migration (MIG), Index (IDX), Tests (T).

## 8.1 Security & Isolation
- **S1 cache-key tenant scope** — M `utils/ResponseCache.ts` (key=method+path+query+`restaurantId`+scope), M `modules/reports/routes/reports.ts` (pass scope), T `utils/__tests__/ResponseCache.test.ts` (cross-tenant), T isolation regression.
- **S2 tenant-bind 5 services** — M `services/orderService.ts`, `employeeService.ts`, `tableService.ts`, `heldOrderService.ts`, `takeawayOrderService.ts` (use `forTenant(restaurantId)`); M corresponding controllers (`ordersController`, `employeesController`, `tablesController`, `heldOrdersController`, `takeawayOrdersController`) (pass restaurantId + access check); M `repositories/index.ts` if needed; T ×5 service tests + controller access tests.
- **S3 seed refactor** — M `db.ts` (env `ADMIN_SEED_PASSWORD`, empty-DB-only upsert, no per-boot re-seed, no Authorization wipe); M `config.ts` (admin seed env); M `docs/` (remove leaked creds); T seed test.
- **S4 hard-fail secrets** — M `config.ts` (throw if JWT/REFRESH_SECRET missing in ALL envs, not just production; validate AI/Razorpay/Weather keys).
- **S5 admin auth** — M `controllers/adminAuthController.ts` (dedicated admin secret, refresh + revocation, min-length); M `routes/admin.ts:174` (validate schema); M `validation/admin.ts` (N schema).
- **S6 MFA** — N `middleware/mfa.ts`, N `services/mfaService.ts`, N `controllers/mfaController.ts`, N `routes/mfa.ts`, N `models/MfaCredential.ts` (or extend User), M `authService.ts`, M `adminAuthController.ts`, N `validation/mfa.ts`, T `services/__tests__/mfaService.test.ts`.
- **S7 httpOnly cookies** — M POS `Frontend/src/api/client.ts`, M admin `admin-dashboard/src/api/client.ts`, M `authService.ts`/`adminAuthController.ts` (set-cookie), M `authMiddleware.ts` (read cookie), M CORS/CSRF handling, T auth flow E2E.
- **S8 OTP** — M `services/otpService.ts` (HMAC+salt), M config (simulatedCode env-gated), M `validation/otp.ts`, T OTP tests.
- **S9 fail-closed subscription** — M `middleware/subscriptionMiddleware.ts` (deny on error/no-record), M `entitlementService.ts`, T subscription middleware tests.
- **S10 plaintext PIN** — M `controllers/adminRestaurantsController.ts`, `adminOwnersController.ts` (return reset token/link, never PIN), M UI text, T.
- **S11 admin rate limits** — M `middleware/rateLimiter.ts` (Redis store, admin tiers, per-tenant keys), M `routes/admin.ts`, `routes/adminReports.ts`, M `server.ts` (mount), T.
- **S12 financial masking** — M `utils/masking.ts` reuse + M admin report controllers/serializers (mask amounts/PII beyond RBAC), T.

## 8.2 Durability
- **D1 backups** — N `scripts/backup.sh`/`backup.js` (mongodump→encrypted→S3), N `scripts/restore.js`, M `package.json` scripts, N `config.ts` backup settings, N docs.
- **D2 restore drill** — N `scripts/restore-drill.js`, T `scripts/__tests__/restoreDrill.test.ts` (or CI job).
- **D3 replication** — N `infra/mongo/replicaset.js`/compose, M `db.ts` connection opts (w=majority), docs.
- **D4 DR runbook** — N `docs/runbooks/dr.md`.
- **D5 TTL** — M models (`Bill`, `Payment`, `AIUsageLog`, `WebhookEvent`, `RefreshToken`, `OtpRequest`, export artifacts) add TTL index; IDX.
- **Media backup** — M `storageService` integration.

## 8.3 DevOps
- **C1 git** — N `.gitignore`, `git rm -r --cached`, D tracked node_modules, D `react-app/**` (tracked), D `remix_-restaurant-pos-terminal/**` or relocate, N `LICENSE`.
- **C2 CI** — N `.github/workflows/ci.yml`, N `.github/workflows/release.yml`, M backend/package.json (test:ci), M Frontend/package.json (e2e:ci), M admin (build:ci).
- **C3 pin** — M all package.json (`engines`), N `.nvmrc`, M `Frontend/package.json` name/version.
- **C4 type-check** — M `backend/package.json` build (add `tsc --noEmit`), D stale @types deps.
- **C5 lint** — N eslint configs ×4, M package scripts, M tsconfig strictness.
- **C6 release** — N `.releaserc`, M electron-builder (publish github), N `ecosystem.config.js`, M docs.
- **C7 docker** — N `Dockerfile`, N `docker-compose.yml` (backend, mongo, redis, worker, proxy), N `nginx.conf`/TLS.
- **C8 env** — N `backend/.env.example`, `restaurant-pos/Frontend/.env.example`, `admin-dashboard/.env.example`.

## 8.4 Observability
- **M1 metrics** — N `middleware/prometheus.ts`, N `utils/metrics.ts` (histograms), M `server.ts`, T.
- **M2 Sentry** — N `utils/sentry.ts`, M `server.ts`, M frontends `main.tsx`.
- **M3 logging** — N `utils/logger.ts` (pino), M `middleware/requestLogger.ts`, M `server.ts`, M errorHandler, N `utils/requestId.ts`.
- **M4 alerting** — N `services/alertService.ts` (external), M `modules/audit/alertsService.ts` (deliver), N `config.ts`.
- **M5 health** — M `server.ts` health route (DB ping, Redis, queue, disk).
- **M6 slow-query** — M mongoose plugin `slowQueryLogger`, M `analyticsService.ts` slowEndpoints, N `utils/slowQuery.ts`.

## 8.5 Audit completeness
- **A1** — M `middleware/requestLogger.ts:144` (route via auditService), M `controllers/authController.ts:58-66` (route + mask), M `modules/subscription/subscriptionService.ts:285,533,666`, T audit tests.
- **A2** — M `modules/adminReports/*` export service + report controllers emit `report.exported`/`analytics.exported`.

## 8.6 Queues/Workers/Notifications
- **Q1** — N `queue/index.ts`, N `queue/worker.ts`, N `queue/queues.ts`, N `queue/jobs/*` (recurringExpense, loyaltyExpiry, campaign, export, snapshot), M `server.ts`, M `package.json` (worker script), M `config.ts`.
- **Q2–Q4** — M `services/recurringExpenseService.ts` (schedule, remove manual-only trigger), M `services/loyaltyService.ts` (schedule expirePoints), M `services/campaignService.ts` (dispatch due).
- **Q5** — M `modules/reports/controllers/reportsController.ts`, M `modules/adminReports/exportService.ts` (enqueue), M `services/analyticsExportService.ts`.
- **Q6** — M all schedulers (guard).
- **N1** — N `services/notificationService.ts`, N `services/emailService.ts`, N `services/smsService.ts`, N `services/pushService.ts` (optional), N `models/Notification.ts`, N `models/NotificationTemplate.ts`, N `controllers/notificationController.ts`, N `routes/notifications.ts`, M `services/campaignService.ts`, M `services/supportTicketService.ts`, M `services/loyaltyService.ts`, M `modules/qr-ordering/*` (ORDER_READY push), N `validation/notifications.ts`, T.
- **N4** — M `.env`, M `config.ts`, M `modules/subscription/subscriptionRoutes.ts` (verify webhook secret).

## 8.7 Core platform
- **P1 onboarding** — M `controllers/adminRestaurantsController.ts` (transaction + rollback + create User owner + default branch/settings), M `services/restaurantService.ts`, M `services/ownerService.ts`, M `db.ts`, T onboarding rollback tests.
- **P2 delete/restore** — M `controllers/adminRestaurantsController.ts` + `adminOwnersController.ts` (restore, permanent-delete), M `services/restaurantService.ts`, `ownerService.ts` (cascade policy), M `validation`, M `routes/admin.ts`, T cascade tests.
- **P3 validation** — M all admin mutation routes (`validate` + whitelist), N `validation/admin.ts` expanded, T.
- **P4 N+1** — M `controllers/adminRestaurantsController.ts`, `adminSubscriptionsController.ts` (aggregation instead of populate loops), M pagination totals (DB count).
- **P5 owners** — M `services/ownerService.ts` (sync on create), M owners dashboard.
- **P6 dead-code** — D `qrOrdering` mount or implement, M `admin-dashboard` routes (unreachable Subscriptions), M Analytics tab placeholder, M toast-only buttons (wire or remove).
- **P7 quotas** — M `services/subscriptionService.ts`/`entitlementService.ts` (enforce every write), M `deviceService.ts`.
- **P8 branches** — M device→branch scoping, M default branch bootstrap.

## 8.8 Reports/Analytics/Exports/AI
- **R1 hub** — N `admin-dashboard/src/pages/ReportsHub.tsx`, M `routes/index.tsx`, M `adminReports` route (hub aggregates).
- **R2** — M `modules/adminReports/aggregations/revenue.ts` (segmentation), M `models/Payment.ts` (refund/addon concepts), N `models/Refund.ts`, N `models/AddonOrder.ts`, M `aiUsageLogger` revenue fields.
- **R3** — M `modules/adminReports` (owner-activity, support-SLA with `firstResponseAt`, inactive buckets 7/30/90 + alert job).
- **R4** — M `modules/adminReports/exportService.ts` (JSON adapter), M export engine (async all).
- **R5** — M admin reports UI (unified filter bar), M API (filter schema).
- **R6** — N `modules/warehouse/*` (nightly materialization job, reading store), M reports read path.
- **AI1** — M `modules/ai/services/aiService.ts`, `voice-inventory/services/*` (streaming + timeout), M config.
- **AI2** — M `services/aiCostConfig.ts`, `services/aiUsageLogger.ts` (cost accuracy), M analytics.
- **AI3** — M `config.ts` fail-fast.
- **AI4** — M `admin-dashboard/src/pages/AIUsage.tsx`, `AiUsageDashboard.tsx` (finished UI), M `api/aiUsageAnalytics.ts`, repair E2E.

## 8.9 Frontend
- **F1** — M `Frontend/src/hooks/useBilling.ts` (functional updaters, `[]` deps), M `usePOSState.ts`, T.
- **F2** — M `Frontend/src/App.tsx` → split into `workspaces/*` route components, M `routes.ts`, M `vite.config.ts` (lazy).
- **F3** — N `components/virtual/VirtualList.tsx`, M ReceiptHistory/product grid/orders.
- **F4** — N `admin-dashboard/vitest.config.ts`, N `admin-dashboard/src/**/__tests__/*`, M `package.json`.
- **F5** — M `Frontend/e2e/tour-visual-verify.spec.ts` (login helper), M skipped AI specs, D no-op diagnostics.
- **F6** — M modals (focus trap), M nav (aria/keyboard), M admin (reduced-motion hook), N `hooks/useFocusTrap.ts`.
- **F7** — N POS `ui/` kit, M `index.css` tokens + dark variant, M components.
- **F8** — N POS shell components (Loading/Empty/Error), M offline banner.
- **F9** — N `customer-website/` (or update CUSTOMER_WEBSITE.md to "Planned").

## 8.10 Documentation
- **DOC1** — N `backend/src/utils/openapi.ts` (from Zod registry), M `server.ts` (serve `/docs`), regenerate `API_REFERENCE.md` (remove fabricated endpoints).
- **DOC2** — N `scripts/generate-schema-doc.ts`, M `DATABASE_SCHEMA.md` (ER + index registry).
- **DOC3** — N `docs/runbooks/production.md`, `docs/runbooks/troubleshooting.md`, `docs/runbooks/dr.md`.
- **DOC4** — M `README.md` (prereqs, relative links), `.env.example` ×3.
- **DOC5** — accuracy pass (ports, commands, counts, CHANGELOGs).
- **DOC6** — M LICENSE files + root LICENSE; decide MIT vs Apache-2.0.
- **DOC7** — M both `DECISIONS.md` (Phase-2 ADRs); M `PHASE-2.3-AUDIT.md` (fill or annotate).

---

# SECTION 9 — DATABASE ROADMAP

## 9.1 Missing collections
- `Refund`, `AddonOrder` (billing/revenue).
- `Notification`, `NotificationTemplate`, `NotificationDelivery` (notifications).
- `MfaCredential` (or extend `User`).
- `CampaignDispatch`, `ScheduledJob`/job-state (queue).
- `WarehouseSnapshot`/materialized store (reports).
- `ConsentRecord` (GDPR).
- `DataSubjectRequest` (SAR/erasure workflow).

## 9.2 Missing indexes
- TTL: `Bill.createdAt`, `Payment.createdAt`, `AIUsageLog.createdAt`, `WebhookEvent.createdAt`, `RefreshToken.expiresAt`, `OtpRequest.createdAt`, export artifacts.
- Report axes: `Payment.{planId,status,createdAt}`, `Subscription.{status,updatedAt}`, `AuditLog` platform queries.
- Unindexed sorts from 2.14 (8 unindexed sorts) — add as identified.
- Queue/job indexes (type, status, scheduledAt).

## 9.3 Missing relationships
- `Restaurant` → `User` owner (fix onboarding gap).
- `Branch` → `Device` scoping (branchId on Device).
- `Payment` → `Refund`, `Payment` → `AddonOrder`.
- `Notification` → user/restaurant.

## 9.4 Performance improvements
- `allowDiskUse` on 3 HIGH pipelines; `.maxTimeMS`; aggregation against materialized store for platform reports.

## 9.5 Migration order
1. TTL indexes (non-breaking).
2. `ConsentRecord` + `Refund`/`AddonOrder` (additive).
3. `Device.branchId` (additive + backfill).
4. Owner `User` backfill (onboarding fix).
5. Warehouse collections (additive).
6. Replica-set conversion (infra, not schema).

## 9.6 Retention & archiving
- Bills: define legal retention (e.g., 7y) with archive + anonimisation of PII snapshot after N days (GDPR).
- Ledgers/AIUsage/Webhook: TTL 90d/1y + archive.
- Audit: existing retention/archive/legal-hold (keep; ensure off-site).

## 9.7 Partitioning
- MongoDB: use time-bucketed collections (e.g., `DailySummary`, monthly archives) or capped collections for append-only telemetry; consider `AuditLog` archive tiers.

## 9.8 Backups
- mongodump nightly → encrypted S3 (90d retention); oplog-based PITR if feasible; replica-set members enable logical backups.

## 9.9 Rollback strategy
- Deployable migrations (forward-only) + schema-version marker; code/schema decoupled via compatibility window; DB rollback via restore from backup (no destructive auto-migrations).

---

# SECTION 10 — API ROADMAP

## 10.1 Conventions for all new/missing APIs
Every endpoint: **Method, Route, Auth (requireAuth), AuthZ (requireAccess/collection), Validation (Zod), Rate limit (tier), Caching (if GET), Audit event, Response envelope, Pagination/filter/sort (if list), Error mapping, Test.**

## 10.2 Missing APIs (consolidated)

| Method | Route | Auth/AuthZ | Validation | Rate | Cache | Audit | Notes |
|---|---|---|---|---|---|---|---|
| POST | `/admin/mfa/enroll` | super_admin+owner | zod | auth | — | `security.mfa_enrolled` | MFA |
| POST | `/admin/mfa/verify` | auth | zod | auth | — | `security.mfa_verified` | |
| POST | `/api/mfa/enroll` (owner) | owner | zod | auth | — | `security.mfa_enrolled` | |
| POST | `/admin/restaurants/:id/restore` | admin+Restaurant | zod | api | inv | `restaurant.restored` | P2 |
| DELETE | `/admin/restaurants/:id/permanent` | super_admin | zod+confirm | api | inv | `restaurant.permanently_deleted` | P2 |
| POST | `/admin/owners/:id/restore` | admin+User | zod | api | inv | `owner.restored` | P2 |
| DELETE | `/admin/owners/:id/permanent` | super_admin | zod | api | inv | `owner.permanently_deleted` | P2 |
| POST | `/api/customers/:id/consent` | restaurant | zod | api | inv | `customer.consent_updated` | G2 |
| GET | `/api/customers/:id/data-export` | restaurant (merchant) | zod | api | — | `customer.data_exported` | G3 SAR (merchant-side) |
| POST | `/admin/dsr/requests` | admin | zod | api | — | `dsr.request_created` | SAR workflow |
| POST | `/admin/dsr/:id/erase` | admin | zod | api | — | `dsr.erasure_completed` | |
| GET/POST | `/admin/notifications` | admin | zod | api | yes | `notification.list/created` | N1 |
| GET/POST | `/api/notifications` | owner | zod | api | yes | `notification.*` | N1 |
| PUT | `/api/notifications/preferences` | owner | zod | api | — | `notification.preferences` | N3 |
| GET | `/admin/analytics/sla` | admin+SupportTicket | zod | api | 120s | `report.exported`? | R3 |
| GET | `/admin/analytics/activity` | admin+User | zod | api | 120s | — | R3 |
| GET | `/admin/analytics/inactive` | admin+Restaurant | zod | api | 300s | — | R3 |
| GET | `/admin/reports/hub` | admin | zod | api | 120s | `report.generated` | R1 |
| GET | `/admin/revenue/segmentation` | admin+Subscription | zod | api | 120s | `report.generated` | R2 |
| GET | `/admin/reports/export.json` | admin | zod | api | — | `report.exported` | R4 |
| POST | `/api/jobs/:id/cancel` | owner/admin | zod | api | — | `job.cancelled` | Q |
| GET | `/api/jobs/:id/status` | owner/admin | zod | api | yes | — | Q |
| GET | `/metrics` | unauthenticated (network-restricted) | — | — | — | — | M1 |
| GET | `/api/health/ready` | unauthenticated | — | — | — | — | M5 |
| GET | `/docs` | auth (or restricted) | — | — | — | — | DOC1 |

**Also required (existing surface, fix not add):** tenant-scope enforcement on `/api/orders`, `/api/employees`, `/api/tables`, `/api/held-orders`, `/api/takeaway-orders` (S2); admin rate limits on `/api/admin/*` (S11); validation on all admin mutation routes (P3); correct `POST /api/bills` daily-summary/sync doc accuracy (DOC1); report-generation audit events (A2).

---

# SECTION 11 — FRONTEND ROADMAP

## 11.1 Missing pages
- **Admin:** Reports Hub, Subscriptions (route it), AI Usage (finish), Settings (route it), Refunds/Addon admin, DSAR/consent admin, Notifications center.
- **POS:** none critical; workspace polish.
- **Customer website:** entire app (or mark Planned).

## 11.2 Missing dialogs
- MFA enrollment/verify; consent capture; data-deletion confirmation (permanent); export progress; notification preferences.

## 11.3 Missing components
- Virtual list; focus-trap modal; notification badge; consent checkbox (with provenance); empty-state shells for POS; skeleton (POS); date-range picker (admin reports).

## 11.4 Missing charts
- Admin: revenue segmentation (donut), inactive buckets (bar), SLA (timeline), owner activity (line), AI revenue (area). All in recharts.

## 11.5 Missing dashboards
- Admin Reports Hub (consolidated KPIs).

## 11.6 Missing exports
- JSON for all admin reports; progress-aware export UX everywhere (reuse audit export pattern).

## 11.7 Missing filters
- Unified report filter bar (date range, restaurant, plan, owner, status).

## 11.8 Missing search
- Global admin search scope expansion (owners, users, audits, tickets).

## 11.9 Missing responsive work
- POS 100dvh/DPI handled; admin responsive at 1024px; customer site (if built) mobile-first.

## 11.10 Missing accessibility
- Focus traps, ARIA on toasts/modals/nav, keyboard nav (admin), reduced-motion (admin), color-contrast pass, alt text.

## 11.11 Missing loading states
- POS skeletons; admin already strong (13 pages) — extend to new pages.

## 11.12 Missing empty states
- POS lists (no EmptyState shell); admin strong — extend.

## 11.13 Missing error states
- POS navigation error shell; admin strong — extend to new pages.

---

# SECTION 12 — SECURITY ROADMAP

## 12.1 RBAC
- Adopt Permission Engine; define per-route policy map; audit role changes; enforce deny-by-default; add admin-only assignee validation in support.

## 12.2 Authentication
- MFA (TOTP) for super_admin + owner (S6); httpOnly cookie migration (S7); admin refresh/revocation (S5); OTP hardening (S8); password policy (min length on admin change, breach check, expiry optional).

## 12.3 Authorization
- Tenant-bind 5 services (S2); cache-key scope (S1); fail-closed subscription (S9); financial masking (S12).

## 12.4 Audit
- Route all writes through Audit Engine (A1); audit report generation (A2); audit MFA events; audit consent/erasure.

## 12.5 Encryption
- At rest: Mongo field-level/KMS (G4); transport: TLS proxy + HSTS; token storage: httpOnly.

## 12.6 Secrets
- Remove hardcoded seed (S3); fail-fast validation (S4); secrets manager (C8); `.env.example`; remove dev fallbacks.

## 12.7 Rate limiting
- Redis-backed; per-tenant + per-IP; admin tiers (S11); OTP resend limits; export throttling.

## 12.8 CSRF
- With httpOnly cookie migration: add CSRF protection (double-submit token or SameSite=strict) for mutating requests.

## 12.9 XSS
- CSP (already in Electron) extend to web; sanitize render; tokens out of localStorage; SRI for CDN.

## 12.10 CORS
- Explicit allowlist (prod); no wide-open dev without flag.

## 12.11 Headers
- helmet: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS; served by proxy + app.

## 12.12 Session security
- Refresh rotation (exists) + device fingerprint + absolute timeouts; session list UX.

## 12.13 Password policies
- Min length, complexity, reset tokenization, no plaintext return, optional periodic rotation, breach-check.

## 12.14 2FA
- TOTP enrollment/verify/recovery codes; enforced for super_admin.

## 12.15 Compliance
- GDPR (consent, SAR, erasure, retention, encryption, DPA); SOC2 (MFA, backups, vuln-mgmt, incident-response, access reviews); PCI (SAQ-A evidence, 3DS doc, vendor assessment, no card data); OWASP (SANS top-10 sweep, dependency scan, SAST).

---

# SECTION 13 — PERFORMANCE ROADMAP

- **Database:** allowDiskUse + maxTimeMS + explain regressions + TTL + warehouse reads.
- **Caching:** tenant-key fix (P0); Redis + failover; sweep Maps; invalidation gaps.
- **Redis:** enable in prod; shared rate store + queue + cache.
- **Indexes:** add unindexed sorts + report axes + TTL.
- **Query optimization:** kill 6 N+1; batch counter queries; aggregation pushdown.
- **Pagination:** caps everywhere; cursor for audit already done; fix `limit||0`.
- **Batching:** coalesce sync/refetch; batch audit writes.
- **Streaming:** AI streaming; SSE for ORDER_READY; stream CSV exports.
- **Lazy loading:** POS code-split; images lazy+sized.
- **Compression:** gzip already good; add brotli at proxy.
- **Image optimization:** webp/srcset pipeline; object storage CDN.
- **Bundle optimization:** split App.tsx; vendor chunks; tree-shake.
- **Memory:** bound export buffers (stream to disk/object); sweep caches; cap pagination.
- **Queue processing:** offload exports/snapshots/AI to workers.

---

# SECTION 14 — TESTING ROADMAP

- **Unit:** expand backend services (29 missing) + frontends.
- **Integration:** supertest booting Express for routes/controllers (T2).
- **API:** contract tests against OpenAPI (once DOC1).
- **Frontend:** vitest for admin (F4) + POS logic.
- **Playwright:** fix tour spec; un-skip AI; add admin E2E smoke; cross-browser (webkit/firefox).
- **Coverage:** `src/**`, thresholds backend 70% (raise over time), Frontend 60%, admin 50% (start).
- **CI:** all suites gated; `CI=true` for retries/forbidOnly.
- **Performance:** k6/hey smoke; load baseline; N+1 detector.
- **Security:** ZAP/OWASP basic scan; dependency audit in CI; secret scan (gitleaks).
- **Accessibility:** axe-core in Playwright.
- **Regression:** full suite each PR; restore-drill; cache-isolation regression.
- **Mutation:** optional (stryker) for auth + billing core.
- **Stress/Load:** 100-restaurant and 10k-restaurant profile; queue throughput.
- **Target coverage:** backend ≥70% line; POS unit ≥60%; admin ≥50%; E2E critical paths 100% passing.

---

# SECTION 15 — PRODUCTION ROADMAP

- **Monitoring:** prometheus metrics, dashboards (Grafana optional), alert rules.
- **Logging:** pino, request-ID, central sink (Loki/ELK), rotation.
- **Alerting:** email/Slack/PagerDuty on health, tamper, 5xx, queue depth, backup failure.
- **Health checks:** `/health` (DB/Redis/queue/disk), `/ready`.
- **Metrics:** RED + business (MRR, active restaurants, sync backlog).
- **Tracing:** OpenTelemetry (optional, phase-later).
- **Deployment:** CI/CD pipeline; blue-green/canary on replicas; release automation + tags.
- **Rollback:** git tags + artifact provenance; schema-compatible deployments; feature-flag kill-switch.
- **DR:** runbook + drills (quarterly).
- **Backups:** automated, off-site, encrypted, monitored.
- **Scaling:** stateless replicas behind LB; Redis shared; Mongo replica set + read replicas; queue workers horizontal.
- **Docker:** backend + worker images; compose for dev; k8s later.
- **Kubernetes:** deferred (after Docker + 100-restaurant scale proven).
- **Environment configs:** dev/staging/prod presets; `.env.example`; secrets via manager.
- **Secrets:** manager-backed, rotated, scanned.

## 15.9 Production GO gate (from 2.18)
Security ≥70 · Testing ≥70 · Monitoring ≥70 · DevOps ≥70 · Compliance ≥60 (or scoped) · restore drill within RPO/RTO · zero open P0 · 30-day live-shadow with zero P0/P1.

---

# SECTION 16 — IMPLEMENTATION PRIORITY MATRIX

| Priority | Tasks | Why |
|---|---|---|
| **Critical** | C1 (repo), S1 (cache-key), S2 (tenant-bind), S3 (seed), D1-D4 (backups/DR), C2 (CI) | Existential: data loss, cross-tenant breach, no provenance, no safety net |
| **High** | S4-S12, D5, M1-M6, A1-A2, Q1-Q6, N1-N4, G1-G6, P1-P5, C4-C5, T1-T4 | Deploy-blocking quality/security/compliance; prerequisite to scale |
| **Medium** | P6-P8, R1-R6, AI1-AI5, F1-F8, T5-T8, C6-C8, DOC1-DOC7 | Feature completeness, polish, enterprise reporting |
| **Low** | F9 (customer site), legacy cleanup remainder, version cosmetics, PHASE-2.3 closure | Large scope / nice-to-have / documentation hygiene |
| **Very Low** | 2.1 leftover cleanups (qr-ordering imports, dup-index warnings), naming cosmetics | Cosmetic, non-blocking |

---

# SECTION 17 — EFFORT ESTIMATION

> Assumptions: 2 senior engineers; S=0.5–1d, M=2–4d, L=1–2w, XL=3–5w. Testing ~50% of coding time for risky items. Review 15%.

## 17.1 Per module
| Module | Complexity | Dev | Test | Review | Risk | Confidence |
|---|---|---|---|---|---|---|
| Security & isolation (S1–S12) | M | 10d | 5d | 2d | High | High |
| Backups/DR (D1–D4) | M | 6d | 3d | 1d | Medium | High |
| CI/CD (C2,C6-C8) | M | 8d | 3d | 1d | Medium | High |
| Observability (M1–M6) | M | 8d | 3d | 1d | Low | High |
| Audit completion (A1-A2) | M | 4d | 2d | 1d | Medium | High |
| Queue/workers (Q1–Q6) | XL | 12d | 5d | 2d | High | Medium |
| Notifications (N1–N4) | L | 8d | 3d | 1d | Medium | Medium |
| Compliance (G1–G6) | L | 10d | 4d | 2d | Medium | Medium |
| Core platform (P1–P8) | L | 10d | 5d | 2d | High | Medium |
| Reports/exports (R1–R6) | XL | 14d | 6d | 2d | Medium | Medium |
| AI (AI1–AI5) | L | 8d | 4d | 1d | Medium | Medium |
| Frontend (F1–F9) | XL | 16d | 8d | 3d | Medium | Medium |
| Testing (T1–T8) | L | 10d | — | 2d | Low | High |
| Documentation (DOC1–DOC7) | M | 8d | — | 1d | Low | High |
| Git re-base (C1) | M | 2d | 1d | 1d | High | High |
| **Total** | | **≈134 dev-days** | **≈52 test-days** | **≈23 review-days** | | |

## 17.2 Per wave
| Wave | Dev days | Est weeks (2 eng) |
|---|---|---|
| 1 Foundation | 5 | 1 |
| 2 Security | 10 | 2 |
| 3 Durability | 5 | 1 |
| 4 CI/CD | 8 | 2 |
| 5 Observability | 8 | 2 |
| 6 Queues/Notify | 16 | 2.5 |
| 7 Compliance | 10 | 2 |
| 8 Core platform | 12 | 2.5 |
| 9 Reports | 16 | 3 |
| 10 AI | 8 | 1.5 |
| 11 Frontend | 20 | 4 |
| 12 Testing | 10 | 3 |
| 13 Docs | 6 | 2 |
| **Total** | **≈134** | **≈28–29 weeks (~7 months)** |

## 17.3 Overall
- **Engineering: ~6–7 months (2 seniors), realistic 8–10 with buffers/reviews.** Single senior: ~12–14 months.
- **Risk-adjusted:** 6–12 months to enterprise production readiness (matches 2.18).

---

# SECTION 18 — MASTER CHECKLIST

☐ **Repository** — re-base, .gitignore, remove node_modules/dead trees, root LICENSE, versions pinned, lint+strict TS
☐ **Authentication** — MFA, httpOnly cookies, admin refresh, OTP hardening, password policy, no plaintext PIN
☐ **Authorization** — tenant-bind 5 services, cache-key scope, fail-closed subscription, permission engine
☐ **RBAC** — policy map, admin-only assignee, role-change audit, deny-by-default
☐ **Billing** — refunds/addons, revenue segmentation, webhook secret, dunning, subscription/restaurant status unification
☐ **Reports** — admin hub, SLA/activity/inactive, segmentation, unified filters, warehouse
☐ **Audit** — route bypasses, report/export events, tamper chain complete, off-site chain backup
☐ **Analytics** — shared engine, materialized snapshots, cost accuracy
☐ **AI** — streaming/timeouts, cost fix, env fail-fast, E2E green, revenue layer
☐ **Exports** — async all, JSON adapter, signed+encrypted, artifact retention
☐ **Dashboard** — admin tests, a11y, dark mode parity, empty/error/loading states
☐ **Notifications** — email/SMS/push, ORDER_READY push, preferences, campaign delivery, webhook verify
☐ **Monitoring** — metrics, Sentry, structured logs+requestID, alerting, deep health, slow-query
☐ **Testing** — coverage src/** + thresholds, HTTP + RBAC + services + admin + E2E green in CI
☐ **Deployment** — CI/CD, containers, TLS proxy, release automation, rollback, DR runbook, backups off-site
☐ **Compliance** — GDPR (consent/SAR/erasure/encryption/DPA), SOC2 (MFA/backups/vuln-mgmt), PCI (SAQ-A/3DS), OWASP sweep
☐ **Documentation** — OpenAPI, schema+ER, runbooks, prereqs, accuracy, license, ADRs
☐ **Performance** — cache-key, sync cap, N+1, allowDiskUse, virtualization, TTL, Redis, pagination caps

---

# SECTION 19 — FINAL EXECUTION PLAN (SPRINTS)

Sprint length 2 weeks; 2 engineers; order follows dependency graph (Waves 1–13).

| Sprint | Goals | Tasks | Dependencies | Deliverables | Testing | Definition of Done |
|---|---|---|---|---|---|---|
| **S1** | Trustworthy repo | C1, C3, C4, C5; logging/response/config foundation | — | Clean repo; lint+typecheck green; foundation libs | Backend suite green post-refactor | `git status` clean of node_modules; tsc+lint pass; no regressions |
| **S2** | Isolation P0 | S1, S2, T7 isolation tests | S1 | Cache-key + tenant-bind | Isolation regression tests green | Cross-tenant tests pass; orders/employees/tables scoped |
| **S3** | Secrets & admin auth | S3, S4, S5, S8, S10 | S1 | Seed refactor; hard-fail; admin auth; OTP | Auth+seed tests | No hardcoded seed; startup fails on missing secrets; no plaintext PIN |
| **S4** | MFA + tokens + fail-closed | S6, S7, S9, S11, S12 | S2/S3 | MFA; cookies; fail-closed; rate limits; masking | MFA + middleware tests | Super_admin MFA enforced; admin throttled; subscription denies by default |
| **S5** | Backups & DR | D1, D2, D3, D4, D5 | S1 | Backup/restore scripts; replica set; TTL; runbook | Restore-drill job | Nightly backups verified; drill passes; TTL live |
| **S6** | CI/CD | C2, C6, C7, C8 | S1–S5 | Actions pipeline; release; Docker; env examples | Full suite in CI; coverage thresholds | PRs gated; coverage ≥70% backend; tagged release |
| **S7** | Observability | M1–M6, A1, A2 | S6 | Metrics; Sentry; pino; alerts; audit completion | Alert smoke tests | /metrics live; alerts fire; 0 audit bypasses |
| **S8** | Queue system | Q1, Q6 | S7 | BullMQ + worker; guards | Queue unit tests | Jobs run in worker; overlap-safe |
| **S9** | Scheduled features | Q2, Q3, Q4, Q5 | S8 | Recurring/expiry/campaigns; async exports | Scheduler tests | Auto-fire verified; exports non-blocking |
| **S10** | Notifications | N1, N2, N3, N4 | S8/S9 | Delivery service; push; prefs; webhook | Delivery integration tests | Email/SMS deliver; webhook verified |
| **S11** | Compliance | G1, G2, G3, G4, G6 | S3/S4 (MFA/encryption) | Legal docs; consent; SAR/erasure; encryption | GDPR flow tests | Consent+SAR+erasure working; SAQ-A evidence |
| **S12** | Onboarding & lifecycle | P1, P2, P5 | S2 | Atomic onboarding; delete/restore; owners | Onboarding rollback + cascade tests | Onboarding atomic; owner list consistent |
| **S13** | Validation & scale | P3, P4, P7, P8 | S12 | Admin validation; N+1; quotas; branch scoping | Route validation tests | All admin mutations validated; N+1 gone |
| **S14** | Platform cleanup | P6 | S13 | Dead code removal | Regression | No dead routes/UI; build clean |
| **S15** | Reports hub | R1, R5 | S8/S13 | Hub page + unified filters | UI + API tests | Hub live; filters work |
| **S16** | Revenue & SLA | R2, R3 | S15 | Segmentation; SLA/activity/inactive; AI revenue | Aggregation tests | Reports accurate + audited |
| **S17** | Exports & warehouse | R4, R6 | S15/S16 | JSON export; async all; warehouse | Export + warehouse tests | All exports async; nightly snapshots |
| **S18** | AI hardening | AI1, AI2, AI3, AI4, AI5 | S16/S17 | Streaming; cost fix; env; UI; E2E | AI tests green | AI non-blocking; cost accurate; E2E green |
| **S19** | POS performance | F1, F2, F3, F8 | S13 | Re-render fix; split; virtualization; shells | Unit + E2E | 60fps interactions; lazy workspaces |
| **S20** | Admin & a11y | F4, F6, F7 | S19 | Admin tests; a11y; design tokens | Playwright a11y | Admin smoke green; axe passes |
| **S21** | E2E + coverage | F5, T1–T8 | S19/S20 | Repair E2E; HTTP/RBAC/services tests | Full suite | All E2E green; coverage ≥70% |
| **S22** | Documentation | DOC1–DOC7 | S21 | OpenAPI; schema+ER; runbooks; accuracy; ADRs | Doc-accuracy checks | OpenAPI served; docs accurate |
| **S23** | GO gate & shadow | 30-day live-shadow, re-audit | all | Shadow run; scorecard | Load + security + restore drills | Zero P0/P1 in 30d; gates met |

---

# SECTION 20 — FINAL VERDICT

**How complete is the project?**
- Overall **≈34%**, backend **≈70%**, frontend **≈55%**, database **≈60%**, API breadth **≈70%**, security **≈35%**, AI **≈50%**, reporting **≈60%**, billing **≈75%**, testing **≈35%**, deployment **≈20%**. It is a **strong prototype with enterprise-grade components, not an enterprise product.**

**Biggest risks**
1. Cross-tenant data isolation leaks (cache + 5 unbound services) — trust-breaker, P0.
2. No backups/DR — total data loss exposure, P0.
3. Repo with no real history — zero provenance/rollback, P0.
4. No compliance — GDPR/SOC2/PCI blockers.
5. Unmonitored, un-metriced production path.
6. POS monolith + re-render storm — UX and scale ceiling.

**What blocks production?**
The four P0s (source-control, backups/DR, tenant isolation, secrets) plus a working CI/CD gate and observability. Nothing else blocks.

**What can wait?**
Customer website, AI revenue layer, warehouse (until 10k+ restaurants), OWASP deep-scan (after CI exists), Kubernetes, mutation testing, marketing/branding docs.

**What must be built first?**
Wave 1 (repo re-base + foundation) → Wave 2 (isolation + secrets) → Wave 3 (backups/DR) → Wave 4 (CI/CD). Everything else depends on these.

**Estimated time to enterprise production readiness**
- **6–7 months** (2 senior engineers, focused), **8–12 months** risk-adjusted with reviews, compliance sign-off, and a 30-day live-shadow gate. **Single engineer: ~12–14 months.**

---

*END OF MASTER-ENGINEERING-BLUEPRINT.md*
*This document is the single source of truth for Phase 3 implementation. No source files were modified during its creation.*

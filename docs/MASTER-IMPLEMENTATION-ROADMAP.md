# MASTER IMPLEMENTATION ROADMAP

**Generated:** 06 Aug 2026 · **Type:** READ-ONLY PLANNING DOCUMENT (Phase 3 driver)
**Inputs:** Every audit/implementation report from Phase 2.1 → 2.18 (2.1-REPORT, 2.2-AUDIT, 2.3-AUDIT, 2.8-IMPLEMENTATION, 2.9-AUDIT, 2.9-IMPLEMENTATION, 2.10-AUDIT, 2.11-TESTING-AUDIT, 2.12-MONITORING-AUDIT, 2.14-PERFORMANCE-AUDIT, 2.15-BACKUP-DR-AUDIT, 2.16-DEVOPS-CICD-AUDIT, 2.17-DOCUMENTATION-AUDIT, 2.18-ENTERPRISE-AUDIT) + fresh source verification + 6 targeted deep-dives (auth/RBAC, audit/observability, cache/queues/reports, compliance, code-quality, frontend/UI).
**Source of truth:** the working tree. Where audits disagreed, the source code was re-checked and the roadmap follows the source.

---

# 1. EXECUTIVE SUMMARY

Phase 2 (audit) is complete across all 18 sub-phases. The platform is a **capable multi-tenant POS/SaaS prototype with strong engineering fundamentals but critical production gaps.** It is currently **NOT production-ready (NO-GO)**, with an overall completion of **≈34%**.

**Four category-killing blockers dominate:**
1. **Real source not under version control** (2 commits; 81% of tracked files = committed `node_modules`; actual `backend/`, `admin-dashboard/`, `restaurant-pos/` uncommitted).
2. **Zero backups / zero DR** (Phase 2.15: **4/100**) — all state on one MongoDB node, single disk.
3. **Two live cross-tenant data-isolation failures** — response-cache keys omit `restaurantId` (Restaurant B can receive Restaurant A's cached reports); and 5 core services (`orders`, `employees`, `tables`, `held-orders`, `takeaway-orders`) run unbound queries with no tenant filter and no controller access check.
4. **No compliance posture** (GDPR/PCI/SOC2 all unmet) — no legal/trust docs, no consent/erasure, no at-rest encryption, no MFA.

**Strongest assets to preserve:** layered backend architecture; enterprise audit subsystem (hash chain, tamper verification, retention, masking — ~78/100); JWT rotation + reuse detection; near-total admin RBAC (220/219 routes); admin-dashboard engineering (React Query, lazy routes, design system); POS offline-first sync engine; 505-test backend suite.

This roadmap consolidates **every** gap from all 18 phases into a deduplicated, dependency-ordered, priority-classified implementation plan to drive Phase 3. The final recommended order is **Foundation → Security/Isolation → Durability → DevOps/CI → Observability → Compliance → Core Platform → Reports/Exports → AI → Frontend → Testing → Documentation.**

---

# 2. OVERALL COMPLETION

| Dimension | Score | Source |
|---|---|---|
| Overall project completion | **≈34%** | weighted |
| Production readiness | 25/100 | 2.18 |
| Security readiness | 35/100 | 2.18 |
| Performance | 62/100 | 2.14 |
| Testing | 35/100 | 2.11+2.18 |
| Monitoring / Observability | 30/100 | 2.12+2.18 |
| DevOps / CI-CD | 24/100 | 2.16 |
| Documentation | 30/100 | 2.17 |
| Scalability | 20/100 | 2.18 |
| Compliance (GDPR/PCI/SOC2) | 15/100 | 2.18 |
| Backup / DR | 4/100 | 2.15 |
| Enterprise readiness | **NOT READY** | 2.18 |

---

# 3. OVERALL PRODUCTION READINESS

**NOT PRODUCTION-READY.** Per 2.18: GO/NO-GO = **NO-GO**. Production readiness by context:
- Single restaurant POS: **7/10** (works; no restore/validation/owner-consistency).
- Multi-branch chain: **4/10**.
- Owner multi-restaurant: **5/10**.
- Enterprise cloud SaaS: **3/10**.
- **Gate to GO:** Architecture ≥75, Security ≥70, Testing ≥70, Monitoring ≥70, DevOps ≥70, Compliance ≥60 (or scope-controlled), plus a 30-day live-shadow run with zero P0s.

---

# 4. PHASE-BY-PHASE SUMMARY (2.1 → 2.18)

| Phase | Focus | Status | Completion | Key carry-forward work |
|---|---|---|---|---|
| 2.1 | Backend foundation | ✅ Implemented | ~85% | Response envelope, queryParser, session mgmt (list/revoke/reuse-detection), error mapping done. Residual: qr-ordering broken imports (`'../../middleware/'`), mongoose dup-index warnings. |
| 2.2 | Restaurant mgmt | 🟡 Audited | **62/100** | Onboarding not atomic (no rollback); no restore/permanent-delete/cascade; owner identity inconsistent (createRestaurant doesn't create `User` owner); no validation on admin mutation routes (`$set: body` mass-assignment); N+1 in lists; `resetRestaurantPassword` returns plaintext PIN; dead `qrOrdering` mount; disconnected UI (Reset/Restart/Regenerate toast-only; Subscriptions page unrouted). |
| 2.3 | (Incomplete audit) | 🔴 | — | **PHASE-2.3-AUDIT.md is an unfilled template** (prompt-only, no findings). No implementation work derived; treated as requiring a re-run or closure. |
| 2.8 | Support center | ✅ Implemented | ~100% | Tickets/replies/counters/state-machine/media/audit done. Carry: no external notification delivery; assignee not restricted to admins at service layer; text-index optional. |
| 2.9 | Audit subsystem | ✅ Implemented | ~78/100 | Hash chain, integrity verify, retention/archive, masking, exports, alerts, saved searches done. **Carry: 20 direct `AuditLog.create()` bypass sites** (requestLogger, failed-login, subscriptionService ×3) break the tamper chain + leak unmasked PII. |
| 2.10 | Admin reports | 🟡→🟢 | ~42→**~75%** (superseded) | **NOTE:** much of 2.10 was later implemented — `modules/adminReports` now has MRR/ARR/forecast/refunds, churn bug **fixed** (SubscriptionHistory enums), feature-adoption, async ReportExportJob. Carry: no report-generation audit logging; no field-level masking on financial payloads; no data warehouse; Admin Reports hub; JSON export; AI revenue; sync exports at scale. |
| 2.11 | Testing | 🟡 Audited | 35/100 | HTTP layer 0% (55 controllers, 33 routes); 29 services untested; admin 0%; coverage measures only `modules/ai/**`; 1 failing + 6 skipped + 2 no-op E2E; no CI. |
| 2.12 | Monitoring | 🔴 Audited | **29/100** | No `/metrics`, Prometheus, OTEL, Sentry, structured logging, request-ID in logs, alerting. Business telemetry strong (AI/audit/webhook/device). |
| 2.14 | Performance | 🟡 Audited | **62/100** | P0: cross-tenant cache-key collision; unbounded `/api/sync` cross-tenant replay; `limit\|\|0` footgun. P1: POS re-render storm; 3 HIGH pipelines (no allowDiskUse); 6 N+1 loops; inline blocking AI; no virtualization; 3 unbounded Maps; whole-file export buffers; no TTL on collections. |
| 2.15 | Backup/DR | 🔴 Audited | **4/100** | ZERO mongodump/restore/replication/off-site/scheduling/monitoring/restore-test; RPO/RTO undefined; no DR runbook. |
| 2.16 | DevOps/CI-CD | 🔴 Audited | **24/100** | No CI platform; no root `npm test`; no lint; no release automation/tags; no Docker/k8s; no secrets manager; **CRITICAL git hygiene** (node_modules committed, source uncommitted); hardcoded `super_admin` seed. |
| 2.17 | Documentation | 🔴 Audited | **30/100** | API docs 1.3% (7/548, 2 fabricated); DB docs 4.9% (4/82 models, no ER); no OpenAPI; no runbook; no prerequisites; accuracy errors (ports/commands/counts); license contradiction (MIT vs Apache-2.0). |
| 2.18 | Enterprise readiness | 🔴 Final | **34% overall, NO-GO** | Consolidates all above; confirms tenant-isolation P0s; adds compliance matrix. |

---

# 5. CONSOLIDATED MISSING FEATURES (deduplicated)

## 5.1 Security & Tenant Isolation (P0)
- **S1.** Fix cross-tenant response-cache key collision (`ResponseCache.generateKey` must include `restaurantId`/user scope).
- **S2.** Bind `orders/employees/tables/held-orders/takeaway-orders` repositories to `forTenant(restaurantId)` + add controller access checks + cross-tenant read tests.
- **S3.** Remove seeded `super_admin/1008` + per-boot password re-seed + unconditional Authorization wipe/regrant (`db.ts`); seed from env, empty-DB-only.
- **S4.** Replace dev JWT/refresh secret fallbacks with hard-fail everywhere (not only `NODE_ENV=production`).
- **S5.** Admin auth: dedicated admin secret + refresh/revocation; enforce password-min-length on `change-password` (no `validate` schema today).
- **S6.** Add **MFA (TOTP)** for super_admin + owner; wire unused OTP 'login' purpose or remove.
- **S7.** Move admin tokens to `httpOnly` cookies (or add strong XSS controls); keep POS tokens session-scoped.
- **S8.** OTP: salt+HMAC the sha256 hash; gate `simulatedCode` echo behind explicit non-prod env flag.
- **S9.** Subscription middleware: fail-closed on error/no-record; enforce plan limits on every write path.
- **S10.** Plaintext-PIN exposure on `resetRestaurantPassword`/`resetOwnerPassword` — return reset-link/PIN once, never plaintext in response body.
- **S11.** Rate limit: apply a stricter limiter to `/api/admin/*` and `/api/admin/reports/*` (currently escape global limiter); per-tenant rather than per-IP.
- **S12.** Field-level masking on financial/admin report payloads (defense-in-depth beyond RBAC).

## 5.2 Data Durability (P0)
- **D1.** Automated `mongodump` backups (schedule) → encrypted off-site object storage; retention policy.
- **D2.** Restore path + **restore-validation test** (monthly drill); define RPO/RTO.
- **D3.** Replication (replica set) + failover; media/upload backup.
- **D4.** DR runbook + on-call procedure.
- **D5.** TTL/retention on bills/ledgers/AIUsage/WebhookEvent/RefreshToken/OtpRequest (bound growth).

## 5.3 DevOps / Repo (P0)
- **C1.** Git re-base: root `.gitignore`; `git rm -r --cached node_modules`; commit real source; remove `react-app`/`remix_-restaurant-pos-terminal` dead trees; add root `LICENSE`; resolve MIT-vs-Apache-2.0.
- **C2.** GitHub Actions CI: backend `tsc --noEmit` + `vitest` (coverage→`src/**`, thresholds), POS lint+unit+Playwright (CI=true, `playwright install`), admin `tsc && build`. Fail on any step.
- **C3.** Node pinning (`engines`, `.nvmrc`); rename `react-example@0.0.0` → `pos-terminal-frontend@1.0.0`.
- **C4.** Backend build type-check (`tsc --noEmit` in build); remove stale `@types/mongoose@5`, `@types/ioredis@4`, `@types/express-rate-limit@5`.
- **C5.** Lint everywhere (ESLint/Oxlint + Prettier) with strict TS (backend strict today; Frontend/admin/electron not).
- **C6.** Release automation: semantic-release + git tags + electron-builder `publish:github` (auto-update channel) + `ecosystem.config.js`/pm2 or systemd.
- **C7.** Dockerize backend + compose (Mongo/Redis); reverse proxy + TLS config.
- **C8.** Secrets manager integration (or at least `.env.example` + fail-fast validation for AI/Razorpay/Weather keys).

## 5.4 Observability (P1)
- **M1.** Prometheus `/metrics` (prom-client) — latency/error/throughput histograms.
- **M2.** Sentry for backend + both frontends (crash reporting, source maps).
- **M3.** Structured logging (pino) + request-ID/correlation-ID in every log line + log rotation/sink.
- **M4.** External alerting (email/Slack/PagerDuty) on health/tamper/error spikes.
- **M5.** Deeper `/api/health` (Redis, DB ping with latency); readiness/liveness split.
- **M6.** Slow-query logging (`.maxTimeMS`, `explain` reports), slow-endpoint aggregate (fix `slowEndpoints` stub).

## 5.5 Audit Completeness (P1)
- **A1.** Route all 20 `AuditLog.create()` bypasses (requestLogger, failed-login, subscriptionService) through `auditService`; dedupe dual-write paths.
- **A2.** Audit report/analytics generation + exports (`report.exported`/`analytics.exported`).

## 5.6 Queues, Workers & Scheduling (P1)
- **Q1.** Job queue (BullMQ) + separate worker process; graceful shutdown.
- **Q2.** Schedule **recurring expenses** generation (currently manual `POST /run`).
- **Q3.** Schedule **loyalty points expiry** (currently manual).
- **Q4.** Schedule **campaign dispatch** (currently manual send).
- **Q5.** Move report export + nightly snapshots off the main thread; add overlap/run guards; paginate export jobs.
- **Q6.** Overlap/crash/replay-safety guards on all `setInterval` schedulers.

## 5.7 Notifications (P1)
- **N1.** Real outbound delivery (email via SES/SMTP; SMS/WhatsApp gateway; optional push) replacing `CampaignService.sendChannel()` console stub.
- **N2.** QR-ordering `ORDER_READY` push (SSE/WebSocket or FCM) instead of poll-only.
- **N3.** Loyalty tier-change / support ticket notifications; notification preferences.
- **N4.** Verify/enable `RAZORPAY_WEBHOOK_SECRET` (currently commented out → signature verification disabled).

## 5.8 Compliance & Data Rights (P1)
- **G1.** Privacy policy, Terms of Service, DPA, cookie policy; incident-response doc; fill SECURITY.md contact placeholders.
- **G2.** Consent lifecycle (timestamp/provenance/withdrawal) replacing bare `marketingOptIn`.
- **G3.** Data-subject SAR export + true erasure (expose `hardDelete` path with Bill snapshot pseudonymisation strategy).
- **G4.** At-rest encryption (MongoDB encryption / field-level / KMS) + HTTPS enforcement + HSTS.
- **G5.** `httpOnly` cookie token migration (also S7).
- **G6.** Razorpay vendor/sub-processor assessment + signed DPA; document 3DS/SCA; PCI SAQ-A evidence.

## 5.9 Core Platform / Admin / Restaurant (P1-P2)
- **P1.** Atomic restaurant onboarding (transaction + rollback + `User` owner + default branch/settings creation).
- **P2.** Restore + permanent-delete with cascade policy (devices/employees/settings/licenses) + audit.
- **P3.** Zod validation + field whitelist on all admin mutation routes (remove `$set: body` mass-assignment).
- **P4.** N+1 fixes in `getRestaurants`/`getSubscriptions`; DB-count pagination totals.
- **P5.** Owner identity consistency (create → owners dashboard sync); unified status source (Restaurant `isActive` vs Subscription).
- **P6.** Dead-code removal: `qrOrdering` import-unmounted, unrouted Subscriptions page, placeholder Analytics tab, toast-only UI buttons.
- **P7.** Usage quota + real `currentDevices` (already improved — verify vs plan enforcement).
- **P8.** Branch→Device scoping; default branch bootstrap.

## 5.10 Reports / Analytics / Exports (P2)
- **R1.** Admin Reports hub page (rebuild `/reports`).
- **R2.** Revenue segmentation (subscription/AI/add-on/merchant) + AI revenue/profit layer on `AIUsageLog`.
- **R3.** Platform owner-activity, support-SLA (add `firstResponseAt`), inactive-restaurant (7/30/90d buckets) reports.
- **R4.** JSON export for admin; async pipeline for ALL exports.
- **R5.** Unified report filters/comparison.
- **R6.** Materialized/warehouse layer (nightly summaries) + Redis-shared cache for scale.

## 5.11 AI (P2)
- **AI1.** Move AI inference off the hot path (async/streaming); enforce timeouts; fix cost tracking.
- **AI2.** Validate AI/Weather/Razorpay env vars in prod (fail-fast).
- **AI3.** Fix AI E2E skips + finish AI usage/export UI (already unblocked build).

## 5.12 Frontend / UI / UX (P1-P2)
- **F1.** Fix POS re-render storm (functional updaters, `[]` deps in billing handlers).
- **F2.** Split `App.tsx` (1,829 lines) into routed/lazy workspaces; add code-splitting.
- **F3.** List virtualization (ReceiptHistory, product grid, orders).
- **F4.** Admin-dashboard tests (Vitest + smoke + key pages) — currently 0.
- **F5.** Fix `tour-visual-verify.spec.ts` (stale login selectors); fix/delete 6 skipped AI E2E + 2 no-op diagnostics.
- **F6.** A11y pass (focus traps, ARIA, keyboard nav, admin reduced-motion).
- **F7.** POS design-system consolidation + dark mode; shared `ui/` primitives.
- **F8.** Loading/empty/error shells for POS; offline banner UX.
- **F9.** Customer website: build or explicitly mark "Planned" (docs claim it exists).

## 5.13 Performance / Database (P2)
- **PE1.** Add `allowDiskUse` to 3 HIGH pipelines; `.maxTimeMS` on long reports; query-plan regression tests.
- **PE2.** N+1 elimination (6 confirmed loops).
- **PE3.** Redis failover + runtime downgrade handling; sweep unbounded Maps.
- **PE4.** Cache invalidation for `reports`/`admin-reports`/`festivals` tags.
- **PE5.** CDN + `max-age`/immutable static assets; image srcset/webp.
- **PE6.** Pagination caps everywhere (fix `limit||0`); HTTP/2 + keepalive tuning.

## 5.14 Testing (P1)
- **T1.** Fix coverage config → `src/**` + thresholds; wire to CI.
- **T2.** HTTP-layer integration tests (supertest booting the app) — controllers + routes.
- **T3.** Tests for 29 untested services (start: orderService, authService, inventoryEventService, analytics).
- **T4.** RBAC/permission API tests (admin-only analytics assertions).
- **T5.** Admin-dashboard unit tests (see F4).
- **T6.** Report/export content tests; performance/load tests (basic).
- **T7.** Cross-tenant isolation regression tests (S1/S2).
- **T8.** Restore-drill test (D2) + backup-monitoring alerts test.

## 5.15 Documentation (P2)
- **DOC1.** OpenAPI/Swagger from Zod schemas; regenerate API_REFERENCE (fix 2 fabricated endpoints).
- **DOC2.** Generate DATABASE_SCHEMA + ER diagram (Mermaid `erDiagram`) + index registry.
- **DOC3.** Production runbook + ops troubleshooting doc + DR runbook.
- **DOC4.** README prerequisites (Node ≥22/npm ≥10/Mongo ≥6.0) + `.env.example` ×3 + relative doc links.
- **DOC5.** Accuracy pass: ports (5173→5175, 3001→3002), `dist/server.js`→`.cjs`, `mongod --dbname`→`--dbpath`, E2E counts (5→8 files/30→33 tests), CHANGELOG entries.
- **DOC6.** Resolve license contradiction; add root LICENSE (also C1).
- **DOC7.** Phase-2 ADRs (multi-tenant, subscription engine, audit chain, offline sync, AI metering); complete/annotate PHASE-2.3.

---

# 6. DUPLICATE WORK REMOVED

The following items appeared in multiple audits and are **merged into single tasks**:

| Deduplicated task | Was requested by | Single task id |
|---|---|---|
| Cross-tenant cache-key fix | 2.14 (P0), 2.18, cache deep-dive | **S1** |
| Tenant isolation on 5 resources | 2.2 (tenant readiness), 2.18, auth deep-dive | **S2** |
| Git re-base / .gitignore / remove committed node_modules | 2.16 (P0), 2.17 (license), 2.18, code-quality deep-dive | **C1** |
| CI pipeline + test gates | 2.11 (recs), 2.16 (P0), 2.18 | **C2** |
| Coverage config fix (ai-only → src/** + thresholds) | 2.10, 2.11, 2.16 | **T1** |
| HTTP-layer integration tests | 2.10 (API tests), 2.11 (rec 2), 2.18 | **T2** |
| Admin-dashboard tests | 2.11, 2.17, 2.18, UI deep-dive | **F4/T5** |
| Backups + restore + DR runbook | 2.15 (all), 2.18, compliance | **D1–D4** |
| `/metrics` + Prometheus + Sentry | 2.12, 2.18, observability deep-dive | **M1–M4** |
| Audit bypass call sites | 2.9-IMP notes, 2.18, audit deep-dive | **A1** |
| Report-generation audit logging | 2.10, 2.18 | **A2** |
| Job queue + worker + scheduling | 2.14, 2.18, cache/queue deep-dive | **Q1–Q6** |
| Real notifications / campaign delivery | 2.8, 2.10, 2.18, deep-dives | **N1–N4** |
| Privacy/consent/erasure/legal docs | 2.18, compliance deep-dive | **G1–G3** |
| At-rest encryption + HTTPS + cookie tokens | 2.15, 2.18, compliance | **G4–G5** |
| Validation/whitelist on admin mutation routes | 2.2 (P1/P2), 2.18 | **P3** |
| Onboarding atomicity + owner consistency | 2.2 (P1), 2.18 | **P1/P5** |
| Restore/permanent-delete/cascade | 2.2 (P1), 2.18 | **P2** |
| N+1 + pagination totals | 2.2 (P2/P3), 2.14 | **P4/PE2** |
| TTL/retention on collections | 2.14, 2.18, cache deep-dive | **D5** |
| Rate-limit admin routes + per-tenant | 2.14, 2.18, cache deep-dive | **S11** |
| Backend build type-check + stale @types | 2.16, 2.18, code-quality deep-dive | **C4** |
| POS re-render storm | 2.14 (P1), 2.18, UI deep-dive | **F1** |
| OpenAPI + schema docs + ER diagram | 2.17, 2.18 | **DOC1/DOC2** |
| AI off hot path + cost fix | 2.14, 2.18 | **AI1** |
| MFA | 2.18, compliance, auth deep-dive | **S6** |
| Razorpay webhook secret + vendor assessment | 2.18, compliance, cache deep-dive | **N4/G6** |

---

# 7. DEPENDENCY GRAPH

```
[Foundation: C1 git re-base, C3 pin versions]  ← nothing depends on it, everything benefits
        │
        ▼
[Security: S1-S3 isolation+secrets]  ──▶  [T7 isolation tests]  ──▶  [S9-S12 hardening]
        │                                     │
        ▼                                     ▼
[Durability: D1-D4 backups/DR] ────▶ [D5 TTL] ──▶ [Compliance G1-G6]
        │                                     ▲
        ▼                                     │
[DevOps C2 CI/CD] ──▶ [T1-T4 test gates] ─────┘ (restore-test needs CI)
        │
        ▼
[Observability M1-M6]  ──▶  [Audit A1-A2]
        │
        ▼
[Queues Q1-Q6] ──▶ [Notifications N1-N4]
        │
        ▼
[Core platform P1-P8] ──▶ [Reports R1-R6] ──▶ [Exports (R4)]
        │                      │
        ▼                      ▼
[AI AI1-AI3] ────────────▶ [Frontend F1-F9] ──▶ [Testing T5-T8]
        │
        ▼
[Documentation DOC1-DOC7]
```

**Order rationale (why this order):**
1. **Foundation/Security first** — the P0 isolation leaks and repo disaster are existential; any feature work on an uncommitted, cross-tenant-leaking, un-backable base is wasted.
2. **Durability + CI early** — you cannot safely refactor (Queues, Frontend) without backups and a test pipeline to catch regressions.
3. **Observability before scale features** — you cannot tune queues/caching/reports without metrics.
4. **Infra features (queues/notifications) before product features** that depend on them (recurring expenses, campaigns, exports).
5. **Core platform → Reports → AI → Frontend → Documentation** — each layer's consumers land after its producers.

---

# 8. PRIORITY MATRIX

| Prio | Task IDs | Rationale |
|---|---|---|
| **P0 Critical** | C1, C2, S1, S2, S3, S4, D1, D2, D3, D4, G4, G5, S6 | Data loss / cross-tenant leak / compliance blockers / no rollback — must precede any scaling work |
| **P1 High** | C4, C5, S5, S7, S8, S9, S10, S11, S12, D5, M1, M2, M3, M4, M5, M6, A1, A2, Q1, Q2, Q3, Q4, Q5, Q6, N1, N2, N3, N4, G1, G2, G3, G6, P1, P2, P3, P4, P5, F1, F2, F4, F5, T1, T2, T3, T4 | Material correctness/velocity/security-quality — deploy-blocking for production quality |
| **P2 Medium** | C6, C7, C8, P6, P7, P8, R1, R2, R3, R4, R5, R6, AI1, AI2, AI3, F3, F6, F7, F8, PE1, PE2, PE3, PE4, PE5, PE6, T5, T6, T7, T8, DOC1, DOC2, DOC3, DOC4, DOC5, DOC6, DOC7 | Feature-completeness, scale, polish |
| **P3 Low** | F9 (customer site build), legacy-tree cleanup remainder, naming/version cosmetics, PHASE-2.3 re-run | Nice-to-have / large scope / aspirational |

---

# 9. ENGINEERING WAVES

| Wave | Theme | Tasks | Gate to start |
|---|---|---|---|
| **Wave 1** | Repo & foundation | C1, C3, C4, C5 | None (start immediately) |
| **Wave 2** | Security & isolation | S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12 + T7 | Wave 1 complete |
| **Wave 3** | Durability & backups | D1, D2, D3, D4, D5 | Wave 1 complete |
| **Wave 4** | CI/CD & DevOps | C2, C6, C7, C8 + T1, T2, T3, T4 | Waves 1–3 (restore-test + gates) |
| **Wave 5** | Observability & audit | M1–M6, A1, A2 | Wave 4 (CI to host checks) |
| **Wave 6** | Queues & notifications | Q1–Q6, N1–N4 | Wave 5 (metrics to validate) |
| **Wave 7** | Compliance | G1, G2, G3, G6 | Waves 2–3 (MFA/encryption/backups prerequisite) |
| **Wave 8** | Core platform | P1–P8 | Wave 6 (schedulers available) |
| **Wave 9** | Reports & exports | R1–R6 | Wave 8 |
| **Wave 10** | AI | AI1, AI2, AI3 | Wave 9 |
| **Wave 11** | Frontend & UI | F1–F9 | Waves 8–9 (APIs stable) |
| **Wave 12** | Testing & hardening | T5, T6, T8 + regression sweep | Wave 11 |
| **Wave 13** | Documentation | DOC1–DOC7 | Wave 12 |

---

# 10. DATABASE TASKS

| Task | Description | Requires | Est |
|---|---|---|---|
| DB-1 (D5) | TTL indexes: bills, ledgers, AIUsageLog, WebhookEvent, RefreshToken, OtpRequest, exports | — | M |
| DB-2 (D1/D3) | Replica-set topology + mongodump/restore scripts + off-site store | — | M |
| DB-3 (D2) | Restore validation harness + RPO/RTO definition | DB-2 | S |
| DB-4 (P2) | Cascade delete policy + permanent-delete implementation per entity | — | M |
| DB-5 (PE1) | `allowDiskUse` on 3 HIGH pipelines + `.maxTimeMS` + index audit | — | S |
| DB-6 (PE6) | Pagination caps; fix `limit\|\|0` | — | S |
| DB-7 (DOC2) | Schema generator → DATABASE_SCHEMA.md + Mermaid ER diagram + index registry | — | M |
| DB-8 (G4) | At-rest encryption (MongoDB field-level / KMS) design + rollout | — | L |
| DB-9 (R6) | Materialized nightly summary store / warehouse layer | Q5 | XL |

---

# 11. BACKEND TASKS

| Task | Description | Requires | Est |
|---|---|---|---|
| BE-1 (S2) | Tenant-bind 5 unbound services + controller checks | — | M |
| BE-2 (S3) | Seed refactor (env-based, empty-DB only) | — | S |
| BE-3 (S9) | Fail-closed subscription middleware | — | S |
| BE-4 (S11) | Admin route rate limiter + per-tenant accounting | — | M |
| BE-5 (S5) | Admin auth secret/refresh/min-length | — | S |
| BE-6 (A1) | Route 20 audit bypasses thr ough auditService | — | M |
| BE-7 (Q1-Q6) | BullMQ queue + worker process + scheduled recurring/expiry/campaigns | Wave 5 | XL |
| BE-8 (N1-N4) | Notification provider abstraction + delivery + webhook secret | Q | L |
| BE-9 (P1-P3) | Atomic onboarding + validation whitelist + restore/delete | — | L |
| BE-10 (R1-R6) | Admin reports hub, segmentation, SLA/activity reports, JSON export, async all | Wave 8 | XL |
| BE-11 (AI1-AI3) | Async AI + timeouts + cost fix + env fail-fast | Wave 9 | M |
| BE-12 (M1/M3) | Prometheus middleware + pino logger + request-id | — | M |
| BE-13 (M6) | Slow-query logging + slowEndpoints real aggregate | M12 | M |

---

# 12. FRONTEND TASKS

| Task | Description | Requires | Est |
|---|---|---|---|
| FE-1 (F1) | Fix billing handlers (functional updaters, stable deps) | — | S |
| FE-2 (F2) | Split App.tsx into lazy routed workspaces | — | L |
| FE-3 (F3) | Virtualize ReceiptHistory/product grid/orders | — | M |
| FE-4 (F4/T5) | Admin-dashboard Vitest setup + page smoke + key-page tests | Wave 4 | M |
| FE-5 (F5) | Fix tour E2E selectors; repair/remove skipped + no-op specs | — | S |
| FE-6 (F6) | A11y pass (focus traps, ARIA, reduced-motion, admin keyboard) | — | M |
| FE-7 (F7) | POS design tokens + dark mode + shared UI kit | — | M |
| FE-8 (F8) | POS loading/empty/error shells + offline banner | — | S |
| FE-9 (F9) | Customer website (or mark Planned) | Wave 11 | XL |
| FE-10 (R1) | Admin Reports hub UI + unified filters | R backend | M |

---

# 13. SECURITY TASKS

| Task | Description | Requires | Est |
|---|---|---|---|
| SEC-1 (S6) | TOTP MFA enrollment/verify for super_admin + owner | — | M |
| SEC-2 (S7/G5) | httpOnly cookie token migration (both dashboards) | — | M |
| SEC-3 (S8) | OTP HMAC + env-gated simulatedCode | — | S |
| SEC-4 (S10) | Remove plaintext PIN from reset responses | — | S |
| SEC-5 (S4) | Hard-fail secret validation in all envs | — | S |
| SEC-6 (S12/G4) | Field-level masking on financial payloads; at-rest encryption | — | L |
| SEC-7 (C8) | `.env.example` + secrets manager + fail-fast env validation | — | M |
| SEC-8 (C5) | Lint + strict TS + `npm audit` gate in CI | Wave 4 | M |
| SEC-9 (G6) | Razorpay vendor assessment + DPA + 3DS/SCA doc + SAQ-A | — | S |
| SEC-10 (S11) | Admin throttling + per-tenant limits | — | M |

---

# 14. PERFORMANCE TASKS

| Task | Description | Requires | Est |
|---|---|---|---|
| PERF-1 (PE1) | allowDiskUse + maxTimeMS + explain regressions | — | S |
| PERF-2 (PE2) | Eliminate 6 N+1 loops | — | M |
| PERF-3 (PE3) | Redis failover + Map sweeps | — | S |
| PERF-4 (PE4) | Cache invalidation for reports/admin-reports/festivals | — | S |
| PERF-5 (PE5) | CDN + immutable assets + webp/srcset | — | M |
| PERF-6 (PE6) | HTTP/2 + keepalive; pagination caps | — | M |
| PERF-7 (Q5) | Async exports/snapshots off main thread | Q | M |

---

# 15. AUDIT TASKS

| Task | Description | Requires | Est |
|---|---|---|---|
| AUD-1 (A1) | Migrate 20 bypass call sites to auditService | — | M |
| AUD-2 (A2) | Emit `report.exported`/`analytics.exported` + audit generation | R | S |
| AUD-3 (A1) | Dedupe dual-write paths; make all rows canonical | AUD-1 | S |
| AUD-4 (D2) | Backup the audit chain + archive off-site (with chain) | D1 | S |

---

# 16. REPORTING TASKS

| Task | Description | Requires | Est |
|---|---|---|---|
| REP-1 (R1) | Admin Reports hub (replace restaurant deep-link console) | — | M |
| REP-2 (R2) | Revenue segmentation + AI revenue/profit | — | L |
| REP-3 (R3) | Owner-activity, support-SLA, inactive-restaurant reports | — | M |
| REP-4 (R5) | Unified report filters/comparison | — | M |
| REP-5 (R4) | JSON export + async all exports | Q | M |
| REP-6 (R6) | Warehouse/nightly materialization | Q | XL |

---

# 17. EXPORT TASKS

| Task | Description | Requires | Est |
|---|---|---|---|
| EXP-1 (R4) | Async job pipeline for POS reports (main-thread today) | Q | M |
| EXP-2 (R4) | Admin JSON export + signed artifacts (extends audit pattern) | — | S |
| EXP-3 (A2) | Export audit logging on all generation | AUD | S |
| EXP-4 (D2) | Exports artifact cleanup + retention | — | S |

---

# 18. AI TASKS

| Task | Description | Requires | Est |
|---|---|---|---|
| AI-1 | Streaming/async inference; request timeouts | — | M |
| AI-2 | Fix usage/cost tracking accuracy | — | M |
| AI-3 | Env fail-fast for AI/Weather/Razorpay keys | — | S |
| AI-4 | Repair 6 skipped Inventory-AI E2E + AI export UI | — | M |
| AI-5 | AI revenue/margin layer (with REP-2) | REP | M |

---

# 19. TESTING TASKS

| Task | Description | Requires | Est |
|---|---|---|---|
| TST-1 (T1) | Coverage config → src/**, thresholds | — | S |
| TST-2 (T2) | HTTP integration (supertest) suite | Wave 2 | L |
| TST-3 (T3) | 29 untested services (priority: order, auth, inventoryEvent, analytics) | — | L |
| TST-4 (T4) | RBAC/permission API tests | Wave 2 | M |
| TST-5 (T7) | Cross-tenant isolation regression tests | S1/S2 | S |
| TST-6 (T5) | Admin-dashboard tests | — | M |
| TST-7 (T6) | Report/export content + load/smoke perf | — | M |
| TST-8 (T8) | Backup restore-drill + alerting tests | D | S |
| TST-9 | CI wiring for all suites (C2) | C2 | M |

---

# 20. DOCUMENTATION TASKS

| Task | Description | Requires | Est |
|---|---|---|---|
| DOC-1 | OpenAPI/Swagger generation + fix 2 fabricated endpoints | — | M |
| DOC-2 | DATABASE_SCHEMA + ER diagram + index registry | — | M |
| DOC-3 | Production runbook + ops troubleshooting + DR runbook | D | M |
| DOC-4 | README prerequisites + .env.example ×3 + relative links | — | S |
| DOC-5 | Accuracy pass (ports/commands/counts/CHANGELOG) | — | S |
| DOC-6 | License resolution + root LICENSE | C1 | S |
| DOC-7 | Phase-2 ADRs + complete PHASE-2.3 | — | M |

---

# 21. RISK ANALYSIS (per major task)

| Task | Breaking-change | Migration | DB migration | Frontend impact | Backend impact | Security impact | Perf impact | Rollback difficulty |
|---|---|---|---|---|---|---|---|---|
| C1 git re-base | No (git-only) | Yes (git history) | No | No | No | Low (removes secrets from tree) | None | **Medium** (irreversible without backup of index) |
| S1 cache-key | No (TTL ≤5min) | No | No | No | Yes (ResponseCache) | **High (closes leak)** | Neutral | Low |
| S2 tenant-bind | **Yes** (scoped responses) | No | No | Minor (list results change) | Yes (5 services) | **High** | Neutral (indexed filters) | **Medium** |
| S3 seed refactor | No (empty-DB only) | No | No | No | Yes (db.ts) | **High** | None | Low |
| D1-D4 backups | No | No | No | No | Yes (scripts/infra) | High (encryption) | Low | Low |
| C2 CI/CD | No | No | No | No | Yes | Medium | None | Low |
| Q1 BullMQ | **Yes** (job semantics) | No | Maybe (queue docs) | No | High | Medium | **High (offloads)** | **Medium** |
| N1-N4 notifications | No (additive) | No | No | Optional | Yes | Medium (webhook secret) | Low | Low |
| G1-G6 compliance | No | No | Yes (consent/erasure fields) | Yes (consent UI) | Yes | **High** | Low | Medium |
| P1 atomic onboarding | **Yes** (new owner User) | No | No | Yes (owners list) | High | Medium | Low | **Medium** |
| P2 permanent-delete | **Yes** (destructive) | No | No | Yes (UI) | High | Medium | Low | **High** |
| M1-M6 observability | No | No | No | No | Yes (middleware) | Low | Low | Low |
| F1 re-render fix | No | No | No | Yes (POS) | No | None | **High (positive)** | Low |
| FE-2 App split | **Yes** (routing) | No | No | High | No | None | High (positive) | Medium |
| DOC1 OpenAPI | No | No | No | No | No | Low | None | Low |

---

# 22. ESTIMATED ENGINEERING TIMELINE

> Team of 2 senior engineers, assuming phase-gated approvals. S=0.5-1d, M=2-4d, L=1-2w, XL=3-5w.

| Wave | Duration | Cumulative |
|---|---|---|
| 1 Repo & foundation | 1w | 1w |
| 2 Security & isolation | 2w | 3w |
| 3 Durability & backups | 1w | 4w |
| 4 CI/CD & DevOps | 2w | 6w |
| 5 Observability & audit | 2w | 8w |
| 6 Queues & notifications | 2w | 10w |
| 7 Compliance | 2w | 12w |
| 8 Core platform | 3w | 15w |
| 9 Reports & exports | 3w | 18w |
| 10 AI | 2w | 20w |
| 11 Frontend & UI | 4w | 24w |
| 12 Testing & hardening | 3w | 27w |
| 13 Documentation | 2w | **29w (~7 months)** |

**Realistic calendar: 6–12 months including review, buffer, and re-audit gates.**

---

# 23. MASTER IMPLEMENTATION CHECKLIST

## ☐ Foundation
- ☐ C1 git re-base (`.gitignore`, un-track node_modules, commit source, remove dead trees, root LICENSE)
- ☐ C3 version pinning (`engines`, `.nvmrc`, rename `react-example@0.0.0`)
- ☐ C4 backend build type-check + drop stale `@types`
- ☐ C5 lint + strict TS everywhere

## ☐ Database
- ☐ Models: consent fields, refunds/Addon, SLA fields, AI-revenue fields
- ☐ Indexes: TTL (bills/ledgers/AIUsage/webhook/refresh/otp), report axes, missing sort indexes
- ☐ Migrations: seed refactor, replica-set setup, mongodump/restore scripts
- ☐ ER/schema doc regeneration (DB-7)

## ☐ Security & Isolation
- ☐ S1 cache-key tenant scope
- ☐ S2 tenant-bind 5 resources
- ☐ S3 env-seed super-admin
- ☐ S4 hard-fail secrets
- ☐ S5 admin auth hardening
- ☐ S6 MFA (TOTP)
- ☐ S7 httpOnly cookies
- ☐ S8 OTP HMAC + simulatedCode gate
- ☐ S9 fail-closed subscription
- ☐ S10 no plaintext PIN
- ☐ S11 admin rate limits
- ☐ S12 financial masking

## ☐ Durability
- ☐ D1 backups + off-site + encryption + retention
- ☐ D2 restore path + drill
- ☐ D3 replication + failover + media backup
- ☐ D4 DR runbook
- ☐ D5 TTL/retention

## ☐ DevOps / CI-CD
- ☐ C2 GitHub Actions (backend/POS/admin suites, gates)
- ☐ C6 release automation + tags + auto-update + pm2/systemd
- ☐ C7 Docker + compose + TLS proxy
- ☐ C8 secrets manager + `.env.example`

## ☐ Observability & Audit
- ☐ M1 Prometheus `/metrics`
- ☐ M2 Sentry
- ☐ M3 pino + request-ID
- ☐ M4 alerting
- ☐ M5 deep health
- ☐ M6 slow-query + slowEndpoints
- ☐ A1 route 20 bypasses
- ☐ A2 report/export audit events

## ☐ Queues, Workers & Notifications
- ☐ Q1 BullMQ + worker
- ☐ Q2 recurring expenses scheduler
- ☐ Q3 loyalty expiry scheduler
- ☐ Q4 campaign scheduler
- ☐ Q5 async exports/snapshots
- ☐ Q6 overlap/replay guards
- ☐ N1 outbound delivery
- ☐ N2 ORDER_READY push
- ☐ N3 notification preferences
- ☐ N4 Razorpay webhook secret

## ☐ Compliance
- ☐ G1 legal/trust docs
- ☐ G2 consent lifecycle
- ☐ G3 SAR + erasure
- ☐ G4 at-rest encryption + HTTPS/HSTS
- ☐ G5 cookie tokens (S7)
- ☐ G6 Razorpay assessment + 3DS + SAQ-A

## ☐ Core Platform
- ☐ P1 atomic onboarding
- ☐ P2 restore/permanent-delete/cascade
- ☐ P3 admin mutation validation
- ☐ P4 N+1 + totals
- ☐ P5 owner consistency + status source
- ☐ P6 dead-code removal
- ☐ P7 quotas + device count
- ☐ P8 branch/device scoping

## ☐ Reports & Exports
- ☐ R1 admin reports hub
- ☐ R2 revenue segmentation + AI revenue
- ☐ R3 SLA/activity/inactive reports
- ☐ R4 JSON export + async pipeline
- ☐ R5 unified filters
- ☐ R6 warehouse

## ☐ AI
- ☐ AI1 async/streaming + timeouts
- ☐ AI2 cost accuracy
- ☐ AI3 env fail-fast
- ☐ AI4 E2E + export UI
- ☐ AI5 revenue layer

## ☐ Frontend & UI
- ☐ F1 re-render storm fix
- ☐ F2 App.tsx split
- ☐ F3 virtualization
- ☐ F4 admin tests
- ☐ F5 E2E repair
- ☐ F6 a11y
- ☐ F7 design tokens + dark mode
- ☐ F8 loading/error/empty shells
- ☐ F9 customer site (or Planned)

## ☐ Testing
- ☐ T1 coverage config + thresholds
- ☐ T2 HTTP integration suite
- ☐ T3 29 untested services
- ☐ T4 RBAC API tests
- ☐ T5 admin tests
- ☐ T6 report/export/perf tests
- ☐ T7 isolation regression tests
- ☐ T8 restore-drill tests
- ☐ T9 CI wiring

## ☐ Documentation
- ☐ DOC1 OpenAPI + API_REFERENCE fix
- ☐ DOC2 schema + ER
- ☐ DOC3 runbooks
- ☐ DOC4 README + `.env.example`
- ☐ DOC5 accuracy pass
- ☐ DOC6 license
- ☐ DOC7 ADRs + 2.3 closure

---

# 24. FINAL SUCCESS CRITERIA ("done" definition)

Each task is DONE only when **all** apply:
- ✅ **Implemented** — code/behavior exists in the working tree, not mocked/stubbed.
- ✅ **Backend complete** — API, service, repository, model, validation, middleware all wired.
- ✅ **RBAC complete** — every new route behind `requireAuth` + `requireCollectionAccess` (or documented public).
- ✅ **Validation complete** — Zod schemas on all mutation routes; no `$set: body` mass-assignment.
- ✅ **Audit complete** — writes through `auditService` (hash-chained), read-masked, canonical actions.
- ✅ **Tests passing** — unit + integration (and E2E where applicable) green in CI; coverage meets thresholds.
- ✅ **Documentation complete** — OpenAPI/db-doc/runbook updated in the same PR.
- ✅ **No regression** — full suite (505+ backend, 51 unit, 83 E2E) green.

**Phase-Gate (GO) criteria for production:**
- Security ≥70; Testing ≥70; Monitoring ≥70; DevOps ≥70; Compliance ≥60 or scope-controlled; Backups restored successfully in a drill within RPO/RTO; zero open P0s; 30-day live-shadow run with zero P0/P1.

---

# 25. OVERALL READINESS SCORE

| Readiness | Current | Target (GO) |
|---|---|---|
| Overall project completion | **≈34%** | ≥85% |
| Production readiness | **25/100** | ≥70 |
| Security readiness | **35/100** | ≥70 |
| Scalability readiness | **20/100** | ≥60 |
| Enterprise readiness | **NOT READY** | READY |
| Compliance readiness | **15/100** | ≥60 (or scoped) |
| Testing readiness | **35/100** | ≥70 |
| Deployment readiness | **24/100** | ≥70 |

---

## VERDICT
**NO-GO for production today.** The platform is a strong prototype with enterprise-grade foundations in the right places (auth, audit, RBAC, offline POS, admin UI). The gap is **production discipline, not engineering skill**. Following this roadmap in the 13 waves — starting with the Wave 1 repo re-base and Wave 2 isolation/security fixes — converts the platform into a deployable, compliant, observable SaaS within an estimated **6–12 months**. Every P0 (source-control, tenant isolation, backups, secrets) must land before any further feature velocity.

*End of MASTER-IMPLEMENTATION-ROADMAP.md — planning only; no source files were modified.*

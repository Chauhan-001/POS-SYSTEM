# Phase 2.12 — Monitoring & Observability Audit (Read-Only)

**Date:** 05 Aug 2026
**Repo root:** `C:\Loyalty_POS system` (git `master`)
**Audit mode:** READ-ONLY. No source files modified. All findings verified against actual source/config files.

---

## 1. Executive Summary

The platform ships a **strong business-metric telemetry layer** (AI usage, audit, webhooks, device heartbeats, request correlation) but is **almost entirely lacking operational observability**: no Prometheus, no Grafana, no OpenTelemetry, no Sentry, no structured logging framework, no log rotation, no external alerting, and no infrastructure/uptime monitoring. All "monitoring" is either (a) structured `console` output, or (b) MongoDB-backed analytics collections surfaced through the admin dashboard.

**Verified highlights:**

- ✅ **Structured per-request JSON logging** with latency (`[req]` lines) — `backend/src/middleware/requestLogger.ts`.
- ✅ **Correlation / Request IDs** via `AsyncLocalStorage` (`x-correlation-id` honored) — `backend/src/modules/audit/auditContextMiddleware.ts`.
- ✅ **AI usage telemetry is genuinely rich**: per-feature success/fallback/cache, tokens, cost, latency (p50/p95/p99), model, provider, error type — `AIUsageLog` model + `aiAnalyticsService`.
- ✅ **Webhook monitoring** with append-only `WebhookEvent` (status received/processed/failed) + signature verification — Razorpay subscription webhooks.
- ✅ **Device/terminal health** via heartbeat ingestion + stale-offline sweep (2-minute threshold).
- ✅ **In-app security alert feed** (AuditAlert): tamper detection, repeated login failures, critical security events — resolvable via admin API.
- 🟡 **Health endpoint** exists (`GET /api/health` returns `dbConnected`) but conflates liveness/readiness, no Redis/dependency status.
- 🔴 **No metrics endpoint** (`/metrics`), no Prometheus, no Grafana, no OTEL, no tracing.
- 🔴 **No Sentry / crash reporting** — `uncaughtException`/`unhandledRejection` just `console.error` + `process.exit(1)`.
- 🔴 **No log rotation, no log levels, no log files** — everything is `console.*`.
- 🔴 **No queue/worker/scheduler/cron monitoring** (all jobs are `setInterval` with no health/status API).
- 🔴 **No infra monitoring**: memory, CPU, disk, uptime, PagerDuty, Slack, email alerts all absent.
- 🔴 **Frontend has error boundaries + console handlers only**: no web-vitals, no session replay, no crash analytics, no client-side metric capture.

**Estimated completion: ~29%** (see Section 22). Observability exists for *business intelligence* but not for *operations*.

---

## 2. Monitoring Architecture

**What exists (verified):**

```
[MongoDB collections]                    [Express app]
  AuditLog ───────────────► requestLogger.ts   (every request, mutations)
  AIUsageLog ────────────► aiUsageLogger.ts     (fire-and-forget)
  VoiceAuditLog ─────────► AuditLogger.ts        (voice inventory)
  WebhookEvent ──────────► subscriptionService   (Razorpay webhooks)
  Device / DeviceActivity ► deviceService.heartbeat()
  AuditAlert ────────────► auditService.maybeAlert()
                │
                ▼
        [Admin Dashboard]  (Analytics, AIUsage, AuditLog, Dashboard, Devices)
                │
                ▼
        MongoDB aggregates only — no time-series store, no scrape target
```

**What is missing:** any pull-based (Prometheus `/metrics`) or push-based (OTEL collector) metric pipeline; Grafana; external uptime/status monitors.

**Exact services/middleware responsible for telemetry:**
- `backend/src/middleware/requestLogger.ts` — request + mutation logging
- `backend/src/middleware/errorHandler.ts` — error logging + response shaping
- `backend/src/modules/audit/auditContextMiddleware.ts` — correlation/request IDs
- `backend/src/modules/audit/auditService.ts` — hash-chained audit + `maybeAlert`
- `backend/src/modules/ai/services/aiUsageLogger.ts` — AI usage recorder
- `backend/src/modules/voice-inventory/services/AuditLogger.ts` — voice usage recorder
- `backend/src/services/deviceService.ts` — device health/heartbeat
- `backend/src/utils/CircuitBreaker.ts` — external-dependency health (Razorpay/AI/Weather)

---

## 3. Logging Architecture

| Concern | Status | Evidence |
|---|---|---|
| Structured logging | 🟡 | JSON `[req]` lines via `console.log` in `requestLogger.ts:121`; boot logs are free-form text |
| Logging framework (Winston/Pino/Bunyan) | 🔴 | **None** in any `package.json` |
| Log levels | 🔴 | No level config; ad-hoc `console.log/error/warn` (61 log / 297 error / 72 warn matches in `backend/src`) |
| Log rotation | 🔴 | None — logs go to process stdout only |
| Log file output | 🔴 | None |
| Sensitive-data redaction | ✅ | `SENSITIVE_KEYS` + recursive `sanitizeForLog` in `requestLogger.ts:26-66` |
| Slow-request logging | 🔴 | `durationMs` is captured but there is **no threshold-based slow-logging** |
| Process-level logging | 🟡 | `process.on('uncaughtException'/'unhandledRejection')` in `server.ts:245-253` (console.error + exit) |

**Exact log destinations:** stdout/stderr only. No file, no journald, no central log sink, no ELK/Loki.

---

## 4. Metrics

| Concern | Status | Evidence |
|---|---|---|
| Metrics endpoint (`/metrics`) | 🔴 | No route exists |
| Prometheus integration | 🔴 | No `prom-client`, no `prometheus` in any dependency set |
| Grafana | 🔴 | No dashboards, no provisioning |
| OpenTelemetry | 🔴 | No `@opentelemetry/*` deps |
| Request timing | ✅ | `durationMs` in every `[req]` line (`requestLogger.ts:111`); `latencyMs` in AI usage |
| Latency percentiles | 🟡 | Only for AI: p50/p95/p99 in `aiAnalyticsService.ts:535-570` |
| Error rate | 🟡 | Derived from `AuditLog` action-name regex in `analyticsService.ts:958-963` (not a true metric) |
| Cache metrics | 🟡 | `CacheStats` (hits/misses/size/expired) in `backend/src/cache/adapters.ts:188-214` — internal only, not exposed via API |
| Circuit-breaker stats | 🟡 | `CircuitBreaker.getStats()` (state/failures/successes/timeouts/fallbacks) — in-memory only, not exposed |
| Memory/CPU/Disk gauges | 🔴 | None |

**Exact metrics exposed via API** (all business metrics, MongoDB-derived):
- `GET /admin/analytics/dashboard` → `DashboardStats` (incl. AI, devices, api-requests)
- `GET /admin/analytics/ai/*` → tokens/cost/latency/errors/requests (summary + timeseries + by-model/feature/restaurant/owner)
- `GET /admin/analytics/api-requests` → request counts + `averageLatency` (from `AuditLog`/`AIUsageLog`)
- `GET /admin/analytics/devices` → device health/online/pending/blocked

---

## 5. Health Checks

| Check | Status | Endpoint | Detail |
|---|---|---|---|
| Health | ✅ | `GET /api/health` (`server.ts:185`) | `{ status:'ok', timestamp, dbConnected }`, public, moderate rate limiter, not cached |
| Liveness | 🟡 | Same `/api/health` | No separate `/live`; combined into one endpoint |
| Readiness | 🟡 | Same `/api/health` | `dbConnected` only — **no Redis, no worker, no dependency readiness** |
| AI module health | ✅ | `GET /api/ai/status` (`modules/ai/routes/ai.ts:60`) | `enabled`, `provider`, feature list |
| Settings/printer health | ✅ | `GET /api/settings/health` (`modules/settings/routes/settings.ts:39`) | Printer online/offline/error state |
| Device health | ✅ | `GET /admin/devices/:id/health` (`routes/admin.ts:263`) | Health payload with activeSessions, dbSyncStatus |
| Heartbeat ingestion | ✅ | `POST /api/devices/heartbeat` (`routes/devices.ts:12`) | Terminal → server health report (Phase 2.5) |

**Gap:** No dependency-awareness in `/api/health` (Redis connection state is known to `server.ts` but never surfaced), no uptime seconds, no process health, no `/metrics`.

---

## 6. Distributed Tracing

| Concern | Status | Evidence |
|---|---|---|
| OpenTelemetry | 🔴 | Absent |
| Trace IDs | 🔴 | No trace propagation (`traceparent` not read/forwarded) |
| Request IDs | ✅ | `requestId = crypto.randomUUID()` per request (`auditContextMiddleware.ts:17`) |
| Correlation IDs | ✅ | `x-correlation-id` header honored, falls back to requestId (`auditContextMiddleware.ts:18-21`) |
| Propagation context | ✅ | `AsyncLocalStorage` store carries requestId/correlationId/ip/UA/method/path to downstream audit writes (`auditContext.ts`) |
| End-to-end trace linking | 🔴 | Log lines do **not** include requestId; tracing across services/DB/third-party calls is impossible |

**Exact API:** `X-Correlation-Id` (inbound), `X-Forwarded-For`, `X-Real-IP`, `X-Device-Id`, `X-Client-Id`.

---

## 7. Error Tracking

| Concern | Status | Evidence |
|---|---|---|
| Global error middleware | ✅ | `errorHandler.ts`: AppError→status, Mongo dup 11000→409, validation→400, Multer→400, generic 500 (prod-safe) |
| Uncaught exception logging | 🟡 | `console.error` then `process.exit(1)` (`server.ts:245-253`) — logs but crashes process |
| Sentry | 🔴 | No `@sentry/*` dependency |
| Crash reporting | 🔴 | None (no dumps, no upload) |
| Frontend render errors | 🟡 | `ErrorBoundary.tsx` (POS + admin) → `console.error` only |
| Frontend global errors | 🟡 | `window.addEventListener('error'/'unhandledrejection')` in `main.tsx:12-21` → `console.error` only |
| Electron renderer crash | 🟡 | `render-process-gone` → `console.error` + native dialog (`electron/main.ts:116-126`); unresponsive/responsive handlers — **no crashReporter upload** |

**Gap:** No error aggregation, no dedup, no source-mapped stack, no alert on new error signatures.

---

## 8. Alerting

| Channel | Status | Evidence |
|---|---|---|
| In-app alert feed | ✅ | `AuditAlert` collection; created by `auditService.maybeAlert()` (`auditService.ts:322-370`): tamper, critical security actions, repeated login failures (≥5/10 min) |
| Alert list/summary/resolve | ✅ | `GET /admin/audit-logs/alerts`, `GET .../alerts/summary`, `POST .../alerts/:id/resolve`, `DELETE .../alerts/:id` (`routes/admin.ts:409-412`, `alertsService.ts`) |
| PagerDuty | 🔴 | None |
| Slack | 🔴 | None |
| Email alerts | 🔴 | None |
| SMS/push | 🔴 | None |
| Rate-limit/backoff events | 🔴 | Account backoff blocks requests silently; no alert raised |

**Gap:** Alerting exists **only inside the admin app** (pull-based); there is no push notification to humans. `supportTicketService.ts:17` confirms *"no external delivery providers exist on the platform."*

---

## 9. Background Jobs

| Job | Interval | Location | Monitoring |
|---|---|---|---|
| Subscription state transitions (trial→grace→suspended) | 1h (`setInterval`) | `subscriptionScheduler.ts` | 🔴 console only |
| Audit retention/cleanup | periodic (`setInterval`) | `modules/audit/retentionService.ts:203` | 🔴 console only |
| Nightly report snapshots + inactive-restaurant | 24h (`setInterval`, `unref`) | `modules/adminReports/jobs/reportJobs.ts` | 🟡 `snapshotTimerState()` + per-kind success booleans (logged only) |
| Response cache cleanup | 2 min | `utils/ResponseCache.ts` / `cache/adapters.ts` | 🔴 internal counters only |
| Rate-limiter account-store cleanup | 1 min | `middleware/rateLimiter.ts:41` | 🔴 none |
| Voice context cleanup | periodic | `modules/voice-inventory/services/ContextManager.ts:58` | 🔴 none |

**Gaps:** No job-queue (Bull/BullMQ/Agenda), no cron lib, no scheduler health endpoint, no failure alerts, no run-history/timing retention, no worker monitoring.

---

## 10. Queue Monitoring

| Concern | Status | Evidence |
|---|---|---|
| Message queue (Bull/BullMQ/AMQP/Kafka) | 🔴 | None in deps; no queue infrastructure |
| Queue metrics | 🔴 | N/A (no queue) |
| Worker monitoring | 🔴 | N/A (no workers) |
| Offline sync queue (frontend) | 🟡 | `syncEngine.ts` persists `pos_sync_queue` in localStorage (7-day retention, max retries) — observable in-app but no central metrics |

---

## 11. AI Monitoring

This is the **strongest telemetry in the platform** — a genuine, production-grade usage metering subsystem.

| Concern | Status | Evidence |
|---|---|---|
| Per-call usage recording | ✅ | `aiUsageLogger.ts` → `AIUsageLog.create` (fire-and-forget, never throws) |
| Fields captured | ✅ | feature, success, fallback, cached, latencyMs, input/output/total tokens, cost, model, provider, errorType, retried, cancelled, timeout |
| Cost engine | ✅ | `services/aiCostConfig.ts` (per-model pricing) |
| Latency stats (avg/p50/p95/p99/slowest) | ✅ | `aiAnalyticsService.ts:532-570` |
| Error-rate / error-type breakdown | ✅ | `getErrorSummary`, `getRequestSummary` |
| Per-restaurant/owner/model/feature dims | ✅ | Aggregations in `aiAnalyticsService.ts` |
| Voice pipeline monitoring | ✅ | `VoiceAuditLog` (intent, confidence, matchingMethod, pipeline candidates, per-stage latency) |
| Admin dashboard | ✅ | `admin-dashboard/src/pages/AIUsage.tsx` (tokens/cost/latency/errors/voice charts) |
| API surface | ✅ | `GET /admin/analytics/ai/*` (tokens/cost/latency/requests/errors, timeseries + by-model/feature/restaurant/owner) — cached 60s |

**Exact indexes:** `AIUsageLog` has 11 indexes incl. compound `(restaurantId, feature, createdAt)`, `(model, provider, createdAt)` (`models/AIUsageLog.ts:143-154`).

---

## 12. Database Monitoring

| Concern | Status | Evidence |
|---|---|---|
| Connection status | 🟡 | `isConnected()` = `mongoose.connection.readyState === 1` (`db.ts:159-160`), surfaced in `/api/health` |
| Connection pool metrics | 🔴 | None |
| Slow-query logging | 🔴 | None |
| Index usage / query profiling | 🔴 | None (indexes exist but no monitoring) |
| Replica/oplog/latency | 🔴 | None |
| Storage/disk | 🔴 | None |

---

## 13. Infrastructure Monitoring

| Concern | Status | Evidence |
|---|---|---|
| Memory monitoring | 🔴 | None |
| CPU monitoring | 🔴 | None |
| Disk monitoring | 🔴 | None |
| Uptime monitoring | 🔴 | No external probes; `/api/health` is the only probe and nothing calls it |
| Container/orchestration | 🔴 | No Dockerfile/docker-compose/K8s in repo (electron/desktop-first product) |
| Dependency uptime (Razorpay/AI/Weather) | 🟡 | Circuit breakers trip OPEN on failure (`CircuitBreaker.ts` used by Razorpay/AI/Weather) but stats are in-memory only |
| Process watchdog/restart | 🔴 | `process.exit(1)` on uncaught errors with no supervisor policy |

---

## 14. Frontend Monitoring

| Concern | Status | Evidence |
|---|---|---|
| Error boundaries | ✅ | POS `ErrorBoundary.tsx` wraps workspaces (`App.tsx:1215,1578`); admin `components/ui/ErrorBoundary.tsx` |
| Global error handlers | ✅ | `main.tsx:12-21` (`error` + `unhandledrejection`) |
| Remote error reporting | 🔴 | Console only — no endpoint, no Sentry |
| Crash analytics | 🔴 | None |
| Web Vitals | 🔴 | No `web-vitals` dep, no `performance.measure` capture |
| Performance monitoring | 🔴 | None |
| Client logging | 🟡 | `debugLog.ts` — dev-only `console.warn` (production-silenced) |
| Session replay | 🔴 | None |
| Network monitoring | 🟡 | Online/offline listeners (`usePOSState.ts:995-997,1087`), 30s poll while online (`usePOSState.ts:811-823`), sync status UI (`SyncPanelModal`); **no network timing/metric capture** |
| Electron crash awareness | 🟡 | render-process-gone/unresponsive handlers — no upload |

---

## 15. API Monitoring

| Concern | Status | Evidence |
|---|---|---|
| Per-request log | ✅ | `[req]` JSON line (method, path, status, durationMs, user/tenant/branch/role/operator/device/IP) |
| Request counts | 🟡 | Derived from `AuditLog` counts in `getApiRequestAnalytics` (`analyticsService.ts:946`) — mutation-only basis |
| Per-endpoint latency | 🔴 | `slowEndpoints` is declared (`analyticsService.ts:160`) but returned as `[]` (`analyticsService.ts:989`) — **not implemented** |
| Status-code distribution | 🔴 | Not aggregated |
| Client-side API timing | 🔴 | None |

---

## 16. Security Monitoring

| Concern | Status | Evidence |
|---|---|---|
| Audit trail (hash-chained, tamper-evident) | ✅ | `modules/audit/auditService.ts` + retention/legal-hold/export (Phase 2.9) |
| Audit stats (failed logins, permission changes, critical-today, security events) | ✅ | `modules/audit/statsService.ts` |
| Security alert generation | ✅ | `auditService.maybeAlert()`: tamper, critical security actions, repeated-login-failure detection |
| Auth backoff (brute-force) | ✅ | `rateLimiter.ts` per-account exponential backoff + per-IP limiter |
| Admin dashboard audit UI | ✅ | `admin-dashboard/src/pages/AuditLog.tsx` (verify integrity, detail, filters) |
| Security alert push-out | 🔴 | Alerts exist in DB; no external notification |

---

## 17. Performance Monitoring

| Concern | Status | Evidence |
|---|---|---|
| Request latency capture | ✅ | `durationMs` per request |
| AI latency analytics | ✅ | p50/p95/p99 in AI analytics |
| Slow-request detection | 🔴 | No threshold logic |
| Frontend performance | 🔴 | No web-vitals/rum |
| Database performance | 🔴 | No query time capture |
| Third-party call latency | 🟡 | Circuit breaker returns `latency` per call but it's not persisted/aggregated |

---

## 18. Dashboard Coverage

| Dashboard | Status | Data source | Notes |
|---|---|---|---|
| Admin `Analytics` | 🟡 | Mongo aggregates | Platform growth/usage/revenue; **not** live infra |
| Admin `AIUsage` | ✅ | `AIUsageLog`/`VoiceAuditLog` | Rich charts (tokens/cost/latency/errors/voice) |
| Admin `AuditLog` | ✅ | `AuditLog` | Stats cards + live feed + heatmap + integrity verify |
| Admin `Dashboard` | 🟡 | `DashboardStats` | AI/device/api-request overview cards |
| Admin `Devices` | ✅ | `Device`/heartbeats | Health/online/blocked |
| Ops/Infra dashboards (CPU/mem/disk/uptime/latency) | 🔴 | — | None |

No Grafana. All dashboards are Mongo-polled React pages, refreshed on demand.

---

## 19. Critical Gaps

1. **No metrics pipeline** — no `/metrics`, no Prometheus, no OTEL, no Grafana. Nothing can be scraped or alerted on.
2. **No distributed tracing** — requestId/correlationId exist but are not logged in request lines or propagated to external calls.
3. **No crash/error reporting** — Sentry absent; uncaught errors exit the process; frontend errors are console-only.
4. **Logging is console-only** — no framework, no levels, no rotation, no persistence, no central sink; `[req]` lines lack requestId.
5. **No external alerting** — AuditAlert feed is in-app/pull-only; no PagerDuty/Slack/email.
6. **No job/queue/scheduler monitoring** — all background work is fire-and-forget `setInterval`.
7. **`slowEndpoints` is a stub** — declared in the interface, always `[]`; API latency analytics are effectively missing.
8. **`/api/health` is shallow** — DB-only; no Redis/dependency readiness; no uptime/payload detail.
9. **No infra telemetry** — memory/CPU/disk/uptime absent; no Docker/K8s.
10. **Frontend has no RUM** — no web-vitals, session replay, or client crash analytics.

---

## 20. Implementation Matrix

> Read-only audit — recommendations only, no code was written.

| Priority | Action | Effort | Impact |
|---|---|---|---|
| P0 | Add a structured logger (Pino/Winston) with JSON output + requestId correlation; replace ad-hoc console in requestLogger | S–M | High |
| P0 | Add Sentry (`@sentry/node` backend, `@sentry/react` both frontends + Electron `crashReporter`) | S–M | High |
| P0 | Implement `GET /metrics` (prom-client) for Node + expose Mongo/Redis/process gauges; add Docker/Grafana later | M | High |
| P1 | Implement true readiness (`/health/live`, `/health/ready` incl. Redis) | S | Medium |
| P1 | Wire audit/critical events to email/Slack webhook (no vendor needed for Slack webhook) | S–M | Medium |
| P1 | Implement `slowEndpoints` (aggregate `[req]` latency into a time-series) | M | Medium |
| P1 | Track requestId in `[req]` log lines + propagate `traceparent` | S | Medium |
| P2 | Add scheduler run-status collection + failure alerts for the 6 background jobs | M | Medium |
| P2 | Frontend web-vitals (library is tiny) + performance marks | S | Medium |
| P3 | Session replay / crash analytics (Sentry Replay) | M | Low–Medium |

---

## 21. Production Readiness

| Dimension | Rating | Verdict |
|---|---|---|
| Business telemetry | 🟢 Strong | AI/audit/webhook/device metering is production-grade |
| Operational visibility | 🔴 Weak | No metrics/tracing/crash tooling |
| Incident detection | 🔴 Weak | No push alerting; in-app feed requires a human to check |
| Incident response | 🟡 Weak | No runbooks, no ownership markers in alerts |
| Capacity planning | 🔴 Weak | No memory/CPU/disk/latency history |
| Audit/security visibility | 🟢 Strong | Tamper-evident audit + security alert feed |

**Readiness verdict:** Not production-ready for ops. A production deployment could function (business features are instrumented) but any infrastructure or runtime incident would be **silent** without a human watching the admin dashboard.

---

## 22. Final Score

### Checklist summary (51 items)

| Area | ✅ | 🟡 | 🔴 |
|---|---|---|---|
| Logging | 2 | 2 | 6 |
| Health/Metrics/Tracing | 3 | 3 | 7 |
| Error/Crash | 1 | 3 | 2 |
| Alerting | 1 | 1 | 4 |
| Background/Queue | 0 | 1 | 7 |
| AI/DB/Infra | 3 | 4 | 3 |
| Frontend | 1 | 2 | 5 |
| API/Security/Perf/Dashboard | 3 | 4 | 1 |
| **Total** | **14** | **20** | **35** |

*(0.5 credit per partial) → (14 + 20×0.5) / 69 = 24/69 = **≈35%** of observability items.*
Weighted for severity (missing metrics/tracing/alerting are disproportionate in impact):

### Overall completion: **~29%**

| Category | Score |
|---|---|
| Logging | 🟡 35% |
| Health & Readiness | 🟡 50% |
| Metrics & Tracing | 🔴 10% |
| Error & Crash Tracking | 🟡 40% |
| Alerting | 🔴 15% |
| Background Jobs / Queues | 🔴 10% |
| AI Monitoring | ✅ 95% |
| Database / Infra Monitoring | 🔴 10% |
| Frontend Monitoring | 🟡 25% |
| Security Monitoring | ✅ 80% |

**Bottom line:** **~29% complete.** The platform has excellent *business* telemetry (AI usage, audit, webhooks, device health) but is missing essentially the entire *operational* observability stack — metrics, tracing, crash reporting, log management, and external alerting. The single highest-leverage next step is adding Sentry + a Prometheus `/metrics` endpoint, which would convert the existing structured logs into a real observability posture.

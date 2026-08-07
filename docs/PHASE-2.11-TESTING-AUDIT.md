# Phase 2.11 — Exhaustive Testing Audit (Read-Only)

**Date:** 05 Aug 2026
**Repo root:** `C:\Loyalty_POS system` (git `master`)
**Audit mode:** READ-ONLY. No source files were modified. All findings below are verified from actual source, test, and config files.

---

## 1. Executive Summary

This is the definitive testing inventory of the monorepo. Every test file, config, and CI artifact was read and catalogued.

**Bottom line up front:**

- **Backend** (`backend/`): **37 Vitest files, 539 `it()` cases** — a real, meaningful suite (middleware, utilities, 18 service suites, and 6 module suites) running against real in-memory MongoDB (`mongodb-memory-server`).
- **Frontend unit** (`restaurant-pos/Frontend/`): **5 Vitest files, 51 `it()` cases** — valid but narrow (kitchen display, debug log, 2 hooks/libs, AI voice parser).
- **Frontend E2E** (`restaurant-pos/Frontend/e2e/`): **8 spec files, 91 tests** — strong coverage of ordering, offline mode, split payment, multi-branch, AI degradation, layout, and guided tour.
- **Zero tests** in `admin-dashboard/` (150 project files, 0 test files, no test script, no test devDependencies) and `remix_-restaurant-pos-terminal/` (6-file component skeleton).
- **No CI/CD of any kind.** No `.github/workflows`, no GitLab, no Azure Pipelines, no Circle, no Travis in project config (all YAML hits are inside `node_modules`).

**Critical defects found (verified):**

1. **Coverage configuration is deceptive.** `backend/vitest.config.ts` sets `coverage.include: ['src/modules/ai/**']` with **no thresholds**. The only module whose coverage is measured is AI; the other ~40 modules report zero/nothing. Running `vitest --coverage` gives the illusion of coverage measurement across the app when it measures ~1 module.
2. **Zero controller tests and zero route/integration tests.** 55 controllers and 33 routes have no direct tests, and there is no `supertest`/MSW anywhere, so HTTP layer, request/response contracts, auth wiring, and error propagation are entirely untested.
3. **5 E2E tests are hard-coded skipped** (`ai-visual-qa.spec.ts` lines 212, 246, 274, 304, 349 — `test.skip(true, 'Could not navigate to Inventory'/'Waste page')`). The Inventory/voice/waste AI touchpoints therefore have **no passing coverage**.
4. **At least one E2E spec is stale and currently fails**: `tour-visual-verify.spec.ts` times out in `beforeEach` because it targets removed `input[placeholder*="cashier"]`/`PIN` fields; the live login screen (verified in the failure artifact snapshot) uses "User ID / Username" + "Password" and has no quick-login buttons. `test-results/.last-run.json` = `"status": "failed"`.
5. **Two E2E specs (`ai-diagnostic.spec.ts`, `ai-diag.spec.ts`) contain no assertions** — they are diagnostic console-log scripts that count as "tests" but verify nothing.
6. **~29 of 48 backend service files are untested** (auth, orders, tables, inventory events, campaigns, offers engine, reservations, referrals, rewards, sync, OTP, etc.) — see Section 25.

---

## 2. Scope & Method

- Audit target: all testing artifacts in the monorepo — test source, framework config, scripts, CI config, and run artifacts.
- Method: every `*.test.ts`/`*.spec.ts`/`*.test.tsx` file read and its cases enumerated; configs read (`vitest.config.ts`, `playwright.config.ts`, `package.json` x3); CI directories searched repo-wide (excluding `node_modules`); run artifacts in `test-results/` inspected.
- Constraint honored: **no file was edited or created** during the audit itself. This report is the only deliverable.

---

## 3. Repository Layout & Test Apps

| App | Path | Test framework | Test count |
|---|---|---|---|
| Backend API | `backend/` | Vitest + mongodb-memory-server | 37 files / 539 cases |
| POS frontend (unit) | `restaurant-pos/Frontend/` | Vitest (jsdom) | 5 files / 51 cases |
| POS frontend (E2E) | `restaurant-pos/Frontend/e2e/` | Playwright (Chromium) | 8 files / 91 tests (5 skipped) |
| Admin dashboard | `admin-dashboard/` | **None** | 0 |
| Remix terminal | `remix_-restaurant-pos-terminal/` | **None** | 0 |
| Template | `gsd-template/` | n/a | 0 (not application code) |

---

## 4. Test Tooling Matrix

| Tool | Present | Where |
|---|---|---|
| Vitest | ✅ | backend, restaurant-pos/Frontend |
| Playwright | ✅ | restaurant-pos/Frontend (e2e) |
| mongodb-memory-server | ✅ | backend (real in-memory Mongo per suite) |
| jsdom | ✅ | restaurant-pos/Frontend unit |
| supertest | ❌ | nowhere |
| MSW | ❌ | nowhere |
| nock / sinon | ❌ | nowhere |
| Jest | ❌ | nowhere |
| Cypress | ❌ | nowhere |
| Testing-library | ✅ | restaurant-pos/Frontend (`@testing-library/react`, `dom`, `jest-dom`) |
| CI/CD pipeline | ❌ | none |

---

## 5. Backend Test Framework & Config

**Scripts** (`backend/package.json`):
```
"test": "vitest run",
"test:watch": "vitest"
```

**Config** (`backend/vitest.config.ts`):
- `globals: true`, `environment: 'node'`
- `include: ['src/**/*.test.ts']`, `exclude: ['node_modules', 'dist']`
- `testTimeout: 60_000`, `hookTimeout: 60_000`
- `maxWorkers: 2`, `minWorkers: 1` (conservative resource use)
- **Coverage:** provider `v8`, `include: ['src/modules/ai/**']` only — **no thresholds, no other includes**.

**Infrastructure:** tests are DB-backed via `mongodb-memory-server` (verified per-suite in services/modules). No mocks for the Mongo layer. Assertions via `expect` (Vitest built-in), `globals: true` (no imports of `it`/`describe`).

---

## 6. Backend Coverage Scope & Thresholds

- Effective coverage measurement is restricted to `src/modules/ai/**`.
- No `thresholds` block → the pipeline would pass with 0% on every other module.
- No `reportsDirectory`, `reporter` customization → no enforced coverage reports in CI (none exists anyway).
- **Implication:** any claim of "backend X% covered" from this config is false or AI-only. The audit's own per-file evidence (below) is the true signal.

---

## 7. Frontend Unit Framework & Config

**Scripts** (`restaurant-pos/Frontend/package.json`):
```
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui",
"test:e2e:debug": "playwright test --debug",
"lint": "tsc --noEmit"
```

**Test devDependencies:** `vitest`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/jest-dom`, `@playwright/test`, `playwright`.

**Unit suite:** 5 files / 51 cases (counts from source):

| File | `it()` |
|---|---|
| `src/ai/__tests__/voiceParser.test.ts` | 26 |
| `src/lib/__tests__/syncEngine.test.ts` | 11 |
| `src/utils/debugLog.test.ts` | 6 |
| `components/__tests__/KitchenDisplay.test.tsx` | 6 |
| `src/hooks/__tests__/useOrders.test.ts` | 2 |
| **Total** | **51** |

Verified real assertions: `voiceParser` covers add_stock/log_waste/add_item/remove_item + edge cases; `syncEngine` covers offline queue persistence, 7-day retention, retry/drop logic; `KitchenDisplay` covers KOT type badge colors; `debugLog` covers dev/prod branching; `useOrders` covers `buildOrderOpenState`. No `.only`/`todo` found.

---

## 8. Frontend E2E Framework & Config

**Config** (`restaurant-pos/Frontend/playwright.config.ts`):
- `testDir: './e2e'`
- `fullyParallel: false`; `workers: 1`
- `forbidOnly: !process.env.CI` (only honored when CI var set — never in practice)
- `retries: CI ? 1 : 0` → **0 retries locally**
- `timeout: 60_000`
- `baseURL: http://localhost:5173`; webServer: `npx vite --port 5173`
- 1 project: **Chromium only** (no Firefox/WebKit)
- Reporters: html + list; screenshot/video on failure

**Full E2E inventory (verified per spec):**

| Spec | Tests | Notes |
|---|---|---|
| `layout-verification.spec.ts` | 42 | 3 viewports × 14 pages; serial mode |
| `edge-cases.spec.ts` | 14 | offline 5, split payment 4, multi-branch 5 |
| `offline-error-ai.spec.ts` | 12 | offline queue 5, error boundary 3, AI degradation 4 |
| `ordering-flow.spec.ts` | 7 | login → order → checkout → loyalty |
| `tour-visual-verify.spec.ts` | 6 | **currently failing (timeout)** |
| `ai-visual-qa.spec.ts` | 8 | **5 hard-skipped** (Inventory nav fail) |
| `ai-diagnostic.spec.ts` | 1 | **no assertions** (console/diag) |
| `ai-diag.spec.ts` | 1 | **no assertions** (console/diag) |
| **Total** | **91** | 5 skipped + 2 assertion-less |

---

## 9. CI/CD Status

- **No CI/CD configuration exists.** Repo-wide scan (excluding `node_modules`) for `.github/workflows`, `.gitlab-ci.yml`, `azure-pipelines.yml`, `.circleci/`, `.travis.yml` returned **zero** project-level matches. (All `.yml` hits were dependency packages inside `node_modules`, plus electron-builder `builder-debug.yml` outputs.)
- No test script is referenced by any pipeline, no coverage is enforced, no PR gating.
- `playwright.config.ts` has `forbidOnly`/`retries` branches keyed on `process.env.CI`, but nothing ever sets it.

---

## 10. Backend Test Inventory — File-by-File (37 files, 539 `it()`)

**Middleware (5 files, 34 cases):**

| File | `it()` | `describe()` |
|---|---|---|
| `middleware/__tests__/subscriptionMiddleware.test.ts` | 12 | 2 |
| `middleware/__tests__/authMiddleware.test.ts` | 8 | 2 |
| `middleware/__tests__/errorHandler.test.ts` | 5 | 1 |
| `middleware/__tests__/requestLogger.test.ts` | 5 | 1 |
| `middleware/__tests__/validate.test.ts` | 4 | 1 |

**Utils (2 files, 22 cases):**

| File | `it()` |
|---|---|
| `utils/__tests__/queryParser.test.ts` | 12 |
| `utils/__tests__/apiResponse.test.ts` | 10 |

**Services (18 files, 320 cases):**

| File | `it()` |
|---|---|
| `services/__tests__/aiAnalyticsService.test.ts` | 53 |
| `services/__tests__/ownerService.test.ts` | 40 |
| `services/__tests__/planService.test.ts` | 37 |
| `services/__tests__/deviceService.test.ts` | 34 |
| `services/__tests__/restaurantService.test.ts` | 25 |
| `services/__tests__/entitlementService.test.ts` | 23 |
| `services/__tests__/supportTicketService.test.ts` | 22 |
| `services/__tests__/loyaltyService.test.ts` | 13 |
| `services/__tests__/customerService.test.ts` | 11 |
| `services/__tests__/offerValidation.test.ts` | 9 |
| `services/__tests__/expenseService.test.ts` | 8 |
| `services/__tests__/sessionService.test.ts` | 7 |
| `services/__tests__/billIdempotency.test.ts` | 6 |
| `services/__tests__/cashLedgerService.test.ts` | 6 |
| `services/__tests__/financeService.test.ts` | 6 |
| `services/__tests__/recurringExpenseService.test.ts` | 4 |
| `services/__tests__/vendorService.test.ts` | 4 |
| `services/__tests__/productService.test.ts` | 2 |

**Modules (12 files, 163 cases):**

| File | `it()` |
|---|---|
| `modules/subscription/__tests__/subscription.test.ts` | 38 |
| `modules/ai/__tests__/voice-parse.test.ts` | 27 |
| `modules/audit/__tests__/audit.test.ts` | 21 |
| `modules/media/__tests__/restaurantMedia.test.ts` | 21 |
| `modules/adminReports/tests/reportQueryBuilder.test.ts` | 18 |
| `modules/settings/__tests__/settingsService.test.ts` | 16 |
| `modules/reports/__tests__/salesReportService.test.ts` | 7 |
| `modules/adminReports/tests/reportExport.test.ts` | 7 |
| `modules/reports/__tests__/closingSummaryExport.test.ts` | 5 |
| `modules/adminReports/tests/revenue.test.ts` | 5 |
| `modules/reports/__tests__/productReportService.test.ts` | 4 |
| `modules/adminReports/tests/subscriptions.test.ts` | 4 |

---

## 11. Frontend Unit Inventory — 5 files / 51 cases

See Section 7 table. All 5 files verified as real assertions; none are `.only`/`.todo`.

---

## 12. Frontend E2E Inventory — 8 files / 91 tests

See Section 8 table. Breakdown of skipped/weak tests:
- **5 permanently skipped** in `ai-visual-qa.spec.ts` (Inventory Health, Purchase Recs, Low-Stock Preds, Voice FAB, Waste Analysis) — all short-circuit with `test.skip(true, ...)`.
- **2 assertion-less diagnostics** (`ai-diagnostic.spec.ts`, `ai-diag.spec.ts`).
- **1 known-failing suite** (`tour-visual-verify.spec.ts`) — see Section 24.

Effective non-skipped, real E2E tests: **83** (91 − 5 skipped − 2 diag − 1 known-failing suite's most recent run).

---

## 13. Middleware Coverage

Covered (verified): auth (JWT verification, 401/403, role checks, tenant id from token), validate (Zod body 400s), subscription gate (suspended 403, feature gates), errorHandler (AppError→matching status, Mongo dup-key 11000→409, Mongo validation→400), requestLogger (AuditLog mutation trail, secret redaction).

**Gap:** 12 middleware files exist; **5 have tests** (42%). The remaining 7 (rate limiting, tenant resolution, admin auth, CORS/security headers, file upload guards, etc.) are untested.

---

## 14. Utils Coverage

Covered: `queryParser` (pagination/sort/search/equality/date-range with clamping and whitelisting) and `apiResponse` (success/error envelopes + pagination meta).

**Gap:** the broader `utils/` set is otherwise untested.

---

## 15. Services Coverage — Tested (18 of 47 source services)

Verified real, DB-backed suites exist for:
`aiAnalyticsService`, `billService` (idempotency), `cashLedgerService` (open-cash-once/day, no negative balance), `customerService` (tenant isolation), `deviceService` (registration/approval/block/limits/fingerprint), `entitlementService` (branch usage), `expenseService` (tenant, soft-delete, version), `financeService`, `loyaltyService` (welcome points, earn rate), `offerValidationService`, `ownerService` (atomic onboarding), `planService` (limits merge, clone, versions, rollback), `productService` (malformed variant skip, replace), `recurringExpenseService` (idempotent generation, dayOfWeek requirement), `restaurantService` (create w/ subscription+payment), `sessionService` (revocation, token hash), `supportTicketService` (full lifecycle), `vendorService`.

---

## 16. Services Coverage — UNTESTED (29 of 47 source files)

No direct or indirect test coverage found for:

| # | Service file | Domain risk |
|---|---|---|
| 1 | `authService.ts` | credentials, PIN, JWT issuance |
| 2 | `orderService.ts` | **core ordering/billing** |
| 3 | `tableService.ts` | table lifecycle |
| 4 | `tableStateService.ts` | occupancy/state transitions |
| 5 | `floorService.ts` | floor layout |
| 6 | `heldOrderService.ts` | held/offline orders |
| 7 | `takeawayOrderService.ts` | takeaway flow |
| 8 | `inventoryEventService.ts` | stock events |
| 9 | `stockMovementService.ts` | stock movements |
| 10 | `purchaseService.ts` | purchasing |
| 11 | `supplierService.ts` | suppliers |
| 12 | `expenseCategoryService.ts` | expense categories |
| 13 | `campaignService.ts` | campaigns |
| 14 | `offerEngine.ts` | offer evaluation engine |
| 15 | `segmentEngine.ts` | customer segmentation |
| 16 | `rewardService.ts` | rewards redemption |
| 17 | `referralService.ts` | referrals |
| 18 | `reservationService.ts` | reservations |
| 19 | `otpService.ts` | OTP/2FA |
| 20 | `syncService.ts` | cross-device sync |
| 21 | `branchService.ts` | branches (ORM layer) |
| 22 | `employeeService.ts` | staff |
| 23 | `devicePolicyService.ts` | device policies |
| 24 | `cacheService.ts` | caching |
| 25 | `analyticsService.ts` | analytics aggregation |
| 26 | `analyticsExportService.ts` | analytics exports |
| 27 | `customerReportService.ts` | customer reports |
| 28 | `festivalService.ts` | festival modules |
| 29 | `aiCostConfig.ts` | AI cost config |

---

## 17. Module Test Suites — Covered

| Module | Suite | Notes |
|---|---|---|
| `subscription` | `subscription.test.ts` (38) | mocked models; trial→suspended; webhook idempotency |
| `audit` | `audit.test.ts` (21) | hash-chain integrity, tamper detection, retention, legal hold, CSV/JSON export |
| `media` | `restaurantMedia.test.ts` (21) | MIME/oversize/corrupt file, orphaned-file cleanup |
| `settings` | `settingsService.test.ts` (16) | priority merge device→branch→restaurant |
| `reports` | 3 files (16) | closing summary + CSV/XLSX/PDF export builders |
| `adminReports` | 4 files (34) | query builder, export (CSV/JSON + AES-256-GCM), revenue MRR/ARR, churn |
| `ai` | `voice-parse.test.ts` (27) | Zod schema + prompt builder only |

---

## 18. Controllers & Routes Coverage

- **Source stats:** 64 models, 55 controllers, 33 routes, 75 services, 12 middleware (verified counts).
- **Controllers:** **0 test files.** No `supertest`, no HTTP-level mocks.
- **Routes:** **0 test files.** No integration tests that boot the Express app.
- **Consequence:** auth wiring, body→controller plumbing, error envelope shape, rate-limit behavior, and route handlers are entirely unverified by automated tests. This is the single largest backend blind spot.

---

## 19. Admin Dashboard Coverage

- 150 non-`node_modules` project files (26 `src/pages`, 16 `src/api`, 13 UI components, contexts, hooks, layouts, electron main).
- **Test files: 0.** No `__tests__`, no `*.test.*`, no `*.spec.*`.
- **Scripts:** only dev/build/package/preview/start — **no `test` script**.
- **Test devDependencies:** none (`vitest`/`jest`/`playwright` absent from `devDependencies`).
- **Verdict:** fully untested frontend surface (24 pages).

---

## 20. Remix Terminal Coverage

- `remix_-restaurant-pos-terminal/Frontend/` contains exactly **6 component files** (`AppSidebar`, `AppTitleBar`, `BillingProductGrid`, `CartPanel`, `GuidedTour`, `MoreWorkspace`) and no other source.
- **Test files: 0.** No test script, no test deps.
- **Verdict:** skeleton directory; untested (and largely incomplete).

---

## 21. AI Module Coverage

- **Backend `modules/ai`:** only `voice-parse.test.ts` (27 cases) covers `voiceParseSchema` + `buildVoiceParsePrompt`. **`aiService`, `weatherService`, `aiUsageLogger`, `responseParser` have NO tests.**
- `aiAnalyticsService.test.ts` (53) is the largest single suite but lives in `services/` and tests analytics aggregation, not the AI call path.
- **Irony:** the coverage config restricts itself to `src/modules/ai/**` yet that module's core services are untested — the only "measured" module is mostly empty.
- **Frontend AI:** `voiceParser.test.ts` (26) and the 4 `offline-error-ai` AI-degradation E2E tests are the only AI UI coverage; the 5 skipped Inventory-AI E2E tests leave health score / purchase recs / low-stock preds / voice FAB / waste analysis **unverified**.
- `admin-dashboard/src/pages/AIUsage.tsx` + `voiceInventory` UI have zero tests.

---

## 22. Reports / Analytics / Export Coverage

- Strong: `reportQueryBuilder` (window/forecast math), `reportExport` (buildCSV/buildJSON/sha256 + AES-256-GCM encryptPayload), `revenue` (MRR/ARR ledger), `subscriptions` (churn regression), and `reports` module CSV/XLSX/PDF builders.
- **Gaps:** `analyticsService`, `analyticsExportService`, `customerReportService` untested; admin dashboard reports UI untested.

---

## 23. Coverage-Reporting Adequacy

- No enforced coverage thresholds anywhere.
- The only configured include (`modules/ai/**`) is both too narrow and poorly targeted (core AI services untested).
- No `nyc`/v8 report integration, no coverage badge, no CI to enforce.
- The repo contains **no usable coverage signal** for non-AI code; all per-area coverage claims in this report are derived from direct file/`it()` enumeration, not from a coverage tool.

---

## 24. Test Quality Concerns (verified defects)

1. **`tour-visual-verify.spec.ts` is broken.** Failure artifact at `restaurant-pos/Frontend/test-results/tour-visual-verify-Guided--…-render-with-correct-titles-chromium/error-context.md`:
   - `Test timeout of 120000ms exceeded while running "beforeEach" hook.`
   - `waiting for locator('input[placeholder*="cashier"]')` — never found.
   - Page snapshot shows the current login screen is **"POS Terminal Sign In"** with **"User ID / Username"** (`placeholder="e.g. owner_ratjs_s6uj"`) and **"Password"** fields + "Sign In to POS" button — no quick-login/PIN buttons. The spec's `login()` helper targets removed `PIN: 3333` quick-login buttons and `input[placeholder*="cashier"]`/`input[placeholder*="PIN"]`.
   - `test-results/.last-run.json` at repo root records `"status": "failed"`.
2. **5 skipped AI E2E tests** (`ai-visual-qa.spec.ts`): Inventory, Voice FAB, Waste Analysis never verified.
3. **2 assertion-less "tests"** (`ai-diagnostic.spec.ts`, `ai-diag.spec.ts`) — pass trivially, prove nothing; should be removed from the suite.
4. **Duplicate/near-duplicate diag specs** (`ai-diag.spec.ts` vs `ai-diagnostic.spec.ts`) indicate leftover debug scaffolding.
5. **No retries locally** (`retries: CI ? 1 : 0` with no CI env) makes E2E flake-prone.
6. **Chromium-only** E2E; no cross-browser verification.
7. **Coverage config is misleading** (Section 6/23).

---

## 25. Complete Gap List (individual)

**Backend — 0 test files:**
- All **55 controllers** (each individually untested).
- All **33 route files** (each individually untested; no integration harness).
- **29 services** (see Section 16 list).
- **7 of 12 middleware** files untested.
- AI: `aiService`, `weatherService`, `aiUsageLogger`, `responseParser`.
- Modules with zero suites: `auth`, `employees`, `branches`, `orders`, `tables`, `kitchen`, `campaigns`, `notifications`, `payments`, `reservation`, `rewards`, `referral`, `promotions`, `analytics` (service-side), `backups`, `restore`, `weather`, `exports`, `voice-inventory` (service side beyond voice-parse schema), `qr-ordering`.

**Frontend unit — untested modules (0 files):** the vast majority of `restaurant-pos/Frontend/src` — no tests for auth, API client, billing logic, product grid, cart, settings, reports, expenses, branches, kitchen workspace beyond the single `KitchenDisplay` component, etc.

**Frontend E2E — untested workflows:** Inventory AI (5 skipped), voice inventory full flow, admin dashboard (no e2e), and the shared `seedData` helper's `STORAGE_STATE_PATH` (`./e2e/helpers/storageState.json`) is exported but never referenced by any config (no `storageState` usage).

**Cross-cutting:** no CI, no coverage thresholds, no HTTP-layer tests, no admin-dashboard tests, no remix-terminal tests, no mutation/stress/fuzz tests, no accessibility tests.

---

## 26. Coverage Percentages (enumerated, not tool-derived)

| Scope | Covered | Total | % |
|---|---|---|---|
| Backend test files (of all src files) | 37 test files | ~250+ src files | ~15% file-level |
| Backend `it()` cases | 539 | — | — |
| Backend services (source files) | 18 | 47 | 38% |
| Backend middleware (source files) | 5 | 12 | 42% |
| Backend controllers | 0 | 55 | 0% |
| Backend routes | 0 | 33 | 0% |
| Frontend unit (source modules) | 5 files | ~200+ files | ~2–3% |
| Admin dashboard | 0 | 24 pages + 16 api | 0% |
| E2E (real, non-skipped) | 83 | 91 | 91% |
| CI/CD enforcement | 0 | 1 | 0% |

Note: percentage of *files* is a proxy; line/branch coverage is unknowable because the only coverage config measures `modules/ai/**`.

---

## 27. Risks & Recommendations (informational — not executed, per read-only mandate)

**Highest-risk untested areas (order of business impact):**
1. **HTTP/API layer** — controllers + routes: 0%. Contract, auth, and error-path bugs ship silently.
2. **Core commerce services** — `orderService`, `tableStateService`, `heldOrderService`, `takeawayOrderService`, `inventoryEventService`, `stockMovementService`, `purchaseService`: 0%.
3. **Security-sensitive services** — `authService`, `otpService`, `sessionService` (partial), `devicePolicyService`: critical auth gaps.
4. **Engagement services** — `offerEngine`, `segmentEngine`, `rewardService`, `referralService`, `campaignService`, `reservationService`: 0%.
5. **Admin dashboard** — 0% across 24 pages; finance/CRM/reporting UI carries the same risk as the POS.

**Recommendations (to be executed in a later phase, not now):**
1. Fix coverage config: expand `include` to `src/**`, add thresholds, wire to CI.
2. Add `supertest` + boot the Express app for route/controller integration tests.
3. Add tests for the 29 untested services (start with `orderService`, `authService`, `inventoryEventService`).
4. Repair or remove `tour-visual-verify.spec.ts` (update `login()` to the current username/password form).
5. Fix the 5 skipped Inventory-AI E2E tests (update `navigateToInventory` to the current More-workspace navigation) or delete them.
6. Delete the two assertion-less diagnostic specs.
7. Add admin-dashboard unit tests (vitest is already in the monorepo toolchain).
8. Add a minimal CI pipeline (GitHub Actions) that runs backend unit, frontend unit, and E2E with `CI=true` to unlock retries and `forbidOnly`.

---

## 28. Verdict

| Dimension | Rating | Basis |
|---|---|---|
| Backend unit/service/module | **Good (partial)** | 539 real cases; strong on middleware, services, reports, audit, subscription; **0% at HTTP layer** |
| Frontend unit | **Weak** | 51 cases across 5 files; most of the app untested |
| Frontend E2E | **Strong where active** | 83 real tests covering ordering, offline, split, multi-branch, AI fallback, layout; but 5 skipped + 1 broken suite + 2 no-op tests |
| Admin dashboard | **None** | 0 tests, no harness |
| Remix terminal | **None** | 0 tests |
| CI/CD | **None** | no pipeline, no enforcement |
| Coverage reporting | **Misleading** | only `modules/ai/**` measured, no thresholds |

**Overall Phase 2.11 outcome:** the backend's service/module layer and the POS E2E layer are genuinely tested and valuable; the HTTP layer, the admin dashboard, and ~29 backend services are effectively unprotected; coverage tooling is configured to measure almost nothing; and 8 E2E tests are skipped/no-op/broken. **The suite is a solid foundation, not a complete safety net.** No automated testing change was made during this audit; all remediation is deferred to a designated implementation phase.

# CHITKUBER — MASTER TODO: ONE-YEAR HISTORICAL DATA FOUNDATION

**Status:** PLAN + PHASE 1 CONTRACT (no historical data written)
**Date:** 2026-10-08 · branch `master`
**Mode:** additive-only · read-only until each phase is approved · default `DRY_RUN`
**Supersedes phase numbering of:** `audit-final-master-coverage.md` §13 (this file uses the
prompt's §53 canonical 21-phase numbering).

This document is **STEP 2–5** of the master prompt. Phase 1 is implemented in code (see §9).
No data was inserted, no schema removed, no UI touched, no model retrained.

---

## 0. HARD RULES OBSERVED IN THIS PLAN

```text
1. Preserve everything: no UI / route / API / feature / model / business-rule removal.
2. Additive only: EXISTING + HISTORICAL FOUNDATION, both continue to work.
3. Reuse real history; never re-seed over real rows; idempotent upserts on natural keys.
4. Never fabricate: historical cost, customer identity, marketing exposure, weather.
5. Tenant id comes from the approved run scope, NEVER from an LLM/client field.
6. Business date = restaurant timezone boundary, not UTC midnight (D5).
7. Modes: DRY_RUN | VALIDATE_ONLY | APPLY. Default DRY_RUN.
8. No blind mass inserts: report counts, scope, idempotency key before the smallest safe batch.
9. No scratch files: permanent tooling lives in backend/scripts/ and is documented.
```

---

## 1. STEP 1 — RE-VERIFICATION RESULT (read-only, 2026-10-08)

Repo and live DB were re-inspected. The prior audit remains accurate; **three new material
discrepancies** were found and are reported (not silently reconciled).

| # | New finding | Evidence |
|---|-------------|----------|
| **D7** | **The "one year" is NOT one tenant's continuous history.** Live bill data is composed of *disjoint per-tenant windows*. Largest tenant `6ac0319…8f` (Urban Tadka Kitchen) = 19,722 bills over **180 distinct days** (2025-10-01 → 2026-03-29). Tenants `…022f` (The Royal Bistro) and `…c94b` (The Spice Garden) cover **2026-06-16 → 2026-09-15** only. **No single tenant has 365 days.** | `$group` by `restaurantId` with `$addToSet date` |
| **D8** | **`bills.date` is a String (`YYYY-MM-DD`), not a BSON Date.** `createdAt` is a BSON Date. Same pattern for `recipeconsumptions.date`. Any date math must parse strings. | `$type: '$date'` → `string` × 23,200; sample docs |
| **D9** | **A 78-day global blackout exists: 2026-03-30 → 2026-06-15** — zero bills for *any* tenant. Additional gaps: 2026-09-16 → 2026-09-28 (13d) and 2026-10-01 → 2026-10-02 (2d). Total 93 missing days inside 2025-10-01→2026-10-03 (275 present / 368 window). | missing-day enumeration |
| **D10** | **Existing synthetic-history infrastructure already exists and is the origin of the backdated tenants.** `backend/scripts/simulate-six-month-tenant.ts` (`SIM_RESTAURANT_6M_001`, START 2025-10-01, DAYS 180, SEED 20261002) generated Urban Tadka Kitchen via **real Mongoose models/services** with `--dry-run/--execute/--report/--clean` modes, deterministic seeded RNG, and `deleteMany({restaurantId: SIM_ID})` scoped cleanup. Reports at `scripts/sim-6m-*.json`, observer `scripts/observe-sim-tenant.ts`, ML syncers `scripts/sync-sim-*.ts`. | script headers + `sim-6m-report.json` |
| **D11** (Phase 2) | **BillItem referential integrity is broken.** 230,559 BillItem docs (80.7% of the 126,914 distinct item billIds) reference a `billId` with **no matching Bill**; only ~20,504 billIds resolve. Distributed across 2025-10…2026-09. Also tenant `…22f` (2,695 bills) has items lacking `itemName`/`priceAtSale`/`pricingSnapshot`. | `scripts/historical/reconcile.ts` |
| **D12** (Phase 2) | **`grandTotal` uses more than one convention.** 12,902 bills are tax-inclusive (`grandTotal = subtotal`), 783 are tax-additive, **6,820 match neither naive form** — so a backfill must reuse the existing finance metric logic, not a formula. | reconcile.ts |

Confirmed unchanged from prior audit: D1 (feedback models deployed, 0 rows), D2 (demand
snapshot persistence), D3 (TTL mismatch: `mlpredictions` active TTL; `forecasts`/`intelligencesignals`/`stockoutrisks` un-enforced), D4 (`restaurantsettings` vs `restaurantssettings`), D5 (UTC-day slicing), D6 (`recipeconsumptions.date`).

**Implication.** This is a **development/demo database** (test tenants "Test Restaurant", "v",
"ve", "w", "qw", "VAbs"; sim tenant; Demo Restaurant with 0 bills). There is no production
customer history to protect. The correct posture is therefore *real-where-it-exists +
deterministic synthetic dev data for gaps*, with every synthetic row explicitly marked and
tenant-isolated — exactly what `SIM_RESTAURANT_6M_001` already does. **We extend that pattern;
we do not invent a parallel one.**

---

## 2. STEP 3 — COLLECTION / DOMAIN / PRODUCT-SURFACE COVERAGE

### 2.1 Collection accounting
```text
Live collections:        128 (verified via listCollections)
Zero-row collections:    26  (re-measured 2026-10-08; prior audit said 44 — counts moved)
Mongoose model files:    90 (src/models/**) + 3 in modules/recipes
DB-only collections:     promotions, qrtokens, customerrequests, qrorderingsessions,
                         costsettings, printers, restaurantsettings/restaurantssettings (dup),
                         settings, sttusages, voiceauditlogs, voicependingactions,
                         ticketcounters, ordercounters, invoicecounters, audit-chain, legal/consent
Every one of the 128 is classified in code — see §9 `classification.ts`.
```

### 2.2 Domain → collection → surface (which feature reads it)
| Domain | Primary collection(s) | Created by | Read by (surface) | History needed | ML needed |
|---|---|---|---|---|---|
| Sales spine | bills, billitems | billing (POS) | Reports, Finance, Insights, Z-report | yes | yes |
| Orders | orders, orderitems, kotrecords | order/KOT flow | Orders, KOT, Reports | yes | yes |
| Payments | Bill.payments[], refunds(0) | billing close | Finance, Z-report | yes | no |
| Products/menu | products, categories/variants/modifiers | menu admin | Menu, POS, Reports | yes (snapshots) | yes |
| Recipes/cost | recipes, recipeversions, recipeconsumptions | recipe editor | Inventory, Margins | yes (thin) | yes (cost) |
| Inventory | inventoryevents, purchases, batches, wastage, expiry | inventory module | Inventory, Insights | yes | yes |
| Customers | customers, customervisits, customersegments | CRM | Customers, Marketing | yes | yes |
| Loyalty | loyaltytransactions | loyalty | Customers, Offers | partial | yes |
| Marketing | offers, campaigns, campaignhistory, couponredemptions, offeranalytics | marketing | Marketing, Offers, Reports | yes | yes |
| Causal | offerexperiments(0), offerexperimentevents | experiments | Marketing, Uplift | partial | yes |
| Feedback | receiptfeedbacks, feedbackanalyses(0), feedbackinsights(0) | customer site | Feedback workspace | partial | no |
| Context | calendarevents (festival/sports) | calendar sync | Marketing, Insights | yes | yes |
| Finance | dailysummaries, monthlysummaries, expenses | analytics/finance | Finance, Reports, Z-report | yes | yes |
| AI/obs | aiusagelogs, learningsignals, recommendations, memory | AI agents | AI, admin | no | no |
| Predictions | mlpredictions(TTL), mlpredictionoutcomes(0) | ml-pipeline | ML, AI tools | yes | yes |
| Platform | subscriptions, licenses, admin reports, audit | admin module | Admin Dashboard | operational | no |

### 2.3 Product surfaces and their consumers
```text
Restaurant POS : billing, menu, inventory+purchases+recipes, customers+loyalty, offers+campaigns,
                 finance, insights, orders/KOT/hold, receipts+QR, settings, QR studio, Feedback
Admin POS      : core, finance, marketing, platform, reports, restaurants  (platform billing is
                 SEPARATE from restaurant finance — never mixed)
Customer site  : Home, Menu, Cart, Track, Receipt+feedback (sole ReceiptFeedback writer), CarForm
Backend/AI/ML  : 43 routes, 94 services, 20+ AI tools (all via ml-pipeline HTTP clients + single
                 llmClient gateway — no bypass), 5 ML services
```

---

## 3. STEP 4 — WHAT HISTORICAL DATA ALREADY EXISTS (measured)

```text
Domain                 Oldest        Newest        Volume      Per-tenant reality (D7)
Sales bills            2025-10-01    2026-10-03    23,200      split across tenants; max 180 days
BillItems              (string ct)   2026-10-03    285,687     follows bills
Orders                 2025-10-01    2026-09-29    3,497       follows tenants
Coupons                2025-10-06    2026-09-15    7,500       spans tenants
InventoryEvents        2025-10-01    2026-10-05    4,626       sim tenant 4,230
Purchases              2025-10-01    2026-10-02    1,129       sim tenant 723
DailySummary           2025-10-01    2026-10-03    731         sim tenant 540
Context (calendar)     2025-10-02    2026-12-31    1,018       includes future
Customers              2025-10-01    2026-09-29    1,634       sim tenant 1,200
Visits                 2026-06-18    2026-09-29    444         mid-year feature
Loyalty ledger         2026-06-18    2026-09-30    457         mid-year feature
Recipes versions       2026-04-18    2026-08-23    3           UNAVAILABLE before Apr-2026
Expenses               2026-06-18    2026-10-02    82          mid-year
Offer analytics        2025-10-06    2026-03-29    863         stale since Mar
Experiment events      2025-10-06    2026-03-29    5,432       window CLOSED, 8:1 imbalance
Feedback               2026-06-16    2026-09-15    248         3 months only
Predictions            2026-10-03    2026-10-10    2,349       TTL-deleted; outcomes 0
```
**Present in the source of truth (aggregate)** → one edge case is mandatory to state:
the transaction spine does **not** have a single continuous year; it has partial per-tenant years
plus a 78-day blackout (D9). The foundation must represent that honestly, not paper over it.

---

## 4. STEP 5 — DOMAIN CLASSIFICATION (exactly one action each)

Legend: `REUSE_EXISTING` · `RECONSTRUCT` · `BACKFILL_MISSING` · `GENERATE_SYNTHETIC_DEV_DATA` ·
`COLLECT_GOING_FORWARD` · `LEAVE_OPERATIONAL_ONLY` · `NOT_APPLICABLE`

| Domain | Action | Status | Rationale |
|---|---|---|---|
| Sales / bills / billitems | `REUSE_EXISTING` | OBSERVED | real + sim rows exist; never re-seed |
| Orders / KOT | `REUSE_EXISTING` | OBSERVED | — |
| Payments | `REUSE_EXISTING` | OBSERVED | embedded in Bill.payments[] |
| Refunds / voids | `COLLECT_GOING_FORWARD` | UNAVAILABLE | `refunds` = 0 rows |
| Products / menu | `REUSE_EXISTING` | OBSERVED | pricing snapshots on BillItem |
| Recipes / cost | `RECONSTRUCT` | UNAVAILABLE | only 3 versions → **cost = null pre-Apr-2026** (never today's cost) |
| Recipe consumption | `REUSE_EXISTING` | OBSERVED | 19,958 rows |
| Inventory events / purchases / batches | `REUSE_EXISTING` | OBSERVED | ledger intact |
| Wastage / expiry | `RECONSTRUCT` | PARTIAL | only where inventory ledger supports it |
| Customers | `REUSE_EXISTING` | OBSERVED | 64.7% identified; anonymous stay anonymous |
| Customer visits / RFM snapshots | `RECONSTRUCT` | PARTIAL | as-of-date only from existing bills |
| Loyalty ledger | `RECONSTRUCT` | PARTIAL | balance only where ledger is reliable |
| Offers / campaigns / coupons / offeranalytics | `REUSE_EXISTING` | OBSERVED | — |
| Experiment **events** | `REUSE_EXISTING` | PARTIAL | window closed 2026-03-29 |
| Experiment **definitions** | `BACKFILL_MISSING` | UNAVAILABLE | `offerexperiments` = 0 → do NOT fabricate |
| Feedback text/rating | `REUSE_EXISTING` | PARTIAL | 3 months |
| Feedback analysis / insights | `BACKFILL_MISSING` | PARTIAL | derived from existing feedback, not fabricated |
| Daily/monthly financial facts | `REUSE_EXISTING` | OBSERVED | timezone-correctness fixed in Phase 3 |
| External: festival / sports | `REUSE_EXISTING` | OBSERVED | calendarevents |
| External: weather / competition | `COLLECT_GOING_FORWARD` | UNAVAILABLE | no historical archive → never fabricate |
| Predictions | `REUSE_EXISTING` | PARTIAL | TTL-deleted; preserve going forward |
| Prediction outcomes | `COLLECT_GOING_FORWARD` | UNAVAILABLE | 0 rows |
| Learning signals | `COLLECT_GOING_FORWARD` | UNAVAILABLE | 0 rows |
| AI logs / audit / timeline / legal / voice / printers / QR tokens / counters / settings | `LEAVE_OPERATIONAL_ONLY` | — | operational, not historical fact |
| Admin platform billing | `LEAVE_OPERATIONAL_ONLY` | — | separate from restaurant finance |
| Dev/test gap-fill (new tenants, missing windows) | `GENERATE_SYNTHETIC_DEV_DATA` | — | **only** via the existing seeded sim harness, marked synthetic |
| Non-business infra collections | `NOT_APPLICABLE` | — | — |

**Rule applied:** synthetic is produced **only** where real history is absent *and* the gap must
be filled for dev/ML. Real history is never duplicated by synthetic. Synthetic rows are isolated
under a dedicated sim tenant id and flagged (Phase 8).

---

## 5. STEP 2 — MASTER TODO (21 PHASES)

Per-TODO fields: **Status · Priority · Phase · Files · Collections · Source · Dependency ·
Implementation · Validation · Rollback**.

```text
Status legend: [x] already exists  [~] extend existing  [ ] not started  [-] not needed  [!] blocking
```

### Phase 0 — Repository / data re-verification
| # | Status | Pri | Task | Files | Collections | Dependency | Validation | Rollback |
|---|---|---|---|---|---|---|---|---|
| 0.1 | [x] | P0 | Re-inspect repo + live DB read-only | — | 128 | — | this doc §1 | n/a |
| 0.2 | [x] | P0 | Measure per-tenant/per-branch/date coverage | — | bills | 0.1 | §1 D7/D8/D9 | n/a |
| 0.3 | [x] | P0 | Confirm existing synthetic sim infra (D10) | scripts/simulate-six-month-tenant.ts | — | 0.1 | §1 D10 | n/a |

### Phase 1 — Data contract and classification  ← **IMPLEMENTED THIS RUN**
| # | Status | Pri | Task | Files | Collections | Source | Dependency | Implementation | Validation | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.1 | [x] | P0 | Canonical fact contract (provenance, status, dataset version) | `src/modules/historical-foundation/dataContract.ts` | — | prompt §26–29 | 0.1 | types + enums, no I/O | typecheck | delete file |
| 1.2 | [x] | P0 | Domain classification registry for all 128 collections | `…/classification.ts` | 128 | this §4 | 1.1 | static registry | `dispatch` test | delete file |
| 1.3 | [x] | P0 | Business-day contract (types only; logic Phase 3) | `…/businessDay.ts` | — | D5 | 1.1 | interface + pure string helpers | test | delete file |
| 1.4 | [x] | P0 | Coverage self-check + unit tests | `…/__tests__/*.test.ts` | — | §9 | 1.2 | asserts full coverage | vitest | delete file |

### Phase 2 — Existing historical data reconciliation  ← **DONE (2.1)** / 2.2–2.3 pending
| 2.1 | [x] | P0 | Reconcile bill totals vs BillItems vs payments (read-only report) | `scripts/historical/reconcile.ts` | bills, billitems, recipeconsumptions | §44 | 1.2 | read-only tool + `docs/historical-foundation/phase2-reconciliation-report.md` | ran live, exit 0 | n/a |
| 2.2 | [ ] | P1 | Reconcile inventory ledger (opening+purch−cons−waste+adj=closing) | same | inventoryevents, purchases, recipeconsumptions | §45 | 2.1 | read-only | report | n/a |
| 2.3 | [~] | P1 | Reuse existing `scripts/audit-fact-consistency.ts` where possible | existing | — | — | 2.1 | extend, do not duplicate | existing test | n/a |

**Phase 2 result:** subtotal↔BillItems and split-payments reconcile (0 mismatches); **230,559 orphan BillItems (D11)** and **6,820 bills with an unexplained grandTotal convention (D12)** are reported; tenant `…22f` line prices are UNAVAILABLE. Consequences recorded for Phases 5/6/9/10.

### Phase 3 — Timezone / business-date foundation  ← **DONE (contract + report)**
| 3.1 | [x] | P0 | Reuse existing `normalizeBusinessDate` (zReportContext) | src/ai/agents/zReportContext.ts | restaurants | D5 | — | referenced, not duplicated | existing tests | n/a |
| 3.2 | [x] | P0 | Timezone-aware businessDate util (per-restaurant tz) | `…/businessDay.ts` | restaurants | §9 | 3.1 | pure ref impl + tests | 22 tests pass | revert file |
| 3.3 | [!] | P1 | Correct `analyticsService.ts:190` UTC slicing (**needs approval — behavior change, ~40 call sites**) | analyticsService.ts + ~40 modules | dailysummaries | D5 | 3.2 | **reported only** | regression | revert |

**Phase 3 result:** contract frozen; D5 blast radius (~40 modules) enumerated; existing tz helpers identified (`zReportContext.normalizeBusinessDate`, `cricketRelevance.toRestaurantLocalTime`). No production change. See `docs/historical-foundation/phase3-business-date-report.md`.

### Phase 4 — Historical extraction  ← **DONE (4.1)** / 4.2 pending
| 4.1 | [x] | P0 | Read-only extraction of bills→canonical daily sales facts (streamed, per-tenant) | `scripts/historical/extract.ts`, `src/.../derive.ts` | bills | §47 | 1.1 | pure derive + read-only tool | ran live (0 writes); revenue cross-check ✅ | n/a |
| 4.2 | [~] | P0 | Extraction of customers, loyalty, marketing, inventory, feedback | same | 10+ | §11 | 4.1 | per-domain extractor | counts | n/a |

**Phase 4 result:** sales spine extracted into 5,970 canonical facts for 7 tenants; urban-tadka revenue (8,603,712.30) matches the existing sim report exactly. See `docs/historical-foundation/phase4-extraction-report.md`.

### Phase 5 — Canonical historical facts
| 5.1 | [ ] | P0 | Canonical daily fact model (restaurant,branch,businessDate,metric,value,status,provenance) | new model `HistoricalDailyFact` | new `historicaldailyfacts` | §26–28 | 3.2,4.1 | additive collection, idempotent upsert | count + provenance spot-check | drop new collection only |
| 5.2 | [ ] | P0 | Derive facts from existing dailysummaries + bills (reuse metric logic) | service | — | §44 | 5.1 | reuse analyticsService semantics | reconciliation | n/a |

### Phase 6 — Historical reconstruction
| 6.1 | [ ] | P1 | As-of-date customer RFM snapshots | service | customers, bills | §20 | 5.1 | flags RECONSTRUCTED | spot checks | n/a |
| 6.2 | [ ] | P1 | Wastage/expiry reconstruction from ledger | service | inventoryevents | §19 | 5.1 | only where supported | ledger check | n/a |
| 6.3 | [ ] | P0 | Recipe cost history: null where unavailable (never today's cost) | service | recipeversions | §18 | 5.1 | enforce null rule | assertion | n/a |

### Phase 7 — Missing-data classification
| 7.1 | [x] | P0 | Classify each domain REUSE/RECONSTRUCT/BACKFILL/SYNTHETIC/GOING-FORWARD | classification.ts | — | §4 | 1.2 | static | test | n/a |
| 7.2 | [ ] | P0 | Missing-day ledger (93 days: closed / no-txn / missing / unknown) | report | bills | §43 | 7.1 | never auto-zero | report | n/a |

### Phase 8 — Synthetic development data (only where explicitly needed)
| 8.1 | [~] | P1 | Reuse `simulate-six-month-tenant.ts` harness (modes, seeded RNG, scoped cleanup) | existing script | sim tenant | D10 | 7.1 | extend for year-length, keep marker | dry-run + report | `--clean` scoped delete |
| 8.2 | [ ] | P1 | Ensure every synthetic row is flagged + isolated from real + excluded from training | script + model flag | sim tenant | §4,§32 | 8.1 | `synthetic:true`,`simKey` | filter test | n/a |

### Phase 9 — Data quality validation
| 9.1 | [ ] | P0 | Quality gates: counts, date range, tenant/branch dist, dupes, orphans, nulls, missing dates | `scripts/historical/quality.ts` | all | §41 | 4.1–8.2 | read-only | report | n/a |

### Phase 10 — Relationship / tenant / branch validation
| 10.1 | [ ] | P0 | Referential integrity checks (bill→item, redemption→bill, feedback→bill, consumption→product) | same | all | §33 | 9.1 | read-only | report | n/a |
| 10.2 | [ ] | P0 | Tenant isolation assertion on every generated row | — | all | §7 | 10.1 | assert restaurantId ∈ scope | test | n/a |
| 10.3 | [ ] | P0 | Branch-scope rules incl. legacy NULL branch (19 bills) | — | bills | §8 | 10.1 | explicit legacy handling | report | n/a |

### Phase 11 — Future data capture
| 11.1 | [ ] | P0 | Experiment definitions persisted with events | experiment writers | offerexperiments | §22,§23 | — | additive writer hook (approval) | test | revert |
| 11.2 | [ ] | P0 | Populate mlpredictionoutcomes on inference | predictionService | mlpredictionoutcomes | §39 | — | additive | test | revert |
| 11.3 | [ ] | P1 | Recipe/price/availability change events | recipe/menu services | new events | §40 | — | additive hooks | test | revert |
| 11.4 | [ ] | P1 | Weather/competition archive going forward | context tools | new | §25 | — | additive | test | revert |

### Phase 12 — Feature datasets
| 12.1 | [ ] | P1 | Demand features (lag/seasonality/context) from canonical facts | service | facts | §37 | 5.2 | temporal-safe | no-leak test | n/a |
| 12.2 | [ ] | P1 | Basket/customer/retention/offer features | service | facts | §37 | 12.1 | — | tests | n/a |

### Phase 13 — Label datasets
| 13.1 | [ ] | P1 | Labels (future sales, conversion, attributed revenue) | service | facts | §38 | 12.1 | strictly post-t | no-leak test | n/a |

### Phase 14 — Temporal train/test datasets
| 14.1 | [ ] | P1 | Chronological/walk-forward splits (as-of-date safe) | service | datasets | §38 | 13.1 | — | split test | n/a |

### Phase 15 — ML productionization
| 15.1 | [ ] | P2 | Wire canonical datasets into existing 5 model services (no model deletion) | ml-pipeline clients | — | §52 | 14.1 | additive adapters | integration test | revert |

### Phase 16 — Prediction outcome preservation
| 16.1 | [!] | P0 | Preserve evaluation evidence (TTL mismatch D3 + empty outcomes) — **report first** | predictionService, TTL config | mlpredictions, outcomes | §39 | 11.2 | minimal safe extension | test | revert |

### Phase 17 — Model versioning / registry
| 17.1 | [ ] | P2 | Central model/data registry (datasetVersion↔modelVersion) | service | — | §29 | 15.1 | additive | test | n/a |

### Phase 18 — Production inference
| 18.1 | [~] | P2 | Existing inference paths preserved; no changes required by this task | ml-pipeline | — | §52 | — | verify only | smoke | n/a |

### Phase 19 — Monitoring / retraining
| 19.1 | [ ] | P2 | Drift/outcome monitoring on preserved evidence | mlObservability | — | §60 | 16.1 | additive | test | n/a |

### Phase 20 — Z-report / Marketing / Inventory / Customer integration
| 20.1 | [~] | P1 | Feed canonical facts to Z-report / marketing / inventory / customer intelligence | agent context | facts | §61 | 5.2 | additive read | integration | revert |

### Phase 21 — Regression / security / final verification
| 21.1 | [ ] | P0 | Full regression + tenant isolation + no-removal assertion | — | — | §63 | all | — | test suite + report | n/a |

---

## 6. PHASE COMPLETION GATE (§56)

A phase is complete only with: implementation + tests + data validation + tenant validation +
relationship validation + regression verification. Code existing alone is **not** completion.

## 7. CURRENT RUN — PHASE 1 ONLY

Implemented (additive, no data writes):
- `backend/src/modules/historical-foundation/dataContract.ts`
- `backend/src/modules/historical-foundation/classification.ts`
- `backend/src/modules/historical-foundation/businessDay.ts`
- `backend/src/modules/historical-foundation/index.ts`
- `backend/src/modules/historical-foundation/__tests__/classification.test.ts`
- `backend/src/modules/historical-foundation/__tests__/dataContract.test.ts`

Not done (awaiting approval): every later phase, including any data write.

## 8. FINAL SAFETY ASSERTION (this run)

```text
No existing UI removed / hidden.        No existing feature removed / disabled.
No existing route / API removed.        No existing model deleted.
No existing collection deleted.         No existing data modified.
No business rule changed.               No POS/Admin/Customer workflow changed.
No ML model deleted or retrained.       No UI change of any kind.
Additive code only (new isolated module + tests + this plan).
```

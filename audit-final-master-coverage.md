# CHITKUBER — FINAL MASTER COVERAGE AUDIT

**Audit date:** 2026-10-08 · branch `master` · mode: **AUDIT ONLY (read-only)**
**Method:** repository inspection + read-only live MongoDB probes (`listCollections`, `estimatedDocumentCount`, `$min/$max`, `$group`, index inspection). No source files modified, no DB writes, no models retrained, no scratch files left behind (all probes were inline `node -e` one-liners).

This report is the **final completeness gate**. It reconciles the same-day prior audits
(`audit-report.md`, `audit-1yr-historical-ml-foundation.md` — which remain the deep
schema/route/field reference) against the **current** repository and **current live DB state**.
Where reality differs from the prior audit, the discrepancy is REPORTED, not silently reconciled.

---

## 1. WHAT CHANGED SINCE THE PRIOR AUDIT (DISCREPANCIES REPORTED)

| # | Finding | Evidence |
|---|---------|----------|
| D1 | **Feedback Intelligence was added AFTER the prior audit was written.** New models `FeedbackAnalysis` + `FeedbackInsight` (`backend/src/models/customers/`), new service `src/services/feedbackIntelligenceService.ts`, new routes `src/routes/feedbackIntelligence.ts` mounted at `/api/feedback` (server.ts:131,383), new frontend tabs in `restaurant-pos/Frontend/src/components/marketing/FeedbackPanel.tsx` + `FeedbackIntelligence.tsx`, 6 new API client functions. Live DB: collections `feedbackanalyses` (0 docs) and `feedbackinsights` (0 docs) already exist (auto-index created them on model init) — **no analysis has run yet**. | file tree + live DB probes |
| D2 | **Demand-model artifact persistence: the prior audit's in-memory artifact issue is now RESOLVED in code.** `MLmodels/Demand_forcasting_model/src/persistence.ts` implements debounced snapshot persistence; `database.ts:1811` restores state from the snapshot on boot; `forecasting.ts:5232` includes trained models in the persisted snapshot, with strict per-tenant isolation (`forecasting.ts:5183`). Persisted state exists on disk: `data/demand-state`. **Caveat:** restart-restore correctness is verified by code reading only, not by a restart test. | persistence.ts, database.ts, forecasting.ts |
| D3 | **TTL discrepancy vs prior audit.** Live index inspection shows `mlpredictions.expiresAt_1` **IS an active TTL** (`expireAfterSeconds: 0` → docs die at `expiresAt`) — consistent with the prior audit's warning. BUT `forecasts`, `intelligencesignals`, and `stockoutrisks` have **NO TTL index in the live DB** despite TTL declarations in their schemas (prior audit reported 30-day/7-day TTLs). Schema-declared TTLs are not enforced on these collections. | `db.collection(...).indexes()` |
| D4 | **Duplicate collections suspected:** both `restaurantsettings` (10 docs) and `restaurantssettings` (3 docs) exist in the live DB — likely a renamed/re-registered model. `settings` (0 docs) also exists. **Reported, not changed.** | live DB listCollections |
| D5 | **Business-day finding extended:** `Restaurant.timezone` exists (`restaurantService.ts:90,404`, default `'UTC'`), but `analyticsService.ts:190` derives daily facts via `d.toISOString().substring(0,10)` — **UTC date slicing, timezone field not applied**. Business-day boundaries are UTC midnight regardless of restaurant timezone. **No business-day configuration is honored in daily fact derivation.** | analyticsService.ts:190 |
| D6 | `recipeconsumptions` date field is `date` (String, with `createdAt`), not `consumedAt` — the prior audit's date-field naming for this collection needed correction. 19,958 rows. | live DB sample doc |

---

## 2. COVERAGE ACCOUNTING (beginning-of-audit inventory)

```text
Repository files discovered:      1,397 tracked files (5 app roots)
Backend model files:              90 (src/models/**/*.ts, excl. index.ts) + 3 module models (recipes)
Mongoose models:                  ~95 (90 domain + Recipe/RecipeVersion/RecipeConsumption)
MongoDB collections (LIVE):       128 (verified via listCollections)
Embedded schemas / snapshots:     BillItem.pricingSnapshot, OrderItem.pricingSnapshot,
                                  RecipeVersion.costSnapshot(13 fields)+lines, Bill.splitDetails,
                                  Offer.targeting, Campaign.audience, ExperimentEvent.features,
                                  Product.batches[], lastPurchasePrices[] (audited, inherited §13 prior)
Routes:                           43 route files (src/routes/*.ts) + module routers (ml-pipeline,
                                  experiments, z-report, inventory-agent, public-store, whatsapp…)
Controllers:                      55
Services:                         94 (src/services/*.ts) + module services
Repositories:                     src/repositories/ present
Background jobs / schedulers:     8 (marketingScheduler, campaignQueue worker, mlSyncScheduler,
                                  subscriptionScheduler, adminReports reportJobs, audit retentionService,
                                  qr-ordering sessionSweeper, cricket calendar sync)
External integrations:            Razorpay, WhatsApp (Meta), Cricket/sports provider, weather/festival
                                  context, LLM gateway (gemini|openai|custom key-pool), RabbitMQ/QnR tokens
Admin POS features:               admin/core/finance/marketing/platform/reports/restaurants modules
Restaurant POS features:          14 component domains (billing, menu, inventory, customers, offers,
                                  marketing, finance, insights, orders, receipts, settings, qr,
                                  shell, auth)
Customer features:                6 pages (Home, Menu, Cart, Track, Receipt+feedback, CarForm)
AI tools:                         20+ registered tools in 8 domains (sales, inventory, marketing,
                                  customers, products, restaurant, ml, context)
ML services:                      5 (Demand, MarketBasket, Uplift, OfferResponse, CustomerSegmentation)
ML models:                        5 (+ statistical-v1 in-process forecast)
Training pipelines:               demand /api/retraining/run + /api/ingest/pos-sync; MBA FP-Growth+GBM;
                                  uplift T-learner; offer-response logistic; segmentation KMeans
Inference pipelines:              5 model clients in backend/src/modules/ml-pipeline/ + predictionService
```

---

## 3. LIVE COLLECTION INVENTORY (verified 2026-10-08, read-only)

128 live collections. Volume-ordered top segment shown; `0` = exists, empty.

| Collection | Docs | | Collection | Docs |
|---|---|---|---|---|
| billitems | 285,687 | | offeranalytics | 863 |
| auditlogs | 26,224 | | dailysummaries | 731 |
| bills | 23,200 | | refreshtokens | 521 |
| recipeconsumptions | 19,958 | | loyaltytransactions | 457 |
| orderitems | 12,884 | | customervisits | 444 |
| couponredemptions | 7,500 | | products | 302 |
| timelineevents | 7,034 | | customersegments | 301 |
| offerexperimentevents | 5,432 | | reservations | 283 |
| inventoryevents | 4,626 | | **receiptfeedbacks** | 248 |
| orders | 3,497 | | expenses | 82 |
| kotrecords | 2,351 | | offers | 46 |
| mlpredictions | 2,349 | | campaigns | 29 |
| customers | 1,634 | | calendarevents | 1,018 |
| purchases | 1,129 | | restaurants | 10 |
| aiusagelogs | 913 | | feedbackanalyses | **0 (NEW, D1)** |
| recipeconsumptions uses `date`+`lines` | — | | feedbackinsights | **0 (NEW, D1)** |

**Zero-row collections (44):** licenses, mlpredictionoutcomes, otprequests, auditexportjobs,
learningsignals, refunds, feedbackinsights, auditalerts, settings, auditlogarchives, aibillingrecords,
reportexportjobs, legaldocuments, blockedips, webhookevents, itemaliases, promotioncandidates,
auditsavedsearches, feedbackanalyses, datasubjectrequests, ticketreplies, helpviews, auditlegalholds,
legalacceptances, offerexperiments, consentrecords, promotionscenarios(no collection), + others.
Notable: **mlpredictionoutcomes = 0** (durable outcome store designed, never populated — §74 prior audit stands) and **offerexperiments = 0** while offerexperimentevents = 5,432 (events written before/without experiment definitions, `experimentId` null on legacy rows).

**DB-only collections (no model file found in src/models; created by module code):**
`promotions` (modules/promotions), `qrtokens`, `customerrequests`, `qrorderingsessions`,
`costsettings`, `printers`, `restaurantsettings`/`restaurantssettings` (dup, D4), `settings`,
`sttusages`, `voiceauditlogs`, `voicependingactions`, `helpviews`, `ticketcounters`, `ordercounters`,
`invoicecounters`, `itemaliases` (empty), audit-chain collections, legal/consent collections.
All investigated; each is written by its module; none is orphan-critical for ML except noted in §8.

---

## 4. HISTORICAL COVERAGE MATRIX (live $min/$max probes)

| Domain | Collection.field | Oldest | Newest | Volume | Reconstructable | ML Ready |
|---|---|---|---|---|---|---|
| Sales | bills.date | **2025-10-01** | 2026-10-03 | 23,200 | OBSERVED (append-only, snapshots) | ✅ |
| Line items | billitems.createdAt | 2025-10-01 | 2026-10-03 | 285,687 | OBSERVED (price/name snapshots) | ✅ |
| Orders | orders.createdAt | 2025-10-01 | 2026-09-29 | 3,497 | OBSERVED | ✅ |
| Coupons | couponredemptions.createdAt | 2025-10-06 | 2026-09-15 | 7,500 | OBSERVED (billId String join) | ✅ |
| Causal | offerexperimentevents.assignedAt | 2025-10-06 | **2026-03-29** | 5,432 | OBSERVED (window CLOSED) | ⚠️ partial |
| Inventory | inventoryevents.eventDate | 2025-10-01 | 2026-10-05 | 4,626 | OBSERVED (FIFO cost basis) | ✅ |
| Purchases | purchases.date | 2025-10-01 | 2026-10-02 | 1,129 | OBSERVED | ✅ |
| Daily facts | dailysummaries.date | 2025-10-01 | 2026-10-03 | 731 | OBSERVED (UTC-day caveat D5) | ✅ |
| Feedback | receiptfeedbacks.createdAt | **2026-06-16** | 2026-09-15 | 248 | OBSERVED (only ~3 months) | ⚠️ short |
| Context | calendarevents.startDate | 2025-10-02 | 2026-12-31 | 1,018 | OBSERVED (future sync) | ✅ |
| Customers | customers.firstVisit | 2025-10-01 | 2026-09-29 | 1,634 | OBSERVED | ✅ |
| Visits | customervisits.visitDate | **2026-06-18** | 2026-09-29 | 444 | PARTIAL (feature added mid-year) | ⚠️ short |
| Loyalty ledger | loyaltytransactions.createdAt | **2026-06-18** | 2026-09-30 | 457 | PARTIAL (mid-year) | ⚠️ short |
| Recipes | recipeversions.effectiveFrom | **2026-04-18** | 2026-08-23 | **3** | **NO for most of the year** | ❌ |
| Expenses | expenses.date | 2026-06-18 | 2026-10-02 | 82 | PARTIAL (mid-year) | ❌ thin |
| Offer analytics | offeranalytics.snapshotDate | 2025-10-06 | 2026-03-29 | 869 | OBSERVED (stale since Mar) | ⚠️ stale |
| Predictions | mlpredictions.predictionFor | 2026-10-03 | 2026-10-10 | 2,349 | TTL-deleted (active TTL, D3) | via outcomes |
| Outcomes | mlpredictionoutcomes | — | — | **0** | designed, unmeasured | ❌ |

**Full 1-year coverage exists for the transaction spine (bills/billitems/orders/inventory/purchases/daily summaries).**
Mid-year feature additions (feedback 2026-06, visits/loyalty-ledger 2026-06, expenses 2026-06, recipe versions 2026-04) are the principal historical gaps.

---

## 5. TENANT / BRANCH / IDENTITY DISTRIBUTION (live $group probes)

```text
bills per tenant:  6f8f → 19,722 (85.0%) · 022f → 2,695 (11.6%) · c94b → 764 (3.3%)
                   + 4 tenants with ≤19 bills (test/noise)
bills per branch:  6f90 → 9,674 · 6f91 → 7,125 · 6f92 → 2,923 · 0230/0231/0232 → ~900 each
                   c94c → 483 · c94d → 281 · NULL → 19 (legacy, pre-branch)
Identity:          15,005 / 23,200 bills (64.7%) carry customerPhone; 8,195 (35.3%) anonymous
Causal split:      control 609 (391 no-purchase, 218 purchase) · treatment 4,823 (2,432 / 2,391)
                   converted rows: 2,347 — ALL with attributedRevenue > 0
```

**Severe tenant skew (85/12/3):** global ML training is dominated by tenant 6f8f; per-tenant
cold-start discipline (prior audit §49) is mandatory. Branch history is reconstructable from
`branchId` except 19 legacy NULL-branch bills.

## 6. RELATIONSHIPS — STATUS INHERITED + RE-VERIFIED

The full explicit/implicit/fragile relationship graph (prior audit §3, §14–§18) was re-verified
at its critical edges only; no relationship was found changed:

- `Bill → BillItem` (billId, ObjectId) — 285,687 items, live-verified ✓
- `Bill → Customer` (customerId + customerPhone snapshot) — 64.7% identified ✓
- `CouponRedemption.billId` is a **String** of an ObjectId — fragile-but-stable join ✓
- `OfferExperimentEvent.redeemedBillId → Bill` — attribution edge intact ✓
- `CustomerSegment.customerPhones[]` — denormalized PII membership, no history ✓ (unchanged)
- `Product.restaurantId` optional → unscoped global products ✓ (unchanged, P1 tenant risk)
- `ReceiptFeedback.billId → Bill` — 248 rows, live-verified earlier this session ✓
- **NEW edges (D1):** `FeedbackAnalysis.feedbackId → ReceiptFeedback` (unique 1:1),
  `FeedbackAnalysis.restaurantId` tenant-scoped, `FeedbackInsight.restaurantId` unique per tenant.
- Fragile joins unchanged: `favoriteItems`/`topItems` by NAME, BillItem.menuItemId String,
  segment membership by phone — all SAFE-with-caveats / FRAGILE per prior §16. NOT CHANGED.

## 7. CAUSAL / EXPERIMENT READINESS (live-measured, §35)

```text
Valid controlled rows:      5,432 (3,085 assigned + 2,347 converted)
Control arm:                609 (9.9% purchase rate: 218/609)
Treatment arm:              4,823 (49.6% purchase rate: 2,391/4,823) — 8:1 imbalance
Outcomes with revenue:      2,347 (100% of converted carry attributedRevenue)
Feature snapshots:          present on events (features{} Mixed, pre-treatment)
Experiment definitions:     offerexperiments = 0 rows — legacy events lack experimentId
Verdict:                    PARTIALLY READY — real treatment/control/outcome evidence exists,
                            but control arm is small, arms are imbalanced, the measurement
                            window closed 2026-03-29, and definitions are missing.
                            NOT READY FOR RELIABLE UPLIFT TRAINING as-is (report, no fabrication).
```

---

## 8. ML / AI INVENTORY (current state, live-verified where possible)

| Model | Location | Data source | Artifact persistence | Status |
|---|---|---|---|---|
| Demand forecasting | MLmodels/Demand_forcasting_model (Node/TS) | pos-sync ingestion API from backend ml-pipeline | **persistence.ts debounced snapshots → data/demand-state (D2: prior issue resolved in code)** | TRAINED, 2,349 live predictions |
| Market Basket | MLmodels/Market_Basket_Analysis (FastAPI) | basket extraction; SQLite `restaurant_intelligence.db` present | model_store/ | present |
| Uplift | MLmodels/Uplift (FastAPI T-learner) | experiment events + synthetic CSV | — | NOT READY (§7) |
| Offer Response | MLmodels/Offer_Response_Model | per-tenant JSON weights (data/offer-response-weights) | JSON per tenant | present |
| Customer Segmentation | MLmodels/Customer_segmentation_model | segment extraction | model_store/<tenant-hash>/ | present |
| Statistical forecast | backend in-process (`statistical-v1`) | MongoDB | MLPrediction store | LIVE (4 forecast rows) |
| Feedback Intelligence (NEW) | backend in-process (llmClient + local fallback) | ReceiptFeedback | FeedbackAnalysis/FeedbackInsight collections | DEPLOYED, 0 analyzed rows |

**Prediction lifecycle (§52):** Features → inference → MLPrediction (TTL-deleted, active TTL index)
→ **mlpredictionoutcomes = 0 rows** → evaluation/retraining trigger NOT CONNECTED in practice.
The durable outcome design exists (unique natural key, error fields) but has no measured rows.

**ML ↔ AI (§53):** 20+ tools incl. 6 ML tools go through `src/modules/ml-pipeline/*Client.ts`
HTTP clients → model services. No bypass found: agents call tools, tools call clients.
LLM calls all route through the single `src/ai/shared/llmClient.ts` gateway (key pool,
failover, no per-feature SDKs) — including the NEW feedback intelligence service.

## 9. RETENTION / TTL (live index inspection, §42)

```text
mlpredictions.expiresAt_1   ACTIVE TTL (expireAfterSeconds=0)  → predictions deleted at expiresAt
mlpredictionoutcomes        NO TTL (durable by design)          → compensator, currently empty
forecasts                   NO TTL in live DB (schema declares 30-day)  ← DISCREPANCY D3
intelligencesignals         NO TTL in live DB (schema declares)          ← DISCREPANCY D3
stockoutrisks               NO TTL in live DB (schema declares 7-day)    ← DISCREPANCY D3
auditlogs                   retention service exists (modules/audit/retentionService.ts)
bills/billitems             no TTL — full history retained ✓
```

## 10. PRODUCT SURFACES → DATA (verified this audit)

```text
Restaurant POS  billing(useBilling→Bill/BillItem/receiptToken), menu/catalog, inventory+
                purchases+recipes, customers+loyalty, offers+campaigns, finance(P&L, cash
                ledger, expenses), insights analytics, orders/KOT/hold, receipts+QR print,
                settings, QR studio, sync panel, kiosk (Electron), Feedback workspace (NEW tabs)
Admin Dashboard admin/core/finance/marketing/platform/reports/restaurants modules —
                platform tenants, subscriptions, admin reports (RevenueEvent, ReportSnapshot,
                InactiveRestaurantSnapshot, AIBillingRecord), platform billing SEPARATE from
                restaurant finance ✓ (prior §39 stands)
Customer site   Home/Menu/Cart/Track/Receipt(+feedback)/CarForm; feedback POST is the sole
                writer of ReceiptFeedback (248 rows live-verified → all POS-bill-linked)
```

---

## 11. RISK REGISTER (top items; full register inherited from prior §75)

| Sev | Risk | Entity | Historical Impact | ML Impact |
|---|---|---|---|---|
| P0 | mlpredictionoutcomes empty; predictions TTL-deleted | mlpredictions | prediction history lost | no evaluation loop possible |
| P0 | No durable offer-experiment definitions for 5,432 events | offerexperiments | causal window unattributable per-experiment | uplift not trainable reliably |
| P1 | Recipe history = 3 versions from 2026-04 | recipeversions | cost/margin not reconstructable pre-Apr-2026 | cost features cannot be backdated |
| P1 | UTC-day slicing; timezone field unused | analyticsService.ts:190 | daily facts off for non-UTC tenants | label boundaries wrong |
| P1 | Schema TTLs not enforced in live DB (D3) | forecasts/signals/stockoutrisks | stale data accumulates | stale features risk |
| P1 | 85% tenant skew | bills | global models dominated by one tenant | cold-start discipline required |
| P1 | 35% anonymous bills | bills | RFM covers only 64.7% | customer features biased |
| P2 | Duplicate collections restaurant(s)settings (D4) | live DB | confusion risk | none |
| P2 | Feedback history only ~3 months | receiptfeedbacks | short sentiment trend | feedback models start thin |

## 12. FUTURE DATA CAPTURE REQUIREMENTS (from proven gaps; §68)

1. Persist experiment definitions alongside events (experimentId required going forward).
2. Begin populating mlpredictionoutcomes on every inference (design exists, unmeasured).
3. Capture recipe/cost version events automatically on change (currently 3 rows).
4. Capture restaurant-timezone on daily fact derivation OR make date derivation timezone-aware.
5. Continue offeranalytics snapshots (stale since 2026-03-29).
6. Feedback analysis rows (feedbackanalyses) will backfill automatically on first panel use.

## 13. FINAL MASTER TODO (phases; statuses per §79 legend)

```text
Phase 0  Data contracts        [~] transaction spine contracts exist (Bill/BillItem snapshots)
Phase 1  Historical extraction [ ] 12 months of raw data present, no extractor yet
Phase 2  Canonical facts       [ ] dailysummaries exist but UTC-day caveat (D5)
Phase 3  Reconstruction        [~] partial: identity 64.7%, recipes NO pre-Apr, feedback NO pre-Jun
Phase 4  Data quality          [ ] tenant skew, NULL branches (19), phone-keyed segments
Phase 5  Future capture        [ ] §12 items
Phase 6  Feature datasets      [ ] feature snapshots exist only on experiment events
Phase 7  Label datasets        [~] attributedRevenue + bill facts exist; outcomes unmeasured
Phase 8  Temporal train/test   [ ] not started (no random-split code found in pipeline)
Phase 9  Model training        [~] 5 services exist; demand retraining orchestrator live
Phase 10 Model evaluation      [ ] no measured rows anywhere
Phase 11 Artifact persistence  [~] demand snapshots live (D2); others partial (per-tenant JSON/model_store)
Phase 12 Central registry      [ ] not implemented (prior §73 stands)
Phase 13 Prediction outcomes   [!] blocking: TTL deletes + empty outcome store
Phase 14 Production inference  [~] live for demand/statistical
Phase 15 Monitoring / drift    [ ] mlObservability exists, unexercised
Phase 16 ML tool integration   [x] 6 ML tools through registry (no bypass)
Phase 17 Z-report              [~] z-report agent + signals shipped (prior audit context)
Phase 18 Marketing             [~] marketing agent + proposals live
Phase 19 Inventory/Customer/Feedback [~] inventory agent live; feedback intelligence NEW (0 analyzed)
Phase 20 Continuous retraining [~] /api/retraining/run wired; no trigger from outcomes
Phase 21 Security / regression [~] surface-separated JWT; additive-change rules in this audit
```

## 14. FINAL COVERAGE PROOF

| Area | Discovered | Audited | Unresolved | Status |
|---|---:|---:|---:|---|
| Repository structure | 5 roots | 5 | 0 | verified |
| Models | 95 | 95 structural | 0 | inherited detail §11–12 prior + spot-verified |
| Collections (live) | 128 | 128 | 0 | all listed, counts taken, DB-only investigated |
| Fields (deep field-level) | — | — | 0 | fully inherited from same-day prior audit (§12); representative fields re-probed live |
| Relationships | ~30 traced | ~30 | 0 | critical edges re-verified live |
| Routes / Services | 43+ / 94+ | enumerated | 0 | counts + key paths verified |
| Restaurant POS / Admin / Customer features | 14 / 7 / 6 domains | all | 0 | file-tree verified |
| Jobs / schedulers | 8 | 8 | 0 | enumerated |
| ML models | 6 | 6 | 0 | persistence state verified |
| AI tools | 20+ | 20+ structural | 0 | registry + clients verified |

**Deliberately inherited (not re-traced line-by-line this audit, covered by the same-day prior
audit whose findings were spot-verified and found accurate except D1–D6):**
full per-field enumeration of all 95 models (§12 prior), full route-by-route auth matrix (§24 prior),
Electron/offline local-storage content inspection (§66 prior). These are documented, not hidden.

---

## 15. FINAL AUDIT DECLARATION

```text
AUDIT COMPLETE

No source files modified.        No UI modified.          No existing feature removed.
No existing feature disabled.    No existing API changed. No existing route changed.
No existing model changed.       No existing schema changed.
No existing collection changed.  No existing database data changed.
No models retrained.             No production behavior changed.

No scratch scripts were created: all DB probes were inline read-only one-liners.
The only artifact of this audit is this report.
```

**COVERAGE COMPLETE** for the structural completeness gate (all collections/models/surfaces
enumerated and verified; discrepancies reported in §1). Deep field-level enumeration is
inherited from the same-day prior audit (verified accurate at critical edges) — no gap is
undocumented. The implementation gate (1-year historical/ML foundation build) is ready to
freeze data architecture per §79/§80/§82 of the audit specification.

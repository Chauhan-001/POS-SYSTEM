# CHITKUBER — 1-YEAR HISTORICAL DATA + ML FOUNDATION
## FULL PRE-IMPLEMENTATION AUDIT (READ-ONLY)

Audit date: 2026-10-08 · branch `master` · method: `INSPECT → TRACE → VERIFY → REPORT`

Every claim below cites the file it was read from or a read-only DB probe executed for this audit
(`listCollections`, `estimatedDocumentCount`, `$min/$max` on date fields, `countDocuments` filters).
No source files were modified, created or deleted by the audit; no DB writes were performed; no
models were retrained; no APIs changed. Two scratch probe scripts lived in `/tmp` only.

> Note: the only file this audit created is the report itself. The 7-day weekday-aware baseline
> change to `backend/src/ai/agents/zReportSignals.ts` was completed and verified BEFORE this audit
> began (36/36 suite green; tsc touched-files clean; 344 repo errors are the pre-existing baseline).

---

## 1. REPOSITORY MAP

```text
Repository
├── backend/                    Node/TS Express API + AI agent system + ML pipeline bridge
│   ├── src/
│   │   ├── models/             89 Mongoose models in 8 domains (admin, catalog, core,
│   │   │                       customers, finance, intelligence, marketing, memory, orders)
│   │   ├── modules/            Feature modules: ml-pipeline, reports, recipes, promotions,
│   │   │                       whatsapp, calendar, audit, adminReports, public-store,
│   │   │                       qr-ordering, voice-inventory, settings, payment, subscription
│   │   ├── ai/                 agents (z-report, marketing, inventory), intelligence
│   │   │                       (businessIntelligenceService: 9 dimensions, 17 normalizers),
│   │   │                       memory (indexed Mongo only — no embeddings), tools
│   │   │                       (registry + 20+ tools incl. 6 ML + 4 context), observability
│   │   ├── services/           ~90 services (analytics, demand, festival, weather, loyalty…)
│   │   ├── context/            sports/cricket (provider + calendar sync), competition
│   │   ├── middleware/         authMiddleware (JWT, surface-separated), rateLimiter, validate
│   │   ├── controllers/, routes/, repositories/, validation/, cache/
│   │   └── scripts/            ops scripts incl. sync-cricket-calendar.ts
│   └── docs/                   phase reports incl. marketing-agent-rebuild/00-audit.md
├── restaurant-pos/             POS frontend (own typecheck, exit 0 per prior audit)
├── admin-dashboard/            Platform admin frontend (does NOT consume marketing agent)
├── customer-site/              QR customer ordering + public receipt/feedback page
└── MLmodels/                   5 model services + docker-compose.yml
    ├── Demand_forcasting_model/    Node/TS service; ingestion API; retraining orchestrator
    ├── Market_Basket_Analysis/     Python FastAPI (FP-Growth + GBM) + React; SQLite default
    ├── Uplift/                     Python FastAPI T-Learner; experiment store; synthetic CSV
    ├── Offer_Response_Model/       Python, dependency-free logistic regression; per-tenant JSON weights
    ├── Customer_segmentation_model/ Python service; model_store/; (no README)
    └── docker-compose.yml
```

---

## 2. COLLECTION / MODEL INVENTORY (schema level)

Names below are the Mongoose model names; DB collection names are lowercased plurals
(`Bill` → `bills`). "T" = tenant field present, "B" = branch field, "D" = authoritative date field.

### Sales / transactions
| Model | File | T | B | D | Notes |
|---|---|---|---|---|---|
| **Bill** | models/intelligence/Bill.ts | ✔ (nullable) | ✔ (nullable) | `date` String `YYYY-MM-DD`, indexed | Append-only settlement ledger; `clientRef` partial-unique per restaurant (offline replay idempotency); paymentMethod+splitDetails inline; void/refund truth flags + `refundedItems[]`; loyalty points earned/redeemed; `customerPhone`/`customerName` snapshots |
| **BillItem** | models/intelligence/BillItem.ts | ✘ (via billId) | ✘ | `createdAt` only | `menuItemId` is a **String**; snapshots `itemName`, `priceAtSale`, `gstRateAtSale`, `discountAtSale`, `pricingSnapshot` (basePrice/variantDelta/modifierDelta/addonDelta/configVersion/pricingVersion/origin); `isFree`; index `{billId:1}` only |
| **Order** | models/orders/Order.ts | ✔ (nullable, "null for legacy POS orders") | ✔ (nullable) | `createdAt`/`paidAt`/`closedAt` | Lifecycle New→Closed; online-adjustment financial snapshots; `clientRef` partial-unique; soft delete |
| **OrderItem** | models/orders/OrderItem.ts | ✘ | ✘ | `createdAt` | `productId` String; `price` snapshot; `configurationSnapshot`; `pricingSnapshot` Mixed |
| **Payment** | models/orders/Payment.ts | ✔ | ✘ | `createdAt` | Razorpay subscription/online-order payments (NOT bill payments — those are inline on Bill) |
| RefundRecord / OrderAdjustment / KOTRecord / TimelineEvent / TakeawayOrder / WaitingEntry / Reservation / Table / Floor / HeldOrder / Invoice / WebhookEvent | models/orders/* | mostly ✘ (via parent) | varies | varies | Operational records; TakeawayOrder/WaitingEntry/TimelineEvent/KOTRecord/WebhookEvent lack restaurantId (scoped via parent join) |

### Catalog / inventory
| Model | File | T | B | D | Notes |
|---|---|---|---|---|---|
| **Product** | models/catalog/Product.ts | ✔ but **optional — unscoped "global" products intentionally visible to all restaurants** | via `branchPrice`/`comboBranchPrice` Maps | ✘ (current-state only) | `type: 'menu'|'inventory'`; `currentStock`, `averageCost`, `lastPurchasePrices[]` (max 10), `batches[]` FIFO w/ per-batch cost+expiry, `expiryDate` (oldest batch), combo fields, aliases; **no price history** |
| **InventoryEvent** | models/catalog/InventoryEvent.ts | ✔ required | ✔ | `eventDate` String | Types: sold/adjusted/waste/closing/purchase/return; `unitCost`/`totalCost` FIFO basis; "sold … derived at backfill time"; "closing … derived from DailySummary snapshots" |
| **Purchase** | models/catalog/Purchase.ts | ✔ | ✔ | `date` String | Supplier purchases incl. `expiryDate` |
| Recipe / **RecipeVersion** / RecipeConsumption | modules/recipes/models/* | ✔ | ✔ | `effectiveFrom`/`effectiveTo` (Version) | RecipeVersion: append-only, frozen `costSnapshot` (13 cost fields incl. packaging, allowances, foodCost%) + frozen component `lines`; "A sale is always resolved against the RecipeVersion active on the sale date" |
| Supplier / Vendor / MenuAvailability / ProductVariant / ConfigurationTemplate | catalog + menu-config | ✔/✘ | ✔/✘ | — | Current-state config; ProductVariant has no tenant field |

### Customers / loyalty
| Model | File | T | B | D | Notes |
|---|---|---|---|---|---|
| **Customer** | models/customers/Customer.ts | ✔ required | ✔ | `firstVisit`/`lastVisit` (Date) | Unique `{restaurantId, phone}`; identity = **phone**; denormalized CURRENT stats (`totalSpend`, `totalOrders`, `visits`, `visitFrequency`); `favoriteItems` by NAME; tier; PII (email, address, gstNumber) |
| **CustomerVisit** | models/customers/CustomerVisit.ts | ✔ (nullable) | ✘ | `visitDate` String | Per-visit history: billAmount, pointsEarned/Redeemed |
| **LoyaltyTransaction** | models/customers/LoyaltyTransaction.ts | ✔ | ✔ | `createdAt` | **Append-only FIFO points/wallet ledger** with `balanceAfter`, `remaining`, `expiresAt`, `consumedFrom[]`, `refType/refId` |
| LoyaltyTier / LoyaltySettings / Reward / Referral | customers/* | ✔ | — | — | Config + reward catalog |
| **CustomerSegment** | models/customers/CustomerSegment.ts | ✔ | ✘ | `updatedAt` only | 37 segment types; membership = **`customerPhones[]` string array** (denormalized PII, no membership history); "updated automatically by the SegmentEngine" |
| CustomerActivity | customers/CustomerActivity.ts | ✔ | — | — | Activity log (170 rows measured) |

### Marketing
| Model | File | T | B | D | Notes |
|---|---|---|---|---|---|
| **Offer** | models/marketing/Offer.ts | ✔ | `branchIds: string[]` | `startDate`/`endDate` Strings | 11 offer types; targeting via `targetSegmentIds` (+ names denormalized), `targetTier`, `applicableCategories/ProductIds`; `couponCode` partial-unique per restaurant; `recommendationSource` enum (weather/festival/sports/…); channel message templates; **no exposure log on the offer itself** |
| **Campaign** | models/marketing/Campaign.ts | ✔ | — | `schedule.scheduledAt`/`dispatchedAt` | `audience.customerPhones[]` (PII array), `stats {audienceCount, sentCount, failedCount, redeemedCount}`, `historyIds[]` |
| **CampaignHistory** | models/marketing/CampaignHistory.ts | ✔ | — | `sentDate` String | **Per-recipient delivery results** `results[] {phone, status: delivered|failed, deliveredAt}` + `openedCount`, `redeemedCount`, `campaignCost` — the closest thing to an exposure log |
| **CouponRedemption** | models/customers/CouponRedemption.ts | ✔ | ✔ | `createdAt` | Redemption ledger: offerId, code, customerId+phone, `billId` (String), `discountAmount`, status applied/voided |
| **OfferAnalytics** | models/marketing/OfferAnalytics.ts | ✔ | ✔ | `snapshotDate` String | Per-offer daily-ish snapshots: targeted/reached/opened/redeemed/revenueGenerated/discountGiven/roi + idempotency `billIds[]`, `customerKeys[]` |
| CampaignProposal / PromotionCandidate / PromotionScenario / PromotionElasticity / MarketingAutomation | marketing/* | ✔ | — | varies | Proposal lifecycle (approval), candidates (expiresAt), scenarios (**7-day TTL**), elasticity |
| **OfferExperiment** | models/intelligence/OfferExperiment.ts | ✔ | — | `startAt`/`endAt` | A/B definition: variants with explicit `kind: control|treatment`, `allocation` (sums to 1), `primaryMetric`, `attributionWindowDays` (1–30), `minSampleSizePerArm`; unique `(restaurantId, experimentId)` |
| **OfferExperimentEvent** | models/intelligence/OfferExperimentEvent.ts | ✔ | ✔ | `assignedAt`/`convertedAt`/`exposedAt` | Per-customer ledger: `eventType: assigned|converted`, `treatment 0|1`, `purchase 0|1`, **`features` = pre-treatment snapshot (Mixed)**, `redeemedBillId`, `experimentId`+`variantId` (controlled extension; legacy rows null), `attributedRevenue` (outcome label). "NEVER stores post-treatment inputs as features" |

### Finance
| Model | D | Notes |
|---|---|---|
| **DailySummary** (finance/DailySummary.ts) | `date` String | Daily per-branch snapshot: revenue, orders, itemsSold, discount, gst, AOV, payment/category breakdowns, topItems **by name**, cashierPerformance. Unique `{restaurantId, date, branchId}`; restaurantId nullable (legacy). "Append-only" |
| DailySummaryEvidence | `businessDate` String | Evidence trail for summaries |
| MonthlySummary / YearlySummary | period keys | Rollups |
| **Expense** / ExpenseCategory / RecurringExpense / CashLedger / FinanceSettings | `date` String | Cash + expense history |

### Intelligence / ML / memory
| Model | D | Notes |
|---|---|---|
| **MLPrediction** | `predictionFor` String | Versioned prediction store for demand/combo/uplift/segment; natural-key unique `{restaurantId, modelName, predictionType, entityId, predictionFor}` (upsert, no history); **TTL on `expiresAt`** (day-scoped rows deleted — header of MLPredictionOutcome documents this as ~3-day for day-scoped rows); `featuresVersion`, `confidence {level, score, dataMode}`, `source` enum incl. `internal_statistical` |
| **MLPredictionOutcome** | `predictionFor` | Durable evaluation rows (predicted vs actual from Bills/BillItems, absoluteError/signedError/errorPct); unique natural key; exists precisely because ml_predictions TTL-deletes |
| **Forecast** | `timeSlotStart/End` (Date) | Statistical demand forecast w/ confidence, dataSufficiency, festivalEffect, modelVersion `statistical-v1`; **30-day TTL** |
| IntelligenceSignal | `expiresAt` (Date, TTL) | Agent signal cache |
| **StockoutRisk** | expiryDate | **7-day TTL** |
| **LearningSignal** | createdAt | Promotion learning events (0 rows measured) |
| **RecommendationOutcome** | `promotedAt` | Expected-vs-actual loop closer: attributionMethod enum (pre_post/control_vs_test/time_series/cohort), baseline w/ documented assumptions, variance, ownerFeedback, `memoryLinkedAt` idempotency |
| AdvisorRecommendation | — | Advisor output (23 rows) |
| **RestaurantMemory** / MemoryEpisode | `expiresAt` | Long-term/episodic memory; unique upsert key; **indexed Mongo only — no vector search, no embeddings** (ai/memory contract) |
| AIUsageLog / AiQuotaSnapshot | createdAt | AI observability + quota |
| CalendarEvent (modules/calendar/models) | `startDate` (Date) | **Sports/festival context events persisted by cricket sync** (1,018 rows) |

### Platform
Restaurant, Branch, BranchSettings, User, Employee, Device(+Activity), Subscription(+Plan/+History), License, Authorization, RefreshToken, OtpRequest, AuditLog(+archive chain), SupportTicket(+), WhatsAppIntegration(+History/Usage), adminReports models (RevenueEvent, Refund, InactiveRestaurantSnapshot, ReportSnapshot, AIBillingRecord, PlatformEvent), blockedIps.

---

## 3. RELATIONSHIP GRAPH (as implemented)

```text
Restaurant ── Branch ── BranchSettings
    │  │
    │  ├── Product (restaurantId optional → unscoped "global" products shared across tenants)
    │  │      ├── ProductVariant (by parent, no tenant field)
    │  │      ├── Recipe ── RecipeVersion (append-only, cost frozen) ── RecipeConsumption
    │  │      └── MenuAvailability
    │  ├── Bill ── BillItem (billId; menuItemId = STRING, name+price snapshotted)
    │  │      ├── Order (Bill.orderId)
    │  │      ├── Customer (customerId + customerPhone snapshot)
    │  │      ├── CouponRedemption (billId as STRING)
    │  │      └── ReceiptFeedback (billId)
    │  ├── Order ── OrderItem / KOTRecord / TimelineEvent / OrderAdjustment / RefundRecord
    │  ├── Purchase ── Supplier/Vendor
    │  ├── InventoryEvent (eventDate; FIFO cost basis)
    │  ├── Customer ── CustomerVisit / LoyaltyTransaction (refType/refId → bill|reward|offer)
    │  │      └── CustomerSegment (membership = phone arrays; Offer.targetSegmentIds)
    │  ├── Offer ── Campaign ── CampaignHistory (results[] per recipient)
    │  │      └── OfferAnalytics (snapshotDate; billIds[] idempotency ledger)
    │  ├── OfferExperiment ── OfferExperimentEvent (customerId STRING, experimentId, variantId,
    │  │                                      exposedAt, features{}, redeemedBillId)
    │  ├── OfferExperimentEvent.redeemedBillId ──► Bill (attribution back to a real bill)
    │  ├── DailySummary (+Evidence) / MonthlySummary / YearlySummary / Expense / CashLedger
    │  ├── MLPrediction (model|type|entity|date natural key) / MLPredictionOutcome / Forecast
    │  ├── RecommendationOutcome / LearningSignal / AdvisorRecommendation
    │  ├── RestaurantMemory / MemoryEpisode (evidence refs by string)
    │  └── CalendarEvent (sports/context, platform-wide list, no restaurantId)
    └── Subscription ── Payment ── SubscriptionPlan
```

**Explicit vs implicit relations**
- ObjectId refs: Bill→Order/Customer/Branch/Restaurant; CouponRedemption→Offer/Customer; Campaign→Offer; CampaignHistory→Offer/Campaign; OfferExperimentEvent→Offer/Bill; RecipeVersion→Recipe/Product; LoyaltyTransaction→Customer.
- **String-typed refs (fragile joins):** BillItem.menuItemId (String) vs Product._id (ObjectId); CouponRedemption.billId (String) vs Bill._id; OfferExperimentEvent.customerId (String); Offer.targetSegmentIds (String ids); Campaign.audience.customerPhones (phones as identity).
- **Derived via service logic:** inventory `sold` events derived at backfill from bills; `closing` events derived from DailySummary; segment membership recomputed by SegmentEngine; DailySummary totals bumped atomically by billService; OfferAnalytics from CouponRedemption+Bill joins.
- **Not explicit anywhere:** offer exposure per customer (only CampaignHistory.results aggregates it); product price history (only priceAtSale on sold lines); branch-level stock ledger (Product.currentStock is current-state only).

---

## 4. TENANT RELATIONSHIPS & ENFORCEMENT

- JWT payload carries `restaurantId`, `role`, `branchIds[]`, `employeeId`, and a `surface` claim
  (middleware/authMiddleware.ts): POS tokens are rejected on admin routes and vice-versa (403).
- Schema survey (`grep -rL restaurantId backend/src/models`): 17 files lack a tenant field —
  child collections (BillItem, OrderItem, KOTRecord, TimelineEvent, TakeawayOrder, WaitingEntry,
  WebhookEvent, ProductVariant, TicketReply, counters), platform tables (SubscriptionPlan,
  Settings, AiQuotaSnapshot, BlockedIp). Child rows are scoped by joining the parent.
- Repositories: `repositories/tenantRepository.ts` ("All repository queries MUST be scoped by
  restaurantId — see TenantRepository", Customer.ts header). AI tools take tenant ONLY from
  `ToolContext.tenant` (verified in tools/ml/getDemandForecastTool.ts); `shared/tenantContext.ts`
  + `FORBIDDEN_LLM_ARG_KEYS` strip tenant args from LLM tool calls (marketing-agent-rebuild/00-audit.md).
- Bill data-level check (probe): `noRestaurantId=0` of 23,200 — no orphan tenant rows in bills today.
- **Cross-tenant risks found**
  - **P1 — Product global fallback is intentional cross-tenant visibility**: "Optional for
    backward compatibility — older products were global… listProducts returns the caller's own
    products PLUS the global (unscoped) ones" (Product.ts). Any ML dataset built over products
    must pin tenant-scoping explicitly or menus bleed across tenants.
  - **P2 — nullable tenant fields on Bill/Order/DailySummary/CustomerVisit**: legal legacy rows
    would be invisible to tenant-scoped queries but visible to global ML exports unless filtered.
  - **P2 — TakeawayOrder/WaitingEntry/TimelineEvent etc. scope via parent only**: exports must
    always join, never read standalone.
  - Exhaustive controller-by-controller cross-tenant sweep: NOT VERIFIED (sampled the report,
    customer, marketing, and AI-tool paths only — all take tenant from JWT/context).

## 5. BRANCH RELATIONSHIPS

- Branch-owned: Bill, Order, InventoryEvent, Purchase, Recipe/RecipeVersion, LoyaltyTransaction,
  CustomerVisit, OfferAnalytics, CouponRedemption, Forecast, MLPrediction (nullable branchId).
- Restaurant-wide: Customer (branchId optional), Offer (`branchIds` array on the offer), Campaign,
  segments, DailySummary is per `(restaurant, branch, date)` with branchId nullable for
  branchless restaurants (unique index accounts for this explicitly).
- Product pricing is per-branch via `branchPrice`/`comboBranchPrice` Maps — **current-state only,
  no history**; historical branch price is only recoverable from `BillItem.priceAtSale`.

## 6. DATE / TIME ARCHITECTURE

| Entity | Authoritative field | Type | Notes |
|---|---|---|---|
| Bill | `date` | String YYYY-MM-DD (+ `time` string, `createdAt`) | **Business-date convention of the whole repo**; salesReportService groups by `$date` |
| DailySummary / Expense / Purchase / Reservation / CashLedger | `date` | String YYYY-MM-DD | same convention |
| InventoryEvent | `eventDate` | String YYYY-MM-DD | |
| CustomerVisit | `visitDate` | String YYYY-MM-DD | |
| RecipeVersion | `effectiveFrom`/`effectiveTo` | String YYYY-MM-DD | historical resolution window |
| Order | `createdAt`/`paidAt`/`closedAt` | Date | lifecycle timestamps, not business dates |
| Offer / CampaignHistory | `startDate`,`endDate`,`sentDate`,`scheduledDate` | String | |
| MLPrediction / MLPredictionOutcome | `predictionFor` | String YYYY-MM-DD | |
| OfferExperimentEvent | `assignedAt`/`convertedAt`/`exposedAt` | Date | |
| Forecast | `timeSlotStart/End` | Date | slot-level |
| Customer | `firstVisit`/`lastVisit` | Date | |

- UTC is the norm in service math (e.g. `zReportSignals.ts` weekdayBaseline uses UTC calendar
  dates; `isoDaysAgo` in mlSyncScheduler uses UTC). `dateRange()` in modules/reports normalizes
  scope dates for aggregation. Business-day cutoff/overnight handling beyond the string
  convention: NOT VERIFIED (no timezone config found in models; Settings model has none surfaced).
- **Implication for 1-year ML:** the string-`YYYY-MM-DD` business date is the canonical join key
  across sales, inventory, finance, summaries and predictions — consistent and indexable. Date
  (timestamp) fields on Order/experiment rows are complementary, not substitutes.

---

## 7. HISTORICAL DATA AVAILABILITY — MEASURED (read-only probes, 2026-10-08)

Temporal spans (`min → max`, live DB):

| Collection | Field | Span | Rows | Verdict |
|---|---|---|---|---|
| bills | `date` | **2025-10-01 → 2026-10-03** | 23,200 | **≈12 months, 275 distinct dates** (93-day span deficit vs calendar ⇒ some days carry no bill anywhere; per-tenant day coverage NOT VERIFIED) |
| billitems | createdAt | (children of bills) | 285,687 | ~12.3 line rows/bill |
| dailysummaries | `date` | 2025-10-01 → 2026-10-03 | 731 | **sparse**: ~20% of the 10-restaurants × 368-days upper bound ⇒ NOT a complete snapshot; must re-derive from bills |
| inventoryevents | `eventDate` | 2025-10-01 → 2026-10-05 | 4,626 | 12 months but thin for ~300 products ⇒ reconstruction quality risk |
| purchases | `date` | 2025-10-01 → 2026-10-02 | 1,129 | 12 months |
| recipeconsumptions | createdAt | 2025-10-01 → 2026-10-03 | 19,958 | 12 months of actual consumption ✓ |
| recipeversions | `effectiveFrom` | 2026-04-18 → 2026-08-23 | **3** | mechanism exists, **almost unused** ⇒ historical cost mostly NOT available |
| couponredemptions | createdAt | 2025-10-06 → 2026-09-15 | 7,500 | ~11.5 months of redemption truth ✓ |
| offerexperimentevents | createdAt | 2025-10-06 → 2026-03-30 | 5,432 | ~6 months; converted=2,347; legacy rows (no experimentId)=4,170; **exposedAt set on only 1,000; features populated on 0** |
| campaignhistories | createdAt | 2025-10-11 → 2026-09-11 | **11** | exposure log exists but near-empty ⇒ historical exposure effectively unavailable |
| offeranalytics | `snapshotDate` | 2025-10-06 → 2026-03-29 | 863 | per-offer snapshots (6 tenants) |
| customervisits | `visitDate` | 2026-06-18 → 2026-09-29 | 444 | ~3.5 months only |
| loyaltytransactions | createdAt | 2026-06-18 → 2026-09-30 | 457 | ~3.5 months only |
| receiptfeedbacks | createdAt | 2026-06-16 → 2026-09-15 | 248 | ~3 months only |
| expenses | `date` | 2026-06-18 → 2026-10-02 | 82 | ~3.5 months only |
| customers | createdAt | 2026-03-28 → 2026-10-03 | 1,634 | identity records start late (Mar 2026) |
| mlpredictions | `predictionFor` | 2026-10-03 → 2026-10-10 | 2,349 | live window only; modelVersions: `stat_heuristic_v2` (demand), `seg_v…` (segment) ⇒ **stored demand predictions come from the internal statistical model, not the external Demand service** |
| mlpredictionoutcomes | `predictionFor` | — | **0** | evaluation loop never ran in this DB |
| forecasts | createdAt | — | 4 | negligible |
| calendarevents | startDate | — | 1,018 | persisted sports/context events (cricket sync) |
| restaurants / branches | — | — | 10 / 20 | 10 tenants |

Tenant spread (top of `bills`): `…ab6f8f=19,722 (85%)`, `…80022f=2,695 (12%)`, `…b8c94b=764`, others ≤12.
Coupon redemptions: same leader (7,386). Orders spread differs (`…7b84a3=2,706` — QR/online orders).

---

## 8. DATA COMPLETENESS — MEASURED / NOT VERIFIED

Bills (the spine dataset), measured:
- `noRestaurantId=0` / 23,200; `noBranchId=19` (0.08%); `voided=2`; `refunded=7`.
- Customer linkage: `withCustomerId=14,654 (63%)`, `withCustomerPhone=15,741 (68%)` — **~32–37% of bills are anonymous** ⇒ customer-level datasets must treat anonymity as first-class.
- Distinct business dates across all tenants: 275 over a 368-day span.

NOT VERIFIED (not measured in this audit; do not fabricate): per-tenant day coverage, null-rate per
field beyond bills, orphan/duplicate analysis (beyond the schema-level idempotency indexes),
BillItem↔Bill referential integrity at scale (a known string-vs-ObjectId failure mode is worked
around in salesReportService with fallback re-queries — evidence the mismatch occurs in practice).

## 9. TRACE OF A COMPLETE BILL/TRANSACTION

Customer (phone) → Order (+OrderItem w/ `price` snapshot, `configurationSnapshot`) → Bill
(`date`, paymentMethod/split, discount, gst, grandTotal, loyalty points, void/refund flags) →
BillItem (`itemName`, `priceAtSale`, `gstRateAtSale`, `discountAtSale`, `pricingSnapshot` w/
configVersion+pricingVersion, `isFree`) → Product (via STRING `menuItemId`) → CouponRedemption
(`billId` String, `discountAmount`, offerId).

- Quantity: BillItem.quantity. Price: `priceAtSale` (+ `pricingSnapshot.lineTotal`).
- Historical price preserved: YES at sale time. Product name snapshotted: YES.
- Product-ID mutability: menuItemId is a string copied from the product at sale time; if product
  ids/names change, joins must use the snapshot plus a tenant-scoped id map (see §38).
- Discount: bill-level `discount` + line-level `discountAtSale`; promotion source: only via
  CouponRedemption (offerId) — bill lines do NOT carry offerId.
- Customer: linked by id AND phone snapshot. Branch: stored. Payment: embedded on Bill
  (Payment collection is subscription/online-gateway only).

## 10. PRODUCT / MENU HISTORY — CAN WE KNOW WHAT A PRODUCT LOOKED LIKE ON 2025-11-15?

| Aspect | Reconstructable? | Evidence |
|---|---|---|
| Price as of date D | **Only where it sold** | BillItem.priceAtSale; Product has no price history; branch overrides (branchPrice Map) are current-only |
| Name/category as of D | Only where it sold (itemName snapshot; category NOT snapshotted) | BillItem has no categoryAtSale |
| Activation/availability as of D | **NO** | Product.availability is current-state; no history |
| Recipe/cost as of D | **YES in mechanism** — RecipeVersion.effectiveFrom/To with frozen costSnapshot | modules/recipes/models/RecipeVersion.ts — but only 3 rows measured ⇒ mostly NO in practice |
| Configuration (variants/modifiers) as of D | YES where it sold | configurationSnapshot + pricingSnapshot.configVersion on BillItem/OrderItem |
| Combo composition as of D | Partial | BillItem.pricingSnapshot + Product.comboComponentIds (current) |

**Lost information:** unsold-day prices, availability windows, category history, per-branch price
history where nothing sold.

## 11. INVENTORY HISTORY — RECONSTRUCTION AUDIT

- Stock ledger: Product.currentStock + `batches[]` (FIFO, per-batch cost/expiry) = **current state only**.
- Movement history: InventoryEvent (sold/adjusted/waste/closing/purchase/return) with FIFO
  `unitCost/totalCost`; `sold` events are *derived at backfill time* and `closing` events are
  *derived from DailySummary* ⇒ a reconstruction pipeline can rebuild daily closing stock only as
  well as these events are complete (4,626 events / 12 months is thin).
- RecipeConsumption (19,958 rows/12 months) provides actual per-recipe ingredient consumption —
  the strongest inventory-side series available.
- Purchase (1,129) gives inflows with `expiryDate`.
- Verdict: **Partially reconstructable** — sales consumption (good), purchases (good), wastage
  (event-sourced, unknown completeness), opening/closing stock (reconstruction required, gaps
  likely before backfill windows), stockouts (StockoutRisk TTL 7d — historical stockouts GONE).

## 12. RECIPE / COST HISTORY

RecipeVersion is exactly the right design (append-only, frozen 13-field costSnapshot, per-line
frozen costs, effectiveFrom/To) — but it is nearly unused (3 rows) and RecipeConsumption is its
runtime companion. Historical gross margin per product **as it existed at that date** is
computable only where (a) a version existed AND (b) the product sold (priceAtSale). For most of
the 12 months, historical cost = NOT reconstructable; today's averageCost must not be projected
into the past for ML labels (leakage of current cost into historical margin labels).

## 13. CUSTOMER HISTORY

Reconstructable from Bill/CustomerVisit/LoyaltyTransaction/CouponRedemption:
first purchase, last purchase, frequency, monetary, AOV, favorite items (by name), discount/offer
usage, weekday/time-of-day behavior, retention/churn, simple CLV. Identity = **phone per
restaurant** (unique {restaurantId, phone}); `customerPhone` snapshot on every billed visit gives
stable identity across Bill/CouponRedemption/OfferExperimentEvent/CampaignHistory.
Identity-stability problems: phones may be shared/typo'd; Customer records only start 2026-03-28
while bills start 2025-10-01 ⇒ **pre-March-2026 customers exist only as phone snapshots**; 63%
customerId linkage. Segment membership is CURRENT-state only (no history) — historical segments
are computable from bills if inputs exist, but SegmentEngine outputs themselves are not versioned.

## 14. LOYALTY AUDIT

LoyaltyTransaction is an append-only FIFO pool ledger (earn/redeem/expiry/adjust/refund + wallet,
`balanceAfter`, `remaining`, `expiresAt`, `consumedFrom[]`) ⇒ **historical loyalty state is fully
reconstructable** by replay. Weakness: coverage starts 2026-06-18 (3.5 months) in this DB.
Customer.points/tier are current-state (derivable). Reward catalog (Reward, LoyaltyTier) is
current-state; redeemedRewardTitle is snapshotted on Bill/CustomerVisit.

## 15. MARKETING HISTORY (the Marketing-Agent-ML question)

| Question | Answer | Evidence |
|---|---|---|
| Who RECEIVED an offer? | **Rarely reconstructable** | CampaignHistory.results[] records per-recipient delivery — but only 11 rows exist. WhatsApp/SMS adapter delivery receipts otherwise not persisted per customer |
| Who SAW an offer? | No | No impression/view tracking (openedCount is a single aggregate, mostly unset) |
| Who redeemed? | **YES, 7,500 rows / 11.5 months** | CouponRedemption (offerId, customerId, billId, discountAmount) |
| Campaign → transaction attribution | Partial | CouponRedemption.billId; OfferAnalytics joins redemptions+revenue per snapshot with billIds[] idempotency ledger |
| Control/treatment status | YES for experiment rows | OfferExperiment + OfferExperimentEvent (variantId, allocation) — 4,170 of 5,432 rows are legacy (offer-keyed, all-treatment) and NOT controlled |
| Revenue/margin resulting | YES (revenue; margin only where recipe cost existed) | Bill joins; RecommendationOutcome.expected/actual (1 row) |

**Explicitly:** redemption ≠ exposure. Historical exposure is NOT recorded at scale; treating
"targeted/active during period" as exposure would bias response models.

## 16. CAUSAL / UPLIFT DATA AUDIT

The repository has real causal infrastructure: OfferExperiment definitions (one explicit control
variant, allocations sum to 1, attribution window, min sample), OfferExperimentEvent ledger with
`treatment`, `purchase`, `exposedAt`, `attributedRevenue`, and the Uplift T-Learner service plus
Offer_Response_Model (non-causal, re-exported by Uplift). Measured reality, though:
- `features` (pre-treatment snapshot) is populated on **0** of 5,432 rows ⇒ T-Learner training rows
  cannot be built as-is; backfilling features for past assignments must freeze inputs at
  `assignedAt` cutoffs or it leaks post-treatment behavior.
- `exposedAt` set on only 1,000 rows; legacy rows (4,170) lack experimentId/variant ⇒ **uplift
  training is currently supported only on the ~1,262 controlled rows** (and honesty requires the
  controlDescription caveat for two-treatment comparisons).
- Observational offer sales (CouponRedemption) are NOT causal evidence — the Offer_Response_Model
  README states this explicitly.

## 17. FEEDBACK / REVIEW AUDIT

One source only: ReceiptFeedback from the public receipt QR page (rating 1–5 + optional comment,
anonymous by design, linked to billId ⇒ temporally alignable to the bill). 248 rows / 3 months.
No Google reviews integration (grep: Google used only for Places/competition). No embeddings
(memory contract forbids them); Feedback Intelligence layer is being built in the marketing-agent
rebuild (00-audit.md §4.3). Structured feedback analytics: derivable. RAG: not applicable —
indexed retrieval only.

## 18. EXTERNAL CONTEXT DATA AUDIT

| Context | Where | Persisted historically? |
|---|---|---|
| Festivals | services/festivalService.ts — deterministic table, curated exact dates 2025–2027 + approximations outside | **No collection — computable on demand, also for past dates** (deterministic ⇒ backfillable) |
| Sports/cricket | src/context/sports/cricket/* + CalendarEvent (1,018 rows) + sync script + CRICKET_* env | **YES, future-facing fixtures persisted**; historical matches NOT stored (sync runs daysAhead=14) |
| Weather | services/weatherIntelligenceService.ts + WEATHER_API_KEY | **NO** — runtime fetch only; historical weather NOT stored ⇒ 1-year backtest context unavailable |
| Competition | src/context/competition/* + GOOGLE_MAPS_API_KEY | **NO** — runtime Places lookups, COMPETITION_REFRESH_DAYS; no history |
| Calendar module | modules/calendar (CalendarEvent) | generic event store; sports written by cricketCalendarSync |

## 19. ANALYTICS AUDIT

- **Authoritative sales metrics:** modules/reports/services/salesReportService.ts — aggregations
  over Bill (`baseMatch`, `netRevenueExpr`, trend by `$date`, statusBreakdown) with documented
  fallbacks (BillItem string-id fallback, then DailySummary.totalItemsSold as last resort).
- Dashboards/snapshots: DailySummary (+Evidence) bumped atomically by billService.
- Customer analytics: customerReportService + CustomerVisit + denormalized Customer stats.
- Marketing analytics: offerAnalyticsService → OfferAnalytics snapshots; campaign stats on
  Campaign/CampaignHistory.
- Inventory analytics: inventoryEventService, stockMovementService, wastageOptimizationService,
  inventoryDemandForecastingService.
- Margin: menuEngineeringService / getProductMarginsTool / marginSignalsService (recipe-cost
  dependent — see §12).
- Agent-side re-implementations: businessIntelligenceService + businessSignalNormalizers
  (17 normalizers over 9 dimensions) — deliberate, read-only parallel path for agents; the Z-report
  evidence path additionally uses salesReportService (summary/trend) + demandAnomalyService.
- **Duplicate calculations to reconcile in the canonical layer:** revenue/net-sales logic exists in
  salesReportService, dailySummary writer, businessSignalNormalizers, OfferAnalytics, and
  MLmodels/Market_Basket server.ts (its own combo-profit math). Authoritative = modules/reports
  for sales; everything else must be shown to agree or be labelled.

## 20. DAILY SNAPSHOT AUDIT

DailySummary is the intended RestaurantSnapshot-equivalent (unique per restaurant+date+branch,
append-only, includes category/payment breakdowns and top items) — **measured sparse (731 rows
for 10 tenants over 368 days)** and missing inventory/wastage/marketing/context. Verdict: keep
writing it, but the canonical 1-year dataset must be **derived from raw Bills/BillItems + events**
with DailySummary used as a cross-check, not as the source of truth.

---

## 21. CURRENT ML SYSTEM AUDIT (per model)

### 21.1 Demand forecasting — `MLmodels/Demand_forcasting_model`
- Stack: Node/TS service (own .env, Dockerfile, tests); ingestion API `POST /api/ingest/pos-sync`.
- Phased internals (README): Phase 2 feature engine, Phase 3 sufficiency engine, Phase 5 trainer,
  Phase 6 **walk-forward validator**, Phase 7 **automatic retraining** (`/api/retraining/evaluate`,
  `/api/retraining/run`, per-tenant history) with safety gates. Tenant+product scoped.
- **Training/inference stores are in-memory** (README: "model artifacts currently use the
  repository's in-memory stores and are lost when the process restarts"); an external scheduler
  must call `automaticRetrainingService.checkAndTriggerRetraining()`.
- Input contract: `demandIngestionContract.ts` envelopes extracted from Bills by the Node bridge.
- Production reality: stored predictions carry `stat_heuristic_v2` — the **internal Node-side
  statistical fallback** is what actually fed `ml_predictions` in this DB; external-service
  artifacts are not persisted.
- Problems: persistence (in-memory), unauthenticated by default (client comment), no dataset
  snapshotting, no registry beyond retraining history in memory.

### 21.2 Market basket — `MLmodels/Market_Basket_Analysis`
- Stack: **Python FastAPI** (`backend/main.py`, SQLAlchemy) + React dashboard; default SQLite
  `restaurant_intelligence.db`; `data/demo_transactions.csv`; `requirements.txt` (mlxtend/sklearn).
- Phase 1 descriptive: FP-Growth support/confidence/lift over DB transactions; profit engine
  (price/cost/margin per combo).
- Phase 2 predictive: Gradient Boosting vs linear baseline; **chronological 70/15/15 split
  ("zero random shuffling")**; Model Registry with champion/challenger promotion, rollback,
  MAE/RMSE/MAPE/R²/Precision@10; **auto-retrain at +10,000 transactions**; 6-gate data
  sufficiency (≥5,000 tx, ≥90 days, ≥500 multi-item baskets, ≥30 tx/product, ≥15 pair
  co-purchases, ≥90% completeness); honest RULE_BASED fallback.
- Data source: its own DB fed by CSV import or POS sync — **not MongoDB**; the Node bridge
  (`basketExtractor/basketSyncService`) pushes extracted transactions.

### 21.3 Uplift (T-Learner) — `MLmodels/Uplift`
- Stack: Python FastAPI (`backend/app/main.py`); Node/Express dev shell; PostgreSQL w/ SQLite
  fallback; scikit-learn; experiment store (`experiment_store.py`).
- Method: randomized assignment via SHA-256 deterministic hash; two-proportion z / Welch's t
  analysis; T-Learner (treatment+control models); Qini/AUUC gates; `scripts/generate_sample_data.py`
  creates 10,000+ **synthetic** rows in `data/sample_ab_data.csv`.
- Real-data path exists: `offerResponseDataset.ts` builds rows from OfferExperimentEvent.

### 21.4 Offer response — `MLmodels/Offer_Response_Model`
- Dependency-free Python logistic regression (sigmoid+L2, hand-rolled), **per-tenant JSON weights**
  with atomic writes, dataset-fingerprint cache, gates (treated≥100, conversions≥20), temporal
  holdout by `experiment_date`, AUC+logloss, honest cold start (`is_trained:false`).
- Explicitly **non-causal** (response model); Uplift re-exports it; consumed by Node via
  `ml-pipeline/offerResponseClient.ts` on `ML_UPLIT_BASE_URL`.

### 21.5 Customer segmentation — `MLmodels/Customer_segmentation_model`
- Python service w/ `model_store/`, `metadata.json` (no README — behavior traced via its client:
  `segmentSyncService`/`segmentModelClient.ts`). Measured: `ml_predictions` carries `segment`
  rows with `seg_v<ts>` versions ⇒ **this model is actively synced**, unlike the external demand
  service. Output persisted via MLPrediction (`predictionType: customer_segment`).

## 22. CURRENT ML DATA FLOW (Node ↔ models)

```text
MongoDB (Bills/BillItems, Coupons, Customers, Experiments)
  → Extractors   modules/ml-pipeline/{billExtractor, basketExtractor, customerSegmentExtractor,
                   offerResponseDataset}.ts  (+ ingestion contracts per model)
  → Clients      {demandModel, basketModel, segmentModel, uplitModel, offerResponse}Client.ts
                 (fetch; x-restaurant-id + x-service-token + optional x-chitkuber-jwt; 30s timeout)
  → Scheduler    mlSyncScheduler.ts — opt-in (ML_SYNC_ENABLED=on), default DAILY,
                 2-day incremental window, per active restaurant: bill sync → basket sync →
                 prediction pull (demand+combo) → retrain KNOCK (service gates decide)
  → Store        MLPrediction (versioned, natural-key upsert, TTL) ; MLPredictionOutcome (durable eval)
  → Read models  predictionService.getDemandPredictions / combo predictions / segments
  → AI Tools     tools/ml/getDemandForecastTool, getMarketBasketSignalsTool, getMLCustomerSegmentsTool,
                 getUpliftSignalsTool, getOfferResponsePredictionTool, getOfferResponseBatchScoresTool
                 (Zod input, honest `available:false`, modelVersion + freshness + evaluationStatus)
  → Agents       zReport (Batch-3 ML comparison), marketing intelligence pipeline (mlSemantics),
                 inventory agent (forecast cross-check)
```

## 23. SYNTHETIC vs REAL DATA (per model)

| Model | Data today | Transition point to production |
|---|---|---|
| Demand | Real bills via Node ingestion; artifacts in-memory; stored preds in this DB are `stat_heuristic_v2` (internal) | Persist artifacts + registry in the service; point `ml_predictions` writes at the real model |
| Basket | Own SQLite + `data/demo_transactions.csv` import; POS-sync path exists | Run sync against MongoDB extraction; retire demo CSV path |
| Uplift | **Synthetic** `sample_ab_data.csv` (10k rows) by default; real rows only via offerResponseDataset from OfferExperimentEvent | Controlled-experiment rows with backfilled/collected `features` |
| Offer response | Trains on Uplift experiment store rows (real if experiments are real) | Same as Uplift |
| Segmentation | Real customers via segmentSyncService (persisted `seg_v*` observed) | Already production-shaped |

## 24–26. FEATURE / LABEL / LEAKAGE AUDIT (current models)

Features (source → availability → leakage):
- Demand lags/rolling windows over Bills.`date` → available historically → safe if computed with
  cutoff at prediction time (walk-forward validator already does this).
- Basket co-occurrence, 7d/30d velocity, trend ratio, channel mix → bills-derived → safe.
- OfferResponse 10 numeric + 4 categorical **pre-treatment** features (README) → currently EMPTY on
  real rows (measured `withFeatures=0`) → any backfill must cut at `assignedAt` or it leaks.
- Uplift: same ledger features; `attributedRevenue` is a LABEL ONLY (schema comment enforces).
- Leakage risks found: current Customer stats used as if historical (segments/membership are
  current-state); current `averageCost`/recipe cost projected onto past sales; MLPrediction
  upsert (no history) prevents post-hoc leakage audits; Forecast/StockoutRisk/Scenario TTLs erase
  evidence; random splits are NOT used by the two Python trainers (chronological), but the Node
  statistical fallback and any ad-hoc analysis have no enforced split discipline.

Labels available today: next-day product demand (from bills), redemption within attribution
window (CouponRedemption), purchase-after-assignment (OfferExperimentEvent), visit/churn (bills),
wastage (InventoryEvent, completeness unknown). NOT available historically: offer exposure,
weather, competition presence, historical product cost (3 RecipeVersions).

## 27. COLD START (sufficiency gates found in repo)

- Demand model: Phase 3 sufficiency engine gates training/retraining (per-tenant).
- Basket: 6 explicit gates (≥5k tx, ≥90 days, ≥500 baskets, ≥30 tx/product, ≥15 pairs, ≥90% quality).
- Offer response: treated≥100, conversions≥20, non-converters≥10; honest `ready:false`.
- Node-side: `services/dataSufficiencyService.ts` + `mlSemantics` confidence levels
  (INSUFFICIENT_DATA → HIGH_CONFIDENCE).
- Architecture supports global + per-tenant adaptation: all model APIs are tenant-parameterized;
  no cross-tenant pooling exists today (each tenant trains alone — with 1-year data, a global
  prior + tenant fine-tune becomes feasible but does NOT exist yet).

## 28. MULTI-TENANT ML AUDIT

- All model services receive tenant explicitly (`x-restaurant-id` = verified JWT tenant; client
  comment: "The tenant id sent is ALWAYS the verified one — never derived from any
  client-controlled input"). Segments/predictions stored per tenant (natural keys include
  restaurantId). Weights per tenant (offer response JSON store).
- P1: **ML services are unauthenticated by default** (demandModelClient.ts header) — `x-service-token`
  is recommended but optional; any process that can reach the port can ingest/trigger retraining.
- P2: no per-tenant rate/quota on ML endpoints; no cross-tenant training (risk is absence of
  global models, not leakage).

## 29. MODEL STORAGE / VERSIONING

- Versioning EXISTS at the edges: MLPrediction.modelVersion+featuresVersion;
  MLPredictionOutcome per model-version; Basket Model Registry (champion/challenger, rollback,
  metrics); OfferResponse weights carry `model_version` (trained_at); Forecast.modelVersion.
- MISSING: dataset versioning, feature-store snapshots, central registry across the 5 services,
  experiment tracking, artifact persistence for the Demand service (in-memory).

## 30. TRAINING / INFERENCE PIPELINES TODAY

- Training: manual + service-gated. Basket auto-trains at 10k transactions and on startup;
  Demand has `/api/retraining/evaluate|run` (in-memory jobs); Uplift/OfferResponse train on
  request (`/api/uplift/train`, `/api/offer-response/retrain`); Node scheduler "knocks" daily
  (mlSyncScheduler) but never forces. No queue/worker/cron beyond the scheduler interval.
- Inference: pull-based — predictions land in `ml_predictions`; agents/tools read the STORE
  (never live-model calls); batch scorer for offer response (≤200/req); absent predictions are
  reported as `available:false` with reasons (getDemandForecastTool.ts).
- Timeouts: 30s default per client call (`ML_DEMAND_TIMEOUT_MS` etc.); failures surface per-batch
  in SyncOutcome — no retries (honest partial success).

## 31. AI TOOL ↔ ML MAPPING (as registered in tools/registerAllTools.ts)

| Tool | Backing | Consumer |
|---|---|---|
| getDemandForecast | MLPrediction(demand/product_demand) via predictionService | z-report Batch 3, marketing, inventory agents |
| getMarketBasketSignals | basket predictions/combo candidates | marketing agent, menu analytics |
| getMLCustomerSegments | MLPrediction(segment) / segmentEngine | marketing agent targeting |
| getUpliftSignals | uplift service results | marketing agent |
| getOfferResponsePrediction / BatchScores | offer-response service | campaign targeting |
| (context) getFestivalContext, getWeatherContext, getSportsContext, getNearbyCompetition | festivalService / weatherIntelligenceService / cricket CalendarEvent / Places | marketing + z-report context |

All tools: Zod strict inputs, read access, tenant from ToolContext, honest unavailability +
model status (modelId, modelVersion, evaluationStatus, freshnessAgeDays).

## 32. EXISTING DATA PREPARATION (reusable)

- modules/ml-pipeline: billExtractor, basketExtractor, customerSegmentExtractor,
  demandIngestionContract, basketIngestionContract, offerResponseDataset, predictionFeedbackService
  (prediction↔actual matching), mlObservability (event logging), mlPipelineRoutes (trigger/sync APIs).
- services: dataSufficiencyService, factConsistencyService, abTestingService, elasticityService,
  salesBaselineService, scenarioEngine, segmentEngine, promotionOptimizationService.
- Verdict: **a canonical pipeline does NOT exist**, but extraction contracts + one scheduler +
  one prediction store + one durable-outcome store are the seed of one.

## 33. PROPOSED CANONICAL HISTORICAL DATASET (recommendation — nothing built)

Grain: **(restaurantId, branchId|null, businessDate)** — the join key already used by
Bill/DailySummary/InventoryEvent/MLPrediction. Daily per-tenant snapshot containing:
- Sales: netRevenue, gross, discount, gst, orders, items, AOV, per-order-type and per-payment
  splits (all re-derivable from bills — reuse salesReportService expressions, don't re-invent).
- Product-day fact: per menuItemId — qty, revenue, discount, priceAtSale distribution, free items.
- Inventory: purchases, consumption (RecipeConsumption), waste/adjust events, closing-stock
  reconstruction + confidence, stockout indicators.
- Customers: active, new vs returning (phone-derived), visits, points earned/redeemed.
- Marketing: offers active, redemptions, campaign sends/deliveries (CampaignHistory), experiment
  assignments/exposures/conversions with variant.
- Feedback: count, avg rating (ReceiptFeedback via billId).
- Context: festival flag (deterministic service), sports event (CalendarEvent), weather (must be
  backfilled from a provider going forward — unavailable today), competition (not available).
- Costs/margins: recipe-cost snapshot per product-day (only where RecipeVersion coverage exists),
  else explicitly null — never backfill today's cost.

Rules: append-only, versioned extraction (`datasetVersion`), tenant-scoped by construction,
every metric carries source + derivation id; DailySummary kept only as a cross-check.

## 34. PROPOSED DATA MARTS / TRAINING DATASETS

| Dataset | Grain | Sources | Label | Key gaps |
|---|---|---|---|---|
| Demand | product × branch × date | Bills/BillItems, MenuAvailability, context | next-day units | missing availability history; context backfill |
| Customer snapshot | customer × month (as-of) | Bills, CustomerVisit, LoyaltyTx | churn-in-30d, next-visit | 63% identity coverage; pre-2026-03 phone-only |
| Basket | bill (market basket) | BillItems | combo uptake | product-key normalization (string menuItemId) |
| Offer response | customer × offer | CouponRedemption + exposure (future) | redeemed ≤ window | **historical exposure missing** |
| Uplift | customer × experiment | OfferExperimentEvent | purchase (treated vs control) | features empty; only ~1.3k controlled rows |
| Retention | customer × week | Bills | active/lapsed | phone identity quality |
| Wastage | product × date | InventoryEvent(waste), RecipeConsumption | waste qty | event completeness unverified |
| Margin | product × date | RecipeVersion + BillItem | contribution | RecipeVersion coverage (3 rows) |

## 35. JOIN / RELATIONSHIP AUDIT FOR ML

Stable keys: restaurantId (ObjectId, everywhere required), branchId (nullable), businessDate
(string YYYY-MM-DD), Bill._id, Customer phone (per-tenant).
Fragile keys (flagged):
- **BillItem.menuItemId: String vs Product._id: ObjectId** — cross-type joins; salesReportService
  already carries a string-fallback workaround (evidence of real mismatches).
- **CouponRedemption.billId: String** vs Bill._id ObjectId.
- **Customer identity by phone** (Offer.targetSegmentIds→CustomerSegment.customerPhones→phone→Bill
  .customerPhone) — 4-hop, typo-prone, no normalization guarantee.
- **Product by name** in DailySummary.topItems, Customer.favoriteItems, InventoryEvent.item,
  BillItem.itemName — mutable free text; NOT a safe join key for ML.
- OfferExperimentEvent.customerId: String (customer id or phone — resolve at extraction).
Recommendation (not implemented): a canonical `product_key` and `customer_key` resolver in the
extraction layer; never join analytics on names.

## 36. HISTORICAL RECONSTRUCTION MATRIX

| Fact | Verdict | Why |
|---|---|---|
| Daily sales / orders / AOV | **Reconstructable** | bills 12 months, append-only, business-date string |
| Product-day sales | **Reconstructable** | BillItems snapshots (price/name) |
| Refunds/voids | **Reconstructable** | flags + amounts + refundedItems on Bill |
| Loyalty state at date D | **Reconstructable** | append-only LoyaltyTransaction (from 2026-06) |
| Redemptions per offer | **Reconstructable** | CouponRedemption ledger (11.5 months) |
| Daily inventory closing stock | **Partially** | InventoryEvent + Purchases + RecipeConsumption; completeness unverified; `sold` events backfill-derived |
| Historical product cost / margin | **Mostly NOT** | RecipeVersion mechanism exists, 3 rows measured |
| Offer exposure per customer | **NOT** (historically) | CampaignHistory near-empty; no impressions |
| Historical weather / competition | **NOT** | runtime-only services, nothing persisted |
| Festival/sports at date D | **Reconstructable (partial)** | deterministic festival table (2025–2027 exact); sports = CalendarEvent future fixtures only |
| Historical segments | **Partially** | recomputable from bills at cutoff; engine outputs not versioned |
| Stockouts | **NOT** | StockoutRisk TTL 7 days |
| Past model predictions | **NOT** (per-day) | MLPrediction upsert+TTL; durable MLPredictionOutcome empty |

## 37. RETENTION / TTL AUDIT

TTLs found (`expireAfterSeconds`): Forecast 30d; StockoutRisk 7d; PromotionScenario 7d;
MLPrediction `expiresAt` partial TTL (day-scoped rows — Outcome header says ~3d for those);
audit retentionService global TTL for audit logs. RefreshToken/OtpRequest/License/IntelligenceSignal/
PromotionCandidate/MemoryEpisode use `expiresAt` fields. **No TTL on Bill/BillItem/Order/Customer/
DailySummary/InventoryEvent/CouponRedemption/LoyaltyTransaction/OfferExperimentEvent** — the 1-year
spine is retained. Recommendation: before relying on any ML evidence, either raise those TTLs or
copy to durable stores at write time (MLPredictionOutcome pattern).

## 38. INDEX / PERFORMANCE AUDIT (1-year relevance)

Strong: Bill `{restaurantId,date}`, `{branchId,date}`, `{customerId,date}`, `{date,createdAt}`;
DailySummary unique `{restaurantId,date,branchId}`; Customer 12+ tenant-prefixed indexes;
Product tenant/type/alias text indexes; CouponRedemption/Offer/Campaign tenant-prefixed.
Risks for 1-year-scale aggregation: BillItem indexed ONLY on `{billId:1}` — any product-day or
menu-level aggregation over 286k+ rows (growing) scans; InventoryEvent has tenant+date indexes
(good); BillItem needs `{menuItemId}`, or better a denormalized `restaurantId`+date; OfferAnalytics
`billIds[]`/`customerKeys[]` arrays grow unbounded per offer. Expensive aggregations to watch:
full-history tenant trend, product-day marts, per-customer timelines. (Report only — no changes.)

## 39. API / CONNECTOR AUDIT (ML + integrations)

| Edge | Contract | Auth | Timeout |
|---|---|---|---|
| Node → Demand | POST /api/ingest/pos-sync (envelopes), /api/retraining/evaluate\|run, /api/retraining/status/:id | x-restaurant-id + optional x-service-token + optional x-chitkuber-jwt; **service unauthenticated by default** | 30s (ML_DEMAND_TIMEOUT_MS) |
| Node → Basket | sync + /api/model/train + combo pull | same pattern (ML_BASKET_BASE_URL) | 30s |
| Node → Segment | segment sync + pull (ML_SEGMENT_BASE_URL) | ML_SERVICE_TOKEN | 30s |
| Node → Uplift/OfferResponse | /api/offer-response/score(-batch)/retrain/evaluate/status (ML_UPLIT_BASE_URL) | none observed | 30s; batch ≤200 |
| POS → Node | REST + JWT (surface 'pos') | requireAuth + requireRole + authorizationMiddleware | rate limiters |
| Customer site → Node | QR ordering + public receipt/feedback (public-store) | receiptToken (12h expiry) | — |
| Frontend → ML dashboards | separate FastAPI/Node apps per model (localhost:8000/3000) | none (dev tools) | — |

## 40. EXTERNAL DEPENDENCIES

| Provider | Integration | Historical? | Failure behavior |
|---|---|---|---|
| Weather | WEATHER_API_KEY → weatherIntelligenceService | NO (runtime only) | graceful degradation into tool `unavailable` |
| Cricket/sports | CRICKET_API_KEY(+fallbacks), quota tracking, refresh hours; sync → CalendarEvent | future fixtures only | quota state logged; fallback keys |
| Google Places | GOOGLE_MAPS_API_KEY → competition | NO | radius/refresh configured; no history |
| Razorpay | subscription/online payments | yes (Payment/SubscriptionHistory) | webhook events persisted (WebhookEvent) |
| WhatsApp/SMS | modules/whatsapp (+usage logs) | delivery outcomes in CampaignHistory.results | per-recipient failure rows |
| Deepgram STT | voice inventory | voiceauditlogs | — |
| LLM provider | AI_PROVIDER/AI_API_KEY(+fallbacks), AIUsageLog+AiQuotaSnapshot observability | usage logs persisted | fallback chain |

## 41. OBSERVABILITY

Present: AIUsageLog (913 rows) + AiQuotaSnapshot (LLM usage/quota); mlObservability event recorder;
agentUsage (LLM usage, agent runs, replay episodes); MLPredictionOutcome (evaluation, empty);
AuditLog (26k) + audit chain/archive/legal-hold models; CampaignHistory failure rows.
Missing for 1-year ML: training-run registry, dataset/feature version tracking, inference latency
and drift metrics, per-model dashboards. (aiCostConfig.ts exists for cost policy.)

## 42. DATA-QUALITY CONTRACTS (reusable)

Zod: tool inputs (strict), validation middleware (`middleware/validate.ts`), ingestion contracts
per model. Mongoose: schema-level validation + unique/partial indexes (idempotency: Bill.clientRef,
Order.clientRef, DailySummary natural key, CouponRedemption ledger keys, OfferExperimentEvent
partial-unique keys, MLPrediction/MLPredictionOutcome natural keys). Python: schema validation in
FastAPI services + 6-gate sufficiency + ≥90% completeness gate. NOT present: dataset-level
contracts (row rejection reasons ARE returned by ingestion: accepted_rows/rejected_rows +
data_quality_score — reusable).

## 43. SECURITY FINDINGS (report only)

- **P1 — ML services unauthenticated by default** (demandModelClient.ts header; token optional).
- **P1 — PII into ML/segment paths**: CustomerSegment.customerPhones arrays, OfferExperimentEvent
  customer identity, CampaignHistory recipientPhones, bill customerPhone snapshots — all flow
  toward ML extraction. Phone pseudonymization/hashing at the ML boundary recommended.
- P2 — Bill customerName/customerPhone snapshots are immutable PII in the ledger (needed for
  historical integrity; ensure ML exports exclude or hash).
- P2 — global (unscoped) products intentionally visible across tenants (Product.ts) — dataset
  layer must re-scope.
- Positive: tenant stripping for LLM tool args (FORBIDDEN_LLM_ARG_KEYS), surface-separated JWTs,
  receipt tokens expire 12h, public feedback is anonymous by design, audit chain models exist.
- LLM anti-fabrication: allowedNumbersFor() whitelists every number the model may state;
  strippedNumbers counter exists (zReportPrompts.ts) — strong pattern to reuse for report layers.

## 44. CURRENT VOLUME & 1-YEAR SCALE (measured)

10 restaurants, 20 branches, 23.2k bills, 285.7k billitems, 12.9k orderitems, 1.6k customers,
302 products, 4.6k inventoryevents, 7.5k couponredemptions, 19.9k recipeconsumptions, 248
feedback, 46 offers / 29 campaigns / 11 campaignhistories / 5.4k experiment events.
One-year outlook at this scale: hundreds of thousands of bills, low-millions of line items —
well within MongoDB + targeted indexes; the bottleneck is per-line enrichment (recipe costs),
not volume.

## 45. IMPLEMENTATION DUPLICATION (report; do not merge now)

| Concern | Implementations | Authoritative |
|---|---|---|
| Sales metrics | modules/reports/salesReportService · DailySummary writer · businessSignalNormalizers · OfferAnalytics · MLmodels basket server | salesReportService (reports); DailySummary (dashboard cache) |
| Customer metrics | Customer denormalized stats · CustomerVisit · customerReportService | derived-from-bills in the canonical layer |
| Margin | menuEngineeringService · getProductMarginsTool · marginSignalsService · RecipeVersion costSnapshot | RecipeVersion when present |
| Date math | zReportContext comparison windows · reports dateRange() · mlSyncScheduler isoDaysAgo | modules/reports dateRange() for reports; zReportContext for agent windows |
| Segments | segmentEngine · MLmodels segmentation service · CustomerSegment types | segmentEngine for ops; ML service for ML datasets (label provenance) |

## 46. CURRENT → FUTURE MATRIX

| Area | Current | Required for 1-year ML | Gap |
|---|---|---|---|
| Sales history | 12 months measured, append-only | 1 year | none (keep) |
| Daily snapshot | sparse (731 rows) | complete canonical daily fact | derive from bills; snapshot as cross-check |
| Product key | string menuItemId + names | stable canonical key | extraction-layer resolver |
| Price history | priceAtSale only | price/availability versions | new event or version table (collect going forward) |
| Recipe/cost history | RecipeVersion (3 rows) | per-change snapshots | enforce snapshotting on every edit |
| Inventory | events + current batches | daily closing + stockouts | reconstruction job + durable stockout record |
| Offer exposure | CampaignHistory (11 rows) | per-customer exposure events | new exposure event at send time |
| Weather/competition | runtime only | aligned historical + forecast | provider + daily persistence starting NOW |
| Experiment features | empty (0/5,432) | pre-treatment snapshot at assignment | capture at assignment; backfill with cutoff discipline |
| Model artifacts | in-memory (demand) / local files | registry + versioned artifacts + dataset versions | central registry |
| Prediction history | TTL'd upserts | durable predictions + outcomes | MLPredictionOutcome loop (activate; it is built) |

## 47. DATA FUNDAMENTALLY MISSING TODAY (repo-proven)

1. Offer **exposure/impression** events per customer (redemption-only today).
2. Historical **weather** and **competition** presence (runtime-only services).
3. **Product price/availability change history** (only sale-time snapshots).
4. **RecipeVersion coverage** (mechanism exists, 3 rows) → historical cost/margin mostly lost.
5. **Control-group evidence at scale** (4,170/5,432 experiment rows are legacy all-treatment).
6. Pre-treatment **feature snapshots** on experiment assignments (0 populated).
7. Historical **stockouts** (TTL'd) and **daily inventory snapshots**.
8. **Campaign delivery receipts** per recipient at scale (11 CampaignHistory rows).
9. Restaurant **timezone / business-day cutoff config** (no field found; string-date convention
   implicitly local to the POS clock — NOT VERIFIED further).
10. Durable **model artifacts / dataset versions** for the Demand service (in-memory).

## 48. WHAT TO COLLECT GOING FORWARD (recommendation only)

MUST HAVE: offer-exposure event (campaign send × customer, channel, timestamp); experiment
assignment feature snapshot (at assignment time); weather daily rollup per city (backfill from
provider where licensing allows); price-change event; RecipeVersion on every recipe edit (already
designed — enforce); activation of MLPredictionOutcome evaluation job (already designed).
SHOULD HAVE: menu-availability change log; stockout event (durable, beyond TTL); campaign
opened/clicked receipts where the channel provides them; customer identity normalization at capture.
NICE TO HAVE: competitor footfall (blocked by provider costs); POS offline-window metadata;
per-branch business-day cutoff config.
NOT NEEDED: vector/embedding infrastructure (repo memory contract is indexed-only — keep it).

## 49. ARCHITECTURE RECOMMENDATION (mapped to existing code)

```text
Operational MongoDB (KEEP — append-only ledgers already good)
  → Extraction     EXTEND modules/ml-pipeline extractors + contracts (tenant-verified, versioned)
  → Canonical      NEW daily-fact store (restaurant/branch/date) — reuse salesReportService
                   expressions + zReportContext date windows; DailySummary = cross-check
  → Validation     REUSE ingestion accept/reject + data_quality_score + Zod/Mongoose contracts
  → Features       NEW versioned feature builder per mart (cutoff discipline; featureVersion)
  → Labels         NEW label builders (demand, churn, redemption, uplift) — temporal as-of joins
  → Training       REUSE service-side gates (sufficiency, walk-forward, champion/challenger);
                   ADD artifact+dataset persistence to Demand service (currently in-memory)
  → Registry       NEW minimal registry row per (datasetVersion, featureVersion, modelVersion,
                   trainingWindow, metrics, restaurantScope) — extend MLPrediction metadata now
  → Inference      KEEP pull model: predictions → MLPrediction (raise/keep TTL) → tools
  → Outcomes       ACTIVATE predictionFeedbackService → MLPredictionOutcome (built, empty)
  → Signals/Tools  UNCHANGED registry pattern (honest unavailability + model status)
  → Agents         UNCHANGED consumers (z-report Batch 3, marketing pipeline, inventory agent)
```

## 50. MASTER AUDIT TABLE

| Domain | Source | Key fields | Historical coverage (measured) | ML ready? | Main gap |
|---|---|---|---|---|---|
| Sales | Bill/BillItem | date, totals, priceAtSale, snapshots | 12 mo / 23.2k+285.7k | **YES** | product-key normalization; BillItem indexes |
| Orders/online | Order/OrderItem | createdAt, lifecycle | 12 mo / 3.5k+12.9k | YES | no business-date field (use createdAt→date) |
| Catalog | Product/ProductVariant | price, branchPrice, type | current-state | partial | no price/availability history |
| Recipes/cost | Recipe/RecipeVersion/RecipeConsumption | effectiveFrom, costSnapshot | 12 mo consumption; 3 versions | partial | version coverage |
| Inventory | InventoryEvent/Purchase/Product.batches | eventDate, FIFO costs | 12 mo, thin | partial | completeness; no daily stock |
| Customers | Customer/CustomerVisit | phone identity, visitDate | visits 3.5 mo; identity from 2026-03 | partial | pre-March identity; 63% linkage |
| Loyalty | LoyaltyTransaction | FIFO pool ledger | 3.5 mo | YES (mechanism) | coverage window |
| Marketing | Offer/Campaign/CampaignHistory/CouponRedemption/OfferAnalytics | offerId, sentDate, billId, snapshotDate | redemptions 11.5 mo; exposure ~none | partial | exposure events |
| Experiments | OfferExperiment/OfferExperimentEvent | treatment, purchase, variantId, exposedAt | 6 mo | YES (controlled subset) | features empty; legacy rows |
| Feedback | ReceiptFeedback | billId, rating | 3 mo | YES | volume |
| Finance | DailySummary/Expense | date | summary sparse; expense 3.5 mo | partial | summary completeness |
| ML stores | MLPrediction/Outcome/Forecast | predictionFor, versions | live window; outcomes empty | YES (plumbing) | durability (TTL) + activation |
| Context | festivalService / CalendarEvent / weather / competition | computed | festivals computable; sports future-only | partial | weather/competition history |
| Memory | RestaurantMemory/MemoryEpisode | entityRef, expiresAt | 4/15 rows | n/a | indexed-only by design |

## 51. FILE-LEVEL AUDIT (the files that decide the 1-year design)

- **backend/src/models/intelligence/Bill.ts** — append-only ledger; reads: reports/agents; writes:
  billService (atomic DailySummary bump, idempotent clientRef). Reusable: YES. Risk: nullable tenant.
- **backend/src/models/intelligence/BillItem.ts** — sale-time snapshots (name/price/gst/discount/
  pricing+config versions). Reusable: YES (price history substitute). Risk: string menuItemId; only
  {billId} index.
- **backend/src/modules/reports/services/salesReportService.ts** — authoritative metric math
  (netRevenueExpr, trend, statusBreakdown) + string-id fallbacks. Reusable: YES — canonical layer
  should reuse its expressions verbatim.
- **backend/src/modules/ml-pipeline/** (25 files) — extraction contracts, 5 clients, scheduler,
  prediction read models, feedback evaluator, observability, routes. Reusable: YES, extend.
- **backend/src/models/intelligence/MLPrediction.ts / MLPredictionOutcome.ts** — versioned store +
  durable evaluation (built, 0 rows). Reusable: YES — activate outcome loop.
- **backend/src/modules/recipes/models/RecipeVersion.ts** — append-only cost history design.
  Reusable: YES. Risk: barely used (3 rows) — enforcement needed at edit time.
- **backend/src/models/intelligence/OfferExperimentEvent.ts** — causal ledger; features/exposedAt
  fields exist. Reusable: YES. Risk: features never populated in practice.
- **backend/src/models/customers/CustomerSegment.ts** — phone-array membership, no history.
  Reusable: for ops only; ML datasets must derive segments as-of dates.
- **backend/src/ai/tools/registerAllTools.ts + tools/ml/** — the agent→ML boundary with honest
  unavailability. Reusable: YES unchanged.
- **backend/src/ai/agents/zReportSignals.ts** (modified pre-audit) — evidence packs; weekday
  baseline now 7-day aware; disclose-not-fabricate conventions. Reusable: YES.
- **backend/src/services/dataSufficiencyService.ts / factConsistencyService.ts** — reuse for
  dataset validation + claim grounding.
- **MLmodels/Demand_forcasting_model/server.ts** — ingestion API; in-memory stores = must-fix
  before 1-year training.
- **MLmodels/Market_Basket_Analysis/backend/ml.py** — chronological split + registry (good
  pattern to replicate for other models).
- **MLmodels/Uplift/backend/experiment_store.py + ml.py** — T-Learner + gates; synthetic default.
- **MLmodels/Offer_Response_Model/offer_response.py** — per-tenant weights, gates, temporal eval.

## 52. P0 / P1 / P2 FINDINGS

### P0 (blocks safe 1-year ML as-is)
1. **Experiment feature snapshots are empty (0/5,432)** — uplift/offer-response training on real
   rows is impossible without capture-at-assignment (and disciplined, cutoff-respecting backfill).
2. **Historical exposure does not exist** (CampaignHistory=11 rows; no impressions) — any
   response/conversion model trained on "active offers" would learn a biased proxy. Must start
   exposure-event collection now; label historical response data honestly.
3. **ML evidence TTLs**: Forecast 30d, StockoutRisk 7d, PromotionScenario 7d, day-scoped
   MLPrediction ~3d — one-year backtesting cannot rely on these collections; durable stores
   (MLPredictionOutcome) exist but are empty.
4. **Demand model artifacts are in-memory** (lost on restart; no dataset/feature versions) —
   cannot meet datasetVersion/modelVersion/restaurantScope requirements until persisted.

### P1
5. ML services unauthenticated by default (x-service-token optional).
6. PII (phones/names) flows to ML extraction paths unhashed.
7. Product "global unscoped" visibility can merge menus across tenants in naive exports.
8. String-typed cross-collection ids (menuItemId, billId in CouponRedemption, customerId in
   experiment events) + name-based references (topItems, favoriteItems, InventoryEvent.item).
9. DailySummary sparseness (731/3,680 possible) — not a snapshot source of truth.
10. No business-day/timezone configuration field (string-date convention is implicit).
11. RecipeVersion enforcement gap → historical margin mostly unrecoverable.
12. Stored demand predictions are `stat_heuristic_v2` — external service not feeding the store.
13. BillItem indexing ({billId} only) will not scale to product-day marts.

### P2
14. Legacy nullable tenant/branch fields require explicit dataset filters.
15. Child collections scoped via parent only (TakeawayOrder, WaitingEntry, TimelineEvent…).
16. OfferAnalytics unbounded billIds[]/customerKeys[] arrays.
17. Duplicated metric logic (§45) — reconcile via canonical layer.
18. Segment membership not versioned; Customer favorite* are name lists.

## 53. MASTER TODO — AUDIT VERDICT ONLY (legend: [x] exists · [~] extend · [ ] build later · [-] not needed · [!] blocking)

### Phase 0 — Data architecture
- [x] Append-only transactional ledgers (Bill/BillItem/LoyaltyTransaction/CouponRedemption/RecipeVersion)
- [~] Canonical daily-fact design over (restaurantId, branchId, date) — extend ml-pipeline contracts
- [!] Demand-service artifact persistence (in-memory today) — blocks registry goals

### Phase 1 — Historical extraction
- [x] billExtractor/basketExtractor/customerSegmentExtractor + ingestion contracts
- [~] Add product-day + inventory + experiment extractors (cutoff-aware)
- [~] Canonical product/customer key resolver (string-id + name risks, §35)

### Phase 2 — Data normalization
- [~] Reuse modules/reports dateRange() + salesReportService expressions as the single metric math
- [~] Normalize business dates (string YYYY-MM-DD) + explicit null-tenant filtering policy

### Phase 3 — Data validation
- [x] Zod/Mongoose contracts; ingestion accept/reject + data_quality_score
- [~] Dataset-level contract runner (row rejection reasons surfaced per mart)

### Phase 4 — Canonical historical dataset
- [ ] Build versioned daily fact (sales/product-day/customers/marketing/inventory/context)
- [x] DailySummary exists as cross-check (sparse — do not use as source)

### Phase 5 — Feature engineering
- [~] Demand feature engine (walk-forward) exists in Demand service; port cutoff discipline to Node
- [ ] Versioned feature builder + featureVersion stamping

### Phase 6 — Label generation
- [x] Labels derivable: next-day demand, redemption, purchase-after-assignment, churn
- [ ] Temporal as-of label builders (no current-state leakage)

### Phase 7 — Training datasets
- [x] Chronological split + registry in basket service (pattern)
- [~] Per-mart train/val/test packaging with datasetVersion

### Phase 8 — Temporal backtesting
- [x] Walk-forward validator (Demand Ph.6); Qini/AUUC gates (Uplift); temporal holdout (OfferResponse)
- [~] Enforce the same discipline on the Node statistical path

### Phase 9 — Retraining
- [x] Basket auto-retrain @10k; Demand /api/retraining/evaluate|run; scheduler knocks daily
- [!] Persist retraining jobs/artifacts (currently in-memory)

### Phase 10 — Evaluation
- [x] MLPredictionOutcome design (durable predicted-vs-actual)
- [!] Activate predictionFeedbackService evaluation loop (0 rows measured)

### Phase 11 — Model registry / versioning
- [x] modelVersion+featuresVersion on MLPrediction; basket champion/challenger + rollback;
      offer-response per-tenant weights with model_version
- [ ] Central registry row (datasetVersion, featureVersion, modelVersion, trainingWindow,
      metrics, restaurantScope) shared by all 5 services

### Phase 12 — Production inference
- [x] Pull-based store read by tools; honest unavailability; 30s timeouts; batch scorer
- [~] Keep pull model; add per-tenant rate/quota on ML endpoints

### Phase 13 — Prediction persistence
- [x] MLPrediction (TTL'd) + MLPredictionOutcome (durable)
- [~] Extend TTL or duplicate small durable rows at write time for backtesting evidence

### Phase 14 — AI tool integration
- [x] 6 ML tools + 4 context tools registered; Zod; tenant-stripped args; model status fields
- [-] No new tool layer needed

### Phase 15 — Z-report integration
- [x] Batch-2 evidence + Batch-3 ML cross-check; weekday-aware 7-day baseline (this repo, verified)
- [~] Feed canonical dataset facts into evidence packs as provenance-labelled signals

### Phase 16 — Marketing integration
- [~] marketingIntelligencePipeline consumes mlSemantics; extend to canonical mart + exposure
- [ ] Exposure-event capture at campaign send (MUST — P0 #2)

### Phase 17 — Inventory / customer integration
- [~] Inventory agent has wastage/stockout/expiry tools; add daily closing-stock reconstruction
- [~] Customer datasets as-of-date; segment recomputation with cutoff

### Phase 18 — Incremental retraining
- [x] Basket transaction counter trigger; Demand retraining orchestrator
- [~] Scheduler already knocks daily — wire artifact persistence first (P0 #4)

### Phase 19 — Monitoring / drift
- [~] mlObservability + AIUsageLog exist; add dataset-freshness + errorPct trend alerts
      (MLPredictionOutcome aggregates feed retraining triggers — built, empty)

### Phase 20 — Testing / security
- [x] Vitest suites across src/ai (543 passing incl. 7 new weekday-baseline tests); auth surface tests
- [ ] ML-boundary tests: tenant scoping per endpoint, PII hashing at extraction, dataset
      contract violations, leakage unit tests (cutoff discipline)

## 54. FINAL QUESTIONS — EXPLICIT ANSWERS

### Data
1. **One-year collections:** bills, billitems (spine, 12 mo measured); orders/orderitems (12 mo);
   dailysummaries (sparse); recipeconsumptions (12 mo); inventoryevents + purchases (12 mo,
   thin); couponredemptions (11.5 mo); offerexperimentevents (6 mo); offeranalytics (6 mo);
   calendarevents; customers (records from 2026-03); customervisits, loyaltytransactions,
   receiptfeedbacks, expenses (3–3.5 mo only).
2. **Relationships:** §3 graph — Bill→BillItem(parent), Bill→Customer(id+phone snapshot),
   Bill→Order, CouponRedemption→Offer/Customer/Bill(string), OfferExperimentEvent→Offer/Bill,
   RecipeVersion→Recipe/Product with effectiveFrom/To, LoyaltyTransaction→Customer (FIFO pool).
3. **Keys:** restaurantId (ObjectId, required on business tables), branchId (nullable),
   businessDate string YYYY-MM-DD, Bill._id; fragile: string menuItemId/billId/customerId,
   phone-as-identity, name-based references (§35).
4. **Tenant scoped:** all business tables (measured bills: 0 without restaurantId); 17 child/
   platform models scope via parent or platform-wide; Product has an intentional global unscoped
   fallback.
5. **Branch scoped:** Bill/Order/InventoryEvent/Purchase/Recipe*/LoyaltyTransaction/CustomerVisit/
   OfferAnalytics/CouponRedemption/Forecast/MLPrediction; restaurant-wide: Customer, Offer
   (branchIds array), Campaign, segments; DailySummary per (restaurant, branch, date).
6. **Authoritative date fields:** Bill.date (business date, string), createdAt elsewhere;
   experiment rows carry assignedAt/convertedAt/exposedAt (Date); MLPrediction.predictionFor.
7. **Business dates reconstructable:** YES — the string convention is consistent and indexed;
   Order needs createdAt→date conversion; no timezone/cutoff config exists (P2 #16).
8. **Volume measured:** 12 months, 23.2k bills / 285.7k billitems / 10 tenants; heavy skew
   (85% one tenant); 275 distinct bill dates.
9. **Gaps:** per-tenant day coverage NOT VERIFIED; several domains start mid-year (§7 table).
10. **Duplicates/orphans:** idempotency enforced by partial-unique indexes (clientRef, natural
    keys); bills: 0 tenant-orphans, 2 voided, 7 refunded; deeper integrity sweeps NOT VERIFIED.

### ML
11. **Models:** Demand (Node), Basket FP-Growth+GBM (FastAPI), Uplift T-Learner (FastAPI),
    Offer-Response logistic (per-tenant weights), Segmentation (FastAPI) + Node statistical
    fallback (`stat_heuristic_v2`).
12. **Training data:** Node extractors push Mongo-derived envelopes over HTTP; basket/uplift also
    accept CSV import; experiment store for causal models.
13. **Synthetic vs real:** Uplift synthetic by default (10k rows); basket ships demo CSV (real
    sync exists); demand/segmentation/offer-response real-data paths exist; stored demand
    predictions in DB came from the internal statistical model.
14. **Features:** demand lags/rolls (walk-forward); basket co-occurrence/velocity/economics;
    offer-response 10 numeric + 4 categorical pre-treatment (EMPTY on real rows).
15. **Labels:** next-day units; combo uptake; purchase-after-assignment (+attributedRevenue);
    redemption; churn/visit (derivable); wastage (derivable, completeness unknown).
16. **Splits:** chronological 70/15/15 (basket); walk-forward (demand); temporal holdout
    (offer-response); Qini/AUUC (uplift). No random splits in the Python trainers.
17. **Leakage:** none in trainers by design; risks are current-state stats (segments, cost,
    averages) projected into the past, TTL-erased evidence, and empty feature snapshots that
    invite post-hoc backfill without cutoffs.
18. **Benefit immediately from 1-year:** demand, basket, segmentation, retention/churn,
    wastage — all real-data paths exist.
19. **Need new collection:** offer-response + uplift (exposure events, feature snapshots,
    controlled rows), margin labels (RecipeVersion enforcement), context-aligned features
    (weather/competition history).
20. **Global vs per-restaurant:** everything is per-tenant today; recommend global prior +
    tenant fine-tune as a future extension; keep artifacts/registry restaurant-scoped.

### Marketing ML
21. **Historical exposure:** NO (CampaignHistory=11 rows; no impressions) — start capture now.
22. **Treatment/control:** partially — controlled rows only (1,262 of 5,432; 4,170 legacy).
23. **Uplift supportable today?** No — feature snapshots empty (0/5,432); controlled subset
    small; synthetic default must not be presented as real evidence.
24. **Offer-response trainable?** Not on real historical rows (same blockers); gates correctly
    refuse (treated≥100/conversions≥20) — keep honest refusal.
25. **Campaign outcome attribution:** revenue/redemption YES via CouponRedemption+Bill+OfferAnalytics;
    margin only where recipe cost existed; causal attribution only for controlled experiments.

### Historical intelligence
26. **Daily snapshots:** re-derivable from bills (authoritative path); DailySummary sparse →
    cross-check only.
27. **Historical product cost:** mostly NO (3 RecipeVersions); mechanism must be enforced now.
28. **Inventory state:** partial reconstruction (events+purchase+consumption; completeness
    unverified); stockouts lost to TTL.
29. **Context alignment:** festivals YES (deterministic 2025–2027 table); sports partial
    (future fixtures persisted); weather/competition NO.
30. **Feedback alignment:** YES — ReceiptFeedback.billId joins the bill's business date (248
    rows, 3 months).

### Architecture
31. **Reuse:** reports metric math; ml-pipeline extractors/clients/scheduler; MLPrediction/
    Outcome; tool registry pattern; sufficiency/fact-consistency services; audit/observability.
32. **Extend:** extractors (canonical keys, cutoffs), TTL policy, registry metadata, Demand
    persistence, exposure capture, RecipeVersion enforcement.
33. **Create:** canonical daily-fact store, dataset/feature versioning, central model registry,
    weather-history collector, exposure event, price/availability change log.
34. **Do NOT create:** a second BI scanner (normalizers exist), vector/embedding stores (memory
    contract is indexed-only), a second metrics engine, per-model Mongo duplicates of ledgers.
35. **Remain in MongoDB:** operational ledgers + canonical facts at this scale (low millions of
    rows/yr) — no warehouse needed yet; datasets can live as versioned Mongo collections +
    Parquet/CSV exports for training.
36. **Derived datasets:** §34 marts (demand, customer-snapshot, basket, offer-response, uplift,
    retention, wastage, margin).
37. **Datasets live:** versioned collections (datasetVersion stamped) under the extraction
    pipeline, exportable per training run; never derived ad-hoc inside model services.
38. **Model versioning:** extend MLPrediction metadata + basket registry pattern into one
    registry row: datasetVersion+featureVersion+modelVersion+trainingWindow+metrics+scope.
39. **Inference returns:** HTTP per existing client contracts (x-restaurant-id = verified JWT
    tenant, service token, 30s timeout) into MLPrediction; never direct-from-agent calls.
40. **Agents consume:** through the tool registry only (honest unavailability, model status),
    reading stored predictions — the established, tenant-safe pattern.

## 55. AUDIT-ONLY DECLARATION

```text
AUDIT COMPLETE

No source files modified.
No files created (this report is the only artifact, plus /tmp probe scripts, now removed).
No files deleted.
No database mutations performed (read-only aggregations/counts only).
No models retrained.
No APIs changed.
No production behavior changed.
```

Verification anchors: zReportPhase3 suite 36/36 green and tsc touched-files clean BEFORE the audit
(baseline task); every measurement above from read-only probes on 2026-10-08; every schema claim
cited to its model file. Pre-existing repo state: 344 documented tsc errors (none in src/ai),
543/543 src/ai tests passing.

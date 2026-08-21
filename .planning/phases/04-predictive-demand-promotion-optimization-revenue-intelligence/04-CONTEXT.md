# Phase 4: Predictive Demand, Promotion Optimization & Revenue Intelligence - Context

**Gathered:** 2026-08-21
**Status:** Ready for planning

## Phase Boundary

This phase upgrades the restaurant intelligence system from reactive ("Here is an opportunity") to predictive-prescriptive ("Here is what is likely to happen, here are the available actions, and this is the action most likely to produce the best economic outcome").

**Scope Anchor**: Build demand forecasting, promotion scenario engine, optimization with constraints, learning loop, and AI Advisor upgrade — all deterministic with AI as explanation layer only. No complex ML infrastructure unless audit proves necessary.

**Sub-phases (from ROADMAP.md)**:
- 4.1: Forecasting Foundation & Data Sufficiency
- 4.2: Inventory Demand Prediction & Stockout Risk
- 4.3: Promotion Scenario Engine & Optimization
- 4.4: Promotion Calendar, Fatigue & Context Intelligence
- 4.5: Menu, Combo & Add-on Optimization
- 4.6: Learning, Evaluation & AI Advisor Upgrade

---

## Implementation Decisions

### Data Sufficiency & Forecasting Architecture

- **D-01**: Four-tier data sufficiency: `INSUFFICIENT_DATA` (<30 days), `LOW_CONFIDENCE` (30-90 days), `MODERATE_CONFIDENCE` (90-180 days), `HIGH_CONFIDENCE` (>180 days) — thresholds from spec §2
- **D-02**: Forecast algorithm: Historical comparable periods + linear trend + day-of-week + time-of-day + seasonality (only when HIGH_CONFIDENCE) — per spec §3 "simplest statistically defensible approach"
- **D-03**: Forecast output structure: entity, time_period, predicted_demand, expected_range (low/high), confidence, historical_baseline, trend_pct, data_sufficiency — per spec §4
- **D-04**: No ML models in Phase 4 — statistical baselines only (moving averages, comparable periods, trend lines). Complex models only if Phase 4 audit shows measurable improvement — per spec §30
- **D-05**: Forecast granularity: restaurant → category → product → variant → time_slot (30-min or 1-hour buckets) — per spec §3
- **D-06**: Forecast explainability fields mandatory: what_predicted, why, based_on_history, confidence, what_could_change — per spec §24

### Forecast Storage & Computation

- **D-07**: Forecasts computed in scheduled background jobs (not at billing time) — per spec §31
- **D-08**: Cached forecasts with TTL (1 hour for HIGH_CONFIDENCE, 30 min for MODERATE, 15 min for LOW) — per spec §31 "cached forecasts, materialized aggregates"
- **D-09**: Incremental updates: only recompute affected entities when new sales data arrives — per spec §31 "incremental updates"
- **D-10**: Forecast model version stored with each prediction for evaluation — per spec §25

### Inventory Demand Prediction

- **D-11**: Forecast → Recipe → Ingredient quantities pipeline using existing `Recipe` model and `costIntelligenceService` — per spec §5
- **D-12**: Stockout risk = predicted_consumption > current_stock × 0.8 (reuse surplus threshold from `deriveSurplusItems`) — per spec §5
- **D-13**: Integrate with existing inventory/reorder system (extend `Purchase` suggestions), not new calculator — per spec §5 "integrate with existing inventory/reorder system rather than creating another inventory calculator"
- **D-14**: Stockout warnings surfaced in Advisor dashboard as "Protect Friday Stock" action cards — per spec §33

### Promotion Scenario Engine

- **D-15**: Scenario comparison: Current vs Promo A vs Promo B vs Combo vs No Promo — per spec §8
- **D-16**: Each scenario calculates deterministically: price, discount, expected_demand, revenue, contribution, incremental_contribution, inventory_impact, required_stock, cannibalization_risk — per spec §8
- **D-17**: "No promotion" is a first-class scenario, not a fallback — per spec §15, §34
- **D-18**: Economic comparison uses contribution (not revenue) as default objective — per spec §8 example shows contribution comparison

### Promotion Elasticity & Discount Search

- **D-19**: Elasticity learned from restaurant's own historical promotion data only — per spec §9 "Learn from the restaurant's own historical data"
- **D-20**: Bounded discount search: discrete levels ₹0, ₹10, ₹20, ₹30, ₹40, ₹50 (not percentages) — per spec §10
- **D-21**: Elasticity model: simple piecewise linear or logarithmic fit from historical (discount, demand_delta) pairs — per spec §9 example
- **D-22**: Diminishing returns detected automatically; search stops when marginal contribution turns negative — per spec §9 "system may discover diminishing returns"

### Objective-Based Optimization

- **D-23**: Seven explicit objectives (spec §11): revenue_growth, profit_growth, aov_growth, footfall_growth, inventory_reduction, customer_retention, slow_hour_utilization
- **D-24**: Objective is required parameter for optimization; default = profit_growth (maximize expected contribution) — per spec §10 "Maximize expected contribution"
- **D-25**: Same promotion can be optimal under one objective but poor under another — explicitly documented in recommendations — per spec §11

### Constraints (Hard Guards)

- **D-26**: Minimum margin % (configurable per restaurant, default 15%) — per spec §12
- **D-27**: Maximum discount % or absolute (configurable, default 30%) — per spec §12
- **D-28**: Minimum selling price (cost + minimum margin) — per spec §12
- **D-29**: Inventory availability (predicted_consumption + safety_stock ≤ current_stock) — per spec §12, §18
- **D-30**: Offer eligibility (customer segments, time windows, product constraints) — per spec §12
- **D-31**: Restaurant-configured rules (stored in Settings) — per spec §12

### Cannibalization Model

- **D-32**: Incremental demand = expected_total_demand − expected_baseline_demand — per spec §13
- **D-33**: Baseline from forecast without promotion; total from forecast with promotion — per spec §13
- **D-34**: Cannibalization risk flagged when incremental < 50% of promoted volume — per spec §13 "Prefer recommendations with strong incremental economics"

### Promotion Fatigue Detection

- **D-35**: Track per-promotion: run_count, days_since_first_run, redemption_trend (first_2_runs vs recent) — per spec §14
- **D-36**: Fatigue signals: redemption_decline > 25%, incremental_sales_decline > 20%, runs > 5 in 45 days — per spec §14 example
- **D-37**: Recommendation: "Test value-add promotion instead of another price discount" when fatigue detected — per spec §14

### Promotion Calendar

- **D-38**: Forward 14-day calendar with day-level recommendations — per spec §15
- **D-39**: Each day: promotion_type (none/discount/combo/upsell/addon), target_products, objective, expected_impact — per spec §15 example
- **D-40**: "No promotion" days explicitly included (Wed, Sat in example) — per spec §15 "No promotion is also a valid recommendation"

### Festival/Seasonal & Weather Intelligence

- **D-41**: Festival intelligence from: historical sales during same festival last year + local calendar (existing `festivalService`) + restaurant-specific patterns — per spec §16
- **D-42**: No external APIs (Google Trends, social media) — per spec §16 "Do not introduce Google Trends or social-media scraping unless explicitly required"
- **D-43**: Weather intelligence ONLY if existing `weatherService` integration exists — per spec §17 "If live weather is unavailable, do not generate weather-based recommendations"
- **D-44**: Weather mappings: rain → delivery-friendly/comfort food; extreme heat → cold beverage inventory boost — per spec §17

### Inventory-Aware & Wastage Optimization

- **D-45**: Promotion + Forecast + Recipe + Inventory = single validation pipeline — per spec §18
- **D-46**: Block promotion if predicted_additional_consumption > (current_stock - predicted_normal_consumption - safety_buffer) — per spec §18
- **D-47**: Wastage optimization: only promote items with expiry > 7 days and waste_ratio < 15% — per spec §19 "Safe promotional candidate" vs "Unsafe inventory"
- **D-48**: Prefer purchase reduction over promotion for chronic overstock — per spec §19 "Consider reducing purchase quantity rather than creating a promotion"

### Menu Price Advisory

- **D-49**: Detect margin decline: current_contribution_margin < previous_contribution_margin - 5pp AND recipe_cost_rise > 10% — per spec §20
- **D-50**: Present 5 alternatives with economics: price increase, portion reduction, profitable side, combo conversion, keep price — per spec §20
- **D-51**: Never auto-change prices — owner decision required — per spec §20 "Do not automatically change prices"

### Combo & Add-on Optimization

- **D-52**: Combo configurations tested: all valid combinations of main + 1-3 add-ons from `menu-config` templates — per spec §21
- **D-53**: Evaluation metrics: customer_value (savings vs a la carte), margin %, basket_affinity (from `computeAttachment`), inventory_impact, expected_adoption — per spec §21
- **D-54**: Add-on optimization: test each add-on candidate, select by incremental_contribution = attachment_rate × (addon_price - addon_cost) — per spec §22

### Customer Offer Optimization

- **D-55**: Compare segmented vs blanket: inactive_customers + targeted_offer vs all_customers + blanket_discount — per spec §23
- **D-56**: Use existing `CustomerSegment` and `dormant30d` from `recommendationContext` — per spec §23

### Model Evaluation & Learning Loop

- **D-57**: Forecast evaluation: MAPE by product, by time_period, by data_sufficiency_tier — per spec §25
- **D-58**: Bias tracking: systematic over/under prediction per entity — per spec §25
- **D-59**: Promotion outcome learning: predicted vs actual (demand, revenue, contribution) stored per recommendation — per spec §26
- **D-60**: Restaurant-specific promotion performance: per-restaurant history of which promotion types work (free_addon, percentage_discount, combo) — per spec §27

### AI Advisor Upgrade

- **D-61**: Advisor input bundle: forecast + inventory + menu + margin + basket_analysis + promotion_history — per spec §28
- **D-62**: Advanced questions supported (spec §29): what_promote_tomorrow, combo_items, discount_pizza, increase_aov, why_margins_falling, stop_promoting_what, excess_inventory_actions, best_offer, weekend_promotion, price_increase
- **D-63**: AI explains; deterministic engines calculate — per spec §28 "AI explains. Deterministic engines calculate."

### Dashboard & "No Promotion" UX

- **D-64**: Dashboard shows prioritized action cards (max 4): Increase AOV, Protect Stock, Avoid Discounts, Reactivate Customers — per spec §33
- **D-65**: Each card: title, evidence summary, expected contribution, "Review" button linking to existing builder — per spec §33
- **D-66**: "No promotion" recommendation card with reasoning: "Demand already strong, margins healthy, discounting unlikely to create incremental contribution" — per spec §34

### Platform Guarantees

- **D-67**: All calculations in background jobs; POS billing path unchanged — per spec §31, §32
- **D-68**: Offline: billing, offer/combo application, pricing work; forecasting/advisory degrades gracefully (show cached/stale) — per spec §32
- **D-69**: Multi-tenant: all new models/services scoped by restaurantId (and branchId where applicable) — per spec §35.19
- **D-70**: Reuse existing: Offer, Combo, Recipe, Inventory, Sales, Customer, AI infrastructure — per spec §35.20

---

## Canonical References

### Phase 4 Specification (Primary)
- User-provided specification (36 sections) — This document is the primary requirements source

### Existing Codebase Patterns (Reusable)

#### Backend Services
- `backend/src/services/recommendationContext.ts` — Canonical context builder (sales, inventory, margins, customers, offers, calendar)
- `backend/src/services/advisorService.ts` — Goal-based recommendation engine with AI explanation layer
- `backend/src/services/offerEngine.ts` — Deterministic recommendation providers (9 types)
- `backend/src/services/offerAnalyticsService.ts` — Historical offer performance (OfferAnalytics)
- `backend/src/modules/recipes/services/costIntelligenceService.ts` — Recipe costing, margin deterioration, ingredient cost changes
- `backend/src/modules/recipes/services/profitabilityService.ts` — Offer economics, combo analytics
- `backend/src/modules/ai/services/aiService.ts` — AI execution with caching, circuit breaker, fallback
- `backend/src/modules/promotions/services/promotionsService.ts` — Promotion creative studio

#### Models
- `backend/src/models/AdvisorRecommendation.ts` — Recommendation persistence with lifecycle (fingerprint, cooldown)
- `backend/src/models/Offer.ts` — Financial offer rules (discount types, thresholds, validity)
- `backend/src/models/Promotion.ts` — Promotion creative (presentation layer)
- `backend/src/models/Product.ts` — Product with variants, add-ons, recipe, stock
- `backend/src/models/Recipe.ts` / `RecipeVersion` / `RecipeConsumption` — Recipe costing
- `backend/src/models/Bill.ts` / `BillItem.ts` — Historical sales data
- `backend/src/models/Customer.ts` / `CustomerSegment.ts` — Customer data
- `backend/src/models/InventoryEvent.ts` — Stock movements

#### Frontend Components
- `restaurant-pos/Frontend/components/marketing/BusinessAdvisor.tsx` — Advisor UI with goal selection, recommendation cards, action buttons
- `restaurant-pos/Frontend/src/hooks/usePOSState.ts` — POS state management
- `restaurant-pos/Frontend/src/lib/syncEngine.ts` — Offline sync pattern

### External Specs
- `docs/AI_ARCHITECTURE.md` — AI provider abstraction, deterministic vs AI boundaries
- `docs/POS_ARCHITECTURE.md` — POS architecture, billing flow, workspaces
- `docs/DATABASE_SCHEMA.md` — MongoDB collections and indexes

---

## Existing Code Insights

### Reusable Assets

| Asset | How Used in Phase 4 |
|-------|---------------------|
| `recommendationContext.ts` | Extend with forecast data, predicted demand, stockout risk |
| `advisorService.ts` | Add predictive goals (forecast_demand, optimize_promotion), upgrade AI enrichment |
| `offerEngine.ts` | Add `ForecastProvider`, `ScenarioEngineProvider`, `OptimizationProvider` |
| `costIntelligenceService.ts` | Recipe → ingredient quantities for inventory demand prediction |
| `profitabilityService.ts` | Scenario economics (contribution, incremental contribution) |
| `aiService.ts` | Forecast explanation, promotion rationale, advisor enrichment |
| `promotionsService.ts` | Create promotions from optimized scenarios |
| `BusinessAdvisor.tsx` | Add forecast-aware cards, "No promotion" card, action links |
| `deriveSurplusItems` | Reuse surplus threshold (80% of maxStock) for stockout risk |

### Established Patterns

| Pattern | Phase 4 Application |
|---------|---------------------|
| Deterministic engine + AI explanation | Forecast engine + AI forecast explanation; Scenario engine + AI scenario rationale |
| Tenant-scoped queries (restaurantId + branchId) | All forecast, scenario, optimization queries |
| Cached AI responses with TTL | Cache forecasts (1hr TTL), scenario results (30min TTL) |
| Fingerprint deduplication | Deduplicate forecast scenarios, promotion recommendations |
| Recommendation lifecycle (shown→accepted→cooldown) | Track promotion recommendation outcomes |
| Background jobs for expensive ops | Forecast computation, scenario evaluation, model evaluation |

### Integration Points

| New Component | Connects To |
|---------------|-------------|
| `ForecastService` | `recommendationContext.ts` (sales history), `BillItem` (historical demand) |
| `ScenarioEngine` | `offerEngine.ts` (providers), `profitabilityService` (economics) |
| `OptimizationService` | `ScenarioEngine`, `constraints` (Settings), `elasticity` (OfferAnalytics) |
| `PromotionCalendarService` | `ForecastService`, `ScenarioEngine`, `festivalService` |
| `ModelEvaluationService` | `ForecastService` (predictions), `Bill` (actuals), `AdvisorRecommendation` (outcomes) |
| `AdvisorService` (upgrade) | All above + `aiService` (explanations) |

---

## Specific Ideas

- **Forecast API shape**: Mirror `RecommendationContext` structure — add `forecast` field with predictions per entity/time_slot
- **Scenario payload**: Reuse `OfferSuggestion` structure but add `scenario_id`, `expected_demand`, `incremental_contribution`, `cannibalization_risk`
- **Elasticity storage**: New collection `PromotionElasticity` { restaurantId, productId, discount_level, demand_delta, sample_size, updatedAt }
- **Calendar storage**: New collection `PromotionCalendar` { restaurantId, date, recommendation, objective, confidence, createdAt }
- **Model evaluation**: Extend `AdvisorRecommendation` with `forecast_accuracy` subdocument or new `ForecastEvaluation` collection
- **Dashboard cards**: Extend `BusinessAdvisor` with `forecast` goal type and predictive action cards

---

## Deferred Ideas

### Reviewed Todos (Not Folded)
- None — no pending todos matched this phase

### Future Phase Candidates
- **Automated promotion execution** — Requires Phase 4 audit review first (spec §36)
- **Cross-restaurant benchmarking** — Anonymized industry trends (Phase 6+)
- **Complex ML models** — Only if statistical baselines fail Phase 4 audit (spec §30)
- **Real-time dynamic pricing** — Separate capability, not in Phase 4 scope
- **Third-party weather API** — Only if existing integration proven valuable (spec §17)

---

## Advisory Notes for Downstream Agents

1. **Researcher**: Focus on statistical forecasting methods (comparable periods, Holt-Winters, SARIMA) that work with 30-365 days of daily data. No deep learning.
2. **Planner**: Break into 6 sub-phases per ROADMAP.md. Each sub-phase produces working, testable code.
3. **Executor**: Reuse existing patterns exactly — tenant-scoping, caching, fingerprint deduplication, lifecycle management.
4. **Verifier**: Check all 33 acceptance criteria (spec §35) are testable and tested.
# Requirements — Loyalty POS System

## v1 Requirements (Phase 4: Predictive Demand, Promotion Optimization & Revenue Intelligence)

### Forecasting & Demand Intelligence

- [ ] **FCST-01**: System determines data sufficiency level (INSUFFICIENT_DATA, LOW_CONFIDENCE, MODERATE_CONFIDENCE, HIGH_CONFIDENCE) before generating any forecast
- [ ] **FCST-02**: Demand forecasts produced for restaurant, category, product, variant, and time slot with predicted demand, expected range, confidence, historical baseline, trend, data sufficiency
- [ ] **FCST-03**: Forecast algorithms use historical comparable periods + trend + day-of-week + time-of-day + seasonality (where data sufficient); no complex ML unless proven improvement
- [ ] **FCST-04**: Inventory demand prediction connects forecast → recipe → ingredient quantities → predicted consumption → current inventory → stockout risk
- [ ] **FCST-05**: Forecast explainability: what predicted, why, based on what history, confidence level, what could change

### Promotion Optimization

- [ ] **PROMO-01**: Scenario engine compares Current vs Promotion A vs Promotion B vs Combo vs No Promotion with deterministic calculations (price, discount, expected demand, revenue, contribution, incremental contribution, inventory impact, required stock, cannibalization risk)
- [ ] **PROMO-02**: Promotion elasticity estimated from historical promotion data (discount → demand change); diminishing returns detected
- [ ] **PROMO-03**: Bounded optimal discount search evaluates discrete discount levels (₹0, ₹10, ₹20, ₹30, ₹40, ₹50) against explicit objective
- [ ] **PROMO-04**: Objective-based optimization supports: revenue growth, profit growth, AOV growth, footfall growth, inventory reduction, customer retention, slow-hour utilization
- [ ] **PROMO-05**: Hard constraints enforced: minimum margin, maximum discount, minimum selling price, inventory availability, offer eligibility, promotion duration, product/variant constraints, customer restrictions, restaurant-configured rules
- [ ] **PROMO-06**: Cannibalization model computes incremental demand = expected total − expected baseline
- [ ] **PROMO-07**: Promotion fatigue detection tracks repeated offers, declining redemption, declining incremental sales, discount dependency
- [ ] **PROMO-08**: Forward promotion calendar with day-level recommendations including explicit "no promotion" recommendations
- [ ] **PROMO-09**: Demand-driven promotion logic: low demand → promote; high demand → no discount / upsell higher-margin add-on

### Intelligence & Context

- [ ] **INTL-01**: Festival/seasonal intelligence from historical restaurant sales + local calendar + known festivals + restaurant-specific patterns
- [ ] **INTL-02**: Weather-based intelligence (if existing weather integration available): rain → delivery-friendly/comfort food; extreme heat → cold beverage inventory
- [ ] **INTL-03**: Capacity-aware recommendations consider kitchen throughput, prep time, staff, table capacity, delivery capacity
- [ ] **INTL-04**: Inventory-aware optimization connects promotion + forecast + recipe + inventory to prevent stockouts from promotions
- [ ] **INTL-05**: Wastage optimization identifies safe promotional candidates (not expired/unsafe); distinguishes promotion vs purchase reduction

### Menu & Combo Optimization

- [ ] **MENU-01**: Menu price advisory detects margin decline from recipe cost increases; compares alternatives (price increase, portion reduction, profitable side, combo conversion, keep price)
- [ ] **MENU-02**: Combo optimization tests multiple configurations (Burger+Fries, Burger+Fries+Coke, Burger+Coke, Burger+Premium Fries) comparing customer value, margin, affinity, inventory, adoption
- [ ] **MENU-03**: Add-on optimization tests which add-on produces best incremental contribution (cheese, fries, drink, dessert)
- [ ] **MENU-04**: Customer offer optimization compares segmented offers (inactive customers, frequent customers) vs blanket discounts

### Learning & Evaluation

- [ ] **LEARN-01**: Model evaluation tracks forecast vs actual, error metrics (MAPE), bias, performance by product and time period
- [ ] **LEARN-02**: Recommendation outcome learning connects predicted promotion results to actuals (predicted +15% → actual +19% = 4% error)
- [ ] **LEARN-03**: Restaurant-specific learning retains structured promotion performance history per restaurant (Restaurant A: free add-on works; Restaurant B: percentage discount works; Restaurant C: combos work)

### AI Advisor & Dashboard

- [ ] **ADV-01**: AI Advisor upgraded to use forecast + inventory + menu + margin + basket analysis + previous promotion results
- [ ] **ADV-02**: Advanced owner questions supported: what to promote tomorrow, which item in combo, should discount pizza, increase AOV, why margins falling, stop promoting what, excess inventory actions, best offer, weekend promotion, price increase decisions
- [ ] **ADV-03**: Dashboard upgraded with prioritized action cards (Increase AOV, Protect Stock, Avoid Blanket Discounts, Reactivate Customers)
- [ ] **ADV-04**: "No promotion" is a valid, explainable recommendation when demand strong and margins healthy

### Platform Guarantees

- [ ] **PLAT-01**: All calculations deterministic and auditable (no hidden ML)
- [ ] **PLAT-02**: POS billing path never blocked by forecasting/AI (scheduled jobs, cached forecasts, materialized aggregates, incremental updates, background processing)
- [ ] **PLAT-03**: Offline support: billing, existing offer application, existing combo application, existing pricing work offline; predictive/advisory degrades gracefully
- [ ] **PLAT-04**: Multi-tenant security preserved (all new models/services/APIs scoped by restaurantId)
- [ ] **PLAT-05**: Reuses existing Offer, Combo, Recipe, Inventory, Sales, Customer, AI infrastructure

## v2 Requirements (Future Phases)

- [ ] Fully automated promotion management (post Phase 4 review)
- [ ] Complex ML models (if Phase 4 audit proves necessary)
- [ ] Cross-restaurant benchmarking (anonymized)
- [ ] Real-time dynamic pricing

## Out of Scope

- GPU infrastructure / custom model training / large ML pipelines — Start with statistical baselines only
- Google Trends / social media scraping — Use only historical sales, local calendar, festivals
- Automated promotion execution without owner review — Requires separate review after Phase 4
- Third-party weather API integration — Only if existing system already has it

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FCST-01 to FCST-05 | 4 | Active |
| PROMO-01 to PROMO-09 | 4 | Active |
| INTL-01 to INTL-05 | 4 | Active |
| MENU-01 to MENU-04 | 4 | Active |
| LEARN-01 to LEARN-03 | 4 | Active |
| ADV-01 to ADV-04 | 4 | Active |
| PLAT-01 to PLAT-05 | 4 | Active |
# Roadmap — Loyalty POS System

## Milestone 1: Predictive Demand & Promotion Intelligence (Phase 4)

### Phase 4: Predictive Demand, Promotion Optimization & Revenue Intelligence

**Goal**: Upgrade the restaurant intelligence system from "Here is an opportunity" to "Here is what is likely to happen, here are the available actions, and this is the action most likely to produce the best economic outcome."

**Requirements**: FCST-01–05, PROMO-01–09, INTL-01–05, MENU-01–04, LEARN-01–03, ADV-01–04, PLAT-01–05

**Success Criteria**:
1. System forecasts demand at restaurant/category/product/variant/time-slot level with confidence intervals and data sufficiency levels
2. Promotion scenario engine compares multiple options (including "no promotion") with deterministic economics
3. Optimal discount search evaluates bounded discount levels against explicit objectives (revenue, profit, AOV, footfall, inventory, retention, slow-hour)
4. Cannibalization model and promotion fatigue detection prevent margin erosion from repeated discounting
5. Forward promotion calendar provides day-level actionable recommendations
6. Inventory-aware optimization prevents promotions that would cause stockouts
7. Menu price advisory detects margin decline and compares remediation alternatives
8. Combo/add-on/customer offer optimization uses actual attachment/performance data
9. Model evaluation tracks forecast accuracy (MAPE, bias) and promotion outcome learning
10. Restaurant-specific learning retains per-restaurant promotion performance history
11. AI Advisor answers advanced predictive questions using forecast + inventory + margin + history
12. Dashboard shows prioritized action cards with "Review" actions linking to existing builders
13. All calculations deterministic; POS billing never blocked; multi-tenant security preserved

---

### Phase 4.1: Forecasting Foundation & Data Sufficiency

**Goal**: Build the demand forecasting infrastructure with data sufficiency gating.

**Requirements**: FCST-01, FCST-02, FCST-03, FCST-05

**Success Criteria**:
1. Data sufficiency classifier returns INSUFFICIENT_DATA / LOW / MODERATE / HIGH based on historical days
2. Forecast engine produces predictions with expected range, confidence, baseline, trend, data sufficiency
3. Statistical baseline models: comparable periods + trend + day-of-week + time-of-day + seasonality (when data sufficient)
4. Forecast explainability: what/why/history/confidence/what-could-change
5. No complex ML — statistical baselines only

### Phase 4.2: Inventory Demand Prediction & Stockout Risk

**Goal**: Connect demand forecasts to ingredient-level consumption and stockout risk.

**Requirements**: FCST-04, INTL-04

**Success Criteria**:
1. Forecast → Recipe → Ingredient quantities → Predicted consumption pipeline
2. Current inventory compared to predicted consumption → stockout risk identification
3. Integration with existing inventory/reorder system (not new calculator)
4. Example: "Based on expected Friday demand, paneer may run out before 8 PM"

### Phase 4.3: Promotion Scenario Engine & Optimization

**Goal**: Build deterministic scenario comparison and bounded optimization.

**Requirements**: PROMO-01, PROMO-02, PROMO-03, PROMO-04, PROMO-05, PROMO-06, PROMO-09

**Success Criteria**:
1. Scenario engine: Current vs Promo A vs Promo B vs Combo vs No Promo
2. Each scenario calculates: price, discount, expected demand, revenue, contribution, incremental contribution, inventory impact, required stock, cannibalization risk
3. Promotion elasticity from historical data (discount → demand change, diminishing returns)
4. Bounded discount search: evaluates ₹0, ₹10, ₹20, ₹30, ₹40, ₹50 against objective
5. Objective-based optimization: revenue, profit, AOV, footfall, inventory reduction, retention, slow-hour
6. Hard constraints: min margin, max discount, min price, inventory, eligibility, duration, rules
7. Cannibalization: incremental = total expected − baseline expected
8. "No promotion" valid recommendation when demand strong

### Phase 4.4: Promotion Calendar, Fatigue & Context Intelligence

**Goal**: Forward-looking calendar with fatigue detection and contextual intelligence.

**Requirements**: PROMO-07, PROMO-08, INTL-01, INTL-02, INTL-03, INTL-05

**Success Criteria**:
1. Promotion fatigue detector: repeated offers, declining redemption, discount dependency
2. Forward calendar: day-level recommendations (Mon: snack promo, Tue: chai combo, Wed: no discount, Thu: upsell, Fri: premium combo, Sat: no broad discount)
3. Festival/seasonal intelligence from historical sales + calendar + known festivals
4. Weather intelligence (if existing integration): rain → comfort food; heat → cold beverages
5. Capacity-aware: kitchen throughput, prep time, staff, tables, delivery
6. Wastage optimization: safe promo candidates vs unsafe inventory; promotion vs purchase reduction

### Phase 4.5: Menu, Combo & Add-on Optimization

**Goal**: Price advisory and combinatorial optimization using actual performance data.

**Requirements**: MENU-01, MENU-02, MENU-03, MENU-04, INTL-05

**Success Criteria**:
1. Price advisory: margin decline detection → compare alternatives (price↑, portion↓, side, combo, keep)
2. Combo optimization: test multiple configs, compare customer value, margin, affinity, inventory, adoption
3. Add-on optimization: test cheese/fries/drink/dessert for best incremental contribution
4. Customer offer optimization: segmented (inactive, frequent) vs blanket discounts

### Phase 4.6: Learning, Evaluation & AI Advisor Upgrade

**Goal**: Close the feedback loop and upgrade the advisor with predictive intelligence.

**Requirements**: LEARN-01, LEARN-02, LEARN-03, ADV-01, ADV-02, ADV-03, ADV-04, PLAT-01–05

**Success Criteria**:
1. Model evaluation: forecast vs actual, MAPE, bias, by product/time
2. Promotion outcome learning: predicted vs actual results tracked per recommendation
3. Restaurant-specific learning: per-restaurant promotion performance history
4. AI Advisor uses forecast + inventory + menu + margin + basket + promotion history
5. Advanced questions: promote tomorrow, combo items, discount pizza, AOV, margin fall, stop promoting, excess inventory, best offer, weekend promo, price increase
6. Dashboard: action cards (Increase AOV, Protect Stock, Avoid Discounts, Reactivate Customers)
7. "No promotion" recommendation with explanation
8. All calculations deterministic; POS billing independent; offline graceful degradation; multi-tenant secure; reuses existing infrastructure

---

## Future Phases (Backlog)

### Phase 5: Automated Promotion Management (Post-Review)
- Autonomous promotion scheduling/execution with guardrails
- Requires separate review after Phase 4 audit

### Phase 6: Cross-Restaurant Intelligence
- Anonymized benchmarking across tenant base
- Industry trend detection

### Phase 7: Advanced ML (If Proven Necessary)
- Complex models only if Phase 4 statistical baselines insufficient
- GPU infrastructure, custom training pipelines

---

## Phase Dependency Graph

```
Phase 4.1 (Forecasting Foundation)
    ↓
Phase 4.2 (Inventory Demand) ← depends on 4.1
    ↓
Phase 4.3 (Scenario Engine) ← depends on 4.1, 4.2
    ↓
Phase 4.4 (Calendar/Fatigue/Context) ← depends on 4.1, 4.3
    ↓
Phase 4.5 (Menu/Combo/Add-on) ← depends on 4.1, 4.3
    ↓
Phase 4.6 (Learning/Advisor/Dashboard) ← depends on 4.1–4.5
```

---

## Milestone Completion

Phase 4 is complete when all 6 sub-phases (4.1–4.6) are executed and all 33 acceptance criteria from the Phase 4 specification (§35) are met.

---

*Roadmap created: 2026-08-21*
# Phase 4: Predictive Demand, Promotion Optimization & Revenue Intelligence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-21
**Phase:** 04-predictive-demand-promotion-optimization-revenue-intelligence
**Areas discussed:** All (auto-mode from detailed specification)

---

## Data Sufficiency & Forecasting Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Four-tier (INSUFFICIENT/LOW/MODERATE/HIGH) | Thresholds: <30d, 30-90d, 90-180d, >180d | ✓ |
| Three-tier (LOW/MEDIUM/HIGH) | Simpler but less granular for new restaurants | |
| Continuous confidence score | ML-style probability; overcomplicates for Phase 4 | |

**User's choice:** Four-tier per specification §2
**Notes:** Specification explicitly defines four states with examples. New restaurant (10 days) = INSUFFICIENT_DATA; Established (6-12 months) = HIGH_CONFIDENCE.

---

## Forecast Algorithm

| Option | Description | Selected |
|--------|-------------|----------|
| Statistical baselines only | Comparable periods + trend + DOW + TOD + seasonality (when data sufficient) | ✓ |
| Light ML (XGBoost/Prophet) | Better accuracy but adds infrastructure | |
| Deep learning | Overkill; violates "simplest statistically defensible" principle | |

**User's choice:** Statistical baselines only per specification §3, §30
**Notes:** "Only introduce more sophisticated models if the data demonstrates that they improve accuracy. Do not use an ML model simply because the product is called AI."

---

## Forecast Output Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Spec-defined structure | entity, time_period, predicted_demand, expected_range, confidence, historical_baseline, trend, data_sufficiency | ✓ |
| Simplified (predicted + confidence) | Loses explainability and baseline comparison | |
| Probabilistic distribution | Full PDF; too complex for dashboard consumption | |

**User's choice:** Full spec structure per §4
**Notes:** Required for explainability (§24) and model evaluation (§25).

---

## Promotion Scenario Engine

| Option | Description | Selected |
|--------|-------------|----------|
| Current vs Promo A vs Promo B vs Combo vs No Promo | Full 5-way comparison per spec §8 | ✓ |
| Current vs single Promo | Too limited; can't compare strategies | |
| Current vs Promo vs No Promo | Missing combo comparison | |

**User's choice:** 5-way comparison per spec §8
**Notes:** "No promotion" is a first-class scenario (§15, §34), not a fallback.

---

## Discount Search Space

| Option | Description | Selected |
|--------|-------------|----------|
| Discrete ₹ levels (0, 10, 20, 30, 40, 50) | Bounded search per spec §10 | ✓ |
| Percentage levels (0%, 5%, 10%...) | Currency amounts more intuitive for owners | |
| Continuous optimization | Requires gradient methods; not deterministic | |

**User's choice:** Discrete ₹ levels per spec §10
**Notes:** "Don't only test 10%, 20%, 30% — build a bounded scenario search."

---

## Optimization Objectives

| Option | Description | Selected |
|--------|-------------|----------|
| 7 explicit objectives (revenue, profit, AOV, footfall, inventory, retention, slow-hour) | Per spec §11 | ✓ |
| Single objective (profit) | Simpler but ignores restaurant diversity | |
| Weighted multi-objective | Hidden tradeoffs; spec requires explicit objective | |

**User's choice:** 7 explicit objectives per spec §11
**Notes:** "The same promotion may be optimal under one objective but poor under another." Objective must be explicit.

---

## Constraints Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Hard guards (never return invalid action) | Min margin, max discount, min price, inventory, eligibility, rules | ✓ |
| Soft penalties in objective | Can produce invalid recommendations | |
| Post-filter invalid | Wastes computation; better to constrain search space | |

**User's choice:** Hard guards per spec §12
**Notes:** "The optimizer must never return an invalid action."

---

## Cannibalization Model

| Option | Description | Selected |
|--------|-------------|----------|
| Incremental = Total_expected - Baseline_expected | Per spec §13 | ✓ |
| Fixed cannibalization rate (e.g., 30%) | Not restaurant-specific | |
| ML-estimated per product | Overkill for Phase 4 | |

**User's choice:** Formula-based per spec §13
**Notes:** "Prefer recommendations with strong incremental economics."

---

## Promotion Fatigue Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Track run_count, redemption_trend, days_since_first | Per spec §14 | ✓ |
| Simple cooldown (30 days) | Doesn't detect gradual fatigue | |
| No fatigue detection | Violates spec requirement | |

**User's choice:** Full tracking per spec §14
**Notes:** Triggers "Test value-add promotion instead of another price discount" recommendation.

---

## Promotion Calendar

| Option | Description | Selected |
|--------|-------------|----------|
| 14-day forward with day-level + "no promotion" | Per spec §15 | ✓ |
| 7-day only | Too short for planning | |
| Monthly themes only | Not actionable enough | |

**User's choice:** 14-day day-level per spec §15
**Notes:** "No promotion is also a valid recommendation" — Wed/Sat in example have no promotion.

---

## Festival/Seasonal Intelligence

| Option | Description | Selected |
|--------|-------------|----------|
| Historical sales + local calendar + restaurant patterns | Per spec §16 | ✓ |
| + Google Trends / social media | Explicitly prohibited in spec | |
| Weather API integration | Only if existing integration exists (spec §17) | |

**User's choice:** Historical + calendar only per spec §16
**Notes:** "Do not introduce Google Trends or social-media scraping unless explicitly required."

---

## Inventory-Aware Optimization

| Option | Description | Selected |
|--------|-------------|----------|
| Promotion + Forecast + Recipe + Inventory pipeline | Per spec §18 | ✓ |
| Separate inventory check after promotion | Can recommend then block; worse UX | |
| Ignore inventory | Violates spec §18 | |

**User's choice:** Single pipeline per spec §18
**Notes:** "Do not run the promotion without replenishment" when stockout risk detected.

---

## Wastage Optimization

| Option | Description | Selected |
|--------|-------------|----------|
| Safe candidates only (expiry > 7d, waste_ratio < 15%) | Per spec §19 | ✓ |
| Promote all overstock | Risks unsafe food | |
| Purchase reduction only | Misses valid promo opportunities | |

**User's choice:** Safe candidates + prefer purchase reduction per spec §19
**Notes:** "Promotion should not be the automatic solution to every inventory problem."

---

## Menu Price Advisory

| Option | Description | Selected |
|--------|-------------|----------|
| Detect decline → present 5 alternatives with economics | Per spec §20 | ✓ |
| Auto-suggest price increase | "Do not automatically change prices" | |
| No advisory | Misses high-value opportunity | |

**User's choice:** 5 alternatives comparison per spec §20
**Notes:** Owner decides; system compares economics.

---

## Combo Optimization

| Option | Description | Selected |
|--------|-------------|----------|
| Test all valid main+addon combinations | Per spec §21 | ✓ |
| Fixed templates only | Misses optimal configurations | |
| Single best guess | Not data-driven | |

**User's choice:** Exhaustive config testing per spec §21
**Notes:** Compare customer value, margin, affinity, inventory, adoption.

---

## Add-on Optimization

| Option | Description | Selected |
|--------|-------------|----------|
| Test each add-on by incremental_contribution | Per spec §22 | ✓ |
| Highest margin add-on | May have low attachment rate | |
| Most popular add-on | May have low margin | |

**User's choice:** Incremental contribution = attachment_rate × (price - cost) per spec §22

---

## Customer Offer Optimization

| Option | Description | Selected |
|--------|-------------|----------|
| Compare segmented vs blanket offers | Per spec §23 | ✓ |
| Always blanket discount | "Do not automatically discount products that already sell extremely well" | |
| Always segmented | May miss broad-audience opportunities | |

**User's choice:** Compare options per spec §23
**Notes:** "Choose based on the explicit business objective."

---

## Model Evaluation

| Option | Description | Selected |
|--------|-------------|----------|
| MAPE by product/time/sufficiency + bias tracking | Per spec §25 | ✓ |
| Simple RMSE | Less interpretable for owners | |
| No evaluation | Violates "Do not assume predictions are good" | |

**User's choice:** Full evaluation per spec §25
**Notes:** "Avoid overfitting to restaurants with little data. Use simpler baselines when they outperform complex models."

---

## Recommendation Outcome Learning

| Option | Description | Selected |
|--------|-------------|----------|
| Track predicted vs actual per recommendation | Per spec §26 | ✓ |
| Aggregate only | Loses per-recommendation learning | |
| No learning | Violates spec §26 | |

**User's choice:** Per-recommendation tracking per spec §26
**Notes:** "Over time, measure which recommendation types are reliable."

---

## Restaurant-Specific Learning

| Option | Description | Selected |
|--------|-------------|----------|
| Per-restaurant promotion type performance history | Per spec §27 | ✓ |
| Global model only | "Do not assume what works for Restaurant A works for Restaurant B" | |
| Cluster-based | Adds complexity without proven need | |

**User's choice:** Per-restaurant history per spec §27
**Notes:** Restaurant A: free add-on works; B: percentage discount; C: combos work.

---

## AI Advisor Upgrade

| Option | Description | Selected |
|--------|-------------|----------|
| Input: forecast + inventory + menu + margin + basket + promo history | Per spec §28 | ✓ |
| Current advisor + forecast only | Misses inventory/margin context | |
| Forecast-only advisor | Loses existing goal-based structure | |

**User's choice:** Full context bundle per spec §28
**Notes:** "AI explains. Deterministic engines calculate."

---

## Advanced Owner Questions

| Option | Description | Selected |
|--------|-------------|----------|
| Support all 10 question types from spec §29 | Per spec §29 | ✓ |
| Subset only | Incomplete advisor experience | |

**User's choice:** All 10 question types per spec §29

---

## Dashboard Design

| Option | Description | Selected |
|--------|-------------|----------|
| 4 prioritized action cards (AOV, Stock, Discounts, Reactivate) | Per spec §33 | ✓ |
| List of all recommendations | Overwhelming; no prioritization | |
| Single "best" recommendation | Hides tradeoffs | |

**User's choice:** 4 action cards per spec §33
**Notes:** Each card has "Review" button linking to existing builders.

---

## "No Promotion" Recommendation

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit card with reasoning | Per spec §34 | ✓ |
| Hidden (no recommendation shown) | Owner wonders why nothing suggested | |
| Text-only in logs | Not visible enough | |

**User's choice:** Explicit card per spec §34
**Notes:** "Demand is already strong and current margins are healthy. Discounting is unlikely to create enough incremental contribution."

---

## Platform Guarantees

| Option | Description | Selected |
|--------|-------------|----------|
| Background jobs + caching + offline graceful degradation | Per spec §31, §32 | ✓ |
| Sync computation | Blocks POS billing | |
| No offline support | Violates spec §32 | |

**User's choice:** Background + cache + graceful degradation per spec §31, §32

---

## Multi-Tenant & Reuse

| Option | Description | Selected |
|--------|-------------|----------|
| All new models scoped by restaurantId; reuse Offer/Combo/Recipe/Inventory/Sales/Customer/AI | Per spec §35.19, §35.20 | ✓ |
| New isolated models | Duplicates existing infrastructure | |

**User's choice:** Full reuse per spec §35.20

---

## Claude's Discretion

- Forecast algorithm implementation details (exact statistical methods, parameter tuning)
- Cache TTL values (within spec ranges)
- Database index strategy for forecast/scenario queries
- Background job scheduling frequency
- UI polish for dashboard cards (exact layout, animations)
- Prompt engineering for AI forecast explanations

---

## Deferred Ideas

- Automated promotion execution — Requires Phase 4 audit review first (spec §36)
- Cross-restaurant benchmarking — Phase 6+
- Complex ML models — Only if statistical baselines fail Phase 4 audit (spec §30)
- Real-time dynamic pricing — Separate capability
- Third-party weather API — Only if existing integration proven valuable (spec §17)
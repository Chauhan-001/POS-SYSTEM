# Loyalty POS System — Project Context

## What This Is

A full-featured, offline-tolerant Restaurant POS System with:
- **Restaurant POS Terminal** (React 19 + Vite + Electron desktop shell)
- **Express REST API Backend** (Node.js + TypeScript + MongoDB/Mongoose)
- **Multi-Tenant Admin Web Portal** (React + Electron)
- **Public QR-Ordering Customer Website** (React + Vite)

**Core Value**: Deterministic financial truth (pricing, tax, margins, recipe cost, discount allocation) with AI as an explanation/advisory layer only.

## Architecture Principles

1. **Backend is source of truth** — POS keeps localStorage cache for resilience; syncEngine queues failed writes and replays on reconnect
2. **Multi-tenant** — All resources scoped by `restaurantId` (+ optional `branchId`)
3. **Configured ordering** — Reusable variant/add-on/customization groups (`menu-config`) consumed identically by registration and billing
4. **Deterministic engines calculate; AI explains** — No financial truth computed by LLM
5. **Offline tolerance** — Billing, existing offer application, combo application, pricing all work offline
6. **Performance** — Expensive calculations in scheduled jobs/cached forecasts; POS billing path remains fast

## Current State (Phases 1–3 Complete)

### Phase 1: Core POS & Billing ✓
- Product catalog with variants, add-ons, customizations
- Billing flow with deterministic pricing engine
- Thermal receipt printing (58/80mm)
- Keyboard shortcuts for cashier efficiency
- Offline-tolerant sync engine

### Phase 2: Inventory, Recipes & Offers ✓
- Inventory tracking with purchase/sale/waste/adjustment events
- Recipe costing engine with deterministic margin calculation
- Offer engine with multiple provider types (weather, festival, inventory, time-based, performance, customer loyalty, proven offers)
- Promotion Studio for creative offer management
- Margin safety warnings (never discount thin-margin items)

### Phase 3: Business Advisor (AI-Enhanced) ✓
- Goal-based recommendation engine (increase_sales, move_inventory, bring_customers_back, increase_profit, increase_aov, create_offer, create_combo)
- Deterministic candidate generation from real sales, inventory, margins, customers, offers, calendar
- AI explanation layer (enhancement only — deterministic fallback always present)
- Recommendation lifecycle (shown → accepted/converted → cooldown → reevaluate)
- Fingerprint-based duplicate suppression

## Tech Stack

- **POS Frontend**: React 19, Vite 6, TypeScript, Tailwind CSS, Lucide Icons
- **Admin Dashboard**: React 19, Vite, TypeScript, Electron
- **Customer Site**: React, Vite, JavaScript (JSX)
- **Desktop Shell**: Electron (POS + Admin)
- **Backend**: Node.js, Express, TypeScript, MongoDB/Mongoose, Socket.IO
- **Tooling**: Concurrently, Cross-Env, Vitest, Playwright, ESLint

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Deterministic pricing/tax/margin engines | Financial truth must be auditable, never hallucinated | Locked — all money math in `pricingEngine`, `taxSummary`, `profitabilityService` |
| AI only for explanation/prioritization | Owner trust requires transparent reasoning | Locked — advisorService calls AI after deterministic scoring |
| Multi-tenant by restaurantId | SaaS architecture from day one | Locked — all models scoped |
| Offline-first POS | Restaurant internet is unreliable | Locked — syncEngine + localStorage cache |
| Recipe costing drives margins | Ingredient cost changes must propagate to product margins | Locked — costIntelligenceService → profitabilityService |
| Promotion Studio separates creative from financial | Offer = financial truth; Promotion = presentation | Locked — Offer model, Promotion model |

## Requirements

### Validated (Phases 1–3 — Existing Capabilities)

- ✓ Core POS billing with variants/add-ons/customizations
- ✓ Thermal receipt printing with multi-slab GST summary
- ✓ Product registration wizard (Basic → Price/Variants → Add-ons → Recipe → Review)
- ✓ Inventory tracking (purchase, sale, waste, adjustment, opening/closing)
- ✓ Recipe costing with deterministic margin per product
- ✓ Offer engine with 9 provider types (weather, festival, inventory, margin_safety, wastage, time_based, slow_day, performance, customer_loyalty, analytics_proven)
- ✓ Promotion Studio (create, edit, publish, archive, duplicate, mismatch check, AI creative copy)
- ✓ Business Advisor with 7 goals and deterministic candidate generation
- ✓ AI-enhanced explanations with deterministic fallback
- ✓ Recommendation lifecycle with fingerprint deduplication
- ✓ Multi-tenant architecture with branch scoping
- ✓ Offline-tolerant sync engine

### Active (Phase 4 — Predictive Demand, Promotion Optimization & Revenue Intelligence)

- [ ] **REQ-01**: Demand forecasting with data sufficiency levels (INSUFFICIENT_DATA, LOW_CONFIDENCE, MODERATE_CONFIDENCE, HIGH_CONFIDENCE)
- [ ] **REQ-02**: Forecast output with entity, time period, predicted demand, expected range, confidence, historical baseline, trend, data sufficiency
- [ ] **REQ-03**: Inventory demand prediction connecting forecast → recipe → ingredient quantities → stockout risk
- [ ] **REQ-04**: Demand-driven promotion opportunities (distinguish low demand → promote vs high demand → no promotion/upsell)
- [ ] **REQ-05**: Capacity-aware recommendations (kitchen throughput, staff, table, delivery capacity)
- [ ] **REQ-06**: Promotion scenario engine (Current vs Promotion A vs Promotion B vs Combo vs No promotion)
- [ ] **REQ-07**: Promotion elasticity estimation from historical promotion data
- [ ] **REQ-08**: Bounded optimal discount search (₹0, ₹10, ₹20, ₹30, ₹40, ₹50)
- [ ] **REQ-09**: Objective-based optimization (revenue growth, profit growth, AOV growth, footfall growth, inventory reduction, customer retention, slow-hour utilization)
- [ ] **REQ-10**: Hard constraint enforcement (min margin, max discount, min price, inventory, eligibility, duration, rules)
- [ ] **REQ-11**: Cannibalization model (incremental demand = total expected − baseline expected)
- [ ] **REQ-12**: Promotion fatigue detection (repeated offers, declining redemption, discount dependency)
- [ ] **REQ-13**: Forward promotion calendar (day-level recommendations including "no promotion")
- [ ] **REQ-14**: Festival/seasonal intelligence from historical sales + local calendar
- [ ] **REQ-15**: Weather-based intelligence (if weather integration exists)
- [ ] **REQ-16**: Inventory-aware optimization (promotion + forecast + recipe + inventory)
- [ ] **REQ-17**: Wastage optimization (safe promotional candidates vs unsafe inventory)
- [ ] **REQ-18**: Menu price advisory (margin decline detection → alternatives comparison)
- [ ] **REQ-19**: Combo optimization (test multiple configurations, compare economics)
- [ ] **REQ-20**: Add-on optimization (best incremental contribution)
- [ ] **REQ-21**: Customer offer optimization (segmented offers vs blanket discounts)
- [ ] **REQ-22**: Prediction explainability (what, why, history, confidence, what could change)
- [ ] **REQ-23**: Model evaluation (forecast vs actual, MAPE, bias, performance by product/time)
- [ ] **REQ-24**: Recommendation outcome learning (predicted vs actual promotion results)
- [ ] **REQ-25**: Restaurant-specific learning (per-restaurant promotion performance history)
- [ ] **REQ-26**: AI Advisor upgrade (forecast + inventory + menu + margin + basket + promotion history)
- [ ] **REQ-27**: Advanced owner questions support (what to promote, combo items, discount decisions, margin analysis, etc.)
- [ ] **REQ-28**: Dashboard upgrade with prioritized action cards
- [ ] **REQ-29**: "No promotion" recommendation capability
- [ ] **REQ-30**: All calculations deterministic and auditable
- [ ] **REQ-31**: POS billing never blocked by forecasting/AI
- [ ] **REQ-32**: Multi-tenant security preserved
- [ ] **REQ-33**: Reuse existing Offer, Combo, Recipe, Inventory, Sales, Customer, AI infrastructure

### Out of Scope

- GPU infrastructure / complex neural networks / large ML pipelines — Not needed unless audit proves necessary (Phase 4 spec §30)
- Custom model training — Start with statistical baselines (Phase 4 spec §30)
- Google Trends / social media scraping — Use only historical sales, local calendar, known festivals (Phase 4 spec §16)
- Automated promotion management without review — Separate phase after Phase 4 review (Phase 4 spec §36)

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

*Last updated: 2026-08-21 after initialization*
# Documented Formulas and Thresholds — Phase 8

This document centralizes all formulas, thresholds, and configuration values used throughout the restaurant intelligence platform. No magic numbers scattered in code.

## 1. Pipeline Stages and Formulas

### 1.1 Data Quality Gate Checks

| Check | Formula | Threshold | Impact |
|-------|---------|-----------|--------|
| Sales data freshness | orderCount ≥ 5 | < 5: Fail, 5-19: Warning, ≥ 20: Pass | -30 / -10 / +5 |
| Inventory data freshness | itemsWithLimits / itemsWithStock | < 0.5: Warning | -10 / +5 |
| Recipe completeness | productsWithRecipeCost / products | 0: Fail, < 50: Warning, < 80: Warning, ≥ 80: Pass | -30 / -15 / -8 / +5 |
| Pricing validity | products with invalid price/cost | > 50%: Fail, > 0: Warning | -25 / -5 |
| Customer data quality | customerCount | < 10: Fail, < 50: Warning | -20 / -10 |
| Offer consistency | offers with valid performance | < 50%: Warning | -15 / +5 |
| Margin data validity | products with negative margin | > 0: Fail | -30 |

### 1.2 Consistency Check Formulas

#### Offer Price Consistency
- expectedDiscount = activeOffer.value
- actualDiscount = offer.discountGiven
- diff = |expected - actual|
- Fail if diff > 5, High severity if diff > 15

#### Recipe Cost Consistency
- recipeCost = margin.recipeCost
- productCost = product.averageCost
- costDiff = |recipeCost - productCost|
- costPct = (costDiff / max(recipeCost, productCost)) × 100
- Fail if costPct > 15, High severity if costPct > 30

#### Inventory Consistency
- stockRatio = currentStock / max(currentStock, 1)
- Overstocked if stockRatio > 1.2
- Understocked if stockRatio < 0.3 (and minStock > 0)

#### Combo Component Availability
- Check if combo components from surplus inventory are used in active combos
- Flag if surplus item appears in combo components

### 1.3 Financial Formulas

#### Contribution Calculation
```
contributionPerUnit = discountedPrice - recipeCostPerUnit
discountedPrice = unitSellingPrice - discountAmount
discountAmount = round(unitSellingPrice × (recordedDiscount / 100))
calculatedContribution = contributionPerUnit × expectedUnits
```

#### Contribution Margin Percent
```
contributionMarginPercent = round((contributionPerUnit / unitSellingPrice) × 100)
```

#### Demand at Discount (Elasticity)
```
pctPriceChange = -discountPercent / 100
pctDemandChange = elasticity × pctPriceChange
expectedDemand = max(0, round(baselineDemand × (1 + pctDemandChange)))
```

#### Break-Even Volume Increase
```
marginLossPerBaseUnit = discountAmount
totalMarginLossOnBase = baselineDemand × marginLossPerBaseUnit
breakEvenVolumeIncrease = contributionPerUnit > 0
  ? round((totalMarginLossOnBase / contributionPerUnit) / baselineDemand × 100)
  : Infinity
```

### 1.4 Forecast Formulas

#### Baseline (Median of Comparable Periods)
- Find all observations with same day-of-week and same time-slot
- baseline = median of their values

#### Trend (Linear Regression)
- Fit linear regression on last N periods
- trend = slope of regression line

#### Seasonality (Weekly Averages Across Years)
- For each day-of-week, collect weekly averages across all available years
- seasonality[dayOfWeek] = average of those weekly averages

#### Festival Effects
- If any bill date falls within festival period → detect festival effect
- Adjust baseline: baseline × (1 + festivalEffectPercentage)

#### Confidence Score
- Data sufficiency: min 14 days / 50 bills
- confidenceScore = f(dataPoints, trendReliability, seasonalityFit, festivalFit)

### 1.5 Promotion Optimization Formulas

#### Discount Scenario Evaluation
```
proposedPrice = round(currentPrice × (1 - discountPercent / 100))
discountAmount = round(currentPrice - proposedPrice)
contributionPerUnit = round(proposedPrice - recipeCost)
contributionMarginPercent = round((contributionPerUnit / proposedPrice) × 100)
expectedDemand = calculateDemandAtDiscount(baselineDemand, elasticity, discountPercent)
incrementalDemand = max(0, expectedDemand - baselineDemand)
expectedRevenue = round(expectedDemand × proposedPrice)
expectedContribution = round(expectedDemand × contributionPerUnit)
baselineRevenue = baselineDemand × currentPrice
baselineContribution = baselineDemand × (currentPrice - recipeCost)
incrementalRevenue = round(expectedRevenue - baselineRevenue)
incrementalContribution = round(expectedContribution - baselineContribution)
breakEvenVolumeIncrease = contributionPerUnit > 0
  ? round((baselineDemand × discountAmount) / contributionPerUnit / baselineDemand × 100)
  : Infinity
confidence = 0.7
  - 0.2 if baselineDemand < 5
  - 0.1 if |elasticity| < 0.5
  - 0.1 if discountPercent > 20
confidence = max(0.3, min(0.95, confidence))
```

#### Constraint Validation
```
if contributionMarginPercent < minMarginPercent → invalid
if discountPercent > maxDiscountPercent → invalid
if proposedPrice < minSellingPrice → invalid
if incrementalContribution ≤ 0 → invalid
```

#### Objective Scoring
```
maximize_contribution → incrementalContribution
maximize_revenue → incrementalRevenue
maximize_aov → expectedRevenue / max(expectedDemand, 1)
maximize_transactions → incrementalDemand
reduce_inventory → incrementalContribution > 0 ? incrementalDemand : -Infinity
maximize_retention → discount 10-20% & incrementalContribution > 0 ? incrementalContribution × 1.2 : incrementalContribution × 0.5
maximize_slow_hour_utilization → incrementalDemand × (incrementalContribution > 0 ? 1 : 0.1)
```

### 1.6 Confidence Calibration

#### Accuracy by Confidence Level
- Track: for each confidence level (Low/Medium/High), count recommendations where actualContribution > 0
- accuracy = positive / total
- Well-calibrated: High > Medium > Low

### 1.7 No-Action Benchmark

```
noPromotionContribution = current contribution without new promotion
promotionContribution = expected contribution from optimization
penaltyPercent = promotionConfidence < 70 ? (100 - promotionConfidence) × 0.2 : 0
penalty = promotionContribution × (penaltyPercent / 100)
adjustedPromotionContribution = promotionContribution - penalty

if noPromotionContribution > adjustedPromotionContribution → no_action wins
else if |noPromotionContribution - adjustedPromotionContribution| < 500 → marginal
else → promotion wins
```

### 1.8 Feature Gating by Maturity Level

| Level | Features |
|-------|----------|
| level_1_basic | basic_offer_recommendations, rule_based_promotions, simple_inventory_tracking |
| level_2_data_aware | + recipe_completeness_awareness, basic_margin_warnings, surplus_inventory_detection |
| level_3_predictive | + demand_forecasts, trend_detection, seasonal_intelligence, promotion_fatigue_detection |
| level_4_optimized | + promotion_optimization, combo_opportunities, AOV_increasing_recommendations, price_advisory |
| level_5_learning | + weekly_learning_cycle, strategy_profiles, fatigue_detection, recommendation_learning |
| level_6_controlled_automation | + policy_constrained_automation, kill_switches, automated_campaign_execution, full_intelligence_pipeline |

### 1.9 Threshold Configuration (Centralized)

All magic numbers have been replaced with configurable thresholds:

```
SLOW_PERIOD_THRESHOLD = 0.72 × baseline  // Below this = slow period
COMBO_MIN_MARGIN = 25  // Minimum contribution margin for combo recommendations
MARGIN_RISK_THRESHOLD = 25  // Below this = thin margin warning
INVENTORY_SURPLUS_THRESHOLD = 0.8  // currentStock >= maxStock × 0.8 = surplus
DATA_SUFFICIENCY_DAYS = 14  // Minimum days of data for forecasting
DATA_SUFFICIENCY_BILLS = 50  // Minimum number of bills for forecasting
MAX_DISCOUNT_POLICY = 30  // Maximum discount % owner can configure
MIN_MARGIN_POLICY = 25  // Minimum contribution margin % owner can configure
QUIET_HOURS_START = 12  // No automation during 12-14 UTC
QUIET_HOURS_END = 14
FAILURE_THRESHOLD = 3  // Number of failures before alert
RELEASE_GATE_TIMEOUT_MS = 5000  // Max time for gate checks
```

### 1.10 Variant-aware Formulas

#### Per-variant Margin
```
variantMargin = round((variantSellingPrice - variantRecipeCost) / variantSellingPrice × 100)
```

#### Aggregated vs Per-variant Recommendations
- Never aggregate margins across variants with different recipes
- Each variant must have independent recipeCost
- If per-variant costs not available → use aggregate product without variant-specific recommendations

### 1.11 Data Freshness Thresholds

| Status | Max Minutes Ago |
|--------|----------------|
| fresh | ≤ 15 |
| recent | ≤ 30 |
| stale | ≤ 120 |
| very_stale | > 120 |

### 1.11 AI Call Reduction Thresholds

| Area | Original LLM Call | Deterministic Replacement | Risk |
|------|------------------|-------------------------|------|
| top_selling_product | LLM → calculate top product | Database aggregation | low |
| discount_economics | LLM → calculate economics | Financial engine | low |
| forecast_explanation | LLM → explain forecast | Baseline comparisons | medium |
| customer_segment | LLM → analyze segments | Customer segmentation service | low |
| promotion_optimization | LLM → generate promotion | Optimization service | low |
| recommendation_ranking | LLM → rank recommendations | Deterministic scoring | low |

## 2. Release Gates

### Gate 1: Financial Correctness
- All promotion calculations verified against first principles
- No incorrect cost calculations
- No missing recipe costs
- No double deductions
- No discount calculation errors

### Gate 2: Tenant Security
- Cross-tenant isolation tested
- AI cannot access other tenants' data
- No data leakage through recommendations/forecasts

### Gate 3: POS Performance
- Intelligence workloads do not degrade billing latency
- Billing latency impact < 10%
- Dashboard load time within targets

### Gate 4: Recommendation Quality
- Financial audit passed for all active recommendations
- No missing recipe costs for margin-based recommendations
- Variant awareness working correctly
- Inventory constraints respected

### Gate 5: AI Safety
- AI cannot bypass business constraints
- Policy violations detected and blocked
- No hallucinations in advisor responses
- Confidence calibration verified

### Gate 6: Campaign Execution
- Offer creation validates against policy
- Campaign creation respects quiet hours and frequency limits
- Combo creation validates component availability
- Idempotency: executing twice does not create duplicate

### Gate 7: Learning Accuracy
- Weekly learning cycle processes all restaurants with completed outcomes
- Strategy profiles built/updated from outcomes
- Fatigue patterns detected and recorded
- Strategy preferences tracked (gaining/losing/stable)

## 3. Important Notes

- **Never allow AI to compensate for a financial-engine error.**
- **Variant costs are independent - never aggregate incorrectly.**
- **Recipe completeness directly affects recommendation confidence.**
- **Inventory constraints affect all promotion recommendations.**
- **"No action" must compete against every proposed action.**
- **Confidence must be calibrated using historical outcomes.**
- **Data freshness must be visible to the owner.**
- **Thresholds are centralized - no scattered magic numbers.**
- **The system degrades gracefully when data is insufficient.**
- **Production release requires all 7 gates to pass.**
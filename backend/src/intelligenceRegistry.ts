/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IntelligenceRegistry — Central registry of all intelligence capabilities.
 *
 * This is the source of truth for the intelligence architecture.
 * Every engine, its purpose, inputs, outputs, and consumers are registered here.
 *
 * No duplicate calculations. Single source of truth per business fact.
 */

// Intelligence Registry — Phase 8
// Every capability listed here is the authoritative implementation.
// Consumers must reference this registry, not search for scattered implementations.

export type IntelligenceCapability =
  | 'slow_hour_detection'
  | 'product_trend_detection'
  | 'margin_risk'
  | 'basket_affinity'
  | 'combo_opportunity'
  | 'addon_opportunity'
  | 'customer_reactivation'
  | 'promotion_opportunity'
  | 'promotion_fatigue'
  | 'inventory_opportunity'
  | 'demand_forecast'
  | 'price_advisory'
  | 'promotion_optimization'
  | 'campaign_optimization'
  | 'experiment_analysis';

export interface EngineMetadata {
  name: string;
  purpose: string;
  input: string;
  output: string;
  formula?: string;
  confidence: 'Low' | 'Medium' | 'High';
  dataRequirements: string[];
  consumers: string[];
  version: string;
  lastEvaluated?: string;
  status: 'active' | 'deprecated' | 'replaced';
}

/**
 * Intelligence Registry — single source of truth
 * Every business calculation has ONE authoritative engine.
 */
export const INTELLIGENCE_REGISTRY: Record<IntelligenceCapability, EngineMetadata> = {
  slow_hour_detection: {
    name: 'Slow Hour Detection',
    purpose: 'Identify time periods with below-baseline sales',
    input: 'sales hourly performance, historical baselines',
    output: 'array of { hour, day, baseline, actual, deficitPercent }',
    formula: 'deficit = (baseline - actual) / baseline * 100; slow if deficit > threshold',
    confidence: 'High',
    dataRequirements: ['historical_bills_90d', 'hourly_sales_aggregate'],
    consumers: ['restaurantIntelligenceOrchestrator', 'advisorService', 'promotionOptimizationService'],
    version: '1.0.0',
    status: 'active',
  },
  product_trend_detection: {
    name: 'Product Trend Detection',
    purpose: 'Detect products with increasing or decreasing sales trends',
    input: 'product sales history (90+ days)',
    output: 'array of { productId, trend slope, direction, confidence }',
    formula: 'linear_regression on weekly units sold; slope sign = direction',
    confidence: 'Medium',
    dataRequirements: ['product_bills_90d'],
    consumers: ['restaurantIntelligenceOrchestrator', 'advisorService'],
    version: '1.0.0',
    status: 'active',
  },
  margin_risk: {
    name: 'Margin Risk Detection',
    purpose: 'Identify products with thin or deteriorating margins',
    input: 'product margins, recipe costs, cost risers',
    output: 'array of { productId, contributionMargin, foodCostPct, deltaPp, isThin }',
    formula: 'thin if contributionMargin < 25%; deteriorating if marginDeltaPp < -5',
    confidence: 'High',
    dataRequirements: ['recipe_cost_engine', 'product_margins_60d', 'cost_risers'],
    consumers: ['restaurantIntelligenceOrchestrator', 'advisorService', 'offerEngine'],
    version: '1.0.0',
    status: 'active',
  },
  basket_affinity: {
    name: 'Basket Affinity',
    purpose: 'Find items frequently purchased together',
    input: 'bill-level item associations (last 60 days)',
    output: 'array of { mainProductId, addonProductId, attachmentRate, confidence }',
    formula: 'attachmentRate = count(bills with both items) / count(bills with mainItem)',
    confidence: 'Medium',
    dataRequirements: ['bills_60d_with_items'],
    consumers: ['restaurantIntelligenceOrchestrator', 'advisorService', 'offerEngine'],
    version: '1.0.0',
    status: 'active',
  },
  combo_opportunity: {
    name: 'Combo Opportunity',
    purpose: 'Identify product pairs suitable for combo promotions',
    input: 'product margins, attachment rates, baseline demand',
    output: 'array of { mainId, addonId, comboPrice, expectedDiscount, expectedContribution, marginPercent }',
    formula: 'comboEconomics(mainMargin, addonMargin, discountPercent); valid if margin >= minMargin',
    confidence: 'Medium',
    dataRequirements: ['product_margins', 'attachment_rates', 'baseline_demand'],
    consumers: ['restaurantIntelligenceOrchestrator', 'promotionOptimizationService'],
    version: '1.0.0',
    status: 'active',
  },
  addon_opportunity: {
    name: 'Add-on Opportunity',
    purpose: 'Identify products suitable as add-ons to increase AOV',
    input: 'top products, attachment rates, addon margins',
    output: 'array of { mainId, addonId, addonPrice, projectedAovLift, expectedContribution, marginPercent }',
    formula: 'addonPrice = topSellingPrice * 0.25; projectedAov = currentAov + addonPrice * attachmentRate',
    confidence: 'Medium',
    dataRequirements: ['top_products', 'attachment_rates', 'product_margins'],
    consumers: ['restaurantIntelligenceOrchestrator', 'advisorService'],
    version: '1.0.0',
    status: 'active',
  },
  customer_reactivation: {
    name: 'Customer Reactivation',
    purpose: 'Identify dormant customers for win-back campaigns',
    input: 'customer lastVisit, visit frequency, historical value',
    output: 'array of { customerId, dormancyDays, lifetimeValue, recommendedOfferType }',
    formula: 'dormant if lastVisit < now - 30 days; segment by lifetimeValue tiers',
    confidence: 'Medium',
    dataRequirements: ['customers_30d', 'customer_visit_history', 'customer_spending_history'],
    consumers: ['restaurantIntelligenceOrchestrator', 'advisorService', 'campaignEngine'],
    version: '1.0.0',
    status: 'active',
  },
  promotion_opportunity: {
    name: 'Promotion Opportunity',
    purpose: 'Identify products/promotions with positive expected contribution',
    input: 'product baselines, elasticity, margin constraints, inventory',
    output: 'array of { productId, recommendedDiscount, expectedDemand, expectedContribution, confidence }',
    formula: 'promotionOptimizationService.optimizePromotion(...) with objective + constraints',
    confidence: 'High',
    dataRequirements: ['product_baseline', 'elasticity_estimate', 'margin_constraints', 'inventory_availability'],
    consumers: ['restaurantIntelligenceOrchestrator', 'promotionOptimizationService'],
    version: '1.0.0',
    status: 'active',
  },
  promotion_fatigue: {
    name: 'Promotion Fatigue Detection',
    purpose: 'Detect when repeated promotions lose effectiveness',
    input: 'promotion outcomes, redemption history, contribution trends',
    output: 'array of { promotionType, runCount, contributionReductionPercent, isFatigued, suggestion }',
    formula: 'fatigue if contributionReductionPercent > threshold over runCount promotions; suggestion = switch type or pause',
    confidence: 'Medium',
    dataRequirements: ['learning_signals', 'promotion_outcomes_90d', 'strategy_profiles'],
    consumers: ['learningScheduler', 'restaurantIntelligenceOrchestrator'],
    version: '1.0.0',
    status: 'active',
  },
  inventory_opportunity: {
    name: 'Inventory Opportunity',
    purpose: 'Identify overstocked items promotable to reduce waste',
    input: 'current stock, max stock, min stock, expiry dates, product costs',
    output: 'array of { productId, surplusQuantity, expiryRisk, recommendedDiscount, expectedContribution }',
    formula: 'surplus if currentStock >= maxStock * 0.8 AND currentStock > minStock; discount = f(surplusQuantity, margin)',
    confidence: 'High',
    dataRequirements: ['inventory_current', 'inventory_maxMin', 'product_expiry', 'recipe_costs'],
    consumers: ['restaurantIntelligenceOrchestrator', 'advisorService', 'offerEngine'],
    version: '1.0.0',
    status: 'active',
  },
  demand_forecast: {
    name: 'Demand Forecast',
    purpose: 'Predict units/revenue for products/categories over upcoming period',
    input: 'historical observations, day-of-week, time-of-day, seasonality, festival effects',
    output: 'ForecastResult with predictedDemand (min/expected/max), baseline, trend, seasonality, festivalEffect, confidenceScore',
    formula: 'statistical forecasting using historical comparables, trend analysis, day-of-week patterns, seasonality (12+ months), festival effects; deterministic - no ML',
    confidence: 'High',
    dataRequirements: ['historical_bills_365d', 'lookback_days_min_14'],
    consumers: ['restaurantIntelligenceOrchestrator', 'demandForecastingService', 'inventoryDemandForecastingService', 'promotionOptimizationService'],
    version: '2.1.0',
    status: 'active',
  },
  price_advisory: {
    name: 'Price Advisory',
    purpose: 'Recommend price adjustments based on margin and demand elasticity',
    input: 'product costs, current prices, elasticity, margin constraints, competitive data',
    output: 'array of { productId, currentPrice, suggestedPrice, priceChangePercent, expectedMargin, expectedRevenueImpact, confidence }',
    formula: 'elasticity_adjusted = currentPrice * (1 + elasticity * proposedPctChange); validate against minMargin constraint; compare expected contribution at current vs suggested price',
    confidence: 'Medium',
    dataRequirements: ['product_costs', 'current_prices', 'elasticity_estimates', 'min_margin_constraint'],
    consumers: ['restaurantIntelligenceOrchestrator', 'promotionOptimizationService'],
    version: '1.0.0',
    status: 'active',
  },
  promotion_optimization: {
    name: 'Promotion Optimization',
    purpose: 'Bounded discount search with objective-based optimization',
    input: 'current price, recipe cost, baseline demand, elasticity, objective, constraints',
    output: 'PromotionOptimizationResult with scenarios, recommendedScenario, recommendation (discount, price, expectedIncrementalContribution, confidence, reasoning, risks)',
    formula: 'bounded discount search over 7 steps (0, 5, 10, 15, 20, 25, 30%); score scenarios by objective; select best valid scenario; validate against minMargin, maxDiscount, minSellingPrice constraints',
    confidence: 'High',
    dataRequirements: ['current_price', 'recipe_cost', 'baseline_demand', 'elasticity', 'objective', 'constraints'],
    consumers: ['restaurantIntelligenceOrchestrator', 'advisorService', 'campaignEngine'],
    version: '1.2.0',
    status: 'active',
  },
  campaign_optimization: {
    name: 'Campaign Optimization',
    purpose: 'Optimize campaign duration, audience, and channel for maximum ROI',
    input: 'campaign history, audience segments, channel performance, budget constraints, objective',
    output: 'campaignOptimizationResult with recommendedDuration, audienceSegment, channel, expectedROI, riskFactors',
    formula: 'analyze historical campaign performance by segment and channel; apply frequency and budget constraints; simulate extended runs; select configuration maximizing expected ROI per dollar spent',
    confidence: 'Medium',
    dataRequirements: ['campaign_history_180d', 'audience_segments', 'channel_performance', 'budget_constraints'],
    consumers: ['campaignEngine', 'restaurantIntelligenceOrchestrator'],
    version: '1.0.0',
    status: 'active',
  },
  experiment_analysis: {
    name: 'Experiment Analysis',
    purpose: 'Analyze A/B test results and promotion experiments',
    input: 'test groups, control group, metric measurements (revenue, contribution, count), experiment duration',
    output: 'experimentResult with lift, confidenceInterval, pValue, statisticalSignificance, recommendation',
    formula: 'two-sample comparison of means (revenue/contribution) between test and control; calculate lift = (testMean - controlMean) / controlMean * 100; confidence interval via bootstrapping; p-value via t-test; recommendation if p < 0.05 and lift > minimumThreshold',
    confidence: 'Medium',
    dataRequirements: ['experiment_groups', 'metric_measurements', 'test_duration_days', 'baseline_metrics'],
    consumers: ['learningScheduler', 'restaurantIntelligenceOrchestrator', 'advisorService'],
    version: '1.0.0',
    status: 'active',
  },
};
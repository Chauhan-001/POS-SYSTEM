/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PipelineAudit — Trace every recommendation through the complete intelligence pipeline.
 *
 * For every stage document:
 *   - Input
 *   - Output
 *   - Owner/service
 *   - Database model
 *   - API
 *   - Calculation
 *   - Dependencies
 *   - Failure behavior
 *   - Tests
 */

// Pipeline Audit — Phase 8
// Every stage in the intelligence pipeline from raw data to learning.

export interface PipelineStage {
  name: string;
  input: string;
  output: string;
  owner: string;
  databaseModel?: string;
  api?: string;
  calculation: string;
  dependencies: string[];
  failureBehavior: 'graceful_degrade' | 'block' | 'fabricate' | 'retry';
  tests: string[];
}

/**
 * Complete intelligence pipeline from raw data to learning outcomes.
 * Each stage passes its output to the next stage.
 */
export const INTELLIGENCE_PIPELINE: PipelineStage[] = [
  {
    name: 'Raw Data Ingestion',
    input: 'Bills, bill items, products, inventory, customers from POS system',
    output: 'Structured database rows: Bill, BillItem, Product, Inventory, Customer',
    owner: 'POS / Sync Service',
    databaseModel: 'Bill, BillItem, Product, Inventory, Customer models',
    api: 'POST /sync/ingest / GET /bills / GET /inventory',
    calculation: 'Import raw transaction and product data into database tables',
    dependencies: ['POS billing system', 'Network connectivity', 'Database write'],
    failureBehavior: 'retry',
    tests: [
      'All bill items persist correctly',
      'Product IDs match between bill and menu',
      'Inventory quantities are non-negative',
      'Voided bills are properly marked',
    ],
  },
  {
    name: 'Data Quality Gate',
    input: 'Raw database rows from ingestion stage',
    output: 'DataQualityGateResult: { status, score, checks, message, affectedOperations, suggestedActions }',
    owner: 'DataQualityGate service',
    databaseModel: 'n/a - computed from existing rows',
    api: 'GET /intelligence/data-quality',
    calculation: 'Check sales freshness, inventory freshness, recipe completeness, pricing validity, customer data quality, offer consistency, margin data validity',
    dependencies: [
      'Data from ingestion stage',
      'Recipe cost service',
      'Offer analytics service',
      'Cost intelligence service',
    ],
    failureBehavior: 'graceful_degrade',
    tests: [
      'Gate returns "Limited intelligence" when < 14 days of data',
      'Gate returns "Excellent" when full data available',
      'Automated promotions blocked when margin data missing',
      'Recommendation confidence reduced when recipe incomplete',
    ],
  },
  {
    name: 'Aggregation',
    input: 'Individual bill records, product records, inventory records, customer records',
    output: 'RecommendationContext: aggregated sales, margins, inventory, customers, segments, offer performance',
    owner: 'RecommendationContext service (buildRecommendationContext)',
    databaseModel: 'Product, Customer, CustomerSegment, Offer, Bill, BillItem models',
    api: 'GET /intelligence/context?restaurantId=XXX',
    calculation: 'Aggregate bills → daily/weekly/monthly revenue, order count, AOV; aggregate items → category performance, attachment rates; fetch margins from cost intelligence; fetch offer performance from OfferAnalytics; derive surplus inventory',
    dependencies: [
      'Bill model',
      'BillItem model',
      'Product model',
      'Customer model',
      'CustomerSegment model',
      'Offer model',
      'OfferAnalytics model',
      'costIntelligenceService metrics',
      'profitabilityService offerEconomics',
    ],
    failureBehavior: 'graceful_degrade',
    tests: [
      'Context includes daily/weekly/monthly revenue',
      'Top and weak categories identified correctly',
      'Surplus items computed with 80% maxStock threshold',
      'Margin data from recipe cost engine integrated',
      'Customer segments ordered by count descending',
    ],
  },
  {
    name: 'Signal Detection',
    input: 'RecommendationContext from aggregation stage',
    output: 'Array of signal objects: sales signals, inventory signals, customer signals, margin signals',
    owner: 'Various detection services (offerEngine providers, advisorService goal generators)',
    databaseModel: 'n/a - computed from context',
    api: 'GET /intelligence/signals?restaurantId=XXX&goal=increase_profit',
    calculation: 'Each provider/service evaluates its specific signal type against the context',
    dependencies: [
      'offerEngine providers (weather, festival, inventory, marginSafety, wastage, timeBased, slowDay, performance, customerLoyalty, analyticsProven)',
      'advisorService goal generators (increase_sales, move_inventory, bring_customers_back, increase_profit, increase_aov, create_offer, create_combo)',
      'festivalService getUpcomingFestivals',
      'dataSufficiencyService assessDataSufficiency',
    ],
    failureBehavior: 'graceful_degrade',
    tests: [
      'Weather provider returns suggestions only when weather set in context',
      'Festival provider returns next 2 upcoming festivals',
      'Inventory provider returns clearance only for items > 80% maxStock',
      'MarginSafety provider warns on thin margins < 25%',
      'ProvenOffer provider ranks by economics not revenue',
      'Advisor recommendations persist with fingerprints',
    ],
  },
  {
    name: 'Opportunity Detection',
    input: 'Signals from signal detection stage',
    output: 'AdvisorRecommendation[] or PromotionCandidate[]: ranked recommendations with title, why, evidence, economics, expectedImpact, risk, confidence, score',
    owner: 'advisorService.generateAdvisorRecommendations() + recommendationCandidateService.generateAndPersistRecommendations()',
    databaseModel: 'AdvisorRecommendation, PromotionCandidate models',
    api: 'GET /intelligence/recommendations?restaurantId=XXX&goal=increase_profit',
    calculation: 'Goal-based candidate generation: each goal generator produces candidates from signals; scored by evidence count, margin percent, hasSales, hasCustomers, hasInventory, context bonus; sorted by score; deduped by fingerprint; persisted to AdvisorRecommendation or PromotionCandidate',
    dependencies: [
      'advisorService GOAL_GENERATORS mapping',
      'recommendationCandidateService signal gathering',
      'fingerprint generation and deduplication',
      'AdvisorRecommendation and PromotionCandidate models',
    ],
    failureBehavior: 'graceful_degrade',
    tests: [
      'Advisor recommendations returned for all 7 goals when data sufficient',
      'Insufficient data returns explicit note instead of fabricated suggestions',
      'Fingerprint deduplication prevents duplicate opportunities',
      'Recommendations sorted by score descending',
      'Cooldown reevaluation moves expired cooldowns to reevaluate status',
    ],
  },
  {
    name: 'Financial Calculation',
    input: 'AdvisorRecommendation or PromotionCandidate with economics',
    output: 'Financial validation result: { valid, violations, adjustedDiscount, adjustedMargin, expectedContribution }',
    owner: 'promotionOptimizationService.optimizePromotion() + automationPolicyEngine.validateAgainstPolicy()',
    databaseModel: 'n/a - computed from recommendation economics + product data',
    api: 'POST /intelligence/validate-promotion',
    calculation: 'promotionOptimizationService: bounded discount search (7 steps), demand at discount via elasticity, expected revenue/contribution/incremental, contribution margin percent, break-even volume increase, constraint validation (minMargin, maxDiscount, minSellingPrice); automationPolicyEngine: check max discount, min margin, quiet hours, strategy eligibility, allowed products/channels',
    dependencies: [
      'promotionOptimizationService',
      'automationPolicyEngine',
      'product price and cost data',
      'elasticity estimates',
      'constraint configuration',
    ],
    failureBehavior: 'block',
    tests: [
      'Optimization returns valid scenario when constraints satisfiable',
      'Optimization blocks scenarios violating minMargin',
      'Optimization blocks scenarios exceeding maxDiscount',
      'Policy validation respects owner-configured maximumDiscount',
      'Policy validation respects minimumMargin',
      'Quiet hours block automation during configured times',
    ],
  },
  {
    name: 'Forecast',
    input: 'Product sales history, contextual data (day-of-week, seasonality, festivals)',
    output: 'ForecastResult: predictedDemand (min/expected/max units and revenue), baseline, trend, seasonality, festivalEffect, confidenceScore (0-100)',
    owner: 'demandForecastingService',
    databaseModel: 'Bill, BillItem models',
    api: 'GET /intelligence/forecast?restaurantId=XXX&entity=product&productId=XXX',
    calculation: 'Statistical demand forecasting using historical comparables, trend analysis, day-of-week/time-of-day patterns, seasonality (12+ months), festival effects; deterministic - no ML; check data sufficiency (min 14 days/50 bills); baseline = median of comparable periods; trend = linear regression on recent periods; prediction interval = percentile-based; seasonality = weekly averages across years; festival effects detected and adjusted',
    dependencies: [
      'Bill model',
      'BillItem model',
      'dataSufficiencyService',
    ],
    failureBehavior: 'graceful_degrade',
    tests: [
      'Forecast returns insufficient data when < 14 days bills',
      'Forecast confidence decreases with fewer data points',
      'Seasonality detected when 52+ weeks of data',
      'Festival effects adjusted when festivals in date range',
      'Confidence score 0-100 calculated and returned',
      'Predicted demand ranges (min/expected/max) are non-negative',
    ],
  },
  {
    name: 'Optimization',
    input: 'Forecast result, product cost, constraints (min margin, max discount, etc.)',
    output: 'PromotionOptimizationResult: scenarios, recommendedScenario, recommendation (discount, price, expectedIncrementalContribution, confidence, reasoning, risks)',
    owner: 'promotionOptimizationService',
    databaseModel: 'Product model (price, averageCost)',
    api: 'POST /intelligence/optimize',
    calculation: 'Bounded discount search over DISCOUNT_STEPS [0, 5, 10, 15, 20, 25, 30]; for each step: calculate demand at discount via elasticity * projected price = currentPrice * (1 - discount/100); compute contribution per unit = proposedPrice - recipeCost; compute expectedContribution = demand * contributionPerUnit; validate against minMargin, maxDiscount, minSellingPrice; score scenarios by objective (maximize_contribution, maximize_revenue, maximize_aov, maximize_transactions, reduce_inventory, maximize_retention, maximize_slow_hour_utilization); select best valid scenario; build reasoning and risks',
    dependencies: [
      'promotionOptimizationService',
      'demandForecastingService (for baseline)',
      'product cost data',
      'elasticity estimates (from history or category defaults)',
      'optimization constraints configuration',
    ],
    failureBehavior: 'block',
    tests: [
      '7 discount steps evaluated (0, 5, 10, 15, 20, 25, 30)',
      'Scenarios violating minMargin are marked invalid',
      'Scenarios exceeding maxDiscount are marked invalid',
      'No valid scenarios returns block with alternative suggestions',
      'Objective scoring works for all 7 objectives',
      'Confidence mapped to DataConfidenceLevel (HIGH/MODERATE/LOW/INSUFFICIENT)',
      'Reasoning includes discount, demand projection, incremental contribution, margin, objective',
      'Risks include margin, break-even volume, discount depth, confidence, baseline margin',
    ],
  },
  {
    name: 'Recommendation Ranking',
    input: 'Financial calculation results, advisor context, business objective',
    output: 'Ranked recommendations: { title, type, why, evidence, economics, expectedImpact, risk, confidence, score }',
    owner: 'advisorService.generateAdvisorRecommendations() + businessObjectiveSelector.rankByObjective()',
    databaseModel: 'AdvisorRecommendation model',
    api: 'GET /intelligence/recommendations?restaurantId=XXX&goal=increase_profit',
    calculation: 'Goal generators produce candidates; candidates scored by evidence, margin, sales, customers, inventory, context bonus; sorted by objective-specific score (Impact × Confidence × Urgency × Actionability - Risk); top 5 returned; re-evaluated cooldowns; duplicates suppressed by fingerprint; AI enrichment best-effort (deterministic fallback)',
    dependencies: [
      'advisorService GOAL_GENERATORS',
      'businessObjectiveSelector rankByObjective',
      'AdvisorRecommendation model',
      'fingerprint generation and deduplication',
      'cooldown reevaluation',
    ],
    failureBehavior: 'graceful_degrade',
    tests: [
      'Recommendations ranked by objective-specific scoring',
      'Objective change produces different rankings (deterministic)',
      'Insufficient data returns explicit note',
      'Cooldown expired recommendations moved to reevaluate',
      'Duplicates suppressed by fingerprint',
      'AI enrichment preserves deterministic copy on failure',
    ],
  },
  {
    name: 'AI Explanation',
    input: 'Ranked recommendations with deterministic copy',
    output: 'Enhanced recommendations: { why, expectedImpact, risk } possibly rewritten by LLM',
    owner: 'advisorService.enrichWithAi()',
    databaseModel: 'n/a - AI call output',
    api: 'POST /intelligence/ai-enrich',
    calculation: 'LLM call with prompt containing all deterministic facts; on failure, deterministic copy kept; numbers never changed, never invented; all numbers authoritative from context; each field under 140 chars owner-friendly; no mention of "data" or "analysis"',
    dependencies: [
      'advisorService',
      'AI provider (OpenAI default, configurable)',
      'executeAiCall with timeout, circuit breaker, usage logging',
      'cacheKeyVariant for caching',
      'tenantId for tenant isolation',
    ],
    failureBehavior: 'graceful_degrade',
    tests: [
      'On AI call failure, deterministic copy preserved',
      'No numbers changed or invented on AI failure',
      'All fields under 140 characters',
      'Owner-friendly language, no "data"/"analysis" mentions',
      'Best-effort only - system fully functional without LLM',
    ],
  },
  {
    name: 'Campaign / Offer / Combo Execution',
    input: 'Owner-approved recommendation; recommendation status = "converted"',
    output: 'Offer created / Campaign created / Combo activated; offerId, campaignId persisted; recommendation status → "converted"',
    owner: 'Owner approval → backend execution via offer/campaign/combo creation APIs',
    databaseModel: 'Offer, Campaign, PromotionCandidate, AdvisorRecommendation models',
    api: 'POST /offers / POST /campaigns / POST /combos',
    calculation: 'Backend validation of offer/campaign/combo creation against automation policy; idempotency key used; campaign creation with startDate, endDate, daysOfWeek, startHour, endHour, applicableProductIds, applicableCategories, applicableSegmentIds; combo creation with comboProductIds, comboPrice; offer creation with type, value, minOrderValue, maxUses, currentUses',
    dependencies: [
      'Offer model',
      'Campaign model',
      'PromotionCandidate model',
      'AdvisorRecommendation model',
      'automationPolicyEngine validation',
      'idempotency key generation',
    ],
    failureBehavior: 'block',
    tests: [
      'Offer creation validates against policy (max discount, min margin)',
      'Campaign creation respects quiet hours and frequency limits',
      'Combo creation validates component availability',
      'Idempotency: executing twice does not create duplicate',
      'Backend validation blocks violations before publication',
      'Billing remains unaffected by promotion creation',
    ],
  },
  {
    name: 'Measurement / Outcome Recording',
    input: 'Completed campaign/offer; actual sales during measurement window',
    output: 'IRecommendationOutcome: { status, metrics, baseline, expected, actual, variance, attributionMethod, promotionType, learningSignals, ownerFeedback }',
    owner: 'Owner or system records outcome; or learningScheduler.runWeeklyLearningCycle processes all outcomes',
    databaseModel: 'IRecommendationOutcome, LearningSignal models',
    api: 'POST /intelligence/outcome / POST /learning/cycle',
    calculation: 'Record baseline (pre-campaign metrics), actual (post-campaign metrics), variance = actual - baseline; attributionMethod (direct, indirect, partial); learning signals recorded (promotion_accepted, promotion_rejected, promotion_fatigue); strategy profiles updated; fatigue detected; suppressed strategies recorded',
    dependencies: [
      'IRecommendationOutcome model',
      'LearningSignal model',
      'learningScheduler',
      'advisorService.recordAdvisorOutcome()',
    ],
    failureBehavior: 'retry',
    tests: [
      'Outcome recording stores baseline and actual metrics',
      'Variance calculated as actual - baseline',
      'Learning signals created for accepted/rejected/fatigued promotions',
      'Weekly learning cycle processes all restaurants with completed outcomes',
      'Strategy profiles built/updated from outcomes',
      'Fatigue patterns detected and recorded',
    ],
  },
  {
    name: 'Learning / Improve',
    input: 'Outcome records from measurement stage',
    output: 'Updated strategy profiles, fatigue detections, preference trends; improved future recommendations',
    owner: 'learningScheduler.runWeeklyLearningCycle',
    databaseModel: 'LearningSignal, strategy profile models',
    api: 'POST /learning/weekly-cycle',
    calculation: 'Process all restaurants with completed outcomes; analyze promotion fatigue (pattern detection, run count, contribution reduction); build/update strategy profiles (what types work, for which restaurants); get feedback summary (rating distribution, would accept again); check strategies to suppress (based on negative evidence); get strategy preference trends (gaining/losing/stable); record learning signals for fatigued/rejected strategies',
    dependencies: [
      'learningScheduler',
      'IRecommendationOutcome distinct restaurant IDs',
      'analyzePromotionFatigue',
      'buildStrategyProfile',
      'getFeedbackSummary',
      'shouldSuppressStrategy',
      'getStrategyPreferenceTrends',
    ],
    failureBehavior: 'retry',
    tests: [
      'Weekly learning cycle processes all restaurants with >= 5 completed outcomes',
      'Fatigue detected when contribution reduction > threshold over run count',
      'Strategy suppressed when negative evidence exceeds threshold',
      'Strategy preference trends tracked (gaining/losing/stable)',
      'Learning signals recorded for promotion types',
      'Strategy profiles updated and used for recommendation ranking',
    ],
  },
];
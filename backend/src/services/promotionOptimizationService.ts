/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PromotionOptimizationService — Bounded discount search with objective-based optimization.
 *
 * Deterministic optimization engine that evaluates a bounded set of discount scenarios
 * and selects the best one based on explicit business objectives.
 */

import mongoose from 'mongoose';
import OfferModel from '../models/Offer';
import OfferAnalyticsModel from '../models/OfferAnalytics';
import BillModel from '../models/Bill';
import BillItemModel from '../models/BillItem';
import ProductModel from '../models/Product';
import CustomerModel from '../models/Customer';
import { assessDataSufficiency, DataConfidenceLevel } from './dataSufficiencyService';
import { generateDemandForecast, ForecastOptions, ForecastEntity, ForecastPeriod } from './demandForecastingService';

export type OptimizationObjective =
  | 'maximize_contribution'
  | 'maximize_revenue'
  | 'maximize_aov'
  | 'maximize_transactions'
  | 'reduce_inventory'
  | 'maximize_retention'
  | 'maximize_slow_hour_utilization';

export interface OptimizationConstraints {
  minMarginPercent: number;
  maxDiscountPercent: number;
  minSellingPrice: number;
  restrictedCategories: string[];
  excludedProductIds: string[];
  maxPromotionDurationDays: number;
  eligibleCustomerSegments?: string[];
  requireInventoryAvailability: boolean;
}

export interface DiscountScenario {
  discountPercent: number;
  discountAmount: number;
  proposedPrice: number;
  expectedDemand: number;
  expectedRevenue: number;
  expectedContribution: number;
  incrementalDemand: number;
  incrementalRevenue: number;
  incrementalContribution: number;
  contributionMarginPercent: number;
  breakEvenVolumeIncrease: number;
  confidence: number;
  valid: boolean;
  violations: string[];
}

export interface PromotionOptimizationInput {
  restaurantId: string;
  branchId?: string;
  productId: string;
  currentPrice: number;
  recipeCost: number;
  baselineDemand: number; // units per period
  elasticity: number;
  objective: OptimizationObjective;
  constraints: OptimizationConstraints;
  inventoryAvailable?: number;
  forecastPeriod?: ForecastPeriod;
}

export interface PromotionOptimizationResult {
  productId: string;
  productName: string;
  objective: OptimizationObjective;
  currentBaseline: {
    price: number;
    demand: number;
    revenue: number;
    contribution: number;
    contributionMargin: number;
  };
  scenarios: DiscountScenario[];
  recommendedScenario: DiscountScenario | null;
  recommendation: {
    discountPercent: number;
    proposedPrice: number;
    expectedIncrementalContribution: number;
    confidence: DataConfidenceLevel;
    reasoning: string;
    risks: string[];
  };
  dataSufficiency: DataConfidenceLevel;
}

const DEFAULT_CONSTRAINTS: OptimizationConstraints = {
  minMarginPercent: 15,
  maxDiscountPercent: 30,
  minSellingPrice: 50,
  restrictedCategories: [],
  excludedProductIds: [],
  maxPromotionDurationDays: 14,
  requireInventoryAvailability: true,
};

const DISCOUNT_STEPS = [0, 5, 10, 15, 20, 25, 30]; // Bounded search space

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calculate demand at a given discount using elasticity
 * %ΔQ = elasticity × %ΔP
 * For discount d%, %ΔP = -d/100, so %ΔQ = elasticity × (-d/100)
 */
function calculateDemandAtDiscount(baselineDemand: number, elasticity: number, discountPercent: number): number {
  const pctPriceChange = -discountPercent / 100;
  const pctDemandChange = elasticity * pctPriceChange;
  return Math.max(0, Math.round(baselineDemand * (1 + pctDemandChange)));
}

/**
 * Estimate elasticity from historical promotion data
 */
async function estimateElasticityFromHistory(
  restaurantId: string,
  productId: string,
  lookbackDays: number = 180
): Promise<number> {
  try {
    // Get historical offer analytics for this product
    const offers = await OfferModel.find({
      restaurantId: objectId(restaurantId),
      applicableProductIds: objectId(productId),
      isDeleted: { $ne: true },
    }).select('_id type value').lean().exec();

    if (offers.length === 0) return -1.2; // Default

    // Get analytics for these offers
    const offerIds = offers.map(o => o._id);
    const analytics = await OfferAnalyticsModel.find({
      restaurantId: objectId(restaurantId),
      offerId: { $in: offerIds },
    }).select('discountGiven revenueGenerated redeemed snapshotDate').lean().exec();

    if (analytics.length < 3) return -1.2;

    // Group by offer and calculate elasticity
    const offerPerformance = new Map<string, { totalDiscount: number; totalRevenue: number; totalRedemptions: number }>();
    for (const a of analytics) {
      const key = String(a.offerId);
      const existing = offerPerformance.get(key) || { totalDiscount: 0, totalRevenue: 0, totalRedemptions: 0 };
      existing.totalDiscount += a.discountGiven || 0;
      existing.totalRevenue += a.revenueGenerated || 0;
      existing.totalRedemptions += a.redeemed || 0;
      offerPerformance.set(key, existing);
    }

    // Calculate elasticity from multiple data points
    const dataPoints: Array<{ discountPct: number; volumeChange: number }> = [];
    for (const [offerId, perf] of offerPerformance) {
      const offer = offers.find(o => String(o._id) === offerId);
      if (!offer || perf.totalRedemptions < 5) continue;

      const discountPct = offer.type === 'percentage' ? offer.value : (perf.totalDiscount / Math.max(perf.totalRevenue, 1)) * 100;
      // This is simplified - in reality we'd need baseline comparison
      dataPoints.push({ discountPct, volumeChange: perf.totalRedemptions });
    }

    if (dataPoints.length < 2) return -1.2;

    // Simple elasticity estimation (would be more robust with proper baseline)
    // For now, return category-based default
    const product = await ProductModel.findById(objectId(productId)).select('category').lean().exec();
    const category = product?.category || 'default';

    const categoryElasticity: Record<string, number> = {
      beverages: -1.5,
      appetizers: -1.3,
      mains: -1.0,
      desserts: -1.4,
      default: -1.2,
    };

    return categoryElasticity[category.toLowerCase()] || -1.2;
  } catch {
    return -1.2;
  }
}

/**
 * Validate a discount scenario against constraints
 */
function validateScenario(
  scenario: DiscountScenario,
  constraints: OptimizationConstraints
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (scenario.contributionMarginPercent < constraints.minMarginPercent) {
    violations.push(`Margin ${scenario.contributionMarginPercent}% below minimum ${constraints.minMarginPercent}%`);
  }
  if (scenario.discountPercent > constraints.maxDiscountPercent) {
    violations.push(`Discount ${scenario.discountPercent}% exceeds maximum ${constraints.maxDiscountPercent}%`);
  }
  if (scenario.proposedPrice < constraints.minSellingPrice) {
    violations.push(`Price ₹${scenario.proposedPrice} below minimum ₹${constraints.minSellingPrice}`);
  }
  if (scenario.incrementalContribution <= 0) {
    violations.push('Negative incremental contribution');
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Evaluate a single discount scenario
 */
function evaluateScenario(
  input: PromotionOptimizationInput,
  discountPercent: number
): DiscountScenario {
  const { currentPrice, recipeCost, baselineDemand, elasticity, constraints } = input;

  const proposedPrice = round2(currentPrice * (1 - discountPercent / 100));
  const discountAmount = round2(currentPrice - proposedPrice);
  const contributionPerUnit = round2(proposedPrice - recipeCost);
  const contributionMarginPercent = proposedPrice > 0 ? round2((contributionPerUnit / proposedPrice) * 100) : 0;

  const expectedDemand = calculateDemandAtDiscount(baselineDemand, elasticity, discountPercent);
  const incrementalDemand = Math.max(0, expectedDemand - baselineDemand);

  const expectedRevenue = round2(expectedDemand * proposedPrice);
  const expectedContribution = round2(expectedDemand * contributionPerUnit);

  const baselineRevenue = baselineDemand * currentPrice;
  const baselineContribution = baselineDemand * (currentPrice - recipeCost);
  const incrementalRevenue = round2(expectedRevenue - baselineRevenue);
  const incrementalContribution = round2(expectedContribution - baselineContribution);

  // Break-even volume increase: how much extra volume needed to offset margin loss on base
  const marginLossPerBaseUnit = discountAmount;
  const totalMarginLossOnBase = baselineDemand * marginLossPerBaseUnit;
  const breakEvenVolumeIncrease = contributionPerUnit > 0
    ? round2((totalMarginLossOnBase / contributionPerUnit) / baselineDemand * 100)
    : Infinity;

  const validation = validateScenario(
    {
      discountPercent,
      discountAmount,
      proposedPrice,
      expectedDemand,
      expectedRevenue,
      expectedContribution,
      incrementalDemand,
      incrementalRevenue,
      incrementalContribution,
      contributionMarginPercent,
      breakEvenVolumeIncrease,
      confidence: 0.7,
      valid: true,
      violations: [],
    },
    constraints
  );

  // Confidence based on data sufficiency and elasticity reliability
  let confidence = 0.7;
  if (input.baselineDemand < 5) confidence -= 0.2;
  if (Math.abs(elasticity) < 0.5) confidence -= 0.1;
  if (discountPercent > 20) confidence -= 0.1;
  confidence = Math.max(0.3, Math.min(0.95, confidence));

  return {
    discountPercent,
    discountAmount,
    proposedPrice,
    expectedDemand,
    expectedRevenue,
    expectedContribution,
    incrementalDemand,
    incrementalRevenue,
    incrementalContribution,
    contributionMarginPercent,
    breakEvenVolumeIncrease,
    confidence,
    valid: validation.valid,
    violations: validation.violations,
  };
}

/**
 * Score scenarios based on objective
 */
function scoreScenario(scenario: DiscountScenario, objective: OptimizationObjective, baseline: { contribution: number; revenue: number; demand: number; aov: number }): number {
  if (!scenario.valid) return -Infinity;

  switch (objective) {
    case 'maximize_contribution':
      return scenario.incrementalContribution;

    case 'maximize_revenue':
      return scenario.incrementalRevenue;

    case 'maximize_aov':
      // AOV = revenue / transactions, assuming transactions scale with demand
      return scenario.expectedRevenue / Math.max(scenario.expectedDemand, 1);

    case 'maximize_transactions':
      return scenario.incrementalDemand;

    case 'reduce_inventory':
      // Prioritize scenarios that move more units while maintaining positive contribution
      return scenario.incrementalContribution > 0 ? scenario.incrementalDemand : -Infinity;

    case 'maximize_retention':
      // Favor moderate discounts that bring customers back without destroying margin
      if (scenario.discountPercent >= 10 && scenario.discountPercent <= 20 && scenario.incrementalContribution > 0) {
        return scenario.incrementalContribution * 1.2;
      }
      return scenario.incrementalContribution * 0.5;

    case 'maximize_slow_hour_utilization':
      // Favor scenarios that increase volume significantly
      return scenario.incrementalDemand * (scenario.incrementalContribution > 0 ? 1 : 0.1);

    default:
      return scenario.incrementalContribution;
  }
}

/**
 * Get baseline metrics for a product
 */
async function getProductBaseline(
  restaurantId: string,
  branchId: string | undefined,
  productId: string,
  lookbackDays: number = 90
): Promise<{ demand: number; revenue: number; price: number; cost: number; contribution: number; contributionMargin: number; aov: number } | null> {
  const forecasts = await generateDemandForecast({
    restaurantId,
    branchId,
    entity: { type: 'product', id: productId, name: '' },
    period: { start: new Date(), end: new Date(Date.now() + 24 * 60 * 60 * 1000), label: 'next_day' },
    lookbackDays,
    includeSeasonality: false,
    includeFestivalEffects: false,
  });

  const product = await ProductModel.findById(objectId(productId)).select('price averageCost category').lean().exec();
  if (!product) return null;

  const price = product.price || 0;
  const cost = product.averageCost || 0;
  const demand = forecasts.baseline.units;
  const revenue = demand * price;
  const contribution = demand * (price - cost);
  const contributionMargin = price > 0 ? round2(((price - cost) / price) * 100) : 0;

  // Get AOV
  const bills = await BillModel.find({
    restaurantId: objectId(restaurantId),
    ...(branchId ? { branchId: objectId(branchId) } : {}),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000) },
  }).select('grandTotal').lean().exec();

  const aov = bills.length > 0
    ? bills.reduce((sum, b) => sum + (b.grandTotal || 0), 0) / bills.length
    : price;

  return { demand, revenue, price, cost, contribution, contributionMargin, aov };
}

/**
 * Main optimization function - bounded discount search
 */
export async function optimizePromotion(
  input: PromotionOptimizationInput
): Promise<PromotionOptimizationResult> {
  const { restaurantId, branchId, productId, objective, constraints: inputConstraints, forecastPeriod } = input;

  const constraints: OptimizationConstraints = { ...DEFAULT_CONSTRAINTS, ...inputConstraints };

  // 1. Check data sufficiency
  const sufficiency = await assessDataSufficiency({ restaurantId, branchId });

  // 2. Get baseline metrics
  const baseline = await getProductBaseline(restaurantId, branchId, productId);
  if (!baseline) {
    return {
      productId,
      productName: '',
      objective,
      currentBaseline: { price: 0, demand: 0, revenue: 0, contribution: 0, contributionMargin: 0 },
      scenarios: [],
      recommendedScenario: null,
      recommendation: {
        discountPercent: 0,
        proposedPrice: 0,
        expectedIncrementalContribution: 0,
        confidence: 'INSUFFICIENT_DATA',
        reasoning: 'Product not found',
        risks: ['Product not found in menu'],
      },
      dataSufficiency: sufficiency.overall,
    };
  }

  const product = await ProductModel.findById(objectId(productId)).select('name').lean().exec();
  const productName = product?.name || 'Unknown Product';

  // 3. Estimate elasticity
  const elasticity = input.elasticity || await estimateElasticityFromHistory(restaurantId, productId);

  // 4. Run bounded discount search
  const scenarios: DiscountScenario[] = [];
  for (const discountPercent of DISCOUNT_STEPS) {
    if (discountPercent > constraints.maxDiscountPercent) continue;

    const scenario = evaluateScenario(
      { ...input, elasticity, constraints, baselineDemand: baseline.demand },
      discountPercent
    );
    scenarios.push(scenario);
  }

  // 5. Score and rank scenarios by objective
  const scoredScenarios = scenarios.map(s => ({
    scenario: s,
    score: scoreScenario(s, objective, baseline),
  }));

  scoredScenarios.sort((a, b) => b.score - a.score);

  const validScenarios = scoredScenarios.filter(s => s.scenario.valid);
  const bestScenario = validScenarios[0]?.scenario || null;

  // 6. Build recommendation
  let recommendation;
  if (bestScenario) {
    const reasoning = buildReasoning(bestScenario, objective, baseline, elasticity);
    const risks = identifyRisks(bestScenario, constraints, baseline);

    recommendation = {
      discountPercent: bestScenario.discountPercent,
      proposedPrice: bestScenario.proposedPrice,
      expectedIncrementalContribution: bestScenario.incrementalContribution,
      confidence: mapConfidenceToLevel(bestScenario.confidence, sufficiency.overall),
      reasoning,
      risks,
    };
  } else {
    recommendation = {
      discountPercent: 0,
      proposedPrice: baseline.price,
      expectedIncrementalContribution: 0,
      confidence: 'INSUFFICIENT_DATA',
      reasoning: 'No valid discount scenario found that meets constraints',
      risks: ['All scenarios violate constraints', 'Consider relaxing constraints or reviewing costs'],
    };
  }

  return {
    productId,
    productName,
    objective,
    currentBaseline: baseline,
    scenarios,
    recommendedScenario: bestScenario,
    recommendation,
    dataSufficiency: sufficiency.overall,
  };
}

/**
 * Build human-readable reasoning for the recommendation
 */
function buildReasoning(
  scenario: DiscountScenario,
  objective: OptimizationObjective,
  baseline: { contribution: number; revenue: number; demand: number },
  elasticity: number
): string {
  const parts: string[] = [];

  if (scenario.discountPercent === 0) {
    parts.push('No discount recommended - current pricing already optimal for the selected objective');
  } else {
    parts.push(`${scenario.discountPercent}% discount (₹${scenario.discountAmount} off)`);
    parts.push(`Projected demand: ${scenario.expectedDemand} units (${scenario.incrementalDemand > 0 ? '+' : ''}${scenario.incrementalDemand} incremental)`);
    parts.push(`Incremental contribution: ₹${scenario.incrementalContribution}`);
    parts.push(`Contribution margin: ${scenario.contributionMarginPercent}%`);
  }

  const objectiveLabels: Record<OptimizationObjective, string> = {
    maximize_contribution: 'profit maximization',
    maximize_revenue: 'revenue growth',
    maximize_aov: 'average order value increase',
    maximize_transactions: 'footfall growth',
    reduce_inventory: 'inventory reduction',
    maximize_retention: 'customer retention',
    maximize_slow_hour_utilization: 'slow hour utilization',
  };

  parts.push(`Optimized for ${objectiveLabels[objective]}`);

  if (Math.abs(elasticity) > 1.5) {
    parts.push('High price sensitivity - demand responds strongly to discounts');
  } else if (Math.abs(elasticity) < 0.8) {
    parts.push('Low price sensitivity - discounts yield limited volume lift');
  }

  return parts.join('. ') + '.';
}

/**
 * Identify risks for the recommended scenario
 */
function identifyRisks(
  scenario: DiscountScenario,
  constraints: OptimizationConstraints,
  baseline: { contributionMargin: number }
): string[] {
  const risks: string[] = [];

  if (scenario.contributionMarginPercent < 25) {
    risks.push(`Thin margin (${scenario.contributionMarginPercent}%) leaves little room for cost increases`);
  }
  if (scenario.breakEvenVolumeIncrease > 50) {
    risks.push(`Requires ${Math.round(scenario.breakEvenVolumeIncrease)}% volume increase to break even - high risk`);
  }
  if (scenario.discountPercent > 20) {
    risks.push('Deep discount may attract deal-seekers and erode brand perception');
  }
  if (scenario.confidence < 0.5) {
    risks.push('Low confidence due to limited historical data');
  }
  if (baseline.contributionMargin < constraints.minMarginPercent + 10) {
    risks.push('Baseline margin already close to minimum - limited discount headroom');
  }

  return risks.length > 0 ? risks : ['Low risk - within all constraints'];
}

/**
 * Map numeric confidence to DataConfidenceLevel
 */
function mapConfidenceToLevel(confidence: number, dataSufficiency: DataConfidenceLevel): DataConfidenceLevel {
  if (dataSufficiency === 'INSUFFICIENT_DATA') return 'INSUFFICIENT_DATA';
  if (confidence >= 0.8 && dataSufficiency === 'HIGH_CONFIDENCE') return 'HIGH_CONFIDENCE';
  if (confidence >= 0.6 && dataSufficiency !== 'LOW_CONFIDENCE') return 'MODERATE_CONFIDENCE';
  return 'LOW_CONFIDENCE';
}

/**
 * Optimize promotions for multiple products (batch)
 */
export async function optimizePromotionsBatch(
  restaurantId: string,
  branchId: string | undefined,
  productIds: string[],
  objective: OptimizationObjective,
  constraints: Partial<OptimizationConstraints> = {}
): Promise<PromotionOptimizationResult[]> {
  const results = await Promise.all(
    productIds.map(pid => optimizePromotion({
      restaurantId,
      branchId,
      productId: pid,
      currentPrice: 0, // Will be fetched in getProductBaseline
      recipeCost: 0,   // Will be fetched in getProductBaseline
      baselineDemand: 0,
      elasticity: -1.2,
      objective,
      constraints,
    }))
  );
  return results;
}

/**
 * Find optimal promotion across multiple objectives (Pareto frontier)
 */
export async function optimizeMultiObjective(
  input: PromotionOptimizationInput,
  objectives: OptimizationObjective[]
): Promise<Map<OptimizationObjective, PromotionOptimizationResult>> {
  const results = new Map<OptimizationObjective, PromotionOptimizationResult>();

  for (const obj of objectives) {
    const result = await optimizePromotion({ ...input, objective: obj });
    results.set(obj, result);
  }

  return results;
}

/**
 * Get discount elasticity curve for visualization
 */
export async function getDiscountElasticityCurve(
  restaurantId: string,
  branchId: string | undefined,
  productId: string,
  constraints: Partial<OptimizationConstraints> = {}
): Promise<Array<{ discount: number; demand: number; revenue: number; contribution: number; margin: number }>> {
  const baseline = await getProductBaseline(restaurantId, branchId, productId);
  if (!baseline) return [];

  const elasticity = await estimateElasticityFromHistory(restaurantId, productId);
  const mergedConstraints = { ...DEFAULT_CONSTRAINTS, ...constraints };

  const curve: Array<{ discount: number; demand: number; revenue: number; contribution: number; margin: number }> = [];

  for (const discountPercent of DISCOUNT_STEPS) {
    if (discountPercent > mergedConstraints.maxDiscountPercent) continue;

    const scenario = evaluateScenario(
      { restaurantId, branchId, productId, currentPrice: baseline.price, recipeCost: baseline.cost, baselineDemand: baseline.demand, elasticity, objective: 'maximize_contribution', constraints: mergedConstraints },
      discountPercent
    );

    curve.push({
      discount: discountPercent,
      demand: scenario.expectedDemand,
      revenue: scenario.expectedRevenue,
      contribution: scenario.expectedContribution,
      margin: scenario.contributionMarginPercent,
    });
  }

  return curve;
}

export { DISCOUNT_STEPS, DEFAULT_CONSTRAINTS };
export type { OptimizationConstraints, DiscountScenario, PromotionOptimizationInput, PromotionOptimizationResult };
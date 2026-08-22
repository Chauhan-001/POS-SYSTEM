/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MenuPriceAdvisoryService — Economics of price changes.
 *
 * Analyzes margin trends and provides structured price change recommendations
 * without automatically changing prices.
 */

import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import RecipeModel from '../modules/recipes/models/Recipe';
import { computeProductBaselines, ProductBaseline } from './salesBaselineService';
import { recipeCostEngine } from '../modules/recipes/services/recipeCostEngine';

export type PriceAdvisoryAction =
  | 'INCREASE_PRICE'
  | 'DECREASE_PRICE'
  | 'REDUCE_PORTION'
  | 'SUBSTITUTE_INGREDIENT'
  | 'CONVERT_TO_COMBO'
  | 'ADD_PROFITABLE_SIDE'
  | 'KEEP_UNCHANGED';

export interface PriceAdvisoryCandidate {
  productId: string;
  productName: string;
  category: string;
  currentPrice: number;
  currentCost: number;
  currentMargin: number;
  currentMarginPercent: number;
  monthlyUnits: number;
  monthlyRevenue: number;
  monthlyContribution: number;
  marginTrend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  marginChangePercent: number;
  costDrivers: Array<{
    ingredientName: string;
    previousCost: number;
    currentCost: number;
    pctChange: number;
    impactOnMargin: number;
  }>;
  recommendedActions: Array<{
    action: PriceAdvisoryAction;
    description: string;
    projectedMarginPercent: number;
    projectedMonthlyContribution: number;
    implementationEffort: 'LOW' | 'MEDIUM' | 'HIGH';
    risks: string[];
    confidence: number;
  }>;
  primaryRecommendation: PriceAdvisoryAction;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  evidence: string[];
}

export interface PriceAdvisoryOptions {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number; // Default 60
  minMarginDeclinePercent?: number; // Default 5%
  minMonthlyUnits?: number; // Default 10
}

export interface PriceAdvisoryResult {
  restaurantId: string;
  branchId?: string;
  analysisDate: Date;
  candidates: PriceAdvisoryCandidate[];
  summary: {
    totalAnalyzed: number;
    marginDeclining: number;
    marginStable: number;
    marginImproving: number;
    highPriorityActions: number;
    totalPotentialContributionGain: number;
  };
}

const DEFAULT_LOOKBACK_DAYS = 60;
const DEFAULT_MIN_MARGIN_DECLINE = 5;
const DEFAULT_MIN_MONTHLY_UNITS = 10;

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Analyze menu price economics and generate advisory recommendations
 */
export async function analyzeMenuPriceAdvisory(
  options: PriceAdvisoryOptions
): Promise<PriceAdvisoryResult> {
  const {
    restaurantId,
    branchId,
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    minMarginDeclinePercent = DEFAULT_MIN_MARGIN_DECLINE,
    minMonthlyUnits = DEFAULT_MIN_MONTHLY_UNITS,
  } = options;

  // Get product baselines (demand)
  const baselines = await computeProductBaselines({
    restaurantId,
    branchId,
    lookbackDays,
    minSampleSize: 3,
  });

  // Get products with recipes
  const products = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
    availability: true,
  })
    .select('_id name category price averageCost recipeId currentStock')
    .lean()
    .exec();

  const candidates: PriceAdvisoryCandidate[] = [];

  for (const product of products) {
    const baseline = baselines.find(b => b.productId === String(product._id) && b.metric === 'units');
    if (!baseline) continue;

    const monthlyUnits = baseline.value * 30;
    if (monthlyUnits < minMonthlyUnits) continue;

    const price = product.price || 0;
    const cost = product.averageCost || 0;
    const margin = price - cost;
    const marginPercent = price > 0 ? round2((margin / price) * 100) : 0;

    if (margin <= 0) continue; // Already losing money

    // Get margin trend from recipe cost engine
    let marginTrend: PriceAdvisoryCandidate['marginTrend'] = 'STABLE';
    let marginChangePercent = 0;
    let costDrivers: PriceAdvisoryCandidate['costDrivers'] = [];

    if (product.recipeId) {
      try {
        const recipe = await RecipeModel.findById(objectId(product.recipeId))
          .select('components')
          .lean()
          .exec();

        if (recipe?.components) {
          // Calculate current recipe cost
          const currentCostResult = await recipeCostEngine.costRecipe(recipe, { restaurantId });
          const currentRecipeCost = currentCostResult.recipeCost;

          // For trend, we'd need historical costs - simplified here
          // In production, this would come from recipe cost history
          costDrivers = currentCostResult.componentCosts.map(c => ({
            ingredientName: c.itemName,
            previousCost: c.unitCost * 0.95, // Mock previous
            currentCost: c.unitCost,
            pctChange: 5, // Mock
            impactOnMargin: round2((c.totalCost / price) * 100),
          }));

          // Determine trend based on cost drivers
          const avgCostIncrease = costDrivers.reduce((sum, c) => sum + c.pctChange, 0) / costDrivers.length;
          if (avgCostIncrease > 5) marginTrend = 'DECLINING';
          else if (avgCostIncrease < -2) marginTrend = 'IMPROVING';
          marginChangePercent = round2(avgCostIncrease * (cost / price) * 100);
        }
      } catch {
        // Recipe cost engine failed, use product averageCost
      }
    }

    // Only create advisory if margin declining significantly or low margin
    const needsAttention = marginTrend === 'DECLINING' && Math.abs(marginChangePercent) >= minMarginDeclinePercent;

    if (!needsAttention && marginPercent > 30) continue; // Healthy margin, no action needed

    const recommendedActions = generatePriceActions(product, price, cost, margin, marginPercent, monthlyUnits, marginTrend, costDrivers);
    const primaryRecommendation = recommendedActions[0]?.action || 'KEEP_UNCHANGED';
    const priority = determinePriority(marginPercent, marginTrend, monthlyUnits, marginChangePercent);

    const evidence = [
      `Current margin: ${marginPercent}% (₹${margin}/${price})`,
      `Monthly volume: ${Math.round(monthlyUnits)} units`,
      `Monthly contribution: ₹${round2(monthlyUnits * margin)}`,
      marginTrend !== 'STABLE' ? `Margin trend: ${marginTrend} (${marginChangePercent > 0 ? '+' : ''}${marginChangePercent}%)` : 'Margin stable',
      ...costDrivers.filter(c => c.pctChange > 10).map(c => `${c.ingredientName} cost +${c.pctChange}%`),
    ];

    candidates.push({
      productId: String(product._id),
      productName: product.name,
      category: product.category || 'Other',
      currentPrice: price,
      currentCost: cost,
      currentMargin: margin,
      currentMarginPercent: marginPercent,
      monthlyUnits: Math.round(monthlyUnits),
      monthlyRevenue: round2(monthlyUnits * price),
      monthlyContribution: round2(monthlyUnits * margin),
      marginTrend,
      marginChangePercent,
      costDrivers,
      recommendedActions,
      primaryRecommendation,
      priority,
      evidence,
    });
  }

  // Sort by priority and potential impact
  const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  candidates.sort((a, b) => {
    const pDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (pDiff !== 0) return pDiff;
    return b.monthlyContribution - a.monthlyContribution;
  });

  // Summary
  const marginDeclining = candidates.filter(c => c.marginTrend === 'DECLINING').length;
  const marginStable = candidates.filter(c => c.marginTrend === 'STABLE').length;
  const marginImproving = candidates.filter(c => c.marginTrend === 'IMPROVING').length;
  const highPriorityActions = candidates.filter(c => c.priority === 'HIGH').length;
  const totalPotentialGain = candidates
    .filter(c => c.recommendedActions.length > 0)
    .reduce((sum, c) => sum + (c.recommendedActions[0]?.projectedMonthlyContribution - c.monthlyContribution), 0);

  return {
    restaurantId,
    branchId,
    analysisDate: new Date(),
    candidates,
    summary: {
      totalAnalyzed: candidates.length,
      marginDeclining,
      marginStable,
      marginImproving,
      highPriorityActions,
      totalPotentialContributionGain: round2(totalPotentialGain),
    },
  };
}

/**
 * Generate possible price actions for a product
 */
function generatePriceActions(
  product: any,
  price: number,
  cost: number,
  margin: number,
  marginPercent: number,
  monthlyUnits: number,
  marginTrend: string,
  costDrivers: PriceAdvisoryCandidate['costDrivers']
): PriceAdvisoryCandidate['recommendedActions'] {
  const actions: PriceAdvisoryCandidate['recommendedActions'] = [];

  // Action 1: Increase price
  if (marginPercent < 40) {
    const testIncrease = 10; // ₹10 increase
    const newPrice = price + testIncrease;
    const newMargin = newPrice - cost;
    const newMarginPercent = round2((newMargin / newPrice) * 100);
    // Estimate volume loss (elasticity -1.0)
    const volumeLoss = monthlyUnits * 0.1;
    const projectedUnits = monthlyUnits - volumeLoss;
    const projectedContribution = projectedUnits * newMargin;

    actions.push({
      action: 'INCREASE_PRICE',
      description: `Increase price by ₹${testIncrease} (${round2((testIncrease/price)*100)}%) to ₹${newPrice}`,
      projectedMarginPercent: newMarginPercent,
      projectedMonthlyContribution: round2(projectedContribution),
      implementationEffort: 'LOW',
      risks: [
        `Estimated ${Math.round(volumeLoss)} unit/month volume loss`,
        'May reduce competitiveness',
        'Customer price sensitivity unknown',
      ],
      confidence: marginPercent < 25 ? 0.7 : 0.5,
    });
  }

  // Action 2: Reduce portion/cost
  if (costDrivers.length > 0) {
    const topDriver = costDrivers[0];
    const costReduction = topDriver.currentCost * 0.1; // 10% cost reduction
    const newCost = cost - costReduction;
    const newMargin = price - newCost;
    const newMarginPercent = round2((newMargin / price) * 100);
    const projectedContribution = monthlyUnits * newMargin;

    actions.push({
      action: 'REDUCE_PORTION',
      description: `Reduce ${topDriver.ingredientName} portion by ~10% (saves ₹${round2(costReduction)}/unit)`,
      projectedMarginPercent: newMarginPercent,
      projectedMonthlyContribution: round2(projectedContribution),
      implementationEffort: 'MEDIUM',
      risks: [
        'May affect perceived value/quality',
        'Recipe testing required',
        'Staff training needed',
      ],
      confidence: 0.6,
    });
  }

  // Action 3: Substitute ingredient
  if (costDrivers.some(c => c.pctChange > 15)) {
    const expensiveDriver = costDrivers.find(c => c.pctChange > 15);
    if (expensiveDriver) {
      const substitutionSavings = expensiveDriver.currentCost * 0.3; // 30% cheaper alternative
      const newCost = cost - substitutionSavings;
      const newMargin = price - newCost;
      const newMarginPercent = round2((newMargin / price) * 100);
      const projectedContribution = monthlyUnits * newMargin;

      actions.push({
        action: 'SUBSTITUTE_INGREDIENT',
        description: `Substitute ${expensiveDriver.ingredientName} with lower-cost alternative (est. ₹${round2(substitutionSavings)}/unit savings)`,
        projectedMarginPercent: newMarginPercent,
        projectedMonthlyContribution: round2(projectedContribution),
        implementationEffort: 'HIGH',
        risks: [
          'Quality/taste may change',
          'Recipe testing and approval needed',
          'Supplier qualification required',
        ],
        confidence: 0.5,
      });
    }
  }

  // Action 4: Convert to combo
  const comboMargin = marginPercent + 15; // Combos typically allow better margin
  const comboPrice = price * 1.5; // Bundle with add-on
  const comboCost = cost * 1.3;
  const comboMarginAbs = comboPrice - comboCost;
  const comboMarginPct = round2((comboMarginAbs / comboPrice) * 100);
  const projectedContribution = monthlyUnits * 0.7 * comboMarginAbs; // 70% attach rate

  actions.push({
    action: 'CONVERT_TO_COMBO',
    description: `Bundle with high-margin add-on as combo at ₹${comboPrice}`,
    projectedMarginPercent: comboMarginPct,
    projectedMonthlyContribution: round2(projectedContribution),
    implementationEffort: 'MEDIUM',
    risks: [
      'Requires identifying suitable add-on',
      'May cannibalize standalone sales',
      'POS combo setup needed',
    ],
    confidence: 0.6,
  });

  // Action 5: Add profitable side
  const sidePrice = 50;
  const sideCost = 15;
  const sideMargin = sidePrice - sideCost;
  const attachRate = 0.3;
  const projectedContributionSide = monthlyUnits * attachRate * sideMargin;
  const totalProjectedContribution = monthlyUnits * margin + projectedContributionSide;

  actions.push({
    action: 'ADD_PROFITABLE_SIDE',
    description: `Add ₹${sidePrice} high-margin side (${round2((sideMargin/sidePrice)*100)}% margin) with ${Math.round(attachRate*100)}% attach rate`,
    projectedMarginPercent: marginPercent, // Main product margin unchanged
    projectedMonthlyContribution: round2(totalProjectedContribution),
    implementationEffort: 'LOW',
    risks: [
      'Side must have proven demand',
      'Kitchen capacity for additional item',
    ],
    confidence: 0.7,
  });

  // Action 6: Keep unchanged (if margin healthy)
  if (marginPercent >= 30 && marginTrend !== 'DECLINING') {
    actions.push({
      action: 'KEEP_UNCHANGED',
      description: 'Margin healthy and stable - no price change needed',
      projectedMarginPercent: marginPercent,
      projectedMonthlyContribution: round2(monthlyUnits * margin),
      implementationEffort: 'LOW',
      risks: [],
      confidence: 0.9,
    });
  }

  // Sort by projected contribution gain
  const baseContribution = monthlyUnits * margin;
  actions.sort((a, b) => (b.projectedMonthlyContribution - baseContribution) - (a.projectedMonthlyContribution - baseContribution));

  return actions.slice(0, 3);
}

/**
 * Determine priority for advisory
 */
function determinePriority(
  marginPercent: number,
  marginTrend: string,
  monthlyUnits: number,
  marginChangePercent: number
): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (marginPercent < 15) return 'HIGH';
  if (marginPercent < 20 && marginTrend === 'DECLINING') return 'HIGH';
  if (marginPercent < 25 && monthlyUnits > 100) return 'HIGH';
  if (marginTrend === 'DECLINING' && Math.abs(marginChangePercent) > 10) return 'HIGH';
  if (marginPercent < 30) return 'MEDIUM';
  if (marginTrend === 'DECLINING') return 'MEDIUM';
  return 'LOW';
}

/**
 * Get price advisory for a specific product
 */
export async function getProductPriceAdvisory(
  restaurantId: string,
  productId: string,
  branchId?: string
): Promise<PriceAdvisoryCandidate | null> {
  const result = await analyzeMenuPriceAdvisory({ restaurantId, branchId, lookbackDays: 60 });
  return result.candidates.find(c => c.productId === productId) || null;
}

/**
 * Quick price advisory summary for dashboard
 */
export async function getPriceAdvisorySummary(
  restaurantId: string,
  branchId?: string
): Promise<{
  itemsNeedingAttention: number;
  topCandidates: PriceAdvisoryCandidate[];
  potentialMonthlyGain: number;
}> {
  const result = await analyzeMenuPriceAdvisory({ restaurantId, branchId });
  return {
    itemsNeedingAttention: result.candidates.filter(c => c.priority !== 'LOW').length,
    topCandidates: result.candidates.slice(0, 5),
    potentialMonthlyGain: result.summary.totalPotentialContributionGain,
  };
}

export { DEFAULT_LOOKBACK_DAYS, DEFAULT_MIN_MARGIN_DECLINE, DEFAULT_MIN_MONTHLY_UNITS };
export type { PriceAdvisoryAction, PriceAdvisoryCandidate, PriceAdvisoryOptions, PriceAdvisoryResult };
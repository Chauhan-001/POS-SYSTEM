/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MenuEngineeringService — Classifies menu items using the Boston Consulting Group
 * matrix (Stars, Plow Horses, Puzzles, Dogs) based on popularity and contribution.
 *
 * Uses relative thresholds within the restaurant's own data distribution rather
 * than hardcoded absolute values.
 */

import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import IntelligenceSignalModel, { SignalType, ISignalEvidence } from '../models/IntelligenceSignal';
import { computeProductBaselines, ProductBaseline } from './salesBaselineService';

export type MenuClassification = 'STAR' | 'PLOWHORSE' | 'PUZZLE' | 'DOG';

export interface MenuEngineeringItem {
  productId: string;
  productName: string;
  category: string;
  price: number;
  cost: number;
  contributionMargin: number;
  contributionMarginPercent: number;
  dailyUnits: number;
  dailyRevenue: number;
  dailyContribution: number;
  popularityPercentile: number; // 0-100 within restaurant
  marginPercentile: number; // 0-100 within restaurant
  classification: MenuClassification;
  trend: 'rising' | 'stable' | 'declining';
  trendConfidence: number;
  evidence: ISignalEvidence[];
  recommendedActions: string[];
}

export interface MenuEngineeringOptions {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number;
  minSampleSize?: number;
  popularityThresholdPercentile?: number; // Default 50 (median)
  marginThresholdPercentile?: number; // Default 50 (median)
}

const DEFAULT_POPULARITY_THRESHOLD = 50;
const DEFAULT_MARGIN_THRESHOLD = 50;
const DEFAULT_MIN_SAMPLE_SIZE = 3;

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * Calculate percentile rank within an array
 */
function getPercentileRank(value: number, sortedValues: number[]): number {
  if (sortedValues.length === 0) return 50;
  const count = sortedValues.filter(v => v <= value).length;
  return Math.round((count / sortedValues.length) * 100);
}

/**
 * Classify item based on popularity and margin percentiles
 */
function classifyItem(popularityPercentile: number, marginPercentile: number, popularityThreshold: number, marginThreshold: number): MenuClassification {
  const highPopularity = popularityPercentile >= popularityThreshold;
  const highMargin = marginPercentile >= marginThreshold;

  if (highPopularity && highMargin) return 'STAR';
  if (highPopularity && !highMargin) return 'PLOWHORSE';
  if (!highPopularity && highMargin) return 'PUZZLE';
  return 'DOG';
}

/**
 * Get trend direction from recent vs older periods
 */
async function getProductTrend(
  restaurantId: string,
  branchId: string | undefined,
  productId: string,
  lookbackDays: number
): Promise<{ trend: 'rising' | 'stable' | 'declining'; confidence: number }> {
  const halfPeriod = Math.floor(lookbackDays / 2);
  const { start: recentStart, end } = getDateRange(halfPeriod);
  const { start: olderStart } = getDateRange(lookbackDays);
  olderStart.setTime(olderStart.getTime() + halfPeriod * 24 * 60 * 60 * 1000);

  const recentBills = await mongoose.model('Bill').find({
    restaurantId: objectId(restaurantId),
    ...(branchId ? { branchId: objectId(branchId) } : {}),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: recentStart, $lte: end },
  }).select('_id').lean().exec();

  const olderBills = await mongoose.model('Bill').find({
    restaurantId: objectId(restaurantId),
    ...(branchId ? { branchId: objectId(branchId) } : {}),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: olderStart, $lt: recentStart },
  }).select('_id').lean().exec();

  if (recentBills.length === 0 && olderBills.length === 0) {
    return { trend: 'stable', confidence: 0 };
  }

  const recentBillIds = recentBills.map(b => b._id);
  const olderBillIds = olderBills.map(b => b._id);

  const recentItems = await mongoose.model('BillItem').find({
    billId: { $in: recentBillIds },
    menuItemId: productId,
  }).select('quantity').lean().exec();

  const olderItems = await mongoose.model('BillItem').find({
    billId: { $in: olderBillIds },
    menuItemId: productId,
  }).select('quantity').lean().exec();

  const recentUnits = recentItems.reduce((sum, i: any) => sum + (i.quantity || 0), 0);
  const olderUnits = olderItems.reduce((sum, i: any) => sum + (i.quantity || 0), 0);

  if (olderUnits === 0) {
    return recentUnits > 0 ? { trend: 'rising', confidence: 0.5 } : { trend: 'stable', confidence: 0 };
  }

  const changePct = ((recentUnits - olderUnits) / olderUnits) * 100;
  const totalUnits = recentUnits + olderUnits;
  const confidence = Math.min(0.9, totalUnits / 50); // More units = higher confidence

  if (changePct > 15) return { trend: 'rising', confidence };
  if (changePct < -15) return { trend: 'declining', confidence };
  return { trend: 'stable', confidence };
}

/**
 * Get recommended actions based on classification
 */
function getRecommendedActions(
  classification: MenuClassification,
  trend: 'rising' | 'stable' | 'declining',
  marginPercent: number,
  popularityPercentile: number
): string[] {
  const actions: string[] = [];

  switch (classification) {
    case 'STAR':
      actions.push('Protect stock levels — never run out');
      actions.push('Feature prominently on menu and promotions');
      actions.push('Consider slight price increase if margin allows');
      actions.push('Build combos around this item');
      break;
    case 'PLOWHORSE':
      actions.push('High volume but low margin — review recipe costs');
      actions.push('Consider portion optimization or ingredient substitution');
      actions.push('Bundle with high-margin add-ons');
      actions.push('Test small price increase if demand is inelastic');
      break;
    case 'PUZZLE':
      actions.push('High margin but low sales — improve visibility');
      actions.push('Feature as "Chef\'s Recommendation" or special');
      actions.push('Train staff to upsell this item');
      actions.push('Consider limited-time promotion to drive trial');
      break;
    case 'DOG':
      actions.push('Low margin, low sales — consider removing');
      actions.push('If keeping, review recipe for cost reduction');
      actions.push('Test as limited-time offer to gauge interest');
      actions.push('Replace with higher-potential item');
      break;
  }

  // Trend-based additions
  if (trend === 'declining' && classification !== 'DOG') {
    actions.unshift('⚠️ Sales declining — investigate cause (quality, competition, seasonality)');
  }
  if (trend === 'rising' && classification === 'PUZZLE') {
    actions.unshift('📈 Growing popularity — invest in promotion now');
  }

  return actions;
}

/**
 * Analyze menu engineering for a restaurant
 */
export async function analyzeMenuEngineering(opts: MenuEngineeringOptions): Promise<MenuEngineeringItem[]> {
  const {
    restaurantId,
    branchId,
    lookbackDays = 90,
    minSampleSize = DEFAULT_MIN_SAMPLE_SIZE,
    popularityThresholdPercentile = DEFAULT_POPULARITY_THRESHOLD,
    marginThresholdPercentile = DEFAULT_MARGIN_THRESHOLD,
  } = opts;

  // Get product baselines (includes both revenue and units)
  const baselines = await computeProductBaselines({ restaurantId, branchId, lookbackDays, minSampleSize });
  if (baselines.length === 0) return [];

  // Merge revenue and units baselines by product
  const productMap = new Map<string, { revenueBaseline?: ProductBaseline; unitsBaseline?: ProductBaseline }>();
  for (const b of baselines) {
    const existing = productMap.get(b.productId) || {};
    if (b.metric === 'revenue') existing.revenueBaseline = b;
    if (b.metric === 'units') existing.unitsBaseline = b;
    productMap.set(b.productId, existing);
  }

  // Fetch product details (price, cost, category)
  const productIds = Array.from(productMap.keys());
  const products = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    _id: { $in: productIds.map(objectId) },
    isDeleted: { $ne: true },
  })
    .select('_id name category price averageCost currentStock minStock maxStock')
    .lean()
    .exec();

  // Build items with full data
  const items: MenuEngineeringItem[] = [];

  for (const product of products) {
    const pid = String(product._id);
    const baselines = productMap.get(pid);
    if (!baselines || !baselines.unitsBaseline) continue;

    const unitsBaseline = baselines.unitsBaseline;
    const revenueBaseline = baselines.revenueBaseline;

    const dailyUnits = unitsBaseline.value;
    const dailyRevenue = revenueBaseline?.value || 0;
    const price = product.price || 0;
    const cost = product.averageCost || 0;

    if (price <= 0) continue;

    const contributionMargin = price - cost;
    const contributionMarginPercent = price > 0 ? Math.round((contributionMargin / price) * 100) : 0;
    const dailyContribution = dailyUnits * contributionMargin;

    items.push({
      productId: pid,
      productName: product.name,
      category: product.category || 'Other',
      price,
      cost,
      contributionMargin,
      contributionMarginPercent,
      dailyUnits,
      dailyRevenue,
      dailyContribution,
      popularityPercentile: 0, // Will compute below
      marginPercentile: 0, // Will compute below
      classification: 'DOG', // Will compute below
      trend: 'stable',
      trendConfidence: 0,
      evidence: [],
      recommendedActions: [],
    });
  }

  if (items.length === 0) return [];

  // Compute percentiles
  const sortedPopularity = items.map(i => i.dailyUnits).sort((a, b) => a - b);
  const sortedMargin = items.map(i => i.contributionMarginPercent).sort((a, b) => a - b);

  for (const item of items) {
    item.popularityPercentile = getPercentileRank(item.dailyUnits, sortedPopularity);
    item.marginPercentile = getPercentileRank(item.contributionMarginPercent, sortedMargin);
    item.classification = classifyItem(
      item.popularityPercentile,
      item.marginPercentile,
      popularityThresholdPercentile,
      marginThresholdPercentile
    );
  }

  // Get trends (parallel)
  const trendResults = await Promise.all(
    items.map(item => getProductTrend(restaurantId, branchId, item.productId, lookbackDays))
  );

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.trend = trendResults[i].trend;
    item.trendConfidence = trendResults[i].confidence;
    item.recommendedActions = getRecommendedActions(
      item.classification,
      item.trend,
      item.contributionMarginPercent,
      item.popularityPercentile
    );

    // Build evidence
    item.evidence = [
      {
        description: `Popularity: ${item.dailyUnits} units/day (${item.popularityPercentile}th percentile)`,
        value: item.dailyUnits,
        baseline: sortedPopularity[Math.floor(sortedPopularity.length * (popularityThresholdPercentile / 100))],
        sampleSize: items.length,
        confidence: item.trendConfidence,
      },
      {
        description: `Contribution margin: ${item.contributionMarginPercent}% (${item.marginPercentile}th percentile)`,
        value: item.contributionMarginPercent,
        baseline: sortedMargin[Math.floor(sortedMargin.length * (marginThresholdPercentile / 100))],
        sampleSize: items.length,
        confidence: item.trendConfidence,
      },
      {
        description: `Daily revenue: ₹${Math.round(item.dailyRevenue)}, Daily contribution: ₹${Math.round(item.dailyContribution)}`,
        value: item.dailyRevenue,
        sampleSize: 1,
        confidence: 1,
      },
    ];

    if (item.trend !== 'stable') {
      item.evidence.push({
        description: `Trend: ${item.trend} (${Math.round(item.trendConfidence * 100)}% confidence)`,
        value: item.trend === 'rising' ? 1 : -1,
        baseline: 0,
        sampleSize: 1,
        confidence: item.trendConfidence,
      });
    }
  }

  // Sort by classification priority (STAR > PUZZLE > PLOWHORSE > DOG) then by contribution
  const classificationOrder = { STAR: 4, PUZZLE: 3, PLOWHORSE: 2, DOG: 1 };
  items.sort((a, b) => {
    const classDiff = classificationOrder[b.classification] - classificationOrder[a.classification];
    if (classDiff !== 0) return classDiff;
    return b.dailyContribution - a.dailyContribution;
  });

  return items;
}

/**
 * Get menu engineering summary
 */
export async function getMenuEngineeringSummary(opts: MenuEngineeringOptions): Promise<{
  stars: number;
  plowHorses: number;
  puzzles: number;
  dogs: number;
  totalItems: number;
  totalDailyRevenue: number;
  totalDailyContribution: number;
  topStars: MenuEngineeringItem[];
  topPuzzles: MenuEngineeringItem[];
  actionItems: MenuEngineeringItem[];
}> {
  const items = await analyzeMenuEngineering(opts);

  const summary = {
    stars: 0,
    plowHorses: 0,
    puzzles: 0,
    dogs: 0,
    totalItems: items.length,
    totalDailyRevenue: 0,
    totalDailyContribution: 0,
    topStars: [] as MenuEngineeringItem[],
    topPuzzles: [] as MenuEngineeringItem[],
    actionItems: [] as MenuEngineeringItem[],
  };

  for (const item of items) {
    summary.totalDailyRevenue += item.dailyRevenue;
    summary.totalDailyContribution += item.dailyContribution;

    switch (item.classification) {
      case 'STAR':
        summary.stars++;
        if (summary.topStars.length < 3) summary.topStars.push(item);
        break;
      case 'PLOWHORSE':
        summary.plowHorses++;
        if (item.trend === 'declining') summary.actionItems.push(item);
        break;
      case 'PUZZLE':
        summary.puzzles++;
        if (summary.topPuzzles.length < 3) summary.topPuzzles.push(item);
        if (item.trend === 'rising') summary.actionItems.push(item);
        break;
      case 'DOG':
        summary.dogs++;
        if (item.dailyUnits > 0) summary.actionItems.push(item); // Still selling but low value
        break;
    }
  }

  // Limit action items
  summary.actionItems = summary.actionItems.slice(0, 5);

  return summary;
}

/**
 * Persist menu engineering results as signals
 */
export async function persistMenuEngineeringAsSignals(
  restaurantId: string,
  branchId: string | undefined,
  items: MenuEngineeringItem[]
): Promise<void> {
  if (items.length === 0) return;

  const docs = items.map(item => {
    const signalType = item.classification === 'STAR' ? 'MENU_STAR' :
      item.classification === 'PLOWHORSE' ? 'MENU_PLOWHORSE' :
      item.classification === 'PUZZLE' ? 'MENU_PUZZLE' : 'MENU_DOG';

    return {
      restaurantId: objectId(restaurantId),
      branchId: branchId ? objectId(branchId) : undefined,
      type: signalType as SignalType,
      entityType: 'product',
      entityId: item.productId,
      entityName: item.productName,
      value: item.classification === 'STAR' || item.classification === 'PUZZLE' ? item.marginPercentile : item.popularityPercentile,
      baseline: 50,
      percentageChange: item.classification === 'STAR' || item.classification === 'PUZZLE'
        ? item.marginPercentile - 50
        : item.popularityPercentile - 50,
      confidence: Math.max(item.trendConfidence, 0.5),
      minSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
      sampleSize: 1,
      evidence: item.evidence,
      detectedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      consumed: false,
      tags: ['menu_engineering', item.classification.toLowerCase(), item.category, item.trend].filter(Boolean),
    };
  });

  await IntelligenceSignalModel.insertMany(docs, { ordered: false });
}

/**
 * Get items by classification
 */
export async function getMenuItemsByClassification(
  restaurantId: string,
  classification: MenuClassification,
  branchId?: string,
  lookbackDays: number = 90
): Promise<MenuEngineeringItem[]> {
  const items = await analyzeMenuEngineering({ restaurantId, branchId, lookbackDays });
  return items.filter(i => i.classification === classification);
}

function getDateRange(days: number): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MarginSignalsService — Detects margin-related opportunities and risks.
 * Identifies high-selling/low-margin, low-selling/high-margin, and deteriorating margins.
 */

import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import IntelligenceSignalModel, { SignalType, ISignalEvidence } from '../models/IntelligenceSignal';
import { computeProductBaselines, ProductBaseline } from './salesBaselineService';

export interface MarginSignalItem {
  productId: string;
  productName: string;
  category: string;
  price: number;
  cost: number;
  contributionMargin: number;
  contributionMarginPercent: number;
  foodCostPercent: number;
  dailyUnits: number;
  dailyRevenue: number;
  dailyContribution: number;
  unitsBaseline: ProductBaseline;
  signalType: 'HIGH_SELLING_LOW_MARGIN' | 'LOW_SELLING_HIGH_MARGIN' | 'HIGH_SELLING_HIGH_MARGIN' | 'MARGIN_DETERIORATING' | 'COST_RISER';
  severity: 'low' | 'medium' | 'high';
  evidence: ISignalEvidence[];
  recommendedActions: string[];
  costChangePct?: number;
  previousCost?: number;
  currentCost?: number;
}

export interface MarginSignalsOptions {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number;
  minSampleSize?: number;
  highMarginThresholdPercentile?: number; // Default 75
  lowMarginThresholdPercentile?: number; // Default 25
  highVolumeThresholdPercentile?: number; // Default 75
  lowVolumeThresholdPercentile?: number; // Default 25
  costRiseThresholdPct?: number; // Default 10%
}

const DEFAULT_HIGH_MARGIN_PCTL = 75;
const DEFAULT_LOW_MARGIN_PCTL = 25;
const DEFAULT_HIGH_VOLUME_PCTL = 75;
const DEFAULT_LOW_VOLUME_PCTL = 25;
const DEFAULT_COST_RISE_THRESHOLD = 10;
const DEFAULT_MIN_SAMPLE_SIZE = 3;

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * Get ingredient cost changes from purchase data
 */
async function getIngredientCostChanges(restaurantId: string, lookbackDays: number): Promise<Map<string, { current: number; previous: number; pctChange: number }>> {
  // This would typically query the purchase/inventory system
  // For now, return empty map - to be integrated with purchase service
  return new Map();
}

/**
 * Detect margin signals
 */
export async function detectMarginSignals(opts: MarginSignalsOptions): Promise<MarginSignalItem[]> {
  const {
    restaurantId,
    branchId,
    lookbackDays = 90,
    minSampleSize = DEFAULT_MIN_SAMPLE_SIZE,
    highMarginThresholdPercentile = DEFAULT_HIGH_MARGIN_PCTL,
    lowMarginThresholdPercentile = DEFAULT_LOW_MARGIN_PCTL,
    highVolumeThresholdPercentile = DEFAULT_HIGH_VOLUME_PCTL,
    lowVolumeThresholdPercentile = DEFAULT_LOW_VOLUME_PCTL,
    costRiseThresholdPct = DEFAULT_COST_RISE_THRESHOLD,
  } = opts;

  // Get product baselines
  const baselines = await computeProductBaselines({ restaurantId, branchId, lookbackDays, minSampleSize });
  if (baselines.length === 0) return [];

  // Merge revenue and units baselines
  const productMap = new Map<string, { revenueBaseline?: ProductBaseline; unitsBaseline?: ProductBaseline }>();
  for (const b of baselines) {
    const existing = productMap.get(b.productId) || {};
    if (b.metric === 'revenue') existing.revenueBaseline = b;
    if (b.metric === 'units') existing.unitsBaseline = b;
    productMap.set(b.productId, existing);
  }

  // Fetch product details
  const productIds = Array.from(productMap.keys());
  const products = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    _id: { $in: productIds.map(objectId) },
    isDeleted: { $ne: true },
  })
    .select('_id name category price averageCost currentStock minStock maxStock')
    .lean()
    .exec();

  // Build items with margin data
  const items: MarginSignalItem[] = [];

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

    if (price <= 0 || cost <= 0) continue;

    const contributionMargin = price - cost;
    const contributionMarginPercent = Math.round((contributionMargin / price) * 100);
    const foodCostPercent = Math.round((cost / price) * 100);
    const dailyContribution = dailyUnits * contributionMargin;

    items.push({
      productId: pid,
      productName: product.name,
      category: product.category || 'Other',
      price,
      cost,
      contributionMargin,
      contributionMarginPercent,
      foodCostPercent,
      dailyUnits,
      dailyRevenue,
      dailyContribution,
      unitsBaseline,
      signalType: 'HIGH_SELLING_LOW_MARGIN', // Will classify below
      severity: 'low',
      evidence: [],
      recommendedActions: [],
    });
  }

  if (items.length === 0) return [];

  // Compute percentiles
  const sortedMargin = items.map(i => i.contributionMarginPercent).sort((a, b) => a - b);
  const sortedVolume = items.map(i => i.dailyUnits).sort((a, b) => a - b);

  const highMarginThreshold = sortedMargin[Math.floor(sortedMargin.length * (highMarginThresholdPercentile / 100))];
  const lowMarginThreshold = sortedMargin[Math.floor(sortedMargin.length * (lowMarginThresholdPercentile / 100))];
  const highVolumeThreshold = sortedVolume[Math.floor(sortedVolume.length * (highVolumeThresholdPercentile / 100))];
  const lowVolumeThreshold = sortedVolume[Math.floor(sortedVolume.length * (lowVolumeThresholdPercentile / 100))];

  // Get ingredient cost changes
  const costChanges = await getIngredientCostChanges(restaurantId, lookbackDays);

  // Classify each item
  for (const item of items) {
    const isHighMargin = item.contributionMarginPercent >= highMarginThreshold;
    const isLowMargin = item.contributionMarginPercent <= lowMarginThreshold;
    const isHighVolume = item.dailyUnits >= highVolumeThreshold;
    const isLowVolume = item.dailyUnits <= lowVolumeThreshold;

    // Determine signal type
    if (isHighVolume && isLowMargin) {
      item.signalType = 'HIGH_SELLING_LOW_MARGIN';
      item.severity = item.contributionMarginPercent < 15 ? 'high' : 'medium';
      item.recommendedActions = [
        'Review recipe for cost reduction (ingredient substitution, portion optimization)',
        'Consider small price increase if demand is stable',
        'Bundle with high-margin add-ons to lift overall basket margin',
        'Do NOT discount this item — it destroys already thin margin',
      ];
    } else if (isLowVolume && isHighMargin) {
      item.signalType = 'LOW_SELLING_HIGH_MARGIN';
      item.severity = 'medium';
      item.recommendedActions = [
        'Increase visibility: feature as "Chef\'s Recommendation"',
        'Train staff to actively upsell this item',
        'Test limited-time promotion to drive trial',
        'Bundle with popular items as add-on',
        'Improve menu placement and photography',
      ];
    } else if (isHighVolume && isHighMargin) {
      item.signalType = 'HIGH_SELLING_HIGH_MARGIN';
      item.severity = 'low';
      item.recommendedActions = [
        'Protect stock — never allow stockouts',
        'Feature prominently on menu and in promotions',
        'Build combos around this item as anchor',
        'Consider modest price increase if demand is strong',
      ];
    } else {
      // Medium volume, medium margin — no strong signal
      continue;
    }

    // Check for cost risers
    const costChange = costChanges.get(item.productName.toLowerCase());
    if (costChange && costChange.pctChange >= costRiseThresholdPct) {
      item.signalType = 'COST_RISER';
      item.severity = costChange.pctChange > 25 ? 'high' : 'medium';
      item.costChangePct = costChange.pctChange;
      item.previousCost = costChange.previous;
      item.currentCost = costChange.current;
      item.recommendedActions = [
        `Ingredient cost rose ${Math.round(costChange.pctChange)}% — review recipe cost`,
        'Consider price adjustment or ingredient substitution',
        'Negotiate with supplier or find alternative source',
        'Do NOT discount while costs are elevated',
      ];
    }

    // Check for margin deterioration (from recipe cost engine)
    // This would integrate with costIntelligenceService
    // For now, we'll skip this and rely on cost risers above

    // Build evidence
    item.evidence = [
      {
        description: `${item.productName}: ${item.dailyUnits} units/day (${isHighVolume ? 'high' : isLowVolume ? 'low' : 'medium'} volume), ${item.contributionMarginPercent}% margin (${isHighMargin ? 'high' : isLowMargin ? 'low' : 'medium'})`,
        value: item.contributionMarginPercent,
        baseline: isHighMargin ? highMarginThreshold : lowMarginThreshold,
        sampleSize: item.unitsBaseline.sampleSize,
        confidence: item.unitsBaseline.confidence,
      },
      {
        description: `Price: ₹${item.price}, Cost: ₹${item.cost}, Food cost: ${item.foodCostPercent}%`,
        value: item.foodCostPercent,
        baseline: 100 - highMarginThreshold,
        sampleSize: 1,
        confidence: 1,
      },
      {
        description: `Daily contribution: ₹${Math.round(item.dailyContribution)} (${item.dailyUnits} × ₹${Math.round(item.contributionMargin)})`,
        value: item.dailyContribution,
        sampleSize: 1,
        confidence: 1,
      },
    ];

    if (item.costChangePct) {
      item.evidence.push({
        description: `Ingredient cost increased ${Math.round(item.costChangePct)}% (₹${item.previousCost} → ₹${item.currentCost})`,
        value: item.costChangePct,
        baseline: costRiseThresholdPct,
        percentageChange: item.costChangePct,
        sampleSize: 1,
        confidence: 1,
      });
    }
  }

  // Filter to only items with signals
  const signals = items.filter(i => i.signalType !== 'HIGH_SELLING_LOW_MARGIN' || i.severity !== 'low');

  // Sort by severity and contribution impact
  const severityOrder = { high: 3, medium: 2, low: 1 };
  signals.sort((a, b) => {
    const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.dailyContribution - a.dailyContribution;
  });

  return signals;
}

/**
 * Get margin signal summary
 */
export async function getMarginSignalSummary(opts: MarginSignalsOptions): Promise<{
  highSellingLowMargin: number;
  lowSellingHighMargin: number;
  highSellingHighMargin: number;
  costRisers: number;
  totalItems: number;
  totalDailyContribution: number;
  atRiskContribution: number;
  topRisks: MarginSignalItem[];
  topOpportunities: MarginSignalItem[];
}> {
  const signals = await detectMarginSignals(opts);

  const summary = {
    highSellingLowMargin: 0,
    lowSellingHighMargin: 0,
    highSellingHighMargin: 0,
    costRisers: 0,
    totalItems: 0,
    totalDailyContribution: 0,
    atRiskContribution: 0,
    topRisks: [] as MarginSignalItem[],
    topOpportunities: [] as MarginSignalItem[],
  };

  for (const signal of signals) {
    summary.totalItems++;
    summary.totalDailyContribution += signal.dailyContribution;

    switch (signal.signalType) {
      case 'HIGH_SELLING_LOW_MARGIN':
        summary.highSellingLowMargin++;
        summary.atRiskContribution += signal.dailyContribution;
        if (summary.topRisks.length < 3) summary.topRisks.push(signal);
        break;
      case 'LOW_SELLING_HIGH_MARGIN':
        summary.lowSellingHighMargin++;
        if (summary.topOpportunities.length < 3) summary.topOpportunities.push(signal);
        break;
      case 'HIGH_SELLING_HIGH_MARGIN':
        summary.highSellingHighMargin++;
        break;
      case 'COST_RISER':
        summary.costRisers++;
        if (summary.topRisks.length < 3) summary.topRisks.push(signal);
        break;
    }
  }

  return summary;
}

/**
 * Persist margin signals
 */
export async function persistMarginSignals(
  restaurantId: string,
  branchId: string | undefined,
  signals: MarginSignalItem[]
): Promise<void> {
  if (signals.length === 0) return;

  const docs = signals.map(signal => {
    const signalType = signal.signalType === 'HIGH_SELLING_LOW_MARGIN' ? 'MARGIN_HIGH_SELLING_LOW_MARGIN' :
      signal.signalType === 'LOW_SELLING_HIGH_MARGIN' ? 'MARGIN_LOW_SELLING_HIGH_MARGIN' :
      signal.signalType === 'HIGH_SELLING_HIGH_MARGIN' ? 'MARGIN_HIGH_SELLING_HIGH_MARGIN' :
      signal.signalType === 'COST_RISER' ? 'MARGIN_COST_RISER' :
      'MARGIN_DETERIORATING';

    return {
      restaurantId: objectId(restaurantId),
      branchId: branchId ? objectId(branchId) : undefined,
      type: signalType as SignalType,
      entityType: 'product',
      entityId: signal.productId,
      entityName: signal.productName,
      value: signal.contributionMarginPercent,
      baseline: 50,
      percentageChange: signal.contributionMarginPercent - 50,
      confidence: 0.7,
      minSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
      sampleSize: 1,
      evidence: signal.evidence,
      detectedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      consumed: false,
      tags: ['margin_signal', signal.signalType.toLowerCase(), signal.category, signal.severity].filter(Boolean),
    };
  });

  await IntelligenceSignalModel.insertMany(docs, { ordered: false });
}

/**
 * Get top margin risks
 */
export async function getTopMarginRisks(
  restaurantId: string,
  branchId?: string,
  limit: number = 5
): Promise<MarginSignalItem[]> {
  const signals = await detectMarginSignals({ restaurantId, branchId });
  return signals
    .filter(s => s.severity === 'high' || s.severity === 'medium')
    .slice(0, limit);
}

/**
 * Get top margin opportunities
 */
export async function getTopMarginOpportunities(
  restaurantId: string,
  branchId?: string,
  limit: number = 5
): Promise<MarginSignalItem[]> {
  const signals = await detectMarginSignals({ restaurantId, branchId });
  return signals
    .filter(s => s.signalType === 'LOW_SELLING_HIGH_MARGIN')
    .slice(0, limit);
}
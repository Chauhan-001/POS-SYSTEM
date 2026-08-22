/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ComboOpportunityService — Detects commercially sensible combo opportunities
 * using basket analysis + cost + margin + inventory + existing offers overlap.
 *
 * A combo candidate is only generated when:
 * 1. Strong basket affinity (lift > 1.2, confidence > 15%)
 * 2. Healthy combined margin (> 25%)
 * 3. Good inventory availability
 * 4. No existing conflicting combo/offer
 * 5. Sufficient demand for both items
 */

import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import OfferModel from '../models/Offer';
import IntelligenceSignalModel, { SignalType, ISignalEvidence } from '../models/IntelligenceSignal';
import { findComboCandidates, findAddOnCandidates } from './basketAnalysisService';
import { computeProductBaselines, ProductBaseline } from './salesBaselineService';

export interface ComboOpportunity {
  id: string;
  primaryProduct: {
    id: string;
    name: string;
    category: string;
    price: number;
    cost: number;
    margin: number;
    dailyUnits: number;
    dailyRevenue: number;
  };
  addOnProduct: {
    id: string;
    name: string;
    category: string;
    price: number;
    cost: number;
    margin: number;
    dailyUnits: number;
    dailyRevenue: number;
  };
  basketAffinity: {
    support: number;
    confidence: number;
    lift: number;
    coOccurrenceCount: number;
  };
  comboEconomics: {
    normalPrice: number;
    suggestedComboPrice: number;
    discountPercent: number;
    estimatedMargin: number;
    projectedUnitsPerDay: number;
    projectedDailyRevenue: number;
    projectedDailyContribution: number;
  };
  inventoryHealth: {
    primaryStock: number;
    primaryMinStock: number;
    primaryMaxStock: number;
    addOnStock: number;
    addOnMinStock: number;
    addOnMaxStock: number;
    bothHealthy: boolean;
  };
  existingOffersConflict: {
    hasConflict: boolean;
    conflictingOfferIds: string[];
  };
  demandScore: number; // 0-100
  marginScore: number; // 0-100
  inventoryScore: number; // 0-100
  overallScore: number; // 0-100
  confidence: number; // 0-1
  evidence: ISignalEvidence[];
  recommendedAction: 'create_combo' | 'test_combo' | 'monitor';
}

export interface ComboOpportunityOptions {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number;
  minLift?: number;
  minConfidence?: number;
  minComboMargin?: number;
  maxComboDiscount?: number;
  minPrimaryDailyUnits?: number;
  minAddOnDailyUnits?: number;
}

const DEFAULT_MIN_LIFT = 1.2;
const DEFAULT_MIN_CONFIDENCE = 15;
const DEFAULT_MIN_COMBO_MARGIN = 25;
const DEFAULT_MAX_COMBO_DISCOUNT = 20;
const DEFAULT_MIN_PRIMARY_UNITS = 5;
const DEFAULT_MIN_ADDON_UNITS = 2;

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * Check for existing conflicting offers/combos
 */
async function checkExistingOfferConflicts(
  restaurantId: string,
  primaryProductId: string,
  addOnProductId: string
): Promise<{ hasConflict: boolean; conflictingOfferIds: string[] }> {
  const offers = await OfferModel.find({
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
    status: 'active',
    $or: [
      { applicableProductIds: { $in: [primaryProductId, addOnProductId] } },
      { type: 'combo' },
    ],
  })
    .select('_id title type applicableProductIds')
    .lean()
    .exec();

  const conflicting: string[] = [];
  for (const offer of offers) {
    const applicableIds = (offer.applicableProductIds || []).map(String);
    const hasPrimary = applicableIds.includes(primaryProductId);
    const hasAddOn = applicableIds.includes(addOnProductId);

    if (offer.type === 'combo' && hasPrimary && hasAddOn) {
      conflicting.push(String(offer._id));
    } else if (offer.type !== 'combo' && (hasPrimary || hasAddOn)) {
      // Non-combo offer on either product - potential conflict
      conflicting.push(String(offer._id));
    }
  }

  return { hasConflict: conflicting.length > 0, conflictingOfferIds: conflicting };
}

/**
 * Get inventory health for products
 */
async function getInventoryHealth(restaurantId: string, productIds: string[]): Promise<Map<string, {
  currentStock: number;
  minStock: number;
  maxStock: number;
  healthy: boolean;
}>> {
  const products = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    _id: { $in: productIds.map(objectId) },
    isDeleted: { $ne: true },
  })
    .select('_id currentStock minStock maxStock')
    .lean()
    .exec();

  const map = new Map();
  for (const p of products) {
    const currentStock = p.currentStock || 0;
    const minStock = p.minStock || 0;
    const maxStock = p.maxStock || 0;
    const healthy = currentStock > minStock && (maxStock === 0 || currentStock < maxStock * 0.9);
    map.set(String(p._id), { currentStock, minStock, maxStock, healthy });
  }
  return map;
}

/**
 * Compute demand score based on baseline sales
 */
function computeDemandScore(primaryUnits: number, addOnUnits: number, primaryRevenue: number, addOnRevenue: number): number {
  // Normalize: 50 units/day = 100 score for primary, 20 units/day = 100 for add-on
  const primaryScore = Math.min(100, (primaryUnits / 50) * 100);
  const addOnScore = Math.min(100, (addOnUnits / 20) * 100);
  // Weight by revenue contribution
  const totalRevenue = primaryRevenue + addOnRevenue;
  if (totalRevenue === 0) return 0;
  const primaryWeight = primaryRevenue / totalRevenue;
  return Math.round(primaryScore * primaryWeight + addOnScore * (1 - primaryWeight));
}

/**
 * Compute margin score
 */
function computeMarginScore(estimatedMargin: number): number {
  // 25% margin = 50 score, 40% = 100 score
  return Math.min(100, Math.max(0, Math.round((estimatedMargin - 25) / 15 * 100)));
}

/**
 * Compute inventory score
 */
function computeInventoryScore(primaryHealthy: boolean, addOnHealthy: boolean): number {
  let score = 0;
  if (primaryHealthy) score += 60;
  if (addOnHealthy) score += 40;
  return score;
}

/**
 * Detect combo opportunities
 */
export async function detectComboOpportunities(opts: ComboOpportunityOptions): Promise<ComboOpportunity[]> {
  const {
    restaurantId,
    branchId,
    lookbackDays = 90,
    minLift = DEFAULT_MIN_LIFT,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    minComboMargin = DEFAULT_MIN_COMBO_MARGIN,
    maxComboDiscount = DEFAULT_MAX_COMBO_DISCOUNT,
    minPrimaryDailyUnits = DEFAULT_MIN_PRIMARY_UNITS,
    minAddOnDailyUnits = DEFAULT_MIN_ADDON_UNITS,
  } = opts;

  // Get basket analysis combo candidates
  const basketCandidates = await findComboCandidates({
    restaurantId,
    branchId,
    lookbackDays,
    minComboMargin,
    maxComboDiscount,
  });

  if (basketCandidates.length === 0) return [];

  // Get product baselines for demand validation
  const baselines = await computeProductBaselines({ restaurantId, branchId, lookbackDays });
  const baselineMap = new Map(baselines.map(b => [b.productId, b]));

  // Get inventory health for all involved products
  const allProductIds = new Set<string>();
  for (const c of basketCandidates) {
    allProductIds.add(c.primaryProduct.id);
    allProductIds.add(c.addOnProduct.id);
  }
  const inventoryHealth = await getInventoryHealth(restaurantId, Array.from(allProductIds));

  const opportunities: ComboOpportunity[] = [];

  for (const candidate of basketCandidates) {
    const primaryBaseline = baselineMap.get(candidate.primaryProduct.id);
    const addOnBaseline = baselineMap.get(candidate.addOnProduct.id);

    if (!primaryBaseline || !addOnBaseline) continue;

    const primaryDailyUnits = primaryBaseline.metric === 'units' ? primaryBaseline.value : 0;
    const addOnDailyUnits = addOnBaseline.metric === 'units' ? addOnBaseline.value : 0;
    const primaryDailyRevenue = primaryBaseline.metric === 'revenue' ? primaryBaseline.value : 0;
    const addOnDailyRevenue = addOnBaseline.metric === 'revenue' ? addOnBaseline.value : 0;

    // Check minimum demand thresholds
    if (primaryDailyUnits < minPrimaryDailyUnits) continue;
    if (addOnDailyUnits < minAddOnDailyUnits) continue;

    // Check basket affinity thresholds
    if (candidate.association.lift < minLift) continue;
    if (candidate.association.confidence < minConfidence) continue;

    // Check existing offer conflicts
    const conflicts = await checkExistingOfferConflicts(restaurantId, candidate.primaryProduct.id, candidate.addOnProduct.id);

    // Inventory health
    const primaryInv = inventoryHealth.get(candidate.primaryProduct.id) || { currentStock: 0, minStock: 0, maxStock: 0, healthy: false };
    const addOnInv = inventoryHealth.get(candidate.addOnProduct.id) || { currentStock: 0, minStock: 0, maxStock: 0, healthy: false };

    // Scores
    const demandScore = computeDemandScore(primaryDailyUnits, addOnDailyUnits, primaryDailyRevenue, addOnDailyRevenue);
    const marginScore = computeMarginScore(candidate.estimatedMargin);
    const inventoryScore = computeInventoryScore(primaryInv.healthy, addOnInv.healthy);

    // Overall score (weighted)
    const overallScore = Math.round(
      demandScore * 0.4 +
      marginScore * 0.35 +
      inventoryScore * 0.15 +
      (candidate.association.lift * 10) * 0.1 // Lift contribution
    );

    // Confidence based on data quality
    const confidence = Math.min(
      1,
      (primaryBaseline.confidence + addOnBaseline.confidence + (candidate.association.confidence / 100)) / 3
    );

    // Determine recommended action
    let recommendedAction: ComboOpportunity['recommendedAction'] = 'monitor';
    if (overallScore >= 70 && confidence >= 0.6 && !conflicts.hasConflict) {
      recommendedAction = 'create_combo';
    } else if (overallScore >= 50 && confidence >= 0.4) {
      recommendedAction = 'test_combo';
    }

    const evidence: ISignalEvidence[] = [
      {
        description: `Basket affinity: ${candidate.association.confidence}% confidence, ${candidate.association.lift}x lift, ${candidate.association.coOccurrenceCount} co-occurrences`,
        value: candidate.association.lift,
        baseline: 1.0,
        percentageChange: Math.round((candidate.association.lift - 1) * 100),
        sampleSize: candidate.association.coOccurrenceCount,
        confidence: candidate.association.confidence / 100,
      },
      {
        description: `Combo economics: ₹${candidate.suggestedComboPrice} vs ₹${candidate.primaryProduct.price + candidate.addOnProduct.price} normal (${Math.round((1 - candidate.suggestedComboPrice / (candidate.primaryProduct.price + candidate.addOnProduct.price)) * 100)}% discount), ${candidate.estimatedMargin}% margin`,
        value: candidate.estimatedMargin,
        baseline: minComboMargin,
        percentageChange: Math.round(((candidate.estimatedMargin - minComboMargin) / minComboMargin) * 100),
        sampleSize: primaryBaseline.sampleSize + addOnBaseline.sampleSize,
        confidence,
      },
      {
        description: `Demand: ${primaryDailyUnits} ${candidate.primaryProduct.name}/day, ${addOnDailyUnits} ${candidate.addOnProduct.name}/day`,
        value: primaryDailyUnits + addOnDailyUnits,
        baseline: minPrimaryDailyUnits + minAddOnDailyUnits,
        sampleSize: primaryBaseline.sampleSize,
        confidence: primaryBaseline.confidence,
      },
    ];

    if (!primaryInv.healthy || !addOnInv.healthy) {
      evidence.push({
        description: `Inventory: ${candidate.primaryProduct.name} ${primaryInv.healthy ? 'healthy' : `low (${primaryInv.currentStock}/${primaryInv.minStock})`}, ${candidate.addOnProduct.name} ${addOnInv.healthy ? 'healthy' : `low (${addOnInv.currentStock}/${addOnInv.minStock})`}`,
        value: inventoryScore,
        baseline: 100,
        sampleSize: 1,
        confidence: 1,
      });
    }

    if (conflicts.hasConflict) {
      evidence.push({
        description: `Existing offer conflict: ${conflicts.conflictingOfferIds.length} active offer(s) on these products`,
        value: 0,
        baseline: 1,
        sampleSize: conflicts.conflictingOfferIds.length,
        confidence: 1,
      });
    }

    opportunities.push({
      id: `combo_${candidate.primaryProduct.id}_${candidate.addOnProduct.id}`,
      primaryProduct: {
        id: candidate.primaryProduct.id,
        name: candidate.primaryProduct.name,
        category: '', // Would need to fetch
        price: candidate.primaryProduct.price,
        cost: candidate.primaryProduct.price * (1 - candidate.primaryProduct.margin / 100),
        margin: candidate.primaryProduct.margin,
        dailyUnits: primaryDailyUnits,
        dailyRevenue: primaryDailyRevenue,
      },
      addOnProduct: {
        id: candidate.addOnProduct.id,
        name: candidate.addOnProduct.name,
        category: '',
        price: candidate.addOnProduct.price,
        cost: candidate.addOnProduct.price * (1 - candidate.addOnProduct.margin / 100),
        margin: candidate.addOnProduct.margin,
        dailyUnits: addOnDailyUnits,
        dailyRevenue: addOnDailyRevenue,
      },
      basketAffinity: {
        support: candidate.association.support,
        confidence: candidate.association.confidence,
        lift: candidate.association.lift,
        coOccurrenceCount: candidate.association.coOccurrenceCount,
      },
      comboEconomics: {
        normalPrice: candidate.primaryProduct.price + candidate.addOnProduct.price,
        suggestedComboPrice: candidate.suggestedComboPrice,
        discountPercent: Math.round((1 - candidate.suggestedComboPrice / (candidate.primaryProduct.price + candidate.addOnProduct.price)) * 100),
        estimatedMargin: candidate.estimatedMargin,
        projectedUnitsPerDay: Math.round(primaryDailyUnits * (candidate.association.confidence / 100)),
        projectedDailyRevenue: 0, // Will compute below
        projectedDailyContribution: 0, // Will compute below
      },
      inventoryHealth: {
        primaryStock: primaryInv.currentStock,
        primaryMinStock: primaryInv.minStock,
        primaryMaxStock: primaryInv.maxStock,
        addOnStock: addOnInv.currentStock,
        addOnMinStock: addOnInv.minStock,
        addOnMaxStock: addOnInv.maxStock,
        bothHealthy: primaryInv.healthy && addOnInv.healthy,
      },
      existingOffersConflict: conflicts,
      demandScore,
      marginScore,
      inventoryScore,
      overallScore,
      confidence,
      evidence,
      recommendedAction,
    });
  }

  // Compute projected revenue and contribution
  for (const opp of opportunities) {
    const projectedUnits = opp.comboEconomics.projectedUnitsPerDay;
    opp.comboEconomics.projectedDailyRevenue = projectedUnits * opp.comboEconomics.suggestedComboPrice;
    const comboCost = opp.primaryProduct.cost + opp.addOnProduct.cost;
    opp.comboEconomics.projectedDailyContribution = projectedUnits * (opp.comboEconomics.suggestedComboPrice - comboCost);
  }

  // Sort by overall score
  opportunities.sort((a, b) => b.overallScore - a.overallScore);

  return opportunities;
}

/**
 * Persist combo opportunities as signals
 */
export async function persistComboOpportunitiesAsSignals(
  restaurantId: string,
  branchId: string | undefined,
  opportunities: ComboOpportunity[]
): Promise<void> {
  if (opportunities.length === 0) return;

  const docs = opportunities.map(o => ({
    restaurantId: objectId(restaurantId),
    branchId: branchId ? objectId(branchId) : undefined,
    type: 'COMBO_AFFINITY_STRONG' as SignalType,
    entityType: 'combo_candidate',
    entityId: o.id,
    entityName: `${o.primaryProduct.name} + ${o.addOnProduct.name}`,
    value: o.overallScore,
    baseline: 50, // Neutral baseline
    percentageChange: o.overallScore - 50,
    confidence: o.confidence,
    minSampleSize: o.basketAffinity.coOccurrenceCount,
    sampleSize: o.basketAffinity.coOccurrenceCount,
    evidence: o.evidence,
    detectedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    consumed: false,
    tags: ['combo_opportunity', o.recommendedAction, o.primaryProduct.category, o.addOnProduct.category].filter(Boolean),
  }));

  await IntelligenceSignalModel.insertMany(docs, { ordered: false });
}

/**
 * Get top combo opportunities for a restaurant
 */
export async function getTopComboOpportunities(
  restaurantId: string,
  branchId?: string,
  limit: number = 5
): Promise<ComboOpportunity[]> {
  const opportunities = await detectComboOpportunities({ restaurantId, branchId });
  return opportunities.slice(0, limit);
}
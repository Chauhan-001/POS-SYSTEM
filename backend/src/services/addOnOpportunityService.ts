/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AddOnOpportunityService — Detects add-on/upsell/cross-sell opportunities
 * using basket affinity, margin analysis, and inventory availability.
 */

import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import OfferModel from '../models/Offer';
import IntelligenceSignalModel, { SignalType, ISignalEvidence } from '../models/IntelligenceSignal';
import { findAddOnCandidates } from './basketAnalysisService';
import { computeProductBaselines, ProductBaseline } from './salesBaselineService';

export type AddOnType = 'add_on' | 'cross_sell' | 'upsell' | 'checkout_suggestion';

export interface AddOnOpportunity {
  id: string;
  type: AddOnType;
  mainProduct: {
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
  economics: {
    suggestedAddOnPrice: number;
    standalonePrice: number;
    discountPercent: number;
    estimatedMargin: number;
    projectedAttachRate: number;
    projectedDailyAddOnUnits: number;
    projectedDailyRevenue: number;
    projectedDailyContribution: number;
  };
  inventoryHealth: {
    mainStock: number;
    mainMinStock: number;
    addOnStock: number;
    addOnMinStock: number;
    bothHealthy: boolean;
  };
  existingOffersConflict: {
    hasConflict: boolean;
    conflictingOfferIds: string[];
  };
  demandScore: number;
  marginScore: number;
  inventoryScore: number;
  affinityScore: number;
  overallScore: number;
  confidence: number;
  evidence: ISignalEvidence[];
  recommendedAction: 'create_addon' | 'test_addon' | 'monitor';
}

export interface AddOnOpportunityOptions {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number;
  minLift?: number;
  minConfidence?: number;
  minAddOnMargin?: number;
  maxAddOnPriceRatio?: number; // Add-on price as % of main price
  minMainDailyUnits?: number;
  minAddOnDailyUnits?: number;
}

const DEFAULT_MIN_LIFT = 1.2;
const DEFAULT_MIN_CONFIDENCE = 10;
const DEFAULT_MIN_ADDON_MARGIN = 20;
const DEFAULT_MAX_ADDON_PRICE_RATIO = 0.5; // Add-on max 50% of main price
const DEFAULT_MIN_MAIN_UNITS = 10;
const DEFAULT_MIN_ADDON_UNITS = 3;

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * Check for existing conflicting offers
 */
async function checkExistingOfferConflicts(
  restaurantId: string,
  mainProductId: string,
  addOnProductId: string
): Promise<{ hasConflict: boolean; conflictingOfferIds: string[] }> {
  const offers = await OfferModel.find({
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
    status: 'active',
    $or: [
      { applicableProductIds: { $in: [mainProductId, addOnProductId] } },
    ],
  })
    .select('_id title type applicableProductIds')
    .lean()
    .exec();

  const conflicting: string[] = [];
  for (const offer of offers) {
    const applicableIds = (offer.applicableProductIds || []).map(String);
    if (applicableIds.includes(mainProductId) || applicableIds.includes(addOnProductId)) {
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
 * Classify add-on type based on basket affinity and product characteristics
 */
function classifyAddOnType(
  mainPrice: number,
  addOnPrice: number,
  confidence: number,
  lift: number,
  sameCategory: boolean
): AddOnType {
  const priceRatio = addOnPrice / mainPrice;

  if (priceRatio > 0.3 && confidence > 30 && lift > 1.5) {
    return 'upsell'; // Significant upgrade
  }
  if (sameCategory && confidence > 20) {
    return 'cross_sell'; // Same category alternative/addition
  }
  if (priceRatio < 0.25 && confidence > 15) {
    return 'add_on'; // Small addition (fries, drink, etc.)
  }
  return 'checkout_suggestion'; // Weak affinity, suggest at checkout
}

/**
 * Compute demand score
 */
function computeDemandScore(mainUnits: number, addOnUnits: number, mainRevenue: number, addOnRevenue: number): number {
  const mainScore = Math.min(100, (mainUnits / 30) * 100); // 30 units/day = 100
  const addOnScore = Math.min(100, (addOnUnits / 15) * 100); // 15 units/day = 100
  const totalRevenue = mainRevenue + addOnRevenue;
  if (totalRevenue === 0) return 0;
  const mainWeight = mainRevenue / totalRevenue;
  return Math.round(mainScore * mainWeight + addOnScore * (1 - mainWeight));
}

/**
 * Compute margin score
 */
function computeMarginScore(addOnMargin: number): number {
  // 20% margin = 50 score, 40% = 100 score
  return Math.min(100, Math.max(0, Math.round((addOnMargin - 20) / 20 * 100)));
}

/**
 * Compute inventory score
 */
function computeInventoryScore(mainHealthy: boolean, addOnHealthy: boolean): number {
  let score = 0;
  if (mainHealthy) score += 60;
  if (addOnHealthy) score += 40;
  return score;
}

/**
 * Compute affinity score
 */
function computeAffinityScore(confidence: number, lift: number): number {
  // Confidence 0-100, Lift 1.0+
  const confScore = Math.min(100, confidence);
  const liftScore = Math.min(100, (lift - 1) * 50); // Lift 3.0 = 100
  return Math.round(confScore * 0.6 + liftScore * 0.4);
}

/**
 * Detect add-on opportunities
 */
export async function detectAddOnOpportunities(opts: AddOnOpportunityOptions): Promise<AddOnOpportunity[]> {
  const {
    restaurantId,
    branchId,
    lookbackDays = 90,
    minLift = DEFAULT_MIN_LIFT,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    minAddOnMargin = DEFAULT_MIN_ADDON_MARGIN,
    maxAddOnPriceRatio = DEFAULT_MAX_ADDON_PRICE_RATIO,
    minMainDailyUnits = DEFAULT_MIN_MAIN_UNITS,
    minAddOnDailyUnits = DEFAULT_MIN_ADDON_UNITS,
  } = opts;

  // Get basket analysis add-on candidates
  const basketCandidates = await findAddOnCandidates({
    restaurantId,
    branchId,
    lookbackDays,
    minAddOnMargin,
  });

  if (basketCandidates.length === 0) return [];

  // Get product baselines for demand validation
  const baselines = await computeProductBaselines({ restaurantId, branchId, lookbackDays });
  const baselineMap = new Map(baselines.map(b => [b.productId, b]));

  // Get inventory health
  const allProductIds = new Set<string>();
  for (const c of basketCandidates) {
    allProductIds.add(c.mainProduct.id);
    allProductIds.add(c.addOnProduct.id);
  }
  const inventoryHealth = await getInventoryHealth(restaurantId, Array.from(allProductIds));

  // Get product categories
  const products = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    _id: { $in: Array.from(allProductIds).map(objectId) },
    isDeleted: { $ne: true },
  })
    .select('_id name category')
    .lean()
    .exec();
  const categoryMap = new Map(products.map(p => [String(p._id), p.category || 'Other']));

  // Check existing offer conflicts
  const conflictChecks = await Promise.all(
    basketCandidates.map(c => checkExistingOfferConflicts(restaurantId, c.mainProduct.id, c.addOnProduct.id))
  );

  const opportunities: AddOnOpportunity[] = [];

  for (let i = 0; i < basketCandidates.length; i++) {
    const candidate = basketCandidates[i];
    const conflicts = conflictChecks[i];

    const mainBaseline = baselineMap.get(candidate.mainProduct.id);
    const addOnBaseline = baselineMap.get(candidate.addOnProduct.id);

    if (!mainBaseline || !addOnBaseline) continue;

    const mainDailyUnits = mainBaseline.metric === 'units' ? mainBaseline.value : 0;
    const addOnDailyUnits = addOnBaseline.metric === 'units' ? addOnBaseline.value : 0;
    const mainDailyRevenue = mainBaseline.metric === 'revenue' ? mainBaseline.value : 0;
    const addOnDailyRevenue = addOnBaseline.metric === 'revenue' ? addOnBaseline.value : 0;

    // Check minimum demand
    if (mainDailyUnits < minMainDailyUnits) continue;
    if (addOnDailyUnits < minAddOnDailyUnits) continue;

    // Check affinity thresholds
    if (candidate.association.lift < minLift) continue;
    if (candidate.association.confidence < minConfidence) continue;

    // Check price ratio
    const priceRatio = candidate.addOnProduct.price / candidate.mainProduct.price;
    if (priceRatio > maxAddOnPriceRatio) continue;

    // Inventory health
    const mainInv = inventoryHealth.get(candidate.mainProduct.id) || { currentStock: 0, minStock: 0, maxStock: 0, healthy: false };
    const addOnInv = inventoryHealth.get(candidate.addOnProduct.id) || { currentStock: 0, minStock: 0, maxStock: 0, healthy: false };

    // Classify type
    const sameCategory = categoryMap.get(candidate.mainProduct.id) === categoryMap.get(candidate.addOnProduct.id);
    const type = classifyAddOnType(
      candidate.mainProduct.price,
      candidate.addOnProduct.price,
      candidate.association.confidence,
      candidate.association.lift,
      sameCategory
    );

    // Scores
    const demandScore = computeDemandScore(mainDailyUnits, addOnDailyUnits, mainDailyRevenue, addOnDailyRevenue);
    const marginScore = computeMarginScore(candidate.addOnProduct.margin);
    const inventoryScore = computeInventoryScore(mainInv.healthy, addOnInv.healthy);
    const affinityScore = computeAffinityScore(candidate.association.confidence, candidate.association.lift);

    const overallScore = Math.round(
      demandScore * 0.3 +
      marginScore * 0.25 +
      inventoryScore * 0.15 +
      affinityScore * 0.3
    );

    const confidence = Math.min(
      1,
      (mainBaseline.confidence + addOnBaseline.confidence + (candidate.association.confidence / 100)) / 3
    );

    let recommendedAction: AddOnOpportunity['recommendedAction'] = 'monitor';
    if (overallScore >= 65 && confidence >= 0.55 && !conflicts.hasConflict) {
      recommendedAction = 'create_addon';
    } else if (overallScore >= 45 && confidence >= 0.35) {
      recommendedAction = 'test_addon';
    }

    // Projected attach rate based on confidence and lift
    const baseAttachRate = candidate.association.confidence / 100;
    const projectedAttachRate = Math.min(baseAttachRate * 1.2, 0.8); // Cap at 80%

    const evidence: ISignalEvidence[] = [
      {
        description: `Basket affinity: ${candidate.association.confidence}% of ${candidate.mainProduct.name} orders include ${candidate.addOnProduct.name} (${candidate.association.lift}x lift)`,
        value: candidate.association.lift,
        baseline: 1.0,
        percentageChange: Math.round((candidate.association.lift - 1) * 100),
        sampleSize: candidate.association.coOccurrenceCount,
        confidence: candidate.association.confidence / 100,
      },
      {
        description: `Economics: ₹${candidate.suggestedAddOnPrice} add-on price (${Math.round((1 - candidate.suggestedAddOnPrice / candidate.addOnProduct.price) * 100)}% off standalone ₹${candidate.addOnProduct.price}), ${candidate.addOnProduct.margin}% margin`,
        value: candidate.addOnProduct.margin,
        baseline: minAddOnMargin,
        percentageChange: Math.round(((candidate.addOnProduct.margin - minAddOnMargin) / minAddOnMargin) * 100),
        sampleSize: mainBaseline.sampleSize,
        confidence,
      },
      {
        description: `Demand: ${mainDailyUnits} ${candidate.mainProduct.name}/day, ${addOnDailyUnits} ${candidate.addOnProduct.name}/day`,
        value: mainDailyUnits + addOnDailyUnits,
        baseline: minMainDailyUnits + minAddOnDailyUnits,
        sampleSize: mainBaseline.sampleSize,
        confidence: mainBaseline.confidence,
      },
    ];

    if (!mainInv.healthy || !addOnInv.healthy) {
      evidence.push({
        description: `Inventory: ${candidate.mainProduct.name} ${mainInv.healthy ? 'healthy' : `low (${mainInv.currentStock}/${mainInv.minStock})`}, ${candidate.addOnProduct.name} ${addOnInv.healthy ? 'healthy' : `low (${addOnInv.currentStock}/${addOnInv.minStock})`}`,
        value: inventoryScore,
        baseline: 100,
        sampleSize: 1,
        confidence: 1,
      });
    }

    if (conflicts.hasConflict) {
      evidence.push({
        description: `Existing offer conflict: ${conflicts.conflictingOfferIds.length} active offer(s)`,
        value: 0,
        baseline: 1,
        sampleSize: conflicts.conflictingOfferIds.length,
        confidence: 1,
      });
    }

    // Economics
    const projectedDailyAddOnUnits = Math.round(mainDailyUnits * projectedAttachRate);
    const projectedDailyRevenue = projectedDailyAddOnUnits * candidate.suggestedAddOnPrice;
    const addOnCost = candidate.addOnProduct.price * (1 - candidate.addOnProduct.margin / 100);
    const projectedDailyContribution = projectedDailyAddOnUnits * (candidate.suggestedAddOnPrice - addOnCost);

    opportunities.push({
      id: `addon_${candidate.mainProduct.id}_${candidate.addOnProduct.id}`,
      type,
      mainProduct: {
        id: candidate.mainProduct.id,
        name: candidate.mainProduct.name,
        category: categoryMap.get(candidate.mainProduct.id) || 'Other',
        price: candidate.mainProduct.price,
        cost: candidate.mainProduct.price * (1 - candidate.mainProduct.margin / 100),
        margin: candidate.mainProduct.margin,
        dailyUnits: mainDailyUnits,
        dailyRevenue: mainDailyRevenue,
      },
      addOnProduct: {
        id: candidate.addOnProduct.id,
        name: candidate.addOnProduct.name,
        category: categoryMap.get(candidate.addOnProduct.id) || 'Other',
        price: candidate.addOnProduct.price,
        cost: addOnCost,
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
      economics: {
        suggestedAddOnPrice: candidate.suggestedAddOnPrice,
        standalonePrice: candidate.addOnProduct.price,
        discountPercent: Math.round((1 - candidate.suggestedAddOnPrice / candidate.addOnProduct.price) * 100),
        estimatedMargin: candidate.addOnProduct.margin,
        projectedAttachRate: Math.round(projectedAttachRate * 100),
        projectedDailyAddOnUnits,
        projectedDailyRevenue: Math.round(projectedDailyRevenue),
        projectedDailyContribution: Math.round(projectedDailyContribution),
      },
      inventoryHealth: {
        mainStock: mainInv.currentStock,
        mainMinStock: mainInv.minStock,
        addOnStock: addOnInv.currentStock,
        addOnMinStock: addOnInv.minStock,
        bothHealthy: mainInv.healthy && addOnInv.healthy,
      },
      existingOffersConflict: conflicts,
      demandScore,
      marginScore,
      inventoryScore,
      affinityScore,
      overallScore,
      confidence,
      evidence,
      recommendedAction,
    });
  }

  // Sort by overall score
  opportunities.sort((a, b) => b.overallScore - a.overallScore);

  return opportunities;
}

/**
 * Persist add-on opportunities as signals
 */
export async function persistAddOnOpportunitiesAsSignals(
  restaurantId: string,
  branchId: string | undefined,
  opportunities: AddOnOpportunity[]
): Promise<void> {
  if (opportunities.length === 0) return;

  const docs = opportunities.map(o => ({
    restaurantId: objectId(restaurantId),
    branchId: branchId ? objectId(branchId) : undefined,
    type: 'ADDON_ATTACH_RATE_HIGH' as SignalType,
    entityType: 'addon_candidate',
    entityId: o.id,
    entityName: `${o.mainProduct.name} → ${o.addOnProduct.name}`,
    value: o.overallScore,
    baseline: 50,
    percentageChange: o.overallScore - 50,
    confidence: o.confidence,
    minSampleSize: o.basketAffinity.coOccurrenceCount,
    sampleSize: o.basketAffinity.coOccurrenceCount,
    evidence: o.evidence,
    detectedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    consumed: false,
    tags: ['addon_opportunity', o.type, o.recommendedAction, o.mainProduct.category, o.addOnProduct.category].filter(Boolean),
  }));

  await IntelligenceSignalModel.insertMany(docs, { ordered: false });
}

/**
 * Get top add-on opportunities
 */
export async function getTopAddOnOpportunities(
  restaurantId: string,
  branchId?: string,
  limit: number = 5
): Promise<AddOnOpportunity[]> {
  const opportunities = await detectAddOnOpportunities({ restaurantId, branchId });
  return opportunities.slice(0, limit);
}
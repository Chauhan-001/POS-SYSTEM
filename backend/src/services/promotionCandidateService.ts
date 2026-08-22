/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PromotionCandidateService — Combines all signals into commercially viable
 * promotion candidates with full financial evaluation.
 *
 * Every candidate must pass financial safety checks before becoming a recommendation.
 */

import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import OfferModel from '../models/Offer';
import CustomerSegmentModel from '../models/CustomerSegment';
import IntelligenceSignalModel, { SignalType, ISignalEvidence } from '../models/IntelligenceSignal';
import { detectComboOpportunities, ComboOpportunity } from './comboOpportunityService';
import { detectAddOnOpportunities, AddOnOpportunity } from './addOnOpportunityService';
import { detectInventoryOpportunities, InventoryDrivenOpportunity } from './inventoryOpportunityService';
import { detectCustomerOpportunities, CustomerSegmentOpportunity } from './customerOpportunityService';
import { analyzeMenuEngineering, MenuEngineeringItem } from './menuEngineeringService';
import { detectMarginSignals, MarginSignalItem } from './marginSignalsService';
import { detectAllDemandAnomalies, DemandAnomaly } from './demandAnomalyService';

export type PromotionType =
  | 'CREATE_COMBO'
  | 'CREATE_ADDON'
  | 'CREATE_PROMOTION'
  | 'RUN_REACTIVATION'
  | 'REVIEW_PRICE'
  | 'REVIEW_RECIPE_COST'
  | 'PROMOTE_SLOW_ITEM'
  | 'PROTECT_HIGH_DEMAND_STOCK'
  | 'REDUCE_WASTAGE';

export type PromotionStatus =
  | 'NEW'
  | 'VIEWED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'SNOOZED'
  | 'IMPLEMENTED'
  | 'EXPIRED'
  | 'CONVERTED'
  | 'COOLDOWN';

export interface FinancialModel {
  currentPrice: number;
  proposedPrice: number;
  recipeCost: number;
  discountPercent: number;
  discountAmount: number;
  currentContribution: number;
  projectedContribution: number;
  projectedContributionMargin: number;
  incrementalUnits: number;
  incrementalRevenue: number;
  incrementalContribution: number;
  breakEvenIncrementalUnits: number;
  paybackPeriodDays: number;
  minMarginConstraint: number;
  maxDiscountConstraint: number;
}

export interface CannibalizationEstimate {
  estimatedCannibalizationRate: number; // 0-1
  incrementalVsCannibalized: number; // Ratio > 1 means net positive
  confidence: number;
  evidence: ISignalEvidence[];
}

export interface BusinessConstraints {
  minMarginPercent: number;
  maxDiscountPercent: number;
  minSellingPrice: number;
  restrictedCategories: string[];
  excludedProductIds: string[];
}

export interface PromotionCandidate {
  id: string;
  type: PromotionType;
  priority: 'high' | 'medium' | 'low';
  score: number; // 0-100 unified score
  confidence: number; // 0-1
  title: string;
  description: string;
  target: {
    productIds: string[];
    productNames: string[];
    categoryIds: string[];
    segmentIds: string[];
  };
  evidence: ISignalEvidence[];
  financialModel: FinancialModel;
  cannibalization: CannibalizationEstimate;
  risks: string[];
  prerequisites: string[];
  constraints: BusinessConstraints;
  status: PromotionStatus;
  recommendedAction: 'create_offer' | 'create_combo' | 'create_campaign' | 'review_pricing' | 'review_recipe' | 'reduce_purchases';
  sourceSignals: string[]; // IDs of source signals
  createdAt: Date;
  expiresAt: Date;
}

export interface PromotionCandidateOptions {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number;
  constraints?: Partial<BusinessConstraints>;
  minScore?: number; // Default 40
  minConfidence?: number; // Default 0.4
}

const DEFAULT_MIN_SCORE = 40;
const DEFAULT_MIN_CONFIDENCE = 0.4;
const DEFAULT_CONSTRAINTS: BusinessConstraints = {
  minMarginPercent: 15,
  maxDiscountPercent: 30,
  minSellingPrice: 50,
  restrictedCategories: [],
  excludedProductIds: [],
};

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * Default elasticity estimates by category/type
 */
const ELASTICITY_ESTIMATES: Record<string, number> = {
  beverages: -1.5,
  appetizers: -1.3,
  mains: -1.0,
  desserts: -1.4,
  default: -1.2,
};

/**
 * Estimate price elasticity for a product/category
 */
function estimateElasticity(category: string): number {
  const cat = category.toLowerCase();
  for (const [key, value] of Object.entries(ELASTICITY_ESTIMATES)) {
    if (cat.includes(key)) return value;
  }
  return ELASTICITY_ESTIMATES.default;
}

/**
 * Calculate financial model for a promotion
 */
function calculateFinancialModel(
  price: number,
  cost: number,
  discountPercent: number,
  baselineUnits: number,
  elasticity: number,
  incrementalUnitsEstimate?: number
): FinancialModel {
  const proposedPrice = Math.round(price * (1 - discountPercent / 100));
  const discountAmount = price - proposedPrice;
  const currentContribution = price - cost;
  const projectedContribution = proposedPrice - cost;
  const projectedContributionMargin = proposedPrice > 0 ? Math.round((projectedContribution / proposedPrice) * 100) : 0;

  // Estimate incremental units from elasticity
  // %ΔQ = elasticity × %ΔP
  const pctPriceChange = -discountPercent / 100;
  const estimatedPctVolumeChange = elasticity * pctPriceChange;
  const estimatedIncrementalUnits = Math.round(baselineUnits * estimatedPctVolumeChange);

  // Use provided estimate if available (e.g., from basket analysis)
  const incrementalUnits = incrementalUnitsEstimate ?? Math.max(0, estimatedIncrementalUnits);

  const incrementalRevenue = incrementalUnits * proposedPrice;
  const incrementalContribution = incrementalUnits * projectedContribution;

  // Break-even: how many incremental units needed to offset margin loss on base units
  const marginLossPerBaseUnit = discountAmount;
  const totalMarginLossOnBase = baselineUnits * marginLossPerBaseUnit;
  const breakEvenIncrementalUnits = projectedContribution > 0
    ? Math.ceil(totalMarginLossOnBase / projectedContribution)
    : Infinity;

  // Payback period (days to recover margin loss on base volume)
  const dailyContributionGain = incrementalContribution / 30; // Assume 30-day promotion
  const paybackPeriodDays = dailyContributionGain > 0
    ? Math.ceil(totalMarginLossOnBase / dailyContributionGain)
    : Infinity;

  return {
    currentPrice: price,
    proposedPrice,
    recipeCost: cost,
    discountPercent,
    discountAmount,
    currentContribution,
    projectedContribution,
    projectedContributionMargin,
    incrementalUnits,
    incrementalRevenue: Math.round(incrementalRevenue),
    incrementalContribution: Math.round(incrementalContribution),
    breakEvenIncrementalUnits,
    paybackPeriodDays,
    minMarginConstraint: DEFAULT_CONSTRAINTS.minMarginPercent,
    maxDiscountConstraint: DEFAULT_CONSTRAINTS.maxDiscountPercent,
  };
}

/**
 * Estimate cannibalization
 */
function estimateCannibalization(
  type: PromotionType,
  targetProductIds: string[],
  baselineUnits: number,
  incrementalUnits: number,
  existingAttachmentRate?: number
): CannibalizationEstimate {
  let cannibalizationRate = 0;
  let evidence: ISignalEvidence[] = [];

  if (type === 'CREATE_COMBO' && existingAttachmentRate) {
    // If products already bought together X% of time, combo discount mainly cannibalizes
    cannibalizationRate = existingAttachmentRate;
    evidence.push({
      description: `Products already co-purchased ${Math.round(existingAttachmentRate * 100)}% of time — high cannibalization risk`,
      value: existingAttachmentRate,
      baseline: 0.2,
      confidence: 0.8,
    });
  } else if (type === 'CREATE_PROMOTION') {
    // General promotion cannibalization estimate
    cannibalizationRate = 0.3; // Conservative estimate
    evidence.push({
      description: 'Category-wide promotion may discount existing demand',
      value: 0.3,
      baseline: 0.2,
      confidence: 0.5,
    });
  } else if (type === 'CREATE_ADDON') {
    // Add-ons have lower cannibalization
    cannibalizationRate = 0.15;
    evidence.push({
      description: 'Add-on targets incremental purchase, low cannibalization',
      value: 0.15,
      baseline: 0.2,
      confidence: 0.7,
    });
  }

  const incrementalVsCannibalized = cannibalizationRate > 0
    ? incrementalUnits / (baselineUnits * cannibalizationRate)
    : incrementalUnits > 0 ? 10 : 0;

  return {
    estimatedCannibalizationRate: Math.round(cannibalizationRate * 100) / 100,
    incrementalVsCannibalized: Math.round(incrementalVsCannibalized * 100) / 100,
    confidence: 0.6,
    evidence,
  };
}

/**
 * Validate financial model against constraints
 */
function validateFinancialModel(
  model: FinancialModel,
  constraints: BusinessConstraints
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (model.projectedContributionMargin < constraints.minMarginPercent) {
    violations.push(`Projected margin ${model.projectedContributionMargin}% below minimum ${constraints.minMarginPercent}%`);
  }
  if (model.discountPercent > constraints.maxDiscountPercent) {
    violations.push(`Discount ${model.discountPercent}% exceeds maximum ${constraints.maxDiscountPercent}%`);
  }
  if (model.proposedPrice < constraints.minSellingPrice) {
    violations.push(`Proposed price ₹${model.proposedPrice} below minimum ₹${constraints.minSellingPrice}`);
  }
  if (model.incrementalContribution <= 0) {
    violations.push('Promotion generates negative incremental contribution');
  }
  if (model.breakEvenIncrementalUnits > model.incrementalUnits * 2) {
    violations.push('Break-even requires >2x estimated incremental volume (high risk)');
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Build promotion candidate from combo opportunity
 */
function buildCandidateFromCombo(
  opp: ComboOpportunity,
  constraints: BusinessConstraints
): PromotionCandidate | null {
  const primary = opp.primaryProduct;
  const addOn = opp.addOnProduct;

  const financialModel = calculateFinancialModel(
    primary.price + addOn.price,
    primary.cost + addOn.cost,
    opp.comboEconomics.discountPercent,
    primary.dailyUnits,
    estimateElasticity(primary.category),
    opp.comboEconomics.projectedUnitsPerDay
  );

  const validation = validateFinancialModel(financialModel, constraints);
  if (!validation.valid) return null;

  const cannibalization = estimateCannibalization(
    'CREATE_COMBO',
    [primary.id, addOn.id],
    primary.dailyUnits,
    opp.comboEconomics.projectedUnitsPerDay,
    opp.basketAffinity.confidence / 100
  );

  const risks = [
    ...validation.violations,
    ...(cannibalization.incrementalVsCannibalized < 1.5 ? ['High cannibalization risk — combo mainly discounts existing co-purchases'] : []),
    ...(opp.existingOffersConflict.hasConflict ? ['Conflicts with existing active offers'] : []),
    ...(!opp.inventoryHealth.bothHealthy ? ['Inventory risk on one or both components'] : []),
  ];

  return {
    id: `promo_${opp.id}`,
    type: 'CREATE_COMBO',
    priority: opp.overallScore >= 70 ? 'high' : opp.overallScore >= 50 ? 'medium' : 'low',
    score: opp.overallScore,
    confidence: opp.confidence,
    title: opp.id.replace('combo_', ''),
    description: `Bundle ${primary.name} + ${addOn.name} for ₹${opp.comboEconomics.suggestedComboPrice} (save ₹${Math.round(opp.comboEconomics.normalPrice - opp.comboEconomics.suggestedComboPrice)})`,
    target: {
      productIds: [primary.id, addOn.id],
      productNames: [primary.name, addOn.name],
      categoryIds: [],
      segmentIds: [],
    },
    evidence: opp.evidence,
    financialModel,
    cannibalization,
    risks: risks.filter(Boolean),
    prerequisites: [
      'Verify inventory availability for both items',
      'Confirm no active conflicting offers',
      'Set up combo in POS system',
    ],
    constraints,
    status: 'NEW',
    recommendedAction: 'create_combo',
    sourceSignals: ['basket_affinity', 'margin_analysis', 'inventory_health'],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}

/**
 * Build candidate from add-on opportunity
 */
function buildCandidateFromAddOn(
  opp: AddOnOpportunity,
  constraints: BusinessConstraints
): PromotionCandidate | null {
  const main = opp.mainProduct;
  const addOn = opp.addOnProduct;

  const financialModel = calculateFinancialModel(
    addOn.price,
    addOn.cost,
    opp.economics.discountPercent,
    main.dailyUnits,
    estimateElasticity(addOn.category),
    opp.economics.projectedDailyAddOnUnits
  );

  const validation = validateFinancialModel(financialModel, constraints);
  if (!validation.valid) return null;

  const cannibalization = estimateCannibalization(
    'CREATE_ADDON',
    [main.id, addOn.id],
    main.dailyUnits,
    opp.economics.projectedDailyAddOnUnits
  );

  const risks = [
    ...validation.violations,
    ...(cannibalization.incrementalVsCannibalized < 1.2 ? ['Low incremental value'] : []),
    ...(opp.existingOffersConflict.hasConflict ? ['Conflicts with existing active offers'] : []),
    ...(!opp.inventoryHealth.bothHealthy ? ['Inventory risk'] : []),
  ];

  return {
    id: `promo_${opp.id}`,
    type: 'CREATE_ADDON',
    priority: opp.overallScore >= 65 ? 'high' : opp.overallScore >= 45 ? 'medium' : 'low',
    score: opp.overallScore,
    confidence: opp.confidence,
    title: `${main.name} → ${addOn.name} Add-on`,
    description: `Offer ${addOn.name} for ₹${opp.economics.suggestedAddOnPrice} with ${main.name} (${opp.economics.discountPercent}% off)`,
    target: {
      productIds: [main.id, addOn.id],
      productNames: [main.name, addOn.name],
      categoryIds: [],
      segmentIds: [],
    },
    evidence: opp.evidence,
    financialModel,
    cannibalization,
    risks: risks.filter(Boolean),
    prerequisites: [
      'Configure add-on in POS billing flow',
      'Train staff on upsell script',
    ],
    constraints,
    status: 'NEW',
    recommendedAction: 'create_offer',
    sourceSignals: ['basket_affinity', 'margin_analysis', 'inventory_health'],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}

/**
 * Build candidate from inventory opportunity
 */
function buildCandidateFromInventory(
  opp: InventoryDrivenOpportunity,
  constraints: BusinessConstraints
): PromotionCandidate | null {
  const topItem = opp.menuItems[0];
  if (!topItem) return null;

  const financialModel = calculateFinancialModel(
    topItem.price,
    topItem.cost,
    opp.promotionCandidate.suggestedDiscount,
    topItem.dailyUnits,
    estimateElasticity(topItem.category),
    opp.promotionCandidate.projectedIncrementalUnits
  );

  const validation = validateFinancialModel(financialModel, constraints);
  if (!validation.valid) return null;

  const cannibalization = estimateCannibalization(
    'CREATE_PROMOTION',
    opp.promotionCandidate.targetItems,
    topItem.dailyUnits,
    opp.promotionCandidate.projectedIncrementalUnits
  );

  const risks = [
    ...validation.violations,
    ...(cannibalization.incrementalVsCannibalized < 1.5 ? ['Promotion may mainly discount existing demand'] : []),
    ...(opp.ingredient.opportunityType === 'EXPIRY_RISK' && !opp.promotionCandidate.canClearStock ? ['Cannot clear expiring stock in time'] : []),
  ];

  return {
    id: `promo_${opp.id}`,
    type: opp.ingredient.opportunityType === 'EXPIRY_RISK' ? 'REDUCE_WASTAGE' : 'CREATE_PROMOTION',
    priority: opp.overallScore >= 65 ? 'high' : opp.overallScore >= 45 ? 'medium' : 'low',
    score: opp.overallScore,
    confidence: opp.confidence,
    title: `${opp.ingredient.ingredientName} Clearance`,
    description: `${opp.promotionCandidate.suggestedDiscount}% off on ${opp.menuItems.map(i => i.productName).join(', ')} to clear ${opp.ingredient.opportunityType.toLowerCase()} stock`,
    target: {
      productIds: opp.promotionCandidate.targetItems,
      productNames: opp.menuItems.map(i => i.productName),
      categoryIds: [],
      segmentIds: [],
    },
    evidence: opp.evidence,
    financialModel,
    cannibalization,
    risks: risks.filter(Boolean),
    prerequisites: [
      'Verify stock levels',
      'Set promotion duration based on shelf life',
    ],
    constraints,
    status: 'NEW',
    recommendedAction: opp.recommendedAction === 'run_promotion' ? 'create_offer' :
      opp.recommendedAction === 'test_promotion' ? 'create_offer' : 'reduce_purchases',
    sourceSignals: ['inventory_analysis', 'recipe_linkage', 'margin_analysis'],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  };
}

/**
 * Build candidate from customer opportunity
 */
function buildCandidateFromCustomer(
  opp: CustomerSegmentOpportunity,
  constraints: BusinessConstraints
): PromotionCandidate {
  const isReactivation = opp.opportunityType === 'INACTIVE' || opp.opportunityType === 'AT_RISK';
  const discount = isReactivation ? 20 : 10;
  const minOrder = Math.max(300, Math.round(opp.avgOrderValue * 0.9));

  const financialModel = calculateFinancialModel(
    opp.avgOrderValue,
    opp.avgOrderValue * 0.7, // Estimated cost
    discount,
    opp.customerCount,
    -1.2,
    Math.round(opp.customerCount * 0.15) // Estimated reactivation rate
  );

  const validation = validateFinancialModel(financialModel, constraints);

  return {
    id: `promo_customer_${opp.segmentId}`,
    type: isReactivation ? 'RUN_REACTIVATION' : 'CREATE_PROMOTION',
    priority: opp.severity === 'high' ? 'high' : 'medium',
    score: opp.severity === 'high' ? 75 : 60,
    confidence: 0.7,
    title: isReactivation ? `Win Back: ${opp.segmentName}` : `Reward: ${opp.segmentName}`,
    description: isReactivation
      ? `₹${discount} off orders above ₹${minOrder} for ${opp.customerCount} inactive customers`
      : `VIP reward for ${opp.customerCount} high-value customers`,
    target: {
      productIds: [],
      productNames: [],
      categoryIds: [],
      segmentIds: [opp.segmentId],
    },
    evidence: opp.evidence,
    financialModel,
    cannibalization: estimateCannibalization('CREATE_PROMOTION', [], opp.customerCount, financialModel.incrementalUnits),
    risks: [...validation.violations, 'Customer acquisition cost not accounted'],
    prerequisites: ['Configure segment targeting in campaign manager'],
    constraints,
    status: 'NEW',
    recommendedAction: isReactivation ? 'create_campaign' : 'create_offer',
    sourceSignals: ['customer_segmentation', 'lifecycle_analysis'],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}

/**
 * Build candidate from menu engineering
 */
function buildCandidateFromMenuEngineering(
  item: MenuEngineeringItem,
  constraints: BusinessConstraints
): PromotionCandidate | null {
  let type: PromotionType;
  let title: string;
  let description: string;
  let discount = 0;

  switch (item.classification) {
    case 'PUZZLE':
      type = 'PROMOTE_SLOW_ITEM';
      discount = 15;
      title = `Promote ${item.productName}`;
      description = `High-margin item (${item.contributionMarginPercent}%) with low sales — promote to drive trial`;
      break;
    case 'PLOWHORSE':
      type = 'REVIEW_PRICE';
      discount = 0; // Not a discount, price review
      title = `Review Price: ${item.productName}`;
      description = `High volume but low margin (${item.contributionMarginPercent}%) — review pricing or recipe cost`;
      break;
    case 'DOG':
      if (item.dailyUnits > 0) {
        type = 'PROMOTE_SLOW_ITEM';
        discount = 20;
        title = `Clear ${item.productName}`;
        description = `Low margin, low volume — limited promotion to test demand`;
      } else {
        return null; // Truly dead item
      }
      break;
    default:
      return null;
  }

  const financialModel = calculateFinancialModel(
    item.price,
    item.cost,
    discount,
    item.dailyUnits,
    estimateElasticity(item.category),
    Math.round(item.dailyUnits * 0.5)
  );

  if (discount > 0) {
    const validation = validateFinancialModel(financialModel, constraints);
    if (!validation.valid) return null;
  }

  return {
    id: `promo_menu_${item.productId}`,
    type,
    priority: item.classification === 'PUZZLE' ? 'high' : 'medium',
    score: item.classification === 'PUZZLE' ? 70 : item.classification === 'PLOWHORSE' ? 55 : 45,
    confidence: item.trendConfidence,
    title,
    description,
    target: {
      productIds: [item.productId],
      productNames: [item.productName],
      categoryIds: [],
      segmentIds: [],
    },
    evidence: item.evidence,
    financialModel: discount > 0 ? financialModel : {
      currentPrice: item.price,
      proposedPrice: item.price,
      recipeCost: item.cost,
      discountPercent: 0,
      discountAmount: 0,
      currentContribution: item.contributionMargin,
      projectedContribution: item.contributionMargin,
      projectedContributionMargin: item.contributionMarginPercent,
      incrementalUnits: 0,
      incrementalRevenue: 0,
      incrementalContribution: 0,
      breakEvenIncrementalUnits: 0,
      paybackPeriodDays: 0,
      minMarginConstraint: constraints.minMarginPercent,
      maxDiscountConstraint: constraints.maxDiscountPercent,
    },
    cannibalization: { estimatedCannibalizationRate: 0, incrementalVsCannibalized: 0, confidence: 0, evidence: [] },
    risks: item.classification === 'PLOWHORSE' ? ['Price increase could reduce volume'] : ['Low incremental value expected'],
    prerequisites: item.classification === 'PLOWHORSE' ? ['Analyze recipe cost breakdown', 'Test price elasticity'] : ['Set up targeted promotion'],
    constraints,
    status: 'NEW',
    recommendedAction: discount > 0 ? 'create_offer' : 'review_pricing',
    sourceSignals: ['menu_engineering', 'margin_analysis', 'demand_analysis'],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}

/**
 * Build candidate from margin signal
 */
function buildCandidateFromMarginSignal(
  signal: MarginSignalItem,
  constraints: BusinessConstraints
): PromotionCandidate | null {
  if (signal.signalType === 'HIGH_SELLING_LOW_MARGIN') {
    // Don't create promotion — create warning
    return {
      id: `promo_margin_${signal.productId}`,
      type: 'REVIEW_RECIPE_COST',
      priority: signal.severity === 'high' ? 'high' : 'medium',
      score: signal.severity === 'high' ? 65 : 50,
      confidence: 0.8,
      title: `Review Recipe: ${signal.productName}`,
      description: `High-selling item (${signal.dailyUnits}/day) with thin ${signal.contributionMarginPercent}% margin — review recipe cost or price`,
      target: {
        productIds: [signal.productId],
        productNames: [signal.productName],
        categoryIds: [],
        segmentIds: [],
      },
      evidence: signal.evidence,
      financialModel: {
        currentPrice: signal.price,
        proposedPrice: signal.price,
        recipeCost: signal.cost,
        discountPercent: 0,
        discountAmount: 0,
        currentContribution: signal.contributionMargin,
        projectedContribution: signal.contributionMargin,
        projectedContributionMargin: signal.contributionMarginPercent,
        incrementalUnits: 0,
        incrementalRevenue: 0,
        incrementalContribution: 0,
        breakEvenIncrementalUnits: 0,
        paybackPeriodDays: 0,
        minMarginConstraint: constraints.minMarginPercent,
        maxDiscountConstraint: constraints.maxDiscountPercent,
      },
      cannibalization: { estimatedCannibalizationRate: 0, incrementalVsCannibalized: 0, confidence: 0, evidence: [] },
      risks: ['Price increase could reduce volume', 'Recipe change could affect quality'],
      prerequisites: ['Analyze ingredient cost breakdown', 'Test portion optimization'],
      constraints,
      status: 'NEW',
      recommendedAction: 'review_recipe',
      sourceSignals: ['margin_deterioration', 'cost_analysis'],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
  }
  return null;
}

/**
 * Build candidate from demand anomaly
 */
function buildCandidateFromDemandAnomaly(
  anomaly: DemandAnomaly,
  constraints: BusinessConstraints
): PromotionCandidate | null {
  if (anomaly.type === 'TIME_SLOT_UNDERPERFORMING' || anomaly.type === 'REVENUE_DROP') {
    return {
      id: `promo_demand_${anomaly.entityId}`,
      type: 'CREATE_PROMOTION',
      priority: anomaly.severity === 'high' ? 'high' : 'medium',
      score: anomaly.severity === 'high' ? 70 : 55,
      confidence: anomaly.confidence,
      title: `${anomaly.entityName} Demand Recovery`,
      description: `${anomaly.entityName} is ${Math.abs(anomaly.percentageChange)}% below baseline — targeted promotion to recover`,
      target: {
        productIds: [],
        productNames: [],
        categoryIds: anomaly.entityType === 'category' ? [anomaly.entityId!] : [],
        segmentIds: [],
      },
      evidence: anomaly.evidence,
      financialModel: {
        currentPrice: 0,
        proposedPrice: 0,
        recipeCost: 0,
        discountPercent: 20,
        discountAmount: 0,
        currentContribution: 0,
        projectedContribution: 0,
        projectedContributionMargin: 0,
        incrementalUnits: 0,
        incrementalRevenue: 0,
        incrementalContribution: 0,
        breakEvenIncrementalUnits: 0,
        paybackPeriodDays: 0,
        minMarginConstraint: constraints.minMarginPercent,
        maxDiscountConstraint: constraints.maxDiscountPercent,
      },
      cannibalization: { estimatedCannibalizationRate: 0.3, incrementalVsCannibalized: 1.2, confidence: 0.5, evidence: [] },
      risks: ['Time-slot promotion may shift demand rather than create new demand'],
      prerequisites: ['Identify specific items for promotion', 'Set time-window restrictions'],
      constraints,
      status: 'NEW',
      recommendedAction: 'create_offer',
      sourceSignals: ['demand_anomaly', 'sales_baseline'],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    };
  }
  return null;
}

/**
 * Generate all promotion candidates from all signals
 */
export async function generatePromotionCandidates(opts: PromotionCandidateOptions): Promise<PromotionCandidate[]> {
  const {
    restaurantId,
    branchId,
    lookbackDays = 90,
    constraints = {},
    minScore = DEFAULT_MIN_SCORE,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
  } = opts;

  const mergedConstraints: BusinessConstraints = { ...DEFAULT_CONSTRAINTS, ...constraints };

  // Gather all signals in parallel
  const [
    comboOpps,
    addOnOpps,
    inventoryOpps,
    customerOpps,
    menuItems,
    marginSignals,
    demandAnomalies,
  ] = await Promise.all([
    detectComboOpportunities({ restaurantId, branchId, lookbackDays }),
    detectAddOnOpportunities({ restaurantId, branchId, lookbackDays }),
    detectInventoryOpportunities({ restaurantId, branchId, lookbackDays }),
    detectCustomerOpportunities({ restaurantId, branchId, lookbackDays }),
    analyzeMenuEngineering({ restaurantId, branchId, lookbackDays }),
    detectMarginSignals({ restaurantId, branchId, lookbackDays }),
    detectAllDemandAnomalies({ restaurantId, branchId, lookbackDays }),
  ]);

  const candidates: PromotionCandidate[] = [];

  // Build candidates from each source
  for (const opp of comboOpps) {
    const candidate = buildCandidateFromCombo(opp, mergedConstraints);
    if (candidate) candidates.push(candidate);
  }

  for (const opp of addOnOpps) {
    const candidate = buildCandidateFromAddOn(opp, mergedConstraints);
    if (candidate) candidates.push(candidate);
  }

  for (const opp of inventoryOpps) {
    const candidate = buildCandidateFromInventory(opp, mergedConstraints);
    if (candidate) candidates.push(candidate);
  }

  for (const opp of customerOpps) {
    const candidate = buildCandidateFromCustomer(opp, mergedConstraints);
    if (candidate) candidates.push(candidate);
  }

  for (const item of menuItems) {
    const candidate = buildCandidateFromMenuEngineering(item, mergedConstraints);
    if (candidate) candidates.push(candidate);
  }

  for (const signal of marginSignals) {
    const candidate = buildCandidateFromMarginSignal(signal, mergedConstraints);
    if (candidate) candidates.push(candidate);
  }

  for (const anomaly of demandAnomalies) {
    const candidate = buildCandidateFromDemandAnomaly(anomaly, mergedConstraints);
    if (candidate) candidates.push(candidate);
  }

  // Filter by minimum thresholds
  const filtered = candidates.filter(c => c.score >= minScore && c.confidence >= minConfidence);

  // Sort by score
  filtered.sort((a, b) => b.score - a.score);

  return filtered;
}

/**
 * Deduplicate candidates (same type, same targets)
 */
export function deduplicateCandidates(candidates: PromotionCandidate[]): PromotionCandidate[] {
  const seen = new Set<string>();
  const unique: PromotionCandidate[] = [];

  for (const c of candidates) {
    // Create fingerprint
    const targetKey = [...c.target.productIds, ...c.target.categoryIds, ...c.target.segmentIds].sort().join('|');
    const fingerprint = `${c.type}:${targetKey}`;

    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      unique.push(c);
    }
  }

  return unique;
}

/**
 * Persist promotion candidates as signals
 */
export async function persistPromotionCandidatesAsSignals(
  restaurantId: string,
  branchId: string | undefined,
  candidates: PromotionCandidate[]
): Promise<void> {
  if (candidates.length === 0) return;

  const docs = candidates.map(c => ({
    restaurantId: objectId(restaurantId),
    branchId: branchId ? objectId(branchId) : undefined,
    type: c.type as SignalType,
    entityType: 'promotion_candidate',
    entityId: c.id,
    entityName: c.title,
    value: c.score,
    baseline: 50,
    percentageChange: c.score - 50,
    confidence: c.confidence,
    minSampleSize: 1,
    sampleSize: c.evidence.length,
    evidence: c.evidence,
    detectedAt: c.createdAt,
    expiresAt: c.expiresAt,
    consumed: false,
    tags: ['promotion_candidate', c.type.toLowerCase(), c.priority, c.recommendedAction].filter(Boolean),
  }));

  await IntelligenceSignalModel.insertMany(docs, { ordered: false });
}
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InventoryOpportunityService — Detects inventory-driven opportunities by
 * linking ingredients to menu items through recipes.
 *
 * Key flow:
 * 1. Find overstocked/slow-moving/expiring ingredients
 * 2. Find recipes that consume these ingredients
 * 3. Find menu items using those recipes
 * 4. Analyze demand + margin for those menu items
 * 5. Generate promotion candidates only where commercially sensible
 */

import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import RecipeModel from '../modules/recipes/models/Recipe';
import InventoryEventModel from '../models/InventoryEvent';
import PurchaseModel from '../models/Purchase';
import IntelligenceSignalModel, { SignalType, ISignalEvidence } from '../models/IntelligenceSignal';
import { computeProductBaselines, ProductBaseline } from './salesBaselineService';

export interface IngredientOpportunity {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  currentStock: number;
  maxStock: number;
  minStock: number;
  dailyUsage: number;
  daysOfStock: number;
  opportunityType: 'OVERSTOCK' | 'SLOW_MOVING' | 'EXPIRY_RISK' | 'HIGH_WASTAGE';
  severity: 'low' | 'medium' | 'high';
  evidence: ISignalEvidence[];
}

export interface MenuItemIngredientLink {
  productId: string;
  productName: string;
  category: string;
  price: number;
  cost: number;
  margin: number;
  marginPercent: number;
  dailyUnits: number;
  dailyRevenue: number;
  ingredientQuantity: number; // How much of the ingredient this menu item uses per unit
  ingredientCostShare: number; // Cost of this ingredient in the menu item
}

export interface InventoryDrivenOpportunity {
  id: string;
  ingredient: IngredientOpportunity;
  menuItems: MenuItemIngredientLink[];
  promotionCandidate: {
    type: 'category_promotion' | 'item_promotion' | 'combo_anchor' | 'limited_time_offer';
    targetItems: string[]; // Product IDs
    suggestedDiscount: number;
    estimatedMarginAfterDiscount: number;
    projectedIncrementalUnits: number;
    projectedIncrementalRevenue: number;
    projectedIncrementalContribution: number;
    canClearStock: boolean; // Whether promotion can realistically clear excess
  };
  overallScore: number;
  confidence: number;
  evidence: ISignalEvidence[];
  recommendedAction: 'run_promotion' | 'test_promotion' | 'monitor' | 'reduce_purchases';
}

export interface InventoryOpportunityOptions {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number;
  minDaysOfStockForOverstock?: number; // Default 14 days
  maxDaysOfStockForRisk?: number; // Default 3 days
  minIngredientCostShare?: number; // Default 5% - ingredient must be meaningful in recipe
  minMenuItemMargin?: number; // Default 20%
  maxPromoDiscount?: number; // Default 25%
}

const DEFAULT_MIN_OVERSTOCK_DAYS = 14;
const DEFAULT_MAX_RISK_DAYS = 3;
const DEFAULT_MIN_INGREDIENT_SHARE = 0.05;
const DEFAULT_MIN_MARGIN = 20;
const DEFAULT_MAX_DISCOUNT = 25;

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * Calculate daily usage rate for an ingredient from inventory events
 */
async function calculateIngredientUsage(
  restaurantId: string,
  ingredientName: string,
  lookbackDays: number
): Promise<number> {
  const { start, end } = getDateRange(lookbackDays);

  // Get consumption events (stock reductions from sales)
  const events = await InventoryEventModel.find({
    restaurantId: objectId(restaurantId),
    item: ingredientName,
    type: { $in: ['sold', 'waste', 'adjusted'] },
    eventDate: { $gte: start.toISOString().split('T')[0], $lte: end.toISOString().split('T')[0] },
  })
    .select('quantity')
    .lean()
    .exec();

  const totalConsumed = events.reduce((sum, e) => sum + Math.abs(e.quantity || 0), 0);
  return totalConsumed / lookbackDays;
}

/**
 * Get overstocked/slow-moving/expiring ingredients
 */
async function getIngredientOpportunities(
  restaurantId: string,
  opts: InventoryOpportunityOptions
): Promise<IngredientOpportunity[]> {
  const { minDaysOfStockForOverstock = DEFAULT_MIN_OVERSTOCK_DAYS, maxDaysOfStockForRisk = DEFAULT_MAX_RISK_DAYS } = opts;

  // Get inventory-tracked products (ingredients)
  const ingredients = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    availability: false, // Inventory items
    isDeleted: { $ne: true },
    $or: [
      { currentStock: { $gt: 0 } },
      { maxStock: { $gt: 0 } },
    ],
  })
    .select('_id name category currentStock minStock maxStock unit averageCost expiryDate')
    .lean()
    .exec();

  const opportunities: IngredientOpportunity[] = [];

  for (const ing of ingredients) {
    const currentStock = ing.currentStock || 0;
    const maxStock = ing.maxStock || 0;
    const minStock = ing.minStock || 0;

    if (currentStock <= 0) continue;

    const dailyUsage = await calculateIngredientUsage(restaurantId, ing.name, opts.lookbackDays || 90);
    const daysOfStock = dailyUsage > 0 ? currentStock / dailyUsage : 999;

    const evidence: ISignalEvidence[] = [
      {
        description: `Current stock: ${currentStock} ${ing.unit}, Daily usage: ${dailyUsage.toFixed(1)} ${ing.unit}/day`,
        value: dailyUsage,
        sampleSize: 1,
        confidence: 0.7,
      },
    ];

    let opportunityType: IngredientOpportunity['opportunityType'] | null = null;
    let severity: IngredientOpportunity['severity'] = 'low';

    // Overstock: above 80% of maxStock AND > 14 days of stock
    if (maxStock > 0 && currentStock >= maxStock * 0.8 && daysOfStock > minDaysOfStockForOverstock) {
      opportunityType = 'OVERSTOCK';
      severity = daysOfStock > 30 ? 'high' : 'medium';
      evidence.push({
        description: `Stock at ${Math.round((currentStock / maxStock) * 100)}% of max (${maxStock} ${ing.unit}), ${Math.round(daysOfStock)} days of supply`,
        value: currentStock / maxStock,
        baseline: 0.8,
        percentageChange: Math.round(((currentStock / maxStock) - 0.8) / 0.8 * 100),
        sampleSize: 1,
        confidence: 0.8,
      });
    }
    // Slow moving: stock > minStock but very low usage
    else if (currentStock > minStock && dailyUsage > 0 && daysOfStock > minDaysOfStockForOverstock) {
      opportunityType = 'SLOW_MOVING';
      severity = daysOfStock > 30 ? 'high' : 'medium';
      evidence.push({
        description: `Slow movement: ${Math.round(daysOfStock)} days of stock with low daily usage`,
        value: daysOfStock,
        baseline: minDaysOfStockForOverstock,
        sampleSize: 1,
        confidence: 0.6,
      });
    }
    // Expiry risk
    else if (ing.expiryDate) {
      const expiryDate = new Date(ing.expiryDate);
      const daysToExpiry = Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      if (daysToExpiry <= 7 && daysToExpiry > 0) {
        opportunityType = 'EXPIRY_RISK';
        severity = daysToExpiry <= 2 ? 'high' : 'medium';
        evidence.push({
          description: `Expires in ${daysToExpiry} days (${ing.expiryDate})`,
          value: daysToExpiry,
          baseline: 7,
          sampleSize: 1,
          confidence: 0.9,
        });
      }
    }
    // High wastage
    const lookbackStart = new Date(Date.now() - (opts.lookbackDays || 90) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const wasteEvents = await InventoryEventModel.find({
      restaurantId: objectId(restaurantId),
      item: ing.name,
      type: 'waste',
      eventDate: { $gte: lookbackStart },
    })
      .select('quantity')
      .lean()
      .exec();

    const totalWaste = wasteEvents.reduce((sum, e) => sum + Math.abs(e.quantity || 0), 0);
    const wasteRatio = dailyUsage > 0 ? totalWaste / (dailyUsage * (opts.lookbackDays || 90)) : 0;

    if (wasteRatio > 0.1) { // > 10% waste
      opportunityType = opportunityType || 'HIGH_WASTAGE';
      severity = wasteRatio > 0.25 ? 'high' : 'medium';
      evidence.push({
        description: `High wastage: ${totalWaste} ${ing.unit} wasted (${Math.round(wasteRatio * 100)}% of usage)`,
        value: wasteRatio,
        baseline: 0.1,
        percentageChange: Math.round((wasteRatio - 0.1) / 0.1 * 100),
        sampleSize: wasteEvents.length,
        confidence: 0.7,
      });
    }

    if (opportunityType) {
      opportunities.push({
        ingredientId: String(ing._id),
        ingredientName: ing.name,
        unit: ing.unit || 'unit',
        currentStock,
        maxStock,
        minStock,
        dailyUsage: Math.round(dailyUsage * 10) / 10,
        daysOfStock: Math.round(daysOfStock * 10) / 10,
        opportunityType,
        severity,
        evidence,
      });
    }
  }

  return opportunities;
}

/**
 * Find menu items that use a specific ingredient via recipes
 */
async function findMenuItemsUsingIngredient(
  restaurantId: string,
  ingredientName: string
): Promise<Array<{
  productId: string;
  recipeId: string;
  quantity: number; // Quantity of ingredient per menu item unit
}>> {
  // Find recipes that use this ingredient
  const recipes = await RecipeModel.find({
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
    'ingredients.itemName': { $regex: new RegExp(`^${ingredientName}$`, 'i') },
  })
    .select('_id ingredients')
    .lean()
    .exec();

  const links: Array<{ productId: string; recipeId: string; quantity: number }> = [];

  for (const recipe of recipes) {
    for (const component of recipe.components) {
      if (component.itemName.toLowerCase() === ingredientName.toLowerCase()) {
        // Find products that use this recipe
        const products = await ProductModel.find({
          restaurantId: objectId(restaurantId),
          recipeId: recipe._id,
          isDeleted: { $ne: true },
          availability: true, // Menu items
        })
          .select('_id')
          .lean()
          .exec();

        for (const product of products) {
          links.push({
            productId: String(product._id),
            recipeId: String(recipe._id),
            quantity: component.quantity || 0,
          });
        }
      }
    }
  }

  return links;
}

/**
 * Get menu item details with baseline demand
 */
async function getMenuItemDetails(
  restaurantId: string,
  productIds: string[],
  lookbackDays: number
): Promise<Map<string, MenuItemIngredientLink>> {
  const baselines = await computeProductBaselines({ restaurantId, lookbackDays });
  const baselineMap = new Map(baselines.map(b => [b.productId, b]));

  const products = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    _id: { $in: productIds.map(objectId) },
    isDeleted: { $ne: true },
  })
    .select('_id name category price averageCost')
    .lean()
    .exec();

  const map = new Map<string, MenuItemIngredientLink>();

  for (const product of products) {
    const pid = String(product._id);
    const unitsBaseline = baselineMap.get(pid);
    const revenueBaseline = baselines.find(b => b.productId === pid && b.metric === 'revenue');

    const dailyUnits = unitsBaseline?.value || 0;
    const dailyRevenue = revenueBaseline?.value || 0;
    const price = product.price || 0;
    const cost = product.averageCost || 0;
    const margin = price - cost;
    const marginPercent = price > 0 ? Math.round((margin / price) * 100) : 0;

    map.set(pid, {
      productId: pid,
      productName: product.name,
      category: product.category || 'Other',
      price,
      cost,
      margin,
      marginPercent,
      dailyUnits,
      dailyRevenue,
      ingredientQuantity: 0, // Will be set per ingredient
      ingredientCostShare: 0,
    });
  }

  return map;
}

/**
 * Detect inventory-driven opportunities
 */
export async function detectInventoryOpportunities(opts: InventoryOpportunityOptions): Promise<InventoryDrivenOpportunity[]> {
  const {
    restaurantId,
    branchId,
    lookbackDays = 90,
    minDaysOfStockForOverstock = DEFAULT_MIN_OVERSTOCK_DAYS,
    minIngredientCostShare = DEFAULT_MIN_INGREDIENT_SHARE,
    minMenuItemMargin = DEFAULT_MIN_MARGIN,
    maxPromoDiscount = DEFAULT_MAX_DISCOUNT,
  } = opts;

  // Step 1: Get ingredient opportunities
  const ingredientOpps = await getIngredientOpportunities(restaurantId, {
    ...opts,
    minDaysOfStockForOverstock,
  });

  if (ingredientOpps.length === 0) return [];

  const opportunities: InventoryDrivenOpportunity[] = [];

  // Step 2: For each ingredient, find menu items using it
  for (const ingOpp of ingredientOpps) {
    const recipeLinks = await findMenuItemsUsingIngredient(restaurantId, ingOpp.ingredientName);
    if (recipeLinks.length === 0) continue;

    const productIds = [...new Set(recipeLinks.map(l => l.productId))];
    const menuItemsMap = await getMenuItemDetails(restaurantId, productIds, lookbackDays);

    // Filter to items with sufficient margin and ingredient share
    const validItems: MenuItemIngredientLink[] = [];
    for (const link of recipeLinks) {
      const item = menuItemsMap.get(link.productId);
      if (!item) continue;

      const ingredientCost = link.quantity * (ingOpp.currentStock > 0 ? 0 : 0); // Would need ingredient unit cost
      // For now, estimate ingredient cost share
      const estimatedIngredientCost = item.cost * minIngredientCostShare; // Conservative estimate
      const costShare = item.cost > 0 ? ingredientCost / item.cost : 0;

      if (item.marginPercent >= minMenuItemMargin && costShare >= minIngredientCostShare) {
        item.ingredientQuantity = link.quantity;
        item.ingredientCostShare = costShare;
        validItems.push(item);
      }
    }

    if (validItems.length === 0) continue;

    // Step 3: Create promotion candidate
    // Sort by margin * demand to find best promotion targets
    validItems.sort((a, b) => (b.marginPercent * b.dailyUnits) - (a.marginPercent * a.dailyUnits));

    const topItems = validItems.slice(0, 3);
    const totalDailyUnits = topItems.reduce((sum, i) => sum + i.dailyUnits, 0);
    const totalDailyRevenue = topItems.reduce((sum, i) => sum + i.dailyRevenue, 0);
    const avgMargin = topItems.reduce((sum, i) => sum + i.marginPercent, 0) / topItems.length;

    // Estimate promotion impact
    const suggestedDiscount = Math.min(maxPromoDiscount, Math.max(10, Math.round((1 - avgMargin / 100) * 100)));
    const estimatedMarginAfter = Math.max(0, avgMargin - suggestedDiscount);
    const projectedIncrementalUnits = Math.round(totalDailyUnits * (suggestedDiscount / 100) * 1.5); // Elasticity estimate
    const projectedIncrementalRevenue = projectedIncrementalUnits * (topItems[0].price * (1 - suggestedDiscount / 100));
    const projectedIncrementalContribution = projectedIncrementalRevenue * (estimatedMarginAfter / 100);

    // Can we clear the excess stock?
    const excessStock = ingOpp.opportunityType === 'OVERSTOCK'
      ? ingOpp.currentStock - ingOpp.maxStock * 0.8
      : ingOpp.currentStock; // For other types, target all stock
    const daysToClear = projectedIncrementalUnits > 0 ? excessStock / projectedIncrementalUnits : 999;
    const canClearStock = daysToClear <= 14 && projectedIncrementalContribution > 0;

    // Overall score
    const demandScore = Math.min(100, (totalDailyUnits / 20) * 100);
    const marginScore = Math.max(0, Math.min(100, (avgMargin - 20) * 5));
    const inventoryScore = ingOpp.severity === 'high' ? 90 : ingOpp.severity === 'medium' ? 60 : 30;
    const overallScore = Math.round(demandScore * 0.3 + marginScore * 0.3 + inventoryScore * 0.4);

    const confidence = Math.min(0.9, validItems.length / 3 * 0.5 + 0.3);

    let recommendedAction: InventoryDrivenOpportunity['recommendedAction'] = 'monitor';
    if (overallScore >= 65 && confidence >= 0.6 && canClearStock && estimatedMarginAfter >= 15) {
      recommendedAction = 'run_promotion';
    } else if (overallScore >= 45 && confidence >= 0.4) {
      recommendedAction = 'test_promotion';
    } else if (ingOpp.opportunityType === 'HIGH_WASTAGE') {
      recommendedAction = 'reduce_purchases';
    }

    const evidence = [
      ...ingOpp.evidence,
      {
        description: `${topItems.length} menu items use ${ingOpp.ingredientName} (${ingOpp.opportunityType.toLowerCase()})`,
        value: topItems.length,
        baseline: 1,
        sampleSize: topItems.length,
        confidence: 0.8,
      },
      {
        description: `Top items: ${topItems.map(i => `${i.productName} (${i.marginPercent}% margin, ${i.dailyUnits}/day)`).join(', ')}`,
        value: avgMargin,
        baseline: minMenuItemMargin,
        sampleSize: topItems.length,
        confidence: 0.7,
      },
    ];

    opportunities.push({
      id: `inv_opp_${ingOpp.ingredientId}_${Date.now()}`,
      ingredient: ingOpp,
      menuItems: topItems,
      promotionCandidate: {
        type: topItems.length === 1 ? 'item_promotion' : 'category_promotion',
        targetItems: topItems.map(i => i.productId),
        suggestedDiscount,
        estimatedMarginAfterDiscount: estimatedMarginAfter,
        projectedIncrementalUnits,
        projectedIncrementalRevenue: Math.round(projectedIncrementalRevenue),
        projectedIncrementalContribution: Math.round(projectedIncrementalContribution),
        canClearStock,
      },
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
 * Persist inventory opportunities as signals
 */
export async function persistInventoryOpportunitiesAsSignals(
  restaurantId: string,
  branchId: string | undefined,
  opportunities: InventoryDrivenOpportunity[]
): Promise<void> {
  if (opportunities.length === 0) return;

  const docs = opportunities.map(opp => ({
    restaurantId: objectId(restaurantId),
    branchId: branchId ? objectId(branchId) : undefined,
    type: opp.ingredient.opportunityType === 'OVERSTOCK' ? 'INVENTORY_OVERSTOCK' :
      opp.ingredient.opportunityType === 'SLOW_MOVING' ? 'INVENTORY_SLOW_MOVING' :
      opp.ingredient.opportunityType === 'EXPIRY_RISK' ? 'INVENTORY_EXPIRY_RISK' :
      'INVENTORY_HIGH_WASTAGE',
    entityType: 'ingredient',
    entityId: opp.ingredient.ingredientId,
    entityName: opp.ingredient.ingredientName,
    value: opp.overallScore,
    baseline: 50,
    percentageChange: opp.overallScore - 50,
    confidence: opp.confidence,
    minSampleSize: 1,
    sampleSize: opp.menuItems.length,
    evidence: opp.evidence,
    detectedAt: new Date(),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days for inventory
    consumed: false,
    tags: ['inventory_opportunity', opp.ingredient.opportunityType.toLowerCase(), opp.recommendedAction].filter(Boolean),
  }));

  await IntelligenceSignalModel.insertMany(docs, { ordered: false });
}

/**
 * Get top inventory opportunities
 */
export async function getTopInventoryOpportunities(
  restaurantId: string,
  branchId?: string,
  limit: number = 5
): Promise<InventoryDrivenOpportunity[]> {
  const opps = await detectInventoryOpportunities({ restaurantId, branchId });
  return opps.slice(0, limit);
}

function getDateRange(days: number): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}
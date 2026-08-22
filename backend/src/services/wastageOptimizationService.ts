/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WastageOptimizationService — Safe inventory reduction strategies.
 *
 * Distinguishes between safe promotional candidates and unsafe inventory.
 * Never recommends selling expired/unsafe/compromised products.
 */

import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import InventoryEventModel from '../models/InventoryEvent';
import PurchaseModel from '../models/Purchase';
import IntelligenceSignalModel, { SignalType, ISignalEvidence } from '../models/IntelligenceSignal';
import { computeProductBaselines, ProductBaseline } from './salesBaselineService';

export interface WastageItem {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  currentStock: number;
  avgDailyWaste: number;
  wasteEvents: number;
  totalWasteQty: number;
  totalWasteCost: number;
  wasteToConsumptionRatio: number; // waste / (sales consumption + waste)
  trend: 'INCREASING' | 'STABLE' | 'DECREASING';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  safetyStatus: 'SAFE' | 'CAUTION' | 'UNSAFE';
  expiryRisk: boolean;
  daysToExpiry: number | null;
}

export interface WastageReductionStrategy {
  ingredientId: string;
  ingredientName: string;
  strategyType: 'PROMOTE_MENU_ITEMS' | 'REDUCE_PURCHASES' | 'IMPROVE_PREP' | 'ADJUST_PORTIONS' | 'DONATE' | 'DISCARD';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  expectedWasteReduction: number; // units per period
  expectedCostSavings: number;
  implementationEffort: 'LOW' | 'MEDIUM' | 'HIGH';
  timeToImpact: string; // e.g., "1-2 weeks"
  prerequisites: string[];
  risks: string[];
}

export interface WastageOptimizationOptions {
  restaurantId: string;
  branchId?: string;
  lookbackDays?: number; // Default 30
  minWasteRatioForAction?: number; // Default 0.05 (5%)
  includeUnsafeItems?: boolean; // Default false - never include unsafe
}

export interface WastageOptimizationResult {
  restaurantId: string;
  branchId?: string;
  analysisDate: Date;
  lookbackDays: number;
  items: WastageItem[];
  strategies: WastageReductionStrategy[];
  summary: {
    totalItemsAnalyzed: number;
    safeItems: number;
    cautionItems: number;
    unsafeItems: number;
    totalWasteCost: number;
    totalPotentialSavings: number;
    highPriorityActions: number;
  };
  warnings: string[];
}

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_MIN_WASTE_RATIO = 0.05;

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Analyze wastage patterns and generate reduction strategies
 */
export async function analyzeWastageAndOptimize(
  options: WastageOptimizationOptions
): Promise<WastageOptimizationResult> {
  const {
    restaurantId,
    branchId,
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    minWasteRatioForAction = DEFAULT_MIN_WASTE_RATIO,
    includeUnsafeItems = false,
  } = options;

  const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = new Date().toISOString().split('T')[0];

  // 1. Get all inventory-tracked ingredients
  const ingredients = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    availability: false, // Inventory items
    isDeleted: { $ne: true },
    $or: [{ currentStock: { $gt: 0 } }, { maxStock: { $gt: 0 } }],
  })
    .select('_id name category currentStock minStock maxStock unit averageCost expiryDate')
    .lean()
    .exec();

  // 2. Get waste events for the period
  const wasteEvents = await InventoryEventModel.find({
    restaurantId: objectId(restaurantId),
    type: 'waste',
    eventDate: { $gte: startDateStr, $lte: endDateStr },
  })
    .select('item quantity unit cost eventDate reason')
    .lean()
    .exec();

  // 3. Get consumption (sales) for each ingredient via recipes
  const consumptionByIngredient = await calculateIngredientConsumption(restaurantId, startDate);

  // 4. Analyze each ingredient
  const items: WastageItem[] = [];
  const warnings: string[] = [];

  for (const ing of ingredients) {
    const ingWasteEvents = wasteEvents.filter(w => w.item.toLowerCase() === ing.name.toLowerCase());
    const totalWasteQty = ingWasteEvents.reduce((sum, w) => sum + Math.abs(w.quantity || 0), 0);
    const totalWasteCost = ingWasteEvents.reduce((sum, w) => sum + (w.cost || 0), 0);
    const avgDailyWaste = totalWasteQty / lookbackDays;
    const wasteEventsCount = ingWasteEvents.length;

    // Get consumption
    const consumption = consumptionByIngredient.get(ing.name.toLowerCase()) || 0;
    const totalConsumption = consumption * lookbackDays;
    const wasteToConsumptionRatio = totalConsumption > 0 ? totalWasteQty / totalConsumption : 0;

    // Check expiry
    let expiryRisk = false;
    let daysToExpiry: number | null = null;
    if (ing.expiryDate) {
      const expiryDate = new Date(ing.expiryDate);
      daysToExpiry = Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      expiryRisk = daysToExpiry <= 7 && daysToExpiry > 0;
    }

    // Safety status
    let safetyStatus: WastageItem['safetyStatus'] = 'SAFE';
    if (expiryRisk && daysToExpiry !== null && daysToExpiry <= 0) {
      safetyStatus = 'UNSAFE';
      warnings.push(`${ing.name}: EXPIRED (${daysToExpiry} days) - DO NOT SELL`);
    } else if (expiryRisk) {
      safetyStatus = 'CAUTION';
    }

    // Trend analysis (compare first half vs second half)
    const midPoint = new Date(startDate.getTime() + (lookbackDays / 2) * 24 * 60 * 60 * 1000);
    const firstHalfWaste = ingWasteEvents
      .filter(w => new Date(w.eventDate) < midPoint)
      .reduce((sum, w) => sum + Math.abs(w.quantity || 0), 0);
    const secondHalfWaste = ingWasteEvents
      .filter(w => new Date(w.eventDate) >= midPoint)
      .reduce((sum, w) => sum + Math.abs(w.quantity || 0), 0);

    let trend: WastageItem['trend'] = 'STABLE';
    if (firstHalfWaste > 0) {
      const change = (secondHalfWaste - firstHalfWaste) / firstHalfWaste;
      if (change > 0.2) trend = 'INCREASING';
      else if (change < -0.2) trend = 'DECREASING';
    }

    // Severity
    let severity: WastageItem['severity'] = 'LOW';
    if (wasteToConsumptionRatio > 0.2) severity = 'HIGH';
    else if (wasteToConsumptionRatio > 0.1) severity = 'MEDIUM';
    else if (wasteToConsumptionRatio > 0.05) severity = 'LOW';

    // Only include if above threshold or unsafe
    if (wasteToConsumptionRatio >= minWasteRatioForAction || safetyStatus !== 'SAFE' || totalWasteQty > 0) {
      items.push({
        ingredientId: String(ing._id),
        ingredientName: ing.name,
        unit: ing.unit || 'unit',
        currentStock: ing.currentStock || 0,
        avgDailyWaste: round2(avgDailyWaste),
        wasteEvents: wasteEventsCount,
        totalWasteQty: round2(totalWasteQty),
        totalWasteCost: round2(totalWasteCost),
        wasteToConsumptionRatio: round2(wasteToConsumptionRatio * 100) / 100,
        trend,
        severity,
        safetyStatus,
        expiryRisk,
        daysToExpiry,
      });
    }
  }

  // 5. Generate reduction strategies
  const strategies: WastageReductionStrategy[] = [];

  for (const item of items) {
    // UNSAFE items - never promote, only discard/donate
    if (item.safetyStatus === 'UNSAFE') {
      strategies.push({
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        strategyType: 'DISCARD',
        priority: 'HIGH',
        description: `${item.ingredientName} is expired/unsafe. Discard immediately. Do NOT use in any promotion.`,
        expectedWasteReduction: 0,
        expectedCostSavings: 0,
        implementationEffort: 'LOW',
        timeToImpact: 'Immediate',
        prerequisites: ['Verify expiry date', 'Document for compliance'],
        risks: ['Health hazard if served', 'Legal liability'],
      });
      continue;
    }

    // CAUTION items - can promote but with strict limits
    if (item.safetyStatus === 'CAUTION') {
      // Find menu items using this ingredient
      const menuItems = await findMenuItemsUsingIngredient(restaurantId, item.ingredientName);
      if (menuItems.length > 0) {
        strategies.push({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          strategyType: 'PROMOTE_MENU_ITEMS',
          priority: 'HIGH',
          description: `URGENT: ${item.ingredientName} expires in ${item.daysToExpiry} days. Promote ${menuItems.map(m => m.name).join(', ')} to clear stock BEFORE expiry.`,
          expectedWasteReduction: Math.min(item.currentStock, item.avgDailyWaste * item.daysToExpiry!),
          expectedCostSavings: round2(Math.min(item.currentStock, item.avgDailyWaste * item.daysToExpiry!) * (item.totalWasteCost / Math.max(item.totalWasteQty, 1))),
          implementationEffort: 'LOW',
          timeToImpact: `${item.daysToExpiry} days`,
          prerequisites: ['Verify all menu items are safe to serve', 'Set promotion end date before expiry', 'Monitor sales closely'],
          risks: ['Must sell before expiry', 'Cannot extend promotion past expiry date'],
        });
      }
      continue;
    }

    // SAFE items - normal optimization
    if (item.wasteToConsumptionRatio >= minWasteRatioForAction) {
      // Strategy 1: Reduce purchases (if consistently over-ordered)
      const purchaseAnalysis = await analyzePurchasePattern(restaurantId, item.ingredientName, lookbackDays);
      if (purchaseAnalysis.consistentlyOverordered) {
        strategies.push({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          strategyType: 'REDUCE_PURCHASES',
          priority: 'MEDIUM',
          description: `${item.ingredientName} is consistently over-purchased by ~${purchaseAnalysis.overorderPercent}%. Reduce order quantity from ${purchaseAnalysis.avgOrderQty} to ${purchaseAnalysis.suggestedOrderQty} ${item.unit} per order.`,
          expectedWasteReduction: round2(item.avgDailyWaste * 30 * 0.5),
          expectedCostSavings: round2(item.totalWasteCost * 0.5),
          implementationEffort: 'LOW',
          timeToImpact: 'Next order cycle',
          prerequisites: ['Confirm demand forecast accuracy', 'Update purchase orders', 'Monitor stock levels'],
          risks: ['Stockout if demand increases unexpectedly'],
        });
      }

      // Strategy 2: Promote menu items (if good margin)
      const menuItems = await findMenuItemsUsingIngredient(restaurantId, item.ingredientName);
      const highMarginItems = menuItems.filter(m => m.marginPercent >= 25);
      if (highMarginItems.length > 0) {
        strategies.push({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          strategyType: 'PROMOTE_MENU_ITEMS',
          priority: 'MEDIUM',
          description: `Promote ${highMarginItems.map(m => m.name).join(', ')} (${highMarginItems[0].marginPercent}%+ margin) to utilize excess ${item.ingredientName} stock.`,
          expectedWasteReduction: round2(item.avgDailyWaste * 14),
          expectedCostSavings: round2(item.totalWasteCost * 0.3),
          implementationEffort: 'MEDIUM',
          timeToImpact: '1-2 weeks',
          prerequisites: ['Verify inventory for promoted items', 'Create promotion in POS', 'Train staff'],
          risks: ['Promotion margin must exceed ingredient cost', 'Don\'t over-promote and create new waste'],
        });
      }

      // Strategy 3: Improve prep (if high waste with no expiry/purchase issue)
      if (item.trend === 'INCREASING' && !item.expiryRisk && !purchaseAnalysis.consistentlyOverordered) {
        strategies.push({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          strategyType: 'IMPROVE_PREP',
          priority: 'MEDIUM',
          description: `${item.ingredientName} waste is increasing (${item.wasteEvents} events in ${lookbackDays} days). Review prep procedures, storage, and handling.`,
          expectedWasteReduction: round2(item.avgDailyWaste * 30 * 0.4),
          expectedCostSavings: round2(item.totalWasteCost * 0.4),
          implementationEffort: 'HIGH',
          timeToImpact: '2-4 weeks',
          prerequisites: ['Audit prep process', 'Check storage conditions', 'Staff training on waste reduction'],
          risks: ['Process changes take time to show results'],
        });
      }

      // Strategy 4: Adjust portions (if variance high)
      const variance = await calculatePortionVariance(restaurantId, item.ingredientName, lookbackDays);
      if (variance > 0.15) {
        strategies.push({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          strategyType: 'ADJUST_PORTIONS',
          priority: 'LOW',
          description: `${item.ingredientName} shows ${Math.round(variance * 100)}% portion variance. Standardize portion sizes to reduce prep waste.`,
          expectedWasteReduction: round2(item.avgDailyWaste * 30 * 0.3),
          expectedCostSavings: round2(item.totalWasteCost * 0.3),
          implementationEffort: 'MEDIUM',
          timeToImpact: '2-3 weeks',
          prerequisites: ['Measure current portions', 'Define standard portions', 'Train kitchen staff'],
          risks: ['Customer perception of portion reduction'],
        });
      }
    }
  }

  // 6. Donation strategy for excess safe stock
  const excessSafeItems = items.filter(i =>
    i.safetyStatus === 'SAFE' &&
    i.currentStock > 0 &&
    i.wasteToConsumptionRatio < minWasteRatioForAction &&
    i.severity !== 'HIGH'
  );

  for (const item of excessSafeItems) {
    const daysOfStock = item.avgDailyWaste > 0 ? item.currentStock / item.avgDailyWaste : 999;
    if (daysOfStock > 14) {
      strategies.push({
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        strategyType: 'DONATE',
        priority: 'LOW',
        description: `${item.ingredientName} has ${Math.round(daysOfStock)} days of stock with low waste. Consider donating excess to local food bank before it ages.`,
        expectedWasteReduction: 0,
        expectedCostSavings: 0,
        implementationEffort: 'MEDIUM',
        timeToImpact: '1 week',
        prerequisites: ['Identify local food bank partners', 'Verify donation compliance', 'Arrange pickup/delivery'],
        risks: ['Logistics coordination required'],
      });
    }
  }

  // Sort strategies by priority and impact
  const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  strategies.sort((a, b) => {
    const pDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (pDiff !== 0) return pDiff;
    return b.expectedCostSavings - a.expectedCostSavings;
  });

  // 7. Build summary
  const safeItems = items.filter(i => i.safetyStatus === 'SAFE').length;
  const cautionItems = items.filter(i => i.safetyStatus === 'CAUTION').length;
  const unsafeItems = items.filter(i => i.safetyStatus === 'UNSAFE').length;
  const totalWasteCost = items.reduce((sum, i) => sum + i.totalWasteCost, 0);
  const totalPotentialSavings = strategies.reduce((sum, s) => sum + s.expectedCostSavings, 0);
  const highPriorityActions = strategies.filter(s => s.priority === 'HIGH').length;

  // Add global warnings
  if (unsafeItems > 0) {
    warnings.unshift(`CRITICAL: ${unsafeItems} expired/unsafe item(s) found - immediate action required`);
  }
  if (cautionItems > 0) {
    warnings.push(`${cautionItems} item(s) approaching expiry - prioritize clearance`);
  }

  return {
    restaurantId,
    branchId,
    analysisDate: new Date(),
    lookbackDays,
    items,
    strategies,
    summary: {
      totalItemsAnalyzed: items.length,
      safeItems,
      cautionItems,
      unsafeItems,
      totalWasteCost: round2(totalWasteCost),
      totalPotentialSavings: round2(totalPotentialSavings),
      highPriorityActions,
    },
    warnings,
  };
}

/**
 * Calculate ingredient consumption from sales
 */
async function calculateIngredientConsumption(
  restaurantId: string,
  startDate: Date
): Promise<Map<string, number>> {
  const consumption = new Map<string, number>();

  // Get all bills in period
  const bills = await mongoose.model('Bill').find({
    restaurantId: objectId(restaurantId),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: startDate },
  }).select('_id').lean().exec();

  if (bills.length === 0) return consumption;

  const billIds = bills.map(b => b._id);

  // Get all bill items
  const items = await mongoose.model('BillItem').find({
    billId: { $in: billIds },
    isVoided: { $ne: true },
  }).select('itemId quantity').lean().exec();

  // For each product sold, get its recipe and accumulate ingredient usage
  const productIds = [...new Set(items.map(i => String(i.itemId)))];
  const recipes = await RecipeModel.find({
    restaurantId: objectId(restaurantId),
    productId: { $in: productIds.map(objectId) },
    isDeleted: { $ne: true },
  }).select('productId components').lean().exec();

  const recipeMap = new Map(recipes.map(r => [String(r.productId), r]));

  for (const item of items) {
    const recipe = recipeMap.get(String(item.itemId));
    if (!recipe) continue;

    const qty = item.quantity || 0;
    for (const comp of recipe.components) {
      const ingName = comp.itemName.toLowerCase();
      const compQty = comp.quantity || 0;
      consumption.set(ingName, (consumption.get(ingName) || 0) + qty * compQty);
    }
  }

  // Convert to daily averages
  const days = Math.ceil((Date.now() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  for (const [key, value] of consumption) {
    consumption.set(key, value / days);
  }

  return consumption;
}

/**
 * Find menu items that use a specific ingredient
 */
async function findMenuItemsUsingIngredient(
  restaurantId: string,
  ingredientName: string
): Promise<Array<{ id: string; name: string; marginPercent: number }>> {
  const recipes = await RecipeModel.find({
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
    'components.itemName': { $regex: new RegExp(`^${ingredientName}$`, 'i') },
  }).select('_id productId components').lean().exec();

  const results: Array<{ id: string; name: string; marginPercent: number }> = [];

  for (const recipe of recipes) {
    const products = await ProductModel.find({
      restaurantId: objectId(restaurantId),
      recipeId: recipe._id,
      isDeleted: { $ne: true },
      availability: true,
    }).select('_id name price averageCost').lean().exec();

    for (const p of products) {
      const price = p.price || 0;
      const cost = p.averageCost || 0;
      const marginPercent = price > 0 ? round2(((price - cost) / price) * 100) : 0;
      results.push({ id: String(p._id), name: p.name, marginPercent });
    }
  }

  return results;
}

/**
 * Analyze purchase patterns for an ingredient
 */
async function analyzePurchasePattern(
  restaurantId: string,
  ingredientName: string,
  lookbackDays: number
): Promise<{ consistentlyOverordered: boolean; overorderPercent: number; avgOrderQty: number; suggestedOrderQty: number }> {
  const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const purchases = await PurchaseModel.find({
    restaurantId: objectId(restaurantId),
    'items.name': { $regex: new RegExp(`^${ingredientName}$`, 'i') },
    createdAt: { $gte: startDate },
  }).select('items createdAt').lean().exec();

  if (purchases.length < 3) {
    return { consistentlyOverordered: false, overorderPercent: 0, avgOrderQty: 0, suggestedOrderQty: 0 };
  }

  let totalOrdered = 0;
  let orderCount = 0;

  for (const p of purchases) {
    for (const item of p.items) {
      if (item.name.toLowerCase() === ingredientName.toLowerCase()) {
        totalOrdered += item.quantity || 0;
        orderCount++;
      }
    }
  }

  if (orderCount === 0) return { consistentlyOverordered: false, overorderPercent: 0, avgOrderQty: 0, suggestedOrderQty: 0 };

  const avgOrderQty = totalOrdered / orderCount;

  // Get actual consumption
  const consumption = await calculateIngredientConsumption(restaurantId, startDate);
  const dailyConsumption = consumption.get(ingredientName.toLowerCase()) || 0;
  const expectedOrderQty = dailyConsumption * (lookbackDays / orderCount);

  const overorderPercent = expectedOrderQty > 0 ? ((avgOrderQty - expectedOrderQty) / expectedOrderQty) * 100 : 0;

  return {
    consistentlyOverordered: overorderPercent > 15,
    overorderPercent: round2(overorderPercent),
    avgOrderQty: round2(avgOrderQty),
    suggestedOrderQty: round2(Math.max(expectedOrderQty * 1.1, avgOrderQty * 0.85)), // 10% buffer
  };
}

/**
 * Calculate portion variance for an ingredient
 */
async function calculatePortionVariance(
  restaurantId: string,
  ingredientName: string,
  lookbackDays: number
): Promise<number> {
  const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Get theoretical consumption from recipes
  const theoretical = await calculateIngredientConsumption(restaurantId, startDate);
  const theoreticalDaily = theoretical.get(ingredientName.toLowerCase()) || 0;

  // Get actual consumption from inventory events (stock reductions)
  const events = await InventoryEventModel.find({
    restaurantId: objectId(restaurantId),
    item: { $regex: new RegExp(`^${ingredientName}$`, 'i') },
    type: { $in: ['sold', 'waste', 'adjusted'] },
    eventDate: { $gte: startDate.toISOString().split('T')[0], $lte: endDateStr },
  }).select('quantity').lean().exec();

  const actualDaily = events.reduce((sum, e) => sum + Math.abs(e.quantity || 0), 0) / lookbackDays;

  if (theoreticalDaily === 0) return 0;
  return Math.abs(actualDaily - theoreticalDaily) / theoreticalDaily;
}

const endDateStr = new Date().toISOString().split('T')[0];

/**
 * Get quick wastage summary for dashboard
 */
export async function getWastageSummary(
  restaurantId: string,
  branchId?: string
): Promise<{
  totalWasteCost: number;
  itemsAtRisk: number;
  topWasteItems: WastageItem[];
  urgentActions: WastageReductionStrategy[];
}> {
  const result = await analyzeWastageAndOptimize({ restaurantId, branchId, lookbackDays: 30 });
  return {
    totalWasteCost: result.summary.totalWasteCost,
    itemsAtRisk: result.items.filter(i => i.severity === 'HIGH' || i.safetyStatus !== 'SAFE').length,
    topWasteItems: result.items.sort((a, b) => b.totalWasteCost - a.totalWasteCost).slice(0, 5),
    urgentActions: result.strategies.filter(s => s.priority === 'HIGH').slice(0, 3),
  };
}

export { DEFAULT_LOOKBACK_DAYS, DEFAULT_MIN_WASTE_RATIO };
export type { WastageItem, WastageReductionStrategy, WastageOptimizationOptions, WastageOptimizationResult };
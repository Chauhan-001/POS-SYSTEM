/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InventoryDemandForecastingService — Connects demand forecasts to
 * ingredient consumption through recipes.
 *
 * Flow:
 * 1. Get demand forecast for menu items
 * 2. For each menu item, get its recipe
 * 3. Calculate ingredient consumption = forecast units × recipe quantity
 * 4. Aggregate across all menu items
 * 5. Compare with current inventory
 * 6. Flag stockout risk, overstock, expiry risk
 */

import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import RecipeModel from '../modules/recipes/models/Recipe';
import InventoryEventModel from '../models/InventoryEvent';
import PurchaseModel from '../models/Purchase';
import { generateDemandForecast, generateBatchForecasts, ForecastEntity, ForecastPeriod, ForecastOptions, ForecastResult } from './demandForecastingService';
import { assessDataSufficiency } from './dataSufficiencyService';
import { getUpcomingFestivals } from './festivalService';

export interface IngredientConsumptionForecast {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  averageCost: number;
  expiryDate?: Date;
  forecastPeriod: {
    start: Date;
    end: Date;
  };
  predictedConsumption: {
    min: number;
    expected: number;
    max: number;
  };
  dailyConsumption: number;
  daysOfStock: {
    min: number;
    expected: number;
    max: number;
  };
  stockoutRisk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  expiryRisk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  overstockRisk: 'none' | 'low' | 'medium' | 'high';
  contributingMenuItems: Array<{
    productId: string;
    productName: string;
    forecastUnits: number;
    recipeQuantity: number;
    consumption: number;
  }>;
  recommendedActions: string[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface InventoryForecastOptions {
  restaurantId: string;
  branchId?: string;
  forecastPeriod: { start: Date; end: Date };
  lookbackDays?: number;
  includeFestivalEffects?: boolean;
}

export interface StockoutAlert {
  ingredientId: string;
  ingredientName: string;
  currentStock: number;
  predictedDepletionDate: Date;
  daysUntilDepletion: number;
  severity: 'warning' | 'critical';
  recommendedReorderQuantity: number;
  contributingMenuItems: string[];
}

export interface OverstockAlert {
  ingredientId: string;
  ingredientName: string;
  currentStock: number;
  maxStock: number;
  dailyConsumption: number;
  daysOfStock: number;
  severity: 'info' | 'warning';
  recommendedActions: string[];
}

export interface ExpiryAlert {
  ingredientId: string;
  ingredientName: string;
  currentStock: number;
  expiryDate: Date;
  daysUntilExpiry: number;
  severity: 'warning' | 'critical';
  canPromote: boolean;
  recommendedActions: string[];
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function fmtMoney(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/**
 * Get all recipes for menu items (availability: true)
 */
async function getMenuItemRecipes(restaurantId: string): Promise<Map<string, Array<{
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
}>>> {
  const recipes = await RecipeModel.find({
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
    status: 'active',
  })
    .select('productId ingredients')
    .lean()
    .exec();

  const recipeMap = new Map<string, Array<{
    ingredientId: string;
    ingredientName: string;
    quantity: number;
    unit: string;
  }>>();

  for (const recipe of recipes) {
    const productId = String(recipe.productId);
    const ingredients = recipe.ingredients
      .filter((ing: any) => ing.componentType === 'ingredient' && ing.inventoryItemId)
      .map((ing: any) => ({
        ingredientId: String(ing.inventoryItemId),
        ingredientName: ing.itemName,
        quantity: ing.normalizedQuantity || ing.quantity || 0,
        unit: ing.normalizedUnit || ing.unit || 'units',
      }));

    if (ingredients.length > 0) {
      recipeMap.set(productId, ingredients);
    }
  }

  return recipeMap;
}

/**
 * Get inventory items (products with availability: false)
 */
async function getInventoryItems(restaurantId: string): Promise<Map<string, {
  id: string;
  name: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  unit: string;
  averageCost: number;
  expiryDate?: Date;
}>> {
  const items = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    availability: false,
    isDeleted: { $ne: true },
  })
    .select('_id name currentStock minStock maxStock unit averageCost expiryDate')
    .lean()
    .exec();

  const map = new Map();
  for (const item of items) {
    map.set(String(item._id), {
      id: String(item._id),
      name: item.name,
      currentStock: item.currentStock || 0,
      minStock: item.minStock || 0,
      maxStock: item.maxStock || 0,
      unit: item.unit || 'units',
      averageCost: item.averageCost || 0,
      expiryDate: item.expiryDate,
    });
  }
  return map;
}

/**
 * Generate ingredient consumption forecasts for a period
 */
export async function generateIngredientConsumptionForecasts(
  options: InventoryForecastOptions
): Promise<IngredientConsumptionForecast[]> {
  const { restaurantId, branchId, forecastPeriod, lookbackDays = 365, includeFestivalEffects = true } = options;

  // 1. Check data sufficiency
  const sufficiency = await assessDataSufficiency({ restaurantId, branchId });
  if (sufficiency.overall === 'INSUFFICIENT_DATA') {
    return [];
  }

  // 2. Get all menu items (availability: true) with recipes
  const recipeMap = await getMenuItemRecipes(restaurantId);
  if (recipeMap.size === 0) return [];

  // 3. Get inventory items
  const inventoryItems = await getInventoryItems(restaurantId);
  if (inventoryItems.size === 0) return [];

  // 4. Get all menu items that have recipes
  const menuItemIds = Array.from(recipeMap.keys());
  const menuItems = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    _id: { $in: menuItemIds.map(objectId) },
    isDeleted: { $ne: true },
    availability: true,
  })
    .select('_id name category price')
    .lean()
    .exec();

  // 5. Generate demand forecasts for all menu items with recipes
  const entities = menuItems.map(p => ({
    type: 'product' as const,
    id: String(p._id),
    name: p.name,
  }));

  const forecasts = await generateBatchForecasts(restaurantId, branchId, entities, forecastPeriod, {
    lookbackDays: 365,
    includeSeasonality: true,
    includeFestivalEffects: true,
  });

  // 5. Get ingredient consumption rates from inventory events (historical)
  const consumptionRates = await getHistoricalConsumptionRates(restaurantId, branchId, 90);

  // 6. Build ingredient forecasts
  const ingredientConsumption = new Map<string, {
    totalMin: number;
    totalExpected: number;
    totalMax: number;
    contributingItems: Array<{
      productId: string;
      productName: string;
      forecastUnits: number;
      recipeQuantity: number;
      consumption: number;
    }>;
  }>();

  for (const forecast of forecasts) {
    const recipe = recipeMap.get(forecast.entity.id);
    if (!recipe) continue;

    const forecastUnits = forecast.predictedDemand.units.expected;

    for (const ingredient of recipe) {
      const consumption = forecastUnits * ingredient.quantity;

      const existing = ingredientConsumption.get(ingredient.ingredientId) || {
        totalMin: 0,
        totalExpected: 0,
        totalMax: 0,
        contributingItems: [],
      };

      existing.totalMin += forecast.predictedDemand.units.min * ingredient.quantity;
      existing.totalExpected += consumption;
      existing.totalMax += forecast.predictedDemand.units.max * ingredient.quantity;

      existing.contributingItems.push({
        productId: forecast.entity.id,
        productName: forecast.entity.name,
        forecastUnits,
        recipeQuantity: ingredient.quantity,
        consumption,
      });

      ingredientConsumption.set(ingredient.ingredientId, existing);
    }
  }

  // 7. Build final forecasts
  const results: IngredientConsumptionForecast[] = [];

  for (const [ingredientId, consumption] of ingredientConsumption) {
    const inventoryItem = inventoryItems.get(ingredientId);
    if (!inventoryItem) continue;

    const { currentStock, minStock, maxStock, unit, averageCost, expiryDate } = inventoryItem;
    const expectedConsumption = consumption.totalExpected;
    const daysInPeriod = Math.ceil((forecastPeriod.end.getTime() - forecastPeriod.start.getTime()) / (24 * 60 * 60 * 1000));
    const dailyConsumption = expectedConsumption / daysInPeriod;

    // Days of stock
    const daysOfStock = dailyConsumption > 0 ? currentStock / dailyConsumption : Infinity;

    // Stockout risk
    let stockoutRisk: IngredientConsumptionForecast['stockoutRisk'] = 'none';
    if (daysOfStock <= 2) stockoutRisk = 'critical';
    else if (daysOfStock <= 5) stockoutRisk = 'high';
    else if (daysOfStock <= 10) stockoutRisk = 'medium';
    else if (daysOfStock <= 20) stockoutRisk = 'low';

    // Expiry risk
    let expiryRisk: IngredientConsumptionForecast['expiryRisk'] = 'none';
    if (expiryDate) {
      const daysToExpiry = Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      if (daysToExpiry <= 2) expiryRisk = 'critical';
      else if (daysToExpiry <= 5) expiryRisk = 'high';
      else if (daysToExpiry <= 10) expiryRisk = 'medium';
      else if (daysToExpiry <= 20) expiryRisk = 'low';
    }

    // Overstock risk
    let overstockRisk: IngredientConsumptionForecast['overstockRisk'] = 'none';
    if (maxStock > 0 && currentStock >= maxStock * 0.9) overstockRisk = 'high';
    else if (maxStock > 0 && currentStock >= maxStock * 0.7) overstockRisk = 'medium';
    else if (maxStock > 0 && currentStock >= maxStock * 0.5) overstockRisk = 'low';

    // Confidence based on forecast quality
    const forecastConfidence = dailyConsumption > 0 ? 'HIGH' : 'LOW';

    // Recommended actions
    const recommendedActions: string[] = [];
    if (stockoutRisk === 'critical' || stockoutRisk === 'high') {
      recommendedActions.push(`URGENT: Reorder ${ingredientId} immediately - predicted depletion in ${Math.ceil(daysOfStock)} days`);
    } else if (stockoutRisk === 'medium') {
      recommendedActions.push(`Reorder soon - ${Math.ceil(daysOfStock)} days of stock remaining`);
    }
    if (expiryRisk === 'critical' || expiryRisk === 'high') {
      recommendedActions.push(`URGENT: Use ${ingredientId} before expiry (${expiryDate})`);
    } else if (expiryRisk === 'medium') {
      recommendedActions.push(`Plan to use ${ingredientId} before expiry (${expiryDate})`);
    }
    if (overstockRisk === 'high') {
      recommendedActions.push(`Overstocked - consider promotion or reduce purchase orders`);
    } else if (overstockRisk === 'medium') {
      recommendedActions.push(`Stock above 70% of max - monitor consumption`);
    }

    results.push({
      ingredientId,
      ingredientName: inventoryItem.name,
      unit: inventoryItem.unit,
      currentStock: inventoryItem.currentStock,
      minStock: inventoryItem.minStock,
      maxStock: inventoryItem.maxStock,
      averageCost: inventoryItem.averageCost,
      expiryDate: inventoryItem.expiryDate,
      forecastPeriod,
      predictedConsumption: {
        min: consumption.totalMin,
        expected: consumption.totalExpected,
        max: consumption.totalMax,
      },
      dailyConsumption,
      daysOfStock: {
        min: dailyConsumption > 0 ? currentStock / (consumption.totalMax / daysInPeriod) : Infinity,
        expected: dailyConsumption > 0 ? currentStock / dailyConsumption : Infinity,
        max: dailyConsumption > 0 ? currentStock / (consumption.totalMin / daysInPeriod) : Infinity,
      },
      stockoutRisk,
      expiryRisk,
      overstockRisk,
      contributingMenuItems: consumption.contributingItems.map(c => ({
        productId: c.productId,
        productName: c.productName,
        forecastUnits: c.forecastUnits,
        recipeQuantity: c.recipeQuantity,
        consumption: c.consumption,
      })),
      recommendedActions,
      confidence: forecastConfidence,
    });
  }

  return results;
}

/**
 * Get historical consumption rates from inventory events
 */
async function getHistoricalConsumptionRates(
  restaurantId: string,
  branchId: string | undefined,
  lookbackDays: number
): Promise<Map<string, { dailyRate: number; totalConsumed: number; events: number }>> {
  const { start, end } = getDateRange(lookbackDays);
  const oid = objectId(restaurantId);

  const filter: any = {
    restaurantId: oid,
    type: { $in: ['sold', 'consumption', 'waste', 'adjusted'] },
    eventDate: { $gte: start.toISOString().split('T')[0], $lte: end.toISOString().split('T')[0] },
  };
  if (branchId) filter.branchId = objectId(branchId);

  const events = await InventoryEventModel.find(filter)
    .select('item quantity unit')
    .lean()
    .exec();

  const rates = new Map<string, { dailyRate: number; totalConsumed: number; events: number }>();

  for (const event of events) {
    const key = event.item;
    const existing = rates.get(key) || { dailyRate: 0, totalConsumed: 0, events: 0 };
    existing.totalConsumed += Math.abs(event.quantity || 0);
    existing.events += 1;
    rates.set(key, existing);
  }

  for (const [key, data] of rates) {
    data.dailyRate = data.totalConsumed / lookbackDays;
  }

  return rates;
}

/**
 * Generate stockout alerts for ingredients
 */
export async function generateStockoutAlerts(
  restaurantId: string,
  branchId: string | undefined,
  horizonDays: number = 14
): Promise<StockoutAlert[]> {
  const forecasts = await generateIngredientConsumptionForecasts({
    restaurantId,
    branchId,
    forecastPeriod: {
      start: new Date(),
      end: new Date(Date.now() + horizonDays * 24 * 60 * 60 * 1000),
    },
  });

  const alerts: StockoutAlert[] = [];

  for (const forecast of forecasts) {
    if (forecast.stockoutRisk === 'critical' || forecast.stockoutRisk === 'high') {
      const depletionDate = new Date(Date.now() + forecast.daysOfStock.expected * 24 * 60 * 60 * 1000);
      const recommendedReorder = Math.max(
        forecast.predictedConsumption.expected * 1.5,
        (forecast.minStock || 0) * 2
      );

      alerts.push({
        ingredientId: forecast.ingredientId,
        ingredientName: forecast.ingredientName,
        currentStock: forecast.currentStock,
        predictedDepletionDate: depletionDate,
        daysUntilDepletion: Math.ceil(forecast.daysOfStock.expected),
        severity: forecast.stockoutRisk === 'critical' ? 'critical' : 'warning',
        recommendedReorderQuantity: Math.ceil(recommendedReorder),
        contributingMenuItems: forecast.contributingMenuItems.map(c => c.productName),
      });
    }
  }

  return alerts.sort((a, b) => a.daysUntilDepletion - b.daysUntilDepletion);
}

/**
 * Generate overstock alerts
 */
export async function generateOverstockAlerts(
  restaurantId: string,
  branchId: string | undefined
): Promise<OverstockAlert[]> {
  const forecasts = await generateIngredientConsumptionForecasts({
    restaurantId,
    branchId,
    forecastPeriod: {
      start: new Date(),
      end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const alerts: OverstockAlert[] = [];

  for (const forecast of forecasts) {
    if (forecast.overstockRisk === 'high' || forecast.overstockRisk === 'medium') {
      const severity = forecast.overstockRisk === 'high' ? 'warning' : 'info';
      const recommendedActions: string[] = [];

      if (forecast.overstockRisk === 'high') {
        recommendedActions.push('Reduce purchase orders immediately');
        recommendedActions.push('Consider clearance promotion to move excess stock');
      } else {
        recommendedActions.push('Monitor - stock is above 70% of maximum');
        recommendedActions.push('Delay next purchase order');
      }

      if (forecast.expiryRisk !== 'none') {
        recommendedActions.push('Priority: Stock has expiry risk - use FIFO strictly');
      }

      alerts.push({
        ingredientId: forecast.ingredientId,
        ingredientName: forecast.ingredientName,
        currentStock: forecast.currentStock,
        maxStock: forecast.maxStock,
        dailyConsumption: forecast.dailyConsumption,
        daysOfStock: forecast.daysOfStock.expected,
        severity,
        recommendedActions,
      });
    }
  }

  return alerts;
}

/**
 * Generate expiry alerts
 */
export async function generateExpiryAlerts(
  restaurantId: string,
  branchId: string | undefined,
  horizonDays: number = 30
): Promise<ExpiryAlert[]> {
  const inventoryItems = await getInventoryItems(restaurantId);
  const alerts: ExpiryAlert[] = [];

  for (const [id, item] of inventoryItems) {
    if (!item.expiryDate) continue;

    const daysToExpiry = Math.ceil((item.expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    if (daysToExpiry > horizonDays) continue;

    let severity: ExpiryAlert['severity'] = 'warning';
    if (daysToExpiry <= 2) severity = 'critical';
    else if (daysToExpiry <= 5) severity = 'critical';
    else if (daysToExpiry <= 10) severity = 'warning';

    const canPromote = severity !== 'critical' && item.currentStock > 0;
    const recommendedActions: string[] = [];

    if (severity === 'critical') {
      recommendedActions.push('URGENT: Use or dispose immediately');
      recommendedActions.push('Cannot promote - safety risk');
    } else {
      recommendedActions.push(`Use in promotions before ${item.expiryDate.toLocaleDateString()}`);
      recommendedActions.push('Ensure FIFO (First In, First Out) is strictly followed');
    }

    alerts.push({
      ingredientId: id,
      ingredientName: item.name,
      currentStock: item.currentStock,
      expiryDate: item.expiryDate,
      daysUntilExpiry: daysToExpiry,
      severity,
      canPromote,
      recommendedActions,
    });
  }

  return alerts.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}

/**
 * Get comprehensive inventory forecast dashboard
 */
export async function getInventoryForecastDashboard(
  restaurantId: string,
  branchId: string | undefined,
  horizonDays: number = 14
): Promise<{
  summary: {
    totalIngredients: number;
    criticalStockouts: number;
    highStockoutRisk: number;
    criticalExpiry: number;
    highExpiryRisk: number;
    overstocked: number;
    totalStockValue: number;
    atRiskValue: number;
  };
  stockoutAlerts: StockoutAlert[];
  overstockAlerts: OverstockAlert[];
  expiryAlerts: ExpiryAlert[];
  ingredientForecasts: IngredientConsumptionForecast[];
}> {
  const [
    forecasts,
    stockoutAlerts,
    overstockAlerts,
    expiryAlerts,
  ] = await Promise.all([
    generateIngredientConsumptionForecasts({ restaurantId, branchId, forecastPeriod: { start: new Date(), end: new Date(Date.now() + horizonDays * 24 * 60 * 60 * 1000) } }),
    generateStockoutAlerts(restaurantId, branchId, horizonDays),
    generateOverstockAlerts(restaurantId, branchId),
    generateExpiryAlerts(restaurantId, branchId, horizonDays),
  ]);

  const totalIngredients = forecasts.length;
  const criticalStockouts = stockoutAlerts.filter(a => a.severity === 'critical').length;
  const highStockoutRisk = stockoutAlerts.filter(a => a.severity === 'warning').length;
  const criticalExpiry = expiryAlerts.filter(a => a.severity === 'critical').length;
  const highExpiryRisk = expiryAlerts.filter(a => a.severity === 'warning').length;
  const overstocked = forecasts.filter(f => f.overstockRisk === 'high' || f.overstockRisk === 'medium').length;

  const totalStockValue = forecasts.reduce((sum, f) => sum + f.currentStock * f.averageCost, 0);
  const atRiskValue = forecasts
    .filter(f => f.stockoutRisk === 'critical' || f.stockoutRisk === 'high' || f.expiryRisk === 'critical' || f.expiryRisk === 'high')
    .reduce((sum, f) => sum + f.currentStock * f.averageCost, 0);

  return {
    summary: {
      totalIngredients,
      criticalStockouts,
      highStockoutRisk,
      criticalExpiry,
      highExpiryRisk,
      overstocked,
      totalStockValue: Math.round(totalStockValue),
      atRiskValue: Math.round(atRiskValue),
    },
    stockoutAlerts,
    overstockAlerts,
    expiryAlerts,
    ingredientForecasts: forecasts,
  };
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function getDateRange(days: number): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * InventoryAwareOptimizationService — Connects promotion recommendations
 * to stock consumption, preventing stockouts and over-promotion.
 */

import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import RecipeModel from '../modules/recipes/models/Recipe';
import { generateDemandForecast, ForecastEntity, ForecastPeriod } from './demandForecastingService';
import { optimizePromotion, OptimizationObjective, PromotionOptimizationInput } from './promotionOptimizationService';

export interface StockConsumptionForecast {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  dailyUsageRate: number;
  forecastPeriodDays: number;
  predictedConsumption: number;
  predictedEndingStock: number;
  stockoutRisk: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  daysUntilStockout: number | null;
  promotionImpact: {
    additionalConsumption: number;
    adjustedEndingStock: number;
    adjustedStockoutRisk: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    adjustedDaysUntilStockout: number | null;
  };
  recommendedAction: 'PROCEED' | 'PROCEED_WITH_CAUTION' | 'REQUIRE_REPLENISHMENT' | 'BLOCK_PROMOTION';
}

export interface InventoryAwareOptimizationInput {
  restaurantId: string;
  branchId?: string;
  productId: string;
  promotionDiscountPercent: number;
  promotionDurationDays: number;
  forecastPeriod: ForecastPeriod;
  objective: OptimizationObjective;
}

export interface InventoryAwareOptimizationResult {
  productId: string;
  productName: string;
  promotionDiscountPercent: number;
  promotionDurationDays: number;
  feasible: boolean;
  stockConsumption: StockConsumptionForecast[];
  blockingIngredients: Array<{
    ingredientId: string;
    ingredientName: string;
    reason: string;
    currentStock: number;
    neededStock: number;
    replenishmentUrgency: 'LOW' | 'MEDIUM' | 'HIGH';
  }>;
  adjustedRecommendation?: {
    discountPercent: number;
    durationDays: number;
    reason: string;
  };
  overallRisk: 'LOW' | 'MEDIUM' | 'HIGH';
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Get ingredient usage for a product from its recipe
 */
async function getProductIngredientUsage(
  restaurantId: string,
  productId: string
): Promise<Array<{ ingredientId: string; ingredientName: string; unit: string; quantityPerUnit: number }>> {
  // Find recipe for this product
  const product = await ProductModel.findById(objectId(productId))
    .select('recipeId')
    .lean()
    .exec();

  if (!product?.recipeId) return [];

  const recipe = await RecipeModel.findById(objectId(product.recipeId))
    .select('components')
    .lean()
    .exec();

  if (!recipe?.components) return [];

  // Get ingredient details
  const ingredientNames = recipe.components.map((c: any) => c.itemName);
  const ingredients = await ProductModel.find({
    restaurantId: objectId(restaurantId),
    name: { $in: ingredientNames },
    availability: false, // Inventory items
    isDeleted: { $ne: true },
  })
    .select('_id name unit currentStock minStock maxStock')
    .lean()
    .exec();

  const ingredientMap = new Map(ingredients.map(i => [i.name.toLowerCase(), i]));

  return recipe.components
    .map((c: any) => {
      const ing = ingredientMap.get(c.itemName.toLowerCase());
      if (!ing) return null;
      return {
        ingredientId: String(ing._id),
        ingredientName: ing.name,
        unit: ing.unit || 'unit',
        quantityPerUnit: c.quantity || 0,
      };
    })
    .filter(Boolean) as Array<{ ingredientId: string; ingredientName: string; unit: string; quantityPerUnit: number }>;
}

/**
 * Calculate daily usage rate from recent sales
 */
async function calculateIngredientDailyUsage(
  restaurantId: string,
  ingredientName: string,
  lookbackDays: number = 30
): Promise<number> {
  const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Find products using this ingredient
  const recipes = await RecipeModel.find({
    restaurantId: objectId(restaurantId),
    isDeleted: { $ne: true },
    'components.itemName': { $regex: new RegExp(`^${ingredientName}$`, 'i') },
  })
    .select('_id components')
    .lean()
    .exec();

  let totalQuantity = 0;
  const productIds = new Set<string>();

  for (const recipe of recipes) {
    for (const comp of recipe.components) {
      if (comp.itemName.toLowerCase() === ingredientName.toLowerCase()) {
        const products = await ProductModel.find({
          restaurantId: objectId(restaurantId),
          recipeId: recipe._id,
          isDeleted: { $ne: true },
          availability: true,
        }).select('_id').lean().exec();

        for (const p of products) productIds.add(String(p._id));
        totalQuantity += comp.quantity || 0;
      }
    }
  }

  if (productIds.size === 0) return 0;

  // Get sales for these products
  const bills = await mongoose.model('Bill').find({
    restaurantId: objectId(restaurantId),
    isVoided: { $ne: true },
    isDeleted: { $ne: true },
    createdAt: { $gte: startDate },
  }).select('_id').lean().exec();

  if (bills.length === 0) return 0;

  const billIds = bills.map(b => b._id);
  const items = await mongoose.model('BillItem').find({
    billId: { $in: billIds },
    itemId: { $in: Array.from(productIds).map(objectId) },
    isVoided: { $ne: true },
  }).select('quantity').lean().exec();

  const totalUnitsSold = items.reduce((sum, i) => sum + (i.quantity || 0), 0);
  return totalUnitsSold * (totalQuantity / productIds.size) / lookbackDays;
}

/**
 * Forecast stock consumption for a promotion
 */
export async function forecastStockConsumption(
  input: InventoryAwareOptimizationInput
): Promise<InventoryAwareOptimizationResult> {
  const { restaurantId, branchId, productId, promotionDiscountPercent, promotionDurationDays, forecastPeriod, objective } = input;

  // 1. Get product ingredients
  const ingredientUsage = await getProductIngredientUsage(restaurantId, productId);
  if (ingredientUsage.length === 0) {
    return {
      productId,
      productName: '',
      promotionDiscountPercent,
      promotionDurationDays,
      feasible: true,
      stockConsumption: [],
      blockingIngredients: [],
      overallRisk: 'LOW',
    };
  }

  // 2. Get baseline demand forecast
  const product = await ProductModel.findById(objectId(productId)).select('name price averageCost').lean().exec();
  const productName = product?.name || 'Unknown';

  const demandForecast = await generateDemandForecast({
    restaurantId,
    branchId,
    entity: { type: 'product', id: productId, name: productName },
    period: forecastPeriod,
    lookbackDays: 90,
  });

  const baselineDailyDemand = demandForecast.baseline.units;
  const elasticity = -1.2; // Default, would be estimated from history
  const pctPriceChange = -promotionDiscountPercent / 100;
  const pctDemandChange = elasticity * pctPriceChange;
  const promoDailyDemand = Math.round(baselineDailyDemand * (1 + pctDemandChange));
  const additionalDailyDemand = Math.max(0, promoDailyDemand - baselineDailyDemand);

  // 3. Analyze each ingredient
  const stockConsumption: StockConsumptionForecast[] = [];
  const blockingIngredients: InventoryAwareOptimizationResult['blockingIngredients'] = [];

  for (const usage of ingredientUsage) {
    const ingredient = await ProductModel.findById(objectId(usage.ingredientId))
      .select('currentStock minStock maxStock unit')
      .lean()
      .exec();

    if (!ingredient) continue;

    const currentStock = ingredient.currentStock || 0;
    const minStock = ingredient.minStock || 0;
    const maxStock = ingredient.maxStock || 0;
    const unit = ingredient.unit || usage.unit;

    // Get daily usage rate
    const dailyUsageRate = await calculateIngredientDailyUsage(restaurantId, usage.ingredientName);

    // Baseline consumption during promotion period
    const baselineConsumption = dailyUsageRate * promotionDurationDays;

    // Additional consumption from promotion
    const additionalConsumption = additionalDailyDemand * usage.quantityPerUnit * promotionDurationDays;

    // Total predicted consumption
    const predictedConsumption = baselineConsumption + additionalConsumption;
    const predictedEndingStock = currentStock - predictedConsumption;

    // Stockout risk assessment
    let stockoutRisk: StockConsumptionForecast['stockoutRisk'] = 'NONE';
    let daysUntilStockout: number | null = null;

    if (dailyUsageRate > 0) {
      daysUntilStockout = Math.floor(currentStock / dailyUsageRate);
      if (daysUntilStockout <= 0) stockoutRisk = 'CRITICAL';
      else if (daysUntilStockout <= 2) stockoutRisk = 'HIGH';
      else if (daysUntilStockout <= 5) stockoutRisk = 'MEDIUM';
      else if (daysUntilStockout <= 10) stockoutRisk = 'LOW';
    }

    // With promotion
    const adjustedDailyUsage = dailyUsageRate + (additionalDailyDemand * usage.quantityPerUnit);
    let adjustedDaysUntilStockout: number | null = null;
    let adjustedStockoutRisk: StockConsumptionForecast['stockoutRisk'] = 'NONE';

    if (adjustedDailyUsage > 0) {
      adjustedDaysUntilStockout = Math.floor(currentStock / adjustedDailyUsage);
      if (adjustedDaysUntilStockout <= 0) adjustedStockoutRisk = 'CRITICAL';
      else if (adjustedDaysUntilStockout <= 2) adjustedStockoutRisk = 'HIGH';
      else if (adjustedDaysUntilStockout <= 5) adjustedStockoutRisk = 'MEDIUM';
      else if (adjustedDaysUntilStockout <= 10) adjustedStockoutRisk = 'LOW';
    }

    const adjustedEndingStock = currentStock - (adjustedDailyUsage * promotionDurationDays);

    // Determine recommended action
    let recommendedAction: StockConsumptionForecast['recommendedAction'] = 'PROCEED';
    if (adjustedStockoutRisk === 'CRITICAL' || adjustedStockoutRisk === 'HIGH') {
      recommendedAction = 'BLOCK_PROMOTION';
    } else if (adjustedStockoutRisk === 'MEDIUM' || predictedEndingStock < minStock) {
      recommendedAction = 'REQUIRE_REPLENISHMENT';
    } else if (adjustedStockoutRisk === 'LOW') {
      recommendedAction = 'PROCEED_WITH_CAUTION';
    }

    stockConsumption.push({
      ingredientId: usage.ingredientId,
      ingredientName: usage.ingredientName,
      unit,
      currentStock,
      minStock,
      maxStock,
      dailyUsageRate: round2(dailyUsageRate),
      forecastPeriodDays: promotionDurationDays,
      predictedConsumption: round2(baselineConsumption),
      predictedEndingStock: round2(predictedEndingStock),
      stockoutRisk,
      daysUntilStockout,
      promotionImpact: {
        additionalConsumption: round2(additionalConsumption),
        adjustedEndingStock: round2(adjustedEndingStock),
        adjustedStockoutRisk,
        adjustedDaysUntilStockout,
      },
      recommendedAction,
    });

    // Check if this ingredient blocks the promotion
    if (recommendedAction === 'BLOCK_PROMOTION' || recommendedAction === 'REQUIRE_REPLENISHMENT') {
      blockingIngredients.push({
        ingredientId: usage.ingredientId,
        ingredientName: usage.ingredientName,
        reason: recommendedAction === 'BLOCK_PROMOTION'
          ? `Promotion would cause stockout in ${adjustedDaysUntilStockout} days`
          : `Promotion would drop stock below minimum (${minStock} ${unit})`,
        currentStock,
        neededStock: Math.ceil(adjustedDailyUsage * promotionDurationDays + minStock) - currentStock,
        replenishmentUrgency: adjustedStockoutRisk === 'CRITICAL' ? 'HIGH' :
          adjustedStockoutRisk === 'HIGH' ? 'HIGH' : 'MEDIUM',
      });
    }
  }

  // 4. Determine overall feasibility
  const hasBlocking = blockingIngredients.some(b => b.replenishmentUrgency === 'HIGH');
  const hasCaution = stockConsumption.some(s => s.recommendedAction === 'PROCEED_WITH_CAUTION');

  let feasible = true;
  let adjustedRecommendation: InventoryAwareOptimizationResult['adjustedRecommendation'] = undefined;
  let overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

  if (hasBlocking) {
    feasible = false;
    overallRisk = 'HIGH';

    // Try to find a reduced discount that works
    for (let d = promotionDiscountPercent - 5; d >= 5; d -= 5) {
      const testResult = await forecastStockConsumption({
        ...input,
        promotionDiscountPercent: d,
      });
      if (testResult.feasible) {
        adjustedRecommendation = {
          discountPercent: d,
          durationDays: promotionDurationDays,
          reason: `Reduced discount from ${promotionDiscountPercent}% to ${d}% to avoid stockout`,
        };
        break;
      }
    }

    if (!adjustedRecommendation) {
      // Try shorter duration
      for (let dur = promotionDurationDays - 1; dur >= 1; dur--) {
        const testResult = await forecastStockConsumption({
          ...input,
          promotionDurationDays: dur,
        });
        if (testResult.feasible) {
          adjustedRecommendation = {
            discountPercent: promotionDiscountPercent,
            durationDays: dur,
            reason: `Reduced duration from ${promotionDurationDays} to ${dur} days to avoid stockout`,
          };
          break;
        }
      }
    }
  } else if (hasCaution) {
    overallRisk = 'MEDIUM';
  }

  return {
    productId,
    productName,
    promotionDiscountPercent,
    promotionDurationDays,
    feasible,
    stockConsumption,
    blockingIngredients,
    adjustedRecommendation,
    overallRisk,
  };
}

/**
 * Check if a promotion can proceed without inventory issues
 */
export async function canPromotionProceed(
  restaurantId: string,
  branchId: string | undefined,
  productId: string,
  discountPercent: number,
  durationDays: number
): Promise<{ canProceed: boolean; risk: 'LOW' | 'MEDIUM' | 'HIGH'; blockers: string[] }> {
  const forecastPeriod: ForecastPeriod = {
    start: new Date(),
    end: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000),
    label: 'promotion_period',
  };

  const result = await forecastStockConsumption({
    restaurantId,
    branchId,
    productId,
    promotionDiscountPercent: discountPercent,
    promotionDurationDays: durationDays,
    forecastPeriod,
    objective: 'maximize_contribution',
  });

  const blockers = result.blockingIngredients.map(b => `${b.ingredientName}: ${b.reason}`);

  return {
    canProceed: result.feasible,
    risk: result.overallRisk,
    blockers,
  };
}

/**
 * Get inventory-aware promotion adjustments
 */
export async function getInventoryAwareAdjustments(
  restaurantId: string,
  branchId: string | undefined,
  productId: string,
  baseDiscount: number,
  baseDuration: number
): Promise<{
  adjustedDiscount: number;
  adjustedDuration: number;
  adjustments: string[];
  feasible: boolean;
}> {
  const forecastPeriod: ForecastPeriod = {
    start: new Date(),
    end: new Date(Date.now() + baseDuration * 24 * 60 * 60 * 1000),
    label: 'promotion_period',
  };

  const result = await forecastStockConsumption({
    restaurantId,
    branchId,
    productId,
    promotionDiscountPercent: baseDiscount,
    promotionDurationDays: baseDuration,
    forecastPeriod,
    objective: 'maximize_contribution',
  });

  const adjustments: string[] = [];

  if (result.adjustedRecommendation) {
    adjustments.push(result.adjustedRecommendation.reason);
    return {
      adjustedDiscount: result.adjustedRecommendation.discountPercent,
      adjustedDuration: result.adjustedRecommendation.durationDays,
      adjustments,
      feasible: true,
    };
  }

  if (!result.feasible) {
    adjustments.push('Promotion blocked due to inventory constraints');
    return {
      adjustedDiscount: 0,
      adjustedDuration: 0,
      adjustments,
      feasible: false,
    };
  }

  // Check for caution items
  for (const sc of result.stockConsumption) {
    if (sc.recommendedAction === 'PROCEED_WITH_CAUTION') {
      adjustments.push(`Caution: ${sc.ingredientName} stock will be low (${Math.round(sc.promotionImpact.adjustedEndingStock)} ${sc.unit} remaining)`);
    }
  }

  return {
    adjustedDiscount: baseDiscount,
    adjustedDuration: baseDuration,
    adjustments,
    feasible: true,
  };
}

export { objectId, round2 };
export type { StockConsumptionForecast, InventoryAwareOptimizationInput, InventoryAwareOptimizationResult };
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inventory Demand Controller — Handles ingredient consumption predictions
 * and stockout risk assessment. Uses statistical forecasts and recipe data.
 * All routes are tenant-scoped (restaurantId from JWT).
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import RecipeModel from '../modules/recipes/models/Recipe';
import BillModel from '../models/Bill';
import BillItemModel from '../models/BillItem';
import { generateDemandForecast, ForecastEntity, ForecastPeriod, DataConfidenceLevel } from '../services/demandForecastingService';
import { assessDataSufficiency } from '../services/dataSufficiencyService';
import { forecastStockConsumption } from '../services/inventoryAwareOptimizationService';
import { canPromotionProceed } from '../services/inventoryAwareOptimizationService';

function getRestaurantId(req: Request): string {
  return String((req as any).user?.restaurantId || '');
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * POST /api/inventory-demand/predict - Predict ingredient consumption
 * based on demand forecasts for the next horizon days.
 */
export async function predictIngredientConsumptionHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    const { productIds, horizonDays = 7 } = req.body || {};

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({ error: 'Missing or invalid productIds array' }); return;
    }

    // Get forecasts for the specified products
    const forecastPeriod: ForecastPeriod = {
      start: new Date(),
      end: new Date(Date.now() + (horizonDays || 7) * 24 * 60 * 60 * 1000),
      label: `next_${horizonDays || 7}_days`,
    };

    const productNames: string[] = [];
    const forecasts: any[] = [];

    for (const productId of productIds) {
      const product = await ProductModel.findById(objectId(productId))
        .select('name')
        .lean()
        .exec();

      if (!product) continue;

      productNames.push(product.name || 'Unknown');

      const forecast = await generateDemandForecast({
        restaurantId,
        branchId: undefined,
        entity: { type: 'product' as const, id: productId, name: product.name || '' },
        period: forecastPeriod,
        lookbackDays: 365,
        includeSeasonality: true,
        includeFestivalEffects: true,
      });

      forecasts.push({
        productId,
        productName: product.name,
        forecast,
      });
    }

    res.json({
      restaurantId,
      horizonDays,
      period: { start: forecastPeriod.start, end: forecastPeriod.end, label: forecastPeriod.label },
      productNames,
      forecasts,
      generatedAt: new Date(),
    });
  } catch (error: any) {
    console.error('[Inventory-Demand] predict error:', error.message);
    res.status(500).json({ error: 'Failed to predict ingredient consumption' });
  }
}

/**
 * GET /api/inventory-demand/stockout-risks - Get active stockout risks (MEDIUM and above)
 */
export async function getStockoutRisksHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    // Get all products for this restaurant
    const products = await ProductModel.find({
      restaurantId: objectId(restaurantId),
      isDeleted: { $ne: true },
    }).select('_id name recipeId').lean().exec();

    const riskLevels: any[] = [];

    for (const product of products) {
      // Get stockout risk by checking promotion impact
      const canProceedResult = await canPromotionProceed(
        restaurantId,
        undefined,
        String(product._id),
        0, // no discount for baseline
        7  // 7-day promotion
      );

      // Assess baseline stockout risk from forecast
      const forecastPeriod: any = {
        start: new Date(),
        end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        label: 'next_7_days',
      };

      const forecast = await generateDemandForecast({
        restaurantId,
        branchId: undefined,
        entity: { type: 'product' as const, id: String(product._id), name: product.name || '' },
        period: forecastPeriod,
        lookbackDays: 365,
        includeSeasonality: true,
        includeFestivalEffects: true,
      });

      // Calculate risk based on predicted consumption vs current stock
      let riskLevel: string = 'NONE';
      let timeToStockoutHours: number | null = null;
      let currentStock = 0;
      let predictedConsumption = 0;

      // Get current stock from recipe ingredients
      if (product.recipeId) {
        const recipe = await RecipeModel.findById(objectId(product.recipeId))
          .select('components')
          .lean()
          .exec();

        if (recipe?.components) {
          const ingredientNames = recipe.components.map((c: any) => c.itemName);
          const ingredients = await ProductModel.find({
            restaurantId: objectId(restaurantId),
            name: { $in: ingredientNames },
            isDeleted: { $ne: true },
          }).select('_id name currentStock unit').lean().exec();

          const ingredientMap = new Map(ingredients.map(i => [i.name.toLowerCase(), i]));

          for (const usage of recipe.components) {
            const ing = ingredientMap.get(usage.itemName.toLowerCase());
            if (ing) {
              currentStock += ing.currentStock || 0;
              predictedConsumption += forecast.baseline.units * usage.quantity;
            }
          }
        }
      }

      // Simple risk assessment
      if (predictedConsumption > currentStock) {
        riskLevel = 'CRITICAL';
        timeToStockoutHours = 0;
      } else if (predictedConsumption > currentStock * 0.8) {
        riskLevel = 'HIGH';
        timeToStockoutHours = Math.floor((currentStock - (currentStock * 0.2)) / (predictedConsumption / 7 / 24));
      } else if (predictedConsumption > currentStock * 0.6) {
        riskLevel = 'MEDIUM';
        timeToStockoutHours = Math.floor((currentStock - (currentStock * 0.4)) / (predictedConsumption / 7 / 24));
      } else if (predictedConsumption > currentStock * 0.4) {
        riskLevel = 'LOW';
        timeToStockoutHours = Math.floor((currentStock - (currentStock * 0.6)) / (predictedConsumption / 7 / 24));
      }

      riskLevels.push({
        productId: String(product._id),
        productName: product.name,
        currentStock,
        predictedConsumption,
        riskLevel,
        timeToStockoutHours,
      });
    }

    // Sort by risk level (CRITICAL first)
    const riskOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };
    riskLevels.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]);

    res.json({
      restaurantId,
      risks: riskLevels,
      generatedAt: new Date(),
    });
  } catch (error: any) {
    console.error('[Inventory-Demand] stockout-risks error:', error.message);
    res.status(500).json({ error: 'Failed to get stockout risks' });
  }
}

/**
 * GET /api/inventory-demand/reorder-suggestions - Get ingredients needing replenishment
 */
export async function getReorderSuggestionsHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    // Get all products with recipes
    const products = await ProductModel.find({
      restaurantId: objectId(restaurantId),
      recipeId: { $exists: true },
      isDeleted: { $ne: true },
    }).select('_id name').lean().exec();

    const suggestions: any[] = [];

    for (const product of products) {
      const recipe = await RecipeModel.findById(product.recipeId)
        .select('components')
        .lean()
        .exec();

      if (!recipe?.components) continue;

      const ingredientNames = recipe.components.map((c: any) => c.itemName);
      const ingredients = await ProductModel.find({
        restaurantId: objectId(restaurantId),
        name: { $in: ingredientNames },
        isDeleted: { $ne: true },
        type: 'inventory',
      }).select('_id name currentStock minStock maxStock unit').lean().exec();

      const ingredientMap = new Map(ingredients.map(i => [i.name.toLowerCase(), i]));

      for (const usage of recipe.components) {
        const ing = ingredientMap.get(usage.itemName.toLowerCase());
        if (!ing) continue;

        // Calculate baseline consumption from recent sales (30 days)
        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const bills = await BillModel.find({
          restaurantId: objectId(restaurantId),
          isVoided: { $ne: true },
          isDeleted: { $ne: true },
          createdAt: { $gte: startDate },
        }).select('_id').lean().exec();

        const billIds = bills.map(b => b._id);
        const items = await BillItemModel.find({
          billId: { $in: billIds },
          itemId: { $in: ingredientMap.has(ing._id ? String(ing._id) : ing.name) ? [String(ing._id) || ing.name] : [] },
          isVoided: { $ne: true },
        }).select('quantity').lean().exec();

        const totalUnitsSold = items.reduce((sum, i) => sum + (i.quantity || 0), 0);
        const dailyUsageRate = totalUnitsSold / 30 || 0;

        // Predict consumption for next 7 days
        const predictedConsumption = Math.round(dailyUsageRate * 7);

        // Minimum stock threshold (20% buffer)
        const minStockThreshold = Math.round((ing.minStock || ing.currentStock) * 0.2);

        // Check if reorder needed
        const needsReorder = predictedConsumption + (ing.currentStock || 0) < (ing.minStock || 0);

        if (needsReorder) {
          suggestions.push({
            ingredientId: String(ing._id),
            ingredientName: ing.name,
            unit: ing.unit || usage.unit || 'unit',
            currentStock: ing.currentStock || 0,
            minStock: ing.minStock || 0,
            predictedConsumption7d: predictedConsumption,
            recommendedReorderQuantity: Math.max(0, (ing.minStock || 0) - (ing.currentStock || 0) + predictedConsumption),
            daysOfSupply: ing.currentStock ? Math.round(ing.currentStock / dailyUsageRate) : 0,
          });
        }
      }
    }

    // Sort by urgency (lowest current stock first)
    suggestions.sort((a, b) => a.currentStock - b.currentStock);

    res.json({
      restaurantId,
      suggestions,
      generatedAt: new Date(),
    });
  } catch (error: any) {
    console.error('[Inventory-Demand] reorder-suggestions error:', error.message);
    res.status(500).json({ error: 'Failed to get reorder suggestions' });
  }
}

export default {
  predictIngredientConsumptionHandler,
  getStockoutRisksHandler,
  getReorderSuggestionsHandler,
};
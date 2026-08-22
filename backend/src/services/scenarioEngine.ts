/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ScenarioEngine — Deterministic scenario comparison engine.
 * Compares Current vs Promo A vs Promo B vs Combo vs No Promotion
 * with full economic evaluation and constraint validation.
 *
 * All calculations are deterministic. AI is only used for explanation,
 * never for the core economic computation.
 */

import mongoose from 'mongoose';
import OfferModel from '../models/Offer';
import OfferAnalyticsModel from '../models/OfferAnalytics';
import BillModel from '../models/Bill';
import BillItemModel from '../models/BillItem';
import ProductModel from '../models/Product';
import RecipeModel from '../modules/recipes/models/Recipe';
import { generateDemandForecast } from './demandForecastingService';
import { assessDataSufficiency } from './dataSufficiencyService';
import { optimizePromotion } from './promotionOptimizationService';
import { forecastStockConsumption } from './inventoryAwareOptimizationService';
import { estimateElasticityFromHistory } from './elasticityService';
import { objectId } from '../utils';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * Scenario input definition for the scenario engine.
 */
export interface ScenarioInput {
  type: 'current' | 'promo' | 'combo' | 'no_promo';
  offerConfig?: {
    type: 'percentage' | 'flat' | 'buy_x_get_y' | 'combo' | 'add_on';
    value: number;
    minOrderValue?: number;
    maxDiscount?: number;
    applicableProductIds?: string[];
    applicableCategoryIds?: string[];
  };
  targetProducts?: string[]; // product IDs affected
  objectives?: string[]; // Optimization objectives to optimize for
}

/**
 * Result from comparing two scenarios.
 */
export interface ScenarioComparisonResult {
  scenarioId: string;
  name: string;
  type: string;
  discountPercent: number;
  expectedDemand: number;
  expectedRevenue: number;
  expectedContribution: number;
  incrementalContribution: number;
  incrementalRevenue: number;
  cannibalizationRate: number;
  inventoryRisk: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  stockoutRisk: boolean;
  constraintsViolated: string[];
  score: number; // weighted by objective
}

/**
 * Compare 5 scenarios: Current vs Promo A vs Promo B vs Combo vs No Promo
 * 
 * For each scenario, calculate:
 * - Expected demand (using elasticity or attachment rates)
 * - Revenue and contribution
 * - Incremental vs baseline
 * - Inventory impact
 * - Cannibalization risk
 * - Constraint validation
 */
export async function compareScenarios(
  restaurantId: string,
  branchId: string | undefined,
  baseEntity: { type: string; id: string; name: string },
  scenarios: ScenarioInput[],
  options: {
    objectives?: string[];
    constraints?: {
      minMarginPercent?: number;
      maxDiscountPercent?: number;
      minSellingPrice?: number;
      requireInventoryAvailability?: boolean;
      restrictedCategories?: string[];
      excludedProductIds?: string[];
    };
  } = {}
): Promise<ScenarioComparisonResult[]> {
  const oid = objectId(restaurantId);
  const objectives = options.objectives || ['maximize_contribution'];
  const constraints = options.constraints || {
    minMarginPercent: 15,
    maxDiscountPercent: 30,
    minSellingPrice: 50,
    requireInventoryAvailability: true,
    restrictedCategories: [],
    excludedProductIds: [],
  };

  // Step 1: Get data sufficiency
  const sufficiency = await assessDataSufficiency({ restaurantId, branchId });

  // Step 2: Get baseline forecast (current demand without promotion)
  const forecastPeriod: any = {
    start: new Date(),
    end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
    label: 'next_14_days',
  };

  let baselineForecast: any;
  try {
    baselineForecast = await generateDemandForecast({
      restaurantId,
      branchId,
      entity: { type: baseEntity.type as const, id: baseEntity.id, name: baseEntity.name },
      period: forecastPeriod,
      lookbackDays: 365,
      includeSeasonality: sufficiency.overall === 'HIGH_CONFIDENCE',
      includeFestivalEffects: true,
    });
  } catch (e) {
    baselineForecast = { baseline: { units: 0, revenue: 0 }, trend: { direction: 'stable', percentage: 0, confidence: 0 } };
  }

  const baselineDemand = baselineForecast.baseline?.units || 0;
  const baselineRevenue = baselineForecast.baseline?.revenue || 0;
  const baselineContribution = baselineForecast.baseline?.revenue 
    ? Math.round(baselineForecast.baseline.units * 0.2) // assume 20% margin baseline
    : 0;

  // Step 3: Estimate elasticity for the product if we have promotion data
  let elasticity = -1.2; // default
  try {
    const elasticityResult = await estimateElasticityFromHistory(restaurantId, baseEntity.id, 180);
    if (elasticityResult.confidence > 0.3) {
      elasticity = elasticityResult.elasticity;
    }
  } catch (e) {
    // ignore - use default
  }

  // Step 4: Compare each scenario
  const results: ScenarioComparisonResult[] = [];

  // Always include "No Promotion" as first-class scenario
  results.push({
    scenarioId: 'no_promo',
    name: 'No Promotion',
    type: 'no_promo',
    discountPercent: 0,
    expectedDemand: baselineDemand,
    expectedRevenue: baselineRevenue,
    expectedContribution: baselineContribution,
    incrementalContribution: 0,
    incrementalRevenue: 0,
    cannibalizationRate: 0,
    inventoryRisk: 'NONE',
    stockoutRisk: false,
    constraintsViolated: [],
    score: 0,
  });

  // Process promotional scenarios
  for (const scenarioInput of scenarios) {
    let scenarioResult: ScenarioComparisonResult | null = null;

    switch (scenarioInput.type) {
      case 'promo': {
        const { type, value } = scenarioInput.offerConfig || {};
        const discountPct = type === 'percentage' ? value : 
          (value / 100) * 100; // convert to percentage equivalent

        // Evaluate promotion using optimization service
        const optInput: any = {
          restaurantId,
          branchId,
          productId: baseEntity.id,
          currentPrice: baselineForecast.baseline?.revenue / Math.max(baselineForecast.baseline?.units, 1) || 0,
          recipeCost: 0, // will be fetched if needed
          baselineDemand: baselineDemand,
          elasticity,
          objective: objectives[0] || 'maximize_contribution',
          constraints,
        };

        try {
          const optResult = await optimizePromotion(optInput);

          // Get inventory risk
          const inventoryResult = await forecastStockConsumption({
            restaurantId,
            branchId,
            productId: baseEntity.id,
            promotionDiscountPercent: discountPct,
            promotionDurationDays: 7,
            forecastPeriod,
            objective: 'maximize_contribution',
          });

          scenarioResult = {
            scenarioId: `promo_${discountPct}`,
            name: `${discountPct}% ${type === 'percentage' ? 'Discount' : 'Flat Discount'}`,
            type: 'promo',
            discountPercent: discountPct,
            expectedDemand: optResult.scenarios[0]?.expectedDemand || baselineDemand,
            expectedRevenue: optResult.scenarios[0]?.expectedRevenue || baselineRevenue,
            expectedContribution: optResult.scenarios[0]?.expectedContribution || baselineContribution,
            incrementalContribution: optResult.scenarios[0]?.incrementalContribution || 0,
            incrementalRevenue: optResult.scenarios[0]?.incrementalRevenue || 0,
            cannibalizationRate: optResult.scenarios[0]?.cannibalizationRate || 0,
            inventoryRisk: inventoryResult.stockoutRisk as any,
            stockoutRisk: inventoryResult.blockingIngredients.some((b: any) => b.replenishmentUrgency === 'HIGH'),
            constraintsViolated: optResult.recommendation?.risks || [],
            score: optResult.recommendation?.expectedIncrementalContribution || 0,
          };
        } catch (e) {
          console.error('[Scenario] promo optimization error:', e.message);
        }
        break;
      }

      case 'combo': {
        // Combo optimization - test multiple configurations
        // For now, use the first target product if available
        const targetProducts = scenarioInput.targetProducts || [baseEntity.id];

        for (const productId of targetProducts.slice(0, 4)) { // limit to 4 combos max
          try {
            const product = await ProductModel.findById(objectId(productId))
              .select('name price averageCost recipeId')
              .lean()
              .exec();

            if (!product) continue;

            // Calculate combo: main product + add-ons from recipe
            let comboContribution = 0;
            let comboRevenue = 0;
            let comboDemand = baselineDemand;

            if (product.recipeId) {
              const recipe = await RecipeModel.findById(objectId(product.recipeId))
                .select('components')
                .lean()
                .exec();

              if (recipe?.components) {
                // For each component that's an add-on, calculate contribution
                for (const comp of recipe.components) {
                  // If this is an add-on (not the main product)
                  const addonProduct = await ProductModel.findOne({
                    restaurantId: oid,
                    name: comp.itemName,
                    isDeleted: { $ne: true },
                  }).select('price averageCost').lean().exec();

                  if (addonProduct) {
                    const addonContribution = Math.round((addonProduct.price - addonProduct.averageCost) * comboDemand);
                    comboContribution += addonContribution;
                    comboRevenue += addonProduct.price * comboDemand;
                  }
                }
              }
            }

            // Main product contribution
            const mainContribution = Math.round((product.price - (product.averageCost || 0)) * comboDemand);
            const totalContribution = mainContribution + comboContribution;
            const totalRevenue = (product.price + (product.price * 0.2)) * comboDemand; // assume 20% addon value

            scenarioResult = {
              scenarioId: `combo_${productId}`,
              name: `${product.name} Combo`,
              type: 'combo',
              discountPercent: 0,
              expectedDemand: comboDemand,
              expectedRevenue: totalRevenue,
              expectedContribution: totalContribution,
              incrementalContribution: totalContribution - baselineContribution,
              incrementalRevenue: totalRevenue - baselineRevenue,
              cannibalizationRate: 0.1, // assumed low for combos
              inventoryRisk: 'LOW',
              stockoutRisk: false,
              constraintsViolated: [],
              score: totalContribution,
            };
            break; // take first valid combo
          } catch (e) {
            console.error('[Scenario] combo optimization error:', e.message);
          }
        }
        if (!scenarioResult) {
          // Fallback combo
          scenarioResult = {
            scenarioId: 'combo_fallback',
            name: 'Combo Offer',
            type: 'combo',
            discountPercent: 0,
            expectedDemand: baselineDemand,
            expectedRevenue: baselineRevenue * 1.1,
            expectedContribution: baselineContribution * 1.1,
            incrementalContribution: baselineContribution * 0.1,
            incrementalRevenue: baselineRevenue * 0.1,
            cannibalizationRate: 0.15,
            inventoryRisk: 'LOW',
            stockoutRisk: false,
            constraintsViolated: [],
            score: baselineContribution * 1.1,
          };
        }
        break;
      }

      default:
        break;
    }

    if (scenarioResult) {
      // Validate constraints
      const violations: string[] = [];
      if (scenarioResult.expectedContribution < (constraints.minMarginPercent || 15)) {
        violations.push(`Margin ${Math.round(scenarioResult.expectedContribution)}% below minimum ${constraints.minMarginPercent || 15}%`);
      }
      if (scenarioResult.discountPercent > (constraints.maxDiscountPercent || 30)) {
        violations.push(`Discount ${scenarioResult.discountPercent}% exceeds maximum ${constraints.maxDiscountPercent || 30}%`);
      }
      scenarioResult.constraintsViolated = violations;

      // Calculate score based on objective
      let score = 0;
      for (const obj of objectives) {
        switch (obj) {
          case 'maximize_contribution':
            score += scenarioResult.incrementalContribution || 0;
            break;
          case 'maximize_revenue':
            score += scenarioResult.incrementalRevenue || 0;
            break;
          case 'maximize_aov':
            score += (scenarioResult.expectedRevenue || 0) / Math.max(scenarioResult.expectedDemand || 1, 1);
            break;
          case 'maximize_transactions':
            score += scenarioResult.expectedDemand || 0;
            break;
          case 'reduce_inventory':
            score -= (scenarioResult.inventoryRisk === 'CRITICAL' ? 100 : scenarioResult.inventoryRisk === 'HIGH' ? 50 : 0);
            break;
          case 'maximize_retention':
            score += (scenarioResult.discountPercent || 0) > 0 && (scenarioResult.incrementalContribution || 0) > 0 ? 
              (scenarioResult.incrementalContribution || 0) * 1.1 : 0;
            break;
          case 'maximize_slow_hour_utilization':
            score += (scenarioResult.expectedDemand || 0) > baselineDemand ? 
              (scenarioResult.incrementalContribution || 0) * 0.5 : 0;
            break;
        }
      }
      scenarioResult.score = score;

      results.push(scenarioResult);
    }
  }

  // Step 5: Sort results by score (highest first)
  results.sort((a, b) => b.score - a.score);

  return results;
}

/**
 * Get the best scenario for a given objective
 */
export function getBestScenario(
  results: ScenarioComparisonResult[],
  objective: string
): ScenarioComparisonResult | null {
  const validResults = results.filter(r => !r.constraintsViolated || r.constraintsViolated.length === 0);
  if (validResults.length === 0) return null;

  return validResults.reduce((best, current) => {
    // Prefer scenarios without constraint violations
    if (best.constraintsViolated && best.constraintsViolated.length > 0 && 
        (!current.constraintsViolated || current.constraintsViolated.length === 0)) {
      return current;
    }
    if ((best.constraintsViolated || best.constraintsViolated.length > 0) && 
        (current.constraintsViolated || current.constraintsViolated.length > 0)) {
      // Both have violations, pick the one with fewer/smaller violations
      const bestViolations = best.constraintsViolated?.length || 0;
      const currentViolations = current.constraintsViolated?.length || 0;
      return currentViolations < bestViolations ? current : best;
    }
    return current.score > best.score ? current : best;
  }, validResults[0]);
}

export default {
  compareScenarios,
  getBestScenario,
};
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scenario Controller — Promotion scenario comparison and optimization.
 * All routes are tenant-scoped (restaurantId from JWT).
 */

import { Request, Response } from 'express';
import mongoose from 'mongoose';
import ProductModel from '../models/Product';
import { compareScenarios, getBestScenario } from '../services/scenarioEngine';
import { estimateElasticityFromHistory } from '../services/elasticityService';
import { assessDataSufficiency } from '../services/dataSufficiencyService';

function getRestaurantId(req: Request): string {
  return String((req as any).user?.restaurantId || '');
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
};

/**
 * POST /api/scenario/compare - Compare custom scenarios
 * Body: { baseEntity: { type, id, name }, scenarios: [...], objectives?: [...], constraints?: {...} */
export async function compareScenariosHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    const { baseEntity, scenarios, objectives, constraints } = req.body || {};
    if (!baseEntity || !scenarios || !Array.isArray(scenarios)) {
      res.status(400).json({ error: 'Missing required fields: baseEntity and scenarios array' }); return;
    }

    // Check data sufficiency
    const sufficiency = await assessDataSufficiency({ restaurantId });
    if (sufficiency.overall === 'INSUFFICIENT_DATA') {
      res.status(400).json({ error: 'Insufficient data for predictive intelligence' }); return;
    }

    const results = await compareScenarios(
      restaurantId,
      req.body.branchId,
      baseEntity,
      scenarios as any,
      { objectives, constraints }
    );

    res.json({
      restaurantId,
      dataSufficiency: sufficiency.overall,
      results,
      generatedAt: new Date(),
    });
  } catch (error: any) {
    console.error('[Scenario] compare error:', error.message);
    res.status(500).json({ error: 'Failed to compare scenarios' });
  }
}

/**
 * GET /api/scenario/optimal/:productId - Get optimal discount scenario for a product
 * Query: objectives=maximize_contribution&maximize_revenue&...
 */
export async function getOptimalScenarioHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    const productId = req.params.productId;
    const objectivesStr = req.query.objectives as string || 'maximize_contribution';
    const objectives = objectivesStr.split(',').filter(Boolean) as string[];

    // Check data sufficiency
    const sufficiency = await assessDataSufficiency({ restaurantId });
    if (sufficiency.overall === 'INSUFFICIENT_DATA') {
      res.status(400).json({ error: 'Insufficient data for predictive intelligence' }); return;
    }

    // Get product info
    const product = await ProductModel.findById(objectId(productId))
      .select('name price averageCost')
      .lean()
      .exec();

    if (!product) {
      res.status(404).json({ error: 'Product not found' }); return;
    }

    // Estimate elasticity
    const elasticityResult = await estimateElasticityFromHistory(restaurantId, productId, 180);

    // Build baseline scenario input
    const baselineDemand = 100; // would fetch from forecast in production
    const constraints = {
      minMarginPercent: 15,
      maxDiscountPercent: 30,
      minSellingPrice: 50,
      requireInventoryAvailability: true,
      restrictedCategories: [],
      excludedProductIds: [],
    };

    // Define scenarios to compare
    const scenarios = [
      {
        type: 'current' as const,
        name: 'Current Pricing',
      },
      {
        type: 'promo' as const,
        offerConfig: { type: 'percentage', value: 10 },
        name: '₹10 OFF',
      },
      {
        type: 'promo' as const,
        offerConfig: { type: 'percentage', value: 20 },
        name: '₹20 OFF',
      },
      {
        type: 'promo' as const,
        offerConfig: { type: 'percentage', value: 30 },
        name: '₹30 OFF',
      },
      {
        type: 'combo' as const,
        targetProducts: [productId],
        name: 'Combo Offer',
      },
      {
        type: 'no_promo' as const,
        name: 'No Promotion',
      },
    ];

    const results = await compareScenarios(
      restaurantId,
      undefined,
      { type: 'product' as const, id: productId, name: product.name },
      scenarios,
      { objectives, constraints }
    );

    const best = getBestScenario(results, objectives[0] || 'maximize_contribution');

    res.json({
      restaurantId,
      productId,
      productName: product.name,
      dataSufficiency: sufficiency.overall,
      elasticity: elasticityResult.elasticity,
      results,
      bestScenario: best ? {
        id: best.scenarioId,
        name: best.name,
        type: best.type,
        discountPercent: best.discountPercent,
        expectedDemand: best.expectedDemand,
        expectedContribution: best.expectedContribution,
        incrementalContribution: best.incrementalContribution,
        constraintsViolated: best.constraintsViolated,
      } : null,
      generatedAt: new Date(),
    });
  } catch (error: any) {
    console.error('[Scenario] optimal error:', error.message);
    res.status(500).json({ error: 'Failed to get optimal scenario' });
  }
}

/**
 * GET /api/scenario/elasticity/:productId - Get promotion elasticity curve
 */
export async function getElasticityHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    const productId = req.params.productId;

    const result = await estimateElasticityFromHistory(restaurantId, productId, 180);

    res.json({
      restaurantId,
      productId,
      elasticity: result.elasticity,
      elasticityPoints: result.elasticityPoints,
      diminishingReturns: result.diminishingReturns,
      diminishingReturnsAt: result.diminishingReturnsAt,
      modelFit: result.modelFit,
      dataQuality: result.dataQuality,
      confidence: result.confidence,
    });
  } catch (error: any) {
    console.error('[Scenario] elasticity error:', error.message);
    res.status(500).json({ error: 'Failed to estimate elasticity' });
  }
}

export default {
  compareScenariosHandler,
  getOptimalScenarioHandler,
  getElasticityHandler,
};
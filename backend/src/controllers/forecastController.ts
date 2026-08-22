/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Forecast Controller — Demand forecasting endpoints.
 * Uses statistical baselines only (no ML) per Phase 4 requirements.
 * All routes are tenant-scoped (restaurantId from JWT).
 */

import { Request, Response } from 'express';
import { generateDemandForecast, ForecastOptions, ForecastEntity, ForecastPeriod, DataConfidenceLevel } from '../services/demandForecastingService';
import { assessDataSufficiency } from '../services/dataSufficiencyService';
import BillModel from '../models/Bill';
import mongoose from 'mongoose';

function getRestaurantId(req: Request): string {
  return String((req as any).user?.restaurantId || '');
}

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

/**
 * GET /api/forecast/restaurant - restaurant-level forecast for next 7 days
 */
export async function getRestaurantForecastHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }

    const period: ForecastPeriod = {
      start: new Date(),
      end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      label: 'next_7_days',
    };

    // Generate forecasts for restaurant, top categories, and top products
    const entities: ForecastEntity[] = [
      { type: 'restaurant' as const, id: restaurantId, name: 'Restaurant' },
    ];

    // Get top categories and products - simplified for now
    // In production, would query top sellers from DB
    const forecasts = await generateDemandForecast({
      restaurantId,
      branchId: undefined,
      entity: { type: 'restaurant' as const, id: restaurantId, name: 'Restaurant' },
      period,
      lookbackDays: 365,
      includeSeasonality: true,
      includeFestivalEffects: true,
    });

    res.json({
      restaurantId,
      period: { start: period.start, end: period.end, label: period.label },
      forecasts,
      generatedAt: new Date(),
      dataSufficiency: 'auto-detected',
    });
  } catch (error: any) {
    console.error('[Forecast] restaurant forecast error:', error.message);
    res.status(500).json({ error: 'Failed to generate restaurant forecast' });
  }
}

/**
 * GET /api/forecast/category/:categoryId - category forecast
 */
export async function getCategoryForecastHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    const categoryId = req.params.categoryId;
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    if (!categoryId) { res.status(400).json({ error: 'Missing category ID' }); return; }

    const period: ForecastPeriod = {
      start: new Date(),
      end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      label: 'next_7_days',
    };

    const forecasts = await generateCategoryForecasts(restaurantId, undefined, categoryId, period);

    res.json({
      restaurantId,
      categoryId,
      period: { start: period.start, end: period.end, label: period.label },
      forecasts,
      generatedAt: new Date(),
    });
  } catch (error: any) {
    console.error('[Forecast] category forecast error:', error.message);
    res.status(500).json({ error: 'Failed to generate category forecast' });
  }
}

/**
 * GET /api/forecast/product/:productId - product forecast
 */
export async function getProductForecastHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    const productId = req.params.productId;
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    if (!productId) { res.status(400).json({ error: 'Missing product ID' }); return; }

    const period: ForecastPeriod = {
      start: new Date(),
      end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      label: 'next_7_days',
    };

    // Get forecasts for the specific product across different time slots
    const entities: ForecastEntity[] = [
      { type: 'product' as const, id: productId, name: '' },
    ];

    // Generate for different time slots (breakfast, lunch, dinner, evening)
    const timeSlots = [
      { start: new Date(), end: new Date(Date.now() + 24 * 60 * 60 * 1000), label: 'daily' },
      { start: new Date(), end: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), label: 'next_2_days' },
    ];

    const allForecasts: any[] = [];
    for (const slot of timeSlots) {
      const forecasts = await generateDemandForecast({
        restaurantId,
        branchId: undefined,
        entity: { type: 'product' as const, id: productId, name: '' },
        period: slot,
        lookbackDays: 365,
        includeSeasonality: true,
        includeFestivalEffects: true,
      });
      allForecasts.push({
        period: slot,
        forecasts,
      });
    }

    res.json({
      restaurantId,
      productId,
      period: { start: period.start, end: period.end, label: period.label },
      forecasts: allForecasts,
      generatedAt: new Date(),
    });
  } catch (error: any) {
    console.error('[Forecast] product forecast error:', error.message);
    res.status(500).json({ error: 'Failed to generate product forecast' });
  }
}

/**
 * GET /api/forecast/explain/:forecastId - forecast explainability details
 */
export async function getForecastExplainHandler(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = getRestaurantId(req);
    const forecastId = req.params.forecastId;
    if (!restaurantId) { res.status(400).json({ error: 'Missing restaurant ID' }); return; }
    if (!forecastId) { res.status(400).json({ error: 'Missing forecast ID' }); return; }

    // In production, would fetch from Forecast collection
    // For now, return a structure based on data sufficiency
    const sufficiency = await assessDataSufficiency({ restaurantId });

    let explanation;
    if (sufficiency.overall === 'INSUFFICIENT_DATA') {
      explanation = {
        whatPredicted: 'Unable to generate forecast',
        why: 'Insufficient historical data available',
        basedOnHistory: 'Minimum 14 days and 50 bills required for basic forecasting',
        confidence: 'Low',
        whatCouldChange: 'Collect more sales data before generating predictions',
      };
    } else {
      explanation = {
        whatPredicted: 'Demand forecast based on historical patterns',
        why: 'Statistical baseline using comparable periods, day-of-week, and time-of-day patterns',
        basedOnHistory: `Data sufficiency: ${sufficiency.overall}. ${
          sufficiency.dataSummary.daysOfSalesHistory > 0
            ? ` ${sufficiency.dataSummary.daysOfSalesHistory} days of sales history available`
            : ''
        }${sufficiency.dataSummary.totalBills > 0 ? `, ${sufficiency.dataSummary.totalBills} bills recorded` : ''}`,
        confidence: sufficiency.overall,
        whatCouldChange: 'Weather events, special festivals, promotional activities, operational changes',
      };
    }

    res.json({
      forecastId,
      restaurantId,
      explanation,
      dataSufficiency: sufficiency.overall,
      generatedAt: new Date(),
    });
  } catch (error: any) {
    console.error('[Forecast] explain error:', error.message);
    res.status(500).json({ error: 'Failed to fetch forecast explainability' });
  }
}

/**
 * Helper: Generate category forecasts
 */
async function generateCategoryForecasts(
  restaurantId: string,
  branchId: string | undefined,
  category: string,
  period: ForecastPeriod
): Promise<any[]> {
  const productIds = await mongoose.model('Product').find({
    restaurantId: objectId(restaurantId),
    category,
    isDeleted: { $ne: true },
  }).select('_id name').lean().exec();

  const forecasts: any[] = [];
  for (const product of productIds) {
    const forecast = await generateDemandForecast({
      restaurantId,
      branchId,
      entity: { type: 'product' as const, id: String(product._id), name: product.name },
      period,
      lookbackDays: 365,
      includeSeasonality: true,
      includeFestivalEffects: true,
    });
    forecasts.push({
      productId: String(product._id),
      productName: product.name,
      ...forecast,
    });
  }
  return forecasts;
}

export default {
  getRestaurantForecastHandler,
  getCategoryForecastHandler,
  getProductForecastHandler,
  getForecastExplainHandler,
};
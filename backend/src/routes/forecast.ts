/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Forecast API Routes — Demand forecasting endpoints for restaurant intelligence.
 * All routes require authentication. Restaurant isolation enforced by
 * controllers using req.user.restaurantId. Branch scope optional.
 */

import { Router } from 'express';
import {
  getRestaurantForecastHandler,
  getCategoryForecastHandler,
  getProductForecastHandler,
  getForecastExplainHandler,
} from '../controllers/forecastController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// All routes require authentication (handled by middleware)
// Restaurant isolation enforced by controllers using req.user.restaurantId
// BranchId is optional and scoped per-restaurant

// Restaurant-level forecast (next 7 days, daily slots)
router.get('/restaurant', requireAuth, getRestaurantForecastHandler);

// Category forecast
router.get('/category/:categoryId', requireAuth, getCategoryForecastHandler);

// Product forecast
router.get('/product/:productId', requireAuth, getProductForecastHandler);

// Forecast explainability details
router.get('/explain/:forecastId', requireAuth, getForecastExplainHandler);

export default router;
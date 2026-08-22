/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inventory Demand API routes — ingredient consumption predictions and
 * stockout risk assessment. All routes require authentication.
 * Restaurant isolation enforced by controllers using req.user.restaurantId.
 */

import { Router } from 'express';
import {
  predictIngredientConsumptionHandler,
  getStockoutRisksHandler,
  getReorderSuggestionsHandler,
} from '../controllers/inventoryDemandController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// All routes require authentication
// Restaurant isolation enforced by controllers using req.user.restaurantId

// Predict ingredient consumption for next 7 days based on forecasts
router.post('/predict', requireAuth, predictIngredientConsumptionHandler);

// Get active stockout risks (MEDIUM and above) for this restaurant
router.get('/stockout-risks', requireAuth, getStockoutRisksHandler);

// Get reorder suggestions - ingredients needing replenishment
router.get('/reorder-suggestions', requireAuth, getReorderSuggestionsHandler);

export default router;
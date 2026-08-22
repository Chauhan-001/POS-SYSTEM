/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scenario API routes — Promotion scenario comparison and optimization.
 * All routes require authentication. Restaurant isolation enforced by
 * controllers using req.user.restaurantId.
 */

import { Router } from 'express';
import {
  compareScenariosHandler,
  getOptimalScenarioHandler,
  getElasticityHandler,
} from '../controllers/scenarioController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// All routes require authentication
// Restaurant isolation enforced by controllers using req.user.restaurantId

// Compare custom scenarios (Current vs Promo A vs Promo B vs Combo vs No Promo)
router.post('/compare', requireAuth, compareScenariosHandler);

// Get optimal scenario for a product and objective
router.get('/optimal/:productId', requireAuth, getOptimalScenarioHandler);

// Get promotion elasticity curve for a product
router.get('/elasticity/:productId', requireAuth, getElasticityHandler);

export default router;
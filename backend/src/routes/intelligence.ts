/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Intelligence Routes — REST API endpoints for Restaurant Intelligence Layer
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import {
  recordOutcomeHandler,
  getLearningSummaryHandler,
  recordOwnerFeedbackHandler,
  checkStrategySuppressionHandler,
  getStrategyPreferencesHandler,
  runLearningCycleHandler,
  getExperimentDesignHandler,
  validateExperimentHandler,
} from '../controllers/intelligenceController';

const router = Router();

// SECURITY: every intelligence route requires a valid POS JWT. Controllers
// derive restaurantId from req.user.restaurantId (never client input), so the
// token check here is what actually isolates tenants — without it these
// endpoints were publicly reachable and only failed closed inside each
// controller (400 'Missing restaurant ID'). RequireAuth also re-tags the 401
// correctly instead of leaking a validation-style 400 to anonymous callers.

// Phase 5: Closed-Loop Learning & Promotion Experiments
router.post('/recommendations/:id/outcome', requireAuth, recordOutcomeHandler);
router.get('/learning/summary', requireAuth, getLearningSummaryHandler);
router.post('/recommendations/:id/feedback', requireAuth, recordOwnerFeedbackHandler);
router.post('/strategies/suppress', requireAuth, checkStrategySuppressionHandler);
router.get('/strategies/preferences', requireAuth, getStrategyPreferencesHandler);
router.post('/learning/cycle', requireRole('owner', 'manager', 'super_admin'), runLearningCycleHandler);
router.post('/experiments/design', requireAuth, getExperimentDesignHandler);
router.post('/experiments/validate', requireAuth, validateExperimentHandler);

export default router;

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Intelligence Routes — REST API endpoints for Restaurant Intelligence Layer
 */

import { Router } from 'express';
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

// All routes require authentication (handled by middleware)
// Restaurant isolation enforced by controllers using req.user.restaurantId

// Phase 5: Closed-Loop Learning & Promotion Experiments
router.post('/recommendations/:id/outcome', recordOutcomeHandler);
router.get('/learning/summary', getLearningSummaryHandler);
router.post('/recommendations/:id/feedback', recordOwnerFeedbackHandler);
router.post('/strategies/suppress', checkStrategySuppressionHandler);
router.get('/strategies/preferences', getStrategyPreferencesHandler);
router.post('/learning/cycle', runLearningCycleHandler);
router.post('/experiments/design', getExperimentDesignHandler);
router.post('/experiments/validate', validateExperimentHandler);

export default router;

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Advisor API Routes — Business Advisor endpoints. All routes require
 * authentication. Generation is a heavier analysis so it is not cached at the
 * HTTP layer (the AI explanation inside is already cached per tenant).
 */

import { Router } from 'express';
import { recommend, recordAction, recordOutcome, history, markConverted } from '../controllers/advisorController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';

const router = Router();

// All staff with offers access can ask the advisor (read-only analysis).
router.post('/advisor/recommend', requireAuth, recommend);

// Outcome tracking — only owners/managers record decisions.
router.post('/advisor/:id/action', requireAuth, requireRole('owner', 'manager'), recordAction);
router.post('/advisor/:id/outcome', requireAuth, requireRole('owner', 'manager'), recordOutcome);
router.get('/advisor/history', requireAuth, history);
router.post('/advisor/:id/converted', requireAuth, requireRole('owner', 'manager'), markConverted);

export default router;

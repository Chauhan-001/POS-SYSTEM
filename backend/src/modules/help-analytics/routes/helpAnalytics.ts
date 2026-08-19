/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * helpAnalytics.ts — routes for help-content usage analytics.
 *
 * Mounted at /api/help-analytics.
 *  - POST /events — record a FAQ/legal view or FAQ search (any authenticated
 *    staff member). Fire-and-forget from the POS.
 *  - GET  /stats  — per-content counts for the restaurant (Owner/Manager).
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../../../middleware/authMiddleware';
import { recordHelpEvent, getHelpStats } from '../controllers/helpAnalyticsController';

const router = Router();

router.post('/events', requireAuth, recordHelpEvent);
router.get('/stats', requireRole('Owner', 'Manager'), getHelpStats);

export default router;

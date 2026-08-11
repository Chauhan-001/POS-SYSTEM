/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * automations.ts — Marketing automation recipe routes (Phase 19).
 *
 * Path: /api/automations
 * Access: list (all staff), update/delete (Owner/Manager).
 */

import { Router } from 'express';
import { getAutomations, patchAutomation, removeAutomation } from '../controllers/automationController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { updateAutomationSchema, automationParamsSchema } from '../validation/automation';

const router = Router();

router.get('/', requireAuth, requireFeature('loyalty'), getAutomations);
router.patch('/:id', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: updateAutomationSchema, params: automationParamsSchema }), patchAutomation);
router.delete('/:id', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ params: automationParamsSchema }), removeAutomation);

export default router;

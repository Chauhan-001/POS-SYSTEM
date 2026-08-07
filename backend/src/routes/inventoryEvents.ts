/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inventory Events API routes — inventory activity feed (sold/adjusted/waste/closing).
 * Access: All staff can view (only if plan includes inventory).
 * Path:   /api/inventory-events
 */

import { Router } from 'express';
import { createInventoryEvent, listInventoryEvents } from '../controllers/inventoryEventsController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { createInventoryEventSchema, inventoryEventQuerySchema } from '../validation';

const router = Router();

// All staff can view; only Owner/Manager can record activity events.
router.get('/', requireAuth, requireFeature('inventory'), validate({ query: inventoryEventQuerySchema }), listInventoryEvents);
router.post('/', requireRole('Owner', 'Manager'), requireFeature('inventory'), validate({ body: createInventoryEventSchema }), createInventoryEvent);

export default router;

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Availability API routes — online menu availability management.
 * Roles: Owner / Manager / Inventory may view and toggle availability
 * (the cashier keeps their operational-only access).
 */

import { Router } from 'express';
import { listAvailability, updateAvailability, availabilityHistory } from '../controllers/availabilityController';
import { requireRole } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import {
  availabilityBulkSchema,
  availabilityQuerySchema,
  availabilityHistoryQuerySchema,
} from '../validation';

const router = Router();

// Owner, Manager and Inventory can view + toggle online availability.
router.get('/', requireRole('Owner', 'Manager', 'Inventory'), validate({ query: availabilityQuerySchema }), listAvailability);
router.put('/bulk', requireRole('Owner', 'Manager', 'Inventory'), validate({ body: availabilityBulkSchema }), updateAvailability);
router.get('/history', requireRole('Owner', 'Manager', 'Inventory'), validate({ query: availabilityHistoryQuerySchema }), availabilityHistory);

export default router;

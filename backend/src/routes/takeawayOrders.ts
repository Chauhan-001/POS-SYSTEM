/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Takeaway Orders API routes — delegates to takeawayOrdersController.
 */

import { Router } from 'express';
import {
  listTakeawayOrders,
  getTakeawayOrder,
  createTakeawayOrder,
  updateTakeawayOrder,
  deleteTakeawayOrder,
  getNextOrderNumber,
} from '../controllers/takeawayOrdersController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { createTakeawayOrderSchema, updateTakeawayOrderSchema, takeawayOrderQuerySchema, takeawayOrderParamsSchema, takeawayNextNumberQuerySchema } from '../validation';

const router = Router();

// All staff can view and manage takeaway orders
router.get('/next-number', requireAuth, validate({ query: takeawayNextNumberQuerySchema }), getNextOrderNumber);
router.get('/', requireAuth, validate({ query: takeawayOrderQuerySchema }), listTakeawayOrders);
router.get('/:id', requireAuth, validate({ params: takeawayOrderParamsSchema }), getTakeawayOrder);
router.post('/', requireAuth, validate({ body: createTakeawayOrderSchema }), createTakeawayOrder);
router.put('/:id', requireAuth, validate({ body: updateTakeawayOrderSchema, params: takeawayOrderParamsSchema }), updateTakeawayOrder);

// Only Owner and Manager can delete takeaway orders
router.delete('/:id', requireRole('Owner', 'Manager'), validate({ params: takeawayOrderParamsSchema }), deleteTakeawayOrder);

export default router;

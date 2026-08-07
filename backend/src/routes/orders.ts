/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Orders API routes — delegates to ordersController.
 */

import { Router } from 'express';
import {
  listOrders,
  getOrder,
  createOrder,
  updateOrder,
  deleteOrder,
} from '../controllers/ordersController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { createOrderSchema, updateOrderSchema, orderQuerySchema, orderParamsSchema } from '../validation';

const router = Router();

// All staff can manage orders
router.get('/', requireAuth, validate({ query: orderQuerySchema }), listOrders);
router.get('/:id', requireAuth, validate({ params: orderParamsSchema }), getOrder);
router.post('/', requireAuth, validate({ body: createOrderSchema }), createOrder);
router.put('/:id', requireAuth, validate({ body: updateOrderSchema, params: orderParamsSchema }), updateOrder);

// Only Owner and Manager can permanently delete orders
router.delete('/:id', requireRole('Owner', 'Manager'), validate({ params: orderParamsSchema }), deleteOrder);

export default router;

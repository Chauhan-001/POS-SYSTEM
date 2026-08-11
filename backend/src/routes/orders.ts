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
  getNextOrderNumber,
  adjustOrder,
  listOrderAdjustments,
  listOrderRefunds,
} from '../controllers/ordersController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import {
  createOrderSchema,
  updateOrderSchema,
  orderQuerySchema,
  orderParamsSchema,
  nextNumberQuerySchema,
  adjustOrderSchema,
} from '../validation';

const router = Router();

// All staff can manage orders
router.get('/', requireAuth, validate({ query: orderQuerySchema }), listOrders);

// Get next order number (atomic counter) — MUST be before /:id to avoid route conflict
router.get('/next-number', requireAuth, validate({ query: nextNumberQuerySchema }), getNextOrderNumber);

router.get('/:id', requireAuth, validate({ params: orderParamsSchema }), getOrder);
router.post('/', requireAuth, validate({ body: createOrderSchema }), createOrder);
router.put('/:id', requireAuth, validate({ body: updateOrderSchema, params: orderParamsSchema }), updateOrder);

// Only Owner and Manager can permanently delete orders
router.delete('/:id', requireRole('Owner', 'Manager'), validate({ params: orderParamsSchema }), deleteOrder);

// ─── Unavailable-item adjustment workflow ─────────────────────
// POST /:id/adjust — remove/replace/cancel with server-derived refunds.
router.post('/:id/adjust', requireAuth, validate({ params: orderParamsSchema, body: adjustOrderSchema }), adjustOrder);

// Adjustment + refund history for an order.
router.get('/:id/adjustments', requireAuth, validate({ params: orderParamsSchema }), listOrderAdjustments);
router.get('/:id/refunds', requireAuth, validate({ params: orderParamsSchema }), listOrderRefunds);

export default router;

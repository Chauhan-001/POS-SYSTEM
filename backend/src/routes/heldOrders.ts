/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Held Orders API routes — delegates to heldOrdersController.
 */

import { Router } from 'express';
import {
  listHeldOrders,
  getHeldOrder,
  createHeldOrder,
  updateHeldOrder,
  deleteHeldOrder,
} from '../controllers/heldOrdersController';
import { requireAuth } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { createHeldOrderSchema, updateHeldOrderSchema, heldOrderQuerySchema, heldOrderParamsSchema } from '../validation';

const router = Router();

// All staff can view and manage held (suspended) orders
router.get('/', requireAuth, validate({ query: heldOrderQuerySchema }), listHeldOrders);
router.get('/:id', requireAuth, validate({ params: heldOrderParamsSchema }), getHeldOrder);
router.post('/', requireAuth, validate({ body: createHeldOrderSchema }), createHeldOrder);
router.put('/:id', requireAuth, validate({ body: updateHeldOrderSchema, params: heldOrderParamsSchema }), updateHeldOrder);
router.delete('/:id', requireAuth, validate({ params: heldOrderParamsSchema }), deleteHeldOrder);

export default router;

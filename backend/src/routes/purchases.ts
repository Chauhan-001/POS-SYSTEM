/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Purchases API routes — inventory purchase history.
 * Access: All staff can view; Owner/Manager can record.
 * Path:   /api/purchases
 */

import { Router } from 'express';
import {
  listPurchases,
  createPurchase,
  updatePurchase,
  deletePurchase,
  supplierSummary,
} from '../controllers/purchasesController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import {
  createPurchaseSchema,
  updatePurchaseSchema,
  purchaseQuerySchema,
  purchaseParamsSchema,
} from '../validation';

const router = Router();

// All staff can view purchase history (only if plan includes inventory)
router.get('/', requireAuth, requireFeature('inventory'), validate({ query: purchaseQuerySchema }), listPurchases);
router.get('/suppliers', requireAuth, requireFeature('inventory'), supplierSummary);

// Only Owner and Manager can record, correct or remove purchases
router.post('/', requireRole('Owner', 'Manager'), requireFeature('inventory'), validate({ body: createPurchaseSchema }), createPurchase);
router.patch('/:id', requireRole('Owner', 'Manager'), requireFeature('inventory'), validate({ params: purchaseParamsSchema, body: updatePurchaseSchema }), updatePurchase);
router.delete('/:id', requireRole('Owner', 'Manager'), requireFeature('inventory'), validate({ params: purchaseParamsSchema }), deletePurchase);

export default router;

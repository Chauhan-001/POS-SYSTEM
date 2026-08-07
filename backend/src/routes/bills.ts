/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bills API routes — delegates to billsController.
 */

import { Router } from 'express';
import {
  listBills,
  getBill,
  createBill,
  deleteBill,
  refundBill,
  getNextInvoice,
} from '../controllers/billsController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireSubscription } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { createBillSchema, billQuerySchema, billParamsSchema, voidBillSchema, refundBillSchema } from '../validation';

const router = Router();

// All staff can view and create bills (suspended subscription blocks billing)
router.get('/', requireAuth, requireSubscription, validate({ query: billQuerySchema }), listBills);

// Get next invoice number (atomic counter) — MUST be before /:id to avoid route conflict
router.get('/next-invoice', requireAuth, requireSubscription, getNextInvoice);

router.get('/:id', requireAuth, requireSubscription, validate({ params: billParamsSchema }), getBill);
router.post('/', requireAuth, requireSubscription, validate({ body: createBillSchema }), createBill);

// Only Owner and Manager can void bills
router.delete('/:id', requireRole('Owner', 'Manager'), requireSubscription, validate({ body: voidBillSchema, params: billParamsSchema }), deleteBill);

// Refund a bill (full or partial) — Owner/Manager only, manager PIN required
router.post('/:id/refund', requireRole('Owner', 'Manager'), requireSubscription, validate({ body: refundBillSchema, params: billParamsSchema }), refundBill);

export default router;

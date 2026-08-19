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
  getNextInvoice,
  reserveInvoiceRange,
  getBillItems,
} from '../controllers/billsController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireSubscription } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { createBillSchema, billQuerySchema, billParamsSchema, voidBillSchema } from '../validation';

const router = Router();

// All staff can view and create bills (suspended subscription blocks billing)
router.get('/', requireAuth, requireSubscription, validate({ query: billQuerySchema }), listBills);

// Get next invoice number (atomic counter) — MUST be before /:id to avoid route conflict
router.get('/next-invoice', requireAuth, requireSubscription, getNextInvoice);

// Reserve a contiguous invoice-number range for a terminal (offline billing)
// — MUST be before /:id to avoid route conflict
router.get('/invoice-range', requireAuth, requireSubscription, reserveInvoiceRange);

router.get('/:id', requireAuth, requireSubscription, validate({ params: billParamsSchema }), getBill);
router.post('/', requireAuth, requireSubscription, validate({ body: createBillSchema }), createBill);

// Batch-fetch line items for multiple bills (dashboard data integrity fallback)
router.post('/items-batch', requireAuth, requireSubscription, getBillItems);

// Only Owner and Manager can void bills
router.delete('/:id', requireRole('Owner', 'Manager'), requireSubscription, validate({ body: voidBillSchema, params: billParamsSchema }), deleteBill);

export default router;

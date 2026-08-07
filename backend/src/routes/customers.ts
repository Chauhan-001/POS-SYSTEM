/**
 * =============================================================================
 *  customers.ts — Customers API Routes (Phase 1.6)
 * =============================================================================
 *
 * Routes: Full customer management — paginated search, profile, merge,
 *         import/export, timeline, block/unblock, loyalty ledger.
 * Access: All staff (create/read/update), Owner/Manager (delete/merge/import)
 * Path:   /api/customers
 * Multi-tenant: all handlers scope by req.user.restaurantId.
 */

import { Router } from 'express';
import {
  listCustomers,
  getCustomer,
  getCustomerProfile,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  restoreCustomer,
  mergeCustomers,
  importCustomers,
  exportCustomers,
  getCustomerTimeline,
  blockCustomer,
  getCustomerTransactions,
  generateReferralCode,
} from '../controllers/customersController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import {
  createCustomerSchema, updateCustomerSchema, customerQuerySchema, customerParamsSchema,
  customerMergeSchema, customerImportSchema, customerBlockSchema,
} from '../validation';

const router = Router();

// ─── Read (all staff) ─────────────────────────────────────────
router.get('/', requireAuth, requireFeature('loyalty'), validate({ query: customerQuerySchema }), listCustomers);
router.get('/export', requireAuth, requireFeature('loyalty'), exportCustomers);
router.get('/:id', requireAuth, requireFeature('loyalty'), validate({ params: customerParamsSchema }), getCustomer);
router.get('/:id/profile', requireAuth, requireFeature('loyalty'), validate({ params: customerParamsSchema }), getCustomerProfile);
router.get('/:id/timeline', requireAuth, requireFeature('loyalty'), validate({ params: customerParamsSchema }), getCustomerTimeline);
router.get('/:id/transactions', requireAuth, requireFeature('loyalty'), validate({ params: customerParamsSchema }), getCustomerTransactions);

// ─── Write (all staff for create/update/block) ────────────────
router.post('/', requireAuth, requireFeature('loyalty'), validate({ body: createCustomerSchema }), createCustomer);
router.put('/:id', requireAuth, requireFeature('loyalty'), validate({ body: updateCustomerSchema, params: customerParamsSchema }), updateCustomer);
router.post('/:id/block', requireAuth, requireFeature('loyalty'), validate({ body: customerBlockSchema, params: customerParamsSchema }), blockCustomer);
router.post('/:id/referral-code', requireAuth, requireFeature('loyalty'), validate({ params: customerParamsSchema }), generateReferralCode);

// ─── Admin / destructive (Owner & Manager only) ───────────────
router.delete('/:id', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ params: customerParamsSchema }), deleteCustomer);
router.post('/:id/restore', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ params: customerParamsSchema }), restoreCustomer);
router.post('/merge', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: customerMergeSchema }), mergeCustomers);
router.post('/import', requireRole('Owner', 'Manager'), requireFeature('loyalty'), validate({ body: customerImportSchema }), importCustomers);

export default router;

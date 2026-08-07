/**
 * =============================================================================
 *  vendors.ts — Vendor API Routes (Phase 1.7)
 * =============================================================================
 *
 * Routes: CRUD + summary for finance vendors.
 * Access: All staff (view), Owner/Manager (manage).
 * Path:   /api/vendors
 */

import { Router } from 'express';
import {
  listVendors, getVendor, createVendor, updateVendor, deleteVendor, vendorSummary,
} from '../controllers/vendorController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { createVendorSchema, updateVendorSchema, vendorQuerySchema, vendorParamsSchema } from '../validation';

const router = Router();

router.get('/', requireAuth, requireFeature('expense_tracking'), validate({ query: vendorQuerySchema }), listVendors);
router.get('/:id', requireAuth, requireFeature('expense_tracking'), validate({ params: vendorParamsSchema }), getVendor);
router.get('/:id/summary', requireAuth, requireFeature('expense_tracking'), validate({ params: vendorParamsSchema }), vendorSummary);
router.post('/', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: createVendorSchema }), createVendor);
router.put('/:id', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ body: updateVendorSchema, params: vendorParamsSchema }), updateVendor);
router.delete('/:id', requireRole('Owner', 'Manager'), requireFeature('expense_tracking'), validate({ params: vendorParamsSchema }), deleteVendor);

export default router;

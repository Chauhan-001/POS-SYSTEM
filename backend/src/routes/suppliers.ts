/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Suppliers API routes — vendor management for inventory.
 * Access: All staff can view; Owner/Manager can write.
 * Path:   /api/suppliers
 */

import { Router } from 'express';
import {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from '../controllers/suppliersController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { createSupplierSchema, updateSupplierSchema, supplierQuerySchema, supplierParamsSchema } from '../validation';

const router = Router();

// All staff can view suppliers (only if plan includes inventory)
router.get('/', requireAuth, requireFeature('inventory'), validate({ query: supplierQuerySchema }), listSuppliers);
router.get('/:id', requireAuth, requireFeature('inventory'), validate({ params: supplierParamsSchema }), getSupplier);

// Only Owner and Manager can create, edit or remove suppliers
router.post('/', requireRole('Owner', 'Manager'), requireFeature('inventory'), validate({ body: createSupplierSchema }), createSupplier);
router.put('/:id', requireRole('Owner', 'Manager'), requireFeature('inventory'), validate({ params: supplierParamsSchema, body: updateSupplierSchema }), updateSupplier);
router.delete('/:id', requireRole('Owner', 'Manager'), requireFeature('inventory'), validate({ params: supplierParamsSchema }), deleteSupplier);

export default router;

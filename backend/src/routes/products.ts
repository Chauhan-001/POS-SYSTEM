/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Products API routes — delegates to productsController.
 */

import { Router } from 'express';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustProductStock,
  resolveProductQuery,
  productPriceIntelligence,
} from '../controllers/productsController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import { createProductSchema, updateProductSchema, productQuerySchema, productParamsSchema, adjustStockSchema } from '../validation';

const router = Router();

// All staff can view products (menu)
router.get('/', requireAuth, validate({ query: productQuerySchema }), listProducts);

// Phase 10 — read-only price intelligence advisory (never mutates prices).
// Registered BEFORE '/:id' so 'price-intelligence' is never captured as an id.
router.get('/price-intelligence', requireAuth, productPriceIntelligence);

// Phase 11 — product resolution for POS typed search / SKU / barcode.
// POST verb, so no conflict with the GET '/:id' route.
router.post('/resolve', requireAuth, resolveProductQuery);

router.get('/:id', requireAuth, validate({ params: productParamsSchema }), getProduct);

// Only Owner and Manager can modify the menu
router.post('/', requireRole('Owner', 'Manager'), validate({ body: createProductSchema }), createProduct);
router.put('/:id', requireRole('Owner', 'Manager'), validate({ body: updateProductSchema, params: productParamsSchema }), updateProduct);
router.delete('/:id', requireRole('Owner', 'Manager'), validate({ params: productParamsSchema }), deleteProduct);

// Stock adjustment (manual / waste) — Owner, Manager and Inventory roles;
// only when the plan includes inventory.
router.post('/:id/stock', requireRole('Owner', 'Manager', 'Inventory'), requireFeature('inventory'), validate({ body: adjustStockSchema, params: productParamsSchema }), adjustProductStock);

export default router;

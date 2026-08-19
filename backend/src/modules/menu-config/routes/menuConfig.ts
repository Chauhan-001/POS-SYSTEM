/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * menuConfig.ts — Reusable Menu Configuration Module Routes (Phase 1).
 *
 * Paths:
 *   /api/menu-config/templates/*             — reusable template CRUD/lifecycle
 *   /api/menu-config/products/:productId/*   — product ↔ template relationships
 *   /api/menu-config/validate                — selection validation
 *
 * Access:
 *   - Reads (list/get/usage/resolve) : any authenticated staff
 *   - Writes (create/update/archive/copy, attach/update/detach/reset) :
 *     Owner / Manager
 *
 * Tenant is ALWAYS derived from the authenticated user — the client never
 * supplies a restaurantId. Every handler is tenant-scoped server-side.
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../../../middleware/authMiddleware';
import { validate } from '../../../middleware/validate';
import * as c from '../controllers/menuConfigController';
import {
  createTemplateSchema,
  updateTemplateSchema,
  templateQuerySchema,
  templateParamsSchema,
  copyTemplateSchema,
  attachConfigSchema,
  updateConfigRefSchema,
  productParamsSchema,
  productRefParamsSchema,
  validateSelectionSchema,
  productSummarySchema,
} from '../validators/menuConfig';

const router = Router();
const writeRole = requireRole('Owner', 'Manager');

// ─── Templates ────────────────────────────────────────────────────
router.get('/templates', requireAuth, validate({ query: templateQuerySchema }), c.listTemplates);
router.post('/templates', requireAuth, writeRole, validate({ body: createTemplateSchema }), c.createTemplate);
router.get('/templates/:id', requireAuth, validate({ params: templateParamsSchema }), c.getTemplate);
router.put('/templates/:id', requireAuth, writeRole, validate({ params: templateParamsSchema, body: updateTemplateSchema }), c.updateTemplate);
router.post('/templates/:id/archive', requireAuth, writeRole, validate({ params: templateParamsSchema }), c.archiveTemplate);
router.post('/templates/:id/copy', requireAuth, writeRole, validate({ params: templateParamsSchema, body: copyTemplateSchema }), c.copyTemplate);
router.get('/templates/:id/usage', requireAuth, validate({ params: templateParamsSchema }), c.templateUsage);

// ─── Product configuration relationship ───────────────────────────
router.post('/products/:productId/configurations', requireAuth, writeRole, validate({ params: productParamsSchema, body: attachConfigSchema }), c.attachConfiguration);
router.put('/products/:productId/configurations/:refId', requireAuth, writeRole, validate({ params: productRefParamsSchema, body: updateConfigRefSchema }), c.updateConfiguration);
router.delete('/products/:productId/configurations/:refId', requireAuth, writeRole, validate({ params: productRefParamsSchema }), c.detachConfiguration);
router.post('/products/:productId/configurations/:refId/reset-overrides', requireAuth, writeRole, validate({ params: productRefParamsSchema }), c.resetOverrides);

// ─── Resolution + selection validation ────────────────────────────
router.get('/products/:productId/resolve', requireAuth, validate({ params: productParamsSchema }), c.resolveProduct);
router.post('/products/summary', requireAuth, validate({ body: productSummarySchema }), c.summarizeProducts);
router.post('/validate', requireAuth, validate({ body: validateSelectionSchema }), c.validateSelection);

// ─── Offline catalog snapshot (Phase 3) ────────────────────────────
router.get('/catalog', requireAuth, c.getCatalog);

export default router;

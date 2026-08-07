/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * settings.ts — Centralized POS Settings + Printer API routes (Phase 1.9).
 *
 * Access model:
 *  - Effective settings read: any authenticated user (needed by every terminal).
 *  - Write / rollback / history / audit: Owner or Manager.
 *  - Printer management: Owner or Manager (test read for all staff).
 * Multi-tenant isolation is enforced in the services via req.user.restaurantId.
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../../../middleware/authMiddleware';
import { validate } from '../../../middleware/validate';
import { settingsController } from '../controllers/settingsController';
import { printerController } from '../controllers/printerController';
import {
  settingsQuerySchema,
  patchSettingsSchema,
  historyQuerySchema,
  rollbackSchema,
  auditQuerySchema,
  createPrinterSchema,
  updatePrinterSchema,
  printerParamsSchema,
  printerListQuerySchema,
} from '../validators/settingsSchema';

const router = Router();

// ─── Settings ──────────────────────────────────────────────────
router.get('/', requireAuth, validate({ query: settingsQuerySchema }), settingsController.getEffective);
router.patch('/', requireRole('Owner', 'Manager'), validate({ body: patchSettingsSchema }), settingsController.patch);
router.get('/history', requireRole('Owner', 'Manager'), validate({ query: historyQuerySchema }), settingsController.listHistory);
router.post('/rollback', requireRole('Owner', 'Manager'), validate({ body: rollbackSchema }), settingsController.rollback);
router.get('/audit', requireRole('Owner', 'Manager'), validate({ query: auditQuerySchema }), settingsController.listAudit);
router.get('/health', requireAuth, settingsController.health);

// ─── Printers ──────────────────────────────────────────────────
router.get('/printers', requireAuth, validate({ query: printerListQuerySchema }), printerController.list);
router.post('/printers', requireRole('Owner', 'Manager'), validate({ body: createPrinterSchema }), printerController.create);
router.patch('/printers/:id', requireRole('Owner', 'Manager'), validate({ params: printerParamsSchema, body: updatePrinterSchema }), printerController.update);
router.delete('/printers/:id', requireRole('Owner', 'Manager'), validate({ params: printerParamsSchema }), printerController.remove);
router.post('/printers/:id/test', requireAuth, validate({ params: printerParamsSchema }), printerController.test);

export default router;

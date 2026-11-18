/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shift API routes — Cash drawer shift lifecycle (Phase 2).
 *
 * Routes:
 *   POST   /api/shifts/open         — Open a shift
 *   POST   /api/shifts/close        — Close a shift
 *   GET    /api/shifts              — List shifts (tenant-scoped)
 *   GET    /api/shifts/:id          — Get a single shift
 *   GET    /api/shifts/open         — Get current open shift for a register
 *
 * Path: /api/shifts
 */

import { Router } from 'express';
import {
  openShift, closeShift, listShifts, getShift, getOpenShift,
} from '../controllers/shiftController';
import { requireAuth } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import {
  shiftOpenSchema, shiftCloseSchema, shiftQuerySchema, shiftParamsSchema,
} from '../validation';

const router = Router();

router.post('/open', requireAuth, validate({ body: shiftOpenSchema }), openShift);
router.post('/close', requireAuth, validate({ body: shiftCloseSchema }), closeShift);
router.get('/', requireAuth, validate({ query: shiftQuerySchema }), listShifts);
router.get('/:id', requireAuth, validate({ params: shiftParamsSchema }), getShift);
router.get('/open', requireAuth, getOpenShift);

export default router;

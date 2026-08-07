/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Floors API routes — delegates to floorsController.
 */

import { Router } from 'express';
import {
  listFloors, getFloor, createFloor, updateFloor, deleteFloor,
} from '../controllers/floorsController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import {
  createFloorSchema, updateFloorSchema, floorQuerySchema, floorParamsSchema,
} from '../validation';

const router = Router();

// All staff can view floors
router.get('/', requireAuth, validate({ query: floorQuerySchema }), listFloors);
router.get('/:id', requireAuth, validate({ params: floorParamsSchema }), getFloor);

// Only Owner and Manager can modify floors
router.post('/', requireRole('Owner', 'Manager'), validate({ body: createFloorSchema }), createFloor);
router.put('/:id', requireRole('Owner', 'Manager'), validate({ body: updateFloorSchema, params: floorParamsSchema }), updateFloor);
router.delete('/:id', requireRole('Owner'), validate({ params: floorParamsSchema }), deleteFloor);

export default router;

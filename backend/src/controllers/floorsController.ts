/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Floors Controller — CRUD for restaurant floor layouts.
 */

import { Request, Response } from 'express';
import { floorService } from '../services';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

function authCtx(req: Request) {
  const user = (req as AuthenticatedRequest).user;
  return {
    restaurantId: user?.restaurantId,
    branchId: (req.query as any).branchId || undefined,
    operator: user?.name || 'System',
    operatorId: user?.employeeId || user?.userId,
  };
}

/** GET /api/floors — List floors (branch scoped). */
export async function listFloors(req: Request, res: Response): Promise<void> {
  try {
    const { branchId, active } = req.query;
    const result = await floorService.list(
      { branchId: branchId as string, active: active === 'true' },
      authCtx(req)
    );
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[FloorsController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/floors/:id — Get a single floor. */
export async function getFloor(req: Request, res: Response): Promise<void> {
  try {
    const floor = await floorService.getById(req.params.id);
    if (!floor) { res.status(404).json({ error: 'Floor not found' }); return; }
    res.json({ data: floor });
  } catch (error) {
    console.error('[FloorsController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/floors — Create a floor (Owner/Manager). */
export async function createFloor(req: Request, res: Response): Promise<void> {
  try {
    const floor = await floorService.create(req.body, authCtx(req));
    res.status(201).json({ data: floor });
  } catch (error: any) {
    if (error.statusCode === 409) { res.status(409).json({ error: error.message }); return; }
    console.error('[FloorsController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/floors/:id — Update a floor (Owner/Manager). */
export async function updateFloor(req: Request, res: Response): Promise<void> {
  try {
    const floor = await floorService.update(req.params.id, req.body, authCtx(req));
    if (!floor) { res.status(404).json({ error: 'Floor not found' }); return; }
    res.json({ data: floor });
  } catch (error: any) {
    if (error.statusCode === 409) { res.status(409).json({ error: error.message }); return; }
    console.error('[FloorsController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/floors/:id — Soft-delete a floor (Owner only). */
export async function deleteFloor(req: Request, res: Response): Promise<void> {
  try {
    const deleted = await floorService.delete(req.params.id, authCtx(req));
    if (!deleted) { res.status(404).json({ error: 'Floor not found' }); return; }
    res.json({ success: true });
  } catch (error) {
    console.error('[FloorsController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

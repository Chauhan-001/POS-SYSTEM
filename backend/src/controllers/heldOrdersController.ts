/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HeldOrders Controller — CRUD for suspended-bill snapshots.
 * Delegates business logic to heldOrderService.
 */

import { Request, Response } from 'express';
import { heldOrderService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';

/**
 * GET /api/held-orders — List held orders (scoped to the JWT restaurant)
 * with optional branch filter.
 */
export async function listHeldOrders(req: Request, res: Response): Promise<void> {
  try {
    const { branchId } = req.query;
    const restaurantId = (req as AuthenticatedRequest).user?.restaurantId;
    const result = await heldOrderService.list({ restaurantId, branchId: branchId as string });
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[HeldOrdersController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/held-orders/:id — Get a single held order (tenant-scoped).
 */
export async function getHeldOrder(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = (req as AuthenticatedRequest).user?.restaurantId;
    const order = await heldOrderService.getById(req.params.id, restaurantId);
    if (!order) {
      res.status(404).json({ error: 'Held order not found' });
      return;
    }
    res.json({ data: order });
  } catch (error) {
    console.error('[HeldOrdersController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/held-orders — Create a new held order snapshot. The restaurant is
 * tagged server-side from the authenticated token (never client-supplied).
 */
export async function createHeldOrder(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = (req as AuthenticatedRequest).user?.restaurantId;
    const order = await heldOrderService.create(req.body, restaurantId);
    res.status(201).json({ data: order });
  } catch (error) {
    console.error('[HeldOrdersController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/held-orders/:id — Update a held order (tenant-scoped).
 */
export async function updateHeldOrder(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = (req as AuthenticatedRequest).user?.restaurantId;
    const order = await heldOrderService.update(req.params.id, req.body, restaurantId);
    if (!order) {
      res.status(404).json({ error: 'Held order not found' });
      return;
    }
    res.json({ data: order });
  } catch (error) {
    console.error('[HeldOrdersController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/held-orders/:id — Soft-delete a held order (tenant-scoped).
 */
export async function deleteHeldOrder(req: Request, res: Response): Promise<void> {
  try {
    const restaurantId = (req as AuthenticatedRequest).user?.restaurantId;
    const deleted = await heldOrderService.delete(req.params.id, restaurantId);
    if (!deleted) {
      res.status(404).json({ error: 'Held order not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[HeldOrdersController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

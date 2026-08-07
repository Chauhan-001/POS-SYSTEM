/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HeldOrders Controller — CRUD for suspended-bill snapshots.
 * Delegates business logic to heldOrderService.
 */

import { Request, Response } from 'express';
import { heldOrderService } from '../services';

/**
 * GET /api/held-orders — List held orders with optional branch filter.
 */
export async function listHeldOrders(req: Request, res: Response): Promise<void> {
  try {
    const { branchId } = req.query;
    const result = await heldOrderService.list({ branchId: branchId as string });
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[HeldOrdersController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/held-orders/:id — Get a single held order.
 */
export async function getHeldOrder(req: Request, res: Response): Promise<void> {
  try {
    const order = await heldOrderService.getById(req.params.id);
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
 * POST /api/held-orders — Create a new held order snapshot.
 */
export async function createHeldOrder(req: Request, res: Response): Promise<void> {
  try {
    const order = await heldOrderService.create(req.body);
    res.status(201).json({ data: order });
  } catch (error) {
    console.error('[HeldOrdersController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/held-orders/:id — Update a held order.
 */
export async function updateHeldOrder(req: Request, res: Response): Promise<void> {
  try {
    const order = await heldOrderService.update(req.params.id, req.body);
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
 * DELETE /api/held-orders/:id — Soft-delete a held order.
 */
export async function deleteHeldOrder(req: Request, res: Response): Promise<void> {
  try {
    const deleted = await heldOrderService.delete(req.params.id);
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

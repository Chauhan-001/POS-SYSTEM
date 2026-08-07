/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Orders Controller — delegates to orderService with auth context so table
 * state reconciles with the correct restaurant/branch/operator.
 */

import { Request, Response } from 'express';
import { orderService } from '../services';
import { AuthenticatedRequest } from '../middleware/authMiddleware';

function authCtx(req: Request) {
  const user = (req as AuthenticatedRequest).user;
  return {
    restaurantId: user?.restaurantId,
    branchId: (req.body as any)?.branchId || undefined,
    operator: user?.name || 'System',
    operatorId: user?.employeeId || user?.userId,
  };
}

/** GET /api/orders — List orders with optional filters. */
export async function listOrders(req: Request, res: Response): Promise<void> {
  try {
    const { status, branchId, date, tableId } = req.query;
    const result = await orderService.list({
      status: status as string,
      branchId: branchId as string,
      date: date as string,
      tableId: tableId as string,
    });
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[OrdersController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/orders/:id — Get a single order with items/kots/timeline. */
export async function getOrder(req: Request, res: Response): Promise<void> {
  try {
    const order = await orderService.getById(req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.json({ data: order });
  } catch (error) {
    console.error('[OrdersController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/orders — Create a new order. */
export async function createOrder(req: Request, res: Response): Promise<void> {
  try {
    const order = await orderService.create(req.body, authCtx(req));
    res.status(201).json({ data: order });
  } catch (error) {
    console.error('[OrdersController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/orders/:id — Update order (status, items, etc.). */
export async function updateOrder(req: Request, res: Response): Promise<void> {
  try {
    const order = await orderService.update(req.params.id, req.body, authCtx(req));
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.json({ data: order });
  } catch (error) {
    console.error('[OrdersController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/orders/:id — Soft-delete an order. */
export async function deleteOrder(req: Request, res: Response): Promise<void> {
  try {
    const result = await orderService.delete(req.params.id, authCtx(req));
    if (!result) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[OrdersController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

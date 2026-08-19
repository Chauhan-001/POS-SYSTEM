/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Orders Controller — delegates to orderService with auth context so table
 * state reconciles with the correct restaurant/branch/operator.
 */

import { Request, Response } from 'express';
import { orderService } from '../services';
import { orderAdjustmentService } from '../services/orderAdjustmentService';
import { refundService } from '../services/refundService';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../utils/AppError';

function authCtx(req: Request) {
  const user = (req as AuthenticatedRequest).user;
  return {
    restaurantId: user?.restaurantId,
    branchId: (req.body as any)?.branchId || undefined,
    operator: user?.name || 'System',
    operatorId: user?.employeeId || user?.userId,
  };
}

/** POST /api/orders/:id/adjust — unavailable-item workflow (remove/replace/cancel). */
export async function adjustOrder(req: Request, res: Response): Promise<void> {
  try {
    const result = await orderAdjustmentService.adjust(req.params.id, req.body, authCtx(req));
    res.json({ data: result });
  } catch (error: any) {
    if (error instanceof AppError || error?.statusCode) {
      res.status(error.statusCode || 400).json({ error: error.message });
      return;
    }
    if (error?.code === 11000) {
      // Duplicate adjustmentId — treat as already-processed, safe by design.
      res.status(409).json({ error: 'Adjustment already processed', code: 'DUPLICATE_ADJUSTMENT' });
      return;
    }
    console.error('[OrdersController] adjust error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/orders/:id/adjustments — append-only adjustment history. */
export async function listOrderAdjustments(req: Request, res: Response): Promise<void> {
  try {
    const ctx = authCtx(req);
    const rows = await orderAdjustmentService.listForOrder(req.params.id, { restaurantId: ctx.restaurantId });
    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[OrdersController] list adjustments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/orders/:id/refunds — refund records for an order. */
export async function listOrderRefunds(req: Request, res: Response): Promise<void> {
  try {
    const rows = await refundService.listForOrder(req.params.id);
    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('[OrdersController] list refunds error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/orders/next-number — Get the next atomic order number from server. */
export async function getNextOrderNumber(req: Request, res: Response): Promise<void> {
  try {
    const startingNumber = req.query.startingNumber ? parseInt(req.query.startingNumber as string, 10) : undefined;
    const branchId = (req.query.branchId as string) || undefined;
    const orderNumber = await orderService.getNextOrderNumber(startingNumber, branchId);
    res.json({ orderNumber });
  } catch (error) {
    console.error('[OrdersController] getNextOrderNumber error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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
      // Tenant isolation — never return another restaurant's (or orphaned) orders.
      restaurantId: authCtx(req).restaurantId,
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
    const order = await orderService.getById(req.params.id, authCtx(req).restaurantId);
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
  } catch (error: any) {
    // Known business errors (e.g. the table already has a live order) keep
    // their status/code; unexpected errors stay 500.
    if (error instanceof AppError || error?.statusCode) {
      res.status(error.statusCode || error.status || 400).json({ error: error.message, code: error.code });
      return;
    }
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

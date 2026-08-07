/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TakeawayOrders Controller — CRUD for takeaway order management.
 * Delegates business logic to takeawayOrderService.
 * Also serves as the endpoint for getting the next order number.
 */

import { Request, Response } from 'express';
import { takeawayOrderService } from '../services';

/**
 * GET /api/takeaway-orders — List takeaway orders with optional filters.
 */
export async function listTakeawayOrders(req: Request, res: Response): Promise<void> {
  try {
    const { status, branchId } = req.query;
    const result = await takeawayOrderService.list({
      status: status as string,
      branchId: branchId as string,
    });
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[TakeawayOrdersController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/takeaway-orders/:id — Get a single takeaway order.
 */
export async function getTakeawayOrder(req: Request, res: Response): Promise<void> {
  try {
    const order = await takeawayOrderService.getById(req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Takeaway order not found' });
      return;
    }
    res.json({ data: order });
  } catch (error) {
    console.error('[TakeawayOrdersController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/takeaway-orders — Create a new takeaway order.
 */
export async function createTakeawayOrder(req: Request, res: Response): Promise<void> {
  try {
    const order = await takeawayOrderService.create(req.body);
    res.status(201).json({ data: order });
  } catch (error) {
    console.error('[TakeawayOrdersController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PUT /api/takeaway-orders/:id — Update a takeaway order.
 */
export async function updateTakeawayOrder(req: Request, res: Response): Promise<void> {
  try {
    const order = await takeawayOrderService.update(req.params.id, req.body);
    if (!order) {
      res.status(404).json({ error: 'Takeaway order not found' });
      return;
    }
    res.json({ data: order });
  } catch (error) {
    console.error('[TakeawayOrdersController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/takeaway-orders/:id — Soft-delete a takeaway order.
 */
export async function deleteTakeawayOrder(req: Request, res: Response): Promise<void> {
  try {
    const deleted = await takeawayOrderService.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Takeaway order not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[TakeawayOrdersController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/takeaway-orders/next-number — Get the next order number.
 */
export async function getNextOrderNumber(req: Request, res: Response): Promise<void> {
  try {
    const { branchId } = req.query;
    const nextNumber = await takeawayOrderService.getNextOrderNumber(branchId as string);
    res.json({ data: { nextNumber } });
  } catch (error) {
    console.error('[TakeawayOrdersController] nextNumber error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

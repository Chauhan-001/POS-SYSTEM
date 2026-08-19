/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inventory Events Controller — inventory activity feed (sold/adjusted/waste/closing).
 * Scoped to the authenticated user's restaurant for multi-tenant isolation.
 */

import { Request, Response } from 'express';
import { inventoryEventService } from '../services';
import type { AuthenticatedRequest } from '../middleware/authMiddleware';

/**
 * POST /api/inventory-events — Record a new inventory activity event
 * (waste / adjustment). restaurantId is stamped server-side from the JWT.
 */
export async function createInventoryEvent(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const event = await inventoryEventService.create(req.body, restId);
    res.status(201).json({ data: event });
  } catch (error: any) {
    if (error?.statusCode === 400) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('[InventoryEventsController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/inventory-events — List inventory activity for the caller's restaurant.
 * Supports optional type / date filtering.
 */
export async function listInventoryEvents(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const { type, startDate, endDate, limit } = req.query;
    const result = await inventoryEventService.list({
      restaurantId: restId,
      type: type as string | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ data: result.data, total: result.total });
  } catch (error: any) {
    if (error?.statusCode === 400) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('[InventoryEventsController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/inventory-events/:id — Remove an activity event (undo). */
export async function deleteInventoryEvent(req: Request, res: Response): Promise<void> {
  try {
    const restId = (req as AuthenticatedRequest).user?.restaurantId;
    if (!restId) {
      res.status(403).json({ error: 'Restaurant context required' });
      return;
    }
    const { default: InventoryEvent } = await import('../models/InventoryEvent');
    const event = await InventoryEvent.findOneAndDelete({
      _id: req.params.id,
      restaurantId: restId,
    }).exec();
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    res.json({ success: true, data: event });
  } catch (error: any) {
    console.error('[InventoryEventsController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

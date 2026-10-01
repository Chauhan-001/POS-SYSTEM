/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Calendar Controller — thin HTTP layer over calendarService (Phase 1).
 * Every route sits behind requireAdminAuth (platform admin JWT); the admin
 * may pass a restaurantId filter but tenant identity for restaurant-scoped
 * reads/writes is always validated server-side in the service.
 */

import { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import {
  calendarService,
  CalendarValidationError,
  CalendarNotFoundError,
} from '../services/calendarService';
import type { CreateEventInput, UpdateEventInput, EventQueryInput } from '../validators/calendar';

type AdminRequest = Request & { admin?: { id?: string; sub?: string } };

function adminUserId(req: AdminRequest): string | null {
  const a = (req as unknown as { admin?: { id?: string; sub?: string } }).admin;
  return a?.id ?? a?.sub ?? null;
}

export async function listEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = (req.query || {}) as unknown as EventQueryInput;
    const events = await calendarService.listEvents({
      ...query,
      // Platform admin: may filter to one restaurant, or omit for all.
      tenantRestaurantId: query.restaurantId ?? null,
    });
    res.json({ success: true, events });
  } catch (err) {
    next(err);
  }
}

export async function getEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const event = await calendarService.getEvent((req.params as { id: string }).id);
    res.json({ success: true, event });
  } catch (err) {
    next(err);
  }
}

export async function createEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const event = await calendarService.createEvent(req.body as CreateEventInput, {
      userId: adminUserId(req as AdminRequest),
    });
    res.status(201).json({ success: true, event });
  } catch (err) {
    next(err);
  }
}

export async function updateEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const event = await calendarService.updateEvent(
      (req.params as { id: string }).id,
      req.body as UpdateEventInput,
    );
    res.json({ success: true, event });
  } catch (err) {
    next(err);
  }
}

export async function archiveEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const event = await calendarService.archiveEvent((req.params as { id: string }).id);
    res.json({ success: true, event });
  } catch (err) {
    next(err);
  }
}

export async function restoreEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const event = await calendarService.restoreEvent((req.params as { id: string }).id);
    res.json({ success: true, event });
  } catch (err) {
    next(err);
  }
}

/** Map service errors to honest status codes; everything else → error middleware. */
export function calendarErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof CalendarValidationError) {
    res.status(400).json({ success: false, error: err.message });
    return;
  }
  if (err instanceof CalendarNotFoundError) {
    res.status(404).json({ success: false, error: err.message });
    return;
  }
  next(err);
}

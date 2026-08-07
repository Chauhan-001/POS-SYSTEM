/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reservations Controller — CRUD for table reservations and waitlist.
 * Threads auth context into the service so table state reconciles with the
 * correct restaurant/branch/operator, and exposes the production action
 * surface (seat, no-show, remove-waiting).
 */

import { Request, Response } from 'express';
import { reservationService } from '../services';
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

/** GET /api/reservations — List reservations with optional filters. */
export async function listReservations(req: Request, res: Response): Promise<void> {
  try {
    const { date, status, branchId } = req.query;
    const result = await reservationService.listReservations({
      date: date as string,
      status: status as string,
      branchId: branchId as string,
    }, authCtx(req));
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[ReservationsController] list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/reservations/:id — Get a single reservation. */
export async function getReservation(req: Request, res: Response): Promise<void> {
  try {
    const reservation = await reservationService.getReservation(req.params.id);
    if (!reservation) {
      res.status(404).json({ error: 'Reservation not found' });
      return;
    }
    res.json({ data: reservation });
  } catch (error) {
    console.error('[ReservationsController] get error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/reservations — Create a new reservation. */
export async function createReservation(req: Request, res: Response): Promise<void> {
  try {
    const reservation = await reservationService.createReservation(req.body, authCtx(req));
    res.status(201).json({ data: reservation });
  } catch (error: any) {
    if (error.statusCode && error.statusCode < 500) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[ReservationsController] create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/reservations/:id — Update a reservation. */
export async function updateReservation(req: Request, res: Response): Promise<void> {
  try {
    const reservation = await reservationService.updateReservation(req.params.id, req.body, authCtx(req));
    if (!reservation) {
      res.status(404).json({ error: 'Reservation not found' });
      return;
    }
    res.json({ data: reservation });
  } catch (error: any) {
    if (error.statusCode && error.statusCode < 500) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[ReservationsController] update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/reservations/:id/seat — Seat a reservation on a table. */
export async function seatReservation(req: Request, res: Response): Promise<void> {
  try {
    const reservation = await reservationService.seatReservation(req.params.id, req.body, authCtx(req));
    res.json({ data: reservation });
  } catch (error: any) {
    if (error.statusCode && error.statusCode < 500) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[ReservationsController] seat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/reservations/:id/no-show — Mark a reservation as No Show. */
export async function markNoShow(req: Request, res: Response): Promise<void> {
  try {
    const reservation = await reservationService.markNoShow(req.params.id, authCtx(req));
    if (!reservation) {
      res.status(404).json({ error: 'Reservation not found' });
      return;
    }
    res.json({ data: reservation });
  } catch (error: any) {
    if (error.statusCode && error.statusCode < 500) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('[ReservationsController] no-show error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/reservations/:id — Soft-delete a reservation. */
export async function deleteReservation(req: Request, res: Response): Promise<void> {
  try {
    const deleted = await reservationService.deleteReservation(req.params.id, authCtx(req));
    if (!deleted) {
      res.status(404).json({ error: 'Reservation not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[ReservationsController] delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Waiting List ──────────────────────────────────────────────────

/** GET /api/reservations/waiting — List waiting list entries (server wait estimate). */
export async function listWaiting(req: Request, res: Response): Promise<void> {
  try {
    const { branchId, status } = req.query;
    const result = await reservationService.listWaiting({
      branchId: branchId as string,
      status: status as string,
    }, authCtx(req));
    res.json({ data: result.data, total: result.total });
  } catch (error) {
    console.error('[ReservationsController] listWaiting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/reservations/waiting — Add a new waiting list entry. */
export async function addToWaiting(req: Request, res: Response): Promise<void> {
  try {
    const entry = await reservationService.addToWaiting(req.body, authCtx(req));
    res.status(201).json({ data: entry });
  } catch (error) {
    console.error('[ReservationsController] addToWaiting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/reservations/waiting/:id — Update a waiting list entry. */
export async function updateWaitingEntry(req: Request, res: Response): Promise<void> {
  try {
    const updated = await reservationService.updateWaiting(req.params.id, req.body, authCtx(req));
    if (!updated) {
      res.status(404).json({ error: 'Waiting entry not found' });
      return;
    }
    res.json({ data: updated });
  } catch (error) {
    console.error('[ReservationsController] updateWaiting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/reservations/waiting/:id — Remove a waiting entry. */
export async function removeWaitingEntry(req: Request, res: Response): Promise<void> {
  try {
    const removed = await reservationService.removeWaiting(req.params.id, authCtx(req));
    if (!removed) {
      res.status(404).json({ error: 'Waiting entry not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[ReservationsController] removeWaiting error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

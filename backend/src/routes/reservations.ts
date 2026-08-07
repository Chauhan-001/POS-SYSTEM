/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reservations API routes — delegates to reservationsController.
 * Includes waiting list management under the same router.
 * Static sub-routes (/waiting) must precede /:id routes.
 */

import { Router } from 'express';
import {
  listReservations,
  getReservation,
  createReservation,
  updateReservation,
  deleteReservation,
  listWaiting,
  addToWaiting,
  updateWaitingEntry,
  removeWaitingEntry,
  seatReservation,
  markNoShow,
} from '../controllers/reservationsController';
import { requireAuth, requireRole } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/subscriptionMiddleware';
import { validate } from '../middleware/validate';
import {
  createReservationSchema, updateReservationSchema, reservationQuerySchema, reservationParamsSchema,
  createWaitingSchema, updateWaitingSchema, waitingQuerySchema, waitingParamsSchema,
  seatReservationSchema,
} from '../validation';

const router = Router();

// ─── Waiting list (must come before /:id routes) ───────────────────
router.get('/waiting', requireAuth, requireFeature('reservations'), validate({ query: waitingQuerySchema }), listWaiting);
router.post('/waiting', requireAuth, requireFeature('reservations'), validate({ body: createWaitingSchema }), addToWaiting);
router.put('/waiting/:id', requireAuth, requireFeature('reservations'), validate({ body: updateWaitingSchema, params: waitingParamsSchema }), updateWaitingEntry);
router.delete('/waiting/:id', requireRole('Owner', 'Manager'), requireFeature('reservations'), validate({ params: waitingParamsSchema }), removeWaitingEntry);

// ─── Reservations ──────────────────────────────────────────────────
router.get('/', requireAuth, requireFeature('reservations'), validate({ query: reservationQuerySchema }), listReservations);
router.get('/:id', requireAuth, requireFeature('reservations'), validate({ params: reservationParamsSchema }), getReservation);
router.post('/', requireAuth, requireFeature('reservations'), validate({ body: createReservationSchema }), createReservation);
router.put('/:id', requireAuth, requireFeature('reservations'), validate({ body: updateReservationSchema, params: reservationParamsSchema }), updateReservation);

// Reservation actions
router.post('/:id/seat', requireAuth, requireFeature('reservations'), validate({ body: seatReservationSchema, params: reservationParamsSchema }), seatReservation);
router.post('/:id/no-show', requireAuth, requireFeature('reservations'), validate({ params: reservationParamsSchema }), markNoShow);

// Only Owner and Manager can delete reservations
router.delete('/:id', requireRole('Owner', 'Manager'), requireFeature('reservations'), validate({ params: reservationParamsSchema }), deleteReservation);

export default router;

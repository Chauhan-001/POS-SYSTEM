import { z } from 'zod';
import { nonEmptyString, optString, objectId, dateString, timeString, reservationStatus, waitingStatus, partyType } from './common';

export const createReservationSchema = z.object({
  customerName: nonEmptyString.max(200),
  customerPhone: z.string().regex(/^\d{10}$/, 'Phone must be exactly 10 digits'),
  guestCount: z.number().int().min(1).max(500),
  date: dateString,
  time: timeString,
  tableId: optString,
  tableNumber: z.number().int().min(1).optional(),
  status: reservationStatus.optional(),
  branchId: objectId.optional(),
  notes: optString,
  occasion: optString,
  createdBy: optString,
}).strict();

export const updateReservationSchema = createReservationSchema.partial();

export const reservationQuerySchema = z.object({
  date: z.string().max(20).optional(),
  status: reservationStatus.optional(),
  branchId: objectId.optional(),
}).optional();

export const reservationParamsSchema = z.object({
  id: objectId,
}).strict();

export const createWaitingSchema = z.object({
  customerName: nonEmptyString.max(200),
  customerPhone: z.string().regex(/^\d{10}$/, 'Phone must be exactly 10 digits'),
  guestCount: z.number().int().min(1).max(500),
  estimatedWaitMinutes: z.number().int().min(0).optional(),
  status: waitingStatus.optional(),
  branchId: objectId.optional(),
  notes: optString,
  partyType: partyType,
}).strict();

export const updateWaitingSchema = createWaitingSchema.partial();

/** POST /api/reservations/:id/seat — Seat a reservation on a table */
export const seatReservationSchema = z.object({
  tableId: objectId.optional(),
}).strict();

export const waitingQuerySchema = z.object({
  branchId: objectId.optional(),
  status: waitingStatus.optional(),
}).optional();

export const waitingParamsSchema = z.object({
  id: objectId,
}).strict();

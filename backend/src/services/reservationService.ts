/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reservation Service — Business logic for table reservations and waitlist.
 *
 * Server-side business rules:
 *   - Capacity validation (guestCount ≤ table capacity)
 *   - Double-booking prevention (no overlapping Confirmed/Seated reservation
 *     for the same table + date + time window)
 *   - Past-date / invalid-time rejection
 *   - Automatic expiry → No Show (grace window)
 *   - Seating links the reservation to a table and creates/links a Customer
 *   - Table status is driven through the server-authoritative TableStateService
 *     (Reserved on create, release on cancel/no-show/seat-complete)
 *
 * Every mutation writes an audit record.
 */

import { reservationRepo, waitingEntryRepo, tableRepo, customerRepo, auditLogRepo } from '../repositories';
import { tableStateService, type ReconcileCtx } from './tableStateService';
import { AppError } from '../utils/AppError';

const RESERVATION_GRACE_MINUTES = 30;

export interface ReservationCtx extends ReconcileCtx {}

/**
 * Local-date string (YYYY-MM-DD). Reservation dates come from the client in
 * local time, so expiry/validation must use the LOCAL calendar day — using
 * toISOString() (UTC) would misclassify bookings near midnight.
 */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Compare "HH:MM" strings (24h). */
function minutesOf(time: string): number {
  const [h, m] = (time || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function timeWindowOverlaps(aTime: string, aEnd: string, bTime: string, bEnd: string): boolean {
  return minutesOf(aTime) < minutesOf(bEnd) && minutesOf(bTime) < minutesOf(aEnd);
}

export class ReservationService {
  /**
   * List reservations with optional filtering by date, status, branch.
   * Runs the expiry sweep first so stale "Confirmed" rows surface as No Show.
   */
  async listReservations(params: { date?: string; status?: string; branchId?: string } = {}, ctx: ReservationCtx = {}) {
    await this.expireOverdueReservations(ctx);
    const query: any = {};
    // Strict tenant scoping — orphaned rows with a null/other restaurantId
    // (e.g. seed leftovers) must not leak into another tenant's view.
    if (ctx.restaurantId) query.restaurantId = ctx.restaurantId;
    if (params.date) query.date = params.date;
    if (params.status) query.status = params.status;
    if (params.branchId) query.branchId = params.branchId;
    return reservationRepo.findAll(query, { sort: { date: 1, time: 1 } });
  }

  /**
   * Get a single reservation by ID.
   */
  async getReservation(id: string) {
    return reservationRepo.findById(id);
  }

  /**
   * Create a new reservation with full validation.
   */
  async createReservation(data: any, ctx: ReservationCtx = {}) {
    this.validateReservationBasics(data);

    // Capacity validation against the chosen table (when a table is given)
    if (data.tableId) {
      await this.assertCapacity(data.tableId, data.guestCount);
      await this.assertNoDoubleBooking({
        tableId: data.tableId,
        date: data.date,
        time: data.time,
        excludeId: undefined,
      });
    }

    // Link / create the customer (backward compatible — name+phone always stored)
    const customerId = await this.linkCustomer(data, ctx);

    const reservation = await reservationRepo.create({
      ...data,
      customerId: customerId || data.customerId || undefined,
      status: data.status ?? 'Confirmed',
      createdBy: ctx.operator,
      restaurantId: ctx.restaurantId || data.restaurantId || null,
    } as any);

    // Reserve the table through the server-authoritative state machine
    if (data.tableId) {
      await tableStateService.reserveTable(data.tableId, {
        id: String(reservation._id),
        customerName: data.customerName,
        time: data.time,
      }, ctx).catch(() => undefined);
    }

    await this.audit('RESERVATION_CREATED', String(reservation._id), ctx, {
      guestName: data.customerName,
      phone: data.customerPhone,
      date: data.date,
      time: data.time,
      tableId: data.tableId || null,
    });
    return reservation;
  }

  /**
   * Update a reservation with re-validation when booking-critical fields change.
   */
  async updateReservation(id: string, data: any, ctx: ReservationCtx = {}) {
    const existing = await reservationRepo.findById(id);
    if (!existing) return null;

    const next = {
      tableId: data.tableId ?? existing.tableId,
      date: data.date ?? existing.date,
      time: data.time ?? existing.time,
      guestCount: data.guestCount ?? existing.guestCount,
      status: data.status ?? existing.status,
    };

    // Re-run booking rules only when the booking footprint changed
    if (data.tableId || data.date || data.time || data.guestCount) {
      this.validateReservationBasics(next);
      if (next.tableId) {
        await this.assertCapacity(next.tableId, next.guestCount);
        await this.assertNoDoubleBooking({ tableId: next.tableId, date: next.date, time: next.time, excludeId: id });
      }
    }

    const reservation = await reservationRepo.update(id, data);

    // Table state transitions driven server-side
    if (existing.tableId && data.status && data.status !== 'Confirmed') {
      // Cancelled / No Show → release the table
      await tableStateService.reconcileTable(existing.tableId, ctx).catch(() => undefined);
    }
    if (data.tableId && data.tableId !== existing.tableId) {
      await tableStateService.reserveTable(data.tableId, {
        id,
        customerName: data.customerName || existing.customerName,
        time: next.time,
      }, ctx).catch(() => undefined);
      if (existing.tableId) await tableStateService.reconcileTable(existing.tableId, ctx).catch(() => undefined);
    }

    await this.audit('RESERVATION_UPDATED', id, ctx, {
      changes: Object.keys(data),
      newStatus: data.status || existing.status,
    });
    return reservation;
  }

  /**
   * Soft-delete a reservation; releases any reserved table.
   */
  async deleteReservation(id: string, ctx: ReservationCtx = {}) {
    const existing = await reservationRepo.findById(id);
    const deleted = await reservationRepo.softDelete(id);
    if (!deleted) return null;
    if (existing && existing.tableId) {
      await tableStateService.reconcileTable(existing.tableId, ctx).catch(() => undefined);
    }
    await this.audit('RESERVATION_DELETED', id, ctx, { guestName: existing?.customerName });
    return deleted;
  }

  /** Seat a reservation — assign table, mark Seated, reconcile the table. */
  async seatReservation(id: string, data: { tableId?: string }, ctx: ReservationCtx = {}) {
    const existing = await reservationRepo.findById(id);
    if (!existing) throw new AppError(404, 'Reservation not found');

    const tableId = data.tableId || existing.tableId;
    if (!tableId) throw new AppError(400, 'A table must be assigned to seat this reservation.');

    await this.assertCapacity(tableId, existing.guestCount);
    await this.assertTableAvailable(tableId);

    const table = await tableRepo.findById(tableId);
    const updated = await reservationRepo.update(id, {
      status: 'Seated',
      tableId,
      tableNumber: table ? (table as any).number : existing.tableNumber,
      seatedAt: new Date(),
    } as any);

    // Seated → the table becomes occupied when the order is opened; reconcile now.
    await tableStateService.reconcileTable(tableId, ctx).catch(() => undefined);
    await this.audit('RESERVATION_SEATED', id, ctx, { tableId, guestName: existing.customerName });
    return updated;
  }

  /** Mark a reservation as No Show (explicit). */
  async markNoShow(id: string, ctx: ReservationCtx = {}) {
    const existing = await reservationRepo.findById(id);
    if (!existing) throw new AppError(404, 'Reservation not found');
    const updated = await reservationRepo.update(id, { status: 'No Show' });
    if (existing.tableId) {
      await tableStateService.reconcileTable(existing.tableId, ctx).catch(() => undefined);
    }
    await this.audit('RESERVATION_NO_SHOW', id, ctx, { guestName: existing.customerName });
    return updated;
  }

  /**
   * Expiry sweep — Confirmed reservations whose time + grace has passed become
   * No Show (and their tables are reconciled/released). Returns the count.
   */
  async expireOverdueReservations(ctx: ReservationCtx = {}) {
    const today = todayStr();
    const nowMinutes = minutesOf(new Date().toTimeString().slice(0, 5));
    // Clamp the grace cutoff to >= 0 so early-morning (before 00:30) runs never
    // produce a malformed negative time string that silently matches nothing.
    const cutoffMinutes = Math.max(0, nowMinutes - RESERVATION_GRACE_MINUTES);
    const cutoff = `${String(Math.floor(cutoffMinutes / 60)).padStart(2, '0')}:${String(cutoffMinutes % 60).padStart(2, '0')}`;
    // Scope the sweep to this tenant — otherwise every listReservations call
    // would mark OTHER tenants' overdue reservations as No Show.
    const staleQuery: any = {
      status: 'Confirmed',
      $or: [
        { date: { $lt: today } },
        { date: today, time: { $lte: cutoff } },
      ],
    };
    if (ctx.restaurantId) staleQuery.restaurantId = ctx.restaurantId;
    const stale = await reservationRepo.findAll(staleQuery);

    let count = 0;
    for (const res of stale.data || []) {
      const tableId = (res as any).tableId;
      await reservationRepo.update(String(res._id), { status: 'No Show' });
      if (tableId) await tableStateService.reconcileTable(tableId, ctx).catch(() => undefined);
      await this.audit('RESERVATION_EXPIRED', String(res._id), ctx, { guestName: (res as any).customerName });
      count++;
    }
    return count;
  }

  /** List waitlist entries, sorted oldest-first with live estimated wait. */
  async listWaiting(params: { branchId?: string; status?: string } = {}, ctx: ReservationCtx = {}) {
    const query: any = {};
    // Strict tenant scoping — orphaned rows with a null/other restaurantId
    // (e.g. seed leftovers) must not leak into another tenant's waiting list.
    if (ctx.restaurantId) query.restaurantId = ctx.restaurantId;
    if (params.branchId) query.branchId = params.branchId;
    if (params.status) query.status = params.status;
    const result = await waitingEntryRepo.findAll(query, { sort: { createdAt: 1 } });
    // Server-side estimated wait: 10 min per party ahead in the queue.
    let acc = 0;
    const enriched = (result.data as any[]).map((w) => {
      if (w.status === 'Waiting') {
        acc += 10;
        return { ...w.toObject(), estimatedWaitMinutes: acc };
      }
      return w;
    });
    return { ...result, data: enriched };
  }

  /**
   * Add a new waitlist entry with server-side estimated wait + audit.
   */
  async addToWaiting(data: any, ctx: ReservationCtx = {}) {
    // Stamp the tenant so the strict-scoped listWaiting can return it.
    const waiting = await waitingEntryRepo.create({
      ...data,
      restaurantId: ctx.restaurantId || data.restaurantId || null,
    } as any);
    await this.audit('WAITING_LIST_ADDED', String(waiting._id), ctx, {
      guestName: data.customerName,
      phone: data.customerPhone,
      guestCount: data.guestCount,
    });
    return waiting;
  }

  /**
   * Update a waitlist entry (e.g., "Waiting" → "Seated").
   */
  async updateWaiting(id: string, data: any, ctx: ReservationCtx = {}) {
    const updated = await waitingEntryRepo.update(id, data);
    if (updated) {
      await this.audit('WAITING_LIST_UPDATED', id, ctx, { changes: Object.keys(data), status: data.status });
    }
    return updated;
  }

  /** Remove (cancel) a waitlist entry. */
  async removeWaiting(id: string, ctx: ReservationCtx = {}) {
    const existing = await waitingEntryRepo.findById(id);
    const removed = await waitingEntryRepo.softDelete(id);
    if (removed) {
      await this.audit('WAITING_LIST_REMOVED', id, ctx, { guestName: existing?.customerName });
    }
    return removed;
  }

  // ─── Private helpers ────────────────────────────────────────────

  private validateReservationBasics(data: any) {
    if (data.date && data.date < todayStr()) {
      throw new AppError(400, 'Reservation date cannot be in the past.');
    }
    if (data.date === todayStr() && data.time && minutesOf(data.time) < minutesOf(new Date().toTimeString().slice(0, 5))) {
      throw new AppError(400, 'Reservation time has already passed.');
    }
  }

  private async assertCapacity(tableId: string, guestCount: number) {
    const table = await tableRepo.findById(tableId);
    if (!table) throw new AppError(404, 'Assigned table not found.');
    const capacity = Number((table as any).capacity) || 0;
    if (Number(guestCount) > capacity) {
      throw new AppError(409, `Table ${(table as any).number} seats only ${capacity} guests (requested ${guestCount}).`);
    }
  }

  private async assertTableAvailable(tableId: string) {
    const table = await tableRepo.findById(tableId);
    if (!table) throw new AppError(404, 'Assigned table not found.');
    const status = String((table as any).status);
    // Server is the authority: only Available or Reserved tables can be seated.
    // Reject occupied/preparing/food-ready/served/waiting-payment/cleaning/
    // disabled/merged so a reservation can never be double-seated onto a
    // table with a live order.
    const seatedStatuses = ['Occupied', 'Preparing', 'Food Ready', 'Served', 'Waiting Payment', 'Cleaning', 'Disabled', 'Merged'];
    if (seatedStatuses.includes(status)) {
      throw new AppError(409, `Table ${(table as any).number} is ${status.toLowerCase()} and cannot be seated.`);
    }
  }

  private async assertNoDoubleBooking(opts: { tableId: string; date: string; time: string; excludeId?: string }) {
    const start = opts.time;
    const end = addMinutes(start, 120); // 2h reservation window
    const conflicts = await reservationRepo.findAll({
      tableId: opts.tableId,
      date: opts.date,
      status: { $in: ['Confirmed', 'Seated'] },
      _id: opts.excludeId ? { $ne: opts.excludeId } : undefined,
    } as any);
    for (const res of conflicts.data || []) {
      const resStart = (res as any).time;
      const resEnd = addMinutes(resStart, 120);
      if (timeWindowOverlaps(start, end, resStart, resEnd)) {
        throw new AppError(409, `Table is already booked at ${resStart} for ${(res as any).customerName}.`);
      }
    }
  }

  /** Reuse an existing customer by phone, or create a minimal one (tenant-scoped). */
  private async linkCustomer(data: any, ctx: ReservationCtx): Promise<string | undefined> {
    try {
      if (!data.customerPhone) return undefined;
      const repo = ctx.restaurantId ? customerRepo.forTenant(ctx.restaurantId) : customerRepo;
      const existing = await repo.findOne({ phone: data.customerPhone } as any);
      if (existing) return String(existing._id);
      const customer = await repo.create({
        phone: data.customerPhone,
        name: data.customerName || 'Guest',
      } as any);
      return String(customer._id);
    } catch (err: any) {
      console.warn('[ReservationService] customer linking failed (non-fatal):', err.message);
      return undefined;
    }
  }

  private async audit(action: string, entityId: string, ctx: ReservationCtx, details: Record<string, unknown>) {
    try {
      await auditLogRepo.create({
        action,
        entityType: 'Reservation',
        entityId,
        performedBy: ctx.operator || 'System',
        performedById: ctx.operatorId,
        details,
        branchId: ctx.branchId ? (ctx.branchId as any) : undefined,
      } as any);
    } catch (err: any) {
      console.warn('[ReservationService] audit log failed (non-fatal):', err.message);
    }
  }
}

/** Add minutes to an HH:MM string (24h, wraps past midnight). */
function addMinutes(time: string, minutes: number): string {
  const total = (minutesOf(time) + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

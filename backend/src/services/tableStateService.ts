/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TableStateService — Server-authoritative table state machine.
 *
 * The backend is the SINGLE SOURCE OF TRUTH for table status. The frontend
 * must never decide table status — every state change is derived here from
 * authoritative data:
 *
 *   - A live Dine-In OR QR-online (Website) order → Occupied / Preparing / Food Ready / Served / Waiting Payment
 *   - An active reservation → Reserved
 *   - Nothing live          → Available (manual states Cleaning/Disabled/Merged are preserved)
 *
 * Every order/reservation mutation must call `reconcileTable(tableId)` so the
 * persisted Table.status always matches the real world, across all POS devices.
 * State changes are audit-logged automatically.
 */

import { orderRepo, reservationRepo, tableRepo, auditLogRepo } from '../repositories';
import QROrderingSession from '../modules/qr-ordering/models/QROrderingSession';

/** Order statuses that mean "the table is free". */
const TERMINAL_ORDER_STATUSES = ['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held'];

/** Manual states that reconcile preserves when no live order/reservation exists. */
const MANUAL_TABLE_STATUSES = ['Cleaning', 'Disabled', 'Merged'];

export type TableStatus =
  | 'Available' | 'Occupied' | 'Reserved' | 'Preparing' | 'Food Ready'
  | 'Served' | 'Waiting Payment' | 'Cleaning' | 'Paid' | 'Cancelled'
  | 'Disabled' | 'Merged';

export interface ReconcileCtx {
  restaurantId?: string;
  branchId?: string;
  operator?: string;
  operatorId?: string;
}

/** Map a live order status to its table status. */
function mapOrderToTableStatus(orderStatus: string): TableStatus {
  switch (orderStatus) {
    case 'Accepted': return 'Preparing';
    case 'Preparing': return 'Preparing';
    case 'Ready': return 'Food Ready';
    case 'Served': return 'Served';
    case 'Waiting Payment': return 'Waiting Payment';
    default: return 'Occupied'; // New / anything in-flight
  }
}

export class TableStateService {
  /**
   * Recompute a table's status from authoritative sources and persist the
   * result. Idempotent — safe to call after every order/reservation mutation.
   * Returns the updated table, or null if the table does not exist.
   */
  async reconcileTable(tableId: string, ctx: ReconcileCtx = {}) {
    const table = await tableRepo.findById(tableId);
    if (!table) return null;

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (matches Reservation.date)

    const [liveOrder, activeReservation, activeClaim] = await Promise.all([
      orderRepo.findOne({
        tableId,
        // A table is occupied by ANY live order on it — a waiter-created
        // Dine-In order OR a customer's QR/online (Website) order. Without
        // this, a table whose guests ordered via the table QR stayed
        // Available on the floor plan.
        type: { $in: ['Dine In', 'Website'] },
        status: { $nin: TERMINAL_ORDER_STATUSES },
      } as any),
      reservationRepo.findOne({
        tableId,
        status: 'Confirmed',
        date: today,
      } as any),
      // A customer who SCANNED the table QR holds it for their seating even
      // before they order — the scan claim occupies the table so the floor
      // plan turns Occupied instantly (and never double-seats). The claim
      // carries an expiresAt, so an abandoned scan (no activity) releases
      // the table when the sweeper marks it EXPIRED and re-reconciles.
      QROrderingSession.findOne({ tableId, status: 'ACTIVE' })
        .select({ createdAt: 1 })
        .lean()
        .exec() as any,
    ]);

    // occupiedSince is ALWAYS derived from the live order's createdAt (never
    // reused from a previous seating) and ALWAYS written (null clears it) so
    // stale occupancy timestamps can't corrupt dining-time stats.
    let newStatus: TableStatus;
    let occupiedSince: Date | null = null;

    if (liveOrder) {
      newStatus = mapOrderToTableStatus(String(liveOrder.status || 'New'));
      occupiedSince = liveOrder.createdAt || new Date();
    } else if (activeClaim) {
      // Scan claim — occupied from the moment the guest scanned (createdAt,
      // never extended by heartbeats, so the seated timer is honest).
      newStatus = 'Occupied';
      occupiedSince = activeClaim.createdAt || new Date();
    } else if (activeReservation) {
      newStatus = 'Reserved';
    } else if (MANUAL_TABLE_STATUSES.includes(String(table.status))) {
      newStatus = String(table.status) as TableStatus;
    } else {
      newStatus = 'Available';
    }

    const prevStatus = String(table.status);
    const prevOccupiedSince = (table as any).occupiedSince as Date | null | undefined;
    const occupiedChanged = !!occupiedSince !== !!prevOccupiedSince
      || (!!occupiedSince && !!prevOccupiedSince && occupiedSince.getTime() !== new Date(prevOccupiedSince).getTime());

    if (prevStatus === newStatus && !occupiedChanged) {
      return table; // nothing to do
    }

    const updated = await tableRepo.update(tableId, {
      status: newStatus,
      occupiedSince,
    } as any);

    if (prevStatus !== newStatus) {
      await this.audit('TABLE_STATUS_CHANGED', tableId, ctx, {
        previousStatus: prevStatus,
        newStatus,
        occupiedSince: occupiedSince ? occupiedSince.toISOString() : null,
      });
      // Live broadcast: every terminal sees the table flip instantly (floor plan + grid).
      try {
        const { emitToRestaurant } = await import('../socket');
        emitToRestaurant(ctx.restaurantId || (table as any).restaurantId, 'table:updated', {
          tableId,
          status: newStatus,
          occupiedSince: occupiedSince ? occupiedSince.toISOString() : null,
          previousStatus: prevStatus,
        });
      } catch { /* socket not ready — non-fatal */ }
    }
    return updated;
  }

  /** Mark a table Reserved because of an active reservation. */
  async reserveTable(tableId: string, reservation: { id?: string; customerName?: string; time?: string }, ctx: ReconcileCtx = {}) {
    const table = await tableRepo.findById(tableId);
    if (!table) return null;
    if (String(table.status) === 'Occupied' || String(table.status) === 'Preparing') return table; // never downgrade a seated table

    const updated = await tableRepo.update(tableId, {
      status: 'Reserved',
      reservationId: reservation?.id,
      reservationName: reservation?.customerName,
      reservationTime: reservation?.time,
    } as any);
    await this.audit('TABLE_RESERVED', tableId, ctx, {
      reservationId: reservation?.id,
      guestName: reservation?.customerName,
    });
    return updated;
  }

  /** Release a table (bill paid / order closed / reservation cancelled). */
  async releaseTable(tableId: string, ctx: ReconcileCtx = {}) {
    const table = await tableRepo.findById(tableId);
    if (!table) return null;
    const updated = await tableRepo.update(tableId, {
      status: 'Available',
      occupiedSince: null,
      reservationId: null,
      reservationName: null,
      reservationTime: null,
    } as any);
    await this.audit('TABLE_RELEASED', tableId, ctx, {
      previousStatus: String(table.status),
    });
    return updated;
  }

  /** Best-effort audit log for table state transitions. */
  private async audit(action: string, tableId: string, ctx: ReconcileCtx, details: Record<string, unknown>) {
    try {
      await auditLogRepo.create({
        action,
        entityType: 'Table',
        entityId: tableId,
        performedBy: ctx.operator || 'System',
        performedById: ctx.operatorId,
        details,
        branchId: ctx.branchId ? (ctx.branchId as any) : undefined,
      } as any);
    } catch (err: any) {
      console.warn('[TableStateService] audit log failed (non-fatal):', err.message);
    }
  }
}

/**
 * Singleton used across order/bill/reservation services. Declared after the
 * class to avoid a temporal-dead-zone ReferenceError.
 */
export const tableStateService = new TableStateService();

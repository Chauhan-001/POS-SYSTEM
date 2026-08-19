/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Table Service — Business logic for restaurant floor plan tables.
 * Handles CRUD with branch/section filtering, unique number enforcement,
 * and the production table-operations surface (release, cleaning, disable,
 * waiter assignment, order move/merge, occupancy stats).
 *
 * Table STATUS is never decided here — the server-authoritative
 * TableStateService owns status transitions. These operations request an
 * action and let the state machine (plus manual overrides for Cleaning /
 * Disabled) settle the final status.
 */

import { tableRepo, orderRepo, auditLogRepo } from '../repositories';
import { tableStateService, type ReconcileCtx } from './tableStateService';
import { upsertTableSticker, retireTableSticker } from '../modules/qr-ordering/services/qrTokenService';
import QROrderingSession from '../modules/qr-ordering/models/QROrderingSession';
import { AppError } from '../utils/AppError';

const TERMINAL_ORDER_STATUSES = ['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held'];

/** Order types that physically occupy a table (waiter Dine-In + QR/online). */
const LIVE_ORDER_TYPES = ['Dine In', 'Website'];

export interface TableCtx extends ReconcileCtx {}

export class TableService {
  /**
   * List tables with optional branch/section/status/floor filtering.
   *
   * Tenant isolation: when a restaurantId is supplied (from the JWT), only
   * tables owned by that restaurant are returned. Rows with a null
   * restaurantId are orphaned seed/legacy data and must never leak into a
   * tenant's floor plan — that previously surfaced every duplicate table in
   * the database to every restaurant (e.g. tables 1-16 twice).
   */
  async list(params: { branchId?: string; section?: string; status?: string; floorId?: string; restaurantId?: string } = {}) {
    const query: any = {};
    if (params.restaurantId) query.restaurantId = params.restaurantId;
    if (params.branchId) query.branchId = params.branchId;
    if (params.section) query.section = params.section;
    if (params.status) query.status = params.status;
    if (params.floorId) query.floorId = params.floorId;
    return tableRepo.findAll(query, { sort: { number: 1 } });
  }

  /**
   * Get a single table by ID.
   */
  async getById(id: string) {
    return tableRepo.findById(id);
  }

  /**
   * Create a new table.
   * Unique constraint on (restaurantId, branchId, number) is handled at the
   * DB level — scoped per restaurant so branchless table numbers never
   * collide across tenants.
   */
  async create(data: {
    number: number;
    capacity: number;
    status?: string;
    section?: string;
    branchId?: string;
    floorId?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    shape?: 'circle' | 'square' | 'rectangle';
    isLocked?: boolean;
  }, ctx: TableCtx = {}) {
    const table = await tableRepo.create({
      ...data,
      status: data.status ?? 'Available',
      shape: data.shape ?? 'circle',
      rotation: data.rotation ?? 0,
      isLocked: data.isLocked ?? false,
      restaurantId: ctx.restaurantId || null,
    } as any);
    await this.audit('TABLE_CREATED', String(table._id), ctx, { number: table.number, capacity: table.capacity });
    // AUTOMATIC QR STICKER: every new table gets its own printable sticker
    // (best-effort, non-fatal — skipped silently when the online store isn't
    // enabled yet). Existing stickers are NEVER touched here, so printed QRs
    // stay valid forever unless the owner explicitly regenerates one.
    if (ctx.restaurantId) {
      await upsertTableSticker(ctx.restaurantId, table);
    }
    return table;
  }

  /**
   * Update a table (position, status, capacity, etc.).
   * Status updates are only honored for manual states (Cleaning/Disabled);
   * everything else is reconciled by the state machine.
   */
  async update(id: string, data: any, ctx: TableCtx = {}) {
    const existing = await tableRepo.findById(id);
    if (!existing) return null;

    const patch: any = { ...data };
    // If the client pushes a lifecycle status, ignore it — the state machine
    // decides. Only manual states (Cleaning/Disabled) are honored here.
    if (data.status && !['Cleaning', 'Disabled'].includes(data.status)) {
      delete patch.status;
    }
    if (patch.status === 'Cleaning') patch.cleaningSince = new Date();
    if (patch.status === 'Disabled') patch.isLocked = true;

    const table = await tableRepo.update(id, patch);
    if (!table) return null;

    // Reconcile lifecycle status from authoritative sources after any update.
    await tableStateService.reconcileTable(id, ctx).catch(() => undefined);
    await this.audit('TABLE_UPDATED', id, ctx, { number: table.number, fields: Object.keys(data) });
    return table;
  }

  /**
   * End a customer's QR seat-session on this table (the table QR stays
   * valid forever — only the SESSION is expired). Marks every ACTIVE claim
   * CANCELLED so the guest cannot silently re-claim on their next heartbeat,
   * then lets the authoritative state machine free the table (Available)
   * when no live order/reservation holds it. If the guest already placed an
   * order, the order owns the occupancy and the table stays occupied.
   */
  async expireTableSession(id: string, ctx: TableCtx = {}) {
    const existing = await tableRepo.findById(id);
    if (!existing) return null;

    await QROrderingSession.updateMany(
      { tableId: id, status: 'ACTIVE' },
      { $set: { status: 'CANCELLED', cancelledAt: new Date() } }
    ).exec();

    const table = await tableStateService.reconcileTable(id, ctx);
    await this.audit('TABLE_SESSION_EXPIRED', id, ctx, {
      tableNumber: existing.number,
      previousStatus: String(existing.status),
    });
    return table;
  }

  /**
   * Soft-delete a table. Refuses to delete a table with a live order.
   */
  async delete(id: string, ctx: TableCtx = {}) {
    const liveOrder = await orderRepo.findOne({
      tableId: id,
      type: { $in: LIVE_ORDER_TYPES },
      status: { $nin: TERMINAL_ORDER_STATUSES },
    } as any);
    if (liveOrder) {
      throw new AppError(409, 'Cannot delete a table with a live order. Release the table first.');
    }
    const table = await tableRepo.softDelete(id);
    if (!table) return null;
    await this.audit('TABLE_DELETED', id, ctx, { number: table.number });
    // Deleting a table is an explicit owner action — retire its printed
    // sticker so no orphaned QR lingers for a table that no longer exists.
    if (ctx.restaurantId) {
      await retireTableSticker(ctx.restaurantId, String(table._id));
    }
    return table;
  }

  /** Release a table to Available (clears occupied/reservation state). */
  async release(id: string, ctx: TableCtx = {}) {
    const table = await tableRepo.findById(id);
    if (!table) return null;
    // Refuse to release a table with a live order unless forced — the state
    // machine will release it automatically when the bill is closed.
    const liveOrder = await orderRepo.findOne({
      tableId: id,
      type: { $in: LIVE_ORDER_TYPES },
      status: { $nin: TERMINAL_ORDER_STATUSES },
    } as any);
    if (liveOrder) {
      throw new AppError(409, 'Table has a live order. Close the bill to release it.');
    }
    return tableStateService.releaseTable(id, ctx);
  }

  /** Mark a table for cleaning. */
  async startCleaning(id: string, ctx: TableCtx = {}) {
    const table = await tableRepo.findById(id);
    if (!table) return null;
    const liveOrder = await orderRepo.findOne({
      tableId: id,
      type: { $in: LIVE_ORDER_TYPES },
      status: { $nin: TERMINAL_ORDER_STATUSES },
    } as any);
    if (liveOrder) {
      throw new AppError(409, 'Cannot clean a table with a live order.');
    }
    const updated = await tableRepo.update(id, { status: 'Cleaning', cleaningSince: new Date() } as any);
    await this.audit('TABLE_CLEANING_STARTED', id, ctx, { number: table.number });
    return updated;
  }

  /** Complete cleaning → back to Available. */
  async completeCleaning(id: string, ctx: TableCtx = {}) {
    const table = await tableRepo.findById(id);
    if (!table) return null;
    const updated = await tableRepo.update(id, { status: 'Available', cleaningSince: null } as any);
    await this.audit('TABLE_CLEANING_COMPLETED', id, ctx, { number: table.number });
    return updated;
  }

  /** Disable a table (out of service). */
  async disable(id: string, reason: string, ctx: TableCtx = {}) {
    const table = await tableRepo.findById(id);
    if (!table) return null;
    const liveOrder = await orderRepo.findOne({
      tableId: id,
      type: { $in: LIVE_ORDER_TYPES },
      status: { $nin: TERMINAL_ORDER_STATUSES },
    } as any);
    if (liveOrder) {
      throw new AppError(409, 'Cannot disable a table with a live order.');
    }
    const updated = await tableRepo.update(id, { status: 'Disabled', isLocked: true } as any);
    await this.audit('TABLE_DISABLED', id, ctx, { reason });
    return updated;
  }

  /** Re-enable a disabled table. */
  async enable(id: string, ctx: TableCtx = {}) {
    const table = await tableRepo.findById(id);
    if (!table) return null;
    const updated = await tableRepo.update(id, { status: 'Available', isLocked: false } as any);
    await this.audit('TABLE_ENABLED', id, ctx, { number: table.number });
    return updated;
  }

  /** Assign (or transfer) a waiter to a table. */
  async assignWaiter(id: string, data: { waiterId?: string; waiterName?: string }, ctx: TableCtx = {}) {
    const table = await tableRepo.findById(id);
    if (!table) return null;
    const previousWaiter = table.waiterName || null;
    const updated = await tableRepo.update(id, {
      waiterId: data.waiterId ?? null,
      waiterName: data.waiterName ?? null,
    } as any);
    await this.audit('WAITER_ASSIGNED', id, ctx, {
      previousWaiter,
      newWaiter: data.waiterName || data.waiterId || null,
    });
    return updated;
  }

  /** Move a live order to another table (transfer customer/order). */
  async moveOrder(id: string, toTableId: string, reason: string | undefined, ctx: TableCtx = {}) {
    const [fromTable, toTable] = await Promise.all([
      tableRepo.findById(id),
      tableRepo.findById(toTableId),
    ]);
    if (!fromTable) throw new AppError(404, 'Source table not found');
    if (!toTable) throw new AppError(404, 'Destination table not found');

    const liveOrders = await orderRepo.findAll({
      tableId: id,
      type: { $in: LIVE_ORDER_TYPES },
      status: { $nin: TERMINAL_ORDER_STATUSES },
    } as any);

    let movedCount = 0;
    for (const order of liveOrders.data || []) {
      await orderRepo.update(String(order._id), {
        tableId: toTableId,
        tableNumber: toTable.number,
      } as any);
      movedCount++;
    }

    if (movedCount === 0) {
      throw new AppError(409, 'No live orders found on this table to move.');
    }

    await tableStateService.reconcileTable(id, ctx);
    await tableStateService.reconcileTable(toTableId, ctx);
    await this.audit('TABLE_ORDER_MOVED', id, ctx, {
      toTableId,
      toTableNumber: toTable.number,
      ordersMoved: movedCount,
      reason: reason || null,
    });
    return { movedCount, toTable: toTable.toObject ? toTable.toObject() : toTable };
  }

  /** Merge two tables: move live orders from `fromTableId` into `toTableId`. */
  async mergeTables(fromTableId: string, toTableId: string, reason: string | undefined, ctx: TableCtx = {}) {
    const [fromTable, toTable] = await Promise.all([
      tableRepo.findById(fromTableId),
      tableRepo.findById(toTableId),
    ]);
    if (!fromTable) throw new AppError(404, 'Source table not found');
    if (!toTable) throw new AppError(404, 'Destination table not found');

    const liveOrders = await orderRepo.findAll({
      tableId: fromTableId,
      type: { $in: LIVE_ORDER_TYPES },
      status: { $nin: TERMINAL_ORDER_STATUSES },
    } as any);

    let mergedCount = 0;
    for (const order of liveOrders.data || []) {
      await orderRepo.update(String(order._id), {
        tableId: toTableId,
        tableNumber: toTable.number,
        status: 'Merged',
      } as any);
      mergedCount++;
    }

    if (mergedCount === 0) {
      throw new AppError(409, 'No live orders found on the source table to merge.');
    }

    // Mark the source table as merged so it isn't seated while its guests
    // continue on the destination table.
    await tableRepo.update(fromTableId, {
      status: 'Merged',
      mergedWith: [toTableId],
    } as any);
    await tableStateService.reconcileTable(toTableId, ctx);
    await this.audit('TABLE_MERGED', fromTableId, ctx, {
      toTableId,
      toTableNumber: toTable.number,
      ordersMerged: mergedCount,
      reason: reason || null,
    });
    return { mergedCount, toTable: toTable.toObject ? toTable.toObject() : toTable };
  }

  /**
   * Occupancy & operations report for a branch (or restaurant).
   */
  async occupancyStats(params: { branchId?: string; restaurantId?: string; date?: string }, ctx: TableCtx = {}) {
    const query: any = {};
    if (params.branchId) query.branchId = params.branchId;
    // Strict tenant scoping — orphaned rows with a null restaurantId must not
    // inflate occupancy stats for any tenant (consistent with list()).
    if (ctx.restaurantId) query.restaurantId = ctx.restaurantId;

    const [all, occupied, reserved, cleaning, disabled, activeOrders] = await Promise.all([
      tableRepo.findAll(query, { sort: { number: 1 } }),
      tableRepo.findAll({ ...query, status: { $in: ['Occupied', 'Preparing', 'Food Ready', 'Served', 'Waiting Payment'] } }),
      tableRepo.findAll({ ...query, status: 'Reserved' }),
      tableRepo.findAll({ ...query, status: 'Cleaning' }),
      tableRepo.findAll({ ...query, status: 'Disabled' }),
      orderRepo.findAll({
        branchId: params.branchId || null,
        type: 'Dine In',
        status: { $nin: TERMINAL_ORDER_STATUSES },
        createdAt: params.date ? { $gte: new Date(`${params.date}T00:00:00`) } : undefined,
      } as any),
    ]);

    const total = all.total || all.data.length;
    const avgDiningMinutes = (() => {
      const now = Date.now();
      const samples = occupied.data
        .map((t: any) => (t.occupiedSince ? Math.max(1, Math.round((now - new Date(t.occupiedSince).getTime()) / 60000)) : null))
        .filter((v: number | null): v is number => v !== null);
      if (samples.length === 0) return 0;
      return Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
    })();

    return {
      total,
      available: Math.max(0, total - occupied.total - reserved.total - cleaning.total - disabled.total),
      occupied: occupied.total,
      reserved: reserved.total,
      cleaning: cleaning.total,
      disabled: disabled.total,
      occupancyRate: total > 0 ? Math.round(((occupied.total + reserved.total) / total) * 100) : 0,
      averageDiningMinutes: avgDiningMinutes,
      activeDineInOrders: activeOrders.total || activeOrders.data.length,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Safe transactional bulk sync for a branch floor plan.
   * - Inserts new tables, updates changed tables, soft-deletes removed tables.
   * - Never blindly deletes: tables with live orders or in manual states are kept.
   */
  async bulkReplaceForBranch(branchId: string, tables: any[], ctx: TableCtx = {}) {
    const incomingMap = new Map<string, any>();
    for (const t of tables) {
      if (t.id || t._id) incomingMap.set(String(t.id || t._id), t);
    }

    const existing = await tableRepo.findAll({ branchId } as any, { sort: { number: 1 } });

    const results = { created: 0, updated: 0, skipped: 0 };
    const now = new Date();

    // Upsert incoming tables
    for (const t of tables) {
      const id = t.id || t._id;
      if (id && incomingMap.has(String(id))) {
        const existingDoc = existing.data.find((e: any) => String(e._id) === String(id));
        if (existingDoc) {
          await tableRepo.update(String(id), {
            number: t.number, capacity: t.capacity, section: t.section,
            x: t.x, y: t.y, width: t.width, height: t.height,
            rotation: t.rotation ?? 0, shape: t.shape ?? existingDoc.shape ?? 'circle',
            floorId: t.floorId ?? existingDoc.floorId ?? null,
            branchId: t.branchId ?? branchId,
          } as any);
          results.updated++;
        } else {
          const created = await tableRepo.create({ ...t, branchId, restaurantId: ctx.restaurantId || null } as any);
          results.created++;
          // New table → auto-generate its QR sticker (existing tables keep
          // their current stickers untouched).
          if (ctx.restaurantId) await upsertTableSticker(ctx.restaurantId, created);
        }
      } else {
        const created = await tableRepo.create({ ...t, branchId, restaurantId: ctx.restaurantId || null } as any);
        results.created++;
        if (ctx.restaurantId) await upsertTableSticker(ctx.restaurantId, created);
      }
    }

    // Soft-delete removed tables — but keep tables with live orders or manual states
    const incomingIds = new Set<string>();
    for (const t of tables) {
      if (t.id || t._id) incomingIds.add(String(t.id || t._id));
    }
    for (const existingDoc of existing.data) {
      const id = String(existingDoc._id);
      if (incomingIds.has(id)) continue;
      const status = String(existingDoc.status);
      const liveOrder = await orderRepo.findOne({
        tableId: id,
        type: 'Dine In',
        status: { $nin: TERMINAL_ORDER_STATUSES },
      } as any);
      if (liveOrder || ['Cleaning', 'Disabled', 'Merged'].includes(status)) {
        results.skipped++;
        continue;
      }
      await tableRepo.softDelete(id);
    }

    await this.audit('FLOOR_SYNCED', branchId, ctx, { results });
    return results;
  }

  private async audit(action: string, entityId: string, ctx: TableCtx, details: Record<string, unknown>) {
    try {
      await auditLogRepo.create({
        action,
        entityType: 'Table',
        entityId,
        performedBy: ctx.operator || 'System',
        performedById: ctx.operatorId,
        details,
        branchId: ctx.branchId ? (ctx.branchId as any) : undefined,
      } as any);
    } catch (err: any) {
      console.warn('[TableService] audit log failed (non-fatal):', err.message);
    }
  }
}

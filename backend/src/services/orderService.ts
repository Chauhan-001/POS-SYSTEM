/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Order Service — Business logic for the full order lifecycle.
 * Manages order creation, status transitions, item management,
 * KOT records, timeline events, and takeaway order tracking.
 *
 * Order status flow:
 *   New → Accepted → Preparing → Ready → Served → Waiting Payment → Paid → Closed
 *   Special: Cancelled, Refunded, Held, Transferred
 *
 * Every mutation that touches a Dine-In table reconciles the table through the
 * server-authoritative TableStateService so table status never depends on the
 * frontend.
 */

import { orderRepo, orderItemRepo, kotRecordRepo, timelineEventRepo } from '../repositories';
import { tableStateService, type ReconcileCtx } from './tableStateService';

const TERMINAL_ORDER_STATUSES = ['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held'];

export class OrderService {
  /**
   * List orders with optional filtering by status, branch, date, or table.
   */
  async list(params: { status?: string; branchId?: string; date?: string; tableId?: string } = {}) {
    const query: any = {};
    if (params.status) query.status = params.status;
    if (params.branchId) query.branchId = params.branchId;
    if (params.date) query.createdAt = { $gte: new Date(params.date) };
    if (params.tableId) query.tableId = params.tableId;

    return orderRepo.findAll(query, { sort: { createdAt: -1 } });
  }

  /**
   * Get a single order with all related data (items, KOTs, timeline).
   */
  async getById(id: string) {
    const order = await orderRepo.findById(id);
    if (!order) return null;

    const [items, kots, timeline] = await Promise.all([
      orderItemRepo.findAll({ orderId: id } as any, { sort: { createdAt: 1 } }),
      kotRecordRepo.findAll({ orderId: id } as any, { sort: { kotNumber: 1 } }),
      timelineEventRepo.findAll({ orderId: id } as any, { sort: { createdAt: 1 } }),
    ]);

    return {
      ...order.toObject(),
      items: items.data,
      kotRecords: kots.data,
      timeline: timeline.data,
    };
  }

  /**
   * Create a new order with initial timeline event.
   * Reconciles the linked table (Dine-In) via the state machine.
   */
  async create(data: any, ctx: ReconcileCtx = {}) {
    const order = await orderRepo.create(data);

    await timelineEventRepo.create({
      orderId: order._id.toString(),
      type: 'order_created',
      description: `Order #${(order as any).orderNumber} created`,
      actor: data.cashierName || ctx.operator || 'System',
    } as any);

    // Create order items if provided
    if (data.items && Array.isArray(data.items)) {
      const itemDocs = data.items.map((item: any) => ({
        ...item,
        orderId: order._id.toString(),
      }));
      await orderItemRepo.bulkCreate(itemDocs as any);
    }

    // Server-authoritative table status — seat/open → Occupied
    if (data.tableId && (data.type || '').toLowerCase() === 'dine in') {
      await tableStateService.reconcileTable(data.tableId, ctx).catch(() => undefined);
    }

    return this.getById(order._id.toString());
  }

  /**
   * Update order fields and record timeline events for status changes.
   * Reconciles the linked table on every status change.
   */
  async update(id: string, data: any, ctx: ReconcileCtx = {}) {
    const { items, timelineEvent, ...orderData } = data;

    // Record timeline event if there's a status change
    if (orderData.status && timelineEvent !== false) {
      await timelineEventRepo.create({
        orderId: id,
        type: 'order_status_changed',
        description: `Order status changed to ${orderData.status}`,
        actor: orderData.updatedBy || ctx.operator || 'System',
      } as any);
    }

    const order = await orderRepo.update(id, orderData);
    if (!order) return null;

    // Update items if provided
    if (items && Array.isArray(items)) {
      await orderItemRepo.bulkDelete({ orderId: id } as any);
      if (items.length > 0) {
        const itemDocs = items.map((item: any) => ({ ...item, orderId: id }));
        await orderItemRepo.bulkCreate(itemDocs as any);
      }
    }

    // Server-authoritative table status — derive Occupied/Preparing/Food
    // Ready/Served/… or release on Paid/Closed/Cancelled.
    const tableId = (order as any).tableId || orderData.tableId;
    if (tableId) {
      await tableStateService.reconcileTable(tableId, ctx).catch(() => undefined);
    }

    return this.getById(id);
  }

  /**
   * Soft-delete an order. Releases the linked table if no other live order.
   */
  async delete(id: string, ctx: ReconcileCtx = {}) {
    const existing = await orderRepo.findById(id);
    const tableId = existing ? (existing as any).tableId : undefined;
    const deleted = await orderRepo.softDelete(id);
    if (!deleted) return null;

    if (tableId && !TERMINAL_ORDER_STATUSES.includes(String((existing as any).status))) {
      await tableStateService.reconcileTable(tableId, ctx).catch(() => undefined);
    }
    return deleted;
  }
}

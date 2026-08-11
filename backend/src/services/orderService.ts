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

import { orderRepo, orderItemRepo, kotRecordRepo, timelineEventRepo, takeawayOrderRepo } from '../repositories';
import { tableStateService, type ReconcileCtx } from './tableStateService';
import { OrderCounter, Order, TakeawayOrder } from '../models';
import KOTRecord, { kotToFrontend } from '../models/KOTRecord';

const TERMINAL_ORDER_STATUSES = ['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held'];

/**
 * Normalize a POS line item into the OrderItem doc shape.
 *
 * The POS frontend sends CartItem-shaped rows ({ id, product: {name, price},
 * selectedVariant, quantity, price, … }) — both when items are synced into an
 * order (usePOSState mirrors cartItems into order.items) and on KOT status
 * transitions (the whole order is PUT back). Persisting those rows verbatim
 * fails OrderItem validation (productName is required), which 500s the PUT
 * BEFORE the KOT upsert block runs — silently dropping every KOT status
 * transition on the server. Map to the backend subdoc just like the KOT items
 * below so the KDS on other terminals sees live Preparing/Ready/Served.
 */
function toOrderItemDoc(item: any): any {
  const product = item?.product || {};
  const productName =
    typeof item?.product === 'string' ? item.product
      : product.name || item?.productName || item?.itemName || item?.name || 'Item';
  const price =
    Number.isFinite(Number(item?.price))
      ? Number(item.price)
      : Number.isFinite(Number(product.price)) ? Number(product.price) : 0;
  return {
    productId: String(product._id || product.id || item?.productId || '') || undefined,
    productName,
    variantName: item?.selectedVariant?.name || item?.variantName,
    quantity: Math.max(1, Number(item?.quantity) || 1),
    price,
    notes: item?.notes,
    isFree: !!item?.isFree,
    kotPrinted: !!item?.kotPrinted,
  };
}

export class OrderService {
  /**
   * List orders with optional filtering by status, branch, date, table, or
   * restaurant (tenant isolation — the HTTP controller always passes the
   * authenticated restaurantId so one tenant can never see another's orders,
   * including legacy rows whose restaurantId was never stamped).
   */
  async list(params: { status?: string; branchId?: string; date?: string; tableId?: string; restaurantId?: string } = {}) {
    const query: any = {};
    if (params.status) query.status = params.status;
    if (params.branchId) query.branchId = params.branchId;
    if (params.date) query.createdAt = { $gte: new Date(params.date) };
    if (params.tableId) query.tableId = params.tableId;
    if (params.restaurantId) query.restaurantId = params.restaurantId;

    const result = await orderRepo.findAll(query, { sort: { createdAt: -1 } });
    const orders = result.data;
    if (orders.length === 0) return result;

    // Batch-embed kotRecords so the KDS poll (/orders list) sees KOTs from
    // every terminal + adjustment cancellations. Previously only GET /orders/:id
    // assembled them, so the kitchen display was blind to live KOTs.
    const ids = orders.map((o: any) => o._id);
    const kots = await kotRecordRepo.findAll({ orderId: { $in: ids } } as any, { sort: { kotNumber: 1 } });
    const byOrder = new Map<string, any[]>();
    for (const k of kots.data) {
      const oid = String((k as any).orderId);
      if (!byOrder.has(oid)) byOrder.set(oid, []);
      byOrder.get(oid)!.push(kotToFrontend(k));
    }

    result.data = orders.map((o: any) => ({
      ...(typeof o.toObject === 'function' ? o.toObject() : o),
      kotRecords: byOrder.get(String(o._id)) || [],
    })) as any;
    return result;
  }

  /**
   * Get a single order with all related data (items, KOTs, timeline). When a
   * restaurantId is supplied (HTTP layer) the lookup is tenant-scoped so an
   * order belonging to another restaurant is treated as not-found.
   */
  async getById(id: string, restaurantId?: string) {
    const order = restaurantId
      ? await orderRepo.findOne({ _id: id, restaurantId } as any)
      : await orderRepo.findById(id);
    if (!order) return null;

    const [items, kots, timeline] = await Promise.all([
      orderItemRepo.findAll({ orderId: id } as any, { sort: { createdAt: 1 } }),
      kotRecordRepo.findAll({ orderId: id } as any, { sort: { kotNumber: 1 } }),
      timelineEventRepo.findAll({ orderId: id } as any, { sort: { createdAt: 1 } }),
    ]);

    return {
      ...order.toObject(),
      items: items.data,
      kotRecords: kots.data.map(kotToFrontend),
      timeline: timeline.data,
    };
  }

  /**
   * Get the next unique order number using an atomic MongoDB counter.
   * Thread-safe across all POS terminals (findOneAndUpdate with $inc), so two
   * devices can never be handed the same order number. On first access the
   * counter is seeded from the highest order number already in use (both the
   * Order and TakeawayOrder collections — the frontend shares one series).
   */
  async getNextOrderNumber(startingNumber: number = 1001, _branchId?: string): Promise<number> {
    // ONE shared atomic series for the whole restaurant (POS dine-in, takeaway
    // and website orders). A per-branch counter seeded from the GLOBAL max
    // would collide with the base series (first branch order == first base
    // order number). The frontend relies on this single series, so branchId
    // is intentionally ignored for numbering (the branch is stored on the
    // order itself for routing/filtering).
    const name = 'order';
    const existing = await OrderCounter.findOne({ name }).lean();
    if (!existing) {
      const [orderMax, takeawayMax] = await Promise.all([
        Order.findOne({ isDeleted: { $ne: true } }).sort({ orderNumber: -1 }).select('orderNumber').lean(),
        TakeawayOrder.findOne({ isDeleted: { $ne: true } }).sort({ orderNumber: -1 }).select('orderNumber').lean(),
      ]);
      // Seed ABOVE the highest number already in use so the first returned
      // number is fresh (the $inc below pushes sequence to seed+1 and we
      // return sequence-1 → the first returned value is exactly `seed`).
      const seed = Math.max(
        ((orderMax as any)?.orderNumber || 0) + 1,
        ((takeawayMax as any)?.orderNumber || 0) + 1,
        startingNumber
      );
      await OrderCounter.updateOne({ name }, { $setOnInsert: { sequence: seed } }, { upsert: true });
    }

    const counter = await OrderCounter.findOneAndUpdate(
      { name },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return (counter?.sequence ?? startingNumber) - 1;
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

    // Create order items if provided — always mapped through toOrderItemDoc so
    // CartItem-shaped rows (product object, no productName) validate cleanly.
    if (data.items && Array.isArray(data.items)) {
      const itemDocs = data.items
        .filter((item: any) => item && !item.cancelled)
        .map((item: any) => ({ ...toOrderItemDoc(item), orderId: order._id.toString() }));
      await orderItemRepo.bulkCreate(itemDocs as any).catch((err: Error) => {
        console.warn('[orderService] item create skipped:', err?.message);
      });
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
    const { items, timelineEvent, kotRecords, ...orderData } = data;

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

    // Update items if provided. Mapped through toOrderItemDoc (see above) so
    // CartItem-shaped rows validate; wrapped in try/catch so an item failure
    // can NEVER block the KOT/status/takeaway persistence that follows — the
    // kitchen display must keep advancing even if line items are rejected.
    if (items && Array.isArray(items)) {
      try {
        await orderItemRepo.bulkDelete({ orderId: id } as any);
        if (items.length > 0) {
          const itemDocs = items
            .filter((item: any) => item && !item.cancelled)
            .map((item: any) => ({ ...toOrderItemDoc(item), orderId: id }));
          await orderItemRepo.bulkCreate(itemDocs as any);
        }
      } catch (err) {
        console.warn('[orderService] item persistence skipped:', (err as Error)?.message);
      }
    }

    // Persist KOT records — the POS sends its full kotRecords array on every
    // update; upsert by (orderId, kotNumber) so _ids stay stable for the KDS.
    // Items map from the POS CartItem shape to the backend subdoc (productId
    // enables adjustment → KOT line cancellation).
    if (kotRecords && Array.isArray(kotRecords) && /^[a-fA-F0-9]{24}$/.test(id)) {
      for (const kot of kotRecords) {
        const kotDoc: any = {
          orderId: id,
          kotNumber: Number(kot.kotNumber) || 1,
          type: ['Original', 'Additional', 'Reprint'].includes(kot.type) ? kot.type : 'Original',
          status: ['Accepted', 'Preparing', 'Ready', 'Served', 'Cancelled'].includes(kot.status)
            ? kot.status
            : 'Accepted',
          items: (Array.isArray(kot.items) ? kot.items : []).map((item: any) => {
            const product = item.product || {};
            const productId = String(product._id || product.id || item.productId || '');
            return {
              productId,
              lineId: item.id || item.lineId || undefined,
              itemName: product.name || item.productName || item.itemName || 'Item',
              quantity: Math.max(0, Number(item.quantity) || 0),
              price: Number.isFinite(Number(item.price)) ? Number(item.price) : undefined,
              notes: item.notes,
              variantName: item.selectedVariant?.name || item.variantName,
              cancelled: !!item.cancelled,
              cancelReason: item.cancelReason,
              cancelledAt: item.cancelledAt,
            };
          }),
          printedBy: kot.printedBy || 'System',
          printedAt: kot.printedAt ? new Date(kot.printedAt) : new Date(),
          note: kot.note,
        };
        await KOTRecord.updateOne(
          { orderId: id, kotNumber: kotDoc.kotNumber },
          { $set: kotDoc },
          { upsert: true }
        ).exec();
      }
    }

    // Server-authoritative table status — derive Occupied/Preparing/Food
    // Ready/Served/… or release on Paid/Closed/Cancelled.
    const tableId = (order as any).tableId || orderData.tableId;
    if (tableId) {
      await tableStateService.reconcileTable(tableId, ctx).catch(() => undefined);
    }

    // Sync status to TakeawayOrder if linked
    if (orderData.status) {
      const takeawayOrder = await takeawayOrderRepo.findOne({ orderId: id } as any);
      if (takeawayOrder) {
        let newTakeawayStatus: 'Preparing' | 'Ready' | 'Collected' | 'Completed' | null = null;
        if (orderData.status === 'Preparing') newTakeawayStatus = 'Preparing';
        else if (orderData.status === 'Ready') newTakeawayStatus = 'Ready';
        else if (orderData.status === 'Served') newTakeawayStatus = 'Collected';
        else if (orderData.status === 'Closed') newTakeawayStatus = 'Completed';

        if (newTakeawayStatus) {
          await takeawayOrderRepo.update((takeawayOrder as any)._id.toString(), { status: newTakeawayStatus });
        }
      }
    }

    // Live push: the customer track page (order:<clientRef> room) and every
    // POS terminal (restaurant:<id> room) hear status changes instantly.
    if (orderData.status) {
      const clientRef = (order as any).clientRef;
      const restaurantId = (order as any).restaurantId;
      if (typeof clientRef === 'string' || restaurantId) {
        const { emitToRestaurant, emitToOrder } = await import('../socket');
        const payload = { orderId: id, clientRef: clientRef || null, status: orderData.status };
        emitToRestaurant(restaurantId, 'order:updated', payload);
        emitToOrder(clientRef, 'order:updated', payload);
      }
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

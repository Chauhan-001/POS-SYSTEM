/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PublicStoreOrderService — customer-facing menu + cart validation + order
 * submission for online ordering. The customer WEBSITE UI is a separate
 * surface; this is the backend contract it consumes.
 *
 * Authoritative rules:
 *   - Availability comes from MenuAvailability (branch override → restaurant
 *     default → AVAILABLE). Inventory stock is NEVER consulted.
 *   - Prices are read server-side (Product price + branchPrice override).
 *   - Totals are computed server-side; the client's numbers are ignored.
 *   - Order submission re-validates every line: a stale cart (item disabled
 *     after it was added) gets a 409 with the unavailable subset, never a
 *     silent order or silently changed total.
 *   - Idempotency: optional clientRef → { restaurantId, clientRef } unique
 *     index (mirrors Bill.clientRef) so replays cannot duplicate orders.
 */

import mongoose from 'mongoose';
import Product from '../../../models/Product';
import Branch from '../../../models/Branch';
import BranchSettings from '../../../models/BranchSettings';
import Table from '../../../models/Table';
import KOTRecord from '../../../models/KOTRecord';
import QrToken from '../../qr-ordering/models/QrToken';
import CustomerRequest from '../../qr-ordering/models/CustomerRequest';
import { resolveRestaurantByToken } from './publicStoreService';
import { availabilityService } from '../../../services/availabilityService';
import { resolveMenuProductScope } from '../../../services/productService';
import { orderRepo, orderItemRepo, timelineEventRepo } from '../../../repositories';
import { AppError } from '../../../utils/AppError';

export interface PublicCartItem {
  productId: string;
  quantity: number;
}

/** Order statuses that mean the table is no longer occupied. */
const TERMINAL_ORDER_STATUSES = ['Paid', 'Closed', 'Cancelled', 'Refunded', 'Held', 'Completed', 'Voided'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class PublicStoreOrderService {
  /**
   * Resolve a branch id from the request body when provided; also enforce the
   * branch's online-ordering module toggle when a BranchSettings row exists.
   */
  private async resolveBranch(restaurantId: mongoose.Types.ObjectId, branchId?: string): Promise<mongoose.Types.ObjectId | null> {
    if (!branchId || !mongoose.Types.ObjectId.isValid(branchId)) return null;
    const oid = new mongoose.Types.ObjectId(branchId);
    // Branch must belong to this restaurant (tenant isolation).
    const branch = await Branch.findOne({ _id: oid, restaurantId, isDeleted: { $ne: true } }).lean().exec();
    if (!branch) throw new AppError(400, 'Invalid branch');
    // Respect the branch-level online-ordering toggle.
    const settings = await BranchSettings.findOne({ branchId: oid }).lean().exec();
    if (settings?.moduleSettings && (settings as any).moduleSettings.enableOnlineOrders === false) {
      throw new AppError(403, 'Online ordering is disabled for this location');
    }
    return oid;
  }

  /** Product price for the given branch (branchPrice override → base price). */
  private priceFor(product: any, branchId: mongoose.Types.ObjectId | null): number {
    const base = Number(product.price) || 0;
    if (branchId && product.branchPrice) {
      const override = Number(product.branchPrice.get?.(branchId.toString()) ?? product.branchPrice[branchId.toString()]);
      if (Number.isFinite(override) && override > 0) return override;
    }
    return base;
  }

  /**
   * GET /api/public-store/:token/menu — the customer menu with effective
   * online availability. Unavailable items are still listed (available:false)
   * so the site can render SOLD OUT; ?availableOnly=1 filters them out.
   */
  async getMenu(publicToken: string, options: { branchId?: string; availableOnly?: boolean } = {}) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;
    const branchOid = await this.resolveBranch(rid, options.branchId);

    // Own products only; shared/global catalog only as fresh-account fallback
    // when the restaurant owns zero products (never another tenant's rows).
    const scope = await resolveMenuProductScope(String(rid));
    const products = await Product.find({
      $or: scope,
      isDeleted: { $ne: true },
    })
      .sort({ category: 1, name: 1 })
      .lean()
      .exec();

    const productIds = products.map((p: any) => String(p._id));
    const availability = await availabilityService.getMap(rid.toString(), branchOid ? branchOid.toString() : null, productIds);

    const byCategory = new Map<string, any[]>();
    for (const p of products) {
      const state = availability.get(String(p._id)) || { status: 'AVAILABLE' as const, unavailableUntil: null, visibleOnSite: true };
      // Owner site-visibility control: visibleOnSite=false removes the item
      // from the customer website entirely (not even SOLD OUT).
      if (state.visibleOnSite === false) continue;
      const item = {
        id: String(p._id),
        name: (p as any).name,
        category: (p as any).category,
        price: this.priceFor(p, branchOid),
        gstPercent: (p as any).gstPercent ?? 5,
        image: (p as any).image || null,
        available: state.status === 'AVAILABLE',
        unavailableUntil: state.unavailableUntil || null,
      };
      if (options.availableOnly && !item.available) continue;
      const arr = byCategory.get(item.category) || [];
      arr.push(item);
      byCategory.set(item.category, arr);
    }

    return {
      store: {
        name: restaurant.brandName || restaurant.name,
        currency: restaurant.currency || 'INR',
        currencySymbol: '₹',
      },
      categories: Array.from(byCategory.entries()).map(([name, items]) => ({ name, items })),
      // Only count items actually listed (hidden products are excluded).
      totalItems: Array.from(byCategory.values()).reduce((n, items) => n + items.length, 0),
    };
  }

  /**
   * Validate a cart WITHOUT creating anything. Used by the customer site
   * before submission so a stale cart surfaces immediately.
   */
  async precheck(publicToken: string, items: PublicCartItem[], options: { branchId?: string } = {}) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;
    const branchOid = await this.resolveBranch(rid, options.branchId);
    const validated = await this.validateCart(rid, branchOid, items);

    return {
      ok: validated.unavailableItems.length === 0,
      items: validated.items,
      unavailableItems: validated.unavailableItems,
      subtotal: validated.subtotal,
      gst: validated.gst,
      grandTotal: validated.grandTotal,
    };
  }

  /**
   * Final authoritative validation + order creation. Returns 409 (via AppError)
   * when any line is unavailable — the customer must resolve the cart first.
   *
   * `mode` / `tableId` / `parkingSlot` / `carPlate` carry the QR ordering
   * context (table / drive-in car / pickup counter) that the customer site
   * bakes into its QR URL; the server stores it on the Order so the POS knows
   * exactly where the customer is.
   */
  async createOrder(
    publicToken: string,
    body: {
      branchId?: string;
      items: PublicCartItem[];
      customer?: { name?: string; phone?: string };
      deliveryAddress?: string;
      notes?: string;
      /** QR ordering context (from the sticker URL). */
      mode?: 'TABLE' | 'CAR' | 'PICKUP';
      tableId?: string;
      tableNumber?: number;
      parkingSlot?: string;
      carPlate?: string;
      /** Optional gratuity — added to the grand total, stored separately. */
      tip?: number;
      /** Optional idempotency key — replays return the original order. */
      clientRef?: string;
    }
  ) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;
    const branchOid = await this.resolveBranch(rid, body.branchId);
    const tip = Math.max(0, Number(body.tip) || 0);
    const mode = body.mode || null;

    // Tenant-safe table context: a customer may only place an order for a
    // table that belongs to THIS restaurant (never another tenant's table).
    // Graceful degradation: a sticker for a deleted/missing table must not
    // lose the sale — the order proceeds without a table link instead.
    let tableOid: mongoose.Types.ObjectId | undefined;
    if (body.tableId && mongoose.Types.ObjectId.isValid(body.tableId)) {
      const table = await Table.findOne({
        _id: new mongoose.Types.ObjectId(body.tableId),
        restaurantId: rid,
        isDeleted: { $ne: true },
      }).lean().exec();
      if (table) tableOid = table._id;
    }

    // Re-run the authoritative availability check (never trust a precheck).
    const validated = await this.validateCart(rid, branchOid, body.items || []);
    if (validated.unavailableItems.length > 0) {
      const err: any = new AppError(409, 'Some items in your order are no longer available');
      err.code = 'SOME_ITEMS_UNAVAILABLE';
      err.unavailableItems = validated.unavailableItems;
      throw err;
    }

    // Idempotent replay: same restaurant + clientRef → return existing order.
    if (body.clientRef) {
      try {
        const existing = await orderRepo.findOne({ restaurantId: rid, clientRef: body.clientRef } as any);
        if (existing) {
          // Heal a partially-created order: if a previous attempt crashed
          // between order creation and the auto-KOT, create the missing KOT
          // now so the kitchen is never left blind.
          await this.ensureAutoKotAndOccupy(existing, validated.items, (existing as any).mode || mode, rid, branchOid);
          return { order: existing.toObject(), items: validated.items, idempotent: true };
        }
      } catch { /* unique index guards the race below */ }
    }

    // ONE order per seating: a table with a live (open) order is locked.
    // The same QR must not mint a second order while the first is still
    // running — guests add food through their waiter instead. Replays of the
    // SAME clientRef are handled above (idempotent) and never reach here.
    if (mode === 'TABLE' && tableOid) {
      const occupying = await orderRepo.findOne({
        tableId: String(tableOid),
        status: { $nin: TERMINAL_ORDER_STATUSES },
      } as any);
      if (occupying) {
        const err: any = new AppError(
          409,
          'This table already has an open order. Please ask your server to add more items.',
        );
        err.code = 'TABLE_ALREADY_OCCUPIED';
        throw err;
      }
    }

    const { orderService } = await import('../../../services');
    const orderNumber = await orderService.getNextOrderNumber(1001, branchOid ? branchOid.toString() : undefined);

    const grandTotal = round2(validated.grandTotal + tip);
    const orderData: any = {
      orderNumber,
      type: 'Website',
      platform: 'Website',
      status: 'New',
      restaurantId: rid,
      branchId: branchOid || undefined,
      customerPhone: body.customer?.phone || undefined,
      customerName: body.customer?.name || undefined,
      deliveryAddress: body.deliveryAddress || undefined,
      specialInstructions: body.notes || undefined,
      mode: mode || undefined,
      tableId: tableOid || undefined,
      tableNumber: body.tableNumber || undefined,
      parkingSlot: body.parkingSlot || undefined,
      carPlate: body.carPlate || undefined,
      tip,
      subtotal: validated.subtotal,
      discount: 0,
      gst: validated.gst,
      grandTotal,
      originalGrandTotal: grandTotal,
      adjustedGrandTotal: grandTotal,
      amountRefunded: 0,
      amountDueAdditional: 0,
      adjustmentStatus: 'NONE',
    };
    if (body.clientRef) orderData.clientRef = body.clientRef;

    let order: any;
    try {
      order = await orderRepo.create(orderData);
    } catch (err: any) {
      if (err?.code === 11000 && body.clientRef) {
        // Race lost on the unique clientRef — return the winning order.
        const existing = await orderRepo.findOne({ restaurantId: rid, clientRef: body.clientRef } as any);
        if (existing) {
          await this.ensureAutoKotAndOccupy(existing, validated.items, (existing as any).mode || mode, rid, branchOid);
          return { order: existing.toObject(), items: validated.items, idempotent: true };
        }
      }
      throw err;
    }

    // Every item is KOT'd immediately (auto-sent to the kitchen display) so
    // the cook starts the moment the customer orders — no cashier action
    // required. kotPrinted=true tells the POS these lines are already in the
    // kitchen, so a later manual "send KOT" computes an empty delta instead of
    // duplicating the ticket.
    const itemDocs = validated.items.map((it: any) => ({
      orderId: order._id.toString(),
      productId: it.productId,
      productName: it.productName,
      quantity: it.quantity,
      price: it.price,
      isFree: false,
      kotPrinted: true,
    }));
    if (itemDocs.length > 0) {
      await orderItemRepo.bulkCreate(itemDocs as any);
      await this.ensureAutoKotAndOccupy(order, validated.items, mode, rid, branchOid);
    }

    await timelineEventRepo.create({
      orderId: order._id.toString(),
      type: 'order_created',
      description: `Online order #${orderNumber} created`,
      actor: body.customer?.name || 'Customer',
    } as any);

    // Live push: POS terminals hear `order:created` instantly; the customer's
    // track page hears `order:updated` on the clientRef room.
    const { emitToRestaurant, emitToOrder } = await import('../../../socket');
    const createdPayload = {
      orderId: order._id.toString(),
      orderNumber,
      clientRef: body.clientRef || null,
      status: 'New',
      grandTotal,
      mode: body.mode || null,
      tableId: body.tableId || null,
      tableNumber: body.tableNumber || null,
      parkingSlot: body.parkingSlot || null,
      carPlate: body.carPlate || null,
      items: validated.items,
    };
    emitToRestaurant(rid, 'order:created', createdPayload);
    emitToOrder(body.clientRef, 'order:updated', { status: 'New', orderNumber });

    // Surface the online order in the POS "Calls" service-bell panel so
    // staff acknowledge + view EVERY customer order — nothing slips through
    // unnoticed. Best-effort: a failed request row must never fail the sale.
    try {
      const summary = validated.items
        .slice(0, 4)
        .map((it: any) => `${it.quantity}× ${it.productName}`)
        .join(', ');
      const request = await CustomerRequest.create({
        sessionId: `online_${order._id.toString()}`,
        restaurantId: rid,
        branchId: branchOid || undefined,
        orderType: (mode || 'TABLE') as any,
        tableId: tableOid,
        carId: body.parkingSlot || body.carPlate || undefined,
        type: 'ONLINE_ORDER',
        priority: 'HIGH',
        status: 'PENDING',
        orderId: order._id,
        orderNumber,
        message: `${summary}${validated.items.length > 4 ? ` +${validated.items.length - 4} more` : ''}`,
      });
      emitToRestaurant(rid, 'waiter:call', {
        id: (request as any)._id.toString(),
        type: 'ONLINE_ORDER',
        orderType: mode || 'TABLE',
        branchId: branchOid ? String(branchOid) : null,
        tableId: body.tableId || null,
        tableNumber: body.tableNumber || null,
        parkingSlot: body.parkingSlot || null,
        carPlate: body.carPlate || null,
        orderId: order._id.toString(),
        orderNumber,
        grandTotal,
        itemsCount: validated.items.reduce((n: number, it: any) => n + it.quantity, 0),
        message: (request as any).message || null,
        createdAt: (request as any).createdAt,
      });
    } catch (err) {
      console.warn('[publicStore] online-order call row skipped:', (err as Error)?.message);
    }

    return {
      order: (await orderService.getById(order._id.toString())),
      items: validated.items,
      idempotent: false,
    };
  }

  /**
   * Auto-KOT #1 (Original) for a placed online order — a persisted snapshot
   * the Kitchen Display renders via getById → kotRecords, FIFO by printedAt
   * (oldest first). Also occupies the table for TABLE-mode orders via the
   * server-authoritative TableStateService. Idempotent (skips when the KOT
   * already exists) and best-effort (a failure must never fail the order).
   */
  private async ensureAutoKotAndOccupy(
    order: any,
    items: any[],
    mode: string | null,
    rid: mongoose.Types.ObjectId,
    branchOid: mongoose.Types.ObjectId | null
  ) {
    if (!order?._id || items.length === 0) return;
    try {
      const hasKot = await KOTRecord.exists({ orderId: order._id } as any);
      if (hasKot) return;
      await KOTRecord.create({
        orderId: order._id,
        kotNumber: 1,
        type: 'Original',
        status: 'Accepted',
        items: items.map((it: any) => ({
          productId: it.productId,
          lineId: it.productId,
          itemName: it.productName,
          quantity: it.quantity,
          price: it.price,
        })),
        printedBy: 'Customer',
        printedAt: new Date(),
        note: 'Auto-sent from online order',
      });
      if (mode === 'TABLE' && order.tableId) {
        const { tableStateService } = await import('../../../services');
        await tableStateService
          .reconcileTable(String(order.tableId), {
            restaurantId: String(rid),
            branchId: branchOid ? String(branchOid) : undefined,
            operator: 'Customer',
          })
          .catch(() => undefined);
      }
    } catch (err) {
      // The order itself is already persisted — never let a KOT hiccup 500
      // the sale (the cashier can still send it from the POS manually).
      console.warn('[publicStore] auto-KOT skipped:', (err as Error)?.message);
    }
  }

  /**
   * GET /api/public-store/:token/orders/:clientRef — track a placed order by
   * its idempotency key. Tenant-scoped (never returns another restaurant's
   * order) and deliberately minimal: status, totals, items, timeline.
   */
  async trackOrder(publicToken: string, clientRef: string) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;

    const order = await orderRepo.findOne({ restaurantId: rid, clientRef } as any);
    if (!order) throw new AppError(404, 'Order not found');

    const [items, timeline] = await Promise.all([
      orderItemRepo.findAll({ orderId: order._id.toString() } as any, { sort: { createdAt: 1 } }),
      timelineEventRepo.findAll({ orderId: order._id.toString() } as any, { sort: { createdAt: 1 } }),
    ]);

    return {
      order: {
        id: (order as any)._id.toString(),
        orderNumber: (order as any).orderNumber,
        status: (order as any).status,
        subtotal: (order as any).subtotal,
        discount: (order as any).discount || 0,
        gst: (order as any).gst,
        tip: (order as any).tip || 0,
        grandTotal: (order as any).grandTotal,
        mode: (order as any).mode || null,
        tableNumber: (order as any).tableNumber || null,
        parkingSlot: (order as any).parkingSlot || null,
        carPlate: (order as any).carPlate || null,
        createdAt: (order as any).createdAt,
        estimatedWaitMin: (order as any).deliveryEta || null,
      },
      items: (items as any).data || [],
      timeline: ((timeline as any).data || []).map((t: any) => ({
        type: t.type,
        description: t.description,
        createdAt: t.createdAt,
      })),
    };
  }

  /**
   * POST /api/public-store/:token/requests — a customer service request
   * (call waiter / water / bill / assistance) from the QR ordering site.
   * Creates a tenant-scoped CustomerRequest that the POS service bell lists.
   */
  async createWaiterRequest(
    publicToken: string,
    body: {
      mode?: 'TABLE' | 'CAR' | 'PICKUP';
      branchId?: string;
      tableId?: string;
      parkingSlot?: string;
      carPlate?: string;
      name?: string;
      phone?: string;
      type?: 'water' | 'tissue' | 'bill' | 'assistance' | 'custom';
      message?: string;
    }
  ) {
    const restaurant = await resolveRestaurantByToken(publicToken);
    const rid = restaurant._id;
    const mode = body.mode || 'TABLE';
    const reason = body.type || 'custom';

    const TYPE_MAP: Record<string, string> = {
      water: 'WATER',
      bill: 'BILL',
      assistance: 'ASSISTANCE',
      tissue: 'CLEANING',
      custom: 'CALL_WAITER',
    };

    const tableOid =
      body.tableId && mongoose.Types.ObjectId.isValid(body.tableId)
        ? new mongoose.Types.ObjectId(body.tableId)
        : undefined;

    // Branch isolation: derive the request's branch so a multi-branch POS
    // bell only sees its own location. Priority: explicit branchId (validated
    // to belong to this restaurant) → the table's branch (TABLE mode) → the
    // sticker's baked branch (QrToken). Never accept another tenant's branch.
    let branchOid: mongoose.Types.ObjectId | null = null;
    if (body.branchId && mongoose.Types.ObjectId.isValid(body.branchId)) {
      const branch = await Branch.findOne({ _id: body.branchId, restaurantId: rid, isDeleted: { $ne: true } }).lean().exec();
      if (!branch) throw new AppError(400, 'Invalid branch');
      branchOid = branch._id;
    } else if (tableOid) {
      const table = await Table.findOne({ _id: tableOid, restaurantId: rid, isDeleted: { $ne: true } }).lean().exec();
      if (table?.branchId) branchOid = table.branchId;
    }
    if (!branchOid) {
      // Sticker fallback: QrToken.token is the opaque `qr_…` capability, while
      // the public `pbl_…` token lives inside the generated url — so match by
      // url, still tenant-scoped to this restaurant.
      const tokenRow = await QrToken.findOne({
        url: new RegExp(publicToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        restaurantId: rid,
        active: { $ne: false },
      }).lean().exec();
      if (tokenRow?.branchId) branchOid = tokenRow.branchId;
    }

    const request = await CustomerRequest.create({
      sessionId: `pub_${publicToken.slice(0, 12)}_${mode}_${tableOid || body.parkingSlot || body.carPlate || 'guest'}`,
      restaurantId: rid,
      branchId: branchOid || undefined,
      orderType: mode,
      tableId: tableOid,
      carId: body.parkingSlot || body.carPlate || undefined,
      customer: { name: body.name, phone: body.phone },
      type: (TYPE_MAP[reason] || 'CALL_WAITER') as any,
      priority: 'MEDIUM',
      status: 'PENDING',
      message: body.message,
    });

    // Live push: POS service bell hears `waiter:call` immediately.
    const { emitToRestaurant } = await import('../../../socket');
    emitToRestaurant(rid, 'waiter:call', {
      id: (request as any)._id.toString(),
      type: (request as any).type,
      orderType: mode,
      branchId: branchOid ? String(branchOid) : null,
      tableId: body.tableId || null,
      parkingSlot: body.parkingSlot || null,
      carPlate: body.carPlate || null,
      message: body.message || null,
      createdAt: (request as any).createdAt,
    });

    return { request };
  }

  /**
   * Shared authoritative cart validation: availability + price + totals.
   */
  private async validateCart(
    rid: mongoose.Types.ObjectId,
    branchOid: mongoose.Types.ObjectId | null,
    items: PublicCartItem[]
  ) {
    const unique = new Map<string, number>();
    for (const it of items || []) {
      if (!mongoose.Types.ObjectId.isValid(it.productId)) throw new AppError(400, `Invalid product id: ${it.productId}`);
      const qty = Math.max(1, Number(it.quantity) || 1);
      unique.set(it.productId, (unique.get(it.productId) || 0) + qty);
    }

    const productIds = Array.from(unique.keys());
    const products = await Product.find({
      _id: { $in: productIds.map((p) => new mongoose.Types.ObjectId(p)) },
      $or: [{ restaurantId: rid }, { restaurantId: null }],
      isDeleted: { $ne: true },
    }).lean().exec();

    const byId = new Map(products.map((p: any) => [String(p._id), p]));
    const availability = await availabilityService.getMap(rid.toString(), branchOid ? branchOid.toString() : null, productIds);

    const validatedItems: any[] = [];
    const unavailableItems: any[] = [];
    let subtotal = 0;
    let gst = 0;

    for (const [pid, qty] of unique.entries()) {
      const product = byId.get(pid);
      if (!product) {
        unavailableItems.push({ productId: pid, name: 'Item', reason: 'Not found' });
        continue;
      }
      const state = availability.get(pid) || { status: 'AVAILABLE' as const, visibleOnSite: true };
      // Owner hid the item from the site — a stale cart must not slip through.
      if (state.visibleOnSite === false) {
        unavailableItems.push({ productId: pid, name: (product as any).name, reason: 'No longer listed on the menu' });
        continue;
      }
      if (state.status !== 'AVAILABLE') {
        unavailableItems.push({ productId: pid, name: (product as any).name, reason: state.reason || 'Sold out' });
        continue;
      }
      const price = this.priceFor(product, branchOid);
      const lineTotal = round2(price * qty);
      subtotal = round2(subtotal + lineTotal);
      gst = round2(gst + (lineTotal * ((product as any).gstPercent ?? 5)) / 100);
      validatedItems.push({
        productId: pid,
        productName: (product as any).name,
        quantity: qty,
        price,
        lineTotal,
      });
    }

    return {
      items: validatedItems,
      unavailableItems,
      subtotal,
      gst,
      grandTotal: round2(subtotal + gst),
    };
  }
}

export const publicStoreOrderService = new PublicStoreOrderService();

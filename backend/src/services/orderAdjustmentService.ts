/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * OrderAdjustmentService — the unavailable-item fallback workflow for orders
 * already submitted (the "restaurant forgot to disable it" safety net).
 *
 * Actions (all amounts derived server-side from line snapshots — the client
 * never sends prices):
 *   REMOVE  : drop item(s), reduce the payable/refund the difference.
 *   REPLACE : swap unavailable item for another product, compute delta
 *             (costlier → additionalDue with explicit customer authorization;
 *             cheaper → refund difference).
 *   CANCEL  : cancel the whole order and refund the paid amount.
 *
 * Idempotency: `adjustmentId` unique key — duplicate submissions return the
 * existing adjustment instead of applying twice (no double refunds).
 *
 * Refund paths:
 *   - Ledger (POS cash/UPI billed): BillService.refundBill (manager PIN
 *     required) — the bill's isRefunded flag is the confirmation.
 *   - Online payment (future): RefundRecord + gateway refund, SUCCEEDED only
 *     when the provider returns a refund id.
 *
 * Optional: markUnavailable flips MenuAvailability so the item stops being
 * orderable for NEW orders (opt-in; also the "auto-mark sold-out" behavior).
 */

import mongoose from 'mongoose';
import { orderRepo, orderItemRepo, kotRecordRepo, billRepo, auditLogRepo, timelineEventRepo } from '../repositories';
import { kotToFrontend } from '../models/KOTRecord';
import OrderAdjustment, { AdjustmentLine } from '../models/OrderAdjustment';
import Product from '../models/Product';
import Payment from '../models/Payment';
import BranchSettings from '../models/BranchSettings';
import { billService, refundService } from './index';

// NOTE: billService is referenced lazily inside methods (never at module load)
// to keep the services barrel's circular imports safe.
import { availabilityService } from './availabilityService';
import { AppError } from '../utils/AppError';

export interface AdjustItemInput {
  orderItemId?: string;
  productId?: string;
  quantity: number;
  replaceWithProductId?: string;
}

export interface AdjustOrderInput {
  adjustmentId: string;
  action: 'REMOVE' | 'REPLACE' | 'CANCEL';
  items?: AdjustItemInput[];
  reason: string;
  markUnavailable?: boolean;
  managerPin?: string;
}

export interface AdjustCtx {
  restaurantId?: string;
  branchId?: string;
  operator?: string;
  operatorId?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Resolve the product reference from an order/KOT item — the POS stores the
 * product object (product.id/_id) while some legacy rows carry productId.
 * Either shape must match KOT lines for the KDS cancellation sync. */
function resolveProductId(item: any): string | undefined {
  if (item.productId) return String(item.productId);
  const p = item.product;
  if (p) {
    const id = p._id || p.id;
    if (id) return String(id);
  }
  return undefined;
}

function toLine(item: any): AdjustmentLine {
  return {
    orderItemId: item._id ? item._id.toString() : undefined,
    productId: resolveProductId(item),
    productName: item.productName || (item.product?.name as string) || 'Item',
    quantity: Number(item.quantity) || 0,
    price: Number(item.price) || 0,
  };
}

export class OrderAdjustmentService {
  /**
   * Apply an adjustment to an order. Throws AppError for invalid state;
   * returns a summary with the adjustment, refreshed order, and any refund.
   */
  async adjust(orderId: string, input: AdjustOrderInput, ctx: AdjustCtx = {}) {
    if (!mongoose.Types.ObjectId.isValid(orderId)) throw new AppError(400, 'Invalid order id');

    // ── Idempotency: same adjustmentId → return the existing result ───
    const existing = await OrderAdjustment.findOne({ adjustmentId: input.adjustmentId }).lean().exec();
    if (existing) {
      const order = await orderRepo.findById(orderId);
      return { adjustment: existing, order: order ? order.toObject() : null, idempotent: true };
    }

    // ── Load order + lines with tenant isolation ─────────────────────
    const order = await orderRepo.findById(orderId);
    if (!order) throw new AppError(404, 'Order not found');
    const orderAny = order as any;
    if (ctx.restaurantId && orderAny.restaurantId && orderAny.restaurantId.toString() !== ctx.restaurantId) {
      throw new AppError(404, 'Order not found');
    }
    // Resolve the tenant object id: order stamp → JWT context (legacy orders
    // created before restaurantId stamping self-heal on first adjustment).
    let restOid: mongoose.Types.ObjectId;
    if (orderAny.restaurantId) {
      restOid = orderAny.restaurantId;
    } else if (ctx.restaurantId && mongoose.Types.ObjectId.isValid(ctx.restaurantId)) {
      restOid = new mongoose.Types.ObjectId(ctx.restaurantId);
    } else {
      throw new AppError(400, 'Restaurant context required for adjustment');
    }
    if (['Closed', 'Cancelled', 'Refunded'].includes(String(orderAny.status))) {
      throw new AppError(400, `Order is already ${orderAny.status} — no further adjustments allowed`);
    }

    // Auto-mark sold-out opt-in: when the restaurant enabled
    // `autoMarkSoldOutFromOrder` in branch settings, any item removed from an
    // incoming order is ALSO blocked for NEW online orders (no per-click
    // checkbox needed). Explicit per-adjustment opt-out not supported — the
    // setting is the single source of truth for this behavior.
    if (!input.markUnavailable && orderAny.branchId) {
      try {
        const settings = await BranchSettings.findOne({
          branchId: orderAny.branchId,
          ...(restOid ? { restaurantId: restOid } : {}),
        })
          .lean()
          .exec();
        const mod = (settings as any)?.moduleSettings;
        if (mod && mod.autoMarkSoldOutFromOrder === true) {
          input.markUnavailable = true;
        }
      } catch {
        /* settings lookup is best-effort — never block an adjustment on it */
      }
    }

    const itemsRes = await orderItemRepo.findAll({ orderId, isDeleted: { $ne: true } } as any, { sort: { createdAt: 1 } });
    const originalItems: any[] = itemsRes.data;
    const originalTotal = Number(orderAny.grandTotal) || 0;

    // ── Compute the adjustment server-side ───────────────────────────
    const removedLines: AdjustmentLine[] = [];
    const addedLines: AdjustmentLine[] = [];
    let removedAmount = 0;
    let addedAmount = 0;
    let markProductIds: string[] = [];

    if (input.action === 'CANCEL') {
      // Refund the full line value of every remaining item.
      for (const item of originalItems) {
        const amount = (Number(item.price) || 0) * (Number(item.quantity) || 0);
        removedLines.push(toLine(item));
        removedAmount += amount;
        const pid = resolveProductId(item);
        if (pid) markProductIds.push(pid);
      }
    } else {
      const items = input.items || [];
      const consumed = new Set<string>();

      for (const req of items) {
        const qty = Math.max(1, Number(req.quantity) || 1);

        // Match the target line by orderItemId first, then productId.
        let target: any | undefined;
        if (req.orderItemId) {
          target = originalItems.find((it: any) => String(it._id) === req.orderItemId);
        }
        if (!target && req.productId) {
          target = originalItems.find(
            (it: any) => resolveProductId(it) === req.productId && !consumed.has(String(it._id))
          );
        }
        if (!target) throw new AppError(400, 'Item not found on this order');

        const availableQty = Number(target.quantity) || 0;
        const removeQty = Math.min(qty, availableQty);
        if (removeQty <= 0) throw new AppError(400, 'Item quantity already zero');
        consumed.add(String(target._id));

        const line = toLine(target);
        line.quantity = removeQty;
        removedLines.push(line);
        removedAmount += (Number(target.price) || 0) * removeQty;
        const pid = resolveProductId(target);
        if (pid) markProductIds.push(pid);

        // REPLACE — look up the replacement price server-side (authoritative).
        if (input.action === 'REPLACE' && req.replaceWithProductId) {
          if (!mongoose.Types.ObjectId.isValid(req.replaceWithProductId)) {
            throw new AppError(400, 'Invalid replacement product id');
          }
          const replacement = await Product.findById(req.replaceWithProductId).lean().exec();
          if (!replacement || (replacement as any).isDeleted) {
            throw new AppError(404, 'Replacement product not found');
          }
          const branchPrice = ctx.branchId && (replacement as any).branchPrice
            ? Number((replacement as any).branchPrice.get?.(ctx.branchId) ?? (replacement as any).branchPrice[ctx.branchId])
            : undefined;
          const price = Number.isFinite(branchPrice) && branchPrice! > 0 ? branchPrice! : Number(replacement.price) || 0;
          addedLines.push({
            productId: String(replacement._id),
            productName: (replacement as any).name || 'Item',
            quantity: removeQty,
            price,
          });
          addedAmount += price * removeQty;
        }
      }
    }

    // GST-proportional attribution: line prices are pre-tax, but the customer
    // pays the grand total (subtotal + GST). Scale removed/added line amounts by
    // the order's tax factor so a full CANCEL refunds the ENTIRE grand total and
    // partial removals carry their fair share of tax (no money left dangling).
    const subtotal = Number(orderAny.subtotal) || 0;
    const taxFactor = subtotal > 0 ? originalTotal / subtotal : 1;
    const newTotal = round2(Math.max(0, originalTotal - removedAmount * taxFactor + addedAmount * taxFactor));
    const delta = round2(newTotal - originalTotal);
    const refundRequired = round2(delta < 0 ? -delta : 0);
    const additionalDue = round2(delta > 0 ? delta : 0);

    // ── Build the after-snapshot (remaining lines + replacements) ────
    const itemsAfter: AdjustmentLine[] = [];
    const remaining = originalItems.filter((it) => !removedLines.some((r) => r.orderItemId === String(it._id)));
    for (const it of remaining) itemsAfter.push(toLine(it));
    for (const a of addedLines) itemsAfter.push(a);

    // ── Persist the append-only adjustment record ────────────────────
    // Unique adjustmentId → a concurrent duplicate submission loses the
    // create race and re-fetches the winning record (never applies twice).
    let adjustment: any;
    try {
      adjustment = await OrderAdjustment.create({
        adjustmentId: input.adjustmentId,
        orderId: new mongoose.Types.ObjectId(orderId),
        restaurantId: restOid,
        branchId: orderAny.branchId || null,
        action: input.action,
        itemsBefore: originalItems.map(toLine),
        itemsAfter,
        originalTotal: round2(originalTotal),
        newTotal,
        delta,
        refundRequired,
        additionalDue,
        reason: input.reason,
        markUnavailable: !!input.markUnavailable,
        performedBy: ctx.operator || 'System',
        performedById: ctx.operatorId || undefined,
      } as any);
    } catch (err: any) {
      if (err?.code === 11000) {
        // Race lost on the unique adjustmentId — return the winner untouched.
        const winner = await OrderAdjustment.findOne({ adjustmentId: input.adjustmentId }).lean().exec();
        const orderAfter = await orderRepo.findById(orderId);
        return {
          adjustment: winner,
          order: orderAfter ? orderAfter.toObject() : null,
          refund: null,
          idempotent: true,
        };
      }
      throw err;
    }

    // ── Mutate the order items (soft-delete removed, add replacements) ─
    for (const r of removedLines) {
      if (r.orderItemId) {
        await orderItemRepo.update(r.orderItemId, { isDeleted: true } as any);
      }
    }
    for (const a of addedLines) {
      await orderItemRepo.create({
        orderId: new mongoose.Types.ObjectId(orderId),
        productId: a.productId,
        productName: a.productName,
        quantity: a.quantity,
        price: a.price,
        isFree: false,
        kotPrinted: false,
      } as any);
    }

    // ── Update the order financial snapshot (original total preserved) ─
    const isCancel = input.action === 'CANCEL';
    const update: any = {
      adjustedGrandTotal: newTotal,
      adjustmentStatus: isCancel ? 'CANCELLED' : 'ADJUSTED',
    };
    if (refundRequired > 0) {
      update.amountRefunded = round2((Number(orderAny.amountRefunded) || 0) + refundRequired);
    }
    if (additionalDue > 0) {
      update.amountDueAdditional = round2((Number(orderAny.amountDueAdditional) || 0) + additionalDue);
    }
    if (isCancel) {
      update.status = 'Cancelled';
      update.closedAt = new Date();
    }
    await orderRepo.update(orderId, update as any);

    // ── KOT/KDS sync: mark matching KOT lines cancelled ─────────────
    // The KDS renders kotRecords from /orders; when an item is removed it must
    // show the strikethrough immediately, not just the next order-item fetch.
    // Match KOT items by productId (and variantName where recorded).
    if (markProductIds.length > 0) {
      try {
        const kots = await kotRecordRepo.findAll({ orderId } as any, { sort: { kotNumber: 1 } });
        for (const kot of kots.data) {
          const kotAny = kot as any;
          const items = Array.isArray(kotAny.items) ? kotAny.items : [];
          let changed = false;
        for (const item of items) {
          const pid = resolveProductId(item);
          if (pid && markProductIds.includes(pid) && !item.cancelled) {
              item.cancelled = true;
              item.cancelReason = input.reason;
              item.cancelledAt = new Date().toISOString();
              changed = true;
            }
          }
          if (changed) {
            await kotRecordRepo.update(String((kot as any)._id), { items } as any);
          }
        }
      } catch (err: any) {
        console.warn('[OrderAdjustmentService] KOT cancellation sync failed (non-fatal):', err?.message);
      }
    }

    // ── Timeline events ──────────────────────────────────────────────
    await timelineEventRepo.create({
      orderId,
      type: isCancel ? 'order_cancelled' : 'item_removed',
      description: isCancel
        ? `Order #${orderAny.orderNumber} cancelled — ${input.reason}`
        : `Items removed/replaced — ${input.reason}`,
      actor: ctx.operator || 'System',
    } as any);

    // ── Refund handling ──────────────────────────────────────────────
    let refund: any = null;
    let refundPendingReason: string | undefined;

    if (refundRequired > 0) {
      // Prefer an online gateway payment if one exists for this order.
      const payment = await Payment.findOne({ orderId: new mongoose.Types.ObjectId(orderId), status: 'success' })
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      if (payment && (payment as any).razorpayPaymentId) {
        const record = await refundService.create({
          refundId: `rfd_${input.adjustmentId.slice(4)}`,
          orderId,
          restaurantId: restOid.toString(),
          branchId: orderAny.branchId ? orderAny.branchId.toString() : null,
          amount: refundRequired,
          gateway: 'razorpay',
          paymentRef: (payment as any).razorpayPaymentId,
          reason: input.reason,
          performedBy: ctx.operator || 'System',
          performedById: ctx.operatorId,
        });
        try {
          refund = await refundService.refundOnlinePayment(record, Math.round(refundRequired * 100));
        } catch (err: any) {
          refund = record;
          refundPendingReason = `Gateway refund failed — ${err?.message || 'please retry'}`;
        }
      } else {
        // Cash-ledger refund through the existing immutable bill engine.
        const bill = await billRepo.findOne({
          orderId: new mongoose.Types.ObjectId(orderId),
          isRefunded: { $ne: true },
          isVoided: { $ne: true },
        } as any);
        if (bill) {
          if (!input.managerPin) {
            refundPendingReason = 'Refund requires a manager PIN';
          } else {
            const refundLines = removedLines.map((r) => ({
              menuItemId: r.productId,
              itemName: r.productName,
              quantity: r.quantity,
            }));
            const refundedBill = await billService.refundBill(
              String((bill as any)._id),
              {
                items: refundLines,
                reason: input.reason,
                refundedBy: ctx.operator || 'System',
                managerPin: input.managerPin,
              },
              { restaurantId: ctx.restaurantId, branchId: ctx.branchId }
            );
            // BillService confirmed — record the ledger refund as SUCCEEDED.
            refund = await refundService.create({
              refundId: `rfd_${input.adjustmentId.slice(4)}`,
              orderId,
              restaurantId: restOid.toString(),
              branchId: orderAny.branchId ? orderAny.branchId.toString() : null,
              amount: refundRequired,
              gateway: 'ledger',
              billId: String((bill as any)._id),
              reason: input.reason,
              performedBy: ctx.operator || 'System',
              performedById: ctx.operatorId,
            });
            if (refund) {
              refund = await refundService.markSucceeded(String(refund.refundId), undefined);
            }
            refund = { ...(refund?.toObject?.() || refund), bill: refundedBill };
          }
        } else {
          // No bill on record — the amount is simply no longer payable.
          refund = null;
        }
      }
    }

    // ── Optional: mark the item unavailable for NEW online orders ────
    if (input.markUnavailable && markProductIds.length > 0 && ctx.restaurantId) {
      try {
        await availabilityService.setBulk(
          ctx.restaurantId,
          markProductIds.map((pid) => ({ productId: pid, status: 'UNAVAILABLE' as const, reason: input.reason })),
          {
            branchId: ctx.branchId,
            operator: ctx.operator,
            operatorId: ctx.operatorId,
            source: 'order_adjustment',
          }
        );
      } catch (err: any) {
        console.warn('[OrderAdjustmentService] markUnavailable failed (non-fatal):', err?.message);
      }
    }

    // ── Audit ────────────────────────────────────────────────────────
    auditLogRepo.create({
      action: isCancel ? 'order.cancelled' : 'order.adjusted',
      entityType: 'order',
      entityId: orderId,
      performedBy: ctx.operator || 'System',
      performedById: ctx.operatorId || undefined,
      restaurantId: orderAny.restaurantId || undefined,
      branchId: orderAny.branchId || undefined,
      details: {
        adjustmentId: input.adjustmentId,
        action: input.action,
        originalTotal: round2(originalTotal),
        newTotal,
        delta,
        refundRequired,
        additionalDue,
        reason: input.reason,
        markUnavailable: !!input.markUnavailable,
      },
    } as any).catch((err: any) => console.warn('[OrderAdjustmentService] audit write failed:', err?.message));

    // ── Live push: every POS terminal + the customer track page hear the
    // adjustment instantly (KDS refetches orders → cancelled KOT lines appear
    // immediately). Uses the same lazy socket import as orderService.
    try {
      const clientRef = (orderAny as any).clientRef;
      const restaurantId = orderAny.restaurantId || ctx.restaurantId;
      if (typeof clientRef === 'string' || restaurantId) {
        const { emitToRestaurant, emitToOrder } = await import('../socket');
        const payload = {
          orderId,
          clientRef: clientRef || null,
          status: orderAny.status,
          adjusted: true,
          adjustmentId: input.adjustmentId,
        };
        emitToRestaurant(restaurantId, 'order:updated', payload);
        emitToOrder(clientRef, 'order:updated', payload);
      }
    } catch (err: any) {
      console.warn('[OrderAdjustmentService] socket emit failed (non-fatal):', err?.message);
    }

    // Assemble the refreshed order with items + kotRecords so the calling POS
    // can swap its local order in one shot (no second fetch needed).
    const refreshed = await orderRepo.findById(orderId);
    let refreshedWithKots: any = null;
    if (refreshed) {
      const kots = await kotRecordRepo.findAll({ orderId } as any, { sort: { kotNumber: 1 } });
      refreshedWithKots = {
        ...refreshed.toObject(),
        kotRecords: kots.data.map(kotToFrontend),
      };
    }
    return {
      adjustment,
      order: refreshedWithKots,
      refund,
      refundPendingReason,
      idempotent: false,
    };
  }

  /** List adjustments for an order (append-only history). */
  async listForOrder(orderId: string, ctx: { restaurantId?: string } = {}): Promise<any[]> {
    if (!mongoose.Types.ObjectId.isValid(orderId)) return [];
    const rows = await OrderAdjustment.find({ orderId: new mongoose.Types.ObjectId(orderId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    // Tenant guard: filter out adjustments from another restaurant if known.
    if (ctx.restaurantId && rows.length > 0) {
      return rows.filter((r) => !r.restaurantId || r.restaurantId.toString() === ctx.restaurantId);
    }
    return rows;
  }
}

export const orderAdjustmentService = new OrderAdjustmentService();

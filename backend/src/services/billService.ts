/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bill Service — Business logic for payment billing (immutable records).
 * Bills are append-only: once created, they are never modified.
 * Line items are stored in BillItem with historical snapshots (priceAtSale).
 *
 * Transactional integrity: Bill creation updates customer visits/points,
 * inventory, daily summary — all in a single transaction if possible.
 *
 * Invoice numbering: Uses an atomic MongoDB counter (InvoiceCounter model)
 * to prevent duplicate invoice numbers across multiple POS terminals.
 */

import mongoose from 'mongoose';
import { billRepo, billItemRepo, customerRepo, employeeRepo, auditLogRepo, dailySummaryRepo } from '../repositories';
import { InvoiceCounter, DailySummary, MonthlySummary, YearlySummary, Customer } from '../models';
import { stockMovementService } from './stockMovementService';
import { loyaltyService } from './index';
import { verifyPin } from '../utils/bcrypt';
import { AppError } from '../utils/AppError';

/**
 * Best-effort stock deduction for a bill's line items. Each item deducts from
 * its product via the centralized stock engine. Failures are logged but NEVER
 * fail the bill (billing must not break). Overselling is clamped per-item.
 */
async function deductBillStock(items: any[], ctx: { restaurantId?: string; branchId?: string; operator?: string }) {
  if (!ctx.restaurantId || !Array.isArray(items)) return;
  for (const item of items) {
    const productId = item?.product?.id || item?.menuItemId;
    const qty = Number(item?.quantity) || 0;
    if (!productId || qty <= 0) continue;
    try {
      await stockMovementService.applyMovement({
        restaurantId: ctx.restaurantId,
        branchId: ctx.branchId,
        productId,
        delta: -qty,
        type: 'sale',
        unit: 'pcs',
        operator: ctx.operator || 'System',
        allowNegative: true, // clamp to zero — never block billing
      });
    } catch (err: any) {
      console.warn('[BillService] stock deduction skipped for item:', item?.itemName || productId, err.message);
    }
  }
}

/**
 * Best-effort stock restore when a bill is voided (return movement).
 */
async function restoreBillStock(items: any[], ctx: { restaurantId?: string; branchId?: string; operator?: string }) {
  if (!ctx.restaurantId || !Array.isArray(items)) return;
  for (const item of items) {
    const productId = item?.menuItemId || item?.product?.id;
    const qty = Number(item?.quantity) || 0;
    if (!productId || qty <= 0) continue;
    try {
      await stockMovementService.applyMovement({
        restaurantId: ctx.restaurantId,
        branchId: ctx.branchId,
        productId,
        delta: qty,
        type: 'return',
        unit: 'pcs',
        operator: ctx.operator || 'System',
      });
    } catch (err: any) {
      console.warn('[BillService] stock restore skipped for item:', item?.itemName || productId, err.message);
    }
  }
}

export class BillService {
  /**
   * Get the next invoice number atomically from MongoDB.
   * Uses findOneAndUpdate with $inc for thread-safe increments.
   * Falls back to counting existing bills + 1 if counter doesn't exist.
   *
   * @param startingNumber - The initial number if counter doesn't exist (default: 1001)
   * @returns The next unique invoice number
   */
  async getNextInvoiceNumber(startingNumber: number = 1001): Promise<number> {
    const counter = await InvoiceCounter.findOneAndUpdate(
      { name: 'invoice' },
      { $inc: { sequence: 1 } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    // On upsert (first call), sequence is startingNumber, so the first
    // returned value is startingNumber + 1. We subtract 1 to return
    // the starting number as the first invoice.
    // On subsequent calls, $inc has already incremented, so we return
    // the post-increment value minus 1.
    return (counter?.sequence ?? startingNumber) - 1;
  }
  /**
   * List bills with optional filtering by date, branch, payment method.
   * Restaurant isolation: scoped to the requesting restaurant when known.
   */
  async list(params: { date?: string; branchId?: string; paymentMethod?: string; startDate?: string; endDate?: string; restaurantId?: string } = {}) {
    const query: any = {};
    if (params.date) query.date = params.date;
    if (params.branchId) query.branchId = params.branchId;
    if (params.paymentMethod) query.paymentMethod = params.paymentMethod;
    if (params.startDate) query.date = { ...query.date, $gte: params.startDate };
    if (params.endDate) query.date = { ...query.date, $lte: params.endDate };
    // Tenant isolation — never leak another restaurant's ledger. Legacy bills
    // created before restaurantId stamping have no restaurantId; include them
    // so historical data never disappears from Receipt History / reports.
    if (params.restaurantId) query.restaurantId = { $in: [params.restaurantId, null] };

    return billRepo.findAll(query, { sort: { createdAt: -1 } });
  }

  /**
   * Get a single bill with its line items. Scoped to the restaurant.
   */
  async getById(id: string, ctx: { restaurantId?: string } = {}) {
    const bill = await billRepo.findById(id);
    if (!bill) return null;
    // Tenant isolation — a bill outside the requester's restaurant is not found.
    if (ctx.restaurantId && (bill as any).restaurantId && (bill as any).restaurantId.toString() !== ctx.restaurantId) {
      return null;
    }

    const items = await billItemRepo.findAll({ billId: id } as any, { sort: { createdAt: 1 } });
    return {
      ...bill.toObject(),
      items: items.data,
    };
  }

  /**
   * Best-effort daily sales snapshot upsert. Increments today's revenue/order
   * counters for the branch so dashboards and AI summaries read a real ledger
   * instead of re-aggregating every time. Never fails the bill on error.
   */
  async bumpDailySummary(data: { date?: string; branchId?: string; restaurantId?: string; subtotal: number; discount: number; gst: number; grandTotal: number; itemCount: number; cashierName?: string; paymentMethod?: string }) {
    if (!data.date || !data.branchId) return;
    try {
      const today = data.date;
      const branchId = data.branchId;
      const inc: Record<string, number> = {
        totalRevenue: data.grandTotal || 0,
        totalOrders: 1,
        totalItemsSold: data.itemCount || 0,
        totalDiscount: data.discount || 0,
        totalGst: data.gst || 0,
      };
      if (data.paymentMethod === 'Cash') inc.cashSales = data.grandTotal || 0;
      // Tenant-scoped upsert: filter by restaurantId when present so one
      // restaurant's bill can never bump another restaurant's daily summary.
      // (Legacy callers without restaurantId keep the original behaviour.)
      const summaryFilter: Record<string, any> = { date: today, branchId: branchId as any };
      if (data.restaurantId) summaryFilter.restaurantId = data.restaurantId as any;
      await DailySummary.findOneAndUpdate(
        summaryFilter,
        {
          $inc: inc,
          $setOnInsert: {
            date: today,
            branchId: branchId as any,
            restaurantId: data.restaurantId as any,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).exec();
      // Phase 1.8 — incremental month/year materialized rolls.
      await this.bumpMonthlyYearlySummary(data, inc);
    } catch (err: any) {
      console.warn('[BillService] daily summary bump skipped:', err.message);
    }
  }

  /**
   * Phase 1.8 — Increment the MonthlySummary and YearlySummary materialized
   * rolls alongside the daily snapshot so month/year reports never need a full
   * rebuild for day-to-day operation. Best-effort, tenant-scoped.
   */
  private async bumpMonthlyYearlySummary(
    data: { date?: string; branchId?: string; restaurantId?: string; grandTotal: number; paymentMethod?: string; pointsEarned?: number; pointsRedeemed?: number },
    dailyInc: Record<string, number>
  ): Promise<void> {
    if (!data.date || !data.restaurantId) return;
    try {
      const month = data.date.slice(0, 7);
      const year = data.date.slice(0, 4);
      const monthInc: Record<string, number> = {
        totalRevenue: dailyInc.totalRevenue || 0,
        totalOrders: dailyInc.totalOrders || 0,
        totalItemsSold: dailyInc.totalItemsSold || 0,
        totalDiscount: dailyInc.totalDiscount || 0,
        totalGst: dailyInc.totalGst || 0,
        cashSales: data.paymentMethod === 'Cash' ? data.grandTotal || 0 : 0,
        pointsEarned: data.pointsEarned || 0,
        pointsRedeemed: data.pointsRedeemed || 0,
      };
      await MonthlySummary.findOneAndUpdate(
        { restaurantId: data.restaurantId, branchId: data.branchId as any, month },
        { $inc: monthInc, $setOnInsert: { restaurantId: data.restaurantId, branchId: data.branchId as any, month } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).exec();
      await YearlySummary.findOneAndUpdate(
        { restaurantId: data.restaurantId, branchId: data.branchId as any, year },
        { $inc: monthInc, $setOnInsert: { restaurantId: data.restaurantId, branchId: data.branchId as any, year } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).exec();
    } catch (err: any) {
      console.warn('[BillService] month/year summary bump skipped:', err.message);
    }
  }

  /**
   * Verify an Owner/Manager PIN for refund/void authorization.
   * Checks every active Owner/Manager employee of the restaurant; returns true
   * when any matches (bcrypt compare).
   */
  async verifyManagerPin(restaurantId: string | undefined, pin: string | undefined): Promise<boolean> {
    if (!pin) return false;
    if (!restaurantId) return false;
    const res = await employeeRepo.findAll({
      restaurantId: restaurantId as any,
      role: { $in: ['Owner', 'Manager'] },
      status: 'Active',
    });
    for (const emp of res.data) {
      if (emp && (emp as any).pin && await verifyPin(pin, (emp as any).pin)) return true;
    }
    return false;
  }

  /**
   * Create a new bill (immutable payment record) with line items.
   * Deducts stock for each item via the centralized stock engine, upserts the
   * daily summary, and writes an audit log. Returns the created bill with items.
   */
  async create(data: any, ctx: { restaurantId?: string; branchId?: string; operator?: string } = {}) {
    const { items, ...billData } = data;

    // Tenant isolation — always stamp the restaurant on the immutable record.
    if (ctx.restaurantId) billData.restaurantId = ctx.restaurantId;
    if (ctx.branchId) billData.branchId = ctx.branchId;

    // Source order link (online ordering adjustments resolve the bill via orderId).
    if (billData.orderId && !mongoose.Types.ObjectId.isValid(billData.orderId)) {
      delete billData.orderId;
    }

    // ── Phase 1.10 — Offline-replay idempotency ───────────────────
    // The POS terminal sends its stable local bill id as `clientRef`. If the
    // first attempt succeeded server-side but the response was lost (offline
    // queue replay), a retry would otherwise create a duplicate bill, deduct
    // stock twice, and double-award loyalty. Dedupe BEFORE any side effect:
    // same restaurant + same clientRef ⇒ return the existing bill unchanged.
    // The unique sparse index { restaurantId, clientRef } guards the race.
    if (billData.clientRef && ctx.restaurantId) {
      try {
        const existing = await billRepo.findOne({
          restaurantId: ctx.restaurantId as any,
          clientRef: billData.clientRef,
        } as any);
        if (existing) {
          console.log(`[BillService] idempotent replay: clientRef=${billData.clientRef} already billed (${(existing as any).invoiceNumber})`);
          return this.getById((existing as any)._id.toString(), ctx);
        }
      } catch (err: any) {
        // A dedup failure must never block a legitimate bill.
        console.warn('[BillService] idempotency check skipped:', err.message);
      }
    }

    // ── Loyalty customer resolution (Phase 1.6) ──────────────
    // Bills now reference customerId (phone snapshot kept for historical
    // integrity). Resolution is tenant-scoped and best-effort.
    if (billData.customerPhone && ctx.restaurantId && !billData.customerId) {
      try {
        const cust = await Customer.findOne({
          phone: billData.customerPhone,
          restaurantId: ctx.restaurantId,
        }).lean().exec();
        if (cust) {
          billData.customerId = cust._id;
          billData.customerName = billData.customerName || cust.name;
        }
      } catch (err: any) {
        console.warn('[BillService] customer resolution skipped:', err.message);
      }
    }

    // Create the bill
    const bill = await billRepo.create(billData);

    // Create bill items with historical snapshots
    if (items && Array.isArray(items) && items.length > 0) {
      const itemDocs = items.map((item: any) => ({
        billId: bill._id.toString(),
        menuItemId: item.product?.id || item.menuItemId,
        itemName: item.product?.name || item.itemName,
        priceAtSale: item.price,
        quantity: item.quantity,
        gstRateAtSale: item.product?.gstPercent || item.gstRateAtSale || 5,
        discountAtSale: item.discount || 0,
        notes: item.notes,
        variantName: item.selectedVariant?.name,
        isFree: item.isFree || false,
      }));
      await billItemRepo.bulkCreate(itemDocs as any);
    }

    // Stock engine: deduct stock for every sold item (best-effort, clamped).
    await deductBillStock(items, {
      restaurantId: ctx.restaurantId || billData.restaurantId,
      branchId: ctx.branchId || billData.branchId,
      operator: ctx.operator || billData.cashierName,
    });

    // Daily sales snapshot (best-effort upsert).
    await this.bumpDailySummary({
      date: billData.date,
      branchId: ctx.branchId || billData.branchId,
      restaurantId: ctx.restaurantId || billData.restaurantId,
      subtotal: billData.subtotal || 0,
      discount: billData.discount || 0,
      gst: billData.gst || 0,
      grandTotal: billData.grandTotal || 0,
      itemCount: (items || []).reduce((s: number, i: any) => s + (Number(i?.quantity) || 0), 0),
      cashierName: billData.cashierName,
      paymentMethod: billData.paymentMethod,
    });

    // ── Server-authoritative loyalty (Phase 1.6) ─────────────
    // The backend computes points/visits/tier/spend from the bill and updates
    // the customer profile — client-sent points are never trusted. Best-effort:
    // a loyalty failure must never fail billing.
    let serverPointsEarned: number | undefined;
    if (billData.customerId && ctx.restaurantId) {
      try {
        const loyalty = await loyaltyService.recordBill(ctx.restaurantId, billData.customerId.toString(), {
          grandTotal: billData.grandTotal || 0,
          date: billData.date,
          branchId: ctx.branchId || billData.branchId,
          items,
          cashierName: billData.cashierName || ctx.operator,
          invoiceNumber: billData.invoiceNumber,
          customerPhone: billData.customerPhone,
        });
        serverPointsEarned = loyalty.pointsEarned;
        if (typeof loyalty.pointsEarned === 'number' && loyalty.pointsEarned !== Number(billData.pointsEarned || 0)) {
          // Correct the historical snapshot with the server-computed value so
          // reports and receipts never show a client-forged number.
          await billRepo.update(bill._id.toString(), { pointsEarned: loyalty.pointsEarned } as any);
          billData.pointsEarned = loyalty.pointsEarned;
        }
      } catch (err: any) {
        console.warn('[BillService] loyalty record skipped:', err.message);
      }

      // ── Server-authoritative REDEMPTION (Phase 1.6) ───────
      // A bill may claim points redeemed (reward applied at the till). The
      // client number is a HINT only — the server re-validates the balance and
      // deducts through the FIFO pool (race-safe). If the claim can't be
      // honoured (forged value, insufficient balance, double-redeem), the
      // snapshot is corrected so a bogus redemption is never recorded.
      // Best-effort: a failed redemption never fails billing.
      const claimedRedeemed = Number(billData.pointsRedeemed || 0);
      if (claimedRedeemed > 0) {
        let actualRedeemed = 0;
        try {
          // Success — the claim is honoured exactly, deducted through the pool.
          await loyaltyService.redeemPoints(
            ctx.restaurantId,
            billData.customerId.toString(),
            claimedRedeemed,
            {
              description: billData.redeemedRewardTitle
                ? `Reward: ${billData.redeemedRewardTitle}`
                : 'Points redeemed on bill',
              refType: 'bill',
              refId: billData.invoiceNumber,
              branchId: ctx.branchId || billData.branchId,
              createdBy: billData.cashierName || ctx.operator,
            }
          );
          actualRedeemed = claimedRedeemed;
        } catch (err: any) {
          // Forged / insufficient / already-redeemed — correct the snapshot to 0
          // and log the claimed-vs-actual for auditability.
          console.warn(`[BillService] points redemption rejected (claimed ${claimedRedeemed}, actual ${actualRedeemed}):`, err.message);
          actualRedeemed = 0;
        }
        if (claimedRedeemed !== actualRedeemed) {
          await billRepo.update(bill._id.toString(), { pointsRedeemed: actualRedeemed } as any);
          billData.pointsRedeemed = actualRedeemed;
        }
      }
    }

    // Audit log
    await auditLogRepo.create({
      action: 'BILL_CREATED',
      entityType: 'bill',
      entityId: bill._id.toString(),
      performedBy: billData.cashierName || 'System',
      details: {
        grandTotal: billData.grandTotal,
        paymentMethod: billData.paymentMethod,
        invoiceNumber: billData.invoiceNumber,
        customerId: billData.customerId,
        pointsEarned: serverPointsEarned,
      },
    } as any);

    return this.getById(bill._id.toString());
  }

  /**
   * Void a bill (soft-delete equivalent for immutable records).
   * Restores stock for each line item (return movement).
   * Sets isVoided flag with reason and timestamp.
   * Requires an Owner/Manager role (route-level) and, when a manager PIN is
   * supplied, verifies it against active Owner/Manager employees.
   */
  async voidBill(id: string, voidData: { reason: string; voidedBy: string; managerPin?: string }, ctx: { restaurantId?: string; branchId?: string } = {}) {
    const existing = await billRepo.findById(id);
    // Tenant isolation first (parity with refundBill) — a bill outside the
    // requester's restaurant is not found, before any state checks that could
    // leak another restaurant's bill state.
    if (ctx.restaurantId && existing && (existing as any).restaurantId && (existing as any).restaurantId.toString() !== ctx.restaurantId) {
      throw new AppError(404, 'Bill not found');
    }
    if (existing && (existing as any).isVoided) {
      throw new AppError(400, 'Bill is already voided');
    }
    if (existing && (existing as any).isRefunded) {
      throw new AppError(400, 'Cannot void an already-refunded bill');
    }

    // Load the bill items BEFORE voiding so we can restore their stock.
    let items: any[] = [];
    try {
      const found = await billItemRepo.findAll({ billId: id } as any, { limit: 1000 });
      items = found.data;
    } catch { /* non-fatal */ }

    // Manager PIN authorization (optional but recommended for accountability).
    if (voidData.managerPin) {
      const ok = await this.verifyManagerPin(ctx.restaurantId, voidData.managerPin);
      if (!ok) throw new AppError(403, 'Invalid manager PIN — void denied');
    }

    const bill = await billRepo.update(id, {
      isVoided: true,
      voidReason: voidData.reason,
      voidedAt: new Date(),
      voidedBy: voidData.voidedBy,
    } as any);

    if (!bill) return null;

    // Stock engine: restore stock for every item on the voided bill.
    await restoreBillStock(items, {
      restaurantId: ctx.restaurantId || (bill as any).restaurantId,
      branchId: ctx.branchId || (bill as any).branchId,
      operator: voidData.voidedBy,
    });

    // Daily summary decrement — mirror the refund path so a voided bill does
    // not leave inflated revenue/orders in the daily snapshot (best-effort).
    if ((bill as any).date && (bill as any).branchId) {
      try {
        await DailySummary.findOneAndUpdate(
          { date: (bill as any).date, branchId: (bill as any).branchId },
          {
            $inc: {
              totalRevenue: -((bill as any).grandTotal || 0),
              totalOrders: -1,
              totalItemsSold: -items.reduce((s, i) => s + (Number(i.quantity) || 0), 0),
              totalDiscount: -((bill as any).discount || 0),
              totalGst: -((bill as any).gst || 0),
            },
          },
          { new: true }
        ).exec();
      } catch (err: any) {
        console.warn('[BillService] daily summary void decrement skipped:', err.message);
      }
    }

    await auditLogRepo.create({
      action: 'BILL_VOIDED',
      entityType: 'bill',
      entityId: id,
      performedBy: voidData.voidedBy,
      details: { reason: voidData.reason },
    } as any);

    return bill;
  }

  /**
   * Refund a bill — full refund when `items` is omitted, partial refund when a
   * subset of line items is provided. Requires an Owner/Manager PIN so every
   * refund is accountable. Restores stock for refunded quantities, reverses
   * earned loyalty points, decrements the daily summary, and audits the action.
   */
  async refundBill(id: string, data: { items?: Array<{ menuItemId?: string; itemName?: string; quantity?: number }>; reason: string; refundedBy: string; managerPin: string }, ctx: { restaurantId?: string; branchId?: string } = {}) {
    const bill = await billRepo.findById(id);
    if (!bill) throw new AppError(404, 'Bill not found');
    // Tenant isolation.
    if (ctx.restaurantId && (bill as any).restaurantId && (bill as any).restaurantId.toString() !== ctx.restaurantId) {
      throw new AppError(404, 'Bill not found');
    }
    if ((bill as any).isVoided) throw new AppError(400, 'Cannot refund a voided bill');
    if ((bill as any).isRefunded) throw new AppError(400, 'Bill is already refunded');

    // Manager PIN authorization.
    const ok = await this.verifyManagerPin(ctx.restaurantId, data.managerPin);
    if (!ok) throw new AppError(403, 'Invalid manager PIN — refund denied');

    // Load original line items (historical snapshots).
    let originalItems: any[] = [];
    try {
      const found = await billItemRepo.findAll({ billId: id } as any, { limit: 1000 });
      originalItems = found.data;
    } catch { /* non-fatal */ }

    // Resolve which quantities to refund: full bill when no subset given.
    const requested = data.items && data.items.length > 0 ? data.items : undefined;
    const refundLines: Array<{ menuItemId?: string; itemName: string; quantity: number; amount: number }> = [];
    const restoreTargets: any[] = [];
    let refundAmount = 0;

    if (!requested) {
      // Full refund of every line.
      for (const item of originalItems) {
        const qty = Number(item.quantity) || 0;
        const amount = (Number(item.priceAtSale) || 0) * qty;
        if (amount <= 0 && qty <= 0) continue;
        refundLines.push({ menuItemId: item.menuItemId, itemName: item.itemName || 'Item', quantity: qty, amount });
        refundAmount += amount;
        restoreTargets.push({ menuItemId: item.menuItemId || item.product?.id, quantity: qty });
      }
    } else {
      // Partial refund — match requested items to original lines (by menuItemId
      // or itemName), never refunding more than the original quantity.
      for (const req of requested) {
        const qty = Math.max(0, Number(req.quantity) || 0);
        if (qty <= 0) continue;
        const original = originalItems.find((o: any) =>
          (req.menuItemId && o.menuItemId === req.menuItemId) ||
          (!req.menuItemId && req.itemName && o.itemName?.toLowerCase() === req.itemName?.toLowerCase())
        );
        if (!original) continue;
        const refundQty = Math.min(qty, Number(original.quantity) || 0);
        if (refundQty <= 0) continue;
        const amount = (Number(original.priceAtSale) || 0) * refundQty;
        refundLines.push({ menuItemId: original.menuItemId, itemName: original.itemName || 'Item', quantity: refundQty, amount });
        refundAmount += amount;
        restoreTargets.push({ menuItemId: original.menuItemId, quantity: refundQty });
      }
      if (refundLines.length === 0) throw new AppError(400, 'No matching bill items found for the requested refund');
    }

    // Restore stock for every refunded quantity (return movement).
    if (restoreTargets.length > 0 && ctx.restaurantId) {
      for (const t of restoreTargets) {
        if (!t.menuItemId || t.quantity <= 0) continue;
        try {
          await stockMovementService.applyMovement({
            restaurantId: ctx.restaurantId,
            branchId: ctx.branchId,
            productId: t.menuItemId,
            delta: t.quantity,
            type: 'return',
            unit: 'pcs',
            operator: data.refundedBy,
          });
        } catch (err: any) {
          console.warn('[BillService] refund stock restore skipped:', t.menuItemId, err.message);
        }
      }
    }

    // Reverse earned loyalty points proportionally (best-effort, Phase 1.6).
    // Resolves the customer tenant-scoped via customerId (or phone fallback)
    // and reverses through the loyalty ledger so the balance stays consistent.
    if (refundAmount > 0 && (bill as any).pointsEarned > 0 && (bill as any).customerId) {
      try {
        const reversal = Math.min(
          (bill as any).pointsEarned || 0,
          Math.round(((bill as any).pointsEarned || 0) * (refundAmount / Math.max(1, (bill as any).grandTotal || 1)))
        );
        await loyaltyService.reverseBillPoints(ctx.restaurantId || '', (bill as any).customerId.toString(), reversal, {
          refundedBy: data.refundedBy,
          billId: id,
        });
      } catch (err: any) {
        console.warn('[BillService] refund loyalty reversal skipped:', err.message);
      }
    } else if (refundAmount > 0 && (bill as any).pointsEarned > 0 && (bill as any).customerPhone) {
      // Legacy bills without customerId — resolve by phone (tenant-scoped).
      try {
        const cust = ctx.restaurantId
          ? await customerRepo.forTenant(ctx.restaurantId).findOne({ phone: (bill as any).customerPhone } as any)
          : null;
        if (cust) {
          const reversal = Math.min(
            (bill as any).pointsEarned || 0,
            Math.round(((bill as any).pointsEarned || 0) * (refundAmount / Math.max(1, (bill as any).grandTotal || 1)))
          );
          await loyaltyService.reverseBillPoints(ctx.restaurantId || '', (cust as any)._id.toString(), reversal, {
            refundedBy: data.refundedBy,
            billId: id,
          });
        }
      } catch (err: any) {
        console.warn('[BillService] refund loyalty reversal skipped:', err.message);
      }
    }

    // Mark the bill as refunded.
    const updated = await billRepo.update(id, {
      isRefunded: true,
      refundedAt: new Date(),
      refundedBy: data.refundedBy,
      refundReason: data.reason,
      refundAmount: Math.round(refundAmount * 100) / 100,
      refundedItems: refundLines,
    } as any);

    // Decrement daily summary (best-effort).
    if ((bill as any).date && (bill as any).branchId) {
      try {
        await DailySummary.findOneAndUpdate(
          { date: (bill as any).date, branchId: (bill as any).branchId },
          {
            $inc: {
              totalRevenue: -Math.round(refundAmount * 100) / 100,
              totalOrders: refundAmount >= ((bill as any).grandTotal || 0) - 0.01 ? -1 : 0,
              totalItemsSold: -refundLines.reduce((s, l) => s + l.quantity, 0),
            },
          },
          { new: true }
        ).exec();
      } catch (err: any) {
        console.warn('[BillService] daily summary refund decrement skipped:', err.message);
      }
    }

    await auditLogRepo.create({
      action: 'BILL_REFUNDED',
      entityType: 'bill',
      entityId: id,
      performedBy: data.refundedBy,
      details: { reason: data.reason, amount: refundAmount, items: refundLines.length },
    } as any);

    return this.getById(id, ctx);
  }
}

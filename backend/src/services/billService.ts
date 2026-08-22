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
import crypto from 'crypto';
import { billRepo, billItemRepo, customerRepo, employeeRepo, auditLogRepo, dailySummaryRepo } from '../repositories';
import { InvoiceCounter, DailySummary, MonthlySummary, YearlySummary, Customer } from '../models';
import { stockMovementService } from './stockMovementService';
import { loyaltyService, customerService } from './index';
import { verifyPin } from '../utils/bcrypt';
import { AppError } from '../utils/AppError';
import { config } from '../config';
import { consumptionService } from '../modules/recipes/services/consumptionService';
import { resolveProductConfiguration } from '../modules/menu-config/services/configurationResolver';
import { validateProductConfigurationSelection } from '../modules/menu-config/services/configurationValidator';
import { calculateLineItemPrice } from '../modules/menu-config/services/pricingEngine';

/** Receipt QR links expire 12 hours after minting. */
export const RECEIPT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Mint a fresh receipt-QR capability for a bill. The token is opaque, unique,
 * expires after RECEIPT_TOKEN_TTL_MS and resolves ONLY to a sanitized public
 * summary (reward earned + line items) — never to customer PII.
 */
export function mintReceiptToken(): { receiptToken: string; receiptTokenExpiresAt: Date; receiptUrl: string } {
  const receiptToken = 'rcpt_' + crypto.randomBytes(12).toString('hex');
  const receiptTokenExpiresAt = new Date(Date.now() + RECEIPT_TOKEN_TTL_MS);
  const receiptUrl = `${config.qrBaseUrl}/#/r/${receiptToken}`;
  return { receiptToken, receiptTokenExpiresAt, receiptUrl };
}

/**
 * Best-effort: ensure a bill carries a receipt QR capability. Legacy bills
 * created before the feature have none — lazily minting on read means a
 * reprint/review flow always shows a working QR. Never fails the caller.
 */
async function ensureReceiptToken(bill: any): Promise<void> {
  try {
    if (!bill || (bill as any).receiptToken) return;
    const minted = mintReceiptToken();
    await billRepo.update((bill as any)._id.toString(), {
      $set: {
        receiptToken: minted.receiptToken,
        receiptTokenExpiresAt: minted.receiptTokenExpiresAt,
        receiptUrl: minted.receiptUrl,
      },
    } as any);
    (bill as any).receiptToken = minted.receiptToken;
    (bill as any).receiptTokenExpiresAt = minted.receiptTokenExpiresAt;
    (bill as any).receiptUrl = minted.receiptUrl;
  } catch (err: any) {
    console.warn('[BillService] receipt-token backfill skipped (non-fatal):', err.message);
  }
}

/**
 * Normalize a raw bill item into the shape the recipe consumption engine
 * expects: a stable menuItemId, itemName and variantName (the raw payload uses
 * `product.id` / `selectedVariant.name`). This is what generateForBill and the
 * active-recipe guard both read, so variant resolution and the double-deduction
 * skip stay consistent with the bill's actual line items.
 */
function normalizeBillItems(items: any[]): any[] {
  return (items || []).map((item: any) => ({
    ...item,
    menuItemId: item?.product?.id || item?.menuItemId,
    itemName: item?.product?.name || item?.itemName,
    variantName: item?.selectedVariant?.name || item?.variantName,
  }));
}

/**
 * Best-effort stock deduction for a bill's line items. Each item deducts from
 * its product via the centralized stock engine. Failures are logged but NEVER
 * fail the bill (billing must not break). Overselling is clamped per-item.
 *
 * Phase A double-deduction guard: items whose product has an ACTIVE recipe
 * (keys `productId::variantName`) are SKIPPED here — their ingredient stock is
 * consumed through recipe consumption instead, so the same physical stock is
 * never deducted twice. Products without a recipe keep the legacy deduction.
 */
async function deductBillStock(items: any[], ctx: { restaurantId?: string; branchId?: string; operator?: string }, skipRecipeKeys?: Set<string>) {
  if (!ctx.restaurantId || !Array.isArray(items)) return;
  for (const item of items) {
    const productId = item?.product?.id || item?.menuItemId;
    const qty = Number(item?.quantity) || 0;
    if (!productId || qty <= 0) continue;
    const variant = item?.selectedVariant?.name || item?.variantName || '';
    if (skipRecipeKeys && skipRecipeKeys.has(`${productId}::${variant}`)) continue; // recipe consumes ingredients
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
 * Phase A: items whose product was recipe-consumed (keys `productId::variantName`)
 * are SKIPPED here — recipe consumption reversal restores their ingredients, so
 * restoring the menu product as well would over-restore stock.
 */
async function restoreBillStock(items: any[], ctx: { restaurantId?: string; branchId?: string; operator?: string }, skipRecipeKeys?: Set<string>) {
  if (!ctx.restaurantId || !Array.isArray(items)) return;
  for (const item of items) {
    const productId = item?.menuItemId || item?.product?.id;
    const qty = Number(item?.quantity) || 0;
    if (!productId || qty <= 0) continue;
    const variant = item?.selectedVariant?.name || item?.variantName || '';
    if (skipRecipeKeys && skipRecipeKeys.has(`${productId}::${variant}`)) continue; // reversed via recipe consumption
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
   * Reserve a contiguous range of invoice numbers for ONE terminal.
   *
   * Atomically advances the shared InvoiceCounter by `size`, so reserved ranges
   * never overlap — neither with other terminals' ranges nor with single numbers
   * issued by getNextInvoiceNumber. A terminal draws offline bills from its own
   * reserved range, so two offline terminals can never collide on invoice
   * numbers (the previous localStorage fallback seeded every terminal at 1001).
   *
   * @param size - how many numbers to reserve (clamped 1..10000, default 100)
   * @returns The inclusive [start, end] range owned by the caller.
   */
  async reserveInvoiceRange(size: number = 100): Promise<{ start: number; end: number }> {
    const safeSize = Math.max(1, Math.min(Math.floor(size) || 1, 10000));
    const counter = await InvoiceCounter.findOneAndUpdate(
      { name: 'invoice' },
      { $inc: { sequence: safeSize } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    ).lean();
    // Same semantics as getNextInvoiceNumber: on first upsert the default
    // sequence is 1001, so the first reserved range starts at 1001.
    const end = (counter?.sequence ?? 1001) - 1;
    return { start: end - safeSize + 1, end };
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

    const docs = await billRepo.findAll(query, { sort: { createdAt: -1 } });
    // Lazy backfill receipt QR capabilities on legacy bills (best-effort,
    // never fails the list).
    try {
      await Promise.all(
        (docs.data || [])
          .filter((b: any) => b && !(b as any).receiptToken)
          .map((b: any) => ensureReceiptToken(b))
      );
    } catch { /* non-fatal */ }

    // Attach line items so receipt reprints / report drill-downs can render
    // the real item rows + per-slab tax summary (list responses used to arrive
    // with an empty items array). Best-effort and never fails the list.
    try {
      const billIds = (docs.data || []).map((b: any) => String(b._id));
      if (billIds.length > 0) {
        // Build both ObjectId and string versions of the IDs to handle the
        // common case where billId is stored as an ObjectId but queried as
        // a string (or vice versa) — MongoDB $in matches either.
        const validObjectIds = billIds.filter((id: string) => mongoose.Types.ObjectId.isValid(id));
        const objectIds = validObjectIds.map((id: string) => new mongoose.Types.ObjectId(id));
        const all = await billItemRepo.findAll(
          { billId: { $in: [...objectIds, ...billIds] } } as any,
          { sort: { createdAt: 1 }, limit: Math.max(1000, billIds.length * 100) }
        );
        let byBill = new Map<string, any[]>();
        for (const it of (all as any).data || []) {
          const key = String((it as any).billId);
          const arr = byBill.get(key) || [];
          arr.push(it);
          byBill.set(key, arr);
        }
        // If the repo query returned no items but bills have revenue, try a
        // direct Model.find with explicit casting as a last resort.
        const hasRevenue = (docs.data || []).some((b: any) => (b as any).grandTotal > 0);
        const hasEmptyItems = [...byBill.values()].every(arr => arr.length === 0);
        if (hasRevenue && hasEmptyItems && billIds.length > 0) {
          try {
            const { default: BillItemModel } = await import('../models/BillItem');
            const directItems = await BillItemModel.find(
              { billId: { $in: [...objectIds, ...billIds] } }
            ).sort({ createdAt: 1 }).lean().exec();
            if (directItems.length > 0) {
              byBill = new Map<string, any[]>();
              for (const it of directItems) {
                const key = String((it as any).billId);
                const arr = byBill.get(key) || [];
                arr.push(it);
                byBill.set(key, arr);
              }
            }
          } catch (err: any) {
            console.warn('[BillService] direct BillItem fallback failed:', err.message);
          }
        }
        for (const b of docs.data || []) {
          (b as any).items = byBill.get(String((b as any)._id)) || [];
        }
      }
    } catch (err: any) {
      console.warn('[BillService] item attachment failed:', err?.message);
    }
    return docs;
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

    // Legacy bills predating the receipt-QR feature get a lazily minted
    // capability so reprints always carry a working (12h-expiring) QR.
    await ensureReceiptToken(bill);

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
    if (!data.date) return;
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
   * Phase 3 — Authoritative pricing for configured line items.
   *
   * For every item carrying a `configuration.selections`:
   *   1. Resolve the product configuration (tenant-scoped) — same resolver the
   *      POS used, so online and offline pricing come from ONE rule.
   *   2. Validate the selection with the Phase 1 validator (stable codes).
   *   3. Reprice with the deterministic pricing engine.
   *   4. origin === 'offline'  → keep the client's historical price (snapshot
   *      is authoritative; a completed offline sale is never rewritten by a
   *      catalog change). Structure is still validated — structural failures
   *      are logged, not fatal, so a deleted/archived config never bricks the
   *      offline bill replay.
   *   5. origin === 'online'  → the recomputed price is authoritative; any
   *      meaningful mismatch with the client-supplied price rejects the bill
   *      (an arbitrary "price: 1" payload can never bypass server pricing).
   *
   * Returns a Map<itemId, { price, snapshot }> where `price` is the unit price
   * to persist. Legacy items are absent from the map (price untouched).
   */
  private async resolveConfiguredItemPricing(
    items: any[],
    ctx: { restaurantId?: string; branchId?: string; operator?: string },
    billData: any
  ): Promise<Map<string, { price: number; snapshot: any }>> {
    const map = new Map<string, { price: number; snapshot: any }>();
    if (!ctx.restaurantId || !Array.isArray(items)) return map;

    for (const item of items) {
      const selection = item?.configuration;
      const snapshot = item?.pricingSnapshot;
      const origin: 'online' | 'offline' = snapshot?.origin === 'offline' ? 'offline' : 'online';
      const productId = item?.product?.id || item?.menuItemId;
      const isFree = !!item?.isFree;
      if (!selection?.selections?.length || !productId) continue;
      if (isFree) continue; // free reward items stay free

      let resolved;
      try {
        resolved = await resolveProductConfiguration(ctx.restaurantId, String(productId));
      } catch (err: any) {
        if (origin === 'offline') {
          // Historical offline sale — product may have been deleted since. Keep
          // the snapshot price and let the bill sync (structure was valid at
          // sale time; the snapshot carries the version evidence).
          console.warn('[BillService] offline configured item not re-resolvable, keeping snapshot:', item?.itemName || productId, err.message);
          map.set(String(item.id), {
            price: Number(item.price) || 0,
            snapshot: {
              ...(snapshot ?? {}),
              origin,
              basePrice: (snapshot?.basePrice ?? Number(item.price)) || 0,
              grossItemPrice: Number(item.price) || 0,
              configVersion: snapshot?.configVersion ?? 0,
              pricingVersion: snapshot?.pricingVersion ?? 0,
            },
          });
          continue;
        }
        throw err;
      }

      const validation = validateProductConfigurationSelection(resolved, selection);
      if (!validation.valid) {
        const first = validation.errors[0];
        if (origin === 'offline') {
          console.warn('[BillService] offline configured item structurally invalid, keeping snapshot:', item?.itemName || productId, first?.code, first?.message);
          map.set(String(item.id), {
            price: Number(item.price) || 0,
            snapshot: {
              ...(snapshot ?? {}),
              origin,
              basePrice: (snapshot?.basePrice ?? Number(item.price)) || 0,
              grossItemPrice: Number(item.price) || 0,
              configVersion: resolved.configVersion,
              pricingVersion: snapshot?.pricingVersion ?? 0,
            },
          });
          continue;
        }
        throw new AppError(400, `Invalid configuration for ${item?.product?.name || productId}: ${first?.code} — ${first?.message}`);
      }

      const qty = Math.max(1, Number(item?.quantity) || 1);
      const price = calculateLineItemPrice(resolved, selection, qty);
      const unitPrice = price.grossItemPrice;

      if (origin === 'offline') {
        // Historical snapshot is authoritative — keep the price paid at sale.
        map.set(String(item.id), {
          price: Number(item.price) || 0,
          snapshot: {
            basePrice: price.basePrice,
            variantDelta: price.variantDelta,
            modifierDelta: price.modifierDelta,
            addonDelta: price.addonDelta,
            grossItemPrice: Number(item.price) || 0,
            lineTotal: price.lineTotal,
            configVersion: price.configVersion,
            pricingVersion: price.pricingVersion,
            origin,
          },
        });
        continue;
      }

      // Online — authoritative reprice. A mismatch means the catalog changed
      // after the cashier configured the item (or the client lied): reject so
      // the cashier refreshes, rather than silently billing a wrong total.
      const clientUnit = Number(item.price) || 0;
      if (Math.abs(unitPrice - clientUnit) > 0.01) {
        console.warn('[BillService] configured item price mismatch (client vs server):',
          item?.itemName || productId, clientUnit, 'vs', unitPrice);
        throw new AppError(
          400,
          `Price changed for ${item?.product?.name || productId} — refresh the item and retry (expected ${unitPrice.toFixed(2)}, got ${clientUnit.toFixed(2)})`
        );
      }

      map.set(String(item.id), {
        price: unitPrice,
        snapshot: {
          basePrice: price.basePrice,
          variantDelta: price.variantDelta,
          modifierDelta: price.modifierDelta,
          addonDelta: price.addonDelta,
          grossItemPrice: unitPrice,
          lineTotal: price.lineTotal,
          configVersion: price.configVersion,
          pricingVersion: price.pricingVersion,
          origin: 'online',
        },
      });
    }

    return map;
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
    // integrity). Resolution is tenant-scoped and best-effort. When the phone
    // belongs to NO existing customer (first-time diner typing their number),
    // the customer is ENROLLED server-side so the very first bill earns the
    // spend + welcome points — otherwise a concurrent createCustomer race leaves
    // customerId unset and recordBill (and thus points) silently skipped.
    if (billData.customerPhone && ctx.restaurantId && !billData.customerId) {
      try {
        let cust = await Customer.findOne({
          phone: billData.customerPhone,
          restaurantId: ctx.restaurantId,
        }).lean().exec();
        if (!cust) {
          const created = await customerService.create(ctx.restaurantId, {
            phone: billData.customerPhone,
            name: billData.customerName || 'Guest Diner',
          }, { operator: billData.cashierName || ctx.operator, branchId: ctx.branchId });
          if (created && created.customer) {
            cust = created.customer;
          } else if (created && created.existing) {
            cust = created.existing;
          }
        }
        if (cust) {
          billData.customerId = String(cust._id);
          billData.customerName = billData.customerName || cust.name;
        }
      } catch (err: any) {
        console.warn('[BillService] customer resolution skipped:', err.message);
      }
    }

    // ── Phase 3 — Configured-item authoritative pricing ────────────
    // For items carrying a configuration selection, re-resolve the product's
    // configuration with tenant isolation, revalidate the selection, and
    // reprice with the deterministic pricing engine. Online-origin items are
    // REPRICED authoritatively (a client-supplied mismatch is rejected — never
    // trusted); offline-origin items keep their immutable historical snapshot
    // (a completed offline sale is never rewritten by today's catalog). Legacy
    // items without configuration pass through untouched. Runs BEFORE the bill
    // is created so a rejected online mismatch can never leave an orphan row.
    const configuredInfo = await this.resolveConfiguredItemPricing(items, ctx, billData);

    // ── Phase 4 — Financial invariants (server-side) ─────────────────
    // The terminal is an offline-first trusted device, but the persisted
    // record must still be internally consistent: discount can never exceed
    // the subtotal, and the grand total must reconcile as
    // subtotal − discount + gst. This catches stray keystrokes (an unbounded
    // manual-discount input), client tampering, and corrupt offline payloads
    // BEFORE a wrong record is persisted.
    const rawSubtotal = Number(billData.subtotal) || 0;
    let rawDiscount = Number(billData.discount) || 0;
    const rawGst = Number(billData.gst) || 0;
    const rawGrandTotal = Number(billData.grandTotal) || 0;
    if (rawDiscount > rawSubtotal + 0.01) {
      // Clamp rather than reject so offline queue replays (which cannot be
      // corrected from the terminal) still sync. The paid total is unchanged
      // because the frontend already taxed only the clamped taxable base
      // (rowTaxable = max(0, rowTotal − rowDiscount)), so grandTotal stays
      // consistent while the stored discount becomes sane.
      console.warn(`[BillService] discount ${rawDiscount} exceeded subtotal ${rawSubtotal} — clamped to subtotal (clientRef=${billData.clientRef || 'n/a'})`);
      rawDiscount = rawSubtotal;
      billData.discount = rawSubtotal;
    }
    const expectedGrandTotal = rawSubtotal - rawDiscount + rawGst;
    if (Math.abs(rawGrandTotal - expectedGrandTotal) > 0.02) {
      throw new AppError(
        400,
        `Bill totals are inconsistent — subtotal ₹${rawSubtotal.toFixed(2)}, discount ₹${rawDiscount.toFixed(2)}, gst ₹${rawGst.toFixed(2)} do not reconcile with grand total ₹${rawGrandTotal.toFixed(2)}. Please re-open the bill and try again.`
      );
    }

    // ── Receipt QR capability (12h expiry) ───────────────────────────
    // Minted ONCE at creation; the printed receipt QR encodes this URL and
    // the public endpoint serves a sanitized summary until it expires.
    const minted = mintReceiptToken();
    billData.receiptToken = minted.receiptToken;
    billData.receiptTokenExpiresAt = minted.receiptTokenExpiresAt;
    billData.receiptUrl = minted.receiptUrl;

    // Create the bill
    const bill = await billRepo.create(billData);

    // Create bill items with historical snapshots
    if (items && Array.isArray(items) && items.length > 0) {
      const itemDocs = items.map((item: any) => {
        const info = configuredInfo.get(String(item.id));
        return {
          billId: bill._id.toString(),
          menuItemId: item.product?.id || item.menuItemId,
          itemName: item.product?.name || item.itemName,
          priceAtSale: info?.price ?? item.price,
          quantity: item.quantity,
          gstRateAtSale: item.product?.gstPercent || item.gstRateAtSale || 5,
          discountAtSale: item.discount || 0,
          notes: item.notes,
          variantName: item.selectedVariant?.name,
          isFree: item.isFree || false,
          configurationSnapshot: info?.snapshot ? { selections: item.configuration?.selections ?? [] } : undefined,
          pricingSnapshot: info?.snapshot ?? undefined,
          configSummary: item.configSummary || undefined,
        };
      });
      await billItemRepo.bulkCreate(itemDocs as any);
    }

    // ── Phase A — Recipe consumption + double-deduction guard ──────
    // The bill and its line items are now safely persisted. Products with an
    // ACTIVE recipe are prepared items: their ingredient stock is consumed via
    // recipe consumption, so the legacy per-menu-product deduction below is
    // SKIPPED for them (never deduct the same physical stock twice). Products
    // without a recipe keep the legacy path unchanged.
    const restaurantId = ctx.restaurantId || billData.restaurantId;
    const branchId = ctx.branchId || billData.branchId;
    const normalizedItems = normalizeBillItems(items);
    const recipeKeys = await consumptionService.activeRecipeKeys(restaurantId, normalizedItems);

    // Stock engine: deduct stock for every sold item (best-effort, clamped).
    await deductBillStock(normalizedItems, {
      restaurantId,
      branchId,
      operator: ctx.operator || billData.cashierName,
    }, recipeKeys);

    // Recipe consumption — best-effort and NEVER fails billing. Any failure is
    // logged + audited so it stays observable while the completed bill
    // response remains successful.
    let consumptionItems: Array<{ inventoryItemId: string; itemName: string; unit: string; quantity: number }> | undefined;
    try {
      const consumption = await consumptionService.generateForBill(bill, normalizedItems, {
        restaurantId,
        branchId,
        operator: ctx.operator || billData.cashierName,
      });
      if (consumption && Array.isArray((consumption as any).items)) {
        // Surface the exact per-ingredient deductions on the response so the
        // POS can decrement inventory locally instead of re-fetching the whole
        // catalog after every sale.
        consumptionItems = (consumption as any).items.map((it: any) => ({
          inventoryItemId: String(it.inventoryItemId || ''),
          itemName: it.itemName || '',
          unit: it.unit || 'pcs',
          quantity: Number(it.quantity) || 0,
        }));
      }
    } catch (err: any) {
      console.error('[BillService] recipe consumption failed (non-fatal):', err.message);
      try {
        await auditLogRepo.create({
          action: 'RECIPE_CONSUMPTION_FAILED',
          entityType: 'bill',
          entityId: bill._id.toString(),
          performedBy: billData.cashierName || 'System',
          details: {
            clientRef: billData.clientRef,
            invoiceNumber: billData.invoiceNumber,
            error: err.message,
          },
        } as any);
      } catch { /* audit failure must not fail the bill either */ }
    }

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

    // Live broadcast: other terminals see the new bill in receipt history instantly.
    try {
      const { emitToRestaurant } = await import('../socket');
      emitToRestaurant(ctx.restaurantId, 'bill:created', {
        billId: bill._id.toString(),
        invoiceNumber: billData.invoiceNumber,
        grandTotal: billData.grandTotal,
        paymentMethod: billData.paymentMethod,
      });
    } catch { /* socket not ready — non-fatal */ }

    const billDoc = await this.getById(bill._id.toString());
    if (billDoc && consumptionItems) {
      (billDoc as any).consumption = consumptionItems;
    }
    return billDoc;
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
    // Tenant isolation first — a bill outside the
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

    // ── Phase A — Void reversal ───────────────────────────────────
    // The bill's products that were recipe-consumed are skipped in the legacy
    // restore below (their ingredients are restored via recipe reversal), then
    // the consumption record is reversed. Both are best-effort: a reversal
    // failure never turns a void into an error response.
    //
    // The skip set comes from the RecipeConsumption RECORD (what was actually
    // consumed at sale time), not from re-resolving current recipe state — a
    // recipe deactivated after the sale must not turn the legacy restore back
    // on for a menu product that was never deducted.
    const voidRestaurantId = ctx.restaurantId || (bill as any).restaurantId;
    const normalizedVoidItems = normalizeBillItems(items);
    let voidRecipeKeys = new Set<string>();
    try {
      const record = await consumptionService.getByBill(voidRestaurantId, id);
      if (record && Array.isArray(record.lines)) {
        for (const line of record.lines) {
          voidRecipeKeys.add(`${line.productId}::${line.variantName || ''}`);
        }
      }
    } catch { /* non-fatal — fall back to legacy restore for all items */ }

    // Stock engine: restore stock for every item on the voided bill.
    await restoreBillStock(normalizedVoidItems, {
      restaurantId: voidRestaurantId,
      branchId: ctx.branchId || (bill as any).branchId,
      operator: voidData.voidedBy,
    }, voidRecipeKeys);

    // Reverse recipe consumption for this bill (restores consumed ingredients).
    try {
      await consumptionService.reverseForBill(id, {
        restaurantId: voidRestaurantId,
        branchId: ctx.branchId || (bill as any).branchId,
        operator: voidData.voidedBy,
      }, `Bill voided: ${voidData.reason}`);
    } catch (err: any) {
      console.error('[BillService] recipe consumption reversal failed (non-fatal):', err.message);
      try {
        await auditLogRepo.create({
          action: 'RECIPE_CONSUMPTION_REVERSAL_FAILED',
          entityType: 'bill',
          entityId: id,
          performedBy: voidData.voidedBy,
          details: { reason: voidData.reason, error: err.message },
        } as any);
      } catch { /* audit failure must not fail the void either */ }
    }

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

    // Live broadcast: other terminals see the voided bill + restored stock instantly.
    try {
      const { emitToRestaurant } = await import('../socket');
      emitToRestaurant(ctx.restaurantId || (bill as any).restaurantId, 'bill:voided', {
        billId: id,
        invoiceNumber: (bill as any).invoiceNumber,
        reason: voidData.reason,
        voidedBy: voidData.voidedBy,
      });
    } catch { /* socket not ready — non-fatal */ }

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
    // Phase 4 — refund the AMOUNT ACTUALLY PAID, never the raw pre-tax
    // pre-discount subtotal. The customer paid grandTotal = subtotal −
    // discount + gst; handing back the raw subtotal would over-refund when
    // discount > gst and under-refund (withholding tax) when discount < gst,
    // and would also break the daily-summary reversal (revenue is recorded as
    // grandTotal). Each refunded line is scaled by paidRatio = grandTotal /
    // subtotal so a full refund always equals grandTotal and a partial refund
    // never exceeds it.
    const requested = data.items && data.items.length > 0 ? data.items : undefined;
    const billSubtotal = Math.max(0, Number((bill as any).subtotal) || 0);
    const billGrandTotal = Math.max(0, Number((bill as any).grandTotal) || 0);
    const paidRatio = billSubtotal > 0 ? billGrandTotal / billSubtotal : 1;
    const scale = (amount: number) => Math.round(amount * paidRatio * 100) / 100;
    const refundLines: Array<{ menuItemId?: string; itemName: string; quantity: number; amount: number }> = [];
    const restoreTargets: any[] = [];
    let refundAmount = 0;

    if (!requested) {
      // Full refund of every line.
      for (const item of originalItems) {
        const qty = Number(item.quantity) || 0;
        const amount = scale((Number(item.priceAtSale) || 0) * qty);
        if (amount <= 0 && qty <= 0) continue;
        refundLines.push({ menuItemId: item.menuItemId, itemName: item.itemName || 'Item', quantity: qty, amount });
        refundAmount += amount;
        restoreTargets.push({ menuItemId: item.menuItemId || item.product?.id, quantity: qty, variantName: item.variantName || undefined });
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
        const amount = scale((Number(original.priceAtSale) || 0) * refundQty);
        refundLines.push({ menuItemId: original.menuItemId, itemName: original.itemName || 'Item', quantity: refundQty, amount });
        refundAmount += amount;
        restoreTargets.push({ menuItemId: original.menuItemId, quantity: refundQty, variantName: original.variantName || undefined });
      }
      if (refundLines.length === 0) throw new AppError(400, 'No matching bill items found for the requested refund');
    }

    // Phase 4 — invariant: a refund can never exceed the amount actually paid.
    // Guards floating-point drift in the proportional scaling above.
    if (refundAmount > billGrandTotal + 0.01) {
      const excess = refundAmount - billGrandTotal;
      refundAmount = billGrandTotal;
      // Trim the excess from the LAST line so per-line amounts stay consistent.
      const last = refundLines[refundLines.length - 1];
      if (last) last.amount = Math.max(0, Math.round((last.amount - excess) * 100) / 100);
    }

    // ── Phase A — Refund recipe reversal ──────────────────────────
    // Refunded products that were recipe-consumed skip the legacy menu-product
    // restore (their ingredients are reversed via reversePartial below), so the
    // same physical stock is never restored twice. Both are best-effort. As in
    // the void path, the skip set comes from the consumption RECORD — the
    // authoritative list of what was consumed at sale time.
    const refundRestaurantId = ctx.restaurantId || (bill as any).restaurantId;
    let refundRecipeKeys = new Set<string>();
    try {
      const record = await consumptionService.getByBill(refundRestaurantId, id);
      if (record && Array.isArray(record.lines)) {
        for (const line of record.lines) {
          refundRecipeKeys.add(`${line.productId}::${line.variantName || ''}`);
        }
      }
    } catch { /* non-fatal — fall back to legacy restore for all items */ }

    // Restore stock for every refunded quantity (return movement).
    if (restoreTargets.length > 0 && refundRestaurantId) {
      for (const t of restoreTargets) {
        if (!t.menuItemId || t.quantity <= 0) continue;
        const variant = t.variantName || '';
        if (refundRecipeKeys.has(`${t.menuItemId}::${variant}`)) continue; // reversed via recipe consumption
        try {
          await stockMovementService.applyMovement({
            restaurantId: refundRestaurantId,
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

    // Reverse the refunded portion of recipe consumption (restores the exact
    // refunded quantity of each ingredient). Never fails the refund response.
    try {
      await consumptionService.reversePartial(
        id,
        refundLines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
        { restaurantId: refundRestaurantId, branchId: ctx.branchId, operator: data.refundedBy },
        `Refund: ${data.reason}`
      );
    } catch (err: any) {
      console.error('[BillService] recipe consumption partial reversal failed (non-fatal):', err.message);
      try {
        await auditLogRepo.create({
          action: 'RECIPE_CONSUMPTION_REVERSAL_FAILED',
          entityType: 'bill',
          entityId: id,
          performedBy: data.refundedBy,
          details: { reason: data.reason, error: err.message },
        } as any);
      } catch { /* audit failure must not fail the refund either */ }
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

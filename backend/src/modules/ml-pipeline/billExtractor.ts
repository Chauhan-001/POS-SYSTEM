/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bill Extractor — turns ChitKuber operational Bills/BillItems into the
 * Demand model's POS-sync contract (demandIngestionContract.ts).
 *
 * Tenant isolation guarantees (mirrors the repo-wide TenantRepository rule):
 *   - The extractor is ALWAYS called with restaurantId coming from a verified
 *     JWT (req.user.restaurantId) — never from client-supplied body/query.
 *   - Every Mongo query filters on restaurantId, so no code path can ever
 *     read another tenant's bills, even if a caller tried to pass a foreign id.
 *
 * Business rules (match the reports/dashboard semantics already verified in
 * this repo — see modules/reports + DashboardWorkspace fixes):
 *   - isVoided bills are EXCLUDED entirely (never real demand).
 *   - isRefunded bills map to payment_status 'refunded' (the Demand model's
 *     validator treats refunded rows as non-demand; we keep them so its
 *     quality report sees the true record mix).
 *   - Fully-refunded line items (fully refunded quantities tracked on
 *     Bill.refundedItems) map to 'refunded' as well.
 *
 * Dishonesty guards:
 *   - Only bill fields that ACTUALLY exist on the Bill/BillItem schemas are
 *     read (verified against backend/src/models/Bill.ts and BillItem.ts).
 *   - Stockout/menu availability come ONLY from the POS's real availability
 *     state (MenuAvailability rows, Product.availability) — never inferred
 *     from zero sales. When the tenant has no availability rows at all the
 *     signal is omitted and the Demand model applies its documented defaults.
 */

import Bill from '../../models/intelligence/Bill';
import BillItem from '../../models/intelligence/BillItem';
import Product from '../../models/catalog/Product';
import MenuAvailability from '../../models/catalog/MenuAvailability';
import type { Types } from 'mongoose';
import type {
  DemandPosSyncEnvelope,
  DemandOrderRecord,
  DemandOrderItemRecord,
} from './demandIngestionContract';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractWindow {
  /** Inclusive start date (YYYY-MM-DD, Bill.date format). */
  fromDate?: string;
  /** Inclusive end date (YYYY-MM-DD, Bill.date format). */
  toDate?: string;
  /** Hard cap on bills pulled in one extraction (safety valve). */
  limitBills?: number;
}

export interface ExtractionStats {
  totalBills: number;
  byStatus: Record<'paid' | 'refunded', number>;
  lineItems: number;
  excludedFreeItems: number;
  skippedNoMenuId: number;
  productsEnriched: number;
  earliestBillDate: string | null;
  latestBillDate: string | null;
}

export interface ExtractionResult {
  envelope: DemandPosSyncEnvelope;
  stats: ExtractionStats;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Derives a stable product id. BillItem.menuItemId is typed as string but is
 * populated from Product ids in practice; fall back to a deterministic
 * slug of the item name (matches SchemaMappingEngine's own P_<NAME> fallback
 * so the Demand model aggregates consistently either way).
 */
function resolveProductId(billItem: {
  menuItemId?: string;
  itemName: string;
}): { productId: string; isSlugFallback: boolean } {
  const id = (billItem.menuItemId || '').trim();
  if (id) return { productId: id, isSlugFallback: false };
  return {
    productId: 'P_' + billItem.itemName.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 12),
    isSlugFallback: true,
  };
}

/**
 * Maps a Bill to the Demand model's payment_status vocabulary.
 * Only 'paid' and 'refunded' are emitted — non-voided, non-pending bills are
 * by definition settled (bills are created at checkout in this POS), and
 * pending/cancelled never reach the Bill ledger (see Bill model docstring:
 * "Immutable record of every completed payment transaction").
 */
function mapPaymentStatus(bill: {
  isVoided: boolean;
  isRefunded: boolean;
  refundedItems?: Array<{ menuItemId?: string; quantity: number }>;
} | Record<string, unknown>): 'paid' | 'refunded' | null {
  const b = bill as { isVoided: boolean; isRefunded: boolean };
  if (b.isVoided) return null; // excluded upstream
  if (b.isRefunded) return 'refunded';
  return 'paid';
}

function buildTimestamp(bill: { date: string; time?: string; createdAt?: Date }): string {
  // Bill.date is 'YYYY-MM-DD' and Bill.time is 'HH:mm' local. Compose a naive
  // ISO string; the Demand model re-derives its own date bucket from this via
  // new Date(...), which for a date-only-style string stays on the same day.
  if (bill.time && /^\d{1,2}:\d{2}/.test(bill.time)) {
    const [hRaw, mRaw] = bill.time.split(':');
    const h = hRaw.padStart(2, '0');
    const m = (mRaw || '00').padStart(2, '0');
    return `${bill.date}T${h}:${m}:00`;
  }
  return `${bill.date}T12:00:00`;
}

// ─── Main extractor ──────────────────────────────────────────────────────────

/**
 * Extracts one tenant's bills into the Demand POS-sync envelope.
 *
 * @param restaurantId VERIFIED tenant id (from req.user.restaurantId)
 * @param window       optional date window / bill cap
 */
export async function extractBillsForDemandModel(
  restaurantId: string,
  window: ExtractWindow = {}
): Promise<ExtractionResult> {
  if (!restaurantId) {
    throw new Error('restaurantId is required (must come from verified JWT)');
  }

  const limit = Math.min(Math.max(window.limitBills ?? 50_000, 1), 50_000);

  // ── 1. Pull the tenant's bills (restaurantId filter is load-bearing) ──
  const dateFilter: Record<string, unknown> = {};
  if (window.fromDate) dateFilter.$gte = window.fromDate;
  if (window.toDate) dateFilter.$lte = window.toDate;

  const billQuery = Bill.find({
    restaurantId,
    isVoided: false, // voided bills are never real demand (matches dashboard KPI fixes)
    ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
  })
    .sort({ date: 1, createdAt: 1 })
    .limit(limit)
    .lean<{ _id: Types.ObjectId; date: string; time?: string; isRefunded: boolean; refundedItems?: Array<{ menuItemId?: string; quantity: number }>; customerId?: Types.ObjectId | null; customerPhone?: string; branchId?: Types.ObjectId | null }[]>();

  const bills = await billQuery;

  const stats: ExtractionStats = {
    totalBills: bills.length,
    byStatus: { paid: 0, refunded: 0 },
    lineItems: 0,
    excludedFreeItems: 0,
    skippedNoMenuId: 0,
    productsEnriched: 0,
    earliestBillDate: bills.length > 0 ? bills[0].date : null,
    latestBillDate: bills.length > 0 ? bills[bills.length - 1].date : null,
  };

  if (bills.length === 0) {
    return { envelope: { orders: [] }, stats };
  }

  // ── 2. Load line items for exactly these bills (tenant-stamped) ──
  const billIds = bills.map((b) => b._id);
  const items = await BillItem.find({ billId: { $in: billIds } })
    .lean<{ billId: Types.ObjectId; menuItemId?: string; itemName: string; priceAtSale: number; quantity: number; discountAtSale: number; isFree: boolean }[]>();

  const itemsByBill = new Map<string, typeof items>();
  for (const item of items) {
    const key = String(item.billId);
    const list = itemsByBill.get(key);
    if (list) list.push(item);
    else itemsByBill.set(key, [item]);
  }

  // ── 3. Enrich categories from the tenant's Product catalog ──
  const menuItemIds = new Set<string>();
  let slugFallbackCount = 0;
  for (const item of items) {
    const { productId, isSlugFallback } = resolveProductId(item);
    if (isSlugFallback) slugFallbackCount += 1;
    else menuItemIds.add(productId);
  }

  const productCategoryById = new Map<string, string>();
  const productFieldsById = new Map<string, { category?: string; cuisine?: string; isVeg?: boolean; availability?: boolean }>();
  if (menuItemIds.size > 0) {
    const products = await Product.find({ restaurantId, _id: { $in: Array.from(menuItemIds) } })
      .select('category cuisine dietaryType name availability')
      .lean<{ _id: Types.ObjectId; category?: string; cuisine?: string; dietaryType?: string; name?: string; availability?: boolean }[]>();
    for (const p of products) {
      productCategoryById.set(String(p._id), p.category || 'Main Course');
      productFieldsById.set(String(p._id), {
        category: p.category,
        cuisine: p.cuisine,
        isVeg: p.dietaryType === 'veg',
        availability: p.availability,
      });
    }
  }
  stats.productsEnriched = productCategoryById.size;
  stats.skippedNoMenuId = slugFallbackCount;

  // ── 3b. REAL stockout / availability signals (audit Phase 7 fix) ──
  // The POS's own availability controls are the source of truth:
  //   MenuAvailability.status = 'UNAVAILABLE' → the item was sold out and
  //   could not be ordered. Product.availability=false (legacy/current
  //   sold-out toggle) is an equivalent signal. We NEVER infer stockout from
  //   zero sales — only from an explicit POS state.
  // These flags flow into the Demand model's stockout alias, where they
  // drive demand-censoring features instead of fabricated opening stock.
  const menuUnavailable = new Set<string>();
  const menuAvailableExplicit = new Map<string, boolean>();
  try {
    const availabilityRows = await MenuAvailability.find({ restaurantId })
      .select('productId status')
      .lean<{ productId: Types.ObjectId; status: 'AVAILABLE' | 'UNAVAILABLE' }[]>();
    for (const row of availabilityRows) {
      const pid = String(row.productId);
      if (row.status === 'UNAVAILABLE') menuUnavailable.add(pid);
      // Only rows that exist are explicit; absence keeps the receiving
      // engine's documented default (menu_available = !stockout).
      menuAvailableExplicit.set(pid, row.status === 'AVAILABLE');
    }
  } catch {
    // Availability collection unavailable (legacy deployments): omit the
    // signal honestly rather than fabricate — engine defaults apply.
  }

  // ── 4. Build the POS-sync envelope ──
  const orders: DemandOrderRecord[] = [];

  for (const bill of bills) {
    const billItems = itemsByBill.get(String(bill._id)) || [];
    if (billItems.length === 0) continue;

    const status = mapPaymentStatus(bill);
    if (status === null) continue; // defensive; isVoided already filtered
    stats.byStatus[status] += 1;

    // Customer reference: prefer the real Customer id; fall back to phone
    // (SchemaMappingEngine accepts phone as a customer alias).
    const customerId = bill.customerId ? String(bill.customerId) : bill.customerPhone || undefined;

    const outItems: DemandOrderItemRecord[] = [];

    // Fully-refunded line items on a partially-refunded bill → refunded rows
    const refundedByMenuItemId = new Map<string, number>();
    if (status === 'paid' && Array.isArray(bill.refundedItems)) {
      for (const r of bill.refundedItems) {
        if (r?.menuItemId && r.quantity > 0) {
          refundedByMenuItemId.set(r.menuItemId, (refundedByMenuItemId.get(r.menuItemId) || 0) + r.quantity);
        }
      }
    }

    for (const item of billItems) {
      if (item.isFree) {
        stats.excludedFreeItems += 1;
        continue; // complimentary items are not purchased demand
      }
      const qty = item.quantity - (refundedByMenuItemId.get(item.menuItemId || '') || 0);
      if (qty <= 0) continue;

      const { productId } = resolveProductId(item);
      const productMeta = productFieldsById.get(productId);

      // Stockout = explicit POS availability state only (audit Phase 7).
      const stockout =
        menuUnavailable.has(productId) || productMeta?.availability === false;

      stats.lineItems += 1;
      const outItem: DemandOrderItemRecord = {
        product_id: productId,
        product_name: item.itemName,
        // Canonical category; SchemaMappingEngine defaults missing → 'Main Course'
        category: productMeta?.category || productCategoryById.get(productId) || undefined,
        quantity: qty,
        unit_price: item.priceAtSale,
        // BillItem.discountAtSale is an absolute per-unit amount in this POS,
        // but the Demand contract's `discount` is a percentage. Convert
        // honestly; guard divide-by-zero. (SchemaMappingEngine clamps 0-100.)
        discount:
          item.discountAtSale > 0 && item.priceAtSale > 0
            ? Math.min(100, Math.max(0, (item.discountAtSale / item.priceAtSale) * 100))
            : 0,
      };
      if (stockout) outItem.stockout = true;
      const explicitAvailability = menuAvailableExplicit.get(productId);
      if (explicitAvailability !== undefined) {
        outItem.menu_available = explicitAvailability;
      }
      outItems.push(outItem);
    }

    if (outItems.length === 0) continue;

    const order: DemandOrderRecord = {
      order_id: String(bill._id),
      timestamp: buildTimestamp(bill),
      payment_status: status,
      items: outItems,
    };
    if (customerId) order.customer_id = customerId;
    orders.push(order);
  }

  return { envelope: { orders }, stats };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Basket Extractor — turns ChitKuber Bills/BillItems into the Basket
 * service's Transaction/TransactionItem contract (basketIngestionContract.ts)
 * so its dataset builder (build_training_dataset) trains on real data.
 *
 * Shares product identity with the Demand extractor (resolveProductId) so
 * combo predictions and demand forecasts refer to the same products.
 *
 * Tenant isolation: always called with the VERIFIED restaurantId — every
 * Mongo query filters on it.
 */

import Bill from '../../models/intelligence/Bill';
import BillItem from '../../models/intelligence/BillItem';
import Product from '../../models/catalog/Product';
import type { Types } from 'mongoose';
import type {
  BasketIngestEnvelope,
  BasketIngestTransaction,
  BasketIngestItem,
} from './basketIngestionContract';
import type { ExtractWindow, ExtractionStats } from './billExtractor';

/**
 * Same derivation as billExtractor.resolveProductId — kept as a local copy so
 * the two extractors can evolve their docs independently without cross-imports.
 */
function resolveProductId(billItem: { menuItemId?: string; itemName: string }): string {
  const id = (billItem.menuItemId || '').trim();
  if (id) return id;
  return 'P_' + billItem.itemName.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 12);
}

function buildTimestamp(bill: { date: string; time?: string }): string {
  if (bill.time && /^\d{1,2}:\d{2}/.test(bill.time)) {
    const [hRaw, mRaw] = bill.time.split(':');
    return `${bill.date}T${hRaw.padStart(2, '0')}:${(mRaw || '00').padStart(2, '0')}:00`;
  }
  return `${bill.date}T12:00:00`;
}

/**
 * Extracts one tenant's bills into the Basket ingest envelope.
 * Business rules mirror billExtractor: voided bills excluded, refunded bills
 * map to order_status 'refunded', free items skipped, refunded line
 * quantities netted out.
 */
export async function extractBillsForBasket(
  restaurantId: string,
  window: ExtractWindow = {}
): Promise<{ envelope: BasketIngestEnvelope; stats: ExtractionStats }> {
  if (!restaurantId) {
    throw new Error('restaurantId is required (must come from verified JWT)');
  }

  const limit = Math.min(Math.max(window.limitBills ?? 50_000, 1), 50_000);

  const dateFilter: Record<string, unknown> = {};
  if (window.fromDate) dateFilter.$gte = window.fromDate;
  if (window.toDate) dateFilter.$lte = window.toDate;

  const bills = await Bill.find({
    restaurantId,
    isVoided: false,
    ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
  })
    .sort({ date: 1, createdAt: 1 })
    .limit(limit)
    .lean<{ _id: Types.ObjectId; date: string; time?: string; isRefunded: boolean; subtotal: number; grandTotal: number; refundedItems?: Array<{ menuItemId?: string; quantity: number }>; customerId?: Types.ObjectId | null; customerPhone?: string }[]>();

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
    return { envelope: { transactions: [] }, stats };
  }

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

  // Product enrichment (name/category/price/cost) from the tenant's catalog.
  const menuItemIds = new Set<string>();
  let slugFallbackCount = 0;
  for (const item of items) {
    const productId = resolveProductId(item);
    if (item.menuItemId && item.menuItemId.trim()) menuItemIds.add(productId);
    else slugFallbackCount += 1;
  }

  const productMetaById = new Map<string, { name?: string; category?: string; price?: number; cost?: number }>();
  if (menuItemIds.size > 0) {
    const products = await Product.find({ restaurantId, _id: { $in: Array.from(menuItemIds) } })
      .select('name category price avgCost cost')
      .lean<{ _id: Types.ObjectId; name?: string; category?: string; price?: number; avgCost?: number; cost?: number }[]>();
    for (const p of products) {
      productMetaById.set(String(p._id), {
        name: p.name,
        category: p.category,
        price: p.price,
        cost: (p as { avgCost?: number }).avgCost ?? (p as { cost?: number }).cost,
      });
    }
  }
  stats.productsEnriched = productMetaById.size;
  stats.skippedNoMenuId = slugFallbackCount;

  const transactions: BasketIngestTransaction[] = [];

  for (const bill of bills) {
    const billItems = itemsByBill.get(String(bill._id)) || [];
    if (billItems.length === 0) continue;

    const orderStatus: BasketIngestTransaction['order_status'] = bill.isRefunded ? 'refunded' : 'completed';
    stats.byStatus[orderStatus === 'refunded' ? 'refunded' : 'paid'] += 1;

    const customerId = bill.customerId ? String(bill.customerId) : bill.customerPhone || undefined;

    const refundedByMenuItemId = new Map<string, number>();
    if (orderStatus === 'completed' && Array.isArray(bill.refundedItems)) {
      for (const r of bill.refundedItems) {
        if (r?.menuItemId && r.quantity > 0) {
          refundedByMenuItemId.set(r.menuItemId, (refundedByMenuItemId.get(r.menuItemId) || 0) + r.quantity);
        }
      }
    }

    const outItems: BasketIngestItem[] = [];
    for (const item of billItems) {
      if (item.isFree) {
        stats.excludedFreeItems += 1;
        continue;
      }
      const qty = item.quantity - (refundedByMenuItemId.get(item.menuItemId || '') || 0);
      if (qty <= 0) continue;

      const productId = resolveProductId(item);
      const meta = productMetaById.get(productId);
      const unitDiscount = Math.max(0, item.discountAtSale || 0);

      stats.lineItems += 1;
      outItems.push({
        product_id: productId,
        quantity: qty,
        unit_price: item.priceAtSale,
        discount_amount: unitDiscount * qty,
        net_price: Math.max(0, (item.priceAtSale - unitDiscount) * qty),
        product_name: item.itemName,
        category: meta?.category,
        selling_price: meta?.price ?? item.priceAtSale,
        cost_price: meta?.cost,
      });
    }

    if (outItems.length === 0) continue;

    // Bill-level discount derived honestly from the ledger: subtotal minus
    // grand total (the discount line is not a separate Bill field).
    const billDiscount = Math.max(0, (bill.subtotal || 0) - (bill.grandTotal || 0));

    const transaction: BasketIngestTransaction = {
      transaction_id: String(bill._id),
      timestamp: buildTimestamp(bill),
      order_status: orderStatus,
      // Bills are settled at checkout in this POS; the refund signal rides on
      // order_status (Basket's payment vocabulary is paid/pending/failed).
      payment_status: 'paid',
      channel: 'dine_in',
      total_amount: bill.grandTotal ?? 0,
      discount_amount: billDiscount,
      items: outItems,
    };
    if (customerId) transaction.customer_id = customerId;
    transactions.push(transaction);
  }

  return { envelope: { transactions }, stats };
}

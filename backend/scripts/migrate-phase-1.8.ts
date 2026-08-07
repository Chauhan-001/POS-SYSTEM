/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1.8 Migration — Reports engine.
 *
 * Safe, idempotent migration that:
 *  1. Backfills MonthlySummary + YearlySummary materialized rolls from the
 *     DailySummary collection (and bills where daily rows are missing).
 *  2. Ensures the report-critical indexes exist on Bill, BillItem, Purchase
 *     and InventoryEvent.
 *
 * Usage:  npx tsx scripts/migrate-phase-1.8.ts
 */

import mongoose from 'mongoose';
import { config } from '../src/config';
import Bill from '../src/models/Bill';
import BillItem from '../src/models/BillItem';
import Purchase from '../src/models/Purchase';
import InventoryEvent from '../src/models/InventoryEvent';
import DailySummary from '../src/models/DailySummary';
import MonthlySummary from '../src/models/MonthlySummary';
import YearlySummary from '../src/models/YearlySummary';

async function ensureIndexes(): Promise<void> {
  const tasks: Array<{ model: mongoose.Model<any>; spec: Record<string, 1 | -1>; name: string }> = [
    { model: Bill, spec: { restaurantId: 1, date: -1, isVoided: 1 }, name: 'bill_report_tenant_date' },
    { model: Bill, spec: { restaurantId: 1, paymentMethod: 1, date: -1 }, name: 'bill_report_payment' },
    { model: Bill, spec: { restaurantId: 1, orderType: 1, date: -1 }, name: 'bill_report_ordertype' },
    { model: Bill, spec: { branchId: 1, date: -1, isVoided: 1 }, name: 'bill_report_branch' },
    { model: BillItem, spec: { menuItemId: 1, billId: 1 }, name: 'billitem_menu' },
    { model: Purchase, spec: { restaurantId: 1, item: 1, date: -1 }, name: 'purchase_item_date' },
    { model: InventoryEvent, spec: { restaurantId: 1, type: 1, item: 1 }, name: 'inventoryevent_type_item' },
  ];
  for (const t of tasks) {
    const existing = await t.model.collection.indexes();
    const has = existing.some((i: any) => i.name === t.name);
    if (has) { console.log(`[migrate-1.8] index exists: ${t.name}`); continue; }
    await t.model.collection.createIndex(t.spec, { name: t.name });
    console.log(`[migrate-1.8] created index: ${t.name}`);
  }
}

/**
 * DailySummary: replace the legacy tenant-less unique index ({date, branchId})
 * with the tenant-scoped unique index ({date, branchId, restaurantId}) and
 * backfill restaurantId on legacy rows by matching a bill for the same
 * date+branchId. Without this, the legacy index blocks multi-tenant daily
 * summaries (E11000) and the new unique index build fails on null values.
 */
async function migrateDailySummary(): Promise<void> {
  const coll = DailySummary.collection;
  const indexes = await coll.indexes();
  for (const idx of indexes as any[]) {
    const keys = idx.key || {};
    const hasDate = 'date' in keys;
    const hasBranch = 'branchId' in keys;
    const hasTenant = 'restaurantId' in keys;
    // Legacy unique index: {date, branchId} without restaurantId.
    if (hasDate && hasBranch && !hasTenant && idx.unique) {
      console.log(`[migrate-1.8] dropping legacy DailySummary index: ${idx.name}`);
      await coll.dropIndex(idx.name);
    }
  }

  // Backfill restaurantId from matching bills (one lookup per legacy row).
  const missing = await DailySummary.find({ restaurantId: { $exists: false } }).lean().exec();
  for (const doc of missing) {
    const bill = await Bill.findOne({
      date: doc.date,
      ...(doc.branchId ? { branchId: doc.branchId } : {}),
    }).select('restaurantId').lean().exec();
    if (bill?.restaurantId) {
      await DailySummary.updateOne(
        { _id: doc._id },
        { $set: { restaurantId: bill.restaurantId } }
      ).exec();
    }
  }
  if (missing.length) console.log(`[migrate-1.8] backfilled restaurantId on ${missing.length} DailySummary row(s).`);

  // Ensure the schema-declared tenant-scoped unique index exists (Mongoose
  // names it exactly as the model declares, so this is idempotent).
  await DailySummary.createIndexes();
  console.log('[migrate-1.8] ensured tenant-scoped DailySummary unique index.');
}

/** Roll one month from DailySummary rows (or bills fallback). */
async function rollMonth(restaurantId: any, branchId: any, month: string): Promise<void> {
  const start = `${month}-01`;
  const end = `${month}-31`;
  const dailies = await DailySummary.find({
    restaurantId,
    ...(branchId ? { branchId } : {}),
    date: { $gte: start, $lte: end },
  }).lean().exec();

  const totalRevenue = dailies.reduce((s, d) => s + d.totalRevenue, 0);
  const totalOrders = dailies.reduce((s, d) => s + d.totalOrders, 0);
  const totalItemsSold = dailies.reduce((s, d) => s + d.totalItemsSold, 0);
  const totalDiscount = dailies.reduce((s, d) => s + d.totalDiscount, 0);
  const totalGst = dailies.reduce((s, d) => s + d.totalGst, 0);
  const cashSales = dailies.reduce((s, d) => s + (d as any).cashSales || 0, 0);

  // Fallback: aggregate bills directly when no daily rows exist for the month.
  let billsCount = totalOrders;
  if (totalOrders === 0) {
    const bills = await Bill.find({
      restaurantId,
      ...(branchId ? { branchId } : {}),
      date: { $gte: start, $lte: end },
      isVoided: { $ne: true },
    }).lean().exec();
    const bRevenue = bills.reduce((s, b) => s + b.grandTotal, 0);
    const bItems = bills.length
      ? (await BillItem.aggregate([
          { $match: { billId: { $in: bills.map((b: any) => b._id) } } },
          { $group: { _id: null, items: { $sum: '$quantity' } } },
        ]).exec())[0]?.items || 0
      : 0;
    await MonthlySummary.findOneAndUpdate(
      { restaurantId, ...(branchId ? { branchId } : { branchId: null }), month },
      {
        totalRevenue: Math.round(bRevenue * 100) / 100,
        totalOrders: bills.length,
        totalItemsSold: bItems,
        totalDiscount: bills.reduce((s, b) => s + (b.discount || 0), 0),
        totalGst: bills.reduce((s, b) => s + (b.gst || 0), 0),
        averageOrderValue: bills.length ? Math.round((bRevenue / bills.length) * 100) / 100 : 0,
        cashSales: bills.filter((b) => b.paymentMethod === 'Cash').reduce((s, b) => s + b.grandTotal, 0),
        nonCashSales: Math.round((bRevenue - bills.filter((b) => b.paymentMethod === 'Cash').reduce((s, b) => s + b.grandTotal, 0)) * 100) / 100,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).exec();
    return;
  }

  await MonthlySummary.findOneAndUpdate(
    { restaurantId, ...(branchId ? { branchId } : { branchId: null }), month },
    {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalOrders,
      totalItemsSold,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      totalGst: Math.round(totalGst * 100) / 100,
      averageOrderValue: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
      cashSales: Math.round(cashSales * 100) / 100,
      nonCashSales: Math.round((totalRevenue - cashSales) * 100) / 100,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();
}

/** Roll one year from MonthlySummary rows. */
async function rollYear(restaurantId: any, branchId: any, year: string): Promise<void> {
  const months = await MonthlySummary.find({
    restaurantId,
    ...(branchId ? { branchId } : {}),
    month: { $gte: `${year}-01`, $lte: `${year}-12` },
  }).lean().exec();
  const totalRevenue = months.reduce((s, m) => s + m.totalRevenue, 0);
  const totalOrders = months.reduce((s, m) => s + m.totalOrders, 0);
  await YearlySummary.findOneAndUpdate(
    { restaurantId, ...(branchId ? { branchId } : { branchId: null }), year },
    {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalOrders,
      totalItemsSold: months.reduce((s, m) => s + m.totalItemsSold, 0),
      totalDiscount: Math.round(months.reduce((s, m) => s + m.totalDiscount, 0) * 100) / 100,
      totalGst: Math.round(months.reduce((s, m) => s + m.totalGst, 0) * 100) / 100,
      averageOrderValue: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
      cashSales: Math.round(months.reduce((s, m) => s + m.cashSales, 0) * 100) / 100,
      nonCashSales: Math.round(months.reduce((s, m) => s + m.nonCashSales, 0) * 100) / 100,
      months: months.map((m) => ({ month: m.month, revenue: m.totalRevenue, orders: m.totalOrders })),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();
}

async function main(): Promise<void> {
  const uri = config.mongoUri;
  console.log('[migrate-1.8] Connecting to MongoDB…');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  console.log('[migrate-1.8] Connected.');

  await ensureIndexes();
  await migrateDailySummary();

  // ── Backfill Monthly/Yearly summaries ────────────────────────
  const restaurants = await Bill.distinct('restaurantId').exec();
  console.log(`[migrate-1.8] Backfilling summaries for ${restaurants.length} restaurant(s)…`);
  let monthCount = 0;
  for (const restaurantId of restaurants) {
    const months = await Bill.distinct('date').exec().then((dates) => new Set(dates.map((d: string) => d.slice(0, 7))));
    const branchIds = await Bill.distinct('branchId', { restaurantId }).exec();
    for (const month of months) {
      await rollMonth(restaurantId, null, month);
      monthCount++;
      for (const branchId of branchIds) {
        if (!branchId) continue;
        await rollMonth(restaurantId, branchId, month);
        monthCount++;
      }
    }
    const years = new Set(Array.from(months).map((m) => m.slice(0, 4)));
    for (const year of years) {
      await rollYear(restaurantId, null, year);
      for (const branchId of branchIds) {
        if (!branchId) continue;
        await rollYear(restaurantId, branchId, year);
      }
    }
  }

  console.log(`[migrate-1.8] Backfilled ${monthCount} monthly roll(s).`);
  console.log('[migrate-1.8] Done.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[migrate-1.8] Failed:', err);
  process.exit(1);
});

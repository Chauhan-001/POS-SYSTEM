/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * branchCompareService tests — multi-branch comparison intelligence:
 * KPIs with growth vs previous period, per-branch best sellers,
 * cross-branch product comparison, deterministic insights, tenant isolation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Bill from '../../../models/intelligence/Bill';
import BillItem from '../../../models/intelligence/BillItem';
import Branch from '../../../models/core/Branch';
import { branchCompareService } from '../services/branchCompareService';

let mongod: MongoMemoryServer;

const R1 = new mongoose.Types.ObjectId();
const R2 = new mongoose.Types.ObjectId(); // second tenant (isolation checks)
const B1 = new mongoose.Types.ObjectId();
const B2 = new mongoose.Types.ObjectId();
const B1_R2 = new mongoose.Types.ObjectId();

/** Business date string N days ago (Bill.date is YYYY-MM-DD). */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}
function daysAgoStr(n: number): string {
  return daysAgo(n).toISOString().slice(0, 10);
}

async function seedBill(opts: {
  restaurantId: mongoose.Types.ObjectId; branchId: mongoose.Types.ObjectId | null;
  date: Date; grandTotal: number; discount?: number;  items: Array<{ name: string; qty: number; price: number }>;
  pointsEarned?: number;
}) {
  const bill = await Bill.create({
    restaurantId: opts.restaurantId,
    branchId: opts.branchId,
    date: opts.date.toISOString().slice(0, 10),
    time: opts.date.toISOString().slice(11, 16),
    ticketNumber: `T-${Math.random().toString(36).slice(2, 8)}`,
    invoiceNumber: `INV-${Math.random().toString(36).slice(2, 8)}`,
    orderType: 'dine-in',
    paymentMethod: 'Cash',
    subtotal: opts.grandTotal,
    grandTotal: opts.grandTotal,
    discount: opts.discount ?? 0,
    pointsEarned: opts.pointsEarned ?? 10,
    cashierName: 'Test',
    cashierRole: 'Cashier',
  } as any);
  for (const it of opts.items) {
    await BillItem.create({
      billId: bill._id,
      itemName: it.name,
      quantity: it.qty,
      priceAtSale: it.price,
    } as any);
  }
  return bill;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Branch.create({ _id: B1, restaurantId: R1, name: 'Marine Drive' });
  await Branch.create({ _id: B2, restaurantId: R1, name: 'Bandra' });
  await Branch.create({ _id: B1_R2, restaurantId: R2, name: 'Other Tenant Branch' });

  // Current window (yesterday): B1 strong, B2 weak. Paneer sells best at B1.
  await seedBill({ restaurantId: R1, branchId: B1, date: daysAgo(1), grandTotal: 2000, discount: 100, items: [
    { name: 'Paneer Tikka', qty: 10, price: 120 }, { name: 'Butter Naan', qty: 20, price: 40 },
  ]});
  await seedBill({ restaurantId: R1, branchId: B1, date: daysAgo(1), grandTotal: 800, items: [
    { name: 'Paneer Tikka', qty: 4, price: 120 },
  ]});
  await seedBill({ restaurantId: R1, branchId: B2, date: daysAgo(1), grandTotal: 500, items: [
    { name: 'Veg Biryani', qty: 5, price: 100 },
  ]});

  // Previous window (2 days ago): B1 lower revenue → growth positive.
  await seedBill({ restaurantId: R1, branchId: B1, date: daysAgo(2), grandTotal: 1500, items: [
    { name: 'Paneer Tikka', qty: 6, price: 120 },
  ]});

  // Voided bill must be excluded.
  await Bill.create({
    restaurantId: R1, branchId: B1, date: daysAgoStr(1),
    time: '12:00', ticketNumber: 'T-VOID', invoiceNumber: 'INV-VOID',
    orderType: 'dine-in', paymentMethod: 'Cash', subtotal: 9999,
    grandTotal: 9999, isVoided: true, cashierName: 'Test', cashierRole: 'Cashier',
  } as any);

  // Cross-tenant noise: must never appear in R1's comparison.
  await seedBill({ restaurantId: R2, branchId: B1_R2, date: daysAgo(1), grandTotal: 77777, items: [
    { name: 'Secret Dish', qty: 99, price: 100 },
  ]});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('branchCompareService', () => {
  // Pin the window to the seeded day (yesterday) so the suite is deterministic
  // regardless of the runner's timezone — dateRange() defaults to local-today,
  // which would otherwise silently exclude the seeded bills under UTC.
  const scope = { restaurantId: String(R1), startDate: daysAgoStr(1), endDate: daysAgoStr(1) };

  it('ranks branches by revenue with share of network', async () => {
    const out = await branchCompareService.compare(scope);
    expect(out.branches).toHaveLength(2);
    expect(out.branches[0].branchName).toBe('Marine Drive');
    expect(out.branches[0].rank).toBe(1);
    // 2800 / 3300 = 84.8%
    expect(out.branches[0].shareOfNetworkPct).toBeCloseTo(84.8, 1);
    expect(out.network.totalRevenue).toBe(3300);
    expect(out.network.totalOrders).toBe(3);
  });

  it('computes AOV and net revenue after discount', async () => {
    const out = await branchCompareService.compare(scope);
    const b1 = out.branches[0];
    expect(b1.netRevenue).toBe(2700); // 2800 - 100 discount
    expect(b1.avgOrderValue).toBeCloseTo(1350, 0); // 2700 / 2
  });

  it('computes revenue growth vs the previous equal-length period', async () => {
    const out = await branchCompareService.compare(scope);
    const b1 = out.branches[0];
    // prev: 1500 → cur: 2700 → +80%
    expect(b1.revenueGrowthPct).toBeCloseTo(80, 1);
  });

  it('returns per-branch best sellers ranked by qty', async () => {
    const out = await branchCompareService.compare(scope);
    const b1 = out.branches[0];
    expect(b1.bestSellers[0].name).toBe('Butter Naan'); // 20 qty
    expect(b1.bestSellers[0].qty).toBe(20);
    expect(b1.bestSellers[1].name).toBe('Paneer Tikka'); // 14 qty
    expect(b1.bestSellers[1].qty).toBe(14);
    // share of branch revenue: naan 800/2800 ≈ 28.6%
    expect(b1.bestSellers[0].share).toBeCloseTo(28.6, 1);
  });

  it('cross-branch comparison names the winning branch per product', async () => {
    const out = await branchCompareService.compare(scope);
    const paneer = out.productComparison.find((p: any) => p.name === 'Paneer Tikka');
    expect(paneer).toBeTruthy();
    expect(paneer.totalQty).toBe(14);
    expect(paneer.bestBranch.branchName).toBe('Marine Drive');
    const biryani = out.productComparison.find((p: any) => p.name === 'Veg Biryani');
    expect(biryani.bestBranch.branchName).toBe('Bandra');
  });

  it('emits deterministic insights: leader + growth, no LLM', async () => {
    const out = await branchCompareService.compare(scope);
    const texts = out.insights.map((i: any) => i.text).join(' ');
    expect(texts).toContain('Marine Drive leads');
    expect(out.insights.every((i: any) => typeof i.text === 'string')).toBe(true);
  });

  it('is tenant isolated: R2 data never leaks into R1 (and vice versa)', async () => {
    const out = await branchCompareService.compare(scope);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('Secret Dish');
    expect(serialized).not.toContain('Other Tenant Branch');
    expect(serialized).not.toContain('77777');

    const outR2 = await branchCompareService.compare({ restaurantId: String(R2), startDate: daysAgoStr(1), endDate: daysAgoStr(1) });
    const s2 = JSON.stringify(outR2);
    expect(s2).not.toContain('Paneer Tikka');
    expect(s2).toContain('Other Tenant Branch');
  });

  it('excludes voided bills from all aggregates', async () => {
    const out = await branchCompareService.compare(scope);
    expect(out.network.totalRevenue).toBe(3300); // 9999 voided excluded
  });

  it('exposes channel and payment mix per branch', async () => {
    const out = await branchCompareService.compare(scope);
    const b1 = out.branches.find((b: any) => b.branchName === 'Marine Drive');
    expect(b1).toBeTruthy();
    expect(b1.orderTypeBreakdown).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'dine-in', orders: 2 })]),
    );
    expect(b1.paymentMethodBreakdown).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: 'Cash', orders: 2, sharePct: 100 })]),
    );
  });

  it('computes avg discount pct per branch', async () => {
    const out = await branchCompareService.compare(scope);
    const b1 = out.branches.find((b: any) => b.branchName === 'Marine Drive');
    const b2 = out.branches.find((b: any) => b.branchName === 'Bandra');
    // B1: 100 discount / 2800 subtotal = 3.57% ; B2: none.
    expect(b1.avgDiscountPct).toBeCloseTo(3.57, 1);
    expect(b2.avgDiscountPct).toBe(0);
  });

  it('surfaces network roll-up extras: discount, loyalty, head-branch leader', async () => {
    const out = await branchCompareService.compare(scope);
    expect(out.network.totalDiscount).toBe(100);
    expect(out.network.avgDiscountPct).toBeCloseTo(3.03, 1);
    expect(out.network.totalPointsEarned).toBe(30); // 10 pts × 3 billed
    expect(out.network.totalPointsRedeemed).toBe(0);
    expect(out.network.totalNetRevenue).toBe(3200); // 3300 - 100 discount
    expect(out.network.leader).toBe('Marine Drive');
  });

  it('emits head-branch leader + growth insights and suppresses low-signal ones', async () => {
    const out = await branchCompareService.compare(scope);
    const types = out.insights.map((i: any) => i.type);
    expect(types).toContain('leader');
    expect(types).toContain('growing');
    expect(types).toContain('gap');
    expect(types).toContain('aov-gap');
    // Thresholds not met by this dataset → these stay quiet.
    expect(types).not.toContain('off-premise');
    expect(types).not.toContain('digital-payments');
    expect(types).not.toContain('discount-pressure');
    const leader = out.insights.find((i: any) => i.type === 'leader');
    expect(leader.text).toContain('Marine Drive leads');
  });
});

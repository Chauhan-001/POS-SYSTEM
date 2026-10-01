/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * branchCompareService — Multi-branch comparison intelligence (reports module).
 *
 * Extends the existing branch-summary (revenue/orders/profit per branch) with
 * the owner's decision layer — a single payload that gives the whole picture:
 *
 *   1. Per-branch KPIs with GROWTH vs previous equal-length period
 *   2. Per-branch BEST SELLERS (top products by qty, with revenue share)
 *   3. CROSS-BRANCH product comparison (which branch sells what best)
 *   4. CHANNEL MIX — order-type breakdown (dine-in / takeaway / delivery) per branch
 *   5. PAYMENT MIX — payment-method breakdown per branch + digital share
 *   6. DISCOUNT DISCIPLINE — avg discount % per branch (promotion pressure)
 *   7. LOYALTY LENS — points earned / redeemed per branch
 *   8. Deterministic INSIGHTS (no LLM): leader, gaps, growth, decline,
 *      highest AOV, discount pressure, digital-payment leader, off-premise leader
 *
 * Tenant safety: every aggregation is scoped by restaurantId; branchId always
 * comes from the authenticated scope, never from the request body. Branch
 * names come from the Branch collection only. Voided/refunded bills excluded.
 */

import mongoose from 'mongoose';
import Bill from '../../../models/intelligence/Bill';
import BillItem from '../../../models/intelligence/BillItem';
import Branch from '../../../models/core/Branch';
import { dateRange } from './salesReportService';
import type { ReportScope } from '../types';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

/** Shift a YYYY-MM-DD string back N days (UTC-safe). */
function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Previous equal-length window: [start−P, end−P] for growth comparison. */
function previousWindow(start: string, end: string): { start: string; end: string } {
  const spanDays = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1);
  return { start: shiftDays(start, spanDays), end: shiftDays(end, spanDays) };
}

const pctChange = (cur: number, prev: number): number | null =>
  prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;

interface BranchKpi {
  orders: number;
  revenue: number;
  discount: number;
  subtotal: number;
  pointsEarned: number;
  pointsRedeemed: number;
  orderType: Record<string, { orders: number; revenue: number }>;
  payment: Record<string, { orders: number; amount: number }>;
}
function emptyKpi(): BranchKpi {
  return { orders: 0, revenue: 0, discount: 0, subtotal: 0, pointsEarned: 0, pointsRedeemed: 0, orderType: {}, payment: {} };
}

export class BranchCompareService {
  /**
   * Valid (non-voided, non-refunded) bill match for the tenant+window.
   * NOTE: Bill.date is a STRING (YYYY-MM-DD local business date), so the
   * range is a lexicographic string range — same convention the other
   * report services use via dateClause().
   */
  private billMatch(scope: ReportScope, start: string, end: string): Record<string, any> {
    const m: Record<string, any> = {
      restaurantId: objectId(scope.restaurantId),
      date: { $gte: start, $lte: end },
      isVoided: { $ne: true },
      isRefunded: { $ne: true },
    };
    if (scope.branchId) m.branchId = objectId(scope.branchId);
    return m;
  }

  /** Convert a raw bill into the per-branch KPI record it contributes. */
  private accumKpi(row: BranchKpi, b: any): void {
    row.orders += 1;
    row.revenue += b.grandTotal || 0;
    row.discount += b.discount || 0;
    row.subtotal += b.subtotal || 0;
    row.pointsEarned += b.pointsEarned || 0;
    row.pointsRedeemed += b.pointsRedeemed || 0;

    const ot = b.orderType || 'unknown';
    const ote = row.orderType[ot] ?? { orders: 0, revenue: 0 };
    ote.orders += 1;
    ote.revenue += b.grandTotal || 0;
    row.orderType[ot] = ote;

    const pm = b.paymentMethod || 'unknown';
    const pme = row.payment[pm] ?? { orders: 0, amount: 0 };
    pme.orders += 1;
    pme.amount += b.grandTotal || 0;
    row.payment[pm] = pme;
  }

  /**
   * Full comparison bundle for the owner. Range semantics follow the
   * module's dateRange (defaults: today).
   */
  async compare(scope: ReportScope): Promise<any> {
    const { start, end } = dateRange(scope.startDate, scope.endDate);
    const prev = previousWindow(start, end);

    const [branches, curBills, prevBills] = await Promise.all([
      Branch.find({ restaurantId: objectId(scope.restaurantId) }).select('name').lean().exec(),
      Bill.find(this.billMatch(scope, start, end))
        .select('branchId grandTotal discount orderType paymentMethod subtotal pointsEarned pointsRedeemed')
        .lean()
        .exec(),
      Bill.find(this.billMatch(scope, prev.start, prev.end))
        .select('branchId grandTotal discount orderType paymentMethod subtotal pointsEarned pointsRedeemed')
        .lean()
        .exec(),
    ]);

    const branchName = new Map<string, string>(
      (branches as any[]).map((b) => [String(b._id), b.name || 'Unnamed Branch']),
    );

    // billId → branchId (BillItem carries no branch of its own).
    const curBillBranch = new Map<string, string>(
      (curBills as any[]).map((b) => [String(b._id), b.branchId ? String(b.branchId) : 'unassigned']),
    );
    const prevBillBranch = new Map<string, string>(
      (prevBills as any[]).map((b) => [String(b._id), b.branchId ? String(b.branchId) : 'unassigned']),
    );

    // ── KPIs per branch (current + previous for growth) ─────────────
    const branchKeys = new Set<string>([
      ...branchName.keys(),
      ...(curBills as any[]).map((b) => (b.branchId ? String(b.branchId) : 'unassigned')),
    ]);

    const kpiOf = (bills: any[], branchMap: Map<string, string>) => {
      const map = new Map<string, BranchKpi>();
      for (const b of bills) {
        const bid = branchMap.get(String(b._id)) || 'unassigned';
        const row = map.get(bid) ?? emptyKpi();
        this.accumKpi(row, b);
        map.set(bid, row);
      }
      return map;
    };
    const curKpi = kpiOf(curBills as any[], curBillBranch);
    const prevKpi = kpiOf(prevBills as any[], prevBillBranch);

    // ── Best sellers: item-level aggregation, joined to branches via bill ──
    const curBillIds = (curBills as any[]).map((b) => b._id);
    const itemRows = curBillIds.length
      ? await BillItem.aggregate([
          { $match: { billId: { $in: curBillIds } } },
          {
            $group: {
              _id: '$billId',
              items: { $push: { name: '$itemName', qty: '$quantity', revenue: { $multiply: ['$priceAtSale', '$quantity'] } } },
            },
          },
        ]).exec()
      : [];

    // Map billId → (branch, product) quantities.
    const perBranch = new Map<string, Map<string, { qty: number; revenue: number }>>();
    const perProduct = new Map<string, Map<string, { qty: number; revenue: number }>>();
    for (const row of itemRows as any[]) {
      const bid = curBillBranch.get(String(row._id)) || 'unassigned';
      for (const it of row.items as Array<{ name: string; qty: number; revenue: number }>) {
        const name = it.name;
        const qty = it.qty || 0;
        const revenue = r2(it.revenue || 0);
      const bp = perBranch.get(bid) ?? new Map();
      const agg = bp.get(name) ?? { qty: 0, revenue: 0 };
      agg.qty += qty;
      agg.revenue = r2(agg.revenue + revenue);
      bp.set(name, agg);
      perBranch.set(bid, bp);
      const pp = perProduct.get(name) ?? new Map();
      const pAgg = pp.get(bid) ?? { qty: 0, revenue: 0 };
      pAgg.qty += qty;
      pAgg.revenue = r2(pAgg.revenue + revenue);
      pp.set(name, pAgg);
      perProduct.set(name, pp);
      }
    }

    /** Build the ordered per-branch list and attach network share/rank. */
    const buildRows = () => {
      const rows = Array.from(branchKeys).map((bid) => {
        const cur = curKpi.get(bid) ?? emptyKpi();
        const pv = prevKpi.get(bid) ?? emptyKpi();
        const net = r2(cur.revenue - cur.discount);
        const prevNet = r2(pv.revenue - pv.discount);
        const best = [...(perBranch.get(bid)?.entries() ?? [])]
          .sort((a, b) => b[1].qty - a[1].qty)
          .slice(0, 5)
          .map(([name, v]) => ({
            name,
            qty: v.qty,
            revenue: v.revenue,
            share: cur.revenue > 0 ? Math.round((v.revenue / cur.revenue) * 1000) / 10 : 0,
          }));

        const orderTypeBreakdown = Object.entries(cur.orderType)
          .map(([type, v]) => ({ type, orders: v.orders, revenue: r2(v.revenue) }))
          .sort((a, b) => b.revenue - a.revenue);
        const paymentMethodBreakdown = (() => {
          const raw = Object.entries(cur.payment)
            .map(([method, v]) => ({ method, orders: v.orders, amount: r2(v.amount) }))
            .sort((a, b) => b.amount - a.amount);
          const total = raw.reduce((s, e) => s + e.amount, 0);
          return raw.map((e) => ({ ...e, sharePct: total > 0 ? r2((e.amount / total) * 100) : 0 }));
        })();
        const avgDiscountPct = cur.subtotal > 0 ? r2((cur.discount / cur.subtotal) * 100) : 0;
        const prevAvgDiscountPct = pv.subtotal > 0 ? r2((pv.discount / pv.subtotal) * 100) : 0;

        return {
          branchId: bid === 'unassigned' ? '' : bid,
          branchName: bid === 'unassigned' ? 'Unassigned' : branchName.get(bid) || 'Unknown Branch',
          orders: cur.orders,
          revenue: r2(cur.revenue),
          netRevenue: net,
          avgOrderValue: cur.orders > 0 ? r2(net / cur.orders) : 0,
          ordersGrowthPct: pctChange(cur.orders, pv.orders),
          revenueGrowthPct: pctChange(net, prevNet),
          avgDiscountPct,
          avgDiscountPctPrev: prevAvgDiscountPct,
          orderTypeBreakdown,
          paymentMethodBreakdown,
          loyalty: {
            pointsEarned: cur.pointsEarned,
            pointsRedeemed: cur.pointsRedeemed,
            pointsPerOrder: cur.orders > 0 ? r2(cur.pointsEarned / cur.orders) : 0,
          },
          bestSellers: best,
        };
      });
      rows.sort((a, b) => b.revenue - a.revenue);
      const networkRevenue = rows.reduce((s, r) => s + r.revenue, 0);
      return rows.map((r, i) => ({
        ...r,
        rank: i + 1,
        shareOfNetworkPct: networkRevenue > 0 ? Math.round((r.revenue / networkRevenue) * 1000) / 10 : 0,
      }));
    };

    const ranked = buildRows();
    const networkRevenue = ranked.reduce((s, r) => s + r.revenue, 0);

    // Network roll-up across all per-branch KPIs (gross + loyalty).
    const netAll = (k: BranchKpi) => r2(k.revenue - k.discount);
    const netOrders = ranked.reduce((s, r) => s + r.orders, 0);
    const netRevenue = ranked.reduce((s, r) => s + netAll(curKpi.get(r.branchId === '' ? 'unassigned' : r.branchId) ?? emptyKpi()), 0);

    // ── Cross-branch product comparison (top 10 products) ───────────
    const productTotals = [...perProduct.entries()]
      .map(([name, byBranch]) => ({
        name,
        totalQty: [...byBranch.values()].reduce((s, v) => s + v.qty, 0),
      }))
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 10);

    const productComparison = productTotals.map((p) => {
      const byBranch = perProduct.get(p.name)!;
      const entries = ranked
        .map((r) => ({
          branchId: r.branchId,
          branchName: r.branchName,
          qty: byBranch.get(r.branchId || 'unassigned')?.qty ?? 0,
        }))
        .sort((a, b) => b.qty - a.qty);
      const total = entries.reduce((s, e) => s + e.qty, 0);
      return {
        name: p.name,
        totalQty: total,
        bestBranch: entries[0]?.qty > 0 ? { branchId: entries[0].branchId, branchName: entries[0].branchName, qty: entries[0].qty } : null,
        rows: entries.map((e) => ({
          ...e,
          shareOfProductPct: total > 0 ? Math.round((e.qty / total) * 1000) / 10 : 0,
        })),
      };
    });

    // ── Deterministic insights (no LLM) ─────────────────────────────
    const insights: Array<{ type: string; severity: 'info' | 'positive' | 'warning'; text: string }> = [];
    const withRevenue = ranked.filter((r) => r.revenue > 0);
    if (withRevenue.length >= 2) {
      const top = withRevenue[0];
      const bottom = withRevenue[withRevenue.length - 1];
      insights.push({
        type: 'leader',
        severity: 'positive',
        text: `${top.branchName} leads as the head branch — ${top.shareOfNetworkPct}% of network revenue (${fmtCurrency(top.revenue)} across ${top.orders} orders).`,
      });
      const shareGap = top.shareOfNetworkPct - bottom.shareOfNetworkPct;
      if (shareGap > 25) {
        insights.push({
          type: 'gap',
          severity: 'warning',
          text: `${bottom.branchName} contributes only ${bottom.shareOfNetworkPct}% vs ${top.branchName}'s ${top.shareOfNetworkPct}% — review staffing, menu availability and local marketing.`,
        });
      }
      const declining = ranked.filter((r) => (r.revenueGrowthPct ?? 0) < -10 && r.revenue > 0);
      for (const d of declining.slice(0, 3)) {
        insights.push({
          type: 'declining',
          severity: 'warning',
          text: `${d.branchName} revenue is down ${Math.abs(d.revenueGrowthPct ?? 0)}% vs the previous period.`,
        });
      }
      const growing = ranked.filter((r) => (r.revenueGrowthPct ?? 0) > 10 && r.revenue > 0);
      for (const g of growing.slice(0, 3)) {
        insights.push({
          type: 'growing',
          severity: 'positive',
          text: `${g.branchName} is growing (+${g.revenueGrowthPct}% vs previous period) — consider replicating what is working there.`,
        });
      }

      // ── Channel strategy ─────────────────────────────────────
      const offPremise = (r: any) => {
        const ta = (r.orderTypeBreakdown ?? []).reduce((s: number, e: any) => s + (e.type === 'takeaway' || e.type === 'delivery' ? e.orders : 0), 0);
        return r.orders > 0 ? (ta / r.orders) * 100 : 0;
      };
      const offPremiseLeader = [...withRevenue].sort((a, b) => offPremise(b) - offPremise(a))[0];
      const opPct = offPremise(offPremiseLeader);
      if (opPct >= 20) {
        insights.push({
          type: 'off-premise',
          severity: 'info',
          text: `${offPremiseLeader.branchName} leads off-premise (takeaway/delivery) at ${Math.round(opPct)}% of its orders — strongest candidate for delivery-pack / dark-kitchen focus.`,
        });
      }

      // ── Payment mix ──────────────────────────────────────────
      const digitalShare = (r: any) => {
        const pm = r.paymentMethodBreakdown ?? [];
        const dig = pm.filter((e: any) => e.method !== 'Cash').reduce((s: number, e: any) => s + e.amount, 0);
        return r.revenue > 0 ? (dig / r.revenue) * 100 : 0;
      };
      const digLeader = [...withRevenue].sort((a, b) => digitalShare(b) - digitalShare(a))[0];
      const digPct = digitalShare(digLeader);
      if (digPct >= 50) {
        insights.push({
          type: 'digital-payments',
          severity: 'info',
          text: `${digLeader.branchName} is the digital-payments leader (${Math.round(digPct)}% non-cash) — review card/POS fees and UPI settlement timing there.`,
        });
      }

      // ── AOV lens ─────────────────────────────────────────────
      const aovLeader = [...withRevenue].sort((a, b) => b.avgOrderValue - a.avgOrderValue)[0];
      const aovLaggard = [...withRevenue].sort((a, b) => a.avgOrderValue - b.avgOrderValue)[0];
      if (aovLeader.avgOrderValue > 0 && aovLaggard.avgOrderValue > 0) {
        const ratio = aovLeader.avgOrderValue / aovLaggard.avgOrderValue;
        if (ratio >= 1.25) {
          insights.push({
            type: 'aov-gap',
            severity: 'info',
            text: `${aovLeader.branchName} has a ${Math.round((ratio - 1) * 100)}% higher AOV than ${aovLaggard.branchName} (${fmtCurrency(aovLeader.avgOrderValue)} vs ${fmtCurrency(aovLaggard.avgOrderValue)}) — study its upsell/menu mix.`,
          });
        }
      }

      // ── Discount discipline ───────────────────────────────────
      const discLeader = [...withRevenue].sort((a, b) => b.avgDiscountPct - a.avgDiscountPct)[0];
      const discPct = discLeader.avgDiscountPct;
      if (discPct >= 5) {
        insights.push({
          type: 'discount-pressure',
          severity: 'warning',
          text: `${discLeader.branchName} runs the heaviest average discount (${discPct}% of subtotal) — check whether promotions are cannibalising margin versus driving volume.`,
        });
      }
    } else if (ranked.length > 0) {
      insights.push({
        type: 'no_data',
        severity: 'info',
        text: 'Not enough sales data in this window for branch comparison.',
      });
    }

    return {
      period: { start, end, previous: prev },
      branches: ranked,
      network: {
        totalRevenue: r2(networkRevenue),
        totalNetRevenue: r2(netRevenue),
        totalOrders: netOrders,
        branchCount: ranked.filter((r) => r.revenue > 0).length,
        totalDiscount: r2(ranked.reduce((s, r) => s + (curKpi.get(r.branchId === '' ? 'unassigned' : r.branchId)?.discount ?? 0), 0)),
        avgDiscountPct: withRevenue.length ? r2((ranked.reduce((s, r) => s + (curKpi.get(r.branchId === '' ? 'unassigned' : r.branchId)?.discount ?? 0), 0) / withRevenue.reduce((s, r) => s + (curKpi.get(r.branchId === '' ? 'unassigned' : r.branchId)?.subtotal ?? 0), 0)) * 100) : 0,
        totalPointsEarned: ranked.reduce((s, r) => s + r.loyalty.pointsEarned, 0),
        totalPointsRedeemed: ranked.reduce((s, r) => s + r.loyalty.pointsRedeemed, 0),
        leader: ranked[0]?.branchName || null,
      },
      productComparison,
      insights,
    };
  }
}

function fmtCurrency(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export const branchCompareService = new BranchCompareService();

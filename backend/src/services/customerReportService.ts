/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CustomerReport Service — CRM reporting (Phase 1.6).
 * Top customers, repeat rate, retention, churn, LTV, average spend, visit
 * frequency, points issued/redeemed, reward & coupon usage, referral
 * performance, segment distribution, birthdays, dormant, VIP, growth.
 * Everything is aggregated server-side (never from client numbers).
 */

import mongoose from 'mongoose';
import Customer from '../models/Customer';
import Bill from '../models/Bill';
import CustomerSegment from '../models/CustomerSegment';
import Referral from '../models/Referral';
import CouponRedemption from '../models/CouponRedemption';
import Reward from '../models/Reward';
import { loyaltyService } from './index';

function objectId(v: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(v);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class CustomerReportService {
  /**
   * Build the full CRM report bundle for a restaurant.
   */
  async getReport(restaurantId: string, params: { startDate?: string; endDate?: string; limit?: number; tier?: string } = {}): Promise<any> {
    const limit = params.limit || 50;
    const customerQuery: any = { restaurantId: objectId(restaurantId), isDeleted: { $ne: true } };
    if (params.tier) customerQuery.tier = params.tier;

    const [customers, totalCustomers, bills, segments, referrals, couponUses, rewards, totals] = await Promise.all([
      Customer.find(customerQuery).lean().exec(),
      Customer.countDocuments({ restaurantId: objectId(restaurantId), isDeleted: { $ne: true } }),
      Bill.find({ restaurantId: objectId(restaurantId), isVoided: { $ne: true }, isRefunded: { $ne: true } }).lean().exec(),
      CustomerSegment.find({ restaurantId: objectId(restaurantId), isDeleted: { $ne: true } }).lean().exec(),
      Referral.find({ restaurantId: objectId(restaurantId) }).lean().exec(),
      CouponRedemption.find({ restaurantId: objectId(restaurantId), status: 'applied' }).lean().exec(),
      Reward.find({ isDeleted: { $ne: true } }).lean().exec(),
      loyaltyService.getTotals(restaurantId, params.startDate, params.endDate),
    ]);

    const now = Date.now();

    // ── Tier & status distribution ──────────────────────────
    const tierCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};
    let vipCount = 0;
    let totalSpendSum = 0;
    let totalOrders = 0;
    const daysSinceLastVisit: number[] = [];
    const birthdays: any[] = [];
    const todayMMDD = `${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;

    for (const c of customers) {
      tierCounts[c.tier || 'Bronze'] = (tierCounts[c.tier || 'Bronze'] || 0) + 1;
      statusCounts[c.status || 'active'] = (statusCounts[c.status || 'active'] || 0) + 1;
      if (c.isVip) vipCount++;
      totalSpendSum += c.totalSpend || 0;
      totalOrders += c.totalOrders || 0;
      if (c.lastVisit) {
        daysSinceLastVisit.push(Math.floor((now - new Date(c.lastVisit).getTime()) / DAY_MS));
      }
      if (c.birthday && c.birthday.length >= 5 && c.birthday.slice(5) === todayMMDD) {
        birthdays.push({ phone: c.phone, name: c.name, birthday: c.birthday, tier: c.tier });
      }
    }

    const withLastVisit = daysSinceLastVisit.length;
    const dormant = daysSinceLastVisit.filter((d) => d >= 30).length;
    const returning = customers.filter((c) => c.visits > 1).length;
    const frequent = customers.filter((c) => c.visits >= 10).length;

    // ── Top customers (by total spend) ───────────────────────
    const topCustomers = [...customers]
      .sort((a, b) => (b.totalSpend || 0) - (a.totalSpend || 0))
      .slice(0, limit)
      .map((c) => ({
        phone: c.phone,
        name: c.name,
        tier: c.tier,
        totalSpend: c.totalSpend,
        averageSpend: c.averageSpend,
        visits: c.visits,
        totalOrders: c.totalOrders,
        points: c.points,
        walletBalance: c.walletBalance,
        lastVisit: c.lastVisit,
        isVip: c.isVip,
      }));

    // ── Repeat / retention / churn ───────────────────────────
    const repeatRate = totalCustomers > 0 ? Math.round((returning / totalCustomers) * 1000) / 10 : 0;
    const churnRate = totalCustomers > 0 ? Math.round((dormant / totalCustomers) * 1000) / 10 : 0;
    const averageSpend = customers.length > 0 ? Math.round((totalSpendSum / customers.length) * 100) / 100 : 0;
    const averageVisitFrequency = withLastVisit > 0
      ? Math.round((daysSinceLastVisit.reduce((s, d) => s + d, 0) / withLastVisit) * 10) / 10
      : 0;
    const averageOrdersPerCustomer = totalCustomers > 0 ? Math.round((totalOrders / totalCustomers) * 10) / 10 : 0;

    // ── Reward usage ─────────────────────────────────────────
    const rewardUsage = rewards
      .filter((r) => r.redeemedCount > 0)
      .sort((a, b) => b.redeemedCount - a.redeemedCount)
      .slice(0, 20)
      .map((r) => ({ title: r.title, redeemedCount: r.redeemedCount, pointsRequired: r.pointsRequired }));

    // ── Coupon usage ─────────────────────────────────────────
    const couponUsage = couponUses.reduce<Record<string, number>>((acc, c) => {
      const key = c.code || c.offerId?.toString?.() || 'offer';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const couponUsageList = Object.entries(couponUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([code, uses]) => ({ code, uses }));

    // ── Referral performance ─────────────────────────────────
    const referredCount = referrals.length;
    const rewardedCount = referrals.filter((r) => r.status === 'rewarded').length;

    // ── Growth (new customers by month, last 6) ──────────────
    const growth: Array<{ month: string; newCustomers: number }> = [];
    const monthMap = new Map<string, number>();
    for (const c of customers) {
      const d = new Date(c.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthMap.set(key, (monthMap.get(key) || 0) + 1);
    }
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      growth.push({ month: key, newCustomers: monthMap.get(key) || 0 });
    }

    // ── Segments distribution ────────────────────────────────
    const segmentDistribution = segments
      .map((s) => ({ name: s.name, type: s.type, customerCount: s.customerCount || 0 }))
      .sort((a, b) => b.customerCount - a.customerCount)
      .slice(0, 30);

    // ── Average bill from bills (LTV proxy) ──────────────────
    const billTotals = bills.map((b) => b.grandTotal || 0);
    const avgBill = billTotals.length > 0 ? Math.round((billTotals.reduce((s, v) => s + v, 0) / billTotals.length) * 100) / 100 : 0;
    const totalRevenue = billTotals.reduce((s, v) => s + v, 0);

    return {
      summary: {
        totalCustomers,
        vipCount,
        totalSpend: Math.round(totalSpendSum * 100) / 100,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        avgBill,
        avgOrdersPerCustomer: averageOrdersPerCustomer,
        averageSpend,
        repeatRate,
        churnRate,
        averageVisitFrequency,
        dormantCount: dormant,
        frequentCount: frequent,
        returningCount: returning,
        birthdayToday: birthdays.length,
        pointsIssued: totals.pointsIssued,
        pointsRedeemed: totals.pointsRedeemed,
        walletCredited: totals.walletCredited,
        referralCount: referredCount,
        referralRewarded: rewardedCount,
        couponUsesTotal: couponUses.length,
      },
      tierDistribution: tierCounts,
      statusDistribution: statusCounts,
      topCustomers,
      birthdaysToday: birthdays,
      rewardUsage,
      couponUsage: couponUsageList,
      referralPerformance: { total: referredCount, rewarded: rewardedCount },
      segmentDistribution,
      growth,
    };
  }

  /** Build a CSV export of the summary + top customers. */
  async exportCsv(restaurantId: string, params: { startDate?: string; endDate?: string; limit?: number } = {}): Promise<string> {
    const report = await this.getReport(restaurantId, params);
    const lines: string[] = [];
    lines.push('Customer CRM Report');
    lines.push(`Generated,${new Date().toISOString()}`);
    lines.push('');
    lines.push('Metric,Value');
    for (const [k, v] of Object.entries(report.summary)) {
      lines.push(`${k},${v}`);
    }
    lines.push('');
    lines.push('Top Customers');
    lines.push('Phone,Name,Tier,Total Spend,Avg Spend,Visits,Orders,Points,Wallet,Last Visit');
    for (const c of report.topCustomers) {
      lines.push(`${c.phone},${this.escape(c.name)},${c.tier},${c.totalSpend},${c.averageSpend},${c.visits},${c.totalOrders},${c.points},${c.walletBalance},${c.lastVisit ? new Date(c.lastVisit).toISOString().slice(0, 10) : ''}`);
    }
    return lines.join('\n');
  }

  private escape(v: any): string {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
}

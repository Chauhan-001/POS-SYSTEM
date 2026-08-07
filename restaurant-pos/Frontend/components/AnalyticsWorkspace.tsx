/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AnalyticsWorkspace — Deep business intelligence with period-over-period
 * comparisons, revenue/profit trends, peak hours, popular vs slow movers,
 * category performance, and cashier analytics.
 *
 * Phase 1.8: every aggregate is computed by the backend reporting engine.
 * React renders server-generated reports; local estimates are only used as
 * an offline fallback when no cached server data exists.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, Calendar, Clock, Activity,
  ShoppingBag, Users, Award, BarChart3,
  ArrowUpRight, ArrowDownRight, Minus, Layers,
  Sun, Moon, Sunrise, Sunset,
} from 'lucide-react';
import type { Bill, ExpenseEntry } from '../src/types';
import {
  fetchSalesSummary, fetchSalesTrend, fetchSalesPayments, fetchSalesOrderTypes,
  fetchSalesCashiers, fetchSalesPeakHours, fetchProductTop, fetchProductLeast,
  fetchProductCategories, fetchFinancePnl,
} from '../src/api/client';
import type {
  SalesSummaryReport, SalesTrendPoint, SalesPaymentRow, SalesOrderTypeRow,
  SalesCashierRow, SalesHourRow, ProductReportRow,
} from '../src/types';

interface AnalyticsWorkspaceProps {
  bills: Bill[];
  expenses: ExpenseEntry[];
  currencySymbol: string;
}

type PeriodPreset = '7d' | '30d' | '90d' | 'custom';

function formatCurrency(amount: number, symbol: string): string {
  return `${symbol}${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
}

function formatShort(n: number): string {
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(0);
}

const PIE_COLORS = ['#004ac6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#6366f1'];

interface FinancePnl {
  netProfit: number;
  totalExpenses: number;
  margin: number;
}

export default function AnalyticsWorkspace({ bills, expenses, currencySymbol }: AnalyticsWorkspaceProps) {
  const [preset, setPreset] = useState<PeriodPreset>('30d');
  const [startDate, setStartDate] = useState(daysAgo(30));
  const [endDate, setEndDate] = useState(getTodayString());

  const handlePreset = (p: PeriodPreset) => {
    setPreset(p);
    switch (p) {
      case '7d': setStartDate(daysAgo(7)); setEndDate(getTodayString()); break;
      case '30d': setStartDate(daysAgo(30)); setEndDate(getTodayString()); break;
      case '90d': setStartDate(daysAgo(90)); setEndDate(getTodayString()); break;
      case 'custom': break;
    }
  };

  const previousStartDate = useMemo(() => {
    const rangeMs = new Date(endDate).getTime() - new Date(startDate).getTime();
    const prevStartTs = new Date(startDate).getTime() - rangeMs;
    return new Date(prevStartTs).toISOString().split('T')[0];
  }, [startDate, endDate]);

  const previousEndDate = useMemo(() => {
    const prevTs = new Date(startDate).getTime() - 86400000;
    return new Date(prevTs).toISOString().split('T')[0];
  }, [startDate]);

  // ─── Phase 1.8: backend report fetch + cache ─────────────────────
  const [report, setReport] = useState<{
    summary: SalesSummaryReport | null;
    trend: SalesTrendPoint[] | null;
    payments: SalesPaymentRow[] | null;
    orderTypes: SalesOrderTypeRow[] | null;
    cashiers: SalesCashierRow[] | null;
    peakHours: SalesHourRow[] | null;
    topProducts: ProductReportRow[] | null;
    leastProducts: ProductReportRow[] | null;
    categories: { category: string; qty: number; revenue: number }[] | null;
  } | null>(null);
  const [pnl, setPnl] = useState<FinancePnl | null>(null);
  const billsVersion = `${bills.length}|${bills.length ? bills[bills.length - 1].id : 'empty'}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, t, p, ot, c, ph, tp, lp, cat, fin] = await Promise.all([
        fetchSalesSummary(startDate, endDate),
        fetchSalesTrend(startDate, endDate),
        fetchSalesPayments(startDate, endDate),
        fetchSalesOrderTypes(startDate, endDate),
        fetchSalesCashiers(startDate, endDate),
        fetchSalesPeakHours(startDate, endDate),
        fetchProductTop(startDate, endDate, 10),
        fetchProductLeast(startDate, endDate, 5),
        fetchProductCategories(startDate, endDate),
        fetchFinancePnl('custom', startDate, endDate).then(r => r ?? null).catch(() => null),
      ]);
      if (cancelled) return;
      if (s.data || t.data || p.data || ot.data || c.data || ph.data || tp.data || lp.data || cat.data) {
        setReport({
          summary: s.data ?? null,
          trend: t.data ?? null,
          payments: p.data ?? null,
          orderTypes: ot.data ?? null,
          cashiers: c.data ?? null,
          peakHours: ph.data ?? null,
          topProducts: tp.data ?? null,
          leastProducts: lp.data ?? null,
          categories: cat.data ?? null,
        });
      } else {
        setReport(null);
      }
      if (fin && typeof fin.netProfit === 'number') {
        setPnl({ netProfit: fin.netProfit, totalExpenses: fin.totalExpenses || 0, margin: fin.margin || 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [startDate, endDate, billsVersion]);

  // ===== FILTER BILLS (offline fallback + ledger-less local views) =====
  const currentBills = useMemo(() =>
    bills.filter(b => b.date >= startDate && b.date <= endDate),
  [bills, startDate, endDate]);

  const previousBills = useMemo(() =>
    bills.filter(b => b.date >= previousStartDate && b.date <= previousEndDate),
  [bills, previousStartDate, previousEndDate]);

  // ─── Local estimates — OFFLINE FALLBACK ONLY ─────────────────────
  const localRevenue = useMemo(() => currentBills.reduce((s, b) => s + b.grandTotal, 0), [currentBills]);
  const localOrders = useMemo(() => currentBills.length, [currentBills]);
  const localAvgOrder = useMemo(() => localOrders > 0 ? localRevenue / localOrders : 0, [localRevenue, localOrders]);
  const localItems = useMemo(() => currentBills.reduce((s, b) => s + b.items.reduce((si, i) => si + i.quantity, 0), 0), [currentBills]);
  const localDiscount = useMemo(() => currentBills.reduce((s, b) => s + b.discount, 0), [currentBills]);
  const localPrevRevenue = useMemo(() => previousBills.reduce((s, b) => s + b.grandTotal, 0), [previousBills]);
  const localPrevOrders = useMemo(() => previousBills.length, [previousBills]);
  const localPrevAvgOrder = useMemo(() => localPrevOrders > 0 ? localPrevRevenue / localPrevOrders : 0, [localPrevRevenue, localPrevOrders]);
  const localPrevItems = useMemo(() => previousBills.reduce((s, b) => s + b.items.reduce((si, i) => si + i.quantity, 0), 0), [previousBills]);

  const localExpenses = useMemo(() =>
    expenses.filter(e => e.date >= startDate && e.date <= endDate).reduce((s, e) => s + e.amount, 0),
  [expenses, startDate, endDate]);

  const localTrendData = useMemo(() => {
    const map: Record<string, { revenue: number; orders: number; items: number }> = {};
    currentBills.forEach(b => {
      if (!map[b.date]) map[b.date] = { revenue: 0, orders: 0, items: 0 };
      map[b.date].revenue += b.grandTotal;
      map[b.date].orders += 1;
      map[b.date].items += b.items.reduce((s, i) => s + i.quantity, 0);
    });
    return Object.keys(map).sort().map(date => ({
      date,
      Revenue: Number(map[date].revenue.toFixed(2)),
      Orders: map[date].orders,
      Items: map[date].items,
    }));
  }, [currentBills]);

  const localPeakHoursData = useMemo(() => {
    const hourlyMap: Record<number, number> = {};
    currentBills.forEach(b => {
      const hour = parseInt(b.time.split(':')[0], 10);
      if (!isNaN(hour)) hourlyMap[hour] = (hourlyMap[hour] || 0) + 1;
    });
    const result: { hour: string; orders: number; }[] = [];
    for (let h = 6; h <= 23; h++) {
      result.push({ hour: `${h.toString().padStart(2, '0')}:00`, orders: hourlyMap[h] || 0 });
    }
    return result;
  }, [currentBills]);

  const localOrderTypeData = useMemo(() => {
    const map: Record<string, number> = {};
    currentBills.forEach(b => {
      map[b.orderType] = (map[b.orderType] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [currentBills]);

  const localTopItems = useMemo(() => {
    const map: Record<string, { name: string; qty: number; revenue: number; category: string }> = {};
    currentBills.forEach(b => {
      b.items.forEach(item => {
        const id = item.product.id;
        if (!map[id]) {
          map[id] = { name: item.product.name, qty: 0, revenue: 0, category: item.product.category };
        }
        map[id].qty += item.quantity;
        map[id].revenue += item.price * item.quantity;
      });
    });
    return Object.values(map).sort((a, b) => b.qty - a.qty);
  }, [currentBills]);

  const localCategoryData = useMemo(() => {
    const map: Record<string, { qty: number; revenue: number }> = {};
    currentBills.forEach(b => {
      b.items.forEach(item => {
        const cat = item.product.category;
        if (!map[cat]) map[cat] = { qty: 0, revenue: 0 };
        map[cat].qty += item.quantity;
        map[cat].revenue += item.price * item.quantity;
      });
    });
    return Object.entries(map)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [currentBills]);

  const localCashierData = useMemo(() => {
    const map: Record<string, { orders: number; revenue: number; items: number }> = {};
    currentBills.forEach(b => {
      if (!map[b.cashierName]) map[b.cashierName] = { orders: 0, revenue: 0, items: 0 };
      map[b.cashierName].orders += 1;
      map[b.cashierName].revenue += b.grandTotal;
      map[b.cashierName].items += b.items.reduce((s, i) => s + i.quantity, 0);
    });
    return Object.entries(map)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [currentBills]);

  const localPaymentMethodData = useMemo(() => {
    const map: Record<string, number> = {};
    currentBills.forEach(b => {
      map[b.paymentMethod] = (map[b.paymentMethod] || 0) + b.grandTotal;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value);
  }, [currentBills]);

  // ─── Data source selection: backend first, local fallback ───────
  const summary = report?.summary ?? null;

  // Current period KPIs (backend authoritative)
  const currentRevenue = summary ? summary.summary.netSales : localRevenue;
  const currentOrders = summary ? summary.summary.orders : localOrders;
  const currentAvgOrder = summary ? summary.summary.averageOrderValue : localAvgOrder;
  const currentItems = summary ? summary.summary.itemsSold : localItems;
  const currentDiscount = summary ? summary.summary.discounts : localDiscount;

  // Previous period KPIs (backend comparison values)
  const prevRevenue = summary ? summary.comparison.previousNetRevenue : localPrevRevenue;
  const prevOrders = summary ? summary.comparison.previousOrders : localPrevOrders;
  const prevAvgOrder = summary ? (summary.comparison.previousOrders > 0 ? summary.comparison.previousNetRevenue / summary.comparison.previousOrders : 0) : localPrevAvgOrder;
  const prevItems = summary ? (summary.comparison.previousItems ?? localPrevItems) : localPrevItems;

  // Net profit — backend finance P&L when available; local estimate offline.
  const currentNetProfit = pnl ? pnl.netProfit : currentRevenue - localExpenses;
  const profitMargin = pnl ? pnl.margin : (currentRevenue > 0 ? (currentNetProfit / currentRevenue) * 100 : 0);

  // % change helpers
  const pctChange = (current: number, previous: number): number => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  const revenueChange = pctChange(currentRevenue, prevRevenue);
  const ordersChange = pctChange(currentOrders, prevOrders);
  const avgOrderChange = pctChange(currentAvgOrder, prevAvgOrder);
  const itemsChange = pctChange(currentItems, prevItems);

  // ===== DAILY REVENUE TREND (backend aggregation) =====
  const dailyRevenueData = report?.trend != null
    ? report.trend.map(p => ({
        date: p.date || p.name || '',
        Revenue: p.revenue,
        Orders: p.orders,
        Items: p.items || 0,
      }))
    : localTrendData;

  // ===== PEAK HOURS (backend aggregation) =====
  const peakHoursData = report?.peakHours != null ? report.peakHours : localPeakHoursData;

  const peakHour = useMemo(() => {
    let max = 0; let maxH = '';
    peakHoursData.forEach(d => { if (d.orders > max) { max = d.orders; maxH = d.hour; } });
    return { hour: maxH, count: max };
  }, [peakHoursData]);

  // ===== ORDER TYPE DISTRIBUTION (backend aggregation) =====
  const orderTypeData = report?.orderTypes != null
    ? report.orderTypes.map(o => ({ name: o.type, value: o.count }))
    : localOrderTypeData;

  // ===== TOP ITEMS (backend aggregation) =====
  const topItems = report?.topProducts != null
    ? report.topProducts.map(p => ({ name: p.name, qty: p.qty, revenue: p.revenue, category: p.category || 'Uncategorized' }))
    : localTopItems;

  const topSelling = useMemo(() => topItems.slice(0, 10), [topItems]);
  const slowMovers = useMemo(() => topItems.filter(i => i.qty <= (topItems[0]?.qty || 1) * 0.1).slice(0, 5), [topItems]);

  // ===== CATEGORY PERFORMANCE (backend aggregation) =====
  const categoryData = report?.categories != null
    ? report.categories.map(c => ({ name: c.category, qty: c.qty, revenue: c.revenue }))
    : localCategoryData;

  // ===== CASHIER PERFORMANCE (backend aggregation) =====
  const cashierData = report?.cashiers != null
    ? report.cashiers.map(c => ({ name: c.cashier, orders: c.orders, revenue: c.revenue, items: c.itemsSold }))
    : localCashierData;

  // ===== PAYMENT METHOD BREAKDOWN (backend aggregation) =====
  const paymentMethodData = report?.payments != null
    ? report.payments.map(p => ({ name: p.method, value: p.amount }))
    : localPaymentMethodData;

  const maxRevenue = dailyRevenueData.length > 0
    ? Math.max(...dailyRevenueData.map(d => d.Revenue), 1)
    : 1;

  // Show date range label
  const getRangeLabel = () => {
    const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
    return `${startDate} → ${endDate} (${days} days)`;
  };

  // Show the empty state only when there is neither local nor backend/cached
  // data — otherwise backend-computed reports still render on a fresh device
  // whose local bills array is empty.
  if (currentBills.length === 0 && !report) {
    return (
      <div className="flex flex-col h-full bg-[#faf8ff] items-center justify-center">
        <BarChart3 className="w-20 h-20 text-gray-200 mb-4" />
        <h2 className="text-lg font-bold text-gray-300">No Data for This Period</h2>
        <p className="text-sm text-gray-300 mt-1">Try selecting a different date range or process some orders first.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#faf8ff]">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-5">

        {/* ===== HEADER ===== */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-black text-gray-900">Analytics</h1>
              <p className="text-[10px] text-gray-400">Business intelligence & performance trends</p>
            </div>
          </div>
          {/* Period presets */}
          <div className="flex items-center gap-1.5 bg-white rounded-xl border border-[#e1e2ed] p-1 shadow-xs">
            {(['7d', '30d', '90d'] as PeriodPreset[]).map(p => (
              <button key={p} onClick={() => handlePreset(p)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                  preset === p ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}>
                {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '90 Days'}
              </button>
            ))}
            <div className="w-px h-5 bg-gray-200 mx-0.5" />
            <div className="flex items-center gap-1 px-2">
              <Calendar className="w-3.5 h-3.5 text-gray-400" />
              <input type="date" value={startDate} onChange={e => { setPreset('custom'); setStartDate(e.target.value); }}
                className="w-28 px-1.5 py-1 border border-gray-200 rounded text-[9px] font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer" />
              <span className="text-[9px] text-gray-400">to</span>
              <input type="date" value={endDate} onChange={e => { setPreset('custom'); setEndDate(e.target.value); }}
                className="w-28 px-1.5 py-1 border border-gray-200 rounded text-[9px] font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer" />
            </div>
          </div>
        </div>

        {/* ===== PERIOD LABEL ===== */}
        <div className="text-[10px] text-gray-400 flex items-center gap-2">
          <Calendar className="w-3 h-3" />
          <span>Period: <strong className="text-gray-600">{getRangeLabel()}</strong></span>
          <span className="text-gray-300">|</span>
          <span>Previous: <strong className="text-gray-600">{previousStartDate} → {previousEndDate}</strong></span>
        </div>

        {/* ===== KPI CARDS WITH % CHANGE ===== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Revenue */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Revenue</p>
              <div className={`flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                revenueChange >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
              }`}>
                {revenueChange >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {Math.abs(revenueChange).toFixed(1)}%
              </div>
            </div>
            <p className="text-2xl font-black text-gray-900 font-mono">{formatCurrency(currentRevenue, currencySymbol)}</p>
            <p className="text-[9px] text-gray-400 mt-0.5">{currentOrders} orders · {formatShort(currentItems)} items</p>
          </div>

          {/* Orders */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Orders</p>
              <div className={`flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                ordersChange >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
              }`}>
                {ordersChange >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {Math.abs(ordersChange).toFixed(1)}%
              </div>
            </div>
            <p className="text-2xl font-black text-gray-900 font-mono">{currentOrders}</p>
            <p className="text-[9px] text-gray-400 mt-0.5">Avg {formatCurrency(currentAvgOrder, currencySymbol)} per order</p>
          </div>

          {/* Net Profit */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider mb-2">Net Profit</p>
            <p className={`text-2xl font-black font-mono ${currentNetProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(currentNetProfit, currencySymbol)}
            </p>
            <p className="text-[9px] text-gray-400 mt-0.5">
              {currentRevenue > 0 ? `${profitMargin.toFixed(1)}% margin` : '—'}
            </p>
          </div>

          {/* Avg Order Value */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Avg Order</p>
              <div className={`flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                avgOrderChange >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
              }`}>
                {avgOrderChange >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {Math.abs(avgOrderChange).toFixed(1)}%
              </div>
            </div>
            <p className="text-2xl font-black text-gray-900 font-mono">{formatCurrency(currentAvgOrder, currencySymbol)}</p>
            <p className="text-[9px] text-gray-400 mt-0.5">{currentDiscount > 0 ? `${formatCurrency(currentDiscount, currencySymbol)} discounts given` : 'No discounts'}</p>
          </div>
        </div>

        {/* ===== CHARTS ROW 1: Revenue Trend + Peak Hours ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Revenue Trend - 2/3 */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-indigo-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Revenue Trend</h3>
              <span className="text-[9px] text-gray-400 ml-auto">{dailyRevenueData.length} days</span>
            </div>
            {dailyRevenueData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-xs text-gray-400">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={dailyRevenueData}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={v => v.slice(5)} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 9 }} stroke="#9ca3af" tickFormatter={v => formatShort(v)} />
                  <Tooltip
                    contentStyle={{ background: '#1f2937', color: '#fff', borderRadius: '8px', fontSize: '11px', border: 'none' }}
                    formatter={(value: number, name: string) => [formatCurrency(value, currencySymbol), name]}
                    labelFormatter={label => `Date: ${label}`}
                  />
                  <Area type="monotone" dataKey="Revenue" stroke="#6366f1" strokeWidth={2} fill="url(#revGrad)" />
                  <Line type="monotone" dataKey="Orders" stroke="#10b981" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
                </AreaChart>
              </ResponsiveContainer>
            )}
            <div className="flex items-center gap-4 mt-2 text-[9px] text-gray-400">
              <div className="flex items-center gap-1"><div className="w-3 h-0.5 rounded bg-indigo-500" /> Revenue</div>
              <div className="flex items-center gap-1"><div className="w-3 h-0.5 rounded bg-emerald-500 dashed" style={{ borderTop: '1.5px dashed #10b981', height: 0 }} /> Orders</div>
            </div>
          </div>

          {/* Peak Hours - 1/3 */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-amber-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Peak Hours</h3>
              {peakHour.count > 0 && (
                <span className="text-[9px] text-amber-600 font-bold ml-auto">{peakHour.hour} peak</span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={peakHoursData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 8 }} tickFormatter={v => v.slice(0, 2)} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 9 }} stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{ background: '#1f2937', color: '#fff', borderRadius: '8px', fontSize: '11px', border: 'none' }}
                  formatter={(value: number) => [`${value} orders`, 'Orders']}
                />
                <Bar dataKey="orders" radius={[3, 3, 0, 0]}>
                  {peakHoursData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.orders === peakHour.count ? '#f59e0b' : '#fcd34d'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 grid grid-cols-4 gap-2 text-center text-[8px] text-gray-400">
              <div className="p-1.5 rounded-lg bg-amber-50"><Sunrise className="w-3 h-3 mx-auto text-amber-500 mb-0.5" />Morning<br/>{peakHoursData.filter(d => parseInt(d.hour) < 12).reduce((s, d) => s + d.orders, 0)}</div>
              <div className="p-1.5 rounded-lg bg-yellow-50"><Sun className="w-3 h-3 mx-auto text-yellow-500 mb-0.5" />Noon<br/>{peakHoursData.filter(d => parseInt(d.hour) >= 12 && parseInt(d.hour) < 16).reduce((s, d) => s + d.orders, 0)}</div>
              <div className="p-1.5 rounded-lg bg-orange-50"><Sunset className="w-3 h-3 mx-auto text-orange-500 mb-0.5" />Eve<br/>{peakHoursData.filter(d => parseInt(d.hour) >= 16 && parseInt(d.hour) < 20).reduce((s, d) => s + d.orders, 0)}</div>
              <div className="p-1.5 rounded-lg bg-indigo-50"><Moon className="w-3 h-3 mx-auto text-indigo-500 mb-0.5" />Night<br/>{peakHoursData.filter(d => parseInt(d.hour) >= 20).reduce((s, d) => s + d.orders, 0)}</div>
            </div>
          </div>
        </div>

        {/* ===== CHARTS ROW 2: Top Items + Category Performance ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Top Selling Items */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <Award className="w-4 h-4 text-emerald-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Popular Items</h3>
              <span className="text-[9px] text-gray-400 ml-auto">Top {topSelling.length}</span>
            </div>
            {topSelling.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-gray-400">No items sold</div>
            ) : (
              <div className="space-y-2.5">
                {topSelling.slice(0, 8).map((item, idx) => {
                  const maxQty = topSelling[0].qty || 1;
                  const barWidth = (item.qty / maxQty) * 100;
                  return (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-black ${
                        idx === 0 ? 'bg-amber-100 text-amber-700' :
                        idx === 1 ? 'bg-gray-200 text-gray-600' :
                        idx === 2 ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-400'
                      }`}>
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between text-[10px] mb-1">
                          <span className="font-bold text-gray-800 truncate">{item.name}</span>
                          <span className="font-mono text-gray-500 ml-2">{item.qty} sold</span>
                        </div>
                        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all"
                            style={{ width: `${barWidth}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Category Performance */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <Layers className="w-4 h-4 text-indigo-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Category Performance</h3>
              <span className="text-[9px] text-gray-400 ml-auto">{categoryData.length} categories</span>
            </div>
            {categoryData.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-gray-400">No categories</div>
            ) : (
              <div className="space-y-2.5">
                {categoryData.map((cat, idx) => {
                  const maxRev = categoryData[0].revenue || 1;
                  const barWidth = (cat.revenue / maxRev) * 100;
                  return (
                    <div key={cat.name} className="flex items-center gap-3">
                      <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-black text-indigo-600 bg-indigo-50">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between text-[10px] mb-1">
                          <span className="font-bold text-gray-800 truncate">{cat.name}</span>
                          <span className="font-mono text-gray-500 ml-2">{formatCurrency(cat.revenue, currencySymbol)}</span>
                        </div>
                        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{
                              width: `${barWidth}%`,
                              background: PIE_COLORS[idx % PIE_COLORS.length],
                            }} />
                        </div>
                      </div>
                      <span className="text-[9px] text-gray-400 w-8 text-right">{cat.qty} pcs</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ===== CHARTS ROW 3: Slow Movers + Payment Methods + Order Type ===== */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Slow Movers */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Slow Movers</h3>
            </div>
            {slowMovers.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-xs text-gray-400">All items selling well</div>
            ) : (
              <div className="space-y-2">
                {slowMovers.slice(0, 5).map(item => (
                  <div key={item.name} className="flex items-center justify-between p-2 rounded-lg bg-red-50 border border-red-100">
                    <span className="text-[10px] font-bold text-gray-700 truncate flex-1">{item.name}</span>
                    <span className="text-[10px] font-mono text-red-500 font-bold">{item.qty} sold</span>
                  </div>
                ))}
              </div>
            )}
            {topSelling.length > 5 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between text-[9px] text-gray-400">
                  <span>Items with lowest sales</span>
                  <span>{topSelling.filter(i => i.qty <= (topSelling[0]?.qty || 1) * 0.1).length} of {topSelling.length}</span>
                </div>
              </div>
            )}
          </div>

          {/* Payment Methods */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="w-4 h-4 text-blue-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Payment Methods</h3>
            </div>
            {paymentMethodData.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-xs text-gray-400">No payments</div>
            ) : (
              <>
                <div className="h-36 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={paymentMethodData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value">
                        {paymentMethodData.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatCurrency(value, currencySymbol)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1 mt-1">
                  {paymentMethodData.map((m, idx) => (
                    <div key={m.name} className="flex items-center justify-between text-[9px]">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                        <span className="font-semibold text-gray-600">{m.name}</span>
                      </div>
                      <span className="font-mono font-bold text-gray-800">
                        {formatCurrency(m.value, currencySymbol)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Order Type Distribution */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <ShoppingBag className="w-4 h-4 text-purple-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Order Channels</h3>
            </div>
            {orderTypeData.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-xs text-gray-400">No orders</div>
            ) : (
              <div className="space-y-2.5">
                {orderTypeData.map((ot, idx) => {
                  const pct = (ot.value / currentOrders) * 100;
                  return (
                    <div key={ot.name} className="flex items-center gap-2">
                      <div className="flex-1">
                        <div className="flex justify-between text-[10px] mb-0.5">
                          <span className="font-bold text-gray-700">{ot.name}</span>
                          <span className="font-mono text-gray-500">{ot.value} ({pct.toFixed(0)}%)</span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{
                            width: `${pct}%`,
                            background: PIE_COLORS[idx % PIE_COLORS.length],
                          }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-[9px] text-gray-400">
              <span>Total orders</span>
              <span className="font-bold text-gray-700">{currentOrders}</span>
            </div>
          </div>
        </div>

        {/* ===== CASHIER PERFORMANCE ===== */}
        <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-blue-500" />
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Cashier Performance</h3>
            <span className="text-[9px] text-gray-400 ml-auto">{cashierData.length} cashiers</span>
          </div>
          {cashierData.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-xs text-gray-400">No cashier data</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-3 font-bold text-gray-400">Rank</th>
                    <th className="text-left py-2 pr-3 font-bold text-gray-400">Cashier</th>
                    <th className="text-right py-2 pl-3 font-bold text-gray-400">Orders</th>
                    <th className="text-right py-2 pl-3 font-bold text-gray-400">Revenue</th>
                    <th className="text-right py-2 pl-3 font-bold text-gray-400">Items</th>
                    <th className="text-right py-2 pl-3 font-bold text-gray-400">Avg/Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {cashierData.map((c, idx) => (
                    <tr key={c.name} className="hover:bg-gray-50 transition-colors">
                      <td className="py-2 pr-3">
                        <span className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-black ${
                          idx === 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {idx + 1}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-bold text-gray-800">{c.name}</td>
                      <td className="py-2 pl-3 text-right font-mono font-semibold text-gray-700">{c.orders}</td>
                      <td className="py-2 pl-3 text-right font-mono font-bold text-gray-900">{formatCurrency(c.revenue, currencySymbol)}</td>
                      <td className="py-2 pl-3 text-right font-mono text-gray-600">{c.items}</td>
                      <td className="py-2 pl-3 text-right font-mono text-gray-500">{c.orders > 0 ? formatCurrency(c.revenue / c.orders, currencySymbol) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ===== PERIOD OVER PERIOD COMPARISON TABLE ===== */}
        <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-indigo-500" />
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Period vs Previous Period</h3>
            <span className="text-[9px] text-gray-400 ml-auto">Current period vs previous {Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1} days</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 pr-4 font-bold text-gray-400">Metric</th>
                  <th className="text-right py-2 px-3 font-bold text-gray-400">Current Period</th>
                  <th className="text-right py-2 px-3 font-bold text-gray-400">Previous Period</th>
                  <th className="text-right py-2 pl-3 font-bold text-gray-400">Change</th>
                  <th className="text-right py-2 pl-3 font-bold text-gray-400">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[
                  { label: 'Revenue', current: currentRevenue, previous: prevRevenue, fmt: 'currency' as const },
                  { label: 'Orders', current: currentOrders, previous: prevOrders, fmt: 'number' as const },
                  { label: 'Items Sold', current: currentItems, previous: prevItems, fmt: 'number' as const },
                  { label: 'Avg Order Value', current: currentAvgOrder, previous: prevAvgOrder, fmt: 'currency' as const },
                ].map(row => {
                  const change = pctChange(row.current, row.previous);
                  return (
                    <tr key={row.label} className="hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 pr-4 font-bold text-gray-800">{row.label}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-gray-900">
                        {row.fmt === 'currency' ? formatCurrency(row.current, currencySymbol) : row.current.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-gray-500">
                        {row.fmt === 'currency' ? formatCurrency(row.previous, currencySymbol) : row.previous.toLocaleString()}
                      </td>
                      <td className={`py-2.5 pl-3 text-right font-mono font-bold ${
                        change >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        {change >= 5 ? <ArrowUpRight className="w-3.5 h-3.5 text-green-500 inline" /> :
                         change <= -5 ? <ArrowDownRight className="w-3.5 h-3.5 text-red-500 inline" /> :
                         <Minus className="w-3.5 h-3.5 text-gray-400 inline" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-[9px] text-gray-400 text-center py-2 border-t border-[#e1e2ed]">
          Reports computed server-side by the backend reporting engine · Period: {getRangeLabel()}
        </div>
      </div>
    </div>
  );
}

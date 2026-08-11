/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FinanceWorkspace — Monthly Profit & Loss statement pulling revenue from bills
 * and expenses data. Shows full P&L table, profit trends, and year-to-date summary.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  TrendingUp, Calendar, ChevronLeft, ChevronRight,
  BarChart3, ArrowUpRight, ArrowDownRight,
  Minus, Activity, Layers, Banknote, Wallet, Landmark, ReceiptText, Wifi, WifiOff
} from 'lucide-react';
import type { Bill, ExpenseEntry, FinanceSummary } from '../src/types';
import { fetchFinanceSummary } from '../src/api/client';

interface FinanceWorkspaceProps {
  bills: Bill[];
  expenses: ExpenseEntry[];
  currencySymbol: string;
}

function formatCurrency(amount: number, symbol: string): string {
  return `${symbol}${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCurrencyShort(amount: number, symbol: string): string {
  if (Math.abs(amount) >= 100000) return `${symbol}${(amount / 100000).toFixed(1)}L`;
  if (Math.abs(amount) >= 1000) return `${symbol}${(amount / 1000).toFixed(1)}K`;
  return formatCurrency(amount, symbol);
}

function getMonthName(monthIndex: number): string {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthIndex];
}

interface MonthlyPL {
  month: string;
  label: string;
  revenue: number;
  orderCount: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  operatingExpenses: { category: string; amount: number }[];
  totalOperatingExpenses: number;
  netProfit: number;
  netMargin: number;
}

function computeMonthlyPL(bills: Bill[], expenses: ExpenseEntry[]): MonthlyPL[] {
  // Group revenue by month
  const revMap: Record<string, { total: number; count: number }> = {};
  bills.forEach(b => {
    const key = b.date.slice(0, 7);
    if (!revMap[key]) revMap[key] = { total: 0, count: 0 };
    revMap[key].total += b.grandTotal;
    revMap[key].count += 1;
  });

  // Group expenses by month
  const expMap: Record<string, { cogs: number; ops: { category: string; amount: number }[] }> = {};
  expenses.forEach(e => {
    const key = e.date.slice(0, 7);
    if (!expMap[key]) expMap[key] = { cogs: 0, ops: [] };
    // Ingredients & Raw Materials → COGS, everything else → operating expense
    if (e.category === 'Ingredients & Raw Materials') {
      expMap[key].cogs += e.amount;
    } else {
      const existing = expMap[key].ops.find(o => o.category === e.category);
      if (existing) existing.amount += e.amount;
      else expMap[key].ops.push({ category: e.category, amount: e.amount });
    }
  });

  // Collect all months
  const allMonths = new Set([...Object.keys(revMap), ...Object.keys(expMap)]);
  const sorted = Array.from(allMonths).sort();

  return sorted.map(month => {
    const rev = revMap[month] || { total: 0, count: 0 };
    const exp = expMap[month] || { cogs: 0, ops: [] };
    const cogs = exp.cogs;
    const grossProfit = rev.total - cogs;
    const grossMargin = rev.total > 0 ? (grossProfit / rev.total) * 100 : 0;
    const totalOperatingExpenses = exp.ops.reduce((s, o) => s + o.amount, 0);
    const netProfit = grossProfit - totalOperatingExpenses;
    const netMargin = rev.total > 0 ? (netProfit / rev.total) * 100 : 0;

    const [year, monthNum] = month.split('-');
    const label = `${getMonthName(parseInt(monthNum) - 1)} ${year}`;

    return {
      month,
      label,
      revenue: rev.total,
      orderCount: rev.count,
      cogs,
      grossProfit,
      grossMargin,
      operatingExpenses: exp.ops,
      totalOperatingExpenses,
      netProfit,
      netMargin,
    };
  });
}

const EXPENSE_ICONS: Record<string, string> = {
  'Ingredients & Raw Materials': '🥩',
  'Salaries & Wages': '👨‍🍳',
  'Utilities': '💡',
  'Rent & Lease': '🏢',
  'Equipment & Maintenance': '🔧',
  'Marketing & Advertising': '📣',
  'Delivery & Logistics': '🚚',
  'Cleaning & Supplies': '🧹',
  'Licenses & Permits': '📄',
  'Taxes & Fees': '💰',
  'Insurance': '🛡️',
  'Technology & Software': '💻',
  'Miscellaneous': '📋',
};

const PERIODS: Array<{ key: 'today' | 'week' | 'month' | 'year'; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year', label: 'This Year' },
];

export default function FinanceWorkspace({ bills, expenses, currencySymbol }: FinanceWorkspaceProps) {
  const monthlyPL = useMemo(() => computeMonthlyPL(bills, expenses), [bills, expenses]);

  // Backend-generated summary (Phase 1.7) with graceful offline fallback.
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'year'>('month');
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [summaryOnline, setSummaryOnline] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Period-aware offline fallback derived from the local monthly P&L so the
  // summary cards never show year-to-date figures when Today/Week/Month is picked.
  const localFallback = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const currentMonth = now.toISOString().slice(0, 7);
    // Monthly-level data can only approximate periods: use current month for
    // today/week/month, and the full year for 'year'. Backend (online) is exact.
    const inPeriod = monthlyPL.filter(mp => period === 'year' ? mp.month.startsWith(String(y)) : mp.month === currentMonth);
    return {
      revenue: inPeriod.reduce((s, mp) => s + mp.revenue, 0),
      expenses: inPeriod.reduce((s, mp) => s + mp.cogs + mp.totalOperatingExpenses, 0),
      cogs: inPeriod.reduce((s, mp) => s + mp.cogs, 0),
      grossProfit: inPeriod.reduce((s, mp) => s + mp.grossProfit, 0),
      netProfit: inPeriod.reduce((s, mp) => s + mp.netProfit, 0),
    };
  }, [monthlyPL, period]);

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const res = await fetchFinanceSummary(period);
      if (res) {
        setSummary(res);
        setSummaryOnline(true);
      } else {
        setSummary(null);
        setSummaryOnline(false);
      }
    } catch {
      setSummary(null);
      setSummaryOnline(false);
    } finally {
      setLoadingSummary(false);
    }
  }, [period]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const [selectedMonthIndex, setSelectedMonthIndex] = useState(monthlyPL.length - 1);

  // Ensure selected index is valid
  const safeIndex = Math.max(0, Math.min(selectedMonthIndex, monthlyPL.length - 1));
  const currentPL = monthlyPL[safeIndex];

  const ytdRevenue = useMemo(() => monthlyPL.reduce((s, m) => s + m.revenue, 0), [monthlyPL]);
  const ytdExpenses = useMemo(() => monthlyPL.reduce((s, m) => s + m.cogs + m.totalOperatingExpenses, 0), [monthlyPL]);
  const ytdNetProfit = useMemo(() => monthlyPL.reduce((s, m) => s + m.netProfit, 0), [monthlyPL]);

  const bestMonth = useMemo(() => {
    if (monthlyPL.length === 0) return null;
    return monthlyPL.reduce((a, b) => a.netProfit > b.netProfit ? a : b);
  }, [monthlyPL]);

  const worstMonth = useMemo(() => {
    if (monthlyPL.length === 0) return null;
    return monthlyPL.reduce((a, b) => a.netProfit < b.netProfit ? a : b);
  }, [monthlyPL]);

  const navigateMonth = (dir: number) => {
    setSelectedMonthIndex(prev => Math.max(0, Math.min(monthlyPL.length - 1, prev + dir)));
  };

  if (monthlyPL.length === 0 && !summaryOnline) {
    return (
      <div className="flex flex-col h-full bg-[#faf8ff] items-center justify-center">
        <Banknote className="w-20 h-20 text-gray-200 mb-4" />
        <h2 className="text-lg font-bold text-gray-300">No Financial Data Yet</h2>
        <p className="text-sm text-gray-300 mt-1">Bills and expenses will appear here as you process orders.</p>
      </div>
    );
  }

  // Max values for chart scaling
  const maxChartValue = Math.max(
    ...monthlyPL.map(m => Math.max(m.revenue, m.netProfit + Math.abs(m.cogs + m.totalOperatingExpenses), 1))
  );

  return (
    <div className="h-full overflow-y-auto bg-[#faf8ff]">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-5">
        {/* ===== HEADER ===== */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-black text-gray-900">Finance & Profit & Loss</h1>
            <p className="text-[10px] text-gray-400">Monthly financial performance overview</p>
          </div>
        </div>

        {/* ===== BACKEND SUMMARY STRIP (Phase 1.7) ===== */}
        <div className="bg-white rounded-2xl border border-[#e1e2ed] p-4 shadow-xs">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Period</span>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                {PERIODS.map(p => (
                  <button key={p.key} onClick={() => setPeriod(p.key)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                      period === p.key ? 'bg-[var(--brand-color)] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <span className={`ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-bold ${
              summaryOnline ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'
            }`}>
              {summaryOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {loadingSummary ? 'Syncing…' : summaryOnline ? 'Backend computed' : 'Offline estimate'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[8px] font-bold uppercase text-gray-400 tracking-wider">Revenue</p>
              <p className="text-lg font-black text-gray-900 mt-0.5 font-mono">{formatCurrency(summary ? summary.pnl.revenue : localFallback.revenue, currencySymbol)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[8px] font-bold uppercase text-gray-400 tracking-wider">Expenses</p>
              <p className="text-lg font-black text-red-500 mt-0.5 font-mono">{formatCurrency(summary ? summary.pnl.expenses : localFallback.expenses, currencySymbol)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[8px] font-bold uppercase text-gray-400 tracking-wider">COGS</p>
              <p className="text-lg font-black text-orange-500 mt-0.5 font-mono">{formatCurrency(summary ? summary.pnl.cogs : localFallback.cogs, currencySymbol)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[8px] font-bold uppercase text-gray-400 tracking-wider">Gross Profit</p>
              <p className={`text-lg font-black mt-0.5 font-mono ${(summary ? summary.pnl.grossProfit : localFallback.grossProfit) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(summary ? summary.pnl.grossProfit : localFallback.grossProfit, currencySymbol)}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-[8px] font-bold uppercase text-gray-400 tracking-wider">Net Profit</p>
              <p className={`text-lg font-black mt-0.5 font-mono ${(summary ? summary.pnl.netProfit : localFallback.netProfit) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(summary ? summary.pnl.netProfit : localFallback.netProfit, currencySymbol)}</p>
            </div>
          </div>
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <div className="flex items-center gap-2 rounded-xl bg-indigo-50/60 p-3">
                <Wallet className="w-4 h-4 text-indigo-500 shrink-0" />
                <div>
                  <p className="text-[8px] font-bold uppercase text-indigo-400 tracking-wider">Cash Balance</p>
                  <p className="text-sm font-black text-indigo-700 font-mono">{formatCurrency(summary.cash.balance, currencySymbol)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50/60 p-3">
                <Landmark className="w-4 h-4 text-emerald-500 shrink-0" />
                <div>
                  <p className="text-[8px] font-bold uppercase text-emerald-400 tracking-wider">GST Payable</p>
                  <p className="text-sm font-black text-emerald-700 font-mono">{formatCurrency(summary.gst.payable, currencySymbol)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-amber-50/60 p-3">
                <ReceiptText className="w-4 h-4 text-amber-500 shrink-0" />
                <div>
                  <p className="text-[8px] font-bold uppercase text-amber-400 tracking-wider">Vendor Dues</p>
                  <p className="text-sm font-black text-amber-700 font-mono">{formatCurrency(summary.vendorDues.total, currencySymbol)} <span className="text-[9px] text-amber-500 font-bold">({summary.vendorDues.count})</span></p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-rose-50/60 p-3">
                <Banknote className="w-4 h-4 text-rose-500 shrink-0" />
                <div>
                  <p className="text-[8px] font-bold uppercase text-rose-400 tracking-wider">Drawer Over/Short</p>
                  <p className={`text-sm font-black font-mono ${summary.cash.overShort >= 0 ? 'text-rose-600' : 'text-rose-700'}`}>{formatCurrency(summary.cash.overShort, currencySymbol)}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ===== MONTH NAVIGATION + P&L TABLE ===== */}
        <div className="bg-white rounded-2xl border border-[#e1e2ed] shadow-xs overflow-hidden">
          {/* Month selector */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#e1e2ed] bg-gray-50/50">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-500" />
              <span className="text-xs font-bold text-gray-700">Monthly P&L</span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => navigateMonth(-1)} disabled={safeIndex <= 0}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-black text-gray-900 min-w-[130px] text-center">
                {currentPL?.label || 'Select Month'}
              </span>
              <button onClick={() => navigateMonth(1)} disabled={safeIndex >= monthlyPL.length - 1}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer">
                <ChevronRight className="w-4 h-4" />
              </button>
              {/* Month quick-jump tabs */}
              <div className="hidden sm:flex gap-1 ml-4">
                {monthlyPL.slice(-6).map((m, idx) => (
                  <button key={m.month} onClick={() => setSelectedMonthIndex(monthlyPL.indexOf(m))}
                    className={`px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all cursor-pointer ${
                      monthlyPL.indexOf(m) === safeIndex
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                    }`}>
                    {m.label.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* P&L Table */}
          {currentPL && (
            <div className="p-5">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-4 font-bold text-gray-400 uppercase tracking-wider text-[9px]">Line Item</th>
                    <th className="text-right py-2 pl-4 font-bold text-gray-400 uppercase tracking-wider text-[9px]">Amount</th>
                    <th className="text-right py-2 pl-4 font-bold text-gray-400 uppercase tracking-wider text-[9px] hidden sm:table-cell">% of Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {/* Revenue */}
                  <tr>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-green-50 text-green-600">
                          <TrendingUp className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <span className="font-black text-gray-900 text-xs">Total Revenue</span>
                          <p className="text-[9px] text-gray-400">{currentPL.orderCount} order{currentPL.orderCount !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pl-4 text-right">
                      <span className="font-black text-gray-900 font-mono">{formatCurrency(currentPL.revenue, currencySymbol)}</span>
                    </td>
                    <td className="py-3 pl-4 text-right hidden sm:table-cell">
                      <span className="text-gray-400 font-mono">100%</span>
                    </td>
                  </tr>

                  {/* COGS */}
                  <tr>
                    <td className="py-3 pr-4 pl-6">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{EXPENSE_ICONS['Ingredients & Raw Materials']}</span>
                        <span className="font-bold text-gray-800">Cost of Goods Sold</span>
                      </div>
                    </td>
                    <td className="py-3 pl-4 text-right">
                      <span className="font-bold text-red-600 font-mono">-{formatCurrency(currentPL.cogs, currencySymbol)}</span>
                    </td>
                    <td className="py-3 pl-4 text-right hidden sm:table-cell">
                      <span className="text-red-500 font-mono">-{currentPL.revenue > 0 ? ((currentPL.cogs / currentPL.revenue) * 100).toFixed(1) : '0'}%</span>
                    </td>
                  </tr>

                  {/* Gross Profit */}
                  <tr className="bg-gray-50/70">
                    <td className="py-3 pr-4 pl-6">
                      <div className="flex items-center gap-2">
                        <Minus className="w-3.5 h-3.5 text-gray-500" />
                        <span className="font-black text-gray-900">Gross Profit</span>
                      </div>
                    </td>
                    <td className="py-3 pl-4 text-right">
                      <span className={`font-black font-mono ${currentPL.grossProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(currentPL.grossProfit, currencySymbol)}
                      </span>
                    </td>
                    <td className="py-3 pl-4 text-right hidden sm:table-cell">
                      <span className={`font-mono font-bold ${currentPL.grossMargin >= 30 ? 'text-green-600' : currentPL.grossMargin >= 15 ? 'text-amber-600' : 'text-red-600'}`}>
                        {currentPL.grossMargin.toFixed(1)}%
                      </span>
                    </td>
                  </tr>

                  {/* Operating Expenses Header */}
                  <tr>
                    <td colSpan={3} className="pt-5 pb-2">
                      <span className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Operating Expenses</span>
                    </td>
                  </tr>

                  {/* Operating expense lines */}
                  {currentPL.operatingExpenses.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-3 text-gray-400 text-[10px] italic">No operating expenses recorded this month</td>
                    </tr>
                  )}
                  {currentPL.operatingExpenses.map(exp => (
                    <tr key={exp.category}>
                      <td className="py-2.5 pr-4 pl-6">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{EXPENSE_ICONS[exp.category] || '📋'}</span>
                          <span className="font-semibold text-gray-700">{exp.category}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pl-4 text-right">
                        <span className="font-semibold text-red-600 font-mono">-{formatCurrency(exp.amount, currencySymbol)}</span>
                      </td>
                      <td className="py-2.5 pl-4 text-right hidden sm:table-cell">
                        <span className="text-red-400 font-mono">-{currentPL.revenue > 0 ? ((exp.amount / currentPL.revenue) * 100).toFixed(1) : '0'}%</span>
                      </td>
                    </tr>
                  ))}

                  {/* Total Operating Expenses */}
                  <tr className="bg-red-50/50">
                    <td className="py-3 pr-4 pl-6">
                      <span className="font-black text-gray-900">Total Operating Expenses</span>
                    </td>
                    <td className="py-3 pl-4 text-right">
                      <span className="font-black text-red-600 font-mono">-{formatCurrency(currentPL.totalOperatingExpenses, currencySymbol)}</span>
                    </td>
                    <td className="py-3 pl-4 text-right hidden sm:table-cell">
                      <span className="text-red-500 font-mono font-bold">
                        -{currentPL.revenue > 0 ? ((currentPL.totalOperatingExpenses / currentPL.revenue) * 100).toFixed(1) : '0'}%
                      </span>
                    </td>
                  </tr>

                  {/* NET PROFIT - Grand Total */}
                  <tr className="bg-gray-100/80 border-t-2 border-gray-200">
                    <td className="py-4 pr-4">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${currentPL.netProfit >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                          {currentPL.netProfit >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                        </div>
                        <span className="text-sm font-black text-gray-900">Net Profit / Loss</span>
                      </div>
                    </td>
                    <td className="py-4 pl-4 text-right">
                      <span className={`text-lg font-black font-mono ${currentPL.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(currentPL.netProfit, currencySymbol)}
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-right hidden sm:table-cell">
                      <span className={`text-sm font-black font-mono ${currentPL.netMargin >= 10 ? 'text-green-600' : currentPL.netMargin >= 0 ? 'text-amber-600' : 'text-red-600'}`}>
                        {currentPL.netMargin.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Key Metrics row */}
              <div className="mt-5 pt-4 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center">
                  <p className="text-[9px] font-bold text-gray-400 uppercase">Gross Margin</p>
                  <p className={`text-lg font-black mt-0.5 ${currentPL.grossMargin >= 30 ? 'text-green-600' : currentPL.grossMargin >= 15 ? 'text-amber-600' : 'text-red-600'}`}>
                    {currentPL.grossMargin.toFixed(1)}%
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] font-bold text-gray-400 uppercase">Net Margin</p>
                  <p className={`text-lg font-black mt-0.5 ${currentPL.netMargin >= 10 ? 'text-green-600' : currentPL.netMargin >= 0 ? 'text-amber-600' : 'text-red-600'}`}>
                    {currentPL.netMargin.toFixed(1)}%
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] font-bold text-gray-400 uppercase">Expense Ratio</p>
                  <p className={`text-lg font-black mt-0.5 ${(currentPL.cogs + currentPL.totalOperatingExpenses) / currentPL.revenue <= 0.7 ? 'text-green-600' : 'text-amber-600'}`}>
                    {currentPL.revenue > 0 ? `${(((currentPL.cogs + currentPL.totalOperatingExpenses) / currentPL.revenue) * 100).toFixed(1)}%` : '—'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] font-bold text-gray-400 uppercase">Avg Rev/Order</p>
                  <p className="text-lg font-black text-gray-900 mt-0.5 font-mono">
                    {currentPL.orderCount > 0 ? formatCurrency(currentPL.revenue / currentPL.orderCount, currencySymbol) : '—'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ===== PROFIT TREND CHART ===== */}
        <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
          <div className="flex items-center gap-2 mb-5">
            <Activity className="w-4 h-4 text-indigo-500" />
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Monthly Profit Trend</h3>
            <span className="text-[9px] text-gray-400 ml-auto">{monthlyPL.length} months</span>
          </div>
          <div className="flex items-end gap-2 h-52 overflow-x-auto pb-3">
            {monthlyPL.map(m => {
              const revenueHeight = (m.revenue / maxChartValue) * 100;
              const profitHeight = m.netProfit >= 0
                ? (m.netProfit / maxChartValue) * 100
                : 0;
              const lossHeight = m.netProfit < 0
                ? (Math.abs(m.netProfit) / maxChartValue) * 100
                : 0;
              const isSelected = monthlyPL.indexOf(m) === safeIndex;

              return (
                <button key={m.month} onClick={() => setSelectedMonthIndex(monthlyPL.indexOf(m))}
                  className={`flex flex-col items-center gap-1 flex-1 min-w-[60px] cursor-pointer group ${
                    isSelected ? 'scale-105' : ''
                  } transition-all`}>
                  {/* Revenue bar */}
                  <div className="relative w-full flex flex-col items-center justify-end" style={{ height: '180px' }}>
                    {/* Net profit/loss bar */}
                    {m.netProfit >= 0 && (
                      <div
                        className={`w-full rounded-t-sm transition-all ${
                          isSelected ? 'bg-gradient-to-t from-green-500 to-green-400' : 'bg-gradient-to-t from-green-400 to-green-300'
                        }`}
                        style={{ height: `${Math.max(profitHeight, 1)}%` }}
                        title={`Net Profit: ${formatCurrency(m.netProfit, currencySymbol)}`}
                      />
                    )}
                    {m.netProfit < 0 && (
                      <div
                        className={`w-full rounded-t-sm transition-all ${
                          isSelected ? 'bg-gradient-to-t from-red-500 to-red-400' : 'bg-gradient-to-t from-red-400 to-red-300'
                        }`}
                        style={{ height: `${Math.max(lossHeight, 1)}%` }}
                        title={`Net Loss: ${formatCurrency(m.netProfit, currencySymbol)}`}
                      />
                    )}
                    {/* Revenue overlay bar */}
                    <div className="absolute inset-0 flex items-end w-full">
                      <div
                        className={`w-full rounded-t-sm transition-all opacity-40 ${
                          isSelected ? 'bg-gradient-to-t from-blue-500 to-blue-400' : 'bg-gradient-to-t from-blue-400 to-blue-300'
                        }`}
                        style={{ height: `${Math.max(revenueHeight, 2)}%` }}
                        title={`Revenue: ${formatCurrency(m.revenue, currencySymbol)}`}
                      />
                    </div>
                  </div>
                  {/* Labels */}
                  <div className="text-center">
                    <span className={`text-[9px] font-bold ${isSelected ? 'text-indigo-600' : 'text-gray-400'} block`}>
                      {formatCurrencyShort(m.netProfit, currencySymbol)}
                    </span>
                    <span className="text-[7px] text-gray-400 font-semibold">{m.label.split(' ')[0]}</span>
                  </div>
                </button>
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 mt-2 pt-3 border-t border-gray-50 text-[9px] text-gray-400">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-blue-400 opacity-60" />
              <span>Revenue</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-green-400" />
              <span>Profit</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-red-400" />
              <span>Loss</span>
            </div>
          </div>
        </div>

        {/* ===== MONTHLY COMPARISON TABLE ===== */}
        <div className="bg-white rounded-2xl border border-[#e1e2ed] shadow-xs overflow-x-auto">
          <div className="px-5 py-3 border-b border-[#e1e2ed] flex items-center gap-2">
            <Layers className="w-4 h-4 text-gray-500" />
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Month-over-Month Comparison</h3>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-2.5 font-bold text-gray-500">Month</th>
                <th className="text-right px-3 py-2.5 font-bold text-gray-500">Revenue</th>
                <th className="text-right px-3 py-2.5 font-bold text-gray-500">Orders</th>
                <th className="text-right px-3 py-2.5 font-bold text-gray-500">Avg Order</th>
                <th className="text-right px-3 py-2.5 font-bold text-gray-500">COGS</th>
                <th className="text-right px-3 py-2.5 font-bold text-gray-500">Op. Exp.</th>
                <th className="text-right px-3 py-2.5 font-bold text-gray-500">Net Profit</th>
                <th className="text-right px-3 py-2.5 font-bold text-gray-500">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {monthlyPL.slice().reverse().map(m => (
                <tr key={m.month} onClick={() => setSelectedMonthIndex(monthlyPL.indexOf(m))}
                  className={`cursor-pointer transition-colors ${
                    monthlyPL.indexOf(m) === safeIndex ? 'bg-indigo-50/50' : 'hover:bg-gray-50'
                  }`}>
                  <td className="px-4 py-2.5 font-bold text-gray-800">{m.label}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-gray-800">{formatCurrency(m.revenue, currencySymbol)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-gray-600">{m.orderCount}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-gray-500">{m.orderCount > 0 ? formatCurrency(m.revenue / m.orderCount, currencySymbol) : '—'}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-red-500">{formatCurrency(m.cogs, currencySymbol)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-red-500">{formatCurrency(m.totalOperatingExpenses, currencySymbol)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono font-bold ${m.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(m.netProfit, currencySymbol)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono font-bold ${m.netMargin >= 10 ? 'text-green-600' : m.netMargin >= 0 ? 'text-amber-600' : 'text-red-600'}`}>
                    {m.netMargin.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ===== BEST / WORST / FOOTER ===== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {bestMonth && bestMonth.netProfit > 0 && (
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-200 p-5">
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpRight className="w-4 h-4 text-green-600" />
                <span className="text-xs font-black text-green-700 uppercase">Best Performing Month</span>
              </div>
              <p className="text-xl font-black text-green-700">{bestMonth.label}</p>
              <p className="text-xs text-green-600 mt-1">
                Net Profit: {formatCurrency(bestMonth.netProfit, currencySymbol)} · Revenue: {formatCurrency(bestMonth.revenue, currencySymbol)}
              </p>
            </div>
          )}
          {worstMonth && worstMonth.netProfit < 0 && (
            <div className="bg-gradient-to-br from-red-50 to-rose-50 rounded-2xl border border-red-200 p-5">
              <div className="flex items-center gap-2 mb-2">
                <ArrowDownRight className="w-4 h-4 text-red-600" />
                <span className="text-xs font-black text-red-700 uppercase">Worst Performing Month</span>
              </div>
              <p className="text-xl font-black text-red-700">{worstMonth.label}</p>
              <p className="text-xs text-red-600 mt-1">
                Net Loss: {formatCurrency(Math.abs(worstMonth.netProfit), currencySymbol)} · Revenue: {formatCurrency(worstMonth.revenue, currencySymbol)}
              </p>
            </div>
          )}
        </div>

        <div className="text-[9px] text-gray-400 text-center py-2 border-t border-[#e1e2ed]">
          {summaryOnline ? 'Finance summary computed by the backend from bills, expenses, cash ledger, and GST data.' : 'Offline: local estimate from bills & expenses. Connect to sync backend-computed finance.'}
        </div>
      </div>
    </div>
  );
}

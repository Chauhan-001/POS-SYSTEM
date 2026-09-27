/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DashboardWorkspace — Modernized, sectioned Home landing page with:
 * - Segmented Navigation (Live Pulse | Sales & Financials | Menu & Rush | All Views)
 * - Real-time Shift Pulse & Floor Occupancy
 * - Revenue, Payment & Expense Audit
 * - Peak Hours & Menu Intelligence
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TrendingUp, DollarSign, ShoppingCart, Users, Clock, Star,
  ArrowRight, Activity, CreditCard, Smartphone, Wallet, Banknote,
  UtensilsCrossed, PieChart, BarChart3, Zap, Calendar,
  Receipt, Package, Layers, Coffee, TrendingDown, RefreshCw,
  CheckCircle, XCircle, LayoutDashboard, Flame, Eye,
  Building2, ChevronRight, Store, FileText
} from 'lucide-react';
import type { DailySales, Bill, Order, TableInfo, Employee, Reservation } from '../src/types';
import { todayBusinessKey, isInBusinessDay, shiftDateKey } from '../src/data';
import { fetchSalesPeakHours, fetchSalesOrderTypes, fetchProductTop, fetchProductCategories, fetchSalesSummary } from '../src/api/client';
import { fetchWhatsAppStatus } from '../src/api/client';
import DashboardStatCard from './DashboardStatCard';

interface DashboardWorkspaceProps {
  dailySales: DailySales;
  bills: Bill[];
  orders: Order[];
  tables: TableInfo[];
  employees: Employee[];
  reservations?: Reservation[];
  products?: any[];
  currentEmployee: Employee;
  settings: any;
  currencySymbol: string;
  totalExpensesToday?: number;
  totalExpensesThisMonth?: number;
  moduleSettings?: Record<string, boolean>;
  /** Plan-gated flags from the POS state (strict plan enforcement). */
  hasInventory?: boolean;
  onNavigate: (ws: string) => void;
  onOpenDailySales: () => void;
  onOpenZReport: () => void;
  /** Force-refetch all backend data (bills, orders, products, expenses…) from the POS state hook. */
  onRefreshData?: () => void;
  currentBranchName?: string;
  showBranchIndicator?: boolean;
}

type DashboardSectionTab = 'pulse' | 'financials' | 'insights' | 'all';

function formatCurrency(amount: number, symbol: string): string {
  return `${symbol}${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Compact currency for narrow chart labels (₹16.6k / ₹1.2L / ₹3.4Cr)
function formatCompactCurrency(amount: number, symbol: string): string {
  const one = (v: number) => v.toFixed(1).replace(/\.0$/, '');
  if (amount >= 10000000) return `${symbol}${one(amount / 10000000)}Cr`;
  if (amount >= 100000) return `${symbol}${one(amount / 100000)}L`;
  if (amount >= 1000) return `${symbol}${one(amount / 1000)}k`;
  return `${symbol}${Math.round(amount)}`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// Compute hourly order distribution from bills for peak hours chart
function computeHourlyBreakdown(bills: Bill[], openingTime?: string): { hour: string; orders: number; revenue: number }[] {
  const hourlyMap: Record<string, { orders: number; revenue: number }> = {};
  const todayKey = todayBusinessKey(openingTime);
  const todayBills = bills.filter(b => isInBusinessDay(b, todayKey, openingTime));

  for (let i = 8; i <= 23; i++) {
    const label = i < 10 ? `0${i}:00` : `${i}:00`;
    hourlyMap[label] = { orders: 0, revenue: 0 };
  }

  todayBills.forEach(b => {
    if (b.time) {
      const hour = parseInt(b.time.split(':')[0], 10);
      if (!isNaN(hour) && hour >= 8 && hour <= 23) {
        const label = hour < 10 ? `0${hour}:00` : `${hour}:00`;
        if (hourlyMap[label]) {
          hourlyMap[label].orders += 1;
          hourlyMap[label].revenue += b.grandTotal;
        }
      }
    }
  });

  return Object.entries(hourlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, data]) => ({ hour, ...data }));
}

function getOrderTypeBreakdown(orders: Order[]): { type: string; count: number; percent: number }[] {
  const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const todayOrders = orders.filter(o => o.createdAt.startsWith(todayStr));
  const map: Record<string, number> = {};
  todayOrders.forEach(o => {
    map[o.type] = (map[o.type] || 0) + 1;
  });
  const total = todayOrders.length || 1;
  return Object.entries(map)
    .map(([type, count]) => ({ type, count, percent: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

// SVG sparkline mini-chart component
const Sparkline = React.memo(function Sparkline({ data, color, height = 36 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 110;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
});

export default function DashboardWorkspace({
  dailySales, bills, orders, tables, employees,
  reservations = [], products = [], currentEmployee, settings, currencySymbol,
  totalExpensesToday = 0, totalExpensesThisMonth = 0,
  moduleSettings = {} as Record<string, boolean>,
  hasInventory = false,
  onNavigate, onOpenDailySales, onOpenZReport, onRefreshData,
  currentBranchName, showBranchIndicator
}: DashboardWorkspaceProps) {
  const greeting = getGreeting();
  const today = new Date();
  const dateStr = formatDate(today);

  // Active section tab state (decluttering the dashboard)
  const [activeSection, setActiveSection] = useState<DashboardSectionTab>('pulse');

  // Backend-computed today's data
  const [backendToday, setBackendToday] = useState<{
    hourly: { hour: string; orders: number; revenue: number }[] | null;
    orderTypes: { type: string; count: number; revenue: number }[] | null;
    topItems: { name: string; qty: number; revenue: number }[] | null;
    categoryBreakdown: { category: string; qty: number; revenue: number }[] | null;
    itemsSold: number | null;
  }>({ hourly: null, orderTypes: null, topItems: null, categoryBreakdown: null, itemsSold: null });

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // WhatsApp connection status
  const [waStatus, setWaStatus] = useState<{ connected: boolean; status: string; phoneNumber?: string; displayName?: string } | null>(null);
  const [waLoading, setWaLoading] = useState(false);

  const loadBackendToday = useCallback(async () => {
    const now = new Date();
    const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const opening = (settings.openingTime || '08:00').slice(0, 5);
    const nowTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const start = nowTime < opening ? shiftDateKey(todayStr, -1) : todayStr;
    const [h, ot, top, cats, summ] = await Promise.all([
      fetchSalesPeakHours(start, todayStr, opening),
      fetchSalesOrderTypes(start, todayStr, opening),
      fetchProductTop(start, todayStr, 10, opening),
      fetchProductCategories(start, todayStr, opening),
      fetchSalesSummary(start, todayStr, opening),
    ]);
    setBackendToday({
      hourly: h.data && Array.isArray(h.data.hourly) ? h.data.hourly : null,
      orderTypes: ot.data && Array.isArray(ot.data) ? ot.data : null,
      topItems: top.data && Array.isArray(top.data)
        ? top.data.map((r: any) => ({ name: r.name, qty: r.qty, revenue: r.revenue }))
        : null,
      categoryBreakdown: cats.data && Array.isArray(cats.data) ? cats.data : null,
      itemsSold: summ.data?.summary?.itemsSold ?? null,
    });
  }, [settings.openingTime]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadBackendToday();
      if (cancelled) return;
      setLastUpdated(new Date());
    })();
    return () => { cancelled = true; };
  }, [loadBackendToday]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWaLoading(true);
      try {
        const data = await fetchWhatsAppStatus();
        if (cancelled) return;
        if (data) setWaStatus(data);
      } catch {
        /* offline */
      } finally {
        if (!cancelled) setWaLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleRefresh = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      if (onRefreshData) onRefreshData();
      await loadBackendToday();
      setLastUpdated(new Date());
    } catch {
      /* offline */
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, [onRefreshData, loadBackendToday]);

  useEffect(() => {
    const id = setInterval(() => {
      if (navigator.onLine) handleRefresh(true);
    }, 60000);
    return () => clearInterval(id);
  }, [handleRefresh]);

  const hourlyData = useMemo(() => {
    if (backendToday.hourly) {
      return backendToday.hourly.map(x => ({ hour: x.hour, orders: x.orders, revenue: x.revenue }));
    }
    return computeHourlyBreakdown(bills, settings.openingTime);
  }, [backendToday.hourly, bills, settings.openingTime]);

  const topItems = useMemo(() => {
    if (backendToday.topItems) return backendToday.topItems;
    return dailySales.topItems;
  }, [backendToday.topItems, dailySales.topItems]);

  const categoryBreakdown = useMemo(() => {
    if (backendToday.categoryBreakdown) return backendToday.categoryBreakdown;
    return dailySales.categoryBreakdown;
  }, [backendToday.categoryBreakdown, dailySales.categoryBreakdown]);

  const itemsSold = useMemo(() => {
    if (backendToday.itemsSold != null) return backendToday.itemsSold;
    return dailySales.totalItemsSold;
  }, [backendToday.itemsSold, dailySales.totalItemsSold]);

  const peakHour = useMemo(() => {
    if (hourlyData.length === 0) return null;
    return hourlyData.reduce((a, b) => a.orders > b.orders ? a : b);
  }, [hourlyData]);

  const orderTypes = useMemo(() => {
    if (backendToday.orderTypes && backendToday.orderTypes.length > 0) {
      const total = backendToday.orderTypes.reduce((s, o) => s + o.count, 0) || 1;
      return backendToday.orderTypes
        .map(o => ({ type: o.type, count: o.count, percent: Math.round((o.count / total) * 100) }))
        .sort((a, b) => b.count - a.count);
    }
    return getOrderTypeBreakdown(orders);
  }, [backendToday.orderTypes, orders]);

  const activeKitchenOrders = useMemo(() =>
    orders.filter(o => ['New', 'Accepted', 'Preparing'].includes(o.status) && (o.kotRecords || []).length > 0).length,
    [orders]
  );

  const availableTables = useMemo(() =>
    tables.filter(t => t.status === 'Available').length,
    [tables]
  );

  const occupiedTables = useMemo(() =>
    tables.filter(t => t.status === 'Occupied' || t.status === 'Preparing' || t.status === 'Food Ready' || t.status === 'Served').length,
    [tables]
  );

  const totalTableCapacity = occupiedTables + availableTables;
  const occupancyPercentage = totalTableCapacity > 0 ? Math.round((occupiedTables / totalTableCapacity) * 100) : 0;

  const reservationsRemainingToday = useMemo(() => {
    const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    return (reservations || []).filter(r => r.date === todayStr && r.status === 'Confirmed').length;
  }, [reservations]);

  const sparklineData = useMemo(() => hourlyData.map(h => h.revenue), [hourlyData]);

  const kitchenEnabled = moduleSettings?.enableKitchenDisplay !== false;
  const quickActions = [
    { icon: ShoppingCart, label: 'Orders & Tables', shortcut: 'F2', action: () => onNavigate('Orders'), color: 'bg-blue-600 hover:bg-blue-700 text-white' },
    { icon: Zap, label: 'Fast Billing', shortcut: 'F9', action: () => onNavigate('Billing'), color: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
    ...(kitchenEnabled ? [{ icon: UtensilsCrossed, label: 'Kitchen KDS', shortcut: '', action: () => onNavigate('Kitchen'), color: 'bg-amber-600 hover:bg-amber-700 text-white' }] : []),
    ...(hasInventory ? [{ icon: Layers, label: 'Inventory', shortcut: '', action: () => onNavigate('Inventory'), color: 'bg-purple-600 hover:bg-purple-700 text-white' }] : []),
    ...(moduleSettings?.enableExpenseManagement !== false ? [{ icon: TrendingDown, label: 'Expenses', shortcut: '', action: () => onNavigate('Expenses'), color: 'bg-rose-600 hover:bg-rose-700 text-white' }] : []),
  ];

  const netRevenueToday = dailySales.totalRevenue - totalExpensesToday;
  const netMarginPercent = dailySales.totalRevenue > 0
    ? (((dailySales.totalRevenue - totalExpensesToday) / dailySales.totalRevenue) * 100).toFixed(0)
    : '0';

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto bg-[var(--color-bg-page)] font-sans">
      <div className="p-4 md:p-6 space-y-5 pb-12 max-w-7xl mx-auto w-full">

        {/* ========================================================================= */}
        {/* 1. TOP HEADER & OPERATIONAL STATUS BAR                                    */}
        {/* ========================================================================= */}
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-4 sm:p-5 shadow-xs">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            
            {/* Greeting & Meta */}
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black text-[var(--color-text-primary)] tracking-tight">
                  {greeting}, {currentEmployee.name.split(' ')[0]} 👋
                </h1>
                {showBranchIndicator && currentBranchName && (
                  <span className="px-2.5 py-0.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-200/80 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Store className="w-3 h-3 text-purple-600" />
                    {currentBranchName}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Shift
                </span>
              </div>
              <p className="text-xs text-gray-500 font-medium mt-1 flex items-center gap-2">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  {dateStr}
                </span>
                <span>•</span>
                <span className="text-gray-600 font-semibold">{settings.restaurantName || 'Restaurant Terminal'}</span>
              </p>
            </div>

            {/* Quick Register Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => handleRefresh()}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-[var(--color-border-default)] rounded-xl text-xs font-bold text-gray-700 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                title="Force refresh backend data"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : 'text-gray-500'}`} />
                <span>{isRefreshing ? 'Syncing…' : 'Refresh'}</span>
              </button>

              <button
                onClick={onOpenDailySales}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--color-bg-white)] hover:bg-[var(--color-primary-light)] border border-[var(--color-border-default)] hover:border-[var(--brand-color)] rounded-xl text-xs font-bold text-gray-700 hover:text-[var(--brand-color)] transition-all cursor-pointer shadow-xs"
              >
                <Receipt className="w-3.5 h-3.5 text-[var(--brand-color)]" />
                <span>Daily Sales</span>
              </button>

              <button
                onClick={onOpenZReport}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--color-bg-white)] hover:bg-purple-50 border border-[var(--color-border-default)] hover:border-purple-300 rounded-xl text-xs font-bold text-gray-700 hover:text-purple-700 transition-all cursor-pointer shadow-xs"
              >
                <BarChart3 className="w-3.5 h-3.5 text-purple-600" />
                <span>Z-Report</span>
              </button>
            </div>
          </div>

          {/* Quick Nav Shortcuts Strip */}
          <div className="mt-4 pt-3.5 border-t border-[var(--color-border-default)]/60 flex items-center gap-2 overflow-x-auto pb-0.5">
            <span className="text-[11px] font-bold uppercase text-gray-400 tracking-wider shrink-0 mr-1 flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-500" /> Fast Jump:
            </span>
            {quickActions.map(qa => {
              const Icon = qa.icon;
              return (
                <button
                  key={qa.label}
                  onClick={qa.action}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs hover:shadow-md active:scale-95 shrink-0 ${qa.color}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{qa.label}</span>
                  {qa.shortcut && (
                    <span className="ml-1 px-1.5 py-0.2 bg-black/20 rounded text-[9px] font-mono font-normal">
                      {qa.shortcut}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 2. SECTION NAVIGATOR / SEGMENTED CONTROLLER (DECLUTTERING ENGINE)           */}
        {/* ========================================================================= */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-default)] pb-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-gray-100/80 p-1 rounded-xl border border-[var(--color-border-default)] select-none">
            <button
              onClick={() => setActiveSection('pulse')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeSection === 'pulse'
                  ? 'bg-[var(--brand-color)] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Live Pulse</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeSection === 'pulse' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'
              }`}>
                {activeKitchenOrders} cooking
              </span>
            </button>

            <button
              onClick={() => setActiveSection('financials')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeSection === 'financials'
                  ? 'bg-[var(--brand-color)] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5" />
              <span>Sales & Financials</span>
            </button>

            <button
              onClick={() => setActiveSection('insights')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeSection === 'insights'
                  ? 'bg-[var(--brand-color)] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Menu & Rush</span>
              {peakHour && peakHour.orders > 0 && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  activeSection === 'insights' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'
                }`}>
                  Peak {peakHour.hour}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveSection('all')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeSection === 'all'
                  ? 'bg-[var(--brand-color)] text-white shadow-xs'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-200/60'
              }`}
              title="Show panoramic all-in-one view"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>All Views</span>
            </button>
          </div>

          <div className="text-xs text-gray-400 font-medium hidden sm:block">
            {activeSection === 'pulse' && 'Shift Pulse: real-time operations, tables & orders'}
            {activeSection === 'financials' && 'Financial Audit: revenue, payments & cash register'}
            {activeSection === 'insights' && 'Dish Intelligence: peak rush times & fast movers'}
            {activeSection === 'all' && 'Executive Overview: complete dashboard summary'}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SECTION 1: LIVE SHIFT PULSE                                               */}
        {/* ========================================================================= */}
        {(activeSection === 'pulse' || activeSection === 'all') && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {activeSection === 'all' && (
              <div className="flex items-center gap-2 pt-2">
                <Activity className="w-4 h-4 text-[var(--brand-color)]" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700">1. Shift Pulse & Operations</h2>
              </div>
            )}

            {/* Core 4 KPI Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <DashboardStatCard
                label="Today's Revenue"
                value={formatCurrency(dailySales.totalRevenue, currencySymbol)}
                subtitle={`${dailySales.totalOrders} order${dailySales.totalOrders !== 1 ? 's' : ''} billed today`}
                icon={DollarSign}
                iconBg="bg-emerald-50"
                iconColor="text-emerald-600"
                badge={`Net: ${formatCurrency(netRevenueToday, currencySymbol)}`}
                badgeColor="bg-emerald-50 text-emerald-700 border border-emerald-200"
              >
                {sparklineData.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Hourly Trend</span>
                    <Sparkline data={sparklineData} color="#059669" />
                  </div>
                )}
              </DashboardStatCard>

              <DashboardStatCard
                label="Total Orders"
                value={dailySales.totalOrders}
                subtitle={`Avg: ${formatCurrency(dailySales.averageOrderValue, currencySymbol)} / ticket`}
                icon={ShoppingCart}
                iconBg="bg-blue-50"
                iconColor="text-blue-600"
              >
                <div className="flex flex-wrap gap-1.5">
                  {orderTypes.slice(0, 4).map(ot => (
                    <span key={ot.type} className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100">
                      {ot.type} {ot.percent}%
                    </span>
                  ))}
                </div>
              </DashboardStatCard>

              <DashboardStatCard
                label="Items Plated / Sold"
                value={itemsSold}
                subtitle={`Total Discounts: ${formatCurrency(dailySales.totalDiscount, currencySymbol)}`}
                icon={Package}
                iconBg="bg-amber-50"
                iconColor="text-amber-600"
              >
                {topItems.length > 0 ? (
                  <p className="text-xs text-gray-600 font-semibold truncate flex items-center gap-1">
                    <Flame className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>Top: <strong className="text-gray-900">{topItems[0].name}</strong> ({topItems[0].qty}x)</span>
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">Waiting for first sale</p>
                )}
              </DashboardStatCard>

              <DashboardStatCard
                label="Restaurant Floor"
                value={`${occupiedTables} / ${totalTableCapacity}`}
                subtitle={`${occupancyPercentage}% table occupancy right now`}
                icon={Users}
                iconBg="bg-purple-50"
                iconColor="text-purple-600"
              >
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div className="p-1 rounded-lg bg-purple-50">
                    <p className="text-sm font-black text-purple-700 font-mono">{occupiedTables}</p>
                    <p className="text-[9px] font-bold text-gray-500 uppercase">Occupied</p>
                  </div>
                  <div className="p-1 rounded-lg bg-green-50">
                    <p className="text-sm font-black text-green-700 font-mono">{availableTables}</p>
                    <p className="text-[9px] font-bold text-gray-500 uppercase">Available</p>
                  </div>
                  <div className="p-1 rounded-lg bg-amber-50">
                    <p className="text-sm font-black text-amber-700 font-mono">{activeKitchenOrders}</p>
                    <p className="text-[9px] font-bold text-gray-500 uppercase">In Kitchen</p>
                  </div>
                </div>
              </DashboardStatCard>
            </div>

            {/* Floor & Live Service Operational Cards (2 Columns) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              
              {/* Floor Occupancy Card */}
              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
                        <Users className="w-4 h-4" />
                      </div>
                      <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                        Floor Plan & Table Flow
                      </h3>
                    </div>
                    <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200">
                      {occupancyPercentage}% Full
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-indigo-600 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(occupancyPercentage, 100)}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    <div className="p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                      <span className="text-[10px] text-gray-400 font-bold uppercase block">Tables</span>
                      <strong className="text-sm text-gray-800 font-mono">{totalTableCapacity}</strong>
                    </div>
                    <div className="p-2.5 rounded-xl bg-purple-50/60 border border-purple-100">
                      <span className="text-[10px] text-purple-600 font-bold uppercase block">Dining</span>
                      <strong className="text-sm text-purple-800 font-mono">{occupiedTables}</strong>
                    </div>
                    <div className="p-2.5 rounded-xl bg-green-50/60 border border-green-100">
                      <span className="text-[10px] text-green-600 font-bold uppercase block">Open</span>
                      <strong className="text-sm text-green-800 font-mono">{availableTables}</strong>
                    </div>
                    <div className="p-2.5 rounded-xl bg-amber-50/60 border border-amber-100">
                      <span className="text-[10px] text-amber-600 font-bold uppercase block">Cooking KOT</span>
                      <strong className="text-sm text-amber-800 font-mono">{activeKitchenOrders}</strong>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3.5 border-t border-[var(--color-border-default)]/60 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">
                    {moduleSettings?.enableReservations !== false && reservationsRemainingToday > 0
                      ? `📅 ${reservationsRemainingToday} reservation${reservationsRemainingToday === 1 ? '' : 's'} scheduled for today`
                      : 'All dining tables synchronized'}
                  </span>
                  <button
                    onClick={() => onNavigate('Orders')}
                    className="flex items-center gap-1 text-xs font-bold text-[var(--brand-color)] hover:underline cursor-pointer"
                  >
                    <span>View Floor Grid</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Service & WhatsApp Status Card */}
              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                        <CheckCircle className="w-4 h-4" />
                      </div>
                      <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                        Terminal Status & Connectivity
                      </h3>
                    </div>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                      System Ready
                    </span>
                  </div>

                  {/* WhatsApp status integration */}
                  <div className="space-y-2.5">
                    {waLoading ? (
                      <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex items-center gap-2 text-gray-500 text-xs font-medium">
                        <RefreshCw className="w-4 h-4 animate-spin text-gray-400" />
                        <span>Checking WhatsApp gateway…</span>
                      </div>
                    ) : waStatus ? (
                      <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                        waStatus.connected ? 'bg-emerald-50/50 border-emerald-200/80' : 'bg-gray-50 border-gray-200'
                      }`}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            waStatus.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'
                          }`}>
                            <Smartphone className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-900 truncate">WhatsApp Business Bot</p>
                            <p className="text-[11px] text-gray-500 truncate">
                              {waStatus.connected
                                ? `${waStatus.displayName || 'Active'} (${waStatus.phoneNumber || 'Ready'})`
                                : 'Gateway offline'}
                            </p>
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          waStatus.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'
                        }`}>
                          {waStatus.connected ? 'Connected' : 'Offline'}
                        </span>
                      </div>
                    ) : null}

                    {/* Active Staff on duty */}
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                          <Users className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-900">Shift Staff On Duty</p>
                          <p className="text-[11px] text-gray-500">
                            {employees.filter(e => e.status === 'Active').length} staff active in terminal
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                        {currentEmployee.role} Shift
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3.5 border-t border-[var(--color-border-default)]/60 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">Fast cashier shift management</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={onOpenDailySales}
                      className="text-xs font-bold text-[var(--brand-color)] hover:underline cursor-pointer"
                    >
                      Audit Day
                    </button>
                    <span className="text-gray-300">•</span>
                    <button
                      onClick={onOpenZReport}
                      className="text-xs font-bold text-purple-600 hover:underline cursor-pointer"
                    >
                      Close Register
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </motion.div>
        )}

        {/* ========================================================================= */}
        {/* SECTION 2: SALES & FINANCIAL AUDIT                                        */}
        {/* ========================================================================= */}
        {(activeSection === 'financials' || activeSection === 'all') && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {activeSection === 'all' && (
              <div className="flex items-center gap-2 pt-2">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700">2. Sales, Payments & Financials</h2>
              </div>
            )}

            {/* 2-Column: Revenue vs Expenses + Payment Methods */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              
              {/* Revenue vs Expenses */}
              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                        <TrendingDown className="w-4 h-4" />
                      </div>
                      <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                        Revenue vs Petty Expenses
                      </h3>
                    </div>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                      netRevenueToday >= 0
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                      {netMarginPercent}% Net Margin
                    </span>
                  </div>

                  {/* Today's Net Calculation */}
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-emerald-50/60 rounded-xl p-3.5 border border-emerald-100">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase block">Gross Revenue</span>
                        <p className="text-lg sm:text-xl font-black text-emerald-800 font-mono mt-0.5">
                          {formatCurrency(dailySales.totalRevenue, currencySymbol)}
                        </p>
                      </div>
                      <div className="bg-rose-50/60 rounded-xl p-3.5 border border-rose-100">
                        <span className="text-[10px] font-bold text-rose-700 uppercase block">Expenses (Today)</span>
                        <p className="text-lg sm:text-xl font-black text-rose-700 font-mono mt-0.5">
                          {formatCurrency(totalExpensesToday, currencySymbol)}
                        </p>
                      </div>
                    </div>

                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-between text-xs">
                      <span className="font-semibold text-gray-600">Net Estimated Profit:</span>
                      <strong className={`font-mono text-sm font-black ${netRevenueToday >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {formatCurrency(netRevenueToday, currencySymbol)}
                      </strong>
                    </div>

                    {/* Month snapshot */}
                    <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                      <span>Expenses This Month:</span>
                      <strong className="text-gray-800 font-mono font-semibold">
                        {formatCurrency(totalExpensesThisMonth, currencySymbol)}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3.5 border-t border-[var(--color-border-default)]/60 flex items-center justify-between">
                  <span className="text-xs text-gray-500">Track petty cash & purchases</span>
                  <button
                    onClick={() => onNavigate('Expenses')}
                    className="flex items-center gap-1 text-xs font-bold text-[var(--brand-color)] hover:underline cursor-pointer"
                  >
                    <span>Manage Expenses</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Payment Methods Breakdown */}
              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                        <CreditCard className="w-4 h-4" />
                      </div>
                      <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                        Payment Mode Distribution
                      </h3>
                    </div>
                    <span className="text-xs text-gray-500 font-medium">
                      {dailySales.paymentBreakdown.reduce((s, p) => s + p.count, 0)} transactions
                    </span>
                  </div>

                  {dailySales.paymentBreakdown.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                      <Banknote className="w-8 h-8 mb-2 opacity-40" />
                      <p className="text-xs font-semibold">No payments recorded today yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(() => {
                        const iconMap: Record<string, any> = {
                          Cash: Banknote,
                          UPI: Smartphone,
                          Card: CreditCard,
                          Wallet: Wallet,
                          Split: PieChart,
                        };
                        const total = dailySales.paymentBreakdown.reduce((s, p) => s + p.amount, 0) || 1;
                        return dailySales.paymentBreakdown.map((pm) => {
                          const Icon = iconMap[pm.method] || Banknote;
                          const percent = (pm.amount / total) * 100;
                          return (
                            <div key={pm.method} className="space-y-1">
                              <div className="flex justify-between items-center text-xs">
                                <div className="flex items-center gap-2 font-bold text-gray-800">
                                  <Icon className="w-3.5 h-3.5 text-gray-500" />
                                  <span>{pm.method}</span>
                                </div>
                                <div className="flex items-center gap-2 font-mono text-xs">
                                  <span className="text-gray-400 text-[11px]">{pm.count} txns</span>
                                  <strong className="text-gray-900">{formatCurrency(pm.amount, currencySymbol)}</strong>
                                  <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded">
                                    {percent.toFixed(0)}%
                                  </span>
                                </div>
                              </div>
                              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-300"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3.5 border-t border-[var(--color-border-default)]/60 flex items-center justify-between text-xs text-gray-500">
                  <span>Reconciled against cash drawer</span>
                  <span className="font-semibold text-gray-700">Digital + Cash split</span>
                </div>
              </div>

            </div>

            {/* Sub-Grid: Today's Financial Summary & Cashier Leaderboard */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              
              {/* Financial Summary (Left 1 Col) */}
              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                      <Activity className="w-4 h-4" />
                    </div>
                    <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                      Tax & Order Summary
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Avg Order</p>
                      <p className="text-base font-black text-gray-900 mt-0.5 font-mono">
                        {formatCurrency(dailySales.averageOrderValue, currencySymbol)}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">GST Tax</p>
                      <p className="text-base font-black text-gray-900 mt-0.5 font-mono">
                        {formatCurrency(dailySales.totalGst, currencySymbol)}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Discounts</p>
                      <p className="text-base font-black text-rose-600 mt-0.5 font-mono">
                        -{formatCurrency(dailySales.totalDiscount, currencySymbol)}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Items / Ticket</p>
                      <p className="text-base font-black text-gray-900 mt-0.5 font-mono">
                        {dailySales.totalOrders > 0 ? (itemsSold / dailySales.totalOrders).toFixed(1) : '0'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[var(--color-border-default)]/60 text-[11px] text-gray-400">
                  Taxes calculated as per configured CGST / SGST rules
                </div>
              </div>

              {/* Cashier Performance Leaderboard (Right 2 Cols) */}
              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-xs lg:col-span-2 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-cyan-50 text-cyan-600">
                        <Users className="w-4 h-4" />
                      </div>
                      <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                        Cashier Performance Leaderboard
                      </h3>
                    </div>
                    <span className="text-xs text-gray-400 font-medium">Today's Shift</span>
                  </div>

                  {dailySales.cashierPerformance.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                      <p className="text-xs font-semibold">No cashier checkout records for today yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                      {dailySales.cashierPerformance.map((c, idx) => (
                        <div
                          key={c.name}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100/80 border border-gray-100 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black ${
                              idx === 0 ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-700'
                            }`}>
                              #{idx + 1}
                            </span>
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center text-xs font-bold shadow-xs">
                              {c.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <span className="text-xs font-bold text-gray-900 block">{c.name}</span>
                              <span className="text-[10px] text-gray-500 font-medium">
                                {c.orders > 0 ? `Avg ${formatCurrency(c.revenue / c.orders, currencySymbol)} / order` : '—'}
                              </span>
                            </div>
                          </div>
                          <div className="text-right font-mono">
                            <span className="text-xs font-bold text-gray-900 block">
                              {formatCurrency(c.revenue, currencySymbol)}
                            </span>
                            <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.2 rounded-md">
                              {c.orders} bills closed
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-[var(--color-border-default)]/60 text-xs text-gray-500 flex justify-between items-center">
                  <span>Audited via terminal user sessions</span>
                  <button onClick={() => onNavigate('Staff')} className="text-xs font-bold text-[var(--brand-color)] hover:underline cursor-pointer">
                    Manage Staff Roles →
                  </button>
                </div>
              </div>

            </div>
          </motion.div>
        )}

        {/* ========================================================================= */}
        {/* SECTION 3: MENU INTELLIGENCE & PEAK RUSH                                  */}
        {/* ========================================================================= */}
        {(activeSection === 'insights' || activeSection === 'all') && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {activeSection === 'all' && (
              <div className="flex items-center gap-2 pt-2">
                <BarChart3 className="w-4 h-4 text-indigo-600" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700">3. Menu Intelligence & Peak Hours</h2>
              </div>
            )}

            {/* Peak Hours Chart + Category Sales */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              
              {/* Peak Hours (Left 2 Cols) */}
              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-xs lg:col-span-2 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                        <Clock className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                          Hourly Orders & Peak Rush
                        </h3>
                        <p className="text-[11px] text-gray-400">Order traffic distribution throughout the shift</p>
                      </div>
                    </div>
                    {peakHour && peakHour.orders > 0 && (
                      <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-1 rounded-full flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5 text-amber-500" />
                        Peak: {peakHour.hour} ({peakHour.orders} orders)
                      </span>
                    )}
                  </div>

                  {hourlyData.every(h => h.orders === 0) ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-300">
                      <Activity className="w-8 h-8 mb-2 opacity-50" />
                      <p className="text-xs font-medium">No hourly orders data recorded yet</p>
                    </div>
                  ) : (
                    <div className="flex items-end gap-1.5 h-44 overflow-x-auto pb-2 pt-4 px-1">
                      {hourlyData.map(h => {
                        const maxOrders = Math.max(...hourlyData.map(x => x.orders), 1);
                        const height = (h.orders / maxOrders) * 100;
                        const isPeak = peakHour && h.hour === peakHour.hour && h.orders > 0;
                        return (
                          <div key={h.hour} className="flex flex-col h-full min-w-[34px] flex-1 items-center">
                            {/* Order count label */}
                            <span className={`text-[10px] font-bold ${isPeak ? 'text-indigo-600' : 'text-gray-400'}`}>
                              {h.orders > 0 ? h.orders : ''}
                            </span>
                            
                            {/* Bar */}
                            <div className="flex-1 w-full flex items-end px-0.5 my-1">
                              <div
                                className={`w-full rounded-t-md transition-all duration-300 ${
                                  isPeak
                                    ? 'bg-gradient-to-t from-indigo-600 to-indigo-400 shadow-xs'
                                    : h.orders > 0
                                      ? 'bg-gradient-to-t from-indigo-300 to-indigo-200 hover:from-indigo-400 hover:to-indigo-300'
                                      : 'bg-gray-100'
                                }`}
                                style={{ height: `${Math.max(height, 4)}%` }}
                                title={`${h.hour}: ${h.orders} orders, ${formatCurrency(h.revenue, currencySymbol)}`}
                              />
                            </div>

                            {/* Hour label */}
                            <span className={`text-center text-[9px] font-bold font-mono ${isPeak ? 'text-indigo-700' : 'text-gray-500'}`}>
                              {h.hour.replace(':00', '')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-[var(--color-border-default)]/60 text-xs text-gray-500 flex justify-between items-center">
                  <span>Data aggregated by restaurant business day</span>
                  <span className="text-gray-400 font-mono">08:00 — 23:00 Range</span>
                </div>
              </div>

              {/* Category Breakdown (Right 1 Col) */}
              <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-pink-50 text-pink-600">
                        <PieChart className="w-4 h-4" />
                      </div>
                      <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                        Category Share
                      </h3>
                    </div>
                    <span className="text-xs text-gray-400 font-medium">{categoryBreakdown.length} active</span>
                  </div>

                  {categoryBreakdown.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-300">
                      <Layers className="w-8 h-8 mb-2 opacity-50" />
                      <p className="text-xs font-medium">No category sales yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {[...categoryBreakdown].sort((a, b) => b.revenue - a.revenue).slice(0, 6).map((cat, idx) => {
                        const maxRevenue = Math.max(...categoryBreakdown.map(c => c.revenue), 1);
                        const barWidth = (cat.revenue / maxRevenue) * 100;
                        const colors = [
                          'from-pink-500 to-rose-500',
                          'from-purple-500 to-indigo-500',
                          'from-blue-500 to-cyan-500',
                          'from-emerald-500 to-teal-500',
                          'from-amber-500 to-orange-500',
                          'from-red-500 to-pink-500',
                        ];
                        return (
                          <div key={cat.category} className="space-y-1">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-bold text-gray-800 truncate">{cat.category}</span>
                              <div className="flex items-center gap-2 font-mono shrink-0">
                                <span className="text-[10px] text-gray-400">{cat.qty} pcs</span>
                                <strong className="text-gray-900">{formatCurrency(cat.revenue, currencySymbol)}</strong>
                              </div>
                            </div>
                            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full bg-gradient-to-r ${colors[idx % colors.length]} transition-all duration-300`}
                                style={{ width: `${barWidth}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-[var(--color-border-default)]/60 text-xs text-gray-400">
                  Item categorization from product catalog
                </div>
              </div>

            </div>

            {/* Top Selling Items Full Strip */}
            <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] p-5 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                    <Star className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-[var(--color-text-primary)] uppercase tracking-wider">
                      Today's Top Selling Dishes & Beverages
                    </h3>
                    <p className="text-[11px] text-gray-400">Ranked by units ordered during this shift</p>
                  </div>
                </div>
                <button
                  onClick={() => onNavigate('Reports')}
                  className="text-xs font-bold text-[var(--brand-color)] hover:underline cursor-pointer flex items-center gap-1"
                >
                  <span>Detailed Report</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {topItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                  <Coffee className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-xs font-medium">No dish sales recorded yet today</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                  {topItems.slice(0, 8).map((item, idx) => {
                    const maxQty = topItems[0].qty || 1;
                    const barWidth = (item.qty / maxQty) * 100;
                    return (
                      <div key={item.name} className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 transition-colors">
                        <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0 ${
                          idx === 0 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
                        }`}>
                          #{idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-gray-900 truncate">{item.name}</span>
                            <div className="flex items-center gap-2 font-mono ml-2 shrink-0">
                              <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.2 rounded-md">
                                {item.qty} sold
                              </span>
                              <span className="text-xs font-semibold text-gray-600">
                                {formatCurrency(item.revenue, currencySymbol)}
                              </span>
                            </div>
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-300"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </motion.div>
        )}

        {/* ========================================================================= */}
        {/* FOOTER & REFRESH STATUS                                                   */}
        {/* ========================================================================= */}
        <div className="flex items-center justify-between py-3 border-t border-[var(--color-border-default)] text-xs text-gray-400">
          <span>
            Shift data for {dateStr} · Updated{' '}
            {lastUpdated
              ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : '…'} · Auto-refreshes every 60s
          </span>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${isRefreshing ? 'bg-amber-400 animate-ping' : 'bg-emerald-500'}`} />
            <span className="font-semibold text-gray-600">{isRefreshing ? 'Syncing…' : 'Live Gateway'}</span>
          </div>
        </div>

      </div>
    </div>
  );
}

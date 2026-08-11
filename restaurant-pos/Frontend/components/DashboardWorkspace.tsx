/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DashboardWorkspace — Home landing page with KPI cards, top items,
 * peak hours analysis, payment breakdown, and quick action shortcuts.
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  TrendingUp, DollarSign, ShoppingCart, Users, Clock, Star,
  ArrowRight, Activity, CreditCard, Smartphone, Wallet, Banknote,
  ChefHat, UtensilsCrossed, PieChart, BarChart3, Zap, Calendar,
  Percent, Receipt, Package, Layers, Coffee, TrendingDown, Sparkles, RefreshCw
} from 'lucide-react';
import type { DailySales, Bill, Order, TableInfo, Employee } from '../src/types';
import { generateDailySummary, type DailyAISummary } from '../src/ai/aiData';
import { fetchInventoryEvents, fetchSalesPeakHours, fetchSalesOrderTypes } from '../src/api/client';
import WeatherWidget from '../src/ai/WeatherWidget';
import DashboardStatCard from './DashboardStatCard';

interface DashboardWorkspaceProps {
  dailySales: DailySales;
  bills: Bill[];
  orders: Order[];
  tables: TableInfo[];
  employees: Employee[];
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

function formatCurrency(amount: number, symbol: string): string {
  return `${symbol}${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
function computeHourlyBreakdown(bills: Bill[]): { hour: string; orders: number; revenue: number }[] {
  const hourlyMap: Record<string, { orders: number; revenue: number }> = {};
  const today = new Date();
  const tzoffset = today.getTimezoneOffset() * 60000;
  const todayStr = new Date(Date.now() - tzoffset).toISOString().slice(0, 10);

  const todayBills = bills.filter(b => b.date === todayStr);

  // Initialize all hours
  for (let i = 8; i <= 23; i++) {
    const label = i < 10 ? `0${i}:00` : `${i}:00`;
    const ampm = i < 12 ? `${i}AM` : i === 12 ? '12PM' : `${i - 12}PM`;
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
const Sparkline = React.memo(function Sparkline({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 120;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
});

export default function DashboardWorkspace({
  dailySales, bills, orders, tables, employees,
  products = [], currentEmployee, settings, currencySymbol,
  totalExpensesToday = 0, totalExpensesThisMonth = 0,
  moduleSettings = {} as Record<string, boolean>,
  hasInventory = false,
  onNavigate, onOpenDailySales, onOpenZReport, onRefreshData,
  currentBranchName, showBranchIndicator
}: DashboardWorkspaceProps) {
  const greeting = getGreeting();
  const today = new Date();
  const dateStr = formatDate(today);

  // ─── Phase 1.8: backend-computed today's hourly/order-type data ───
  // (falls back to local synced data when offline).
  const [backendToday, setBackendToday] = useState<{
    hourly: { hour: string; orders: number; revenue: number }[] | null;
    orderTypes: { type: string; count: number; revenue: number }[] | null;
  }>({ hourly: null, orderTypes: null });

  // Refresh button state + last-successful-update timestamp (shown in the footer).
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Fetches today's backend-computed hourly/order-type charts. Called on mount,
  // on the manual Refresh button, and by the auto-refresh timer below — the
  // getCached API client always hits the network first, so this never serves
  // a stale chart after a refresh.
  const loadBackendToday = useCallback(async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const [h, ot] = await Promise.all([
      fetchSalesPeakHours(todayStr, todayStr),
      fetchSalesOrderTypes(todayStr, todayStr),
    ]);
    setBackendToday({
      hourly: h.data && Array.isArray(h.data.hourly) ? h.data.hourly : null,
      orderTypes: ot.data && Array.isArray(ot.data) ? ot.data : null,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadBackendToday();
      if (cancelled) return;
      setLastUpdated(new Date());
    })();
    return () => { cancelled = true; };
  }, [loadBackendToday]);

  // Manual Refresh + auto-refresh: re-pull the backend values that drive the
  // dashboard (bills/orders/products/expenses via onRefreshData, plus the
  // backend-computed charts) so every number stays correct. All fetchers are
  // offline-safe, so a failed refresh keeps the current data on screen.
  const handleRefresh = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      if (onRefreshData) onRefreshData();
      await loadBackendToday();
      setLastUpdated(new Date());
    } catch {
      /* offline — keep current data */
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, [onRefreshData, loadBackendToday]);

  // Auto-refresh every 60s while the dashboard is mounted and online, so the
  // KPI cards and charts update on their own. (Orders/tables/takeaway already
  // poll every 30s inside usePOSState — this covers bills + the chart
  // aggregations that would otherwise sit stale.)
  useEffect(() => {
    const id = setInterval(() => {
      if (navigator.onLine) handleRefresh(true);
    }, 60000);
    return () => clearInterval(id);
  }, [handleRefresh]);

  // Compute peak hours — backend aggregation when available.
  const hourlyData = useMemo(() => {
    if (backendToday.hourly) {
      return backendToday.hourly.map(x => ({ hour: x.hour, orders: x.orders, revenue: x.revenue }));
    }
    return computeHourlyBreakdown(bills);
  }, [backendToday.hourly, bills]);

  // Find peak hour (hour with most orders)
  const peakHour = useMemo(() => {
    if (hourlyData.length === 0) return null;
    return hourlyData.reduce((a, b) => a.orders > b.orders ? a : b);
  }, [hourlyData]);

  // Order type breakdown — backend aggregation when available.
  const orderTypes = useMemo(() => {
    if (backendToday.orderTypes && backendToday.orderTypes.length > 0) {
      const total = backendToday.orderTypes.reduce((s, o) => s + o.count, 0) || 1;
      return backendToday.orderTypes
        .map(o => ({ type: o.type, count: o.count, percent: Math.round((o.count / total) * 100) }))
        .sort((a, b) => b.count - a.count);
    }
    return getOrderTypeBreakdown(orders);
  }, [backendToday.orderTypes, orders]);

  // Active orders count (in kitchen flow)
  const activeKitchenOrders = useMemo(() =>
    orders.filter(o => ['New', 'Accepted', 'Preparing'].includes(o.status) && (o.kotRecords || []).length > 0).length,
    [orders]
  );

  // Available tables count
  const availableTables = useMemo(() =>
    tables.filter(t => t.status === 'Available').length,
    [tables]
  );

  // Occupied tables count
  const occupiedTables = useMemo(() =>
    tables.filter(t => t.status === 'Occupied' || t.status === 'Preparing' || t.status === 'Food Ready' || t.status === 'Served').length,
    [tables]
  );

  // Total customers today (unique)
  const todayCustomerCount = useMemo(() => {
    const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const phones = new Set(bills.filter(b => b.date === todayStr && b.customerPhone).map(b => b.customerPhone));
    return phones.size;
  }, [bills]);

  // Sparkline data from hourly revenue
  const sparklineData = useMemo(() => hourlyData.map(h => h.revenue), [hourlyData]);

  // AI Daily Summary state
  const [aiSummary, setAiSummary] = useState<DailyAISummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - new Date().getTimezoneOffset() * 60000 - 86400000);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      // REAL yesterday revenue — sum of all bills dated yesterday.
      const yesterdayRevenue = bills
        .filter(b => b.date === yesterdayStr)
        .reduce((s, b) => s + (b.grandTotal || 0), 0);

      // REAL low-stock count — products at/below their minimum threshold.
      const lowStockCount = products.filter((p: any) =>
        Number(p.currentStock) <= Number(p.minStock) && Number(p.minStock) > 0
      ).length;

      // REAL open order count — orders still in progress (incl. Preparing).
      const openOrderCount = orders.filter(o =>
        ['New', 'Accepted', 'Preparing'].includes(o.status)
      ).length;

      // REAL waste today — sum of today's logged waste events (est. cost via avg price).
      let wasteToday = 0;
      try {
        const wasteEvents = await fetchInventoryEvents({ type: 'waste', limit: 200 });
        if (wasteEvents) {
          wasteToday = wasteEvents
            .filter(e => String(e.timestamp || '').slice(0, 10) === todayStr)
            .reduce((s, e) => {
              const product = products.find((p: any) => p.name === e.item);
              return s + Math.abs(e.quantity || 0) * (Number(product?.averageCost) || 0);
            }, 0);
        }
      } catch { /* offline — keep 0 */ }

      if (cancelled) return;
      const summary = await generateDailySummary(
        dailySales.totalRevenue,
        yesterdayRevenue,
        lowStockCount,
        openOrderCount,
        wasteToday,
        todayCustomerCount
      );
      if (!cancelled) setAiSummary(summary);
    })();
    return () => { cancelled = true; };
  }, [dailySales.totalRevenue, bills, orders, todayCustomerCount]);

  // Quick action buttons (plan-gated: Kitchen & Inventory only render when the
  // subscription plan + module toggles include them)
  const kitchenEnabled = moduleSettings?.enableKitchenDisplay !== false;
  const quickActions = [
    { icon: ShoppingCart, label: 'New Order', action: () => onNavigate('Orders'), color: 'bg-blue-500 hover:bg-blue-600' },
    { icon: Zap, label: 'Billing', action: () => onNavigate('Billing'), color: 'bg-green-500 hover:bg-green-600' },
    ...(kitchenEnabled ? [{ icon: UtensilsCrossed, label: 'Kitchen', action: () => onNavigate('Kitchen'), color: 'bg-amber-500 hover:bg-amber-600' }] : []),
    ...(hasInventory ? [{ icon: Layers, label: 'Inventory', action: () => onNavigate('More'), color: 'bg-purple-500 hover:bg-purple-600' }] : []),
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto bg-[#faf8ff]">
      <div className="p-4 md:p-6 space-y-5 pb-12">
        {/* ===== HEADER ===== */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-gray-900">
                {greeting}, {currentEmployee.name.split(' ')[0]} 👋
              </h1>
              {showBranchIndicator && currentBranchName && (
                <span className="px-2.5 py-1 rounded-lg bg-purple-100 text-purple-700 border border-purple-200 text-[9px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                  {currentBranchName}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              <Calendar className="w-3 h-3 inline mr-1" />
              {dateStr} · {settings.restaurantName || 'Restaurant POS'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleRefresh()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e1e2ed] rounded-xl text-[10px] font-bold text-gray-600 hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] transition-all cursor-pointer">
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button onClick={onOpenDailySales}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e1e2ed] rounded-xl text-[10px] font-bold text-gray-600 hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] transition-all cursor-pointer">
              <Receipt className="w-3.5 h-3.5" />
              Daily Sales
            </button>
            <button onClick={onOpenZReport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e1e2ed] rounded-xl text-[10px] font-bold text-gray-600 hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] transition-all cursor-pointer">
              <BarChart3 className="w-3.5 h-3.5" />
              Z-Report
            </button>
          </div>
        </div>

        {/* ===== QUICK ACTIONS ===== */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {quickActions.map(qa => {
            const Icon = qa.icon;
            return (
              <button key={qa.label} onClick={qa.action}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-bold transition-all cursor-pointer shadow-xs hover:shadow-md active:scale-95 ${qa.color}`}>
                <Icon className="w-4 h-4" />
                {qa.label}
              </button>
            );
          })}
        </div>

        {/* ===== AI DAILY SUMMARY ===== */}
        {moduleSettings.enableAISummary !== false && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-purple-50 via-white to-blue-50 rounded-2xl border border-purple-200 shadow-sm overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-3.5 border-b border-purple-100">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-purple-500 flex items-center justify-center shadow-sm">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-sm font-bold text-gray-800">{aiSummary?.greeting || 'Good day'}</span>
                <p className="text-[10px] text-gray-400">AI Daily Summary · {aiSummary?.date || new Date().toLocaleDateString()}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              {(aiSummary?.alerts || []).map((alert, i) => (
                <span key={i} className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                  alert.severity === 'critical' ? 'bg-red-50 text-red-700' :
                  alert.severity === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                }`}>
                  {alert.message}
                </span>
              ))}
            </div>
          </div>
          <div className="px-5 py-4">
            {!aiSummary ? (
              <div className="flex items-center gap-3 py-4 text-gray-400">
                <Sparkles className="w-5 h-5 text-purple-300 shrink-0" />
                <p className="text-xs">
                  AI summary is temporarily unavailable. The dashboard is using local calculations.
                </p>
              </div>
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-[#e1e2ed] p-3.5">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Key Insight</p>
                <p className="text-xs font-semibold text-gray-800 mt-1">{aiSummary.keyInsight}</p>
              </div>
              <div className="bg-white rounded-xl border border-[#e1e2ed] p-3.5">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Top Priority</p>
                <p className="text-xs font-semibold text-gray-800 mt-1">{aiSummary.topPriority}</p>
              </div>
              <div className="bg-white rounded-xl border border-[#e1e2ed] p-3.5">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Revenue Projection</p>
                <p className="text-xs font-semibold text-emerald-700 mt-1">{aiSummary.revenuePrediction}</p>
              </div>
              <div className="bg-white rounded-xl border border-[#e1e2ed] p-3.5">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Suggestions</p>
                <ul className="mt-1 space-y-0.5">
                  {aiSummary.itemSuggestions.map((s, i) => (
                    <li key={i} className="text-[10px] text-gray-600 flex items-start gap-1">
                      <span className="w-1 h-1 rounded-full bg-purple-400 mt-1.5 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            )}
          </div>
        </motion.div>
        )}

        {/* ===== KPI CARDS (memoized) ===== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <DashboardStatCard
            label="Today's Revenue"
            value={formatCurrency(dailySales.totalRevenue, currencySymbol)}
            subtitle={`${dailySales.totalOrders} order${dailySales.totalOrders !== 1 ? 's' : ''} today`}
            icon={DollarSign}
            iconBg="bg-green-50"
            iconColor="text-green-600"
          >
            {sparklineData.length > 0 && <Sparkline data={sparklineData} color="#16a34a" />}
          </DashboardStatCard>

          <DashboardStatCard
            label="Total Orders"
            value={dailySales.totalOrders}
            subtitle={`Avg: ${formatCurrency(dailySales.averageOrderValue, currencySymbol)}`}
            icon={ShoppingCart}
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
          >
            <div className="flex flex-wrap gap-1.5">
              {orderTypes.slice(0, 4).map(ot => (
                <span key={ot.type} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                  {ot.type} {ot.percent}%
                </span>
              ))}
            </div>
          </DashboardStatCard>

          <DashboardStatCard
            label="Items Sold"
            value={dailySales.totalItemsSold}
            subtitle={`Discounts: ${formatCurrency(dailySales.totalDiscount, currencySymbol)}`}
            icon={Package}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
          >
            {dailySales.topItems.length > 0 && (
              <p className="text-[9px] text-gray-400 font-semibold">
                Top: {dailySales.topItems[0].name} ({dailySales.topItems[0].qty}x)
              </p>
            )}
          </DashboardStatCard>

          <DashboardStatCard
            label="Restaurant Status"
            value={`${occupiedTables}/${availableTables}`}
            subtitle={`👤 ${todayCustomerCount} customers · 👨‍🍳 ${employees.filter(e => e.status === 'Active').length} staff`}
            icon={Users}
            iconBg="bg-purple-50"
            iconColor="text-purple-600"
          >
            <div className="flex items-center gap-3 justify-center">
              <div className="text-center">
                <p className="text-lg font-black text-gray-900">{occupiedTables}</p>
                <p className="text-[8px] text-gray-400 font-semibold">Occupied</p>
              </div>
              <div className="w-px h-8 bg-gray-100" />
              <div className="text-center">
                <p className="text-lg font-black text-green-600">{availableTables}</p>
                <p className="text-[8px] text-gray-400 font-semibold">Available</p>
              </div>
              <div className="w-px h-8 bg-gray-100" />
              <div className="text-center">
                <p className="text-lg font-black text-amber-600">{activeKitchenOrders}</p>
                <p className="text-[8px] text-gray-400 font-semibold">Cooking</p>
              </div>
            </div>
          </DashboardStatCard>
        </div>

        {/* ===== SECOND ROW: Top Items + Payment Breakdown ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top Selling Items */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-4 h-4 text-amber-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Top Selling Items</h3>
            </div>
            {dailySales.topItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                <Coffee className="w-10 h-10 mb-2" />
                <p className="text-xs font-medium">No items sold today yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {dailySales.topItems.slice(0, 8).map((item, idx) => {
                  const maxQty = dailySales.topItems[0].qty || 1;
                  const barWidth = (item.qty / maxQty) * 100;
                  return (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-gray-400 w-5 text-right shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-[11px] font-semibold text-gray-800 truncate">{item.name}</span>
                          <span className="text-[10px] font-bold text-gray-500 ml-2 shrink-0">
                            {item.qty}x · {formatCurrency(item.revenue, currencySymbol)}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all"
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

          {/* Payment Breakdown */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <CreditCard className="w-4 h-4 text-blue-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Payment Methods</h3>
            </div>
            {dailySales.paymentBreakdown.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                <Banknote className="w-10 h-10 mb-2" />
                <p className="text-xs font-medium">No payments recorded today</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Payment method icons mapping */}
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
                      <div key={pm.method} className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-gray-50 text-gray-500">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between items-center mb-0.5">
                            <span className="text-xs font-bold text-gray-800">{pm.method}</span>
                            <span className="text-[10px] font-bold text-gray-500">
                              {formatCurrency(pm.amount, currencySymbol)} · {pm.count} txns
                            </span>
                          </div>
                          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full transition-all"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <p className="text-[9px] text-gray-400 mt-0.5">{percent.toFixed(0)}% of today's revenue</p>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </div>

        {/* ===== THIRD ROW: Peak Hours + Category Breakdown + Recent Activity ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Peak Hours Chart */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-indigo-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Hourly Orders</h3>
              {peakHour && peakHour.orders > 0 && (
                <span className="text-[9px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full ml-auto">
                  Peak: {peakHour.hour} ({peakHour.orders} orders)
                </span>
              )}
            </div>
            {hourlyData.every(h => h.orders === 0) ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                <Activity className="w-10 h-10 mb-2" />
                <p className="text-xs font-medium">No hourly data available yet</p>
              </div>
            ) : (
              <div className="flex items-end gap-1.5 h-40 overflow-x-auto pb-2">
                {hourlyData.map(h => {
                  const maxOrders = Math.max(...hourlyData.map(x => x.orders), 1);
                  const height = (h.orders / maxOrders) * 100;
                  const isPeak = peakHour && h.hour === peakHour.hour;
                  return (
                    <div key={h.hour} className="flex flex-col items-center gap-1 min-w-[32px] flex-1">
                      <span className="text-[8px] font-bold text-gray-400">{h.orders}</span>
                      <div
                        className={`w-full rounded-t-md transition-all ${
                          isPeak ? 'bg-gradient-to-t from-indigo-500 to-indigo-400' : 'bg-gradient-to-t from-indigo-300 to-indigo-200'
                        }`}
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${h.hour}: ${h.orders} orders, ${formatCurrency(h.revenue, currencySymbol)}`}
                      />
                      <span className={`text-[8px] font-semibold ${isPeak ? 'text-indigo-600' : 'text-gray-400'}`}>
                        {h.hour.replace(':00', '')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Category Breakdown */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <PieChart className="w-4 h-4 text-pink-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Categories Today</h3>
            </div>
            {dailySales.categoryBreakdown.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                <Layers className="w-10 h-10 mb-2" />
                <p className="text-xs font-medium">No category data yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {dailySales.categoryBreakdown.sort((a, b) => b.revenue - a.revenue).slice(0, 7).map(cat => {
                  const maxRevenue = Math.max(...dailySales.categoryBreakdown.map(c => c.revenue), 1);
                  const barWidth = (cat.revenue / maxRevenue) * 100;
                  const colors = [
                    'from-pink-400 to-pink-500',
                    'from-purple-400 to-purple-500',
                    'from-blue-400 to-blue-500',
                    'from-green-400 to-green-500',
                    'from-amber-400 to-amber-500',
                    'from-red-400 to-red-500',
                    'from-teal-400 to-teal-500',
                  ];
                  return (
                    <div key={cat.category}>
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-[10px] font-semibold text-gray-700 truncate">{cat.category}</span>
                        <span className="text-[9px] font-bold text-gray-500 shrink-0 ml-2">
                          {cat.qty} · {formatCurrency(cat.revenue, currencySymbol)}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${colors[dailySales.categoryBreakdown.indexOf(cat) % colors.length]} transition-all`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ===== EXPENSES CARD ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-4">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Revenue vs Expenses</h3>
            </div>
            <div className="space-y-4">
              {/* Today */}
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase mb-2">Today</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-xl p-3 border border-green-100">
                    <p className="text-[8px] font-bold text-green-600 uppercase">Revenue</p>
                    <p className="text-lg font-black text-green-700 mt-0.5 font-mono">
                      {formatCurrency(dailySales.totalRevenue, currencySymbol)}
                    </p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-3 border border-red-100">
                    <p className="text-[8px] font-bold text-red-600 uppercase">Expenses</p>
                    <p className="text-lg font-black text-red-600 mt-0.5 font-mono">
                      {formatCurrency(totalExpensesToday, currencySymbol)}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex justify-between text-[10px] font-bold">
                  <span className={dailySales.totalRevenue - totalExpensesToday >= 0 ? 'text-green-600' : 'text-red-600'}>
                    Net: {formatCurrency(dailySales.totalRevenue - totalExpensesToday, currencySymbol)}
                  </span>
                  <span className="text-gray-400">
                    {dailySales.totalRevenue > 0 ? `Margin: ${(((dailySales.totalRevenue - totalExpensesToday) / dailySales.totalRevenue) * 100).toFixed(0)}%` : '—'}
                  </span>
                </div>
              </div>
              {/* This Month */}
              <div className="border-t border-gray-100 pt-3">
                <p className="text-[9px] font-bold text-gray-400 uppercase mb-2">This Month</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50/50 rounded-xl p-3">
                    <p className="text-[8px] font-bold text-green-600 uppercase">Revenue</p>
                    <p className="text-sm font-black text-green-700 mt-0.5 font-mono">
                      {formatCurrency(dailySales.totalRevenue, currencySymbol)}
                    </p>
                    <p className="text-[8px] text-gray-400">(today only)</p>
                  </div>
                  <div className="bg-red-50/50 rounded-xl p-3">
                    <p className="text-[8px] font-bold text-red-600 uppercase">Expenses</p>
                    <p className="text-sm font-black text-red-600 mt-0.5 font-mono">
                      {formatCurrency(totalExpensesThisMonth, currencySymbol)}
                    </p>
                    <p className="text-[8px] text-gray-400">(this month)</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Cashier Performance */}
          {moduleSettings.showCashierPerformance !== false && (
            <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-cyan-500" />
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Cashier Performance</h3>
              </div>
              {dailySales.cashierPerformance.length === 0 ? (
                <p className="text-[10px] text-gray-400 py-4 text-center">No cashier data today</p>
              ) : (
                <div className="space-y-2">
                  {dailySales.cashierPerformance.map((c, idx) => (
                    <div key={c.name} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 text-white flex items-center justify-center text-[9px] font-bold">
                          {c.name.charAt(0)}
                        </div>
                        <span className="text-xs font-semibold text-gray-800">{c.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-bold text-gray-600">{c.orders} orders</span>
                        <span className="text-[9px] text-gray-400 ml-2">{formatCurrency(c.revenue, currencySymbol)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI Weather Widget */}
          {moduleSettings.enableAIWeather !== false && <WeatherWidget menuItems={products.map((p: any) => p.name).filter(Boolean)} />}

          {/* Quick Stats / Summary */}
          <div className="bg-white rounded-2xl border border-[#e1e2ed] p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-emerald-500" />
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Today's Summary</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[9px] font-bold text-gray-400 uppercase">Avg Order</p>
                <p className="text-lg font-black text-gray-900 mt-0.5 font-mono">
                  {formatCurrency(dailySales.averageOrderValue, currencySymbol)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[9px] font-bold text-gray-400 uppercase">GST Collected</p>
                <p className="text-lg font-black text-gray-900 mt-0.5 font-mono">
                  {formatCurrency(dailySales.totalGst, currencySymbol)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[9px] font-bold text-gray-400 uppercase">Discounts Given</p>
                <p className="text-lg font-black text-red-500 mt-0.5 font-mono">
                  -{formatCurrency(dailySales.totalDiscount, currencySymbol)}
                </p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[9px] font-bold text-gray-400 uppercase">Items per Order</p>
                <p className="text-lg font-black text-gray-900 mt-0.5 font-mono">
                  {dailySales.totalOrders > 0 ? (dailySales.totalItemsSold / dailySales.totalOrders).toFixed(1) : '0'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ===== FOOTER ===== */}
        <div className="flex items-center justify-between py-3 border-t border-[#e1e2ed] text-[9px] text-gray-400">
          <span>
            Data for {dateStr} · Updated{' '}
            {lastUpdated
              ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : '…'} · Auto-refreshes every 60s
          </span>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${isRefreshing ? 'bg-amber-400 animate-pulse' : 'bg-green-400'}`} />
            <span>{isRefreshing ? 'Refreshing…' : 'Live'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

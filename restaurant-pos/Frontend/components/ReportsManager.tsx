/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area
} from 'recharts';
import {
  TrendingUp, ShoppingBag, CreditCard, Users, ArrowUpRight, Award,
  DollarSign, Calendar, Search, Eye, Filter, RotateCcw, FileText, CalendarDays, Download,
  RefreshCw, Clock, Activity, Layers, TrendingDown, Printer,
  Sun, Moon, Sunrise, Sunset, ArrowDownRight, Minus
} from 'lucide-react';
import { Bill, Customer, Product } from '../src/types';
// ─── Phase 1.8: backend-generated reports ──────────────────────────
// The backend is the single source of truth for every aggregate. React is
// presentation-only: it requests already-computed reports and caches the last
// successful snapshot per report+range. Local estimates are used ONLY as an
// offline fallback when no cached server data exists.
import {
  fetchSalesSummary, fetchSalesTrend, fetchSalesPayments, fetchSalesOrderTypes,
  fetchSalesCashiers, fetchSalesPeakHours, fetchProductTop, fetchProductLeast,
  fetchProductCategories, fetchReportExport,
} from '../src/api/client';
import type {
  SalesSummaryReport, SalesTrendPoint, SalesPaymentRow, SalesOrderTypeRow,
  SalesCashierRow, SalesHourRow, ProductReportRow,
} from '../src/types';

interface ReportsManagerProps {
  bills: Bill[];
  customers: Customer[];
  products: Product[];
  currencySymbol: string;
  moduleSettings?: Record<string, boolean>;
  onViewBill?: (bill: Bill) => void;
  onRefresh?: () => void;
}

export default function ReportsManager({ bills, customers, products, currencySymbol, moduleSettings = {} as Record<string, boolean>, onViewBill, onRefresh }: ReportsManagerProps) {
  // Compute a stable hash of the bills array to detect changes from localStorage
  const getBillsHash = (billsArr: Bill[]): string => {
    const latest = billsArr.length > 0 ? billsArr[billsArr.length - 1] : null;
    return `${billsArr.length}|${latest ? latest.id : 'empty'}|${latest ? latest.grandTotal : 0}`;
  };

  // Auto-refresh state
  const [lastRefreshed, setLastRefreshed] = useState<string>(() => new Date().toLocaleTimeString());
  const [isAutoRefresh, setIsAutoRefresh] = useState<boolean>(true);
  const billsHashRef = useRef<string>(getBillsHash(bills));

  // Auto-refresh polling: check localStorage every 10 seconds for new data
  useEffect(() => {
    if (!isAutoRefresh) return;

    const intervalId = setInterval(() => {
      try {
        const storedBills = JSON.parse(localStorage.getItem('pos_bills') || '[]');
        const storedHash = getBillsHash(storedBills);
        
        if (storedHash !== billsHashRef.current) {
          billsHashRef.current = storedHash;
          if (onRefresh) {
            onRefresh();
          }
          setLastRefreshed(new Date().toLocaleTimeString());
        }
      } catch {
        // Silently fail if localStorage is unavailable
      }
    }, 10000);

    return () => clearInterval(intervalId);
  }, [isAutoRefresh, onRefresh]);

  // Update hash and timestamp when the bills prop changes from parent (e.g., after checkout)
  useEffect(() => {
    setLastRefreshed(new Date().toLocaleTimeString());
    billsHashRef.current = getBillsHash(bills);
  }, [bills]);

  // Helpers to get UTC-based date strings (consistent with how bill dates are stored)
  const getTodayString = () => {
    return new Date().toISOString().split('T')[0];
  };

  const getYesterdayString = () => {
    return new Date(Date.now() - 86400000).toISOString().split('T')[0];
  };

  const getSevenDaysAgoString = () => {
    return new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  };

  const todayStr = getTodayString();

  // Date Filter states - default to last 7 days for a richer report view
  const [startDate, setStartDate] = useState<string>(getSevenDaysAgoString());
  const [endDate, setEndDate] = useState<string>(todayStr);

  // List search & secondary filters states
  const [searchQuery, setSearchQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>('All');
  const [channelFilter, setChannelFilter] = useState<string>('All');

  // Handle Preset Ranges
  const handlePreset = (preset: 'Today' | 'Yesterday' | 'ThisWeek' | 'AllTime') => {
    if (preset === 'Today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === 'Yesterday') {
      const yest = getYesterdayString();
      setStartDate(yest);
      setEndDate(yest);
    } else if (preset === 'ThisWeek') {
      setStartDate(getSevenDaysAgoString());
      setEndDate(todayStr);
    } else if (preset === 'AllTime') {
      setStartDate('');
      setEndDate('');
    }
  };

  // ─── Phase 1.8: backend report fetch + cache ─────────────────────
  // Each section keeps a null/array distinction: `null` means "no server data
  // available for this range (offline + no cache)" → fall back to the local
  // estimate; a (possibly empty) array means "server truth" → render it.
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
  const [exporting, setExporting] = useState<boolean>(false);
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const billsVersion = `${bills.length}|${bills.length ? bills[bills.length - 1].id : 'empty'}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, t, p, ot, c, ph, tp, lp, cat] = await Promise.all([
        fetchSalesSummary(startDate, endDate),
        fetchSalesTrend(startDate, endDate),
        fetchSalesPayments(startDate, endDate),
        fetchSalesOrderTypes(startDate, endDate),
        fetchSalesCashiers(startDate, endDate),
        fetchSalesPeakHours(startDate, endDate),
        fetchProductTop(startDate, endDate, 5),
        fetchProductLeast(startDate, endDate, 5),
        fetchProductCategories(startDate, endDate),
      ]);
      if (cancelled) return;
      if (s.data || t.data || p.data || ot.data || c.data || ph.data || tp.data || lp.data || cat.data) {
        setReport({
          summary: s.data ?? null,
          trend: t.data ?? null,
          payments: p.data ?? null,
          orderTypes: ot.data ?? null,
          cashiers: c.data ?? null,
          peakHours: Array.isArray(ph.data) ? ph.data : (ph.data?.hourly ?? null),
          topProducts: tp.data ?? null,
          leastProducts: lp.data ?? null,
          categories: cat.data ?? null,
        });
      } else {
        setReport(null);
      }
    })();
    return () => { cancelled = true; };
  }, [startDate, endDate, refreshTick, billsVersion]);

  // 1. Filter raw bills by Date Range (used for the ledger table + offline fallback)
  const dateFilteredBills = bills.filter(bill => {
    if (startDate && bill.date < startDate) return false;
    if (endDate && bill.date > endDate) return false;
    return true;
  });

  // ─── Local estimates — OFFLINE FALLBACK ONLY ─────────────────────
  // The backend computes the authoritative figures; these local reduce()
  // values are only surfaced when no cached server report exists.
  const localTotalRevenue = dateFilteredBills.reduce((sum, b) => sum + b.grandTotal, 0);
  const localTotalOrders = dateFilteredBills.length;
  const localAvgOrderValue = localTotalOrders > 0 ? localTotalRevenue / localTotalOrders : 0;
  const localTotalPointsRedeemed = dateFilteredBills.reduce((sum, b) => sum + b.pointsRedeemed, 0);
  const localTotalPointsEarned = dateFilteredBills.reduce((sum, b) => sum + b.pointsEarned, 0);

  const localTrendChartData = (() => {
    if (dateFilteredBills.length === 0) {
      return [ { name: 'No Data', Sales: 0, Orders: 0 } ];
    }
    if (startDate && endDate && startDate === endDate) {
      const hourlySales: Record<string, { Sales: number; Orders: number }> = {
        '10 AM': { Sales: 0, Orders: 0 },
        '12 PM': { Sales: 0, Orders: 0 },
        '02 PM': { Sales: 0, Orders: 0 },
        '04 PM': { Sales: 0, Orders: 0 },
        '06 PM': { Sales: 0, Orders: 0 },
        '08 PM': { Sales: 0, Orders: 0 },
        '10 PM': { Sales: 0, Orders: 0 }
      };
      dateFilteredBills.forEach(b => {
        const hour = parseInt(b.time.split(':')[0], 10);
        let slot = '10 AM';
        if (hour < 11) slot = '10 AM';
        else if (hour < 13) slot = '12 PM';
        else if (hour < 15) slot = '02 PM';
        else if (hour < 17) slot = '04 PM';
        else if (hour < 19) slot = '06 PM';
        else if (hour < 21) slot = '08 PM';
        else slot = '10 PM';
        hourlySales[slot].Sales += b.grandTotal;
        hourlySales[slot].Orders += 1;
      });
      return Object.entries(hourlySales).map(([name, data]) => ({
        name,
        Sales: Number(data.Sales.toFixed(2)),
        Orders: data.Orders
      }));
    } else {
      const dailySales: Record<string, { Sales: number; Orders: number }> = {};
      dateFilteredBills.forEach(b => {
        dailySales[b.date] = dailySales[b.date] || { Sales: 0, Orders: 0 };
        dailySales[b.date].Sales += b.grandTotal;
        dailySales[b.date].Orders += 1;
      });
      const sortedDates = Object.keys(dailySales).sort();
      return sortedDates.map(date => ({
        name: date,
        Sales: Number(dailySales[date].Sales.toFixed(2)),
        Orders: dailySales[date].Orders
      }));
    }
  })();

  const localPaymentChartData = (() => {
    const paymentMethodCount = dateFilteredBills.reduce((acc, b) => {
      acc[b.paymentMethod] = (acc[b.paymentMethod] || 0) + b.grandTotal;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(paymentMethodCount).map(([name, value]) => ({
      name,
      value: Number(value.toFixed(2))
    }));
  })();

  const localTopSellingProducts = (() => {
    const productQuantities: Record<string, { name: string; qty: number; category: string }> = {};
    dateFilteredBills.forEach((bill) => {
      bill.items.forEach((item) => {
        const pId = item.product.id;
        if (productQuantities[pId]) {
          productQuantities[pId].qty += item.quantity;
        } else {
          productQuantities[pId] = {
            name: item.product.name,
            qty: item.quantity,
            category: item.product.category
          };
        }
      });
    });
    return Object.values(productQuantities)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  })();

  // Previous period comparison — local fallback.
  // Guarded: "All Time" clears startDate/endDate to '', and date arithmetic on
  // empty strings yields Invalid Date → .toISOString() throws RangeError during
  // render. Skip the comparison entirely when no explicit range is set.
  const hasRange = Boolean(startDate && endDate);
  const rangeMs = hasRange ? Math.max(new Date(endDate).getTime() - new Date(startDate).getTime(), 0) : 0;
  const prevEndStr = hasRange ? new Date(new Date(startDate).getTime() - 86400000).toISOString().slice(0, 10) : '';
  const prevStartStr = hasRange ? new Date(new Date(prevEndStr).getTime() - rangeMs).toISOString().slice(0, 10) : '';
  const localPrevBills = hasRange ? bills.filter(bill => bill.date >= prevStartStr && bill.date <= prevEndStr) : [];
  const localPrevRevenue = localPrevBills.reduce((sum, b) => sum + b.grandTotal, 0);
  const localPrevOrders = localPrevBills.length;

  const localPeakHoursData = (() => {
    const hourlyMap: Record<number, number> = {};
    dateFilteredBills.forEach(b => {
      const hour = parseInt(b.time.split(':')[0], 10);
      if (!isNaN(hour)) hourlyMap[hour] = (hourlyMap[hour] || 0) + 1;
    });
    const result: { hour: string; orders: number }[] = [];
    for (let h = 6; h <= 23; h++) {
      result.push({ hour: `${h.toString().padStart(2, '0')}:00`, orders: hourlyMap[h] || 0 });
    }
    return result;
  })();

  const localCategoryData = (() => {
    const map: Record<string, { qty: number; revenue: number }> = {};
    dateFilteredBills.forEach(b => {
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
  })();

  const localCashierData = (() => {
    const map: Record<string, { orders: number; revenue: number; items: number }> = {};
    dateFilteredBills.forEach(b => {
      if (!map[b.cashierName]) map[b.cashierName] = { orders: 0, revenue: 0, items: 0 };
      map[b.cashierName].orders += 1;
      map[b.cashierName].revenue += b.grandTotal;
      map[b.cashierName].items += b.items.reduce((s, i) => s + i.quantity, 0);
    });
    return Object.entries(map)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue);
  })();

  const localOrderTypeData = (() => {
    const map: Record<string, number> = {};
    dateFilteredBills.forEach(b => {
      map[b.orderType] = (map[b.orderType] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  })();

  const localSlowMovers = (() => {
    const productQuantities: Record<string, { name: string; qty: number; category: string }> = {};
    dateFilteredBills.forEach((bill) => {
      bill.items.forEach((item) => {
        const pId = item.product.id;
        if (productQuantities[pId]) {
          productQuantities[pId].qty += item.quantity;
        } else {
          productQuantities[pId] = {
            name: item.product.name,
            qty: item.quantity,
            category: item.product.category
          };
        }
      });
    });
    const allItems = Object.values(productQuantities).sort((a, b) => b.qty - a.qty);
    return allItems.filter(i => i.qty <= (allItems[0]?.qty || 1) * 0.1).slice(0, 5);
  })();

  // ─── Data source selection: backend first, local fallback ───────
  const summary = report?.summary ?? null;
  const productCategoryMap = new Map<string, string>();
  products.forEach(p => { if (p.name) productCategoryMap.set(p.name, p.category); });

  // 2. Key Performance Indicators (backend authoritative)
  const totalRevenue = summary ? summary.summary.netSales : localTotalRevenue;
  const totalOrders = summary ? summary.summary.orders : localTotalOrders;
  const avgOrderValue = summary ? summary.summary.averageOrderValue : localAvgOrderValue;
  const totalPointsRedeemed = summary ? summary.summary.pointsRedeemed : localTotalPointsRedeemed;
  const totalPointsEarned = summary ? summary.summary.pointsEarned : localTotalPointsEarned;

  // Loyalty KPIs (customer registry — not money, kept local)
  const repeatGuests = customers.filter(c => c.visits >= 2).length;
  const repeatGuestRate = customers.length > 0 ? (repeatGuests / customers.length) * 100 : 0;

  // 3. Sales trend (backend aggregation)
  const salesTrendChartData = report?.trend != null
    ? report.trend.map(p => ({ name: p.date || p.name || '', Sales: p.revenue, Orders: p.orders }))
    : localTrendChartData;

  // 4. Payment method distribution (backend aggregation)
  const paymentChartData = report?.payments != null
    ? report.payments.map(p => ({ name: p.method, value: p.amount }))
    : localPaymentChartData;

  const COLORS = ['#004ac6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

  // 5. Top Selling Products (backend aggregation)
  const topSellingProducts = report?.topProducts != null
    ? report.topProducts.slice(0, 5).map(p => ({
        name: p.name,
        qty: p.qty,
        category: productCategoryMap.get(p.name) || 'Uncategorized'
      }))
    : localTopSellingProducts;

  // ===== ANALYTICS: Previous period comparison (backend values) =====
  const prevRevenue = summary ? summary.comparison.previousNetRevenue : localPrevRevenue;
  const prevOrders = summary ? summary.comparison.previousOrders : localPrevOrders;

  const pctChange = (current: number, previous: number): number => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  // ===== ANALYTICS: Peak hours (backend aggregation) =====
  const peakHoursData = report?.peakHours != null ? report.peakHours : localPeakHoursData;
  const peakHour = report?.peakHours != null && report.peakHours.length > 0
    ? report.peakHours.reduce((max, d) => d.orders > max.orders ? d : max, report.peakHours[0])
    : peakHoursData.reduce((max, d) => d.orders > max.orders ? d : max, peakHoursData[0] || { hour: '', orders: 0, revenue: 0 });

  // ===== ANALYTICS: Category performance (backend aggregation) =====
  const categoryData = report?.categories != null
    ? report.categories.map(c => ({ name: c.category, qty: c.qty, revenue: c.revenue }))
    : localCategoryData;

  // ===== ANALYTICS: Cashier performance (backend aggregation) =====
  const cashierData = report?.cashiers != null
    ? report.cashiers.map(c => ({ name: c.cashier, orders: c.orders, revenue: c.revenue, items: c.itemsSold }))
    : localCashierData;

  // ===== ANALYTICS: Order type distribution (backend aggregation) =====
  const orderTypeData = report?.orderTypes != null
    ? report.orderTypes.map(o => ({ name: o.type, value: o.count }))
    : localOrderTypeData;

  // ===== ANALYTICS: Slow movers (backend aggregation) =====
  const slowMovers = report?.leastProducts != null
    ? report.leastProducts.map(p => ({ name: p.name, qty: p.qty }))
    : localSlowMovers;

  // 6. Sub-filter the ledger list of bills based on searches & selects
  const ledgerBills = dateFilteredBills.filter(bill => {
    const matchesSearch = searchQuery.trim() === '' || 
      bill.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bill.ticketNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (bill.customerName && bill.customerName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (bill.customerPhone && bill.customerPhone.includes(searchQuery)) ||
      bill.cashierName.toLowerCase().includes(searchQuery.toLowerCase());
      
    const matchesPayment = paymentFilter === 'All' || bill.paymentMethod === paymentFilter;
    const matchesChannel = channelFilter === 'All' || bill.orderType === channelFilter;
    
    return matchesSearch && matchesPayment && matchesChannel;
  });

  // ===== PAGINATION =====
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(ledgerBills.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedBills = ledgerBills.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [startDate, endDate, searchQuery, paymentFilter, channelFilter]);

  // Export to CSV — backend-generated, matches the displayed report.
  // Falls back to a local ledger CSV only when offline with no cache.
  const exportToCSV = async () => {
    try {
      setExporting(true);
      const csv = await fetchReportExport('sales', 'csv', startDate, endDate);
      if (csv) {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `sales_report_${startDate || 'all'}_${endDate || 'all'}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return;
      }
    } catch {
      // Fall through to the offline ledger CSV
    } finally {
      setExporting(false);
    }

    // Offline fallback — CSV of the visible ledger rows only.
    const headers = ["Invoice No", "Ticket No", "Date", "Time", "Channel", "Cashier", "Customer Name", "Items Count", "Subtotal", "Discount", "Net Total", "Payment Method"];
    const rows = ledgerBills.map(bill => [
      bill.invoiceNumber,
      bill.ticketNumber,
      bill.date,
      bill.time,
      bill.orderType,
      bill.cashierName,
      bill.customerName || "Guest",
      bill.items.reduce((sum, item) => sum + item.quantity, 0),
      bill.subtotal.toFixed(2),
      bill.discount.toFixed(2),
      bill.grandTotal.toFixed(2),
      bill.paymentMethod
    ]);

    const csvContent = [headers, ...rows].map(row => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `reports_${startDate}_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="reports_workspace" className="p-6 h-full overflow-y-auto space-y-6 font-sans pb-12">
      
      {/* 1. Header & Date Search Filters Panel */}
      <div className="bg-[var(--color-bg-white)] p-5 rounded-xl border border-[var(--color-border-default)] shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">Executive Sales & Loyalty Analytics</h2>
              
              {/* Auto-refresh indicator */}
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-green-50 border border-green-200/60 text-[10px] font-semibold text-green-700 select-none">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 ${isAutoRefresh ? '' : 'hidden'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${isAutoRefresh ? 'bg-[var(--color-green-500-solid)]' : 'bg-gray-400'}`}></span>
                </span>
                <span>Auto-refresh</span>
                <span className="text-green-500 font-mono">| {lastRefreshed}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (onRefresh) onRefresh();
                    setRefreshTick(t => t + 1);
                    setLastRefreshed(new Date().toLocaleTimeString());
                  }}
                  className="ml-1 p-0.5 rounded hover:bg-green-100 transition-colors cursor-pointer"
                  title="Refresh now"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsAutoRefresh(prev => !prev)}
                  className={`ml-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                    isAutoRefresh ? 'bg-green-200 text-green-800 hover:bg-green-300' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                  }`}
                  title={isAutoRefresh ? 'Disable auto-refresh' : 'Enable auto-refresh'}
                >
                  {isAutoRefresh ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">Review register revenue logs, loyalty points audit records, and digital payment charts.</p>
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex flex-wrap gap-1.5 bg-[var(--color-primary-light)] border border-[var(--color-border-input)] p-1 rounded-lg select-none shrink-0">
            {[
              { id: 'Today', label: "Today's Bills" },
              { id: 'Yesterday', label: 'Yesterday' },
              { id: 'ThisWeek', label: 'Last 7 Days' },
              { id: 'AllTime', label: 'All Time' }
            ].map((preset) => {
              const isSelected = 
                (preset.id === 'Today' && startDate === todayStr && endDate === todayStr) ||
                (preset.id === 'Yesterday' && startDate === getYesterdayString() && endDate === getYesterdayString()) ||
                (preset.id === 'ThisWeek' && startDate === getSevenDaysAgoString() && endDate === todayStr) ||
                (preset.id === 'AllTime' && startDate === '' && endDate === '');
              
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePreset(preset.id as any)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    isSelected 
                      ? 'bg-[var(--brand-color)] text-white shadow-sm' 
                      : 'text-gray-600 hover:bg-[var(--color-surface-muted)]'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Calendar Pickers Row */}
        <div className="pt-3 border-t border-gray-100 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5 uppercase tracking-wider shrink-0">
              <Calendar className="w-4 h-4 text-[var(--brand-color)]" />
              Filter Reports & Receipts By Date:
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400 uppercase">From:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-1.5 border border-[var(--color-border-input)] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] bg-[var(--color-bg-white)] cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400 uppercase">To:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-1.5 border border-[var(--color-border-input)] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] bg-[var(--color-bg-white)] cursor-pointer"
              />
            </div>

            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="px-2.5 py-1.5 text-[10px] font-bold text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 rounded-lg flex items-center gap-1 cursor-pointer transition-all"
                title="Clear date filter"
              >
                Reset (Show All)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Warning Helper message if today is empty but history exists */}
      {startDate === todayStr && endDate === todayStr && totalOrders === 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-start gap-2.5">
            <CalendarDays className="w-5 h-5 text-[var(--brand-color)] shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-[var(--color-text-primary)]">No receipts recorded for today ({todayStr}) yet.</p>
              <p className="text-[10px] text-gray-500 mt-0.5">By default, the report shows today's receipts. You can check pre-seeded transaction histories or switch ranges below.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handlePreset('ThisWeek')}
            className="px-3 py-1.5 text-[10px] font-bold bg-[var(--brand-color)] text-white hover:bg-[var(--color-primary-hover)] rounded-lg shadow-sm cursor-pointer transition-all shrink-0"
          >
            Show Last 7 Days Logs
          </button>
        </div>
      )}

      {/* 2. Numerical KPIs Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Metric 1: Revenue */}
        <div className="bg-[var(--color-bg-white)] p-4 rounded-xl border border-[var(--color-border-default)] shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-[var(--brand-color)] flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Gross Revenue</span>
            <span className="text-lg font-bold text-[var(--color-text-primary)] font-mono">{currencySymbol}{totalRevenue.toFixed(2)}</span>
            <span className="text-[9px] text-green-600 font-semibold block mt-0.5">Range Selected Total</span>
          </div>
        </div>

        {/* Metric 2: Total Invoices */}
        <div className="bg-[var(--color-bg-white)] p-4 rounded-xl border border-[var(--color-border-default)] shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-green-50 text-green-600 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Total Invoices</span>
            <span className="text-lg font-bold text-[var(--color-text-primary)] font-mono">{totalOrders} bills</span>
            <span className="text-[9px] text-green-600 font-semibold block mt-0.5">Tickets checked out</span>
          </div>
        </div>

        {/* Metric 3: Average Ticket */}
        <div className="bg-[var(--color-bg-white)] p-4 rounded-xl border border-[var(--color-border-default)] shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Average Ticket</span>
            <span className="text-lg font-bold text-[var(--color-text-primary)] font-mono">{currencySymbol}{avgOrderValue.toFixed(2)}</span>
            <span className="text-[9px] text-[var(--brand-color)] font-semibold block mt-0.5">Avg spending value</span>
          </div>
        </div>

        {/* Metric 4: Repeat Guest Rate */}
        <div className="bg-[var(--color-bg-white)] p-4 rounded-xl border border-[var(--color-border-default)] shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Repeat Guest Rate</span>
            <span className="text-lg font-bold text-[var(--color-text-primary)] font-mono">{repeatGuestRate.toFixed(1)}%</span>
            <span className="text-[9px] text-green-600 font-semibold block mt-0.5">{repeatGuests} frequent patrons</span>
          </div>
        </div>

      </div>

      {/* 3. Sales Trend Recharts & Payment modes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Area sales trend (left 2/3) */}
        <div className="lg:col-span-2 bg-[var(--color-bg-white)] p-5 rounded-xl border border-[var(--color-border-default)] shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider flex items-center gap-1">
              <TrendingUp className="w-4 h-4 text-[var(--brand-color)]" />
              Gross Billing Revenue Trend ({startDate && startDate === endDate ? "Hourly Breakdown" : "Daily Breakdown"})
            </h3>
            <span className="text-[10px] text-gray-400 font-semibold font-mono">VALUES IN {currencySymbol}</span>
          </div>

          <div className="h-64 w-full">
            {totalOrders === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-gray-400 font-semibold bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                No billing transactions to construct a trend in this date range.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={salesTrendChartData}>
                  <defs>
                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#004ac6" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#004ac6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e7f3" />
                  <XAxis dataKey="name" stroke="#505f76" fontSize={10} tickLine={false} />
                  <YAxis stroke="#505f76" fontSize={10} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ background: '#191b23', color: '#fff', borderRadius: '8px', fontSize: '11px' }}
                  />
                  <Area type="monotone" dataKey="Sales" stroke="#004ac6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorSales)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Payment Methods split (right 1/3) */}
        <div className="bg-[var(--color-bg-white)] p-5 rounded-xl border border-[var(--color-border-default)] shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider mb-4 flex items-center gap-1">
              <CreditCard className="w-4 h-4 text-[var(--brand-color)]" />
              Payment Method Breakdown
            </h3>
          </div>

          <div className="h-44 w-full flex items-center justify-center relative">
            {paymentChartData.length === 0 ? (
              <span className="text-xs text-gray-400">No transactions in this date range.</span>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {paymentChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `${currencySymbol}${value}`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Custom Legends list */}
          <div className="space-y-1.5 pt-3 border-t border-gray-100 text-[10px] text-gray-500 font-sans">
            {paymentChartData.length === 0 ? (
              <p className="text-center py-2 text-gray-400">Ledger empty</p>
            ) : (
              paymentChartData.map((item, idx) => (
                <div key={item.name} className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5 font-medium">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                    <span>{item.name}</span>
                  </div>
                  <strong className="text-[var(--color-text-primary)] font-mono">{currencySymbol}{item.value.toFixed(2)}</strong>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* 4. Top Dishes and Loyalty Points Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Top items leaderboard */}
        <div className="bg-[var(--color-bg-white)] p-5 rounded-xl border border-[var(--color-border-default)] shadow-sm">
          <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider mb-4 flex items-center gap-1.5">
            <ArrowUpRight className="w-4.5 h-4.5 text-[var(--brand-color)]" />
            Fast-Selling Dishes (Leaderboard)
          </h3>

          <div className="space-y-3">
            {topSellingProducts.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                No items sold in the current date range filter.
              </div>
            ) : (
              topSellingProducts.map((p, idx) => (
                <div key={idx} className="flex justify-between items-center bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-[var(--color-primary-light)] text-[var(--brand-color)] border border-[var(--color-border-input)] flex items-center justify-center font-bold font-mono text-xs shadow-sm">
                      #{idx + 1}
                    </span>
                    <div>
                      <strong className="text-xs text-[var(--color-text-primary)] block leading-tight">{p.name}</strong>
                      <span className="text-[9px] text-gray-400 uppercase tracking-wider block mt-0.5">{p.category}</span>
                    </div>
                  </div>
                  <strong className="text-xs font-mono text-[var(--brand-color)] bg-blue-50 px-2.5 py-0.5 rounded-md">
                    {p.qty} portions sold
                  </strong>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Loyalty Program analytics */}
        <div className="bg-[var(--color-bg-white)] p-5 rounded-xl border border-[var(--color-border-default)] shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Award className="w-4.5 h-4.5 text-[var(--brand-color)]" />
              Loyalty Points Ledger Audit
            </h3>

            <div className="space-y-4">
              <div className="bg-amber-50/50 border border-amber-200/60 rounded-xl p-4 flex justify-between items-center">
                <div>
                  <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Points Accumulated</span>
                  <span className="text-xl font-bold text-amber-800 font-mono">+{totalPointsEarned} pts</span>
                  <p className="text-[9px] text-gray-500 mt-1 font-sans">Accumulated on registered ticket totals</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-md shadow-sm">
                  ★
                </div>
              </div>

              <div className="bg-green-50/50 border border-green-200/60 rounded-xl p-4 flex justify-between items-center">
                <div>
                  <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider block">Voucher Points Redeemed</span>
                  <span className="text-xl font-bold text-green-800 font-mono">-{totalPointsRedeemed} pts</span>
                  <p className="text-[9px] text-gray-500 mt-1 font-sans">Points redeemed for flat/percentage discounts</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-md shadow-sm">
                  ✔
                </div>
              </div>
            </div>
          </div>

          <div className="text-[10px] text-gray-400 text-center mt-4">
            Reports computed server-side by the backend reporting engine.
          </div>
        </div>

      </div>

      {/* ===== ANALYTICS SECTION: Peak Hours + Category Performance ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Peak Hours */}
        <div className="lg:col-span-2 bg-[var(--color-bg-white)] p-5 rounded-xl border border-[var(--color-border-default)] shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-amber-500" />
            <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">Peak Hours</h3>
            {peakHour.orders > 0 && (
              <span className="text-[9px] text-amber-600 font-bold ml-auto">{peakHour.hour} busiest</span>
            )}
          </div>
          {peakHoursData.some(d => d.orders > 0) ? (
            <>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={peakHoursData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="hour" tick={{ fontSize: 8 }} tickFormatter={v => v.slice(0, 2)} stroke="#9ca3af" />
                    <YAxis tick={{ fontSize: 9 }} stroke="#9ca3af" />
                    <Tooltip contentStyle={{ background: '#1f2937', color: '#fff', borderRadius: '8px', fontSize: '11px', border: 'none' }}
                      formatter={(value: number) => [`${value} orders`, 'Orders']} />
                    <Bar dataKey="orders" radius={[3, 3, 0, 0]}>
                      {peakHoursData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.orders === peakHour.orders ? '#f59e0b' : '#fcd34d'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 text-center text-[8px] text-gray-400">
                <div className="p-1.5 rounded-lg bg-amber-50"><Sunrise className="w-3 h-3 mx-auto text-amber-500 mb-0.5" />Morning<br/>{peakHoursData.filter(d => parseInt(d.hour) < 12).reduce((s, d) => s + d.orders, 0)}</div>
                <div className="p-1.5 rounded-lg bg-yellow-50"><Sun className="w-3 h-3 mx-auto text-yellow-500 mb-0.5" />Noon<br/>{peakHoursData.filter(d => parseInt(d.hour) >= 12 && parseInt(d.hour) < 16).reduce((s, d) => s + d.orders, 0)}</div>
                <div className="p-1.5 rounded-lg bg-orange-50"><Sunset className="w-3 h-3 mx-auto text-orange-500 mb-0.5" />Eve<br/>{peakHoursData.filter(d => parseInt(d.hour) >= 16 && parseInt(d.hour) < 20).reduce((s, d) => s + d.orders, 0)}</div>
                <div className="p-1.5 rounded-lg bg-indigo-50"><Moon className="w-3 h-3 mx-auto text-indigo-500 mb-0.5" />Night<br/>{peakHoursData.filter(d => parseInt(d.hour) >= 20).reduce((s, d) => s + d.orders, 0)}</div>
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-xs text-gray-400">No hourly data in this range</div>
          )}
        </div>

        {/* Order Type Distribution */}
        <div className="bg-[var(--color-bg-white)] p-5 rounded-xl border border-[var(--color-border-default)] shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <ShoppingBag className="w-4 h-4 text-purple-500" />
            <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">Order Channels</h3>
          </div>
          {orderTypeData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-xs text-gray-400">No orders</div>
          ) : (
            <div className="space-y-3">
              {orderTypeData.map((ot, idx) => {
                const pct = totalOrders > 0 ? (ot.value / totalOrders) * 100 : 0;
                return (
                  <div key={ot.name} className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className="font-bold text-gray-700">{ot.name}</span>
                        <span className="font-mono text-gray-500">{ot.value} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: ['#004ac6','#10b981','#f59e0b','#ec4899','#8b5cf6','#06b6d4','#f97316'][idx % 7] }} />
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-gray-100 flex justify-between text-[9px] text-gray-400">
                <span>Total orders</span>
                <span className="font-bold text-gray-700">{totalOrders}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== ANALYTICS SECTION: Category Performance + Cashier Performance ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Performance */}
        <div className="bg-[var(--color-bg-white)] p-5 rounded-xl border border-[var(--color-border-default)] shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-4 h-4 text-indigo-500" />
            <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">Category Performance</h3>
            <span className="text-[9px] text-gray-400 ml-auto">{categoryData.length} categories</span>
          </div>
          {categoryData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-xs text-gray-400">No data</div>
          ) : (
            <div className="space-y-3">
              {categoryData.map((cat, idx) => {
                const maxRev = categoryData[0].revenue || 1;
                const barWidth = (cat.revenue / maxRev) * 100;
                const colors = ['#004ac6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316'];
                return (
                  <div key={cat.name} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-black text-indigo-600 bg-indigo-50 shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className="font-bold text-gray-800 truncate">{cat.name}</span>
                        <span className="font-mono text-gray-500 ml-2 shrink-0">{currencySymbol}{cat.revenue.toFixed(2)}</span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${barWidth}%`, background: colors[idx % colors.length] }} />
                      </div>
                    </div>
                    <span className="text-[9px] text-gray-400 w-8 text-right shrink-0">{cat.qty} pcs</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Cashier Performance */}
        {moduleSettings.showCashierPerformance !== false && (
          <div className="bg-[var(--color-bg-white)] p-5 rounded-xl border border-[var(--color-border-default)] shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-blue-500" />
              <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">Cashier Performance</h3>
              <span className="text-[9px] text-gray-400 ml-auto">{cashierData.length} cashiers</span>
            </div>
            {cashierData.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-xs text-gray-400">No cashier data</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 pr-3 font-bold text-gray-400">Rank</th>
                      <th className="text-left py-2 pr-3 font-bold text-gray-400">Cashier</th>
                      <th className="text-right py-2 pl-3 font-bold text-gray-400">Orders</th>
                      <th className="text-right py-2 pl-3 font-bold text-gray-400">Revenue</th>
                      <th className="text-right py-2 pl-3 font-bold text-gray-400">Avg/Order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {cashierData.map((c, idx) => (
                      <tr key={c.name} className="hover:bg-gray-50 transition-colors">
                        <td className="py-2 pr-3">
                          <span className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-black ${idx === 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{idx + 1}</span>
                        </td>
                        <td className="py-2 pr-3 font-bold text-gray-800">{c.name}</td>
                        <td className="py-2 pl-3 text-right font-mono font-semibold text-gray-700">{c.orders}</td>
                        <td className="py-2 pl-3 text-right font-mono font-bold text-gray-900">{currencySymbol}{c.revenue.toFixed(2)}</td>
                        <td className="py-2 pl-3 text-right font-mono text-gray-500">{c.orders > 0 ? `${currencySymbol}${(c.revenue / c.orders).toFixed(2)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* Slow Movers inline */}
            {slowMovers.length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                  <h4 className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Slow Movers</h4>
                </div>
                <div className="space-y-1">
                  {slowMovers.map(item => (
                    <div key={item.name} className="flex items-center justify-between px-2 py-1 rounded bg-red-50 border border-red-100">
                      <span className="text-[9px] font-semibold text-gray-700 truncate flex-1">{item.name}</span>
                      <span className="text-[9px] font-mono text-red-500 font-bold ml-2">{item.qty} sold</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== ANALYTICS SECTION: Period-over-Period Comparison ===== */}
      {startDate && endDate && (
        <div className="bg-[var(--color-bg-white)] p-5 rounded-xl border border-[var(--color-border-default)] shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-indigo-500" />
            <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">Period vs Previous Period</h3>
            <span className="text-[9px] text-gray-400 ml-auto">{startDate} → {endDate} vs {prevStartStr} → {prevEndStr}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 pr-4 font-bold text-gray-400">Metric</th>
                  <th className="text-right py-2 px-3 font-bold text-gray-400">Current</th>
                  <th className="text-right py-2 px-3 font-bold text-gray-400">Previous</th>
                  <th className="text-right py-2 pl-3 font-bold text-gray-400">Change</th>
                  <th className="text-right py-2 pl-3 font-bold text-gray-400">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[
                  { label: 'Revenue', current: totalRevenue, previous: prevRevenue },
                  { label: 'Orders', current: totalOrders, previous: prevOrders },
                  { label: 'Avg Order Value', current: avgOrderValue, previous: prevOrders > 0 ? prevRevenue / prevOrders : 0 },
                ].map(row => {
                  const change = pctChange(row.current, row.previous);
                  return (
                    <tr key={row.label} className="hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 pr-4 font-bold text-gray-800">{row.label}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-gray-900">
                        {row.label === 'Orders' ? row.current.toLocaleString() : `${currencySymbol}${row.current.toFixed(2)}`}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-gray-500">
                        {row.label === 'Orders' ? row.previous.toLocaleString() : `${currencySymbol}${row.previous.toFixed(2)}`}
                      </td>
                      <td className={`py-2.5 pl-3 text-right font-mono font-bold ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
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
      )}

      {/* 5. Receipts & Bills Ledger Section */}
      <div className="bg-[var(--color-bg-white)] p-5 rounded-xl border border-[var(--color-border-default)] shadow-sm space-y-4">
        
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div className="flex items-center justify-between xl:justify-start gap-4 w-full xl:w-auto">
            <div>
              <h3 className="font-bold text-[var(--color-text-primary)] text-sm uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-4.5 h-4.5 text-[var(--brand-color)]" />
                Receipts & Bills Ledger
              </h3>
              <p className="text-[10px] text-gray-500 mt-0.5">
                Detailed list of matching transactions. By default, only displaying today's receipts.
              </p>
            </div>
            <button
              onClick={exportToCSV}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-bg-white)] border border-[var(--color-border-input)] hover:border-[var(--brand-color)] text-gray-700 hover:text-[var(--brand-color)] text-xs font-bold rounded-lg transition-all cursor-pointer shadow-sm shrink-0 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
            {/* Search Input */}
            <div className="relative flex-1 md:w-64 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search invoice, cashier, guest..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)]"
              />
            </div>

            {/* Payment Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400 uppercase shrink-0">Payment:</span>
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="px-2 py-1.5 border border-[var(--color-border-input)] rounded-lg text-xs font-bold text-gray-700 bg-[var(--color-bg-white)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] cursor-pointer"
              >
                <option value="All">All Modes</option>
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Card">Card</option>
                <option value="Wallet">Wallet</option>
                <option value="Split">Split</option>
              </select>
            </div>

            {/* Channel Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400 uppercase shrink-0">Channel:</span>
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="px-2 py-1.5 border border-[var(--color-border-input)] rounded-lg text-xs font-bold text-gray-700 bg-[var(--color-bg-white)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] cursor-pointer"
              >
                <option value="All">All Channels</option>
                <option value="Dine In">Dine In</option>
                <option value="Takeaway">Takeaway</option>
                <option value="Delivery">Delivery</option>
                <option value="Swiggy">Swiggy</option>
                <option value="Zomato">Zomato</option>
                <option value="Uber Eats">Uber Eats</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        </div>

        {/* Datatable */}
        <div className="overflow-x-auto border border-[var(--color-border-default)] rounded-xl">
          <table className="w-full text-left border-collapse min-w-[850px]">
            <thead>
              <tr className="bg-gray-50 border-b border-[var(--color-border-default)] text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                <th className="p-3 pl-4">Invoice No</th>
                <th className="p-3">Ticket No</th>
                <th className="p-3">Date & Time</th>
                <th className="p-3">Channel</th>
                <th className="p-3">Cashier</th>
                <th className="p-3">Customer Profile</th>
                <th className="p-3 text-center">Items Count</th>
                <th className="p-3 text-right">Subtotal</th>
                <th className="p-3 text-right">Discount</th>
                <th className="p-3 text-right font-bold text-gray-900">Net Total</th>
                <th className="p-3">Settlement</th>
                <th className="p-3 text-center pr-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs text-gray-700 bg-[var(--color-bg-white)]">
              {ledgerBills.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-12 text-center text-gray-400 font-semibold">
                    <p className="text-sm">No transaction bills found matching the selected criteria.</p>
                    <p className="text-[10px] text-gray-400 font-normal mt-1">Adjust dates, clear search parameters, or complete new client purchases in the Billing room.</p>
                    {(startDate !== todayStr || endDate !== todayStr || searchQuery !== '' || paymentFilter !== 'All' || channelFilter !== 'All') && (
                      <button
                        type="button"
                        onClick={() => {
                          setStartDate(todayStr);
                          setEndDate(todayStr);
                          setSearchQuery('');
                          setPaymentFilter('All');
                          setChannelFilter('All');
                        }}
                        className="mt-3 px-3 py-1.5 bg-[var(--color-primary-light)] text-[var(--brand-color)] border border-[var(--color-border-input)] hover:bg-[var(--color-surface-muted)] text-xs font-bold rounded-lg cursor-pointer inline-flex items-center gap-1 transition-all"
                      >
                        Reset to Today's Default
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedBills.map((bill) => (
                  <tr key={bill.id} className="hover:bg-gray-50 transition-colors">
                    <td className="p-3 pl-4 font-mono font-bold text-[var(--brand-color)]">
                      {bill.invoiceNumber}
                    </td>
                    <td className="p-3 font-mono font-bold text-gray-700">
                      {bill.ticketNumber}
                    </td>
                    <td className="p-3">
                      <span className="block font-semibold">{bill.date}</span>
                      <span className="block text-[10px] text-gray-400 font-mono mt-0.5">{bill.time}</span>
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--color-bg-page)] border border-[var(--color-border-input)] text-gray-700">
                        {bill.orderType}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="font-semibold block text-gray-900">{bill.cashierName}</span>
                      <span className="text-[9px] text-gray-400 uppercase tracking-wider block">{bill.cashierRole}</span>
                    </td>
                    <td className="p-3">
                      {bill.customerName ? (
                        <div>
                          <span className="font-semibold block text-gray-900">{bill.customerName}</span>
                          <span className="text-[10px] text-gray-400 font-mono block">{bill.customerPhone}</span>
                        </div>
                      ) : (
                        <span className="text-gray-400 font-medium">Guest Diner</span>
                      )}
                    </td>
                    <td className="p-3 text-center font-mono font-bold text-gray-700">
                      {bill.items.reduce((sum, item) => sum + item.quantity, 0)}
                    </td>
                    <td className="p-3 text-right font-mono text-gray-500">
                      {currencySymbol}{bill.subtotal.toFixed(2)}
                    </td>
                    <td className="p-3 text-right font-mono text-red-500 font-semibold">
                      {bill.discount > 0 ? `-${currencySymbol}${bill.discount.toFixed(2)}` : '—'}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-gray-900">
                      {currencySymbol}{bill.grandTotal.toFixed(2)}
                    </td>
                    <td className="p-3">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-[var(--brand-color)] border border-blue-100 uppercase">
                        {bill.paymentMethod}
                      </span>
                    </td>
                    <td className="p-3 text-center pr-4">
                      {onViewBill ? (
                        <button
                          type="button"
                          onClick={() => onViewBill(bill)}
                          className="p-1.5 text-amber-700 hover:bg-amber-50 border border-amber-200 hover:border-amber-300 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1.5 font-bold text-[10px]"
                          title="Reprint this receipt"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Reprint
                        </button>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <div className="text-[10px] text-gray-500 font-medium">
            Showing <span className="font-bold text-gray-700">{paginatedBills.length}</span> of <span className="font-bold text-gray-700">{ledgerBills.length}</span> receipts
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="px-3 py-1.5 text-[10px] font-bold rounded-lg border border-[var(--color-border-input)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-all cursor-pointer"
            >
              Previous
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (safePage <= 4) {
                pageNum = i + 1;
              } else if (safePage >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                pageNum = safePage - 3 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                    safePage === pageNum
                      ? 'bg-[var(--brand-color)] text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="px-3 py-1.5 text-[10px] font-bold rounded-lg border border-[var(--color-border-input)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-all cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

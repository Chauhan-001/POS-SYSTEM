/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReportsManager — Modernized, sectioned Reports workspace:
 * - Segmented Navigation:
 *   1. 🧾 Invoices & Ledger (Default fast audit view)
 *   2. 📈 Sales & Trends
 *   3. 🍲 Menu & Categories
 *   4. 👥 Operations & Staff
 *   5. 👁️ All Reports (Panoramic view)
 * - Pinned Date Filter Strip & Presets
 * - High-density Ledger Datatable with Instant Reprint & CSV Export
 * - Period-over-period comparison & Recharts Visualizations
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import {
  TrendingUp, ShoppingBag, CreditCard, Users, ArrowUpRight, Award,
  DollarSign, Calendar, Search, Eye, Filter, RotateCcw, FileText, CalendarDays, Download,
  RefreshCw, Clock, Activity, Layers, TrendingDown, Printer,
  Sun, Moon, Sunrise, Sunset, ArrowDownRight, Minus, ChevronRight, CheckCircle, Flame
} from 'lucide-react';
import { Bill, Customer, Product } from '../src/types';
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

type ReportsTab = 'ledger' | 'sales' | 'menu' | 'operations' | 'all';

const COLORS = ['#004ac6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316'];

export default function ReportsManager({
  bills, customers, products, currencySymbol,
  moduleSettings = {} as Record<string, boolean>,
  onViewBill, onRefresh
}: ReportsManagerProps) {
  // Active Tab state
  const [activeTab, setActiveTab] = useState<ReportsTab>('ledger');

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
          if (onRefresh) onRefresh();
          setLastRefreshed(new Date().toLocaleTimeString());
        }
      } catch {
        // Silently fail if localStorage is unavailable
      }
    }, 10000);

    return () => clearInterval(intervalId);
  }, [isAutoRefresh, onRefresh]);

  // Update hash and timestamp when the bills prop changes from parent
  useEffect(() => {
    setLastRefreshed(new Date().toLocaleTimeString());
    billsHashRef.current = getBillsHash(bills);
  }, [bills]);

  // Date String Helpers
  const getTodayString = () => new Date().toISOString().split('T')[0];
  const getYesterdayString = () => new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const getSevenDaysAgoString = () => new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const getThirtyDaysAgoString = () => new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const todayStr = getTodayString();

  // Date Filter states - default to last 7 days
  const [startDate, setStartDate] = useState<string>(getSevenDaysAgoString());
  const [endDate, setEndDate] = useState<string>(todayStr);

  // List search & secondary filters states
  const [searchQuery, setSearchQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>('All');
  const [channelFilter, setChannelFilter] = useState<string>('All');

  // Handle Preset Ranges
  const handlePreset = (preset: 'Today' | 'Yesterday' | 'ThisWeek' | 'ThisMonth' | 'AllTime') => {
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
    } else if (preset === 'ThisMonth') {
      setStartDate(getThirtyDaysAgoString());
      setEndDate(todayStr);
    } else if (preset === 'AllTime') {
      setStartDate('');
      setEndDate('');
    }
  };

  // Backend report fetch + cache
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

  // 1. Filter raw bills by Date Range (used for ledger table + offline fallback)
  const dateFilteredBills = bills.filter(bill => {
    if (startDate && bill.date < startDate) return false;
    if (endDate && bill.date > endDate) return false;
    return true;
  });

  // Local estimates fallback
  const localTotalRevenue = dateFilteredBills.reduce((sum, b) => sum + b.grandTotal, 0);
  const localTotalOrders = dateFilteredBills.length;
  const localAvgOrderValue = localTotalOrders > 0 ? localTotalRevenue / localTotalOrders : 0;
  const localTotalPointsRedeemed = dateFilteredBills.reduce((sum, b) => sum + b.pointsRedeemed, 0);
  const localTotalPointsEarned = dateFilteredBills.reduce((sum, b) => sum + b.pointsEarned, 0);

  const localTrendChartData = (() => {
    if (dateFilteredBills.length === 0) {
      return [{ name: 'No Data', Sales: 0, Orders: 0 }];
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

  // Data selection
  const summary = report?.summary ?? null;
  const productCategoryMap = new Map<string, string>();
  products.forEach(p => { if (p.name) productCategoryMap.set(p.name, p.category); });

  const totalRevenue = summary ? summary.summary.netSales : localTotalRevenue;
  const totalOrders = summary ? summary.summary.orders : localTotalOrders;
  const avgOrderValue = summary ? summary.summary.averageOrderValue : localAvgOrderValue;
  const totalPointsRedeemed = summary ? summary.summary.pointsRedeemed : localTotalPointsRedeemed;
  const totalPointsEarned = summary ? summary.summary.pointsEarned : localTotalPointsEarned;

  const repeatGuests = customers.filter(c => c.visits >= 2).length;
  const repeatGuestRate = customers.length > 0 ? (repeatGuests / customers.length) * 100 : 0;

  const salesTrendChartData = report?.trend != null
    ? report.trend.map(p => ({ name: p.date || p.name || '', Sales: p.revenue, Orders: p.orders }))
    : localTrendChartData;

  const paymentChartData = report?.payments != null
    ? report.payments.map(p => ({ name: p.method, value: p.amount }))
    : localPaymentChartData;

  const topSellingProducts = report?.topProducts != null
    ? report.topProducts.slice(0, 5).map(p => ({
        name: p.name,
        qty: p.qty,
        category: productCategoryMap.get(p.name) || 'Uncategorized'
      }))
    : localTopSellingProducts;

  const prevRevenue = summary ? summary.comparison.previousNetRevenue : localPrevRevenue;
  const prevOrders = summary ? summary.comparison.previousOrders : localPrevOrders;

  const pctChange = (current: number, previous: number): number => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  const peakHoursData = report?.peakHours != null ? report.peakHours : localPeakHoursData;
  const peakHour = report?.peakHours != null && report.peakHours.length > 0
    ? report.peakHours.reduce((max, d) => d.orders > max.orders ? d : max, report.peakHours[0])
    : peakHoursData.reduce((max, d) => d.orders > max.orders ? d : max, peakHoursData[0] || { hour: '', orders: 0, revenue: 0 });

  const categoryData = report?.categories != null
    ? report.categories.map(c => ({ name: c.category, qty: c.qty, revenue: c.revenue }))
    : localCategoryData;

  const cashierData = report?.cashiers != null
    ? report.cashiers.map(c => ({ name: c.cashier, orders: c.orders, revenue: c.revenue, items: c.itemsSold }))
    : localCashierData;

  const orderTypeData = report?.orderTypes != null
    ? report.orderTypes.map(o => ({ name: o.type, value: o.count }))
    : localOrderTypeData;

  const slowMovers = report?.leastProducts != null
    ? report.leastProducts.map(p => ({ name: p.name, qty: p.qty }))
    : localSlowMovers;

  // Ledger Filtered List
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

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(ledgerBills.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedBills = ledgerBills.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [startDate, endDate, searchQuery, paymentFilter, channelFilter]);

  // CSV Export
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
      // fallback
    } finally {
      setExporting(false);
    }

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

  const ledgerTotalAmount = ledgerBills.reduce((s, b) => s + b.grandTotal, 0);
  const ledgerTotalDiscounts = ledgerBills.reduce((s, b) => s + b.discount, 0);

  return (
    <div id="reports_workspace" className="p-4 md:p-6 h-full overflow-y-auto space-y-5 font-sans pb-12 max-w-7xl mx-auto w-full">

      {/* ========================================================================= */}
      {/* 1. HEADER & DATE FILTER STRIP (PINNED ON TOP)                             */}
      {/* ========================================================================= */}
      <div className="bg-[var(--color-bg-white)] p-4 sm:p-5 rounded-2xl border border-[var(--color-border-default)] shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black text-[var(--color-text-primary)] tracking-tight">
                Executive Reports & Analytics
              </h1>
              <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Auto-sync</span>
                <span className="text-emerald-600 font-mono">| {lastRefreshed}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (onRefresh) onRefresh();
                    setRefreshTick(t => t + 1);
                    setLastRefreshed(new Date().toLocaleTimeString());
                  }}
                  className="p-0.5 rounded hover:bg-emerald-100 transition-colors cursor-pointer"
                  title="Refresh now"
                >
                  <RefreshCw className="w-3 h-3 text-emerald-600" />
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Authoritative sales ledgers, period comparisons, dish revenue, and cashier audit.
            </p>
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 bg-gray-100/80 p-1 rounded-xl border border-[var(--color-border-default)] shrink-0 select-none">
            {[
              { id: 'Today', label: "Today" },
              { id: 'Yesterday', label: 'Yesterday' },
              { id: 'ThisWeek', label: 'Last 7 Days' },
              { id: 'ThisMonth', label: 'Last 30 Days' },
              { id: 'AllTime', label: 'All Time' }
            ].map((preset) => {
              const isSelected =
                (preset.id === 'Today' && startDate === todayStr && endDate === todayStr) ||
                (preset.id === 'Yesterday' && startDate === getYesterdayString() && endDate === getYesterdayString()) ||
                (preset.id === 'ThisWeek' && startDate === getSevenDaysAgoString() && endDate === todayStr) ||
                (preset.id === 'ThisMonth' && startDate === getThirtyDaysAgoString() && endDate === todayStr) ||
                (preset.id === 'AllTime' && startDate === '' && endDate === '');

              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePreset(preset.id as any)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--brand-color)] text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

        </div>

        {/* Custom Date Range Selector */}
        <div className="pt-3 border-t border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-gray-500 font-semibold">
            <Calendar className="w-4 h-4 text-[var(--brand-color)]" />
            <span>Active Range:</span>
            <span className="font-mono text-gray-800 font-bold bg-gray-100 px-2 py-0.5 rounded-md">
              {startDate || 'Beginning'} → {endDate || 'Latest'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400 uppercase">From:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2.5 py-1 border border-[var(--color-border-input)] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] bg-[var(--color-bg-white)] cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400 uppercase">To:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2.5 py-1 border border-[var(--color-border-input)] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] bg-[var(--color-bg-white)] cursor-pointer"
              />
            </div>
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="px-2 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Helper notice if range yields no results */}
      {startDate === todayStr && endDate === todayStr && totalOrders === 0 && (
        <div className="bg-blue-50/70 border border-blue-200/80 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-start gap-2.5">
            <CalendarDays className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-blue-900">No transactions recorded for today ({todayStr}) yet.</p>
              <p className="text-[11px] text-blue-700 mt-0.5">Switch to previous days or pre-seeded transaction histories to view analytics.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handlePreset('ThisWeek')}
            className="px-3 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs cursor-pointer transition-all shrink-0"
          >
            Show Last 7 Days
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. SECTION NAVIGATOR / SEGMENTED CONTROLLER (DECLUTTERING ENGINE)           */}
      {/* ========================================================================= */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-default)] pb-2 flex-wrap">
        <div className="flex items-center gap-1.5 bg-gray-100/80 p-1 rounded-xl border border-[var(--color-border-default)] select-none">
          <button
            onClick={() => setActiveTab('ledger')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'ledger'
                ? 'bg-[var(--brand-color)] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Invoices & Ledger</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              activeTab === 'ledger' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'
            }`}>
              {ledgerBills.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('sales')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'sales'
                ? 'bg-[var(--brand-color)] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Sales Trends</span>
          </button>

          <button
            onClick={() => setActiveTab('menu')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'menu'
                ? 'bg-[var(--brand-color)] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Menu & Dishes</span>
          </button>

          <button
            onClick={() => setActiveTab('operations')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'operations'
                ? 'bg-[var(--brand-color)] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Staff & Rush</span>
          </button>

          <button
            onClick={() => setActiveTab('all')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'all'
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
          {activeTab === 'ledger' && 'Receipts Ledger: search, reprint, export & audit bills'}
          {activeTab === 'sales' && 'Sales Trends: revenue area charts & payment modes'}
          {activeTab === 'menu' && 'Menu Breakdown: top selling dishes & category shares'}
          {activeTab === 'operations' && 'Operational Audit: peak rush hours & cashier rankings'}
          {activeTab === 'all' && 'Comprehensive report: complete executive summary'}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: RECEIPTS & BILLS LEDGER (HIGH FREQUENCY OPERATIONAL VIEW)          */}
      {/* ========================================================================= */}
      {(activeTab === 'ledger' || activeTab === 'all') && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-4"
        >
          {activeTab === 'all' && (
            <div className="flex items-center gap-2 pt-2">
              <FileText className="w-4 h-4 text-[var(--brand-color)]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700">1. Receipts & Bills Ledger</h2>
            </div>
          )}

          {/* Quick Ledger Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[var(--color-bg-white)] p-3.5 rounded-2xl border border-[var(--color-border-default)] shadow-xs">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Invoices Billed</span>
              <p className="text-xl font-black text-gray-900 font-mono mt-0.5">{ledgerBills.length}</p>
              <span className="text-[10px] text-gray-500 font-medium">Matching range</span>
            </div>
            <div className="bg-[var(--color-bg-white)] p-3.5 rounded-2xl border border-[var(--color-border-default)] shadow-xs">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Net Revenue</span>
              <p className="text-xl font-black text-emerald-700 font-mono mt-0.5">{currencySymbol}{ledgerTotalAmount.toFixed(2)}</p>
              <span className="text-[10px] text-emerald-600 font-medium">Settled tickets</span>
            </div>
            <div className="bg-[var(--color-bg-white)] p-3.5 rounded-2xl border border-[var(--color-border-default)] shadow-xs">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Total Discounts</span>
              <p className="text-xl font-black text-rose-600 font-mono mt-0.5">{currencySymbol}{ledgerTotalDiscounts.toFixed(2)}</p>
              <span className="text-[10px] text-gray-500 font-medium">Vouchers & offers</span>
            </div>
            <div className="bg-[var(--color-bg-white)] p-3.5 rounded-2xl border border-[var(--color-border-default)] shadow-xs">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Average Ticket</span>
              <p className="text-xl font-black text-[var(--brand-color)] font-mono mt-0.5">
                {currencySymbol}{ledgerBills.length > 0 ? (ledgerTotalAmount / ledgerBills.length).toFixed(2) : '0.00'}
              </p>
              <span className="text-[10px] text-gray-500 font-medium">Per checkout</span>
            </div>
          </div>

          {/* Ledger Table Container */}
          <div className="bg-[var(--color-bg-white)] p-4 sm:p-5 rounded-2xl border border-[var(--color-border-default)] shadow-xs space-y-4">
            
            {/* Filter & Search Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search invoice #, cashier, customer, phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-[var(--color-border-input)] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] bg-gray-50/50"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Payment filter */}
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Payment:</span>
                  <select
                    value={paymentFilter}
                    onChange={(e) => setPaymentFilter(e.target.value)}
                    className="px-2.5 py-1.5 border border-[var(--color-border-input)] rounded-xl text-xs font-bold text-gray-700 bg-[var(--color-bg-white)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] cursor-pointer"
                  >
                    <option value="All">All Modes</option>
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="Card">Card</option>
                    <option value="Wallet">Wallet</option>
                    <option value="Split">Split</option>
                  </select>
                </div>

                {/* Channel filter */}
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Channel:</span>
                  <select
                    value={channelFilter}
                    onChange={(e) => setChannelFilter(e.target.value)}
                    className="px-2.5 py-1.5 border border-[var(--color-border-input)] rounded-xl text-xs font-bold text-gray-700 bg-[var(--color-bg-white)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] cursor-pointer"
                  >
                    <option value="All">All Channels</option>
                    <option value="Dine In">Dine In</option>
                    <option value="Takeaway">Takeaway</option>
                    <option value="Delivery">Delivery</option>
                    <option value="Swiggy">Swiggy</option>
                    <option value="Zomato">Zomato</option>
                    <option value="Uber Eats">Uber Eats</option>
                  </select>
                </div>

                {/* Export CSV button */}
                <button
                  onClick={exportToCSV}
                  disabled={exporting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 border border-[var(--color-border-input)] hover:border-[var(--brand-color)] text-gray-700 hover:text-[var(--brand-color)] text-xs font-bold rounded-xl transition-all cursor-pointer shadow-xs disabled:opacity-50 shrink-0 ml-auto lg:ml-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
                </button>
              </div>
            </div>

            {/* Datatable */}
            <div className="overflow-x-auto border border-[var(--color-border-default)] rounded-xl">
              <table className="w-full text-left border-collapse min-w-[880px]">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-[var(--color-border-default)] text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    <th className="p-3 pl-4">Invoice #</th>
                    <th className="p-3">Ticket</th>
                    <th className="p-3">Date & Time</th>
                    <th className="p-3">Channel</th>
                    <th className="p-3">Cashier</th>
                    <th className="p-3">Customer Profile</th>
                    <th className="p-3 text-center">Items</th>
                    <th className="p-3 text-right">Subtotal</th>
                    <th className="p-3 text-right">Discount</th>
                    <th className="p-3 text-right font-black text-gray-900">Net Total</th>
                    <th className="p-3">Payment</th>
                    <th className="p-3 text-center pr-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs text-gray-700 bg-[var(--color-bg-white)]">
                  {ledgerBills.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="p-12 text-center text-gray-400">
                        <FileText className="w-8 h-8 mx-auto mb-2 opacity-40 text-gray-400" />
                        <p className="text-sm font-bold text-gray-700">No bills found matching the selected filters.</p>
                        <p className="text-xs text-gray-400 mt-0.5">Try widening date ranges or resetting search terms.</p>
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
                            className="mt-3 px-3 py-1.5 bg-[var(--color-primary-light)] text-[var(--brand-color)] border border-[var(--color-border-input)] rounded-xl text-xs font-bold cursor-pointer inline-flex items-center gap-1 transition-all"
                          >
                            Reset to Today
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    paginatedBills.map((bill) => (
                      <tr key={bill.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="p-3 pl-4 font-mono font-bold text-[var(--brand-color)]">
                          {bill.invoiceNumber}
                        </td>
                        <td className="p-3 font-mono font-semibold text-gray-700">
                          {bill.ticketNumber}
                        </td>
                        <td className="p-3">
                          <span className="font-semibold block">{bill.date}</span>
                          <span className="text-[10px] text-gray-400 font-mono block mt-0.5">{bill.time}</span>
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-gray-100 border border-gray-200 text-gray-700">
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
                        <td className="p-3 text-right font-mono text-rose-600 font-semibold">
                          {bill.discount > 0 ? `-${currencySymbol}${bill.discount.toFixed(2)}` : '—'}
                        </td>
                        <td className="p-3 text-right font-mono font-black text-gray-900">
                          {currencySymbol}{bill.grandTotal.toFixed(2)}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-[var(--brand-color)] border border-blue-100 uppercase">
                            {bill.paymentMethod}
                          </span>
                        </td>
                        <td className="p-3 text-center pr-4">
                          {onViewBill ? (
                            <button
                              type="button"
                              onClick={() => onViewBill(bill)}
                              className="px-2.5 py-1 text-amber-700 hover:bg-amber-50 border border-amber-200 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1 font-bold text-[11px] shadow-2xs"
                              title="Reprint receipt ticket"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Reprint</span>
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

            {/* Pagination Strip */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-gray-100 text-xs">
              <div className="text-gray-500 font-medium">
                Showing <strong className="text-gray-900">{paginatedBills.length}</strong> of <strong className="text-gray-900">{ledgerBills.length}</strong> bills
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--color-border-input)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-all cursor-pointer"
                >
                  Previous
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) pageNum = i + 1;
                  else if (safePage <= 3) pageNum = i + 1;
                  else if (safePage >= totalPages - 2) pageNum = totalPages - 4 + i;
                  else pageNum = safePage - 2 + i;

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-7 h-7 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        safePage === pageNum
                          ? 'bg-[var(--brand-color)] text-white shadow-xs'
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
                  className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--color-border-input)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-all cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>

          </div>
        </motion.div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: SALES TRENDS & REVENUE ANALYTICS                                   */}
      {/* ========================================================================= */}
      {(activeTab === 'sales' || activeTab === 'all') && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-4"
        >
          {activeTab === 'all' && (
            <div className="flex items-center gap-2 pt-2">
              <TrendingUp className="w-4 h-4 text-[var(--brand-color)]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700">2. Sales Trends & Payment Modes</h2>
            </div>
          )}

          {/* 4 Numerical Key Performance Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[var(--color-bg-white)] p-4 rounded-2xl border border-[var(--color-border-default)] shadow-xs flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-[var(--brand-color)] flex items-center justify-center shrink-0">
                <DollarSign className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block truncate">Gross Sales</span>
                <span className="text-xl font-black text-gray-900 font-mono block">{currencySymbol}{totalRevenue.toFixed(2)}</span>
                <span className="text-[10px] text-emerald-600 font-bold block">Range Aggregate</span>
              </div>
            </div>

            <div className="bg-[var(--color-bg-white)] p-4 rounded-2xl border border-[var(--color-border-default)] shadow-xs flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block truncate">Total Invoices</span>
                <span className="text-xl font-black text-gray-900 font-mono block">{totalOrders}</span>
                <span className="text-[10px] text-emerald-600 font-bold block">Tickets Settled</span>
              </div>
            </div>

            <div className="bg-[var(--color-bg-white)] p-4 rounded-2xl border border-[var(--color-border-default)] shadow-xs flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block truncate">Average Ticket</span>
                <span className="text-xl font-black text-gray-900 font-mono block">{currencySymbol}{avgOrderValue.toFixed(2)}</span>
                <span className="text-[10px] text-[var(--brand-color)] font-bold block">Avg Order Value</span>
              </div>
            </div>

            <div className="bg-[var(--color-bg-white)] p-4 rounded-2xl border border-[var(--color-border-default)] shadow-xs flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block truncate">Repeat Guest Rate</span>
                <span className="text-xl font-black text-gray-900 font-mono block">{repeatGuestRate.toFixed(1)}%</span>
                <span className="text-[10px] text-emerald-600 font-bold block">{repeatGuests} frequent diners</span>
              </div>
            </div>
          </div>

          {/* Area Sales Trend + Payment Modes Pie */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            
            {/* Sales Trend Area Chart (Left 2 cols) */}
            <div className="lg:col-span-2 bg-[var(--color-bg-white)] p-5 rounded-2xl border border-[var(--color-border-default)] shadow-xs flex flex-col justify-between">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-blue-50 text-[var(--brand-color)]">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">
                      Revenue Trend ({startDate && startDate === endDate ? "Hourly Breakdown" : "Daily Breakdown"})
                    </h3>
                    <p className="text-[11px] text-gray-400">Values plotted in {currencySymbol}</p>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold text-[var(--brand-color)] bg-blue-50 px-2.5 py-1 rounded-lg">
                  {currencySymbol}{totalRevenue.toFixed(2)}
                </span>
              </div>

              <div className="h-64 w-full">
                {totalOrders === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-gray-400 font-semibold bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                    No billing transactions found to construct trend.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={salesTrendChartData}>
                      <defs>
                        <linearGradient id="colorSalesTrend" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#004ac6" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#004ac6" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f5" />
                      <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} tickLine={false} />
                      <YAxis stroke="#9ca3af" fontSize={10} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: '#191b23', color: '#fff', borderRadius: '12px', fontSize: '11px', border: 'none' }}
                        formatter={(val: any) => [`${currencySymbol}${Number(val).toFixed(2)}`, 'Sales']}
                      />
                      <Area type="monotone" dataKey="Sales" stroke="#004ac6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorSalesTrend)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Payment Method Distribution Pie (Right 1 col) */}
            <div className="bg-[var(--color-bg-white)] p-5 rounded-2xl border border-[var(--color-border-default)] shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">
                      Payment Modes
                    </h3>
                    <p className="text-[11px] text-gray-400">Tender type split</p>
                  </div>
                </div>

                <div className="h-44 w-full flex items-center justify-center relative">
                  {paymentChartData.length === 0 ? (
                    <span className="text-xs text-gray-400">No transactions recorded</span>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={paymentChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={46}
                          outerRadius={68}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {paymentChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => `${currencySymbol}${Number(value).toFixed(2)}`} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Legends list */}
              <div className="space-y-2 pt-3 border-t border-gray-100 text-xs">
                {paymentChartData.map((item, idx) => (
                  <div key={item.name} className="flex justify-between items-center">
                    <div className="flex items-center gap-2 font-medium">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                      <span>{item.name}</span>
                    </div>
                    <strong className="text-gray-900 font-mono">{currencySymbol}{item.value.toFixed(2)}</strong>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Period-over-Period Comparative Table */}
          {startDate && endDate && (
            <div className="bg-[var(--color-bg-white)] p-5 rounded-2xl border border-[var(--color-border-default)] shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">
                      Period vs Preceding Period
                    </h3>
                    <p className="text-[11px] text-gray-400">
                      Comparing {startDate} → {endDate} against {prevStartStr} → {prevEndStr}
                    </p>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase">
                      <th className="text-left py-2.5 pr-4">Metric</th>
                      <th className="text-right py-2.5 px-3">Current Period</th>
                      <th className="text-right py-2.5 px-3">Previous Period</th>
                      <th className="text-right py-2.5 pl-3">Net Change</th>
                      <th className="text-right py-2.5 pl-3">Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[
                      { label: 'Revenue', current: totalRevenue, previous: prevRevenue },
                      { label: 'Orders Closed', current: totalOrders, previous: prevOrders },
                      { label: 'Average Ticket', current: avgOrderValue, previous: prevOrders > 0 ? prevRevenue / prevOrders : 0 },
                    ].map(row => {
                      const change = pctChange(row.current, row.previous);
                      return (
                        <tr key={row.label} className="hover:bg-gray-50 transition-colors">
                          <td className="py-2.5 pr-4 font-bold text-gray-800">{row.label}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-gray-900">
                            {row.label === 'Orders Closed' ? row.current.toLocaleString() : `${currencySymbol}${row.current.toFixed(2)}`}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-gray-500">
                            {row.label === 'Orders Closed' ? row.previous.toLocaleString() : `${currencySymbol}${row.previous.toFixed(2)}`}
                          </td>
                          <td className={`py-2.5 pl-3 text-right font-mono font-bold ${change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                          </td>
                          <td className="py-2.5 pl-3 text-right">
                            {change >= 5 ? <ArrowUpRight className="w-4 h-4 text-emerald-500 inline" /> :
                             change <= -5 ? <ArrowDownRight className="w-4 h-4 text-rose-500 inline" /> :
                             <Minus className="w-4 h-4 text-gray-400 inline" />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </motion.div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: MENU & CATEGORY BREAKDOWN                                          */}
      {/* ========================================================================= */}
      {(activeTab === 'menu' || activeTab === 'all') && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-4"
        >
          {activeTab === 'all' && (
            <div className="flex items-center gap-2 pt-2">
              <Layers className="w-4 h-4 text-[var(--brand-color)]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700">3. Menu & Category Sales</h2>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            
            {/* Top dishes leaderboard */}
            <div className="bg-[var(--color-bg-white)] p-5 rounded-2xl border border-[var(--color-border-default)] shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                      <Flame className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">
                        Fast-Selling Dishes
                      </h3>
                      <p className="text-[11px] text-gray-400">Ranked by portions served in active date range</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {topSellingProducts.length === 0 ? (
                    <div className="p-8 text-center text-xs text-gray-400 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                      No items sold in the current date range filter.
                    </div>
                  ) : (
                    topSellingProducts.map((p, idx) => (
                      <div key={idx} className="flex justify-between items-center p-3 rounded-xl bg-gray-50 hover:bg-gray-100/80 border border-gray-100 transition-colors">
                        <div className="flex items-center gap-3">
                          <span className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold font-mono text-xs ${
                            idx === 0 ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-700'
                          }`}>
                            #{idx + 1}
                          </span>
                          <div>
                            <strong className="text-xs text-gray-900 block leading-tight">{p.name}</strong>
                            <span className="text-[10px] text-gray-400 uppercase tracking-wider block mt-0.5">{p.category}</span>
                          </div>
                        </div>
                        <span className="text-xs font-mono font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200/60">
                          {p.qty} portions
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-400">
                Computed from bill line items aggregated server-side
              </div>
            </div>

            {/* Category Performance */}
            <div className="bg-[var(--color-bg-white)] p-5 rounded-2xl border border-[var(--color-border-default)] shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
                      <Layers className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">
                        Category Performance
                      </h3>
                      <p className="text-[11px] text-gray-400">Portions and revenue per food section</p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 font-mono font-semibold">{categoryData.length} categories</span>
                </div>

                {categoryData.length === 0 ? (
                  <div className="p-8 text-center text-xs text-gray-400">No category sales in this range</div>
                ) : (
                  <div className="space-y-3">
                    {categoryData.map((cat, idx) => {
                      const maxRev = categoryData[0].revenue || 1;
                      const barWidth = (cat.revenue / maxRev) * 100;
                      return (
                        <div key={cat.name} className="space-y-1">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-gray-800 truncate">{cat.name}</span>
                            <div className="flex items-center gap-2 font-mono">
                              <span className="text-[10px] text-gray-400">{cat.qty} pcs</span>
                              <strong className="text-gray-900">{currencySymbol}{cat.revenue.toFixed(2)}</strong>
                            </div>
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{ width: `${barWidth}%`, background: COLORS[idx % COLORS.length] }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-400">
                Sorted by highest grossing category
              </div>
            </div>

          </div>

          {/* Slow Movers Watchlist Card */}
          {slowMovers.length > 0 && (
            <div className="bg-[var(--color-bg-white)] p-5 rounded-2xl border border-[var(--color-border-default)] shadow-xs">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-2 rounded-xl bg-rose-50 text-rose-600">
                  <TrendingDown className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">
                    Slow Movers & Food Waste Watchlist
                  </h3>
                  <p className="text-[11px] text-gray-400">Dishes with minimal or trailing orders during this period</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                {slowMovers.map(item => (
                  <div key={item.name} className="p-3 rounded-xl bg-rose-50/50 border border-rose-100 flex flex-col justify-between">
                    <span className="text-xs font-bold text-gray-800 truncate">{item.name}</span>
                    <span className="text-xs font-mono font-bold text-rose-600 mt-2 block">{item.qty} portions sold</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </motion.div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: OPERATIONS & STAFF AUDIT                                           */}
      {/* ========================================================================= */}
      {(activeTab === 'operations' || activeTab === 'all') && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-4"
        >
          {activeTab === 'all' && (
            <div className="flex items-center gap-2 pt-2">
              <Clock className="w-4 h-4 text-[var(--brand-color)]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700">4. Operations, Peak Hours & Staff</h2>
            </div>
          )}

          {/* Peak Hours & Order Channels */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            
            {/* Peak Hours (Left 2 cols) */}
            <div className="lg:col-span-2 bg-[var(--color-bg-white)] p-5 rounded-2xl border border-[var(--color-border-default)] shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">
                        Peak Hours Analysis
                      </h3>
                      <p className="text-[11px] text-gray-400">Order load distribution by hour</p>
                    </div>
                  </div>
                  {peakHour.orders > 0 && (
                    <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">
                      {peakHour.hour} Busiest ({peakHour.orders} orders)
                    </span>
                  )}
                </div>

                {peakHoursData.some(d => d.orders > 0) ? (
                  <>
                    <div className="h-44 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={peakHoursData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f5" vertical={false} />
                          <XAxis dataKey="hour" tick={{ fontSize: 9 }} tickFormatter={v => v.slice(0, 2)} stroke="#9ca3af" />
                          <YAxis tick={{ fontSize: 9 }} stroke="#9ca3af" />
                          <Tooltip
                            contentStyle={{ background: '#1f2937', color: '#fff', borderRadius: '12px', fontSize: '11px', border: 'none' }}
                            formatter={(value: any) => [`${value} orders`, 'Volume']}
                          />
                          <Bar dataKey="orders" radius={[4, 4, 0, 0]}>
                            {peakHoursData.map((entry, idx) => (
                              <Cell key={idx} fill={entry.orders === peakHour.orders && entry.orders > 0 ? '#f59e0b' : '#fcd34d'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[10px]">
                      <div className="p-2 rounded-xl bg-amber-50/70 border border-amber-100">
                        <Sunrise className="w-3.5 h-3.5 mx-auto text-amber-500 mb-0.5" />
                        <span className="font-bold text-gray-700 block">Morning</span>
                        <strong className="text-gray-900 font-mono">{peakHoursData.filter(d => parseInt(d.hour) < 12).reduce((s, d) => s + d.orders, 0)}</strong>
                      </div>
                      <div className="p-2 rounded-xl bg-yellow-50/70 border border-yellow-100">
                        <Sun className="w-3.5 h-3.5 mx-auto text-yellow-500 mb-0.5" />
                        <span className="font-bold text-gray-700 block">Noon</span>
                        <strong className="text-gray-900 font-mono">{peakHoursData.filter(d => parseInt(d.hour) >= 12 && parseInt(d.hour) < 16).reduce((s, d) => s + d.orders, 0)}</strong>
                      </div>
                      <div className="p-2 rounded-xl bg-orange-50/70 border border-orange-100">
                        <Sunset className="w-3.5 h-3.5 mx-auto text-orange-500 mb-0.5" />
                        <span className="font-bold text-gray-700 block">Evening</span>
                        <strong className="text-gray-900 font-mono">{peakHoursData.filter(d => parseInt(d.hour) >= 16 && parseInt(d.hour) < 20).reduce((s, d) => s + d.orders, 0)}</strong>
                      </div>
                      <div className="p-2 rounded-xl bg-indigo-50/70 border border-indigo-100">
                        <Moon className="w-3.5 h-3.5 mx-auto text-indigo-500 mb-0.5" />
                        <span className="font-bold text-gray-700 block">Dinner / Late</span>
                        <strong className="text-gray-900 font-mono">{peakHoursData.filter(d => parseInt(d.hour) >= 20).reduce((s, d) => s + d.orders, 0)}</strong>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-44 flex items-center justify-center text-xs text-gray-400">No hourly data in this range</div>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
                Helps optimize kitchen shift prep and staff allocation
              </div>
            </div>

            {/* Order Channels Distribution (Right 1 col) */}
            <div className="bg-[var(--color-bg-white)] p-5 rounded-2xl border border-[var(--color-border-default)] shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
                    <ShoppingBag className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">
                      Order Channels
                    </h3>
                    <p className="text-[11px] text-gray-400">Fulfillment splits</p>
                  </div>
                </div>

                {orderTypeData.length === 0 ? (
                  <div className="h-44 flex items-center justify-center text-xs text-gray-400">No orders recorded</div>
                ) : (
                  <div className="space-y-3">
                    {orderTypeData.map((ot, idx) => {
                      const pct = totalOrders > 0 ? (ot.value / totalOrders) * 100 : 0;
                      return (
                        <div key={ot.name} className="space-y-1">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-gray-800">{ot.name}</span>
                            <div className="flex items-center gap-2 font-mono">
                              <span className="text-gray-900 font-semibold">{ot.value} orders</span>
                              <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.2 rounded">
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{ width: `${pct}%`, background: COLORS[idx % COLORS.length] }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-xs text-gray-500">
                <span>Total tickets:</span>
                <strong className="text-gray-900 font-mono">{totalOrders}</strong>
              </div>
            </div>

          </div>

          {/* Cashier Performance + Loyalty Ledger */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            
            {/* Cashier Performance Table */}
            {moduleSettings.showCashierPerformance !== false && (
              <div className="bg-[var(--color-bg-white)] p-5 rounded-2xl border border-[var(--color-border-default)] shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                        <Users className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">
                          Cashier Audit
                        </h3>
                        <p className="text-[11px] text-gray-400">Shift checkout volumes and totals</p>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 font-mono">{cashierData.length} staff</span>
                  </div>

                  {cashierData.length === 0 ? (
                    <div className="p-8 text-center text-xs text-gray-400">No cashier records in this range</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase">
                            <th className="text-left py-2 pr-3">Rank</th>
                            <th className="text-left py-2 pr-3">Cashier</th>
                            <th className="text-right py-2 px-3">Orders</th>
                            <th className="text-right py-2 px-3">Revenue</th>
                            <th className="text-right py-2 pl-3">Avg/Order</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {cashierData.map((c, idx) => (
                            <tr key={c.name} className="hover:bg-gray-50 transition-colors">
                              <td className="py-2.5 pr-3">
                                <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                                  idx === 0 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {idx + 1}
                                </span>
                              </td>
                              <td className="py-2.5 pr-3 font-bold text-gray-800">{c.name}</td>
                              <td className="py-2.5 px-3 text-right font-mono font-semibold text-gray-700">{c.orders}</td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-gray-900">{currencySymbol}{c.revenue.toFixed(2)}</td>
                              <td className="py-2.5 pl-3 text-right font-mono text-gray-500">
                                {c.orders > 0 ? `${currencySymbol}${(c.revenue / c.orders).toFixed(2)}` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-400">
                  Individual register logins tracked per transaction
                </div>
              </div>
            )}

            {/* Loyalty Ledger */}
            <div className="bg-[var(--color-bg-white)] p-5 rounded-2xl border border-[var(--color-border-default)] shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                    <Award className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[var(--color-text-primary)] text-xs uppercase tracking-wider">
                      Loyalty Ledger Audit
                    </h3>
                    <p className="text-[11px] text-gray-400">Customer points issuance vs redemption</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="bg-amber-50/60 border border-amber-200/60 rounded-xl p-4 flex justify-between items-center">
                    <div>
                      <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Points Issued</span>
                      <span className="text-xl font-black text-amber-800 font-mono mt-0.5">+{totalPointsEarned} pts</span>
                      <p className="text-[11px] text-gray-500 mt-1">Earned on registered customer billings</p>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-lg shadow-xs">
                      ★
                    </div>
                  </div>

                  <div className="bg-emerald-50/60 border border-emerald-200/60 rounded-xl p-4 flex justify-between items-center">
                    <div>
                      <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Points Redeemed</span>
                      <span className="text-xl font-black text-emerald-800 font-mono mt-0.5">-{totalPointsRedeemed} pts</span>
                      <p className="text-[11px] text-gray-500 mt-1">Claimed as bill discount vouchers</p>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-lg shadow-xs">
                      ✔
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-400">
                Audited against customer accounts and bill vouchers
              </div>
            </div>

          </div>

        </motion.div>
      )}

    </div>
  );
}

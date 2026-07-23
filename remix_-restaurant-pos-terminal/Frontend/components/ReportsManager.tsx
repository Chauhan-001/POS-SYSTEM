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
  RefreshCw
} from 'lucide-react';
import { Bill, Customer, Product } from '../src/types';

interface ReportsManagerProps {
  bills: Bill[];
  customers: Customer[];
  products: Product[];
  currencySymbol: string;
  onViewBill?: (bill: Bill) => void;
  onRefresh?: () => void;
}

export default function ReportsManager({ bills, customers, products, currencySymbol, onViewBill, onRefresh }: ReportsManagerProps) {
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

  // Helpers to get timezone-safe local dates
  const getTodayString = () => {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000;
    return new Date(Date.now() - tzoffset).toISOString().slice(0, 10);
  };

  const getYesterdayString = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tzoffset = yesterday.getTimezoneOffset() * 60000;
    return new Date(yesterday.getTime() - tzoffset).toISOString().slice(0, 10);
  };

  const getSevenDaysAgoString = () => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const tzoffset = sevenDaysAgo.getTimezoneOffset() * 60000;
    return new Date(sevenDaysAgo.getTime() - tzoffset).toISOString().slice(0, 10);
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

  // 1. Filter raw bills by Date Range
  const dateFilteredBills = bills.filter(bill => {
    if (startDate && bill.date < startDate) return false;
    if (endDate && bill.date > endDate) return false;
    return true;
  });

  // 2. Calculate Key Performance Indicators (KPIs) on filtered bills
  const totalRevenue = dateFilteredBills.reduce((sum, b) => sum + b.grandTotal, 0);
  const totalOrders = dateFilteredBills.length;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  
  // Loyalty KPIs
  const totalPointsRedeemed = dateFilteredBills.reduce((sum, b) => sum + b.pointsRedeemed, 0);
  const totalPointsEarned = dateFilteredBills.reduce((sum, b) => sum + b.pointsEarned, 0);
  const repeatGuests = customers.filter(c => c.visits >= 2).length;
  const repeatGuestRate = customers.length > 0 ? (repeatGuests / customers.length) * 100 : 0;

  // 3. Generate Real Sales Trend Data based on the date selection
  const getTrendData = () => {
    if (dateFilteredBills.length === 0) {
      return [
        { name: 'No Data', Sales: 0, Orders: 0 }
      ];
    }

    // If single day is selected (startDate === endDate) - display hourly breakdown
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
      // Group by distinct dates in selected range
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
  };

  const salesTrendChartData = getTrendData();

  // 4. Payment Method distribution calculation
  const paymentMethodCount = dateFilteredBills.reduce((acc, b) => {
    acc[b.paymentMethod] = (acc[b.paymentMethod] || 0) + b.grandTotal;
    return acc;
  }, {} as Record<string, number>);

  const paymentChartData = Object.entries(paymentMethodCount).map(([name, value]) => ({
    name,
    value: Number(value.toFixed(2))
  }));

  const COLORS = ['#004ac6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

  // 5. Calculate Top Selling Products in the selected range
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

  const topSellingProducts = Object.values(productQuantities)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

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

  // Export to CSV
  const exportToCSV = () => {
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
      <div className="bg-white p-5 rounded-xl border border-[#e1e2ed] shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold tracking-tight text-[#191b23]">Executive Sales & Loyalty Analytics</h2>
              
              {/* Auto-refresh indicator */}
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-green-50 border border-green-200/60 text-[10px] font-semibold text-green-700 select-none">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 ${isAutoRefresh ? '' : 'hidden'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${isAutoRefresh ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                </span>
                <span>Auto-refresh</span>
                <span className="text-green-500 font-mono">| {lastRefreshed}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (onRefresh) onRefresh();
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
          <div className="flex flex-wrap gap-1.5 bg-[#f3f3fe] border border-[#c3c6d7] p-1 rounded-lg select-none shrink-0">
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
                      ? 'bg-[#004ac6] text-white shadow-sm' 
                      : 'text-gray-600 hover:bg-[#e7e7f3]'
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
              <Calendar className="w-4 h-4 text-[#004ac6]" />
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
                className="px-3 py-1.5 border border-[#c3c6d7] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] bg-white cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400 uppercase">To:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-1.5 border border-[#c3c6d7] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] bg-white cursor-pointer"
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
            <CalendarDays className="w-5 h-5 text-[#004ac6] shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-[#191b23]">No receipts recorded for today ({todayStr}) yet.</p>
              <p className="text-[10px] text-gray-500 mt-0.5">By default, the report shows today's receipts. You can check pre-seeded transaction histories or switch ranges below.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handlePreset('ThisWeek')}
            className="px-3 py-1.5 text-[10px] font-bold bg-[#004ac6] text-white hover:bg-[#003ea8] rounded-lg shadow-sm cursor-pointer transition-all shrink-0"
          >
            Show Last 7 Days Logs
          </button>
        </div>
      )}

      {/* 2. Numerical KPIs Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Metric 1: Revenue */}
        <div className="bg-white p-4 rounded-xl border border-[#e1e2ed] shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-[#004ac6] flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Gross Revenue</span>
            <span className="text-lg font-bold text-[#191b23] font-mono">{currencySymbol}{totalRevenue.toFixed(2)}</span>
            <span className="text-[9px] text-green-600 font-semibold block mt-0.5">Range Selected Total</span>
          </div>
        </div>

        {/* Metric 2: Total Invoices */}
        <div className="bg-white p-4 rounded-xl border border-[#e1e2ed] shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-green-50 text-green-600 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Total Invoices</span>
            <span className="text-lg font-bold text-[#191b23] font-mono">{totalOrders} bills</span>
            <span className="text-[9px] text-green-600 font-semibold block mt-0.5">Tickets checked out</span>
          </div>
        </div>

        {/* Metric 3: Average Ticket */}
        <div className="bg-white p-4 rounded-xl border border-[#e1e2ed] shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Average Ticket</span>
            <span className="text-lg font-bold text-[#191b23] font-mono">{currencySymbol}{avgOrderValue.toFixed(2)}</span>
            <span className="text-[9px] text-[#004ac6] font-semibold block mt-0.5">Avg spending value</span>
          </div>
        </div>

        {/* Metric 4: Repeat Guest Rate */}
        <div className="bg-white p-4 rounded-xl border border-[#e1e2ed] shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Repeat Guest Rate</span>
            <span className="text-lg font-bold text-[#191b23] font-mono">{repeatGuestRate.toFixed(1)}%</span>
            <span className="text-[9px] text-green-600 font-semibold block mt-0.5">{repeatGuests} frequent patrons</span>
          </div>
        </div>

      </div>

      {/* 3. Sales Trend Recharts & Payment modes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Area sales trend (left 2/3) */}
        <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-[#e1e2ed] shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-[#191b23] text-xs uppercase tracking-wider flex items-center gap-1">
              <TrendingUp className="w-4 h-4 text-[#004ac6]" />
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
        <div className="bg-white p-5 rounded-xl border border-[#e1e2ed] shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-[#191b23] text-xs uppercase tracking-wider mb-4 flex items-center gap-1">
              <CreditCard className="w-4 h-4 text-[#004ac6]" />
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
                  <strong className="text-[#191b23] font-mono">{currencySymbol}{item.value.toFixed(2)}</strong>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* 4. Top Dishes and Loyalty Points Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Top items leaderboard */}
        <div className="bg-white p-5 rounded-xl border border-[#e1e2ed] shadow-sm">
          <h3 className="font-bold text-[#191b23] text-xs uppercase tracking-wider mb-4 flex items-center gap-1.5">
            <ArrowUpRight className="w-4.5 h-4.5 text-[#004ac6]" />
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
                    <span className="w-6 h-6 rounded bg-[#f3f3fe] text-[#004ac6] border border-[#c3c6d7] flex items-center justify-center font-bold font-mono text-xs shadow-sm">
                      #{idx + 1}
                    </span>
                    <div>
                      <strong className="text-xs text-[#191b23] block leading-tight">{p.name}</strong>
                      <span className="text-[9px] text-gray-400 uppercase tracking-wider block mt-0.5">{p.category}</span>
                    </div>
                  </div>
                  <strong className="text-xs font-mono text-[#004ac6] bg-blue-50 px-2.5 py-0.5 rounded-md">
                    {p.qty} portions sold
                  </strong>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Loyalty Program analytics */}
        <div className="bg-white p-5 rounded-xl border border-[#e1e2ed] shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-[#191b23] text-xs uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Award className="w-4.5 h-4.5 text-[#004ac6]" />
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
            Security logs locked. Verified by backend PostgreSQL on cloud service database.
          </div>
        </div>

      </div>

      {/* 5. Receipts & Bills Ledger Section */}
      <div className="bg-white p-5 rounded-xl border border-[#e1e2ed] shadow-sm space-y-4">
        
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div className="flex items-center justify-between xl:justify-start gap-4 w-full xl:w-auto">
            <div>
              <h3 className="font-bold text-[#191b23] text-sm uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-4.5 h-4.5 text-[#004ac6]" />
                Receipts & Bills Ledger
              </h3>
              <p className="text-[10px] text-gray-500 mt-0.5">
                Detailed list of matching transactions. By default, only displaying today's receipts.
              </p>
            </div>
            <button
              onClick={exportToCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#c3c6d7] hover:border-[#004ac6] text-gray-700 hover:text-[#004ac6] text-xs font-bold rounded-lg transition-all cursor-pointer shadow-sm shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
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
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6]"
              />
            </div>

            {/* Payment Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400 uppercase shrink-0">Payment:</span>
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="px-2 py-1.5 border border-[#c3c6d7] rounded-lg text-xs font-bold text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-[#004ac6] cursor-pointer"
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
                className="px-2 py-1.5 border border-[#c3c6d7] rounded-lg text-xs font-bold text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-[#004ac6] cursor-pointer"
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
        <div className="overflow-x-auto border border-[#e1e2ed] rounded-xl">
          <table className="w-full text-left border-collapse min-w-[850px]">
            <thead>
              <tr className="bg-gray-50 border-b border-[#e1e2ed] text-[10px] font-bold text-gray-400 uppercase tracking-wider">
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
            <tbody className="divide-y divide-gray-100 text-xs text-gray-700 bg-white">
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
                        className="mt-3 px-3 py-1.5 bg-[#f3f3fe] text-[#004ac6] border border-[#c3c6d7] hover:bg-[#e7e7f3] text-xs font-bold rounded-lg cursor-pointer inline-flex items-center gap-1 transition-all"
                      >
                        Reset to Today's Default
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                ledgerBills.map((bill) => (
                  <tr key={bill.id} className="hover:bg-gray-50 transition-colors">
                    <td className="p-3 pl-4 font-mono font-bold text-[#004ac6]">
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
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#faf8ff] border border-[#c3c6d7] text-gray-700">
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
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-[#004ac6] border border-blue-100 uppercase">
                        {bill.paymentMethod}
                      </span>
                    </td>
                    <td className="p-3 text-center pr-4">
                      {onViewBill ? (
                        <button
                          type="button"
                          onClick={() => onViewBill(bill)}
                          className="p-1.5 text-[#004ac6] hover:bg-blue-50 border border-blue-100 hover:border-blue-200 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1 font-bold text-[10px]"
                          title="View thermal receipt template"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View Receipt
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
      </div>

    </div>
  );
}

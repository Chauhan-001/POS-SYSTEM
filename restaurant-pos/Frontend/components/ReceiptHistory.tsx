/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReceiptHistory — Dedicated receipt history page with powerful search
 * and reprint from history functionality.
 */

import React, { useState, useMemo } from 'react';
import {
  Search, Printer, FileText, ArrowLeft,
  Wallet, Banknote, Smartphone, CreditCard, PieChart,
  Undo2, Ban
} from 'lucide-react';
import type { Bill } from '../src/types';

interface ReceiptHistoryProps {
  bills: Bill[];
  currencySymbol: string;
  onReprint: (bill: Bill) => void;
  onBack: () => void;
  /** Whether the current employee can refund/void bills (Owner/Manager) */
  canManageBills?: boolean;
  /** Open the refund flow for a bill (manager PIN required) */
  onRefund?: (bill: Bill) => void;
  /** Open the void flow for a bill (manager PIN required) */
  onVoid?: (bill: Bill) => void;
}

const PAYMENT_ICONS: Record<string, React.ElementType> = {
  Cash: Banknote, UPI: Smartphone, Card: CreditCard,
  Wallet: Wallet, Split: PieChart,
};

export default function ReceiptHistory({ bills, currencySymbol, onReprint, onBack, canManageBills, onRefund, onVoid }: ReceiptHistoryProps) {
  // Search state
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [channelFilter, setChannelFilter] = useState('All');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'>('date_desc');

  // Date presets
  const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const setPreset = (preset: 'today' | 'week' | 'month' | 'all') => {
    if (preset === 'today') { setStartDate(todayStr); setEndDate(todayStr); }
    else if (preset === 'week') {
      const d = new Date(); d.setDate(d.getDate() - 7);
      setStartDate(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10));
      setEndDate(todayStr);
    } else if (preset === 'month') {
      const d = new Date(); d.setMonth(d.getMonth() - 1);
      setStartDate(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10));
      setEndDate(todayStr);
    } else { setStartDate(''); setEndDate(''); }
  };

  // Filtered & sorted bills
  const filtered = useMemo(() => {
    let result = [...bills];

    // Date range
    if (startDate) result = result.filter(b => b.date >= startDate);
    if (endDate) result = result.filter(b => b.date <= endDate);

    // Payment method
    if (paymentFilter !== 'All') result = result.filter(b => b.paymentMethod === paymentFilter);

    // Channel
    if (channelFilter !== 'All') result = result.filter(b => b.orderType === channelFilter);

    // Search: invoice, ticket, customer phone, customer name, cashier name
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(b =>
        b.invoiceNumber.toLowerCase().includes(q) ||
        b.ticketNumber.toLowerCase().includes(q) ||
        (b.customerPhone && b.customerPhone.includes(q)) ||
        (b.customerName && b.customerName.toLowerCase().includes(q)) ||
        b.cashierName.toLowerCase().includes(q) ||
        b.date.includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'date_desc': return new Date(b.date + ' ' + b.time).getTime() - new Date(a.date + ' ' + a.time).getTime();
        case 'date_asc': return new Date(a.date + ' ' + a.time).getTime() - new Date(b.date + ' ' + b.time).getTime();
        case 'amount_desc': return b.grandTotal - a.grandTotal;
        case 'amount_asc': return a.grandTotal - b.grandTotal;
        default: return 0;
      }
    });

    return result;
  }, [bills, search, startDate, endDate, paymentFilter, channelFilter, sortBy]);

  const totalRevenue = useMemo(() => filtered.reduce((s, b) => s + b.grandTotal, 0), [filtered]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#fbfaff]">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3 bg-white border-b border-[#e1e2ed] shrink-0">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-[#004ac6] hover:bg-blue-50 rounded-lg transition-all cursor-pointer" title="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#004ac6]" />
          <span className="text-sm font-bold text-[#191b23]">Receipt History</span>
          <span className="text-[10px] text-gray-400 ml-1">{filtered.length} receipt{filtered.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {search && (
            <button onClick={() => setSearch('')} className="text-[10px] text-red-500 hover:text-red-700 font-semibold cursor-pointer px-2 py-1 rounded hover:bg-red-50 transition-colors">
              Clear Search
            </button>
          )}
          <div className="flex items-center gap-1 bg-gray-50 rounded-lg p-0.5 border border-gray-100">
            {(['today', 'week', 'month', 'all'] as const).map(p => (
              <button key={p} onClick={() => setPreset(p)}
                className={`px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  (p === 'today' && startDate === todayStr && endDate === todayStr) ||
                  (p === 'all' && !startDate && !endDate) ? 'bg-[#004ac6] text-white' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {p === 'all' ? 'All' : p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        {/* Search Bar */}
        <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 mb-4 shadow-xs">
          <div className="flex flex-wrap items-end gap-3">
            {/* Main Search */}
            <div className="flex-1 min-w-[250px]">
              <label className="block text-[9px] font-bold uppercase text-gray-400 mb-1">Search Receipts</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Invoice #, Ticket #, Phone, Customer, Cashier, Date..."
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#004ac6] bg-white"
                  autoFocus
                />
              </div>
              <p className="text-[9px] text-gray-400 mt-1">Search by invoice number, ticket number, phone, customer name, cashier name, or date</p>
            </div>

            {/* Date Range */}
            <div>
              <label className="block text-[9px] font-bold uppercase text-gray-400 mb-1">From</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] bg-white cursor-pointer" />
            </div>
            <div>
              <label className="block text-[9px] font-bold uppercase text-gray-400 mb-1">To</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#004ac6] bg-white cursor-pointer" />
            </div>

            {/* Payment Filter */}
            <div>
              <label className="block text-[9px] font-bold uppercase text-gray-400 mb-1">Payment</label>
              <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-bold text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#004ac6] bg-white cursor-pointer">
                <option value="All">All Methods</option>
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Card">Card</option>
                <option value="Wallet">Wallet</option>
                <option value="Split">Split</option>
              </select>
            </div>

            {/* Channel Filter */}
            <div>
              <label className="block text-[9px] font-bold uppercase text-gray-400 mb-1">Channel</label>
              <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-bold text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#004ac6] bg-white cursor-pointer">
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

            {/* Sort */}
            <div>
              <label className="block text-[9px] font-bold uppercase text-gray-400 mb-1">Sort</label>
              <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
                className="px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-bold text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#004ac6] bg-white cursor-pointer">
                <option value="date_desc">Newest First</option>
                <option value="date_asc">Oldest First</option>
                <option value="amount_desc">Highest Amount</option>
                <option value="amount_asc">Lowest Amount</option>
              </select>
            </div>
          </div>
        </div>

        {/* Summary bar */}
        {filtered.length > 0 && (
          <div className="flex items-center gap-3 mb-3 text-[10px]">
            <span className="font-bold text-gray-700">
              Showing <span className="text-[#004ac6]">{filtered.length}</span> of {bills.length} receipts
            </span>
            <span className="text-gray-300">|</span>
            <span className="font-bold text-green-700">Total: {currencySymbol}{totalRevenue.toFixed(2)}</span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-500">Avg: {currencySymbol}{(filtered.length > 0 ? totalRevenue / filtered.length : 0).toFixed(2)}</span>
          </div>
        )}

        {/* Receipts Table */}
        <div className="bg-white rounded-xl border border-[#e1e2ed] shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-[#e1e2ed] text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                  <th className="p-3 pl-5">Invoice</th>
                  <th className="p-3">Ticket</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Cashier</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Channel</th>
                  <th className="p-3 text-right">Items</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3">Payment</th>
                  <th className="p-3 text-center">Reprint</th>
                  {canManageBills && (
                    <th className="p-3 text-center pr-5">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-xs">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-12 text-center">
                      <div className="flex flex-col items-center gap-2 text-gray-400">
                        <Search className="w-8 h-8 opacity-30" />
                        <p className="text-sm font-bold text-gray-500">No receipts found</p>
                        <p className="text-[10px]">Try adjusting your search or date filters</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map(bill => {
                    const PayIcon = PAYMENT_ICONS[bill.paymentMethod] || Banknote;
                    return (
                      <tr key={bill.id} className="hover:bg-gray-50/70 transition-colors">
                        <td className="p-3 pl-5">
                          <span className="font-mono font-bold text-[#004ac6] text-[10px]">{bill.invoiceNumber}</span>
                        </td>
                        <td className="p-3">
                          <span className="font-mono font-bold text-gray-700 text-[10px]">{bill.ticketNumber}</span>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <span className="font-semibold text-gray-800 text-[10px]">{bill.date}</span>
                          <span className="block text-[9px] text-gray-400 font-mono">{bill.time}</span>
                        </td>
                        <td className="p-3">
                          <span className="font-semibold text-gray-800 text-[10px]">{bill.cashierName}</span>
                          <span className="block text-[9px] text-gray-400">{bill.cashierRole}</span>
                        </td>
                        <td className="p-3">
                          {bill.customerName ? (
                            <>
                              <span className="font-semibold text-gray-800 text-[10px]">{bill.customerName}</span>
                              {bill.customerPhone && <span className="block text-[9px] text-gray-400 font-mono">{bill.customerPhone}</span>}
                            </>
                          ) : (
                            <span className="text-gray-400 text-[10px]">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#faf8ff] border border-[#c3c6d7] text-gray-600">
                            {bill.orderType}
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono font-semibold text-gray-700 text-[10px]">
                          {bill.items.reduce((s, i) => s + i.quantity, 0)}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-gray-900 text-[10px]">
                          {currencySymbol}{bill.grandTotal.toFixed(2)}
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-[#004ac6] border border-blue-100">
                            <PayIcon className="w-2.5 h-2.5" />
                            {bill.paymentMethod}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <button
                            type="button"
                            onClick={() => onReprint(bill)}
                            className="p-1.5 text-amber-700 hover:bg-amber-50 border border-amber-200 hover:border-amber-300 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1 font-bold text-[10px]"
                            title="Reprint this receipt"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Reprint
                          </button>
                        </td>
                        {canManageBills && (
                          <td className="p-3 text-center pr-5">
                            <div className="flex items-center justify-center gap-1.5">
                              {!bill.isRefunded && !bill.isVoided && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onRefund?.(bill)}
                                    disabled={!onRefund}
                                    className="p-1.5 text-purple-700 hover:bg-purple-50 border border-purple-200 hover:border-purple-300 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1 font-bold text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Refund this bill (manager PIN required)"
                                  >
                                    <Undo2 className="w-3.5 h-3.5" />
                                    Refund
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onVoid?.(bill)}
                                    disabled={!onVoid}
                                    className="p-1.5 text-red-700 hover:bg-red-50 border border-red-200 hover:border-red-300 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1 font-bold text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Void this bill (manager PIN required)"
                                  >
                                    <Ban className="w-3.5 h-3.5" />
                                    Void
                                  </button>
                                </>
                              )}
                              {(bill.isRefunded || bill.isVoided) && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${bill.isRefunded ? 'bg-purple-50 text-purple-700' : 'bg-red-50 text-red-600'}`}>
                                  {bill.isRefunded ? 'REFUNDED' : 'VOIDED'}
                                </span>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between text-[9px] text-gray-400">
          <span>Total receipts in system: {bills.length}</span>
          <span>Showing {filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}

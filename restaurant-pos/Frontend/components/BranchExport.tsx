/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BranchExport — Consolidated multi-branch CSV report generator.
 * Only accessible from the head branch / Owner role.
 */

import React, { useState, useEffect } from 'react';
import {
  Download, FileText, X, Check, Building2, DollarSign, Users, FileSpreadsheet,
  ShoppingCart, TrendingUp, Clock, ChevronRight, Printer
} from 'lucide-react';
import type { Branch, Bill, Order, Employee, ExpenseEntry, SystemSettings } from '../src/types';
// Phase 1.8: backend-generated branch reports. The server aggregates the
// authoritative per-branch figures (sales, expenses, headcount) — React only
// renders them, falling back to local synced data when offline.
import { fetchBranchSummary, fetchReportExport } from '../src/api/client';

interface BranchSummaryRow {
  branchId: string; branchName: string; orders: number; revenue: number;
  discount: number; tax: number; netRevenue: number; expenses: number;
  employees: number; activeEmployees: number; profit: number;
}

interface BranchSummaryData {
  period: { start: string; end: string };
  branches: BranchSummaryRow[];
  totals: {
    orders: number; revenue: number; discount: number; tax: number; netRevenue: number;
    expenses: number; employees: number; activeEmployees: number; profit: number;
  };
}

// The modal shows all-time consolidated data; use a wide backend range.
const ALL_TIME_START = '2000-01-01';
const allTimeEnd = () => new Date().toISOString().slice(0, 10);

interface BranchExportProps {
  branches: Branch[];
  allBills: Bill[];
  allOrders: Order[];
  allEmployees: Employee[];
  allExpenses: ExpenseEntry[];
  currencySymbol: string;
  onClose: () => void;
}

type ExportReportType = 'sales' | 'expenses' | 'employees' | 'orders' | 'consolidated';

interface ExportTypeInfo {
  id: ExportReportType;
  label: string;
  desc: string;
  icon: React.ElementType;
  color: string;
}

const EXPORT_TYPES: ExportTypeInfo[] = [
  { id: 'sales', label: 'Sales by Branch', desc: 'Revenue, orders, discounts & tax per branch', icon: DollarSign, color: 'text-green-600' },
  { id: 'expenses', label: 'Expenses by Branch', desc: 'All expense entries grouped by branch & category', icon: FileSpreadsheet, color: 'text-red-600' },
  { id: 'employees', label: 'Employee Summary', desc: 'Staff count, roles & branch assignments', icon: Users, color: 'text-blue-600' },
  { id: 'orders', label: 'Orders Breakdown', desc: 'Order types, statuses & item counts per branch', icon: ShoppingCart, color: 'text-orange-600' },
  { id: 'consolidated', label: 'Full Consolidated Report', desc: 'All reports in one comprehensive CSV', icon: TrendingUp, color: 'text-purple-600' },
];

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getBranchName(branches: Branch[], branchId?: string): string {
  if (!branchId) return 'Main (No Branch)';
  const branch = branches.find(b => b.id === branchId);
  return branch?.name || `Unknown (${branchId})`;
}

function csvEscape(val: any): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default function BranchExport({
  branches, allBills, allOrders, allEmployees, allExpenses, currencySymbol, onClose
}: BranchExportProps) {
  const [exporting, setExporting] = useState<ExportReportType | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [branchData, setBranchData] = useState<BranchSummaryData | null>(null);

  // Fetch the authoritative backend branch summary (cached for offline).
  useEffect(() => {
    let cancelled = false;
    fetchBranchSummary(ALL_TIME_START, allTimeEnd())
      .then((r) => {
        if (!cancelled && r.data && Array.isArray(r.data.branches)) setBranchData(r.data);
      })
      .catch(() => { /* offline — local fallback below */ });
    return () => { cancelled = true; };
  }, []);

  const showStatus = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3000);
  };

  // Download a text payload (backend-generated CSV) as a file.
  const downloadText = (filename: string, content: string) => {
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Backend-first stats (fall back to local synced data offline) ───
  const totals = branchData?.totals || null;
  const statRevenue = totals ? totals.revenue : allBills.reduce((s, b) => s + b.grandTotal, 0);
  const statExpenses = totals ? totals.expenses : allExpenses.reduce((s, e) => s + e.amount, 0);
  const statBillCount = totals ? totals.orders : allBills.length;
  const statAvgBill = statBillCount > 0 ? statRevenue / statBillCount : 0;
  const statProfit = totals ? totals.profit : statRevenue - statExpenses;

  // ============ SALES BY BRANCH ============
  const exportSalesByBranch = async () => {
    setExporting('sales');
    try {
      // Backend-generated export (matches the branch summary exactly).
      const csv = await fetchReportExport('branch', 'csv', ALL_TIME_START, allTimeEnd());
      if (csv) {
        downloadText(`branch_sales_${new Date().toISOString().slice(0, 10)}.csv`, csv);
        showStatus(`Sales report downloaded — ${totals ? totals.orders : allBills.length} orders across branches (backend)`);
        setExporting(null);
        return;
      }
    } catch { /* fall back to local */ }
    try {
      const branchSales = new Map<string, { count: number; revenue: number; discount: number; tax: number; cash: number; card: number; upi: number; wallet: number }>();
      
      // Initialize all branches with zero
      branches.forEach(b => branchSales.set(b.id, { count: 0, revenue: 0, discount: 0, tax: 0, cash: 0, card: 0, upi: 0, wallet: 0 }));
      branchSales.set('__none__', { count: 0, revenue: 0, discount: 0, tax: 0, cash: 0, card: 0, upi: 0, wallet: 0 });

      allBills.forEach(bill => {
        const id = bill.branchId || '__none__';
        if (!branchSales.has(id)) {
          branchSales.set(id, { count: 0, revenue: 0, discount: 0, tax: 0, cash: 0, card: 0, upi: 0, wallet: 0 });
        }
        const s = branchSales.get(id)!;
        s.count++;
        s.revenue += bill.grandTotal;
        s.discount += bill.discount;
        s.tax += bill.gst;
        if (bill.paymentMethod === 'Cash') s.cash += bill.grandTotal;
        else if (bill.paymentMethod === 'Card') s.card += bill.grandTotal;
        else if (bill.paymentMethod === 'UPI') s.upi += bill.grandTotal;
        else if (bill.paymentMethod === 'Wallet') s.wallet += bill.grandTotal;
        else if (bill.paymentMethod === 'Split') {
          if (bill.splitDetails) {
            s.cash += bill.splitDetails.cashAmount;
            s.card += bill.splitDetails.cardAmount;
            s.upi += bill.splitDetails.upiAmount;
            s.wallet += bill.splitDetails.walletAmount;
          }
        }
      });

      const headers = ['Branch', 'Orders', 'Total Revenue', 'Total Discount', 'Total Tax', 'Net Revenue', 'Avg Order Value', 'Cash', 'Card', 'UPI', 'Wallet'];
      const rows: string[][] = [];
      
      let totalRev = 0, totalDiscount = 0, totalTax = 0, totalOrders = 0;
      branchSales.forEach((s, branchId) => {
        if (s.count === 0) return;
        const branchName = branchId === '__none__' ? 'Unassigned' : getBranchName(branches, branchId);
        rows.push([
          csvEscape(branchName), String(s.count), csvEscape(s.revenue.toFixed(2)),
          csvEscape(s.discount.toFixed(2)), csvEscape(s.tax.toFixed(2)),
          csvEscape((s.revenue - s.discount).toFixed(2)),
          csvEscape((s.revenue / s.count).toFixed(2)),
          csvEscape(s.cash.toFixed(2)), csvEscape(s.card.toFixed(2)),
          csvEscape(s.upi.toFixed(2)), csvEscape(s.wallet.toFixed(2))
        ]);
        totalRev += s.revenue;
        totalDiscount += s.discount;
        totalTax += s.tax;
        totalOrders += s.count;
      });

      // Total row
      if (rows.length > 0) {
        rows.push(['TOTAL', String(totalOrders), csvEscape(totalRev.toFixed(2)), csvEscape(totalDiscount.toFixed(2)), csvEscape(totalTax.toFixed(2)), csvEscape((totalRev - totalDiscount).toFixed(2)), csvEscape(totalOrders > 0 ? (totalRev / totalOrders).toFixed(2) : '0'), '', '', '', '']);
      }

      downloadCSV(`branch_sales_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
      showStatus(`Sales report downloaded — ${totalOrders} orders across ${rows.length - 1} branches`);
    } catch (err) {
      showStatus('Error generating sales report');
    }
    setExporting(null);
  };

  // ============ EXPENSES BY BRANCH ============
  const exportExpensesByBranch = () => {
    setExporting('expenses');
    try {
      const headers = ['Date', 'Branch', 'Category', 'Description', 'Amount', 'Payment Method', 'Vendor', 'Created By'];
      const rows = allExpenses.map(e => [
        csvEscape(e.date), csvEscape(getBranchName(branches, e.branchId)),
        csvEscape(e.category), csvEscape(e.description),
        csvEscape(e.amount.toFixed(2)), csvEscape(e.paymentMethod),
        csvEscape(e.vendor || ''), csvEscape(e.createdBy || '')
      ]);

      // Summary by branch
      const byBranch = new Map<string, number>();
      allExpenses.forEach(e => {
        const id = e.branchId || '__none__';
        byBranch.set(id, (byBranch.get(id) || 0) + e.amount);
      });

      rows.push(['', '', '', '', '', '', '', '']);
      rows.push(['BRANCH TOTALS', '', '', '', '', '', '', '']);
      let totalExp = 0;
      byBranch.forEach((amt, branchId) => {
        const name = branchId === '__none__' ? 'Unassigned' : getBranchName(branches, branchId);
        rows.push([csvEscape(name), '', '', '', csvEscape(amt.toFixed(2)), '', '', '']);
        totalExp += amt;
      });
      rows.push(['GRAND TOTAL', '', '', '', csvEscape(totalExp.toFixed(2)), '', '', '']);

      downloadCSV(`branch_expenses_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
      showStatus(`Expenses report downloaded — ${allExpenses.length} entries totaling ${currencySymbol}${totalExp.toFixed(2)}`);
    } catch (err) {
      showStatus('Error generating expenses report');
    }
    setExporting(null);
  };

  // ============ EMPLOYEE SUMMARY ============
  const exportEmployeeSummary = () => {
    setExporting('employees');
    try {
      const headers = ['Employee Name', 'Username', 'Role', 'Status', 'Branch', 'Last Login'];
      const rows = allEmployees.map(emp => [
        csvEscape(emp.name), csvEscape(emp.username), csvEscape(emp.role),
        csvEscape(emp.status), csvEscape(getBranchName(branches, emp.branchId)),
        csvEscape(emp.lastLogin || 'Never')
      ]);

      // Summary by branch
      rows.push(['', '', '', '', '', '']);
      rows.push(['BRANCH EMPLOYEE COUNTS', '', '', '', '', '']);
      const byBranch = new Map<string, { total: number; active: number; owners: number; managers: number; cashiers: number }>();
      allEmployees.forEach(emp => {
        const id = emp.branchId || '__none__';
        if (!byBranch.has(id)) byBranch.set(id, { total: 0, active: 0, owners: 0, managers: 0, cashiers: 0 });
        const s = byBranch.get(id)!;
        s.total++;
        if (emp.status === 'Active') s.active++;
        if (emp.role === 'Owner') s.owners++;
        else if (emp.role === 'Manager') s.managers++;
        else if (emp.role === 'Cashier') s.cashiers++;
      });
      byBranch.forEach((s, branchId) => {
        const name = branchId === '__none__' ? 'Unassigned' : getBranchName(branches, branchId);
        rows.push([csvEscape(name), String(s.total), String(s.active), String(s.owners), String(s.managers), String(s.cashiers)]);
      });

      downloadCSV(`branch_employees_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
      showStatus(`Employee report downloaded — ${allEmployees.length} employees across ${byBranch.size} branches`);
    } catch (err) {
      showStatus('Error generating employee report');
    }
    setExporting(null);
  };

  // ============ ORDERS BREAKDOWN ============
  const exportOrdersBreakdown = () => {
    setExporting('orders');
    try {
      const headers = ['Order #', 'Type', 'Status', 'Branch', 'Items', 'Subtotal', 'Total', 'Customer', 'Date'];
      const rows = allOrders.map(order => [
        csvEscape(order.orderNumber), csvEscape(order.type), csvEscape(order.status),
        csvEscape(getBranchName(branches, order.branchId)),
        String(order.items.length),
        csvEscape(order.subtotal.toFixed(2)), csvEscape(order.grandTotal.toFixed(2)),
        csvEscape(order.customerName || order.customerPhone || ''),
        csvEscape(order.createdAt?.slice(0, 10) || '')
      ]);

      // Summary by branch
      rows.push(['', '', '', '', '', '', '', '', '']);
      rows.push(['BRANCH ORDER SUMMARY', '', '', '', '', '', '', '', '']);
      const byBranch = new Map<string, { total: number; dineIn: number; takeaway: number; delivery: number; revenue: number }>();
      allOrders.forEach(order => {
        const id = order.branchId || '__none__';
        if (!byBranch.has(id)) byBranch.set(id, { total: 0, dineIn: 0, takeaway: 0, delivery: 0, revenue: 0 });
        const s = byBranch.get(id)!;
        s.total++;
        if (order.type === 'Dine In') s.dineIn++;
        else if (order.type === 'Takeaway') s.takeaway++;
        else s.delivery++;
        s.revenue += order.grandTotal;
      });
      byBranch.forEach((s, branchId) => {
        const name = branchId === '__none__' ? 'Unassigned' : getBranchName(branches, branchId);
        rows.push([csvEscape(name), String(s.total), String(s.dineIn), String(s.takeaway), String(s.delivery), '', csvEscape(s.revenue.toFixed(2)), '', '']);
      });

      downloadCSV(`branch_orders_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
      showStatus(`Orders report downloaded — ${allOrders.length} orders across ${byBranch.size} branches`);
    } catch (err) {
      showStatus('Error generating orders report');
    }
    setExporting(null);
  };

  // ============ CONSOLIDATED REPORT ============
  const exportConsolidated = async () => {
    setExporting('consolidated');
    try {
      // Backend-generated consolidated branch summary (branding, filters, totals).
      const csv = await fetchReportExport('branch', 'csv', ALL_TIME_START, allTimeEnd());
      if (csv) {
        downloadText(`branch_consolidated_report_${new Date().toISOString().slice(0, 10)}.csv`, csv);
        showStatus(`Consolidated report downloaded — ${totals ? totals.orders : allBills.length} orders, ${statExpenses.toFixed(2)} expenses (backend)`);
        setExporting(null);
        return;
      }
    } catch { /* fall back to local */ }
    try {
      // === Sheet 1: Branch Summary ===
      const summaryHeaders = ['Branch', 'Orders', 'Revenue', 'Discount', 'Tax', 'Net Revenue', 'Expenses', 'Employees', 'Profit'];
      const branchMap = new Map<string, { orders: number; revenue: number; discount: number; tax: number; expenses: number; employees: number; activeEmps: number }>();
      
      branches.forEach(b => branchMap.set(b.id, { orders: 0, revenue: 0, discount: 0, tax: 0, expenses: 0, employees: 0, activeEmps: 0 }));
      branchMap.set('__none__', { orders: 0, revenue: 0, discount: 0, tax: 0, expenses: 0, employees: 0, activeEmps: 0 });

      allBills.forEach(bill => {
        const id = bill.branchId || '__none__';
        if (!branchMap.has(id)) branchMap.set(id, { orders: 0, revenue: 0, discount: 0, tax: 0, expenses: 0, employees: 0, activeEmps: 0 });
        const s = branchMap.get(id)!;
        s.orders++;
        s.revenue += bill.grandTotal;
        s.discount += bill.discount;
        s.tax += bill.gst;
      });

      allExpenses.forEach(e => {
        const id = e.branchId || '__none__';
        if (!branchMap.has(id)) branchMap.set(id, { orders: 0, revenue: 0, discount: 0, tax: 0, expenses: 0, employees: 0, activeEmps: 0 });
        branchMap.get(id)!.expenses += e.amount;
      });

      allEmployees.forEach(emp => {
        const id = emp.branchId || '__none__';
        if (!branchMap.has(id)) branchMap.set(id, { orders: 0, revenue: 0, discount: 0, tax: 0, expenses: 0, employees: 0, activeEmps: 0 });
        const s = branchMap.get(id)!;
        s.employees++;
        if (emp.status === 'Active') s.activeEmps++;
      });

      const summaryRows: string[][] = [];
      let gOrders = 0, gRevenue = 0, gDiscount = 0, gTax = 0, gExpenses = 0, gEmployees = 0;
      branchMap.forEach((s, branchId) => {
        const name = branchId === '__none__' ? 'Unassigned' : getBranchName(branches, branchId);
        summaryRows.push([
          csvEscape(name), String(s.orders), csvEscape(s.revenue.toFixed(2)),
          csvEscape(s.discount.toFixed(2)), csvEscape(s.tax.toFixed(2)),
          csvEscape((s.revenue - s.discount).toFixed(2)),
          csvEscape(s.expenses.toFixed(2)), String(s.activeEmps),
          csvEscape((s.revenue - s.discount - s.expenses).toFixed(2))
        ]);
        gOrders += s.orders;
        gRevenue += s.revenue;
        gDiscount += s.discount;
        gTax += s.tax;
        gExpenses += s.expenses;
        gEmployees += s.activeEmps;
      });
      summaryRows.push(['GRAND TOTAL', String(gOrders), csvEscape(gRevenue.toFixed(2)), csvEscape(gDiscount.toFixed(2)), csvEscape(gTax.toFixed(2)), csvEscape((gRevenue - gDiscount).toFixed(2)), csvEscape(gExpenses.toFixed(2)), String(gEmployees), csvEscape((gRevenue - gDiscount - gExpenses).toFixed(2))]);

      // Build consolidated CSV with sections
      const lines: string[] = [];
      const addSection = (title: string) => lines.push(`\n${title}\n`);

      addSection('CONSOLIDATED BRANCH REPORT');
      addSection('Generated: ' + new Date().toLocaleString());
      addSection('');
      addSection('=== BRANCH SUMMARY ===');
      lines.push(summaryHeaders.join(','));
      summaryRows.forEach(r => lines.push(r.join(',')));

      addSection('');
      addSection('=== ALL TRANSACTIONS ===');
      const txHeaders = ['Date', 'Invoice', 'Branch', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Method', 'Customer'];
      lines.push(txHeaders.join(','));
      allBills.forEach(bill => {
        lines.push([
          csvEscape(bill.date), csvEscape(bill.invoiceNumber),
          csvEscape(getBranchName(branches, bill.branchId)),
          String(bill.items.length), csvEscape(bill.subtotal.toFixed(2)),
          csvEscape(bill.discount.toFixed(2)), csvEscape(bill.gst.toFixed(2)),
          csvEscape(bill.grandTotal.toFixed(2)),
          csvEscape(bill.paymentMethod), csvEscape(bill.customerName || bill.customerPhone || '')
        ].join(','));
      });

      addSection('');
      addSection('=== ALL EXPENSES ===');
      const expHeaders = ['Date', 'Branch', 'Category', 'Description', 'Amount', 'Method'];
      lines.push(expHeaders.join(','));
      allExpenses.forEach(e => {
        lines.push([
          csvEscape(e.date), csvEscape(getBranchName(branches, e.branchId)),
          csvEscape(e.category), csvEscape(e.description),
          csvEscape(e.amount.toFixed(2)), csvEscape(e.paymentMethod)
        ].join(','));
      });

      const csv = '\uFEFF' + lines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `branch_consolidated_report_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      showStatus(`Consolidated report downloaded — ${gOrders} orders, ${gExpenses.toFixed(2)} expenses, ${gRevenue.toFixed(2)} revenue`);
    } catch (err) {
      showStatus('Error generating consolidated report');
    }
    setExporting(null);
  };

  const handleExport = (type: ExportReportType) => {
    switch (type) {
      case 'sales': exportSalesByBranch(); break;
      case 'expenses': exportExpensesByBranch(); break;
      case 'employees': exportEmployeeSummary(); break;
      case 'orders': exportOrdersBreakdown(); break;
      case 'consolidated': exportConsolidated(); break;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 border border-[#e1e2ed] max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-[#e1e2ed] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-purple-50">
              <Download className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#191b23]">Branch Data Export</h3>
              <p className="text-[10px] text-gray-400">Consolidated reports across all branches</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="bg-purple-50 rounded-xl p-3 mb-4 flex items-start gap-2.5">
            <Building2 className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
            <div className="text-[10px] text-purple-800">
              <span className="font-bold">Head Branch View</span> — Reports include data from all branches.
              {branches.length > 0 && (
                <span className="ml-1">
                  {branches.length} branch{branches.length > 1 ? 'es' : ''}, {allBills.length} total bills, {allExpenses.length} expense entries.
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {EXPORT_TYPES.map(expType => (
              <button
                key={expType.id}
                type="button"
                onClick={() => handleExport(expType.id)}
                disabled={exporting !== null}
                className={`text-left p-4 rounded-xl border transition-all group ${
                  exporting === expType.id
                    ? 'border-purple-400 bg-purple-50 animate-pulse'
                    : 'border-[#e1e2ed] hover:border-purple-300 hover:shadow-sm hover:bg-purple-50/50'
                } ${exporting !== null && exporting !== expType.id ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg bg-gray-50 group-hover:scale-110 transition-transform ${expType.color}`}>
                    {React.createElement(expType.icon, { className: 'w-5 h-5' })}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-900">{expType.label}</span>
                      {exporting === expType.id && (
                        <span className="text-[8px] text-purple-600 font-bold animate-pulse">Generating...</span>
                      )}
                    </div>
                    <p className="text-[9px] text-gray-400 mt-0.5">{expType.desc}</p>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-gray-300 group-hover:text-purple-400 transition-colors ${exporting === expType.id ? 'text-purple-400' : ''}`} />
                </div>
              </button>
            ))}
          </div>

          {/* Quick Stats Summary */}
          <div className="bg-gray-50 rounded-xl p-4 mt-2">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Data Overview</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <p className="text-[9px] text-gray-400">Branches</p>
                <p className="text-sm font-black text-gray-900">{branches.length}</p>
              </div>
              <div>
                <p className="text-[9px] text-gray-400">Total Bills</p>
                <p className="text-sm font-black text-green-600">{statBillCount}</p>
              </div>
              <div>
                <p className="text-[9px] text-gray-400">Total Revenue</p>
                <p className="text-sm font-black text-[#004ac6]">{currencySymbol}{statRevenue.toFixed(0)}</p>
              </div>
              <div>
                <p className="text-[9px] text-gray-400">Total Expenses</p>
                <p className="text-sm font-black text-red-600">{currencySymbol}{statExpenses.toFixed(0)}</p>
              </div>
              <div>
                <p className="text-[9px] text-gray-400">Employees</p>
                <p className="text-sm font-black text-blue-600">{totals ? totals.activeEmployees : allEmployees.length}</p>
              </div>
              <div>
                <p className="text-[9px] text-gray-400">Orders</p>
                <p className="text-sm font-black text-orange-600">{totals ? totals.orders : allOrders.length}</p>
              </div>
              <div>
                <p className="text-[9px] text-gray-400">Avg Bill Value</p>
                <p className="text-sm font-black text-gray-700">{statBillCount > 0 ? currencySymbol + statAvgBill.toFixed(2) : '-'}</p>
              </div>
              <div>
                <p className="text-[9px] text-gray-400">Profit (Net)</p>
                <p className="text-sm font-black text-emerald-600">{currencySymbol + statProfit.toFixed(0)}</p>
              </div>
            </div>
          </div>

          {/* Status toast */}
          {statusMsg && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl p-3 text-[10px] text-green-800 font-medium">
              <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
              {statusMsg}
            </div>
          )}
        </div>

        <div className="p-5 pt-0 border-t border-[#e1e2ed] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-[#c3c6d7] rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

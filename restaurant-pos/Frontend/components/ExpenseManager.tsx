/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ExpenseManager — Phase 1.7 Finance workspace for the restaurant POS.
 *
 * Tabs:
 *   - Expenses   : full CRUD with server categories, vendor select, PATCH
 *                  editing (optimistic versioning), PIN-verified delete,
 *                  restore, server-generated CSV export.
 *   - Cash Drawer: opening cash, cash in/out, shift closing (over/short),
 *                  ledger history + running balance.
 *   - Vendors    : vendor directory + summary (billed/paid/outstanding).
 *   - Recurring  : recurring expense templates + on-demand generation.
 *
 * All writes go through the backend (server-authoritative). When offline the
 * sync engine queues writes and the local list still updates optimistically.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus, Trash2, Edit3, Search, X, ArrowLeft, DollarSign,
  Calendar, TrendingDown, FileText, Save, Download, Banknote,
  Building, UtensilsCrossed, Truck, Wifi, ShoppingBag, Wrench,
  Megaphone, Shield, FileCheck, Monitor, MoreHorizontal, RefreshCw,
  Repeat, Wallet, RotateCcw, Lock, Receipt, Landmark
} from 'lucide-react';
import type { ExpenseEntry, ExpenseCategory, Vendor, RecurringExpense, CashLedgerEntry, FinanceSummary, ExpensePaymentMethod } from '../src/types';
import * as api from '../src/api/client';
import { debugWarn } from '../src/utils/debugLog';

interface ExpenseManagerProps {
  expenses: ExpenseEntry[];
  onUpdateExpenses: (expenses: ExpenseEntry[]) => void;
  currencySymbol: string;
  currentEmployeeName?: string;
  currentRole?: string;
}

const PAYMENT_METHODS: ExpensePaymentMethod[] = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'];
const RECURRENCE_LABELS: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly',
};

const FALLBACK_CATEGORY_ICONS: Record<string, string> = {
  'Ingredients & Raw Materials': '🥬', 'Salaries & Wages': '👥', 'Utilities': '⚡',
  'Rent & Lease': '🏢', 'Equipment & Maintenance': '🔧', 'Marketing & Advertising': '📣',
  'Delivery & Logistics': '🛵', 'Cleaning & Supplies': '🧽', 'Licenses & Permits': '📄',
  'Taxes & Fees': '🏛️', 'Insurance': '🛡️', 'Technology & Software': '💻', 'Miscellaneous': '📋',
};

function formatCurrency(amount: number, symbol: string): string {
  return `${symbol}${(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const emptyExpense = (): ExpenseEntry => ({
  id: `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  date: new Date().toISOString().slice(0, 10),
  category: 'Miscellaneous',
  description: '',
  amount: 0,
  paymentMethod: 'Cash',
  vendor: '',
  notes: '',
  isRecurring: false,
  isCogs: false,
  createdAt: new Date().toISOString(),
});

type TabKey = 'expenses' | 'cash' | 'vendors' | 'recurring';

export default function ExpenseManager({ expenses, onUpdateExpenses, currencySymbol, currentEmployeeName, currentRole = 'Owner' }: ExpenseManagerProps) {
  const [tab, setTab] = useState<TabKey>('expenses');

  // ── Shared lists (server-driven) ──────────────────────────────
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  // ── Expenses tab state ────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseEntry>(emptyExpense());
  const [viewMode, setViewMode] = useState<'list' | 'summary'>('summary');
  const [deleteTarget, setDeleteTarget] = useState<ExpenseEntry | null>(null);
  const [deletePin, setDeletePin] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [conflictMsg, setConflictMsg] = useState('');

  // ── Cash drawer state ─────────────────────────────────────────
  const [ledger, setLedger] = useState<CashLedgerEntry[]>([]);
  const [ledgerBalance, setLedgerBalance] = useState(0);
  const [openingAmount, setOpeningAmount] = useState('');
  const [cashInAmount, setCashInAmount] = useState('');
  const [cashOutAmount, setCashOutAmount] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [cashNote, setCashNote] = useState('');
  const [closeNote, setCloseNote] = useState('');

  // ── Recurring state ───────────────────────────────────────────
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [recurForm, setRecurForm] = useState<any>({
    description: '', amount: 0, category: 'Miscellaneous', frequency: 'monthly',
    startDate: new Date().toISOString().slice(0, 10), dayOfMonth: 1, dayOfWeek: 1,
  });

  // ── Finance summary (backend-generated) ───────────────────────
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary | null>(null);

  const refreshCategories = useCallback(() => {
    api.fetchExpenseCategories().then((cats) => {
      if (Array.isArray(cats) && cats.length > 0) setCategories(cats);
    }).catch(err => debugWarn('ExpenseManager', 'fetchExpenseCategories failed:', err));
  }, []);

  const refreshVendors = useCallback(() => {
    api.fetchVendors({ limit: 100 }).then((res: any) => {
      const list = Array.isArray(res) ? res : res?.data;
      if (Array.isArray(list)) setVendors(list);
    }).catch(err => debugWarn('ExpenseManager', 'fetchVendors failed:', err));
  }, []);

  const refreshFinance = useCallback(() => {
    api.fetchFinanceSummary('month').then((s) => { if (s) setFinanceSummary(s); })
      .catch(() => {/* offline — keep last */});
  }, []);

  const refreshLedger = useCallback(() => {
    api.fetchCashLedger({ limit: 50 }).then((res: any) => {
      if (Array.isArray(res?.data)) { setLedger(res.data); setLedgerBalance(res.balance ?? 0); }
    }).catch(err => debugWarn('ExpenseManager', 'fetchCashLedger failed:', err));
  }, []);

  const refreshRecurring = useCallback(() => {
    api.fetchRecurringExpenses({ limit: 100 }).then((res: any) => {
      const list = Array.isArray(res) ? res : res?.data;
      if (Array.isArray(list)) setRecurring(list);
    }).catch(err => debugWarn('ExpenseManager', 'fetchRecurring failed:', err));
  }, []);

  useEffect(() => {
    refreshCategories();
    refreshVendors();
    refreshFinance();
    refreshLedger();
    refreshRecurring();
  }, [refreshCategories, refreshVendors, refreshFinance, refreshLedger, refreshRecurring]);

  // Live freshness: any write (here, on another screen, or a replayed offline
  // op) invalidates our cached collections and fires the cache-invalidated
  // event — re-fetch the affected collection promptly. A 5-minute interval
  // keeps the cash ledger + recurring list current while the Finance
  // workspace stays open. Every fetch here is TTL-gated (categories/vendors/
  // recurring 1h, ledger 5min), so the interval only hits the network when a
  // cache actually expired — it can never spam the shared API limiter.
  useEffect(() => {
    const onInvalidated = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (key === 'pos_expense_categories') refreshCategories();
      else if (key === 'pos_vendors') refreshVendors();
      else if (key === 'pos_cash_ledger') refreshLedger();
      else if (key === 'pos_recurring_expenses') refreshRecurring();
    };
    window.addEventListener(api.CACHE_INVALIDATED_EVENT, onInvalidated);
    const interval = setInterval(() => { refreshLedger(); refreshRecurring(); }, 5 * 60 * 1000);
    return () => {
      window.removeEventListener(api.CACHE_INVALIDATED_EVENT, onInvalidated);
      clearInterval(interval);
    };
  }, [refreshCategories, refreshVendors, refreshLedger, refreshRecurring]);

  // ── Derived expense views ─────────────────────────────────────
  const visibleExpenses = useMemo(() => {
    let result = showDeleted ? expenses : expenses.filter(e => !e.isDeleted);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.description.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        (e.vendor && e.vendor.toLowerCase().includes(q))
      );
    }
    if (categoryFilter !== 'All') result = result.filter(e => e.category === categoryFilter);
    if (dateFrom) result = result.filter(e => e.date >= dateFrom);
    if (dateTo) result = result.filter(e => e.date <= dateTo);
    return [...result].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [expenses, search, categoryFilter, dateFrom, dateTo, showDeleted]);

  const totalExpenses = useMemo(() => visibleExpenses.reduce((s, e) => s + e.amount, 0), [visibleExpenses]);
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayExpenses = useMemo(() => visibleExpenses.filter(e => e.date === todayStr).reduce((s, e) => s + e.amount, 0), [visibleExpenses, todayStr]);
  const monthExpenses = useMemo(() => visibleExpenses.filter(e => e.date.startsWith(todayStr.slice(0, 7))).reduce((s, e) => s + e.amount, 0), [visibleExpenses, todayStr]);

  const categoryTotals = useMemo(() => {
    const map: Record<string, number> = {};
    visibleExpenses.forEach(e => { map[e.category] = (map[e.category] || 0) + e.amount; });
    return Object.entries(map).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  }, [visibleExpenses]);

  const catIcon = (name: string) => {
    const cat = categories.find(c => c.name === name);
    return cat?.icon || FALLBACK_CATEGORY_ICONS[name] || '📋';
  };
  const catColor = (name: string) => {
    const cat = categories.find(c => c.name === name);
    return cat?.color || '#64748b';
  };

  // ── Save (create or PATCH update with version) ────────────────
  const handleSave = () => {
    if (!form.description.trim() || form.amount <= 0) return;
    setConflictMsg('');
    const payload: any = {
      amount: form.amount,
      category: form.category,
      date: form.date,
      description: form.description.trim(),
      paymentMethod: form.paymentMethod,
      isCogs: form.isCogs ?? false,
    };
    if (form.categoryId) payload.categoryId = form.categoryId;
    if (form.vendorId) payload.vendorId = form.vendorId;
    if (form.vendor && !form.vendorId) payload.vendor = form.vendor;
    if (form.notes) payload.notes = form.notes;
    if (form.isRecurring) payload.isRecurring = true;
    if (form.branchId) payload.branchId = form.branchId;

    const entry: ExpenseEntry = { ...form, description: form.description.trim(), createdBy: form.createdBy || currentEmployeeName || 'System' };

    if (editingId && /^[a-fA-F0-9]{24}$/.test(editingId)) {
      // BACKEND CALLED — PATCH with optimistic concurrency (baseVersion).
      api.updateExpense(editingId, { ...payload, baseVersion: form.version || 1 }).then((updated: any) => {
        if (!updated) return;
        onUpdateExpenses(expenses.map(e => e.id === editingId ? { ...e, ...updated, id: updated._id || updated.id || e.id, version: updated.version } : e));
      }).catch((err: any) => {
        debugWarn('ExpenseManager', 'updateExpense failed:', err);
        if (err?.response?.status === 409) setConflictMsg('This expense was changed on another device. Refresh to get the latest version.');
      });
      onUpdateExpenses(expenses.map(e => e.id === editingId ? entry : e));
    } else {
      // BACKEND CALLED — create in /api/expenses; swap temp id for server id.
      api.createExpense(payload).then((created: any) => {
        const serverId = created?._id || created?.id;
        if (serverId) {
          onUpdateExpenses(expenses.map(e => e.id === entry.id ? { ...e, id: serverId } : e));
        }
      }).catch(err => debugWarn('ExpenseManager', 'createExpense failed:', err));
      onUpdateExpenses([entry, ...expenses]);
    }
    resetForm();
  };

  const handleEdit = (entry: ExpenseEntry) => {
    setForm({ ...entry });
    setEditingId(entry.id);
    setShowAddForm(true);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const id = deleteTarget.id;
    // BACKEND CALLED — delete with optional manager PIN (Owner/Manager only).
    const isServer = /^[a-fA-F0-9]{24}$/.test(id);
    const finish = () => {
      onUpdateExpenses(expenses.filter(e => e.id !== id));
      setDeleteTarget(null); setDeletePin(''); setDeleteReason(''); setDeleting(false);
    };
    if (isServer) {
      api.deleteExpense(id, { reason: deleteReason || undefined, managerPin: deletePin || undefined })
        .then((res: any) => {
          if (res === null && !deletePin) { /* offline — optimistic removal */ finish(); return; }
          finish();
        })
        .catch(() => finish());
    } else {
      finish();
    }
  };

  const handleRestore = (id: string) => {
    // BACKEND CALLED — restore soft-deleted expense.
    api.restoreExpense(id).then((restored: any) => {
      if (!restored) return;
      onUpdateExpenses(expenses.map(e => e.id === id ? { ...e, isDeleted: false, ...restored, id: restored._id || restored.id || e.id } : e));
    }).catch(err => debugWarn('ExpenseManager', 'restoreExpense failed:', err));
  };

  const handleExport = () => {
    // BACKEND CALLED — server-generated CSV export (authoritative).
    api.exportExpenses({ startDate: dateFrom || undefined, endDate: dateTo || undefined, category: categoryFilter !== 'All' ? categoryFilter : undefined, search: search || undefined })
      .then((csv) => {
        if (!csv) { fallbackExport(); return; }
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `expenses_${todayStr}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }).catch(() => fallbackExport());
  };

  const fallbackExport = () => {
    const headers = ['Date', 'Category', 'Description', 'Amount', 'Payment Method', 'Vendor', 'Notes'];
    const rows = visibleExpenses.map(e => [e.date, e.category, `"${e.description.replace(/"/g, '""')}"`, e.amount, e.paymentMethod, e.vendor ? `"${e.vendor}"` : '', e.notes ? `"${e.notes.replace(/"/g, '""')}"` : '']);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses_${todayStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetForm = () => { setForm(emptyExpense()); setEditingId(null); setShowAddForm(false); setConflictMsg(''); };

  // ── Cash drawer actions ───────────────────────────────────────
  const handleOpenCash = () => {
    const amount = parseFloat(openingAmount);
    if (isNaN(amount) || amount < 0) return;
    // BACKEND CALLED — record opening cash (once per day).
    api.openCashDrawer({ amount, note: cashNote || undefined }).then(() => { refreshLedger(); refreshFinance(); setOpeningAmount(''); setCashNote(''); })
      .catch(err => debugWarn('ExpenseManager', 'openCash failed:', err));
  };

  const handleCashEntry = (type: 'cash_in' | 'cash_out') => {
    const amount = parseFloat(type === 'cash_in' ? cashInAmount : cashOutAmount);
    if (isNaN(amount) || amount <= 0) return;
    // BACKEND CALLED — cash in/out entry.
    api.addCashEntry({ type, amount, note: cashNote || undefined }).then(() => { refreshLedger(); refreshFinance(); setCashInAmount(''); setCashOutAmount(''); setCashNote(''); })
      .catch(err => debugWarn('ExpenseManager', 'addCashEntry failed:', err));
  };

  const handleCloseShift = () => {
    const counted = parseFloat(countedCash);
    if (isNaN(counted) || counted < 0) return;
    // BACKEND CALLED — close shift with counted cash (computes over/short).
    api.closeCashShift({ countedCash: counted, note: closeNote || undefined }).then(() => { refreshLedger(); refreshFinance(); setCountedCash(''); setCloseNote(''); })
      .catch(err => debugWarn('ExpenseManager', 'closeShift failed:', err));
  };

  // ── Recurring actions ─────────────────────────────────────────
  const handleSaveRecurring = () => {
    if (!recurForm.description.trim() || !recurForm.amount) return;
    // BACKEND CALLED — create recurring template.
    api.createRecurringExpense(recurForm).then(() => { refreshRecurring(); setShowRecurringForm(false); })
      .catch(err => debugWarn('ExpenseManager', 'createRecurring failed:', err));
  };

  const toggleRecurringPause = (r: RecurringExpense) => {
    // BACKEND CALLED — pause/resume template.
    const fn = r.isPaused ? api.resumeRecurringExpense : api.pauseRecurringExpense;
    fn(r.id).then(() => refreshRecurring()).catch(err => debugWarn('ExpenseManager', 'toggleRecurring failed:', err));
  };

  const runRecurringNow = () => {
    // BACKEND CALLED — generate all due children now.
    api.runRecurringExpenses().then(() => { refreshRecurring(); refreshExpensesLocal(); })
      .catch(err => debugWarn('ExpenseManager', 'runRecurring failed:', err));
  };

  const refreshExpensesLocal = () => {
    api.fetchExpenses({ limit: 200 }).then((incoming: any) => {
      if (Array.isArray(incoming) && incoming.length > 0) {
        onUpdateExpenses(incoming);
      }
    }).catch(() => {/* offline */});
  };

  // ── Vendor actions ────────────────────────────────────────────
  const [vendorForm, setVendorForm] = useState<any>({ name: '', gstin: '', phone: '', email: '', paymentTermsDays: 0 });
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [vendorSummary, setVendorSummary] = useState<any>(null);

  const handleSaveVendor = () => {
    if (!vendorForm.name.trim()) return;
    // BACKEND CALLED — create vendor.
    api.createVendor(vendorForm).then(() => { refreshVendors(); setVendorForm({ name: '', gstin: '', phone: '', email: '', paymentTermsDays: 0 }); })
      .catch(err => debugWarn('ExpenseManager', 'createVendor failed:', err));
  };

  const openVendorSummary = (v: Vendor) => {
    setSelectedVendor(v);
    // BACKEND CALLED — vendor summary (billed/paid/outstanding).
    api.fetchVendorSummary(v.id).then((s: any) => setVendorSummary(s)).catch(err => debugWarn('ExpenseManager', 'fetchVendorSummary failed:', err));
  };

  // ── Sub-renders ───────────────────────────────────────────────
  const renderKpis = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
        <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Total Expenses ({visibleExpenses.length})</p>
        <p className="text-xl font-black text-gray-900 mt-0.5 font-mono">{formatCurrency(totalExpenses, currencySymbol)}</p>
        <p className="text-[9px] text-gray-400 mt-0.5">{visibleExpenses.length} entries shown</p>
      </div>
      <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
        <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Today</p>
        <p className="text-xl font-black text-red-500 mt-0.5 font-mono">{formatCurrency(todayExpenses, currencySymbol)}</p>
        <p className="text-[9px] text-gray-400 mt-0.5">{todayStr}</p>
      </div>
      <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
        <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">This Month</p>
        <p className="text-xl font-black text-gray-900 mt-0.5 font-mono">{formatCurrency(monthExpenses, currencySymbol)}</p>
        <p className="text-[9px] text-gray-400 mt-0.5">{todayStr.slice(0, 7)}</p>
      </div>
      <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
        <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Net Profit (Month, server)</p>
        <p className={`text-xl font-black mt-0.5 font-mono ${(financeSummary?.pnl.netProfit ?? 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {formatCurrency(financeSummary?.pnl.netProfit ?? 0, currencySymbol)}
        </p>
        <p className="text-[9px] text-gray-400 mt-0.5">backend-computed P&L</p>
      </div>
    </div>
  );

  const renderTabs = () => (
    <div className="flex items-center gap-1 px-4 pt-3 bg-white border-b border-[#e1e2ed]">
      {([['expenses', 'Expenses', FileText], ['cash', 'Cash Drawer', Wallet], ['vendors', 'Vendors', Building], ['recurring', 'Recurring', Repeat]] as [TabKey, string, any][]).map(([key, label, Icon]) => (
        <button key={key} onClick={() => setTab(key)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-[11px] font-bold transition-all cursor-pointer ${tab === key ? 'bg-red-50 text-red-600 border-b-2 border-red-500' : 'text-gray-400 hover:text-gray-600 border-b-2 border-transparent'}`}>
          <Icon className="w-3.5 h-3.5" /> {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-[#faf8ff]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-[#e1e2ed] shrink-0">
        <div className="p-2 rounded-xl bg-red-50 text-red-600">
          <TrendingDown className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-sm font-black text-gray-900">Expenses & Finance</h1>
          <p className="text-[10px] text-gray-400">Multi-branch expense, cash & P&L management</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => { refreshCategories(); refreshVendors(); refreshFinance(); refreshLedger(); refreshRecurring(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e1e2ed] rounded-lg text-[10px] font-bold text-gray-600 hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] transition-all cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" /> Sync
          </button>
          {tab === 'expenses' && (
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e1e2ed] rounded-lg text-[10px] font-bold text-gray-600 hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] transition-all cursor-pointer">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          )}
          {tab === 'expenses' && (
            <button onClick={() => { resetForm(); setShowAddForm(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer shadow-xs">
              <Plus className="w-3.5 h-3.5" /> Add Expense
            </button>
          )}
          {tab === 'recurring' && (
            <button onClick={() => setShowRecurringForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer shadow-xs">
              <Plus className="w-3.5 h-3.5" /> New Template
            </button>
          )}
        </div>
      </div>

      {renderTabs()}

      <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-5">
        {tab === 'expenses' && (
          <>
            {renderKpis()}

            {/* Category breakdown */}
            <div className="bg-white rounded-xl border border-[#e1e2ed] p-5 shadow-xs">
              <div className="flex items-center gap-2 mb-4">
                <TrendingDown className="w-4 h-4 text-red-500" />
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Expense Breakdown by Category</h3>
                <span className="text-[9px] text-gray-400 ml-auto">{categoryTotals.length} categories</span>
              </div>
              {categoryTotals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                  <Banknote className="w-10 h-10 mb-2" />
                  <p className="text-xs font-medium">No expenses match your filters</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {categoryTotals.map(({ category, amount }) => {
                    const maxAmount = categoryTotals[0].amount || 1;
                    const barWidth = (amount / maxAmount) * 100;
                    return (
                      <div key={category}>
                        <div className="flex items-center gap-2.5 mb-1">
                          <div className="p-1.5 rounded-lg text-xs shrink-0" style={{ backgroundColor: `${catColor(category)}18` }}>
                            <span>{catIcon(category)}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center">
                              <span className="text-[11px] font-semibold text-gray-800 truncate">{category}</span>
                              <span className="text-[10px] font-bold text-gray-500 ml-2 shrink-0">{formatCurrency(amount, currencySymbol)}</span>
                            </div>
                            <div className="w-full h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-red-400 to-red-500 rounded-full transition-all" style={{ width: `${barWidth}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Filters + list */}
            <div className="bg-white rounded-xl border border-[#e1e2ed] shadow-xs overflow-hidden">
              <div className="p-4 border-b border-[#e1e2ed] flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search expenses..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400" />
                </div>
                <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400 bg-white">
                  <option value="All">All Categories</option>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
                </select>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400" title="From date" />
                <span className="text-[10px] text-gray-400">to</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400" title="To date" />
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} className="accent-red-500" />
                  Deleted
                </label>
                <span className="text-[10px] font-bold text-gray-500">{visibleExpenses.length} result{visibleExpenses.length !== 1 ? 's' : ''}</span>
              </div>

              {visibleExpenses.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-300">
                  <Banknote className="w-14 h-14 mb-3" />
                  <p className="text-sm font-semibold">No expenses found</p>
                  <p className="text-xs mt-1">Add a new expense or adjust your filters</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {visibleExpenses.map(entry => (
                    <div key={entry.id} className={`px-4 py-3 flex items-center gap-3 hover:bg-gray-50/50 transition-colors group ${entry.isDeleted ? 'opacity-50' : ''}`}>
                      <div className="p-2 rounded-lg text-sm shrink-0" style={{ backgroundColor: `${catColor(entry.category)}18` }}>
                        <span>{catIcon(entry.category)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-900 truncate">{entry.description}</span>
                          {entry.isSystemGenerated && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 shrink-0">🔄 Auto</span>}
                          {entry.isCogs && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-green-50 text-green-600 shrink-0">COGS</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-[9px] text-gray-400 flex-wrap">
                          <span><Calendar className="w-2.5 h-2.5 inline mr-0.5" />{entry.date}</span>
                          <span style={{ color: catColor(entry.category) }}>{entry.category}</span>
                          {entry.vendor && <span>🏢 {entry.vendor}</span>}
                          <span className={`px-1 py-0.5 rounded text-[8px] font-semibold ${entry.paymentMethod === 'Cash' ? 'bg-green-50 text-green-600' : entry.paymentMethod === 'UPI' ? 'bg-blue-50 text-blue-600' : entry.paymentMethod === 'Card' ? 'bg-purple-50 text-purple-600' : 'bg-gray-50 text-gray-600'}`}>{entry.paymentMethod}</span>
                          {entry.isDeleted && <span className="text-red-500">deleted</span>}
                        </div>
                        {entry.notes && <p className="text-[8px] text-gray-400 mt-0.5 italic truncate">📝 {entry.notes}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-black text-gray-900 font-mono">{formatCurrency(entry.amount, currencySymbol)}</p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {entry.isDeleted ? (
                          <button onClick={() => handleRestore(entry.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-all cursor-pointer" title="Restore">
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <>
                            <button onClick={() => handleEdit(entry)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all cursor-pointer" title="Edit">
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setDeleteTarget(entry)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer" title="Delete (PIN)">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'cash' && (
          <div className="space-y-4">
            {/* Balance + actions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
                <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Drawer Balance</p>
                <p className={`text-2xl font-black mt-1 font-mono ${ledgerBalance >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatCurrency(ledgerBalance, currencySymbol)}</p>
                <p className="text-[9px] text-gray-400 mt-0.5">live cash on hand (server ledger)</p>
              </div>
              <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
                <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Month Net Profit</p>
                <p className={`text-2xl font-black mt-1 font-mono ${(financeSummary?.pnl.netProfit ?? 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatCurrency(financeSummary?.pnl.netProfit ?? 0, currencySymbol)}</p>
                <p className="text-[9px] text-gray-400 mt-0.5">gross − COGS − operating expenses</p>
              </div>
              <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
                <p className="text-[9px] font-bold uppercase text-gray-400 tracking-wider">Vendor Outstanding</p>
                <p className="text-2xl font-black mt-1 font-mono text-amber-600">{formatCurrency(financeSummary?.vendorDues?.total ?? 0, currencySymbol)}</p>
                <p className="text-[9px] text-gray-400 mt-0.5">{financeSummary?.vendorDues?.count ?? 0} credit-term vendors</p>
              </div>
            </div>

            {/* Opening / entries / close */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
                <h3 className="text-[11px] font-black text-gray-900 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Banknote className="w-3.5 h-3.5 text-green-600" /> Opening Cash</h3>
                <input type="number" min="0" step="0.01" value={openingAmount} onChange={e => setOpeningAmount(e.target.value)} placeholder="Amount"
                  className="w-full px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-green-400 mb-2" />
                <input type="text" value={cashNote} onChange={e => setCashNote(e.target.value)} placeholder="Note (optional)"
                  className="w-full px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-green-400 mb-2" />
                <button onClick={handleOpenCash} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer">
                  <Banknote className="w-3.5 h-3.5" /> Open Drawer
                </button>
              </div>
              <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
                <h3 className="text-[11px] font-black text-gray-900 uppercase tracking-wider mb-3">Cash In / Out</h3>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input type="number" min="0" step="0.01" value={cashInAmount} onChange={e => setCashInAmount(e.target.value)} placeholder="In amount"
                    className="w-full px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <input type="number" min="0" step="0.01" value={cashOutAmount} onChange={e => setCashOutAmount(e.target.value)} placeholder="Out amount"
                    className="w-full px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => handleCashEntry('cash_in')} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer">
                    + Cash In
                  </button>
                  <button onClick={() => handleCashEntry('cash_out')} className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer">
                    − Cash Out
                  </button>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
                <h3 className="text-[11px] font-black text-gray-900 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Landmark className="w-3.5 h-3.5 text-amber-600" /> Close Shift</h3>
                <input type="number" min="0" step="0.01" value={countedCash} onChange={e => setCountedCash(e.target.value)} placeholder="Counted cash"
                  className="w-full px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-amber-400 mb-2" />
                <input type="text" value={closeNote} onChange={e => setCloseNote(e.target.value)} placeholder="Note (optional)"
                  className="w-full px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-amber-400 mb-2" />
                <button onClick={handleCloseShift} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer">
                  <Receipt className="w-3.5 h-3.5" /> Close & Reconcile
                </button>
              </div>
            </div>

            {/* Ledger history */}
            <div className="bg-white rounded-xl border border-[#e1e2ed] shadow-xs overflow-hidden">
              <div className="px-4 py-3 border-b border-[#e1e2ed] flex items-center gap-2">
                <Wallet className="w-4 h-4 text-gray-500" />
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Cash Ledger</h3>
                <span className="text-[9px] text-gray-400 ml-auto">balance: {formatCurrency(ledgerBalance, currencySymbol)}</span>
              </div>
              {ledger.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-300">
                  <Wallet className="w-10 h-10 mb-2" />
                  <p className="text-xs font-medium">No ledger entries yet — open the drawer to start</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                  {ledger.map(entry => (
                    <div key={entry.id} className="px-4 py-2.5 flex items-center gap-3">
                      <div className={`p-1.5 rounded-lg text-[10px] ${entry.amount >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                        {entry.amount >= 0 ? '⬇' : '⬆'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold text-gray-800 capitalize">{entry.type.replace(/_/g, ' ')}</div>
                        <div className="text-[9px] text-gray-400">{entry.date}{entry.note ? ` · ${entry.note}` : ''}{entry.performedBy ? ` · ${entry.performedBy}` : ''}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-xs font-black font-mono ${entry.amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {entry.amount >= 0 ? '+' : ''}{formatCurrency(entry.amount, currencySymbol)}
                        </p>
                        <p className="text-[8px] text-gray-400 font-mono">bal {formatCurrency(entry.balanceAfter, currencySymbol)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'vendors' && (
          <div className="space-y-4">
            {/* Add vendor */}
            <div className="bg-white rounded-xl border border-[#e1e2ed] p-4 shadow-xs">
              <h3 className="text-[11px] font-black text-gray-900 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Building className="w-3.5 h-3.5 text-blue-600" /> Add Vendor</h3>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                <input type="text" value={vendorForm.name} onChange={e => setVendorForm({ ...vendorForm, name: e.target.value })} placeholder="Vendor name *"
                  className="px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-400" />
                <input type="text" value={vendorForm.gstin} onChange={e => setVendorForm({ ...vendorForm, gstin: e.target.value })} placeholder="GSTIN"
                  className="px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-400" />
                <input type="text" value={vendorForm.phone} onChange={e => setVendorForm({ ...vendorForm, phone: e.target.value })} placeholder="Phone"
                  className="px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-400" />
                <input type="email" value={vendorForm.email} onChange={e => setVendorForm({ ...vendorForm, email: e.target.value })} placeholder="Email"
                  className="px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-400" />
                <button onClick={handleSaveVendor} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition-all cursor-pointer">
                  Save Vendor
                </button>
              </div>
            </div>

            {/* Vendor list */}
            <div className="bg-white rounded-xl border border-[#e1e2ed] shadow-xs overflow-hidden">
              <div className="px-4 py-3 border-b border-[#e1e2ed] flex items-center gap-2">
                <Building className="w-4 h-4 text-gray-500" />
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Vendors</h3>
                <span className="text-[9px] text-gray-400 ml-auto">{vendors.length} vendors</span>
              </div>
              {vendors.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-300">
                  <Building className="w-10 h-10 mb-2" />
                  <p className="text-xs font-medium">No vendors yet</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {vendors.map(v => (
                    <button key={v.id} onClick={() => openVendorSummary(v)} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-blue-50/40 transition-colors text-left cursor-pointer">
                      <div className="p-2 rounded-lg bg-blue-50 text-blue-600"><Building className="w-4 h-4" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-gray-900">{v.name}</div>
                        <div className="text-[9px] text-gray-400 truncate">
                          {v.gstin && <span className="mr-2">GSTIN {v.gstin}</span>}
                          {v.phone && <span className="mr-2">{v.phone}</span>}
                          {v.email}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-blue-600">Summary →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Vendor summary modal */}
            {selectedVendor && vendorSummary && (
              <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => { setSelectedVendor(null); setVendorSummary(null); }}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center">
                    <h3 className="text-sm font-bold text-gray-900">{vendorSummary.vendor?.name}</h3>
                    <button onClick={() => { setSelectedVendor(null); setVendorSummary(null); }} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="p-5 space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-[8px] font-bold uppercase text-gray-400">Billed</p>
                        <p className="text-sm font-black text-gray-900 font-mono">{formatCurrency(vendorSummary.summary?.totalBilled, currencySymbol)}</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3 text-center">
                        <p className="text-[8px] font-bold uppercase text-green-500">Paid</p>
                        <p className="text-sm font-black text-green-600 font-mono">{formatCurrency(vendorSummary.summary?.totalPaid, currencySymbol)}</p>
                      </div>
                      <div className="bg-amber-50 rounded-lg p-3 text-center">
                        <p className="text-[8px] font-bold uppercase text-amber-500">Outstanding</p>
                        <p className="text-sm font-black text-amber-600 font-mono">{formatCurrency(vendorSummary.summary?.outstanding, currencySymbol)}</p>
                      </div>
                    </div>
                    {vendorSummary.summary?.gstin && <p className="text-[10px] text-gray-500">GSTIN: <span className="font-mono font-bold">{vendorSummary.vendor.gstin}</span></p>}
                    <div>
                      <p className="text-[9px] font-bold uppercase text-gray-400 mb-1.5">Recent Expenses</p>
                      {vendorSummary.recentExpenses?.length === 0 ? (
                        <p className="text-[10px] text-gray-400 italic">No expenses yet</p>
                      ) : (
                        <div className="space-y-1.5">
                          {vendorSummary.recentExpenses?.map((e: any) => (
                            <div key={e.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-[10px] font-bold text-gray-700 truncate">{e.description}</p>
                                <p className="text-[8px] text-gray-400">{e.date} · {e.category} · {e.paymentMethod}</p>
                              </div>
                              <span className="text-[11px] font-black font-mono text-gray-900 shrink-0">{formatCurrency(e.amount, currencySymbol)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'recurring' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-gray-500">Templates generate child expenses automatically on their schedule. Pause to freeze, resume to continue.</p>
              <button onClick={runRecurringNow} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e1e2ed] rounded-lg text-[10px] font-bold text-gray-600 hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] transition-all cursor-pointer">
                <Repeat className="w-3.5 h-3.5" /> Generate Due Now
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {recurring.length === 0 ? (
                <div className="col-span-full bg-white rounded-xl border border-[#e1e2ed] p-8 flex flex-col items-center text-gray-300">
                  <Repeat className="w-10 h-10 mb-2" />
                  <p className="text-xs font-semibold">No recurring templates — create one to automate rent, salaries & subscriptions</p>
                </div>
              ) : recurring.map(r => (
                <div key={r.id} className={`bg-white rounded-xl border p-4 shadow-xs ${r.isPaused ? 'border-gray-200 opacity-70' : 'border-[#e1e2ed]'}`}>
                  <div className="flex items-start justify-between">
                    <div className="p-2 rounded-lg bg-red-50 text-red-600"><Repeat className="w-4 h-4" /></div>
                    <span className={`text-[8px] font-bold px-2 py-0.5 rounded ${r.isPaused ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-600'}`}>{r.isPaused ? 'Paused' : 'Active'}</span>
                  </div>
                  <h3 className="text-xs font-black text-gray-900 mt-2 truncate">{r.description}</h3>
                  <p className="text-[9px] text-gray-400">{r.category} · {RECURRENCE_LABELS[r.frequency] || r.frequency}</p>
                  <div className="flex items-end justify-between mt-3">
                    <div>
                      <p className="text-lg font-black text-gray-900 font-mono">{formatCurrency(r.amount, currencySymbol)}</p>
                      <p className="text-[8px] text-gray-400">next: {r.nextRunDate}</p>
                    </div>
                    <button onClick={() => toggleRecurringPause(r)}
                      className={`px-2.5 py-1.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer ${r.isPaused ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
                      {r.isPaused ? 'Resume' : 'Pause'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Expense modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-sm font-bold text-gray-900">{editingId ? 'Edit Expense' : 'Add New Expense'}</h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {conflictMsg && (
                <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 text-[10px] font-semibold">
                  ⚠ {conflictMsg}
                </div>
              )}
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Description *</label>
                <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400"
                  placeholder="e.g. Weekly vegetable procurement" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Amount ({currencySymbol}) *</label>
                  <input type="number" min="0" step="0.01" value={form.amount || ''} onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-bold font-mono focus:outline-none focus:ring-1 focus:ring-red-400" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Category</label>
                <select value={form.category} onChange={e => {
                  const cat = categories.find(c => c.name === e.target.value);
                  setForm({ ...form, category: e.target.value, categoryId: cat?.id });
                }}
                  className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400 bg-white">
                  {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}{c.isCogs ? ' (COGS)' : ''}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Payment Method</label>
                  <select value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value as ExpensePaymentMethod })}
                    className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400 bg-white">
                    {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Vendor</label>
                  <select value={form.vendorId || ''} onChange={e => {
                    const vid = e.target.value;
                    const v = vendors.find(x => x.id === vid);
                    setForm({ ...form, vendorId: vid || undefined, vendor: v?.name || (vid === '__custom' ? form.vendor : undefined) });
                  }}
                    className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400 bg-white">
                    <option value="">— Free text —</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
              </div>
              {!form.vendorId && (
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Vendor Name (text)</label>
                  <input type="text" value={form.vendor || ''} onChange={e => setForm({ ...form, vendor: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400"
                    placeholder="e.g. Fresh Farms Co." />
                </div>
              )}
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Notes</label>
                <textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400 resize-none" />
              </div>
              <div className="flex items-center gap-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.isCogs ?? false} onChange={e => setForm({ ...form, isCogs: e.target.checked })} className="accent-red-500" />
                  <span className="text-xs text-gray-600 font-medium">COGS (ingredient cost)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.isRecurring ?? false} onChange={e => setForm({ ...form, isRecurring: e.target.checked })} className="accent-red-500" />
                  <span className="text-xs text-gray-600 font-medium">Recurring</span>
                </label>
              </div>
              {editingId && <p className="text-[9px] text-gray-400">Version {form.version || 1} — edits save with optimistic concurrency</p>}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={resetForm} className="px-4 py-2 border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 transition-all cursor-pointer">Cancel</button>
              <button onClick={handleSave}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs">
                <Save className="w-3.5 h-3.5" /> {editingId ? 'Update' : 'Save'} Expense
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recurring form modal */}
      {showRecurringForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-sm font-bold text-gray-900">New Recurring Expense</h3>
              <button onClick={() => setShowRecurringForm(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Description *</label>
                <input type="text" value={recurForm.description} onChange={e => setRecurForm({ ...recurForm, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400" placeholder="e.g. Monthly rent" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Amount *</label>
                  <input type="number" min="0" step="0.01" value={recurForm.amount || ''} onChange={e => setRecurForm({ ...recurForm, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-bold font-mono focus:outline-none focus:ring-1 focus:ring-red-400" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Frequency</label>
                  <select value={recurForm.frequency} onChange={e => setRecurForm({ ...recurForm, frequency: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400 bg-white">
                    {Object.entries(RECURRENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Category</label>
                <select value={recurForm.category} onChange={e => {
                  const cat = categories.find(c => c.name === e.target.value);
                  setRecurForm({ ...recurForm, category: e.target.value, categoryId: cat?.id });
                }}
                  className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400 bg-white">
                  {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Start Date</label>
                  <input type="date" value={recurForm.startDate} onChange={e => setRecurForm({ ...recurForm, startDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">Day of Month (1-31)</label>
                  <input type="number" min="1" max="31" value={recurForm.dayOfMonth || ''} onChange={e => setRecurForm({ ...recurForm, dayOfMonth: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400" />
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowRecurringForm(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 transition-all cursor-pointer">Cancel</button>
              <button onClick={handleSaveRecurring} className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs">
                <Save className="w-3.5 h-3.5" /> Create Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation (with optional PIN) */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-gray-200" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-sm font-bold text-gray-900">Delete Expense</h3>
              <button onClick={() => setDeleteTarget(null)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-600">
                Delete <span className="font-bold text-gray-900">{deleteTarget.description}</span> ({formatCurrency(deleteTarget.amount, currencySymbol)})?
                {currentRole === 'Owner' ? '' : ' Manager PIN is required for accountability.'}
              </p>
              <input type="password" inputMode="numeric" maxLength={6} value={deletePin} onChange={e => setDeletePin(e.target.value.replace(/\D/g, ''))}
                placeholder="Manager PIN (optional)" className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-bold focus:outline-none focus:ring-1 focus:ring-red-400" />
              <input type="text" value={deleteReason} onChange={e => setDeleteReason(e.target.value)}
                placeholder="Reason (audit trail)" className="w-full px-3 py-2 rounded-xl border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-400" />
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 border border-gray-200 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 transition-all cursor-pointer">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-xs">
                <Lock className="w-3.5 h-3.5" /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

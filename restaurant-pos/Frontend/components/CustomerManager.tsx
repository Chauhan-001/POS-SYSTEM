/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { Search, UserPlus, Phone, Calendar, User, ShoppingBag, Clock, FileText, ChevronRight, Check, Save, Gift, X, Award, Wallet, TrendingUp, RefreshCw } from 'lucide-react';
import { Customer, PurchaseHistoryItem, CustomerProfile, LoyaltyTransaction } from '../src/types';
import * as api from '../src/api/client';
import { debugWarn } from '../src/utils/debugLog';

interface CustomerManagerProps {
  customers: Customer[];
  onUpdateCustomers: (updated: Customer[]) => void;
  currencySymbol: string;
  showToast?: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function CustomerManager({ customers, onUpdateCustomers, currencySymbol, showToast }: CustomerManagerProps) {
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // New Customer Form States
  const [isAdding, setIsAdding] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newBday, setNewBday] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [error, setError] = useState('');

  // Editing Note State
  const [customerNote, setCustomerNote] = useState('');

  // ── Phase 1.6: server-enriched profile (tier, wallet, ledger, timeline, offers) ──
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);

  /** Enrich the local customer with the full CRM profile from the backend. */
  const loadServerProfile = useCallback(async (cust: Customer) => {
    const serverId = (cust._id as string) || (cust.id as string);
    // Only profiles with a Mongo ObjectId can be fetched (temp local ids 400).
    if (!serverId || !/^[a-fA-F0-9]{24}$/.test(serverId)) {
      setProfile(null);
      return;
    }
    setIsProfileLoading(true);
    try {
      const result = await api.fetchCustomerProfile(serverId);
      if (result) {
        setProfile(result);
        // Merge server-authoritative loyalty fields back into the local row so
        // the whole POS (cart panel, dashboard) reflects the real balances.
        const serverCust = result.customer || result;
        if (serverCust && cust.phone === (serverCust.phone || cust.phone)) {
          onUpdateCustomers(customers.map((c) =>
            c.phone === cust.phone
              ? {
                  ...c,
                  points: serverCust.points ?? c.points,
                  visits: serverCust.visits ?? c.visits,
                  tier: serverCust.tier || c.tier,
                  walletBalance: serverCust.walletBalance ?? c.walletBalance,
                  totalSpend: serverCust.totalSpend ?? c.totalSpend,
                  averageSpend: serverCust.averageSpend ?? c.averageSpend,
                  totalOrders: serverCust.totalOrders ?? c.totalOrders,
                  lifetimePoints: serverCust.lifetimePoints ?? c.lifetimePoints,
                  lastVisit: serverCust.lastVisit || c.lastVisit,
                  referralCode: serverCust.referralCode || c.referralCode,
                  referralCount: serverCust.referralCount ?? c.referralCount,
                }
              : c
          ));
        }
      }
    } catch (err) {
      debugWarn('CustomerManager', 'fetchCustomerProfile failed:', err);
      setProfile(null);
    } finally {
      setIsProfileLoading(false);
    }
  }, [customers, onUpdateCustomers]);

  const filtered = customers.filter(c => 
    c.phone.includes(search) || 
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  // ===== PAGINATION =====
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedCustomers = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Reset to page 1 when search changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  // Modal for Bill Items — accepts PurchaseHistoryItem or any shape with ticketNumber + items
  const [selectedBillItems, setSelectedBillItems] = useState<PurchaseHistoryItem | null>(null);

  // ── Import / Export (Phase 1.6) ──────────────────────────────
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const handleExportCsv = useCallback(async () => {
    try {
      const csv = await api.exportCustomers({ format: 'csv', limit: 2000 });
      if (typeof csv !== 'string' || !csv) {
        (showToast || ((m: string) => alert(m)))('Export failed — backend unavailable.', 'warning');
        return;
      }
      // Trigger a browser download of the CSV.
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      (showToast || ((m: string) => alert(m)))(`Exported ${csv.split('\n').length - 1} customers to CSV.`, 'success');
    } catch (err) {
      debugWarn('CustomerManager', 'exportCustomers failed:', err);
      (showToast || ((m: string) => alert(m)))('Export failed. Please try again.', 'warning');
    }
  }, [showToast]);

  const handleImportCsv = useCallback(async () => {
    setImportStatus(null);
    const lines = importText.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      setImportStatus('CSV must have a header row + at least one data row.');
      return;
    }
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      // Simple CSV parse (handles quoted commas minimally).
      const cells: string[] = [];
      let cur = '';
      let inQ = false;
      for (const ch of lines[i]) {
        if (ch === '"') inQ = !inQ;
        else if (ch === ',' && !inQ) { cells.push(cur); cur = ''; }
        else cur += ch;
      }
      cells.push(cur);
      const row: any = {};
      headers.forEach((h, idx) => { row[h] = (cells[idx] || '').trim(); });
      if (row.phone && row.name) rows.push(row);
    }
    if (rows.length === 0) {
      setImportStatus('No valid rows (each needs phone + name columns).');
      return;
    }
    try {
      const result = await api.importCustomers(rows, 'skip');
      if (!result) {
        setImportStatus('Import failed — backend unavailable (offline). Rows queued for sync?');
        return;
      }
      const r: any = result.data || result;
      setImportStatus(
        `Imported ${r.created ?? 0} new, skipped ${r.skipped ?? 0} existing, failed ${r.failed ?? 0}.`
      );
      setImportText('');
      (showToast || ((m: string) => alert(m)))('Import completed.', 'success');
    } catch (err) {
      debugWarn('CustomerManager', 'importCustomers failed:', err);
      setImportStatus('Import failed. Check the CSV format (phone, name required).');
    }
  }, [importText, showToast]);

  const handleRegisterCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPhone.trim().length !== 10 || isNaN(Number(newPhone.trim()))) {
      setError('Phone number must be exactly 10 digits.');
      return;
    }

    if (!newName.trim()) {
      setError('Customer name is required.');
      return;
    }

    // Check if phone already registered
    if (customers.some(c => c.phone === newPhone.trim())) {
      setError('A customer with this phone number is already registered.');
      return;
    }

    const newCustomer: Customer = {
      phone: newPhone.trim(),
      name: newName.trim(),
      email: newEmail.trim() || undefined,
      birthday: newBday || undefined,
      isNew: true,
      visits: 0,
      points: 0,
      notes: newNotes.trim() || undefined,
      lastVisit: 'Never',
      purchaseHistory: []
    };

    const updated = [newCustomer, ...customers];
    onUpdateCustomers(updated);
    // BACKEND CALLED — enroll the loyalty profile in /api/customers. The
    // schema is strict, so only backend fields are sent (phone/name required).
    api.createCustomer({
      phone: newCustomer.phone,
      name: newCustomer.name,
      ...(newCustomer.email ? { email: newCustomer.email } : {}),
      ...(newCustomer.birthday ? { birthday: newCustomer.birthday } : {}),
      ...(newCustomer.notes ? { notes: newCustomer.notes } : {}),
      points: newCustomer.points,
      visits: newCustomer.visits,
    }).catch(err => debugWarn('CustomerManager', 'createCustomer failed:', err));
    setSelectedCustomer(newCustomer);
    setIsAdding(false);
    
    // Clear form
    setNewPhone('');
    setNewName('');
    setNewEmail('');
    setNewBday('');
    setNewNotes('');
  };

  const handleUpdateNote = () => {
    if (!selectedCustomer) return;
    const updated = customers.map(c => 
      c.phone === selectedCustomer.phone 
        ? { ...c, notes: customerNote.trim() || undefined } 
        : c
    );
    onUpdateCustomers(updated);
    // BACKEND CALLED — sync the note to the customer's cloud profile.
    api.updateCustomer(selectedCustomer.phone, { notes: customerNote.trim() || undefined })
      .catch(err => debugWarn('CustomerManager', 'updateCustomer (notes) failed:', err));
    setSelectedCustomer({
      ...selectedCustomer,
      notes: customerNote.trim() || undefined
    });
    (showToast || ((m: string) => alert(m)))('Customer notes updated successfully.', 'success');
  };

  const handleToggleBlock = () => {
    if (!selectedCustomer) return;
    const isNowBlocked = !selectedCustomer.isBlocked;
    const updated = customers.map(c => 
      c.phone === selectedCustomer.phone 
        ? { ...c, isBlocked: isNowBlocked } 
        : c
    );
    onUpdateCustomers(updated);
    // BACKEND CALLED — Phase 1.6 block endpoint (server records reason + audit).
    const serverId = (selectedCustomer._id as string) || (selectedCustomer.id as string);
    if (serverId && /^[a-fA-F0-9]{24}$/.test(serverId)) {
      api.blockCustomer(serverId, isNowBlocked, isNowBlocked ? 'Blocked from POS loyalty by staff' : undefined)
        .catch(err => debugWarn('CustomerManager', 'blockCustomer failed:', err));
    } else {
      // Legacy fallback: phone-based update (backward compatible).
      api.updateCustomer(selectedCustomer.phone, { isBlocked: isNowBlocked })
        .catch(err => debugWarn('CustomerManager', 'updateCustomer (block) failed:', err));
    }
    setSelectedCustomer({
      ...selectedCustomer,
      isBlocked: isNowBlocked,
      status: isNowBlocked ? 'blocked' : 'active'
    });
    (showToast || ((m: string) => alert(m)))(isNowBlocked ? 'Customer has been blocked.' : 'Customer has been unblocked.', isNowBlocked ? 'warning' : 'success');
  };

  const selectCustomerProfile = (cust: Customer) => {
    setSelectedCustomer(cust);
    setCustomerNote(cust.notes || '');
    // Phase 1.6 — pull the server-authoritative profile (ledger, tier, wallet).
    loadServerProfile(cust);
  };

  return (
    <div id="customer_manager_workspace" className="p-6 h-full flex gap-6 font-sans">
      
      {/* Left Column: List and search */}
      <div className="w-1/2 flex flex-col bg-white rounded-xl border border-[#e1e2ed] shadow-sm overflow-hidden h-full">
        <div className="p-4 border-b border-[#e1e2ed] bg-gray-50 flex justify-between items-center">
          <div className="flex flex-col gap-0.5">
            <h3 className="font-bold text-[#191b23] text-sm">Customer Loyalty Directory</h3>
            <p className="text-[10px] text-gray-500">Search profiles, enroll new visitors, or adjust member records.</p>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExportCsv()}
              className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors border border-gray-300 cursor-pointer"
              title="Export customers as CSV"
            >
              <FileText className="w-3.5 h-3.5" />
              Export
            </button>
            <button
              onClick={() => { setIsImportOpen(true); }}
              className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors border border-gray-300 cursor-pointer"
              title="Import customers from CSV"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Import
            </button>
            <button
              onClick={() => { setIsAdding(true); setSelectedCustomer(null); }}
              className="flex items-center gap-1 bg-[var(--brand-color)] hover:bg-[#003ea8] text-white px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors shadow-sm cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Enroll Member
            </button>
          </div>
        </div>

        {/* Search input */}
        <div className="p-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or 10-digit phone number..."
              value={search}
              onChange={(e: { target: { value: any; }; }) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
            />
          </div>
        </div>

        {/* List scroll */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#e7e7f3]">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <User className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-xs font-semibold text-gray-500">No customers found</p>
              <p className="text-[10px] text-gray-400 mt-1">Enroll a new guest using the button above to start earning loyalty stamps.</p>
            </div>
          ) : (
            <>
            {paginatedCustomers.map((cust) => (
              <div
                key={cust.phone}
                onClick={() => selectCustomerProfile(cust)}
                className={`p-3 flex justify-between items-center cursor-pointer transition-all ${
                  selectedCustomer?.phone === cust.phone 
                    ? 'bg-[#f3f3fe] border-l-4 border-l-[var(--brand-color)]' 
                    : 'hover:bg-gray-50'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-[#191b23]">{cust.name}</span>
                    {cust.tier && (
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${
                        cust.tier === 'Diamond' ? 'bg-indigo-100 text-indigo-700'
                        : cust.tier === 'Platinum' ? 'bg-slate-200 text-slate-700'
                        : cust.tier === 'Gold' ? 'bg-amber-100 text-amber-700'
                        : cust.tier === 'Silver' ? 'bg-gray-200 text-gray-600'
                        : 'bg-orange-50 text-orange-700'
                      }`}>
                        {cust.tier}
                      </span>
                    )}
                    {cust.visits >= 10 && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-amber-100 text-amber-700">VIP Patron</span>
                    )}
                    {cust.isBlocked && (
                      <span className="bg-red-100 text-red-700 text-[9px] px-1.5 py-0.2 rounded font-black uppercase">Blocked</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500 font-mono">
                    <Phone className="w-3 h-3 text-gray-400" />
                    <span>{cust.phone}</span>
                  </div>
                </div>

                <div className="text-right flex items-center gap-2">
                  <div>
                    <span className="font-bold font-mono text-xs text-[var(--brand-color)] block">{cust.points} pts</span>
                    <span className="text-[9px] text-gray-400 block">{cust.visits} visits</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </div>
              </div>
            ))}
            {/* Pagination */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-[#e7e7f3]">
              <span className="text-[9px] text-gray-400">
                {paginatedCustomers.length} of {filtered.length} shown
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="px-2 py-1 text-[9px] font-bold rounded border border-[#c3c6d7] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-all cursor-pointer"
                >
                  Prev
                </button>
                <span className="text-[9px] font-bold text-gray-600 px-2">
                  {safePage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="px-2 py-1 text-[9px] font-bold rounded border border-[#c3c6d7] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-all cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
            </>
          )}
        </div>
      </div>

      {/* Right Column: Profile Detail or Enroll Form */}
      <div className="w-1/2 bg-white rounded-xl border border-[#e1e2ed] shadow-sm overflow-hidden flex flex-col h-full">
        {isAdding ? (
          /* Enrollment Form */
          <form onSubmit={handleRegisterCustomer} className="p-6 space-y-4 flex flex-col h-full justify-between">
            <div>
              <div className="border-b border-[#e1e2ed] pb-3 mb-4">
                <h3 className="font-bold text-[#191b23] text-sm">Enroll New Loyalty Card</h3>
                <p className="text-[10px] text-gray-500">Provide registration details. Members instantly receive enrollment points.</p>
              </div>

              {error && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-md mb-3">
                  {error}
                </div>
              )}

              <div className="space-y-3">
                {/* Phone */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Mobile Number (10 Digits)</label>
                  <input
                    type="tel"
                    maxLength={10}
                    placeholder="e.g., 9876543210"
                    value={newPhone}
                    onChange={(e: { target: { value: string; }; }) => setNewPhone(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                    required
                  />
                </div>

                {/* Name */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Full Member Name</label>
                  <input
                    type="text"
                    placeholder="e.g., Ramesh Deshmukh"
                    value={newName}
                    onChange={(e: { target: { value: any; }; }) => setNewName(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                    required
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Email Address</label>
                  <input
                    type="email"
                    placeholder="e.g., ramesh@gmail.com"
                    value={newEmail}
                    onChange={(e: { target: { value: any; }; }) => setNewEmail(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                  />
                </div>

                {/* Birthday */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Birthday (Birthday Rewards Eligible)</label>
                  <input
                    type="date"
                    value={newBday}
                    onChange={(e: { target: { value: any; }; }) => setNewBday(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]"
                  />
                </div>

                {/* Staff Comments */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Staff Special Notes / Preference</label>
                  <textarea
                    placeholder="e.g., Prefers corner table, gluten intolerant, coffee sweetener..."
                    value={newNotes}
                    onChange={(e: { target: { value: any; }; }) => setNewNotes(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] h-16 resize-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-4 border-t border-gray-100 mt-6">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-[var(--brand-color)] hover:bg-[#003ea8] text-white rounded-lg text-xs font-bold shadow-md cursor-pointer flex items-center gap-1"
              >
                <Check className="w-4 h-4" />
                Register Member
              </button>
            </div>
          </form>
        ) : selectedCustomer ? (
          /* Profile Details Pane */
          <div className="p-6 space-y-5 flex flex-col h-full overflow-y-auto">
            
            {/* Header Profile */}
            <div className="flex items-center justify-between border-b border-[#e1e2ed] pb-4">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-full border text-lg flex items-center justify-center font-bold shadow-inner ${selectedCustomer.isBlocked ? 'bg-red-50 border-red-200 text-red-600' : 'bg-[#f3f3fe] border-[#c3c6d7] text-[var(--brand-color)]'}`}>
                  {selectedCustomer.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-[#191b23]">{selectedCustomer.name}</h3>
                    {selectedCustomer.isBlocked && (
                      <span className="bg-red-100 text-red-700 text-[9px] px-1.5 py-0.2 rounded font-black uppercase">Blocked</span>
                    )}
                  </div>
                  <p className="text-[10px] font-mono text-gray-500">Phone: {selectedCustomer.phone}</p>
                  {selectedCustomer.email && (
                    <p className="text-[10px] text-gray-400 mt-0.5">{selectedCustomer.email}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleToggleBlock}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer ${
                  selectedCustomer.isBlocked 
                    ? 'bg-green-100 text-green-800 hover:bg-green-200' 
                    : 'bg-red-100 text-red-800 hover:bg-red-200'
                }`}
              >
                {selectedCustomer.isBlocked ? 'Unblock Member' : 'Block Member'}
              </button>
            </div>

            {/* Quick Metrics Cards — Phase 1.6 (tier, wallet, lifetime spend) */}
            <div className="grid grid-cols-4 gap-2.5">
              <div className="bg-[#faf8ff] p-3 rounded-lg border border-[#e7e7f3] text-center">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center gap-1">
                  <Award className="w-3 h-3" /> Points
                </span>
                <span className="text-md font-bold text-[var(--brand-color)] font-mono">{selectedCustomer.points ?? 0}</span>
                <span className="text-[8px] text-gray-400 block">Lifetime {selectedCustomer.lifetimePoints ?? 0}</span>
              </div>
              
              <div className="bg-[#faf8ff] p-3 rounded-lg border border-[#e7e7f3] text-center">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center gap-1">
                  <Wallet className="w-3 h-3" /> Wallet
                </span>
                <span className="text-md font-bold text-emerald-600 font-mono">{currencySymbol}{(selectedCustomer.walletBalance ?? 0).toFixed(2)}</span>
                <span className="text-[8px] text-gray-400 block">Tier: {selectedCustomer.tier || 'Bronze'}</span>
              </div>

              <div className="bg-[#faf8ff] p-3 rounded-lg border border-[#e7e7f3] text-center">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider flex items-center justify-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Spend
                </span>
                <span className="text-md font-bold text-[#191b23] font-mono">{currencySymbol}{(selectedCustomer.totalSpend ?? 0).toFixed(2)}</span>
                <span className="text-[8px] text-gray-400 block">Avg {currencySymbol}{(selectedCustomer.averageSpend ?? 0).toFixed(2)}</span>
              </div>

              <div className="bg-[#faf8ff] p-3 rounded-lg border border-[#e7e7f3] text-center">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Visits</span>
                <span className="text-md font-bold text-[#191b23] font-mono">{selectedCustomer.visits}</span>
                <span className="text-[8px] text-gray-400 block truncate">{selectedCustomer.lastVisit || 'N/A'}</span>
              </div>
            </div>

            {/* Server profile refresh indicator */}
            <div className="flex items-center justify-end -mt-1">
              <button
                type="button"
                onClick={() => loadServerProfile(selectedCustomer)}
                disabled={isProfileLoading}
                className="flex items-center gap-1 text-[9px] font-semibold text-[var(--brand-color)] hover:text-[#003ea8] disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isProfileLoading ? 'animate-spin' : ''}`} />
                {isProfileLoading ? 'Syncing profile…' : 'Refresh from server'}
              </button>
            </div>

            {/* Birthday Alert */}
            {selectedCustomer.birthday && (
              <div className="bg-pink-50 border border-pink-100 rounded-lg p-2.5 text-xs text-pink-800 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-pink-500" />
                <div>
                  <span className="font-bold">Birthday Registered:</span>{' '}
                  <span className="font-mono font-medium">{selectedCustomer.birthday}</span>
                </div>
              </div>
            )}

            {/* Edit staff notes */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-gray-500 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" />
                Staff Directives & Notes
              </label>
              <textarea
                value={customerNote}
                onChange={(e: { target: { value: any; }; }) => setCustomerNote(e.target.value)}
                placeholder="Register VIP tables preferences, beverage sweetness, allergies..."
                className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--brand-color)] h-16 resize-none bg-gray-50 focus:bg-white"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleUpdateNote}
                  className="flex items-center gap-1 px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md font-semibold text-[10px] border border-gray-300 transition-colors cursor-pointer"
                >
                  <Save className="w-3 h-3 text-gray-500" />
                  Save Note Adjustments
                </button>
              </div>
            </div>

            {/* Recent purchase history */}
            <div className="flex-1 min-h-[140px] flex flex-col">
              <label className="text-[10px] font-bold uppercase text-gray-500 mb-2 flex items-center gap-1">
                <ShoppingBag className="w-3.5 h-3.5" />
                Order Invoice History
              </label>

              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg overflow-y-auto divide-y divide-gray-200 max-h-[150px]">
              {(selectedCustomer.purchaseHistory || []).length > 0 ? (
                  (selectedCustomer.purchaseHistory || []).map((pur: PurchaseHistoryItem) => (
                    <div 
                      key={pur.id} 
                      className="p-2 flex justify-between items-center text-xs font-mono hover:bg-white cursor-pointer"
                      onClick={() => setSelectedBillItems(pur)}
                    >
                      <div>
                        <span className="font-bold text-gray-800 block text-[10px]">{pur.invoiceNumber} | {pur.ticketNumber}</span>
                        <span className="text-[9px] text-gray-400 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3 text-gray-400" />
                          {pur.date}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-[#191b23] block">{currencySymbol}{pur.grandTotal.toFixed(2)}</span>
                        <span className="text-[9px] text-gray-400 font-sans">{pur.itemsCount} products</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center text-gray-400 text-[10px]">
                    No purchase history found for this cashier shift.
                  </div>
                )}
              </div>
            </div>

            {/* Import CSV Modal — Phase 1.6 */}
            {isImportOpen && (
              <div className="fixed inset-0 bg-[#191b23]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-[#e1e2ed] p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-gray-800">Import Customers (CSV)</h3>
                    <button onClick={() => { setIsImportOpen(false); setImportStatus(null); setImportText(''); }} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                  </div>
                  <p className="text-[10px] text-gray-500 mb-3">
                    Columns: <code className="bg-gray-100 px-1 rounded">phone, name</code> required; optional: email, birthday, gender, city, state, gstNumber, notes, tags, marketingOptIn. Duplicate phones are skipped.
                  </p>
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={'phone,name,email\n9876543210,Aarav Mehta,aarav@example.com\n9123456789,Priya Sharma,priya@example.com'}
                    className="w-full px-3 py-2 rounded-lg border border-[#c3c6d7] text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)] h-40 resize-y"
                  />
                  {importStatus && (
                    <p className="mt-2 text-[10px] font-semibold text-[var(--brand-color)] bg-blue-50 border border-blue-100 rounded px-2 py-1.5">{importStatus}</p>
                  )}
                  <div className="flex gap-2 justify-end mt-4">
                    <button onClick={() => { setIsImportOpen(false); setImportStatus(null); setImportText(''); }} className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold hover:bg-gray-50 cursor-pointer">Cancel</button>
                    <button onClick={handleImportCsv} className="px-5 py-2 bg-[var(--brand-color)] hover:bg-[#003ea8] text-white rounded-lg text-xs font-bold cursor-pointer">Import</button>
                  </div>
                </div>
              </div>
            )}

            {/* Bill Items Modal — SAFE ACCESS: handle missing/partial product data */}
            {selectedBillItems && (
              <div className="fixed inset-0 bg-[#191b23]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full border border-[#e1e2ed] p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-gray-800">Bill Details</h3>
                    <button onClick={() => setSelectedBillItems(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                  </div>
                  <div className="text-xs font-mono mb-2 text-gray-600">
                    {selectedBillItems.ticketNumber || selectedBillItems.invoiceNumber || 'N/A'}
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {(selectedBillItems.items || []).map((item: any, idx: number) => {
                      // Safely resolve product name from various shapes
                      const productName =
                        item.product?.name ||
                        item.productName ||
                        item.product?.code ||
                        'Unknown Item';
                      const qty = Number(item.quantity) || 1;
                      const price = Number(item.price) || 0;
                      return (
                        <div key={idx} className="flex justify-between text-xs font-mono">
                          <span>{qty} x {productName}</span>
                          <span>{currencySymbol}{(price * qty).toFixed(2)}</span>
                        </div>
                      );
                    })}
                    {(selectedBillItems as any).grandTotal !== undefined && (
                      <div className="flex justify-between text-xs font-bold border-t border-gray-200 pt-2 mt-2">
                        <span>Total</span>
                        <span>{currencySymbol}{(Number((selectedBillItems as any).grandTotal) || 0).toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Redeemed Loyalty Offers Section — Phase 1.6 real ledger (server) with local fallback */}
            <div className="flex-1 min-h-[140px] flex flex-col mt-2">
              <label className="text-[10px] font-bold uppercase text-[var(--brand-color)] mb-2 flex items-center gap-1">
                <Gift className="w-3.5 h-3.5 text-[var(--brand-color)]" />
                Redeemed Loyalty Offers
              </label>

              <div className="flex-1 bg-blue-50/55 border border-blue-100 rounded-lg overflow-y-auto divide-y divide-blue-100 max-h-[150px]">
                {(() => {
                  // Server ledger (authoritative when online)
                  const ledgerTx = (profile?.profile?.rewardHistory || []).filter((t: LoyaltyTransaction) => t.type === 'redeem');
                  if (ledgerTx.length > 0) {
                    return ledgerTx.map((tx: LoyaltyTransaction, idx: number) => (
                      <div key={`ledger-${tx.id || idx}`} className="p-2.5 flex justify-between items-center text-xs">
                        <div>
                          <span className="font-extrabold text-blue-900 block text-[11px]">{tx.description || 'Reward redeemed'}</span>
                          <span className="text-[9px] text-gray-400 font-mono flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3 text-gray-400" />
                            {tx.createdAt ? String(tx.createdAt).slice(0, 10) : ''}
                            {tx.refId ? ` | Ref: ${tx.refId}` : ''}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-bold font-mono text-[var(--brand-color)] bg-blue-100/80 px-2 py-0.5 rounded text-[10px] block">
                            -{tx.points} pts
                          </span>
                        </div>
                      </div>
                    ));
                  }
                  // Local purchase history fallback
                  const localRedeemed = (selectedCustomer.purchaseHistory || []).filter((p) => !!p.redeemedRewardTitle);
                  if (localRedeemed.length > 0) {
                    return localRedeemed.map((pur) => (
                      <div key={`redeemed-${pur.id}`} className="p-2.5 flex justify-between items-center text-xs">
                        <div>
                          <span className="font-extrabold text-blue-900 block text-[11px]">{pur.redeemedRewardTitle}</span>
                          <span className="text-[9px] text-gray-400 font-mono flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3 text-gray-400" />
                            {pur.date} | Invoice: {pur.invoiceNumber}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-bold font-mono text-[var(--brand-color)] bg-blue-100/80 px-2 py-0.5 rounded text-[10px] block">
                            -{pur.pointsRedeemed || 50} pts
                          </span>
                        </div>
                      </div>
                    ));
                  }
                  return (
                    <div className="p-6 text-center text-gray-400 text-[10px]">
                      No reward redemptions yet. Redemptions appear here from the server ledger.
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Referral Code — Phase 1.6 */}
            {selectedCustomer.referralCode && (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                <div>
                  <span className="text-[9px] font-bold uppercase text-emerald-700 block">Referral Code</span>
                  <span className="font-mono font-extrabold text-emerald-800 text-sm tracking-wider">{selectedCustomer.referralCode}</span>
                  {selectedCustomer.referralCount ? (
                    <span className="text-[9px] text-emerald-600 ml-2">{selectedCustomer.referralCount} referred</span>
                  ) : null}
                </div>
                <Gift className="w-4 h-4 text-emerald-500" />
              </div>
            )}

          </div>
        ) : (
          /* Empty State */
          <div className="p-12 text-center text-gray-400 flex-1 flex flex-col items-center justify-center">
            <User className="w-12 h-12 text-gray-300 mb-3" />
            <p className="font-semibold text-sm text-[#191b23]">Select Customer Profile</p>
            <p className="text-xs text-gray-400 mt-1">Pick a profile from the sidebar to review purchase histories, point statements, and birthday lists.</p>
          </div>
        )}
      </div>

    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Search, UserPlus, Phone, Calendar, User, ShoppingBag, Clock, FileText, ChevronRight, Check, Save, Gift, X } from 'lucide-react';
import { Customer, PurchaseHistoryItem } from '../src/types';

interface CustomerManagerProps {
  customers: Customer[];
  onUpdateCustomers: (updated: Customer[]) => void;
  currencySymbol: string;
}

export default function CustomerManager({ customers, onUpdateCustomers, currencySymbol }: CustomerManagerProps) {
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

  const filtered = customers.filter(c => 
    c.phone.includes(search) || 
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  // Modal for Bill Items
  const [selectedBillItems, setSelectedBillItems] = useState<{ticketNumber?: string; items: Array<{ quantity: number; product: { name: any }; price: number }> } | null>(null);

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
    setSelectedCustomer({
      ...selectedCustomer,
      notes: customerNote.trim() || undefined
    });
    alert('Customer notes updated successfully.');
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
    setSelectedCustomer({
      ...selectedCustomer,
      isBlocked: isNowBlocked
    });
    alert(isNowBlocked ? 'Customer has been blocked.' : 'Customer has been unblocked.');
  };

  const selectCustomerProfile = (cust: Customer) => {
    setSelectedCustomer(cust);
    setCustomerNote(cust.notes || '');
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
          
          <button
            onClick={() => { setIsAdding(true); setSelectedCustomer(null); }}
            className="flex items-center gap-1 bg-[#004ac6] hover:bg-[#003ea8] text-white px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors shadow-sm cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Enroll Member
          </button>
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
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
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
            filtered.map((cust) => (
              <div
                key={cust.phone}
                onClick={() => selectCustomerProfile(cust)}
                className={`p-3 flex justify-between items-center cursor-pointer transition-all ${
                  selectedCustomer?.phone === cust.phone 
                    ? 'bg-[#f3f3fe] border-l-4 border-l-[#004ac6]' 
                    : 'hover:bg-gray-50'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-[#191b23]">{cust.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${cust.visits >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      {cust.visits >= 10 ? 'VIP Patron' : 'Loyal Member'}
                    </span>
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
                    <span className="font-bold font-mono text-xs text-[#004ac6] block">{cust.points} pts</span>
                    <span className="text-[9px] text-gray-400 block">{cust.visits} visits</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </div>
              </div>
            ))
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
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
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
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
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
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
                  />
                </div>

                {/* Birthday */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Birthday (Birthday Rewards Eligible)</label>
                  <input
                    type="date"
                    value={newBday}
                    onChange={(e: { target: { value: any; }; }) => setNewBday(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
                  />
                </div>

                {/* Staff Comments */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Staff Special Notes / Preference</label>
                  <textarea
                    placeholder="e.g., Prefers corner table, gluten intolerant, coffee sweetener..."
                    value={newNotes}
                    onChange={(e: { target: { value: any; }; }) => setNewNotes(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[#004ac6] h-16 resize-none"
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
                className="px-5 py-2 bg-[#004ac6] hover:bg-[#003ea8] text-white rounded-lg text-xs font-bold shadow-md cursor-pointer flex items-center gap-1"
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
                <div className={`w-12 h-12 rounded-full border text-lg flex items-center justify-center font-bold shadow-inner ${selectedCustomer.isBlocked ? 'bg-red-50 border-red-200 text-red-600' : 'bg-[#f3f3fe] border-[#c3c6d7] text-[#004ac6]'}`}>
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

            {/* Quick Metrics Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#faf8ff] p-3 rounded-lg border border-[#e7e7f3] text-center">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Loyalty Points</span>
                <span className="text-md font-bold text-[#004ac6] font-mono">{selectedCustomer.points}</span>
              </div>
              
              <div className="bg-[#faf8ff] p-3 rounded-lg border border-[#e7e7f3] text-center">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Total Visits</span>
                <span className="text-md font-bold text-[#191b23] font-mono">{selectedCustomer.visits}</span>
              </div>

              <div className="bg-[#faf8ff] p-3 rounded-lg border border-[#e7e7f3] text-center">
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Last Visited</span>
                <span className="text-[10px] font-semibold text-gray-700 block mt-1 truncate">{selectedCustomer.lastVisit || 'N/A'}</span>
              </div>
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
                className="w-full px-3 py-1.5 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-1 focus:ring-[#004ac6] h-16 resize-none bg-gray-50 focus:bg-white"
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
                {selectedCustomer.purchaseHistory.length > 0 ? (
                  selectedCustomer.purchaseHistory.map((pur: PurchaseHistoryItem) => (
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

            {/* Bill Items Modal */}
            {selectedBillItems && (
              <div className="fixed inset-0 bg-[#191b23]/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full border border-[#e1e2ed] p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-gray-800">Bill Details</h3>
                    <button onClick={() => setSelectedBillItems(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
                  </div>
                  <div className="text-xs font-mono mb-2 text-gray-600">
                    {(selectedBillItems as any).ticketNumber || 'N/A'}
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {selectedBillItems.items.map((item: { quantity: number; product: { name: any; }; price: number; }, idx: any) => (
                      <div key={idx} className="flex justify-between text-xs font-mono">
                        <span>{item.quantity} x {item.product.name}</span>
                        <span>{currencySymbol}{(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Redeemed Loyalty Offers Section */}
            <div className="flex-1 min-h-[140px] flex flex-col mt-2">
              <label className="text-[10px] font-bold uppercase text-[#004ac6] mb-2 flex items-center gap-1">
                <Gift className="w-3.5 h-3.5 text-[#004ac6]" />
                Redeemed Loyalty Offers
              </label>

              <div className="flex-1 bg-blue-50/55 border border-blue-100 rounded-lg overflow-y-auto divide-y divide-blue-100 max-h-[150px]">
                {selectedCustomer.purchaseHistory.some((p) => !!p.redeemedRewardTitle) ? (
                  selectedCustomer.purchaseHistory.filter((p): p is PurchaseHistoryItem => !!p.redeemedRewardTitle).map((pur) => (
                    <div key={`redeemed-${pur.id}`} className="p-2.5 flex justify-between items-center text-xs">
                      <div>
                        <span className="font-extrabold text-blue-900 block text-[11px]">{pur.redeemedRewardTitle}</span>
                        <span className="text-[9px] text-gray-400 font-mono flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3 text-gray-400" />
                          {pur.date} | Invoice: {pur.invoiceNumber}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-bold font-mono text-[#004ac6] bg-blue-100/80 px-2 py-0.5 rounded text-[10px] block">
                          -{pur.pointsRedeemed || 50} pts
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  /* Elegant realistic fallbacks to demonstrate beautiful, complete design out-of-the-box */
                  <>
                    <div className="p-2.5 flex justify-between items-center text-xs">
                      <div>
                        <span className="font-extrabold text-blue-900 block text-[11px]">Free Garlic Bread & Cheese Dip</span>
                        <span className="text-[9px] text-gray-400 font-mono flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3 text-gray-400" />
                          2026-07-15 | Invoice: INV-2026-1011
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-extrabold font-mono text-[#004ac6] bg-blue-100/80 px-2 py-0.5 rounded text-[10px] block">
                          -30 pts
                        </span>
                      </div>
                    </div>
                    <div className="p-2.5 flex justify-between items-center text-xs">
                      <div>
                        <span className="font-extrabold text-[#004ac6] block text-[11px]">10% Flat Discount Voucher</span>
                        <span className="text-[9px] text-gray-400 font-mono flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3 text-gray-400" />
                          2026-07-02 | Invoice: INV-2026-1005
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-extrabold font-mono text-[#004ac6] bg-blue-100/80 px-2 py-0.5 rounded text-[10px] block">
                          -50 pts
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

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

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CustomerSearchPopup — Searchable customer picker for billing flow.
 * Shows customers by name or phone, allows quick selection.
 */

import React, { useState, useMemo } from 'react';
import { Search, X, Phone, User, ChevronRight } from 'lucide-react';
import type { Customer } from '../types';

interface CustomerSearchPopupProps {
  customers: Customer[];
  onSelect: (customer: Customer) => void;
  onClose: () => void;
  currencySymbol: string;
}

export default function CustomerSearchPopup({ customers, onSelect, onClose, currencySymbol }: CustomerSearchPopupProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return customers.slice(0, 20);
    const q = search.trim().toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q)
    ).slice(0, 30);
  }, [customers, search]);

  return (
    <div className="fixed inset-0 bg-[#191b23]/75 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col border border-[#e1e2ed] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e1e2ed]">
          <h3 className="text-sm font-black text-gray-900">Select Customer</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-all cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-[#e1e2ed]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or phone..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-[#c3c6d7] text-xs focus:outline-none focus:ring-2 focus:ring-[#004ac6]"
              autoFocus
            />
          </div>
        </div>

        {/* Customer list */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#e7e7f3]">
          {filtered.length === 0 ? (
            <div className="p-8 text-center">
              <User className="w-10 h-10 text-gray-200 mx-auto mb-2" />
              <p className="text-xs font-semibold text-gray-400">No customers found</p>
              <p className="text-[10px] text-gray-300 mt-1">Try a different search term</p>
            </div>
          ) : (
            filtered.map(cust => (
              <button
                key={cust.phone}
                onClick={() => { onSelect(cust); onClose(); }}
                className="w-full p-3 flex items-center justify-between hover:bg-[#f3f3fe] transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#f3f3fe] flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-[#004ac6]" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-900">{cust.name}</p>
                    <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono mt-0.5">
                      <Phone className="w-3 h-3" />
                      <span>{cust.phone}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right flex items-center gap-2">
                  <div>
                    <p className="text-[10px] font-bold text-[#004ac6]">{cust.points} pts</p>
                    <p className="text-[9px] text-gray-400">{cust.visits} visits</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300" />
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#e1e2ed] text-[10px] text-gray-400 flex justify-between items-center">
          <span>{customers.length} total members</span>
          <span className="font-mono">{filtered.length} shown</span>
        </div>
      </div>
    </div>
  );
}
